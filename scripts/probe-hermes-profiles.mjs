import http from "node:http";
import https from "node:https";
import WebSocket from "ws";

const endpoint = process.env.HEARTH_HERMES_ENDPOINT || "ws://127.0.0.1:4510/api/ws";
const token = process.env.HEARTH_HERMES_TOKEN;
if (!token) throw new Error("Set HEARTH_HERMES_TOKEN before running this probe.");

const wsUrl = new URL(endpoint);
wsUrl.searchParams.set("token", token);
const hostHeader = process.env.HEARTH_HERMES_HOST_HEADER || `127.0.0.1:${wsUrl.port || (wsUrl.protocol === "wss:" ? "443" : "80")}`;
const socket = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${token}`, Host: hostHeader } });
const pending = new Map();
let nextId = 0;

function request(method, params = {}) {
  const id = `profiles-${++nextId}`;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 30_000);
    pending.set(id, { resolve, reject, timer });
  });
}

socket.on("message", (raw) => {
  const frame = JSON.parse(raw.toString());
  if (frame.id == null) return;
  const call = pending.get(frame.id);
  if (!call) return;
  clearTimeout(call.timer);
  pending.delete(frame.id);
  if (frame.error) call.reject(new Error(frame.error.message || "Hermes RPC failed"));
  else call.resolve(frame.result);
});

function rest(path) {
  const origin = `${wsUrl.protocol === "wss:" ? "https:" : "http:"}//${wsUrl.host}`;
  const url = new URL(path, origin);
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(url, {
      headers: { Host: hostHeader, "X-Hermes-Session-Token": token },
      ...(url.protocol === "https:" ? { servername: wsUrl.hostname } : {}),
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if ((response.statusCode || 500) >= 400) return reject(new Error(`${path} returned ${response.statusCode}: ${body.slice(0, 240)}`));
        try { resolve(JSON.parse(body)); } catch { reject(new Error(`${path} returned invalid JSON`)); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

await new Promise((resolve, reject) => {
  socket.once("open", resolve);
  socket.once("error", reject);
});

try {
  const profileResult = await request("profiles.list", { include_sessions: false });
  const profiles = (profileResult.profiles || []).map((profile) => profile.name);
  if (profiles.length < 2) throw new Error(`Unified listener exposed only ${profiles.length} profile.`);

  const sessionResult = await rest("/api/profiles/sessions?limit=100&offset=0&min_messages=1&archived=exclude&order=recent&profile=all");
  const sessions = sessionResult.sessions || sessionResult.data || [];
  if (!sessions.every((session) => typeof session.profile === "string" && session.profile.length > 0)) {
    throw new Error("At least one unified session was missing its profile tag.");
  }

  const profilesWithSessions = [...new Set(sessions.map((session) => session.profile))];
  for (const profile of profiles) {
    const [restOptions, rpcOptions] = await Promise.all([
      rest(`/api/model/options?explicit_only=true&profile=${encodeURIComponent(profile)}`),
      request("model.options", { explicit_only: true, profile }),
    ]);
    if (!Array.isArray(restOptions.providers) || !Array.isArray(rpcOptions.providers)) {
      throw new Error(`Model options for ${profile} had an invalid shape.`);
    }
  }
  for (const profile of profilesWithSessions) {
    const sample = sessions.find((session) => session.profile === profile);
    const history = await rest(`/api/sessions/${encodeURIComponent(sample.id)}/messages?profile=${encodeURIComponent(profile)}`);
    if (!Array.isArray(history.messages || history.data)) throw new Error(`Transcript for ${profile} had an invalid shape.`);
  }

  console.log(`Hermes unified-profile probe passed: ${profiles.length} profiles, ${sessions.length} conversations, ${profilesWithSessions.length} profiles with transcript samples.`);
  console.log(`Profiles: ${profiles.join(", ")}`);
} finally {
  socket.terminate();
}

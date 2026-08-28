import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const endpoint = process.env.HEARTH_REMOTE_PROBE_ENDPOINT ?? "ws://127.0.0.1:4500";
const tokenPath = process.env.HEARTH_REMOTE_TOKEN_PATH ??
  join(homedir(), ".codex", "remote-listener", "app-server-token");
const token = (await readFile(tokenPath, "utf8")).trim();
const socket = new WebSocket(endpoint, { headers: { Authorization: `Bearer ${token}` } });
const pending = new Map();
let nextId = 1;
let attachmentProbeRoot;

socket.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  if (typeof message.id !== "number") return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
  else request.resolve(message.result);
});

await new Promise((resolve, reject) => {
  socket.once("open", resolve);
  socket.once("error", reject);
});

function request(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

try {
  await request("initialize", {
    clientInfo: { name: "hearth_remote_probe", title: "Hearth Remote lifecycle probe", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  });
  socket.send(JSON.stringify({ method: "initialized" }));

  attachmentProbeRoot = join(process.cwd(), ".codex-remote-attachments", `probe-${randomUUID()}`);
  const attachmentProbePath = join(attachmentProbeRoot, "round-trip.txt");
  const attachmentProbeData = Buffer.from("Hearth Remote attachment probe", "utf8").toString("base64");
  await request("fs/createDirectory", { path: attachmentProbeRoot, recursive: true });
  await request("fs/writeFile", { path: attachmentProbePath, dataBase64: attachmentProbeData });
  const readBack = await request("fs/readFile", { path: attachmentProbePath });
  if (readBack.dataBase64 !== attachmentProbeData) throw new Error("Attachment round-trip did not match.");

  const started = await request("thread/start", {
    cwd: process.cwd(),
    approvalsReviewer: "user",
    ephemeral: true,
    sessionStartSource: "startup",
    threadSource: "hearth_remote_probe",
  });
  const released = await request("thread/unsubscribe", { threadId: started.thread.id });
  if (released.status !== "unsubscribed") {
    throw new Error(`Unexpected unsubscribe status: ${released.status}`);
  }
  console.log(`Lifecycle and attachment probe passed: ${released.status}`);
} finally {
  if (attachmentProbeRoot && socket.readyState === WebSocket.OPEN) {
    try { await request("fs/remove", { path: attachmentProbeRoot, recursive: true, force: true }); } catch { /* best effort */ }
  }
  socket.terminate();
}

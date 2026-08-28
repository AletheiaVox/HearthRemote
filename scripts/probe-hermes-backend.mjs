import WebSocket from "ws";

const endpoint = process.env.HEARTH_HERMES_ENDPOINT || "ws://127.0.0.1:4510/api/ws";
const token = process.env.HEARTH_HERMES_TOKEN;

if (!token) {
  throw new Error("Set HEARTH_HERMES_TOKEN before running this probe.");
}

const url = new URL(endpoint);
url.searchParams.set("token", token);

const socket = new WebSocket(url, {
  ...(process.env.HEARTH_HERMES_HOST_HEADER
    ? { headers: { Host: process.env.HEARTH_HERMES_HOST_HEADER } }
    : {}),
});
const pending = new Map();
const eventWaiters = new Set();
let nextId = 0;

function request(method, params = {}) {
  const id = `probe-${++nextId}`;
  socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}`));
    }, 30_000);

    pending.set(id, {
      resolve(value) {
        clearTimeout(timer);
        resolve(value);
      },
      reject(error) {
        clearTimeout(timer);
        reject(error);
      },
    });
  });
}

socket.on("message", (raw) => {
  const frame = JSON.parse(raw.toString());
  if (frame.method === "event" && frame.params?.type) {
    for (const waiter of eventWaiters) waiter(frame.params);
    return;
  }
  if (frame.id == null) return;
  const call = pending.get(frame.id);
  if (!call) return;
  pending.delete(frame.id);
  if (frame.error) call.reject(new Error(frame.error.message || "Hermes RPC failed"));
  else call.resolve(frame.result);
});

function waitForEvent(predicate, timeoutMs = 240_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      eventWaiters.delete(onEvent);
      reject(new Error("Timed out waiting for a Hermes stream event"));
    }, timeoutMs);
    const onEvent = (event) => {
      if (!predicate(event)) return;
      clearTimeout(timer);
      eventWaiters.delete(onEvent);
      resolve(event);
    };
    eventWaiters.add(onEvent);
  });
}

await new Promise((resolve, reject) => {
  socket.once("open", resolve);
  socket.once("error", reject);
});

try {
  const sessions = await request("session.list", { limit: 5 });
  const models = await request("model.options", { explicit_only: true });

  if (!Array.isArray(sessions.sessions)) throw new Error("session.list returned an invalid shape");
  if (!Array.isArray(models.providers)) throw new Error("model.options returned an invalid shape");

  const selectableModels = models.providers.reduce(
    (count, provider) => count + (Array.isArray(provider.models) ? provider.models.length : 0),
    0,
  );
  console.log(
    `Hermes backend probe passed: ${sessions.sessions.length} live runtimes, ${selectableModels} selectable models.`,
  );

  if (process.env.HEARTH_HERMES_TURN_PROBE === "1") {
    const created = await request("session.create", {
      close_on_disconnect: true,
      cwd: process.cwd(),
      hidden: true,
      model: "local-model",
      provider: "jonathan-local",
      source: "desktop",
    });
    if (!created.session_id || !created.stored_session_id) throw new Error("session.create returned no identity");
    const marker = "HEARTH-HERMES-LIVE-OK";
    const staged = await request("file.attach", {
      session_id: created.session_id,
      name: "hearth-live-probe.txt",
      data_url: `data:text/plain;base64,${Buffer.from(marker).toString("base64")}`,
    });
    const completed = waitForEvent(
      (event) => event.type === "message.complete" && event.session_id === created.session_id,
    );
    await request("prompt.submit", {
      session_id: created.session_id,
      text: `Read ${staged.ref_text} and reply with exactly the text in that file.`,
    });
    const event = await completed;
    const reply = String(event.payload?.text || event.payload?.rendered || "");
    if (!reply.includes(marker)) throw new Error(`Unexpected live Hermes reply: ${reply}`);
    console.log("Hermes local-model streaming and remote file attachment probe passed.");
  }
} finally {
  socket.terminate();
}

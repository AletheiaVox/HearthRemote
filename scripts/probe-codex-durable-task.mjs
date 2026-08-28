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
const commandItems = [];
let nextId = 1;
let threadId;
let turnCompletion;

await new Promise((resolve, reject) => {
  socket.once("open", resolve);
  socket.once("error", reject);
});

function respond(id, result) {
  socket.send(JSON.stringify({ id, result }));
}

function request(method, params = {}, timeoutMs = 60_000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

socket.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.id !== undefined && ("result" in message || "error" in message)) {
    const inflight = pending.get(message.id);
    if (!inflight) return;
    clearTimeout(inflight.timer);
    pending.delete(message.id);
    if (message.error) inflight.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
    else inflight.resolve(message.result);
    return;
  }

  if (message.id !== undefined && typeof message.method === "string") {
    if (message.method === "item/commandExecution/requestApproval" || message.method === "item/fileChange/requestApproval") {
      respond(message.id, { decision: "accept" });
    } else if (message.method === "item/permissions/requestApproval") {
      respond(message.id, { permissions: message.params?.permissions ?? {}, scope: "turn" });
    } else {
      socket.send(JSON.stringify({ id: message.id, error: { code: -32601, message: `Probe cannot answer ${message.method}` } }));
    }
    return;
  }

  if (message.method === "item/completed" && message.params?.threadId === threadId) {
    const item = message.params.item;
    if (item?.type === "commandExecution") commandItems.push(item);
  }
  if (message.method === "turn/completed" && message.params?.threadId === threadId) {
    turnCompletion?.resolve(message.params.turn);
  }
  if (message.method === "error" && message.params?.threadId === threadId) {
    turnCompletion?.reject(new Error(message.params?.error?.message ?? message.params?.message ?? "Codex reported an error."));
  }
});

async function waitForTurn(timeoutMs = 240_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The durable task turn did not finish within four minutes.")), timeoutMs);
    turnCompletion = {
      resolve: (turn) => { clearTimeout(timer); resolve(turn); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    };
  });
}

try {
  const initialized = await request("initialize", {
    clientInfo: { name: "hearth_remote_probe", title: "Hearth Remote durable task probe", version: "0.2.1" },
    capabilities: { experimentalApi: true },
  });
  socket.send(JSON.stringify({ method: "initialized" }));

  const started = await request("thread/start", {
    cwd: process.cwd(),
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandbox: "danger-full-access",
    ephemeral: false,
    serviceName: "hearth_remote_probe",
    sessionStartSource: "startup",
    threadSource: "hearth_remote_probe",
  });
  threadId = started.thread.id;

  const completed = waitForTurn();
  await request("turn/start", {
    threadId,
    clientUserMessageId: randomUUID(),
    input: [{
      type: "text",
      text: "This is a disposable transport test. Use the local command runner to execute `cmd.exe /d /c echo HEARTH_CODE_MODE_OK`, then report the output. Do not edit files or do any other work.",
      text_elements: [],
    }],
  });
  const turn = await completed;
  if (turn?.status !== "completed") throw new Error(`The durable task ended with status ${turn?.status ?? "unknown"}.`);

  const successfulCommand = commandItems.find((item) =>
    item.status === "completed" && String(item.aggregatedOutput ?? "").includes("HEARTH_CODE_MODE_OK"));
  if (!successfulCommand) {
    throw new Error(`The model turn finished, but its local command runner did not return HEARTH_CODE_MODE_OK. Items: ${JSON.stringify(commandItems)}`);
  }

  const readBack = await request("thread/read", { threadId, includeTurns: true });
  if (!Array.isArray(readBack.thread?.turns) || readBack.thread.turns.length === 0) {
    throw new Error("The durable task could not be read back with its completed turn.");
  }
  const listed = await request("thread/list", {
    limit: 100,
    sortKey: "recency_at",
    sortDirection: "desc",
    archived: false,
  });
  if (!listed.data?.some((thread) => thread.id === threadId)) {
    throw new Error("The completed durable task was absent from thread/list.");
  }

  console.log(`Durable task and Code Mode probe passed with ${initialized.userAgent}: ${threadId}`);
} finally {
  if (threadId && socket.readyState === WebSocket.OPEN) {
    try { await request("thread/unsubscribe", { threadId }, 10_000); } catch { /* best effort */ }
    try { await request("thread/delete", { threadId }, 15_000); } catch { /* keep diagnostic evidence if cleanup fails */ }
  }
  socket.terminate();
}

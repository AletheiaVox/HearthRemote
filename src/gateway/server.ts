import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import type { AppSnapshot, ApprovalOption, PromptAttachment, ProviderId } from "../shared/contracts";
import { ProviderService } from "../main/provider-service";
import { GatewayAuthStore } from "./auth-store";
import { GatewayConfig } from "./config";
import { handoffModeArg, isAllowedBrowserOrigin } from "./request-validation";

const host = "127.0.0.1";
const port = Number(process.env.HEARTH_GATEWAY_PORT || 4520);
const staticRoot = resolve(
  process.env.HEARTH_GATEWAY_STATIC_ROOT
    || join(fileURLToPath(new URL(".", import.meta.url)), "..", "web"),
);
const authRoot = process.env.HEARTH_GATEWAY_AUTH_ROOT
  || join(homedir(), ".hearth-remote", "host", "hearth-gateway");
const publicOrigin = process.env.HEARTH_GATEWAY_PUBLIC_ORIGIN?.replace(/\/$/, "");
const sessionCookie = "hearth_session";
const disconnectGraceMs = 90_000;

const config = new GatewayConfig();
const service = new ProviderService(config);
const auth = new GatewayAuthStore(authRoot);
await Promise.all([service.initialize(), auth.initialize()]);
const hostName = config.publicSettings().hostName;

const attempts = new Map<string, { count: number; resetAt: number }>();
const sockets = new Set<WebSocket>();
let disconnectTimer: ReturnType<typeof setTimeout> | undefined;

const server = createServer((request, response) => {
  void handleHttp(request, response).catch((error) => {
    console.error("Hearth Gateway request failed:", error);
    if (!response.headersSent) json(response, 500, { error: "Hearth Gateway could not complete that request." });
    else response.destroy();
  });
});
const webSockets = new WebSocketServer({ noServer: true, maxPayload: 48 * 1024 * 1024 });

server.on("upgrade", (request, socket, head) => {
  void authenticateRequest(request).then((device) => {
    if (!device || !validOrigin(request)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const url = new URL(request.url || "/", "http://localhost");
    if (url.pathname !== "/api/client") {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    webSockets.handleUpgrade(request, socket, head, (webSocket) => webSockets.emit("connection", webSocket, request));
  }).catch(() => socket.destroy());
});

webSockets.on("connection", (socket) => {
  sockets.add(socket);
  if (disconnectTimer) clearTimeout(disconnectTimer);
  disconnectTimer = undefined;
  send(socket, { type: "snapshot", snapshot: webSnapshot() });

  socket.on("message", (raw) => {
    void handleClientMessage(socket, raw.toString()).catch((error) => {
      console.error("Hearth Gateway client message failed:", error);
    });
  });
  socket.on("close", () => {
    sockets.delete(socket);
    if (sockets.size === 0) scheduleIdleDisconnect();
  });
});

service.onSnapshot(() => broadcast({ type: "snapshot", snapshot: webSnapshot() }));

server.listen(port, host, () => {
  const pairing = auth.pairingInfo();
  console.log(`HEARTH_GATEWAY_READY port=${port}`);
  console.log(`HEARTH_PAIRING_READY expires=${pairing.expiresAt}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void service.disconnect().catch(() => undefined).finally(() => server.close(() => process.exit(0)));
  });
}

async function handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
  securityHeaders(request, response);
  const url = new URL(request.url || "/", "http://localhost");

  if (url.pathname === "/api/bootstrap" && request.method === "GET") {
    const device = await authenticateRequest(request);
    json(response, 200, { paired: Boolean(device), label: device?.label, host: hostName });
    return;
  }

  if (url.pathname === "/api/health" && request.method === "GET") {
    json(response, 200, { status: "ready" });
    return;
  }

  if (url.pathname === "/api/auth/pair" && request.method === "POST") {
    if (!validOrigin(request)) return json(response, 403, { error: "This pairing request came from an unexpected page." });
    const remote = clientAddress(request);
    if (!allowPairAttempt(remote)) return json(response, 429, { error: "Too many pairing attempts. Wait ten minutes and try again." });
    const body = await readJson<{ code?: unknown; label?: unknown }>(request, 16 * 1024);
    const code = typeof body.code === "string" ? body.code : "";
    const label = typeof body.label === "string" ? body.label : "My phone";
    const id = await auth.pair(code, label);
    if (!id) return json(response, 401, { error: "That pairing code is incorrect or has expired." });
    response.setHeader("Set-Cookie", cookieHeader(request, id, 90 * 24 * 60 * 60));
    json(response, 200, { paired: true });
    return;
  }

  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    if (!validOrigin(request)) return json(response, 403, { error: "Unexpected request origin." });
    const id = cookieValue(request, sessionCookie);
    await auth.revoke(id);
    response.setHeader("Set-Cookie", cookieHeader(request, "", 0));
    json(response, 200, { paired: false });
    return;
  }

  if (url.pathname === "/api/snapshot" && request.method === "GET") {
    const device = await authenticateRequest(request);
    if (!device) return json(response, 401, { error: `Pair this device with ${hostName} first.` });
    json(response, 200, webSnapshot());
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    json(response, 404, { error: "Unknown Hearth Gateway endpoint." });
    return;
  }

  await serveStatic(url.pathname, request, response);
}

async function handleClientMessage(socket: WebSocket, raw: string): Promise<void> {
  let frame: { id?: unknown; method?: unknown; params?: unknown };
  try { frame = JSON.parse(raw) as typeof frame; }
  catch { return send(socket, { error: { message: "Invalid JSON request." } }); }
  const id = typeof frame.id === "number" || typeof frame.id === "string" ? frame.id : undefined;
  if (id === undefined || typeof frame.method !== "string") return;
  try {
    const result = await invoke(frame.method, frame.params);
    send(socket, { id, result: result ?? null });
  } catch (error) {
    send(socket, { id, error: { message: error instanceof Error ? error.message : String(error) } });
  }
}

async function invoke(method: string, params: unknown): Promise<unknown> {
  const args = Array.isArray(params) ? params : [];
  switch (method) {
    case "connect": return service.connect();
    case "disconnect": return service.disconnect();
    case "refreshSessions": return service.refreshSessions(stringArg(args[0]));
    case "openSession": return service.openSession(requiredString(args[0], "session ID"));
    case "newSession": return service.newSession(stringArg(args[0]), stringArg(args[1]));
    case "sendMessage": return service.sendMessage(requiredString(args[0], "message", true), attachmentsArg(args[1]));
    case "interrupt": return service.interrupt();
    case "resolveApproval": return service.resolveApproval(idArg(args[0]), requiredString(args[1], "approval option") as ApprovalOption["id"]);
    case "answerQuestion": return service.answerQuestion(idArg(args[0]), answersArg(args[1]));
    case "runHandoff": return service.runHandoff(handoffModeArg(args[0]));
    case "selectProvider": return service.selectProvider(requiredString(args[0], "provider") as ProviderId);
    case "selectModel": return service.selectModel(requiredString(args[0], "model provider"), requiredString(args[1], "model"));
    case "saveSettings": throw new Error(`Connection settings are managed on ${hostName}.`);
    default: throw new Error(`Unsupported Hearth action: ${method}`);
  }
}

function webSnapshot(): AppSnapshot {
  return { ...service.snapshot(), webClient: { paired: true, host: hostName } };
}

function broadcast(frame: unknown): void {
  for (const socket of sockets) send(socket, frame);
}

function send(socket: WebSocket, frame: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
}

function scheduleIdleDisconnect(): void {
  if (disconnectTimer) clearTimeout(disconnectTimer);
  disconnectTimer = setTimeout(() => {
    disconnectTimer = undefined;
    if (sockets.size === 0) void service.disconnect().catch(() => undefined);
  }, disconnectGraceMs);
}

async function authenticateRequest(request: IncomingMessage) {
  return auth.authenticate(cookieValue(request, sessionCookie));
}

function validOrigin(request: IncomingMessage): boolean {
  return isAllowedBrowserOrigin(request.headers.origin, publicOrigin, port);
}

function allowPairAttempt(key: string): boolean {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + 10 * 60 * 1000 });
    return true;
  }
  current.count += 1;
  return current.count <= 8;
}

function clientAddress(request: IncomingMessage): string {
  // The gateway binds to loopback, so the OS-level peer is the only address we
  // trust for throttling. Forwarded headers are client-controlled at this seam.
  return request.socket.remoteAddress || "unknown";
}

function cookieValue(request: IncomingMessage, name: string): string | undefined {
  for (const part of (request.headers.cookie || "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

function cookieHeader(request: IncomingMessage, value: string, maxAge: number): string {
  const secure = (request.socket as typeof request.socket & { encrypted?: boolean }).encrypted === true
    || headerValue(request.headers["x-forwarded-proto"]) === "https"
    || publicOrigin?.startsWith("https://");
  return `${sessionCookie}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

async function readJson<T>(request: IncomingMessage, limit: number): Promise<T> {
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    received += buffer.length;
    if (received > limit) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

async function serveStatic(pathname: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") return json(response, 405, { error: "Method not allowed." });
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return json(response, 400, { error: "Invalid path." }); }
  const requested = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  let path = resolve(staticRoot, normalize(requested));
  if (path !== staticRoot && !path.startsWith(`${staticRoot}${sep}`)) return json(response, 403, { error: "Invalid path." });
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error("not a file");
  } catch {
    path = join(staticRoot, "index.html");
  }
  const content = await readFile(path);
  response.statusCode = 200;
  response.setHeader("Content-Type", mimeType(path));
  response.setHeader("Cache-Control", path.endsWith("index.html") || path.endsWith("sw.js") ? "no-cache" : path.includes(`${sep}assets${sep}`) ? "public, max-age=31536000, immutable" : "public, max-age=3600");
  response.setHeader("Content-Length", content.length);
  if (request.method === "HEAD") response.end(); else response.end(content);
}

function securityHeaders(request: IncomingMessage, response: ServerResponse): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  if (headerValue(request.headers["x-forwarded-proto"]) === "https") response.setHeader("Strict-Transport-Security", "max-age=31536000");
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value));
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Length", body.length);
  response.end(body);
}

function mimeType(path: string): string {
  return ({
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json", ".png": "image/png",
    ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2",
  } as Record<string, string>)[extname(path).toLowerCase()] || "application/octet-stream";
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function stringArg(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function requiredString(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) throw new Error(`Missing ${label}.`);
  return value;
}
function idArg(value: unknown): number | string {
  if (typeof value !== "number" && typeof value !== "string") throw new Error("Missing request ID.");
  return value;
}
function attachmentsArg(value: unknown): PromptAttachment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Attachments must be an array.");
  return value as PromptAttachment[];
}
function answersArg(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Answers must be an object.");
  return value as Record<string, string[]>;
}

import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { createHermesProxy } from "./proxy";

const servers: Server[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("Hermes loopback bridge", () => {
  it("requires the capability token and rewrites proxy-facing authorities", async () => {
    let backendHost = "";
    let backendOrigin = "";
    const backend = createServer((request, response) => {
      backendHost = request.headers.host ?? "";
      backendOrigin = request.headers.origin ?? "";
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"ok":true}');
    });
    servers.push(backend);
    const backendPort = await listen(backend);

    const proxy = createHermesProxy({ backendHost: "127.0.0.1", backendPort, token: "a".repeat(48) });
    servers.push(proxy);
    const proxyPort = await listen(proxy);

    const denied = await fetch(`http://127.0.0.1:${proxyPort}/api/private`);
    expect(denied.status).toBe(401);

    const allowed = await fetch(`http://127.0.0.1:${proxyPort}/api/private`, {
      headers: { Authorization: `Bearer ${"a".repeat(48)}`, Host: "remote.example:4510", Origin: "https://remote.example:4510" },
    });
    expect(allowed.status).toBe(200);
    expect(backendHost).toBe(`127.0.0.1:${backendPort}`);
    expect(backendOrigin).toBe(`http://127.0.0.1:${backendPort}`);

    const sessionHeader = await fetch(`http://127.0.0.1:${proxyPort}/api/private`, {
      headers: { "X-Hermes-Session-Token": "a".repeat(48) },
    });
    expect(sessionHeader.status).toBe(200);
  });

  it("forwards authenticated WebSocket upgrades with a loopback Host", async () => {
    let backendHost = "";
    const backend = createServer();
    const webSockets = new WebSocketServer({ noServer: true });
    backend.on("upgrade", (request, socket, head) => {
      backendHost = request.headers.host ?? "";
      webSockets.handleUpgrade(request, socket, head, (webSocket) => webSockets.emit("connection", webSocket, request));
    });
    webSockets.on("connection", (socket) => socket.send("ready"));
    servers.push(backend);
    const backendPort = await listen(backend);

    const token = "b".repeat(48);
    const proxy = createHermesProxy({ backendHost: "127.0.0.1", backendPort, token });
    servers.push(proxy);
    const proxyPort = await listen(proxy);

    const socket = new WebSocket(`ws://127.0.0.1:${proxyPort}/api/ws`, { headers: { Authorization: `Bearer ${token}`, Host: "remote.example:4510" } });
    sockets.push(socket);
    const message = await new Promise<string>((resolve, reject) => {
      socket.once("message", (data) => resolve(data.toString()));
      socket.once("error", reject);
    });
    expect(message).toBe("ready");
    expect(backendHost).toBe(`127.0.0.1:${backendPort}`);
    webSockets.close();
  });
});

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind a TCP port.");
  return address.port;
}

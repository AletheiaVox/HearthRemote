import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { JsonRpcWebSocket } from "./json-rpc-ws";

const servers: WebSocketServer[] = [];
const clients: JsonRpcWebSocket[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("JSON-RPC WebSocket transport", () => {
  it("sends the bearer token and handles requests, notifications, and server prompts", async () => {
    const server = new WebSocketServer({ port: 0 });
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("No test port.");

    let authorization = "";
    server.on("connection", (socket, request) => {
      authorization = request.headers.authorization ?? "";
      socket.on("message", (raw) => {
        const message = JSON.parse(raw.toString()) as { id?: number; method?: string };
        if (message.method === "echo" && message.id) {
          socket.send(JSON.stringify({ id: message.id, result: { ok: true } }));
          socket.send(JSON.stringify({ method: "thread/updated", params: { threadId: "t1" } }));
          socket.send(JSON.stringify({ id: "approval-1", method: "item/permissions/requestApproval", params: {} }));
        }
      });
    });

    const client = new JsonRpcWebSocket();
    clients.push(client);
    const notifications: string[] = [];
    const requests: Array<number | string> = [];
    client.onNotification((message) => notifications.push(message.method));
    client.onServerRequest((message) => requests.push(message.id));
    await client.connect(`ws://127.0.0.1:${address.port}`, "secret-test-token");
    await expect(client.request("echo", { hello: true })).resolves.toEqual({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(authorization).toBe("Bearer secret-test-token");
    expect(notifications).toEqual(["thread/updated"]);
    expect(requests).toEqual(["approval-1"]);
  });
});

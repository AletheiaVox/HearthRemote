import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import type { ConfigStore } from "../config-store";
import type { CodexThread } from "./codex-types";
import { CodexAdapter } from "./codex-adapter";

const servers: WebSocketServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function testThread(): CodexThread {
  return {
    id: "thread-owned-remotely",
    sessionId: "session-1",
    preview: "Lifecycle test",
    modelProvider: "openai",
    createdAt: 100,
    updatedAt: 100,
    recencyAt: 100,
    status: { type: "idle" },
    cwd: "C:\\work",
    cliVersion: "codex-cli test",
    name: "Lifecycle test",
    parentThreadId: null,
    turns: [],
  };
}

describe("Codex writer lifecycle", () => {
  it("explicitly unsubscribes a resumed task before disconnecting", async () => {
    const server = new WebSocketServer({ port: 0 });
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("No test port.");

    const methods: string[] = [];
    const requests: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const unsubscribedThreadIds: string[] = [];
    const thread = testThread();
    const startedThread = { ...thread, id: "thread-new-project", cwd: "C:\\chosen-project", name: null };
    server.on("connection", (socket) => {
      socket.on("message", (raw) => {
        const message = JSON.parse(raw.toString()) as { id?: number; method: string; params?: Record<string, unknown> };
        methods.push(message.method);
        requests.push(message);
        if (message.id === undefined) return;

        let result: unknown;
        switch (message.method) {
          case "initialize":
            result = { userAgent: "codex-cli test" };
            break;
          case "thread/list":
            result = { data: [thread], nextCursor: null };
            break;
          case "thread/loaded/list":
            result = { data: ["thread-stale-from-prior-client"], nextCursor: null };
            break;
          case "command/exec":
            result = Array.isArray(message.params?.command) && message.params.command.some((part) => String(part).includes("recycle-codex-listener.ps1"))
              ? { exitCode: 0, stderr: "", stdout: JSON.stringify({ scheduled: true }) }
              : {
                  exitCode: 0,
                  stderr: "",
                  stdout: JSON.stringify({
                    host: "HEARTHHOST",
                    desktopAppRunning: false,
                    desktopServerRunning: false,
                    remoteListenerRunning: true,
                    readyForRemote: true,
                  }),
                };
            break;
          case "thread/read":
            result = { thread };
            break;
          case "fs/getMetadata":
            result = { isDirectory: true, isFile: false, isSymlink: false, createdAtMs: 0, modifiedAtMs: 0 };
            break;
          case "thread/start":
            result = { thread: startedThread, model: "test", modelProvider: "openai", cwd: startedThread.cwd };
            break;
          case "thread/resume":
            result = { thread, model: "test", modelProvider: "openai", cwd: thread.cwd };
            break;
          case "turn/start":
            result = { turn: { id: "turn-1", items: [], status: "inProgress", startedAt: 100, completedAt: null } };
            break;
          case "fs/createDirectory":
          case "fs/writeFile":
            result = {};
            break;
          case "thread/unsubscribe":
            if (typeof message.params?.threadId === "string") unsubscribedThreadIds.push(message.params.threadId);
            result = { status: "unsubscribed" };
            break;
          default:
            socket.send(JSON.stringify({ id: message.id, error: { code: -32601, message: message.method } }));
            return;
        }
        socket.send(JSON.stringify({ id: message.id, result }));
        if (message.method === "turn/start") {
          socket.send(JSON.stringify({
            method: "turn/completed",
            params: { threadId: thread.id, turn: { id: "turn-1", status: "completed", items: [] } },
          }));
        }
      });
    });

    const publicSettings = {
      endpoint: `ws://127.0.0.1:${address.port}`,
      defaultCwd: "C:\\work",
      handoffScriptPath: "C:\\handoff.ps1",
      hasStoredToken: true,
    };
    const config = {
      getToken: () => "test-token-that-is-long-enough-for-the-transport-123456",
      publicSettings: () => publicSettings,
      save: async () => undefined,
    } as unknown as ConfigStore;

    const adapter = new CodexAdapter(config);
    await adapter.connect();
    await adapter.newSession("C:\\chosen-project");
    await adapter.openSession(thread.id);
    const imageBytes = Buffer.from("tiny-image");
    await adapter.sendMessage("Take ownership", [{
      id: "attachment-1",
      name: "screen shot.png",
      mimeType: "image/png",
      size: imageBytes.byteLength,
      dataBase64: imageBytes.toString("base64"),
    }]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await adapter.disconnect();

    expect(methods).toContain("thread/resume");
    expect(methods).toContain("thread/unsubscribe");
    expect(methods.lastIndexOf("thread/unsubscribe")).toBeGreaterThan(methods.indexOf("thread/resume"));
    expect(unsubscribedThreadIds).toContain(thread.id);
    expect(unsubscribedThreadIds).toContain("thread-stale-from-prior-client");
    expect(methods).toContain("fs/createDirectory");
    expect(methods).toContain("fs/writeFile");
    const turnStart = requests.find(({ method }) => method === "turn/start");
    const input = turnStart?.params?.input as Array<Record<string, unknown>>;
    expect(input[0]?.text).toContain("screen shot.png");
    expect(input[0]?.text).toContain(".codex-remote-attachments");
    expect(input).toContainEqual(expect.objectContaining({ type: "localImage" }));
    const metadataRequest = requests.find(({ method }) => method === "fs/getMetadata");
    const threadStart = requests.find(({ method }) => method === "thread/start");
    expect(metadataRequest?.params?.path).toBe("C:\\chosen-project");
    expect(threadStart?.params?.cwd).toBe("C:\\chosen-project");
    expect(threadStart?.params?.ephemeral).toBe(false);
    expect(threadStart?.params?.serviceName).toBe("hearth_remote");
    expect(methods.indexOf("fs/getMetadata")).toBeLessThan(methods.indexOf("thread/start"));
    const recycleRequest = requests.find(({ method, params }) => method === "command/exec"
      && Array.isArray(params?.command)
      && params.command.some((part) => String(part).includes("recycle-codex-listener.ps1")));
    expect(recycleRequest).toBeDefined();
  });
});

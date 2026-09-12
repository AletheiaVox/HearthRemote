import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import type { ConfigStore } from "../config-store";
import { HermesAdapter } from "./hermes-adapter";

describe("HermesAdapter", () => {
  let server: WebSocketServer | undefined;
  let httpServer: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
    await new Promise<void>((resolve) => httpServer?.close(() => resolve()) ?? resolve());
  });

  it("uses the Hermes gateway for persisted sessions, history, models, attachments, and streaming", async () => {
    const restHosts: string[] = [];
    httpServer = createServer((request, response) => {
      restHosts.push(request.headers.host ?? "");
      response.setHeader("Content-Type", "application/json");
      if (request.url?.startsWith("/api/profiles/sessions?")) response.end(JSON.stringify({ sessions: [
        { id: "stored-1", profile: "qwen", title: "Saved title", preview: "Saved preview", cwd: "C:\\saved", started_at: 1, last_active: 2, message_count: 2 },
        { id: "stored-2", profile: "resident", title: null, preview: "@folder:C:\\Users\\me\\Project  Recognizable first message", cwd: "C:\\Project", started_at: 1, last_active: 1, message_count: 1 },
      ] }));
      else if (request.url === "/api/sessions/stored-1/messages?profile=qwen") response.end(JSON.stringify({ session_id: "stored-1", messages: [
        { role: "user", content: "saved question" }, { role: "assistant", content: "saved answer" },
      ] }));
      else if (request.url === "/api/sessions/stored-new/messages?profile=resident") response.end(JSON.stringify({ session_id: "stored-new", messages: [] }));
      else if (request.url?.startsWith("/api/model/options")) response.end(JSON.stringify({ providers: [
        { slug: "lmstudio", name: "LM Studio", models: ["local-model"] },
      ] }));
      else { response.statusCode = 404; response.end(JSON.stringify({ detail: "not found" })); }
    });
    server = new WebSocketServer({ server: httpServer });
    httpServer.listen(0);
    await new Promise<void>((resolve) => httpServer!.once("listening", resolve));
    const address = httpServer.address();
    if (typeof address === "string" || !address) throw new Error("test gateway did not bind");

    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    server.on("connection", (socket) => wireGateway(socket, calls));

    const config = {
      getToken: () => "x".repeat(64),
      publicSettings: () => ({
        endpoint: "ws://127.0.0.1:4500",
        hermesEndpoint: `ws://127.0.0.1:${address.port}/api/ws`,
        defaultCwd: "C:\\project",
        handoffScriptPath: "C:\\handoff.ps1",
        hasStoredToken: true,
      }),
      save: async () => undefined,
    } as unknown as ConfigStore;

    const adapter = new HermesAdapter(config);
    let snapshotEmissions = 0;
    adapter.onSnapshot(() => { snapshotEmissions += 1; });
    await adapter.connect();

    const emissionsBeforeGlobalEvent = snapshotEmissions;
    for (const socket of server.clients) {
      socket.send(JSON.stringify({ method: "event", params: { type: "sessions.changed", session_id: "", payload: {} } }));
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(snapshotEmissions).toBe(emissionsBeforeGlobalEvent);

    expect(adapter.snapshot().sessions[0]).toMatchObject({
      id: "qwen::stored-1", profile: "qwen", title: "Saved title", cwd: "C:\\saved",
    });
    expect(adapter.snapshot().sessions[1]).toMatchObject({ id: "resident::stored-2", profile: "resident" });
    expect(adapter.snapshot().sessions[1]?.title).toBe("Recognizable first message");
    expect(adapter.snapshot().models).toEqual([
      { provider: "lmstudio", model: "local-model", label: "LM Studio · local-model" },
    ]);
    expect(restHosts.every((host) => host === `127.0.0.1:${address.port}`)).toBe(true);

    await adapter.openSession("qwen::stored-1");
    expect(adapter.snapshot().timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "user", text: "saved question" }),
      expect.objectContaining({ kind: "assistant", text: "saved answer" }),
    ]));

    await adapter.newSession("C:\\project", "resident");
    await adapter.sendMessage("read this", [{
      id: "a", name: "note.txt", mimeType: "text/plain", size: 5, dataBase64: "aGVsbG8=",
    }]);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const snapshot = adapter.snapshot();
    expect(snapshot.connection).toBe("ready");
    expect(snapshot.activeCwd).toBe("C:\\project");
    expect(snapshot.timeline.some((item) => item.kind === "assistant" && item.text === "hello from Hermes")).toBe(true);
    expect(snapshot.timeline.some((item) => item.kind === "reasoning" && item.text === "hello from Hermes")).toBe(false);
    expect(calls.some((call) => call.method === "file.attach")).toBe(true);
    expect(calls.find((call) => call.method === "prompt.submit")?.params.text).toContain("@file:note.txt");
    expect(calls.find((call) => call.method === "session.resume")?.params).toMatchObject({ profile: "qwen", session_id: "stored-1" });
    expect(calls.find((call) => call.method === "session.resume")?.params).not.toHaveProperty("close_on_disconnect");
    expect(calls.find((call) => call.method === "session.create")?.params).toMatchObject({ profile: "resident", cwd: "C:\\project" });
    expect(calls.find((call) => call.method === "session.create")?.params).not.toHaveProperty("close_on_disconnect");
    expect(adapter.snapshot().activeProfile).toBe("resident");
    expect(adapter.snapshot().hermesProfiles?.map(({ id }) => id)).toEqual(["default", "resident", "local"]);

    await adapter.selectModel("lmstudio", "other-model");
    expect(calls.find((call) => call.method === "config.set")?.params.value).toContain("other-model");

    const resumeCount = calls.filter((call) => call.method === "session.resume").length;
    for (const socket of server.clients) socket.close(1012, "temporary interruption");
    await waitFor(() => adapter.snapshot().connection === "disconnected");
    await waitFor(() => adapter.snapshot().connection === "ready"
      && calls.filter((call) => call.method === "session.resume").length > resumeCount, 5_000);

    expect(adapter.snapshot()).toMatchObject({
      activeSessionId: "resident::stored-new",
      activeProfile: "resident",
      currentModel: "local-model",
      currentModelProvider: "lmstudio",
    });
    await adapter.sendMessage("after reconnect");
    expect(calls.filter((call) => call.method === "prompt.submit").at(-1)?.params).toMatchObject({
      session_id: "runtime-resumed-stored-new",
      text: "after reconnect",
    });
    expect(adapter.snapshot().timeline.filter((item) => item.kind === "assistant" && item.text === "hello from Hermes")).toHaveLength(1);
    expect(adapter.snapshot().timeline.some((item) => item.kind === "reasoning" && item.text === "hello from Hermes")).toBe(false);
    await adapter.disconnect();
  });
});

function wireGateway(socket: WebSocket, calls: Array<{ method: string; params: Record<string, unknown> }>): void {
  socket.on("message", (raw) => {
    const frame = JSON.parse(raw.toString()) as { id: number; method: string; params: Record<string, unknown> };
    calls.push({ method: frame.method, params: frame.params });
    const respond = (result: unknown): void => socket.send(JSON.stringify({ id: frame.id, result }));
    if (frame.method === "profiles.list") respond({ profiles: [
      { name: "default", is_default: true }, { name: "resident", model: "local-model", provider: "lmstudio" }, { name: "local", model: "local-model", provider: "lmstudio" },
    ] });
    else if (frame.method === "model.options") respond({ model: "local-model", provider: "lmstudio", providers: [] });
    else if (frame.method === "session.resume") {
      const storedId = String(frame.params.session_id);
      const profile = String(frame.params.profile);
      respond({
        session_id: `runtime-resumed-${storedId}`,
        resumed: storedId,
        messages: [],
        info: {
          cwd: storedId === "stored-1" ? "C:\\saved" : "C:\\project",
          model: "local-model",
          provider: "lmstudio",
          profile_name: profile,
        },
      });
    }
    else if (frame.method === "session.create") respond({ session_id: "runtime-1", stored_session_id: "stored-new", messages: [], info: { cwd: "C:\\project", model: "local-model", provider: "lmstudio", profile_name: "resident" } });
    else if (frame.method === "file.attach") respond({ ref_text: "@file:note.txt" });
    else if (frame.method === "prompt.submit") {
      respond({ status: "streaming" });
      if (frame.params.text !== "after reconnect") {
        socket.send(JSON.stringify({ method: "event", params: { type: "message.delta", session_id: frame.params.session_id, payload: { text: "hello from Hermes" } } }));
      }
      socket.send(JSON.stringify({ method: "event", params: { type: "reasoning.available", session_id: frame.params.session_id, payload: { text: "hello from Hermes" } } }));
      socket.send(JSON.stringify({ method: "event", params: { type: "message.complete", session_id: frame.params.session_id, payload: { text: "hello from Hermes" } } }));
    } else respond({ ok: true });
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for adapter state.");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

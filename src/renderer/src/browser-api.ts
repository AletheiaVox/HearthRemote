import type {
  AppSnapshot,
  ApprovalOption,
  HearthApi,
  HandoffMode,
  HandoffResult,
  PromptAttachment,
  ProviderId,
  SaveSettingsInput,
} from "../../shared/contracts";

interface PendingRequest {
  resolve(value: unknown): void;
  reject(reason: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export class BrowserHearthApi implements HearthApi {
  readonly clientKind = "web" as const;
  private socket?: WebSocket;
  private opening?: Promise<void>;
  private nextId = 0;
  private paired = false;
  private hostName = "your host";
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly listeners = new Set<(snapshot: AppSnapshot) => void>();

  async getSnapshot(): Promise<AppSnapshot> {
    const bootstrap = await fetchJson<{ paired: boolean; label?: string; host: string }>("/api/bootstrap");
    this.paired = bootstrap.paired;
    this.hostName = bootstrap.host;
    if (!bootstrap.paired) return anonymousSnapshot(bootstrap.host);
    const snapshot = await fetchJson<AppSnapshot>("/api/snapshot");
    snapshot.webClient = { paired: true, host: bootstrap.host, label: bootstrap.label };
    await this.openSocket();
    return snapshot;
  }

  connect(): Promise<void> { return this.request("connect"); }
  disconnect(): Promise<void> { return this.request("disconnect"); }
  refreshSessions(search?: string): Promise<void> { return this.request("refreshSessions", [search]); }
  openSession(sessionId: string): Promise<void> { return this.request("openSession", [sessionId]); }
  newSession(cwd?: string, profile?: string): Promise<void> { return this.request("newSession", [cwd, profile]); }
  sendMessage(text: string, attachments?: PromptAttachment[]): Promise<void> { return this.request("sendMessage", [text, attachments ?? []], 180_000); }
  interrupt(): Promise<void> { return this.request("interrupt"); }
  resolveApproval(requestId: number | string, optionId: ApprovalOption["id"]): Promise<void> { return this.request("resolveApproval", [requestId, optionId]); }
  answerQuestion(requestId: number | string, answers: Record<string, string[]>): Promise<void> { return this.request("answerQuestion", [requestId, answers]); }
  runHandoff(mode: HandoffMode): Promise<HandoffResult> { return this.request("runHandoff", [mode], 90_000); }
  saveSettings(input: SaveSettingsInput): Promise<void> { return this.request("saveSettings", [input]); }
  selectProvider(providerId: ProviderId): Promise<void> { return this.request("selectProvider", [providerId], 120_000); }
  selectModel(provider: string, model: string): Promise<void> { return this.request("selectModel", [provider, model], 120_000); }

  async pair(code: string, label: string): Promise<void> {
    await fetchJson("/api/auth/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, label }),
    });
    this.paired = true;
  }

  async logout(): Promise<void> {
    await fetchJson("/api/auth/logout", { method: "POST" });
    this.paired = false;
    this.socket?.close(1000, "logged out");
  }

  onSnapshot(callback: (snapshot: AppSnapshot) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private async request<T = void>(method: string, params: unknown[] = [], timeoutMs = 60_000): Promise<T> {
    if (!this.paired) throw new Error(`Pair this phone with ${this.hostName} first.`);
    await this.openSocket();
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error("Hearth Gateway is not connected.");
    const id = ++this.nextId;
    const result = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out.`));
      }, timeoutMs);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
    });
    socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  private async openSocket(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.opening) return this.opening;
    this.opening = new Promise<void>((resolve, reject) => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${window.location.host}/api/client`);
      const fail = (): void => reject(new Error("Could not connect to Hearth Gateway."));
      socket.addEventListener("error", fail, { once: true });
      socket.addEventListener("open", () => {
        socket.removeEventListener("error", fail);
        this.socket = socket;
        resolve();
      }, { once: true });
      socket.addEventListener("message", (event) => this.handleMessage(String(event.data)));
      socket.addEventListener("close", () => this.handleClose(socket));
    });
    try { await this.opening; } finally { this.opening = undefined; }
  }

  private handleMessage(raw: string): void {
    let frame: { id?: number; result?: unknown; error?: { message?: string }; type?: string; snapshot?: AppSnapshot };
    try { frame = JSON.parse(raw) as typeof frame; } catch { return; }
    if (frame.type === "snapshot" && frame.snapshot) {
      frame.snapshot.webClient = { paired: true, host: this.hostName };
      for (const listener of this.listeners) listener(frame.snapshot);
      return;
    }
    if (frame.id === undefined) return;
    const call = this.pending.get(frame.id);
    if (!call) return;
    clearTimeout(call.timer);
    this.pending.delete(frame.id);
    if (frame.error) call.reject(new Error(frame.error.message || "Hearth Gateway request failed."));
    else call.resolve(frame.result);
  }

  private handleClose(socket: WebSocket): void {
    if (this.socket !== socket) return;
    this.socket = undefined;
    for (const call of this.pending.values()) {
      clearTimeout(call.timer);
      call.reject(new Error(`The connection to ${this.hostName} closed.`));
    }
    this.pending.clear();
    if (this.paired && this.listeners.size > 0 && !this.reconnectTimer) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = undefined;
        void this.openSocket().catch(() => undefined);
      }, 2_000);
    }
  }
}

async function fetchJson<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...init });
  let body: unknown;
  try { body = await response.json(); } catch { body = undefined; }
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? body.error
      : `Hearth Gateway returned ${response.status}.`;
    throw new Error(message);
  }
  return body as T;
}

function anonymousSnapshot(host: string): AppSnapshot {
  return {
    provider: "codex",
    providers: [],
    connection: "disconnected",
    connectionMessage: `Waiting to pair with ${host}`,
    settings: { hostName: host, endpoint: "", hermesEndpoint: "", defaultCwd: "", handoffScriptPath: "", configured: true, hermesEnabled: false, hasStoredToken: false },
    sessions: [],
    timeline: [],
    busy: false,
    webClient: { paired: false, host },
  };
}

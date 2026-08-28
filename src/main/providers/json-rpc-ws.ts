import WebSocket from "ws";

export interface RpcNotification {
  method: string;
  params?: unknown;
}

export interface RpcServerRequest extends RpcNotification {
  id: number | string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

export class JsonRpcWebSocket {
  private socket: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private notificationListeners = new Set<(message: RpcNotification) => void>();
  private requestListeners = new Set<(message: RpcServerRequest) => void>();
  private closeListeners = new Set<(reason: string) => void>();

  async connect(endpoint: string, token: string, options: { hostHeader?: string } = {}): Promise<void> {
    await this.close();
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(endpoint, {
        headers: { Authorization: `Bearer ${token}`, ...(options.hostHeader ? { Host: options.hostHeader } : {}) },
        handshakeTimeout: 15_000,
      });
      this.socket = socket;
      const fail = (error: Error): void => reject(error);
      socket.once("error", fail);
      socket.once("open", () => {
        socket.off("error", fail);
        socket.on("error", (error) => this.failAll(error));
        socket.on("message", (data) => this.handleMessage(data.toString()));
        socket.on("close", (code, reason) => {
          const detail = reason.toString() || `connection closed (${code})`;
          this.failAll(new Error(detail));
          for (const listener of this.closeListeners) listener(detail);
        });
        resolve();
      });
    });
  }

  isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  async request<T>(method: string, params: unknown = {}, timeoutMs = 60_000): Promise<T> {
    if (!this.isOpen() || !this.socket) throw new Error("Not connected to the host.");
    const id = this.nextId++;
    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
    });
    this.socket.send(JSON.stringify({ method, id, params }));
    return promise;
  }

  notify(method: string, params?: unknown): void {
    if (!this.isOpen() || !this.socket) throw new Error("Not connected to the host.");
    const message = params === undefined ? { method } : { method, params };
    this.socket.send(JSON.stringify(message));
  }

  respond(id: number | string, result: unknown): void {
    if (!this.isOpen() || !this.socket) throw new Error("Not connected to the host.");
    this.socket.send(JSON.stringify({ id, result }));
  }

  respondError(id: number | string, code: number, message: string): void {
    if (!this.isOpen() || !this.socket) return;
    this.socket.send(JSON.stringify({ id, error: { code, message } }));
  }

  onNotification(listener: (message: RpcNotification) => void): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  onServerRequest(listener: (message: RpcServerRequest) => void): () => void {
    this.requestListeners.add(listener);
    return () => this.requestListeners.delete(listener);
  }

  onClose(listener: (reason: string) => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  async close(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    this.failAll(new Error("Connection closed."));
    if (socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        socket.terminate();
        resolve();
      }, 1_000);
      socket.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.close(1000, "client disconnect");
    });
  }

  private handleMessage(raw: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    if (message.id !== undefined && ("result" in message || "error" in message) && typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        const error = message.error as { message?: string; code?: number };
        pending.reject(new Error(error.message || `Protocol error ${error.code ?? "unknown"}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.id !== undefined && typeof message.method === "string") {
      for (const listener of this.requestListeners) listener(message as unknown as RpcServerRequest);
      return;
    }

    if (typeof message.method === "string") {
      for (const listener of this.notificationListeners) listener(message as unknown as RpcNotification);
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

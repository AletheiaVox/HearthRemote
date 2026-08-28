import { readFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import type { ConnectionSettings, SaveSettingsInput } from "../shared/contracts";
import type { AssistantConfig } from "../main/assistant-config";

export class GatewayConfig implements AssistantConfig {
  private token: string | null = null;
  private readonly settings: ConnectionSettings = {
    hostName: process.env.HEARTH_GATEWAY_HOST_NAME?.trim() || hostname(),
    endpoint: "ws://127.0.0.1:4500",
    hermesEndpoint: process.env.HEARTH_GATEWAY_HERMES_ENABLED === "1" ? "ws://127.0.0.1:4510/api/ws" : "",
    defaultCwd: process.env.HEARTH_GATEWAY_DEFAULT_CWD?.trim() || join(homedir(), "Documents"),
    handoffScriptPath: process.env.HEARTH_GATEWAY_HANDOFF_PATH?.trim() || join(homedir(), ".hearth-remote", "host", "handoff-desktop.ps1"),
    configured: true,
    hermesEnabled: process.env.HEARTH_GATEWAY_HERMES_ENABLED === "1",
    hasStoredToken: false,
  };

  async load(): Promise<void> {
    const tokenPath = process.env.HEARTH_GATEWAY_TOKEN_PATH
      || join(homedir(), ".hearth-remote", "host", "app-server-token");
    const token = (await readFile(tokenPath, "utf8")).trim();
    if (!/^[A-Za-z0-9_-]{40,256}$/.test(token)) {
      throw new Error(`Hearth Gateway found an invalid capability token at ${tokenPath}.`);
    }
    this.token = token;
    this.settings.hasStoredToken = true;
  }

  publicSettings(): ConnectionSettings {
    return { ...this.settings };
  }

  getToken(): string | null {
    return this.token;
  }

  async save(_input: SaveSettingsInput): Promise<void> {
    throw new Error("Connection settings can only be changed from Hearth Remote on Windows.");
  }
}

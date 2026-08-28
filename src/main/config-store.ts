import { app, safeStorage } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ConnectionSettings, SaveSettingsInput } from "../shared/contracts";
import type { AssistantConfig } from "./assistant-config";

interface StoredSettings {
  hostName: string;
  endpoint: string;
  hermesEndpoint: string;
  defaultCwd: string;
  handoffScriptPath: string;
  hermesEnabled: boolean;
}

const DEFAULT_SETTINGS: StoredSettings = {
  hostName: "",
  endpoint: "",
  hermesEndpoint: "",
  defaultCwd: "",
  handoffScriptPath: "",
  hermesEnabled: false,
};

export class ConfigStore implements AssistantConfig {
  private readonly settingsPath = join(app.getPath("userData"), "settings.json");
  private readonly secretPath = join(app.getPath("userData"), "codex-token.bin");
  private settings: StoredSettings = { ...DEFAULT_SETTINGS };
  private token: string | null = null;

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.settingsPath, "utf8")) as Partial<StoredSettings>;
      this.settings = {
        hostName: parsed.hostName?.trim() || hostFromEndpoint(parsed.endpoint) || DEFAULT_SETTINGS.hostName,
        endpoint: parsed.endpoint?.trim() || DEFAULT_SETTINGS.endpoint,
        hermesEndpoint: parsed.hermesEndpoint?.trim() || DEFAULT_SETTINGS.hermesEndpoint,
        defaultCwd: parsed.defaultCwd?.trim() || DEFAULT_SETTINGS.defaultCwd,
        handoffScriptPath: parsed.handoffScriptPath?.trim() || DEFAULT_SETTINGS.handoffScriptPath,
        hermesEnabled: parsed.hermesEnabled ?? Boolean(parsed.hermesEndpoint?.trim()),
      };
    } catch {
      this.settings = { ...DEFAULT_SETTINGS };
    }

    this.token = await this.readEncryptedToken();
    if (!this.token) {
      this.token = await this.importExistingClientToken();
      if (this.token) await this.writeEncryptedToken(this.token);
    }
  }

  publicSettings(): ConnectionSettings {
    return {
      ...this.settings,
      configured: Boolean(this.settings.endpoint && this.settings.defaultCwd && this.settings.handoffScriptPath && this.token),
      hasStoredToken: Boolean(this.token),
    };
  }

  getToken(): string | null {
    return this.token;
  }

  async save(input: SaveSettingsInput): Promise<void> {
    const hostName = input.hostName.trim();
    const endpoint = input.endpoint.trim();
    const hermesEndpoint = input.hermesEndpoint.trim();
    if (!hostName) throw new Error("Enter a friendly name for the host computer.");
    if (!/^wss:\/\//i.test(endpoint) && !/^ws:\/\/127\.0\.0\.1(?::\d+)?/i.test(endpoint)) {
      throw new Error("Use a secure wss:// address. Plain ws:// is allowed only for localhost.");
    }
    if (input.hermesEnabled && !/^wss:\/\//i.test(hermesEndpoint) && !/^ws:\/\/127\.0\.0\.1(?::\d+)?/i.test(hermesEndpoint)) {
      throw new Error("Use a secure wss:// Hermes address. Plain ws:// is allowed only for localhost.");
    }
    if (!input.defaultCwd.trim()) throw new Error("Enter the default project folder on the host computer.");
    if (!input.handoffScriptPath.trim()) throw new Error("Enter the handoff script path created by host setup.");

    this.settings = {
      hostName,
      endpoint,
      hermesEndpoint: input.hermesEnabled ? hermesEndpoint : "",
      defaultCwd: input.defaultCwd.trim(),
      handoffScriptPath: input.handoffScriptPath.trim(),
      hermesEnabled: input.hermesEnabled,
    };
    await this.atomicWrite(this.settingsPath, JSON.stringify(this.settings, null, 2));

    if (input.token !== undefined && input.token.trim()) {
      const token = input.token.trim();
      if (!/^[A-Za-z0-9_-]{40,256}$/.test(token)) {
        throw new Error("That token does not look like a valid Codex capability token.");
      }
      this.token = token;
      await this.writeEncryptedToken(token);
    }
  }

  private async readEncryptedToken(): Promise<string | null> {
    if (!safeStorage.isEncryptionAvailable() || !existsSync(this.secretPath)) return null;
    try {
      const encrypted = await readFile(this.secretPath);
      const token = safeStorage.decryptString(encrypted).trim();
      return /^[A-Za-z0-9_-]{40,256}$/.test(token) ? token : null;
    } catch {
      return null;
    }
  }

  private async writeEncryptedToken(token: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Windows credential encryption is unavailable; the token was not stored.");
    }
    const encrypted = safeStorage.encryptString(token);
    await mkdir(dirname(this.secretPath), { recursive: true });
    const temp = `${this.secretPath}.tmp`;
    await writeFile(temp, encrypted);
    await rename(temp, this.secretPath);
  }

  private async importExistingClientToken(): Promise<string | null> {
    const existingPath = join(homedir(), ".hearth-remote", "client-token");
    try {
      const token = (await readFile(existingPath, "utf8")).trim();
      return /^[A-Za-z0-9_-]{40,256}$/.test(token) ? token : null;
    } catch {
      return null;
    }
  }

  private async atomicWrite(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.tmp`;
    await writeFile(temp, content, "utf8");
    await rename(temp, path);
  }
}

function hostFromEndpoint(endpoint?: string): string {
  if (!endpoint) return "";
  try { return new URL(endpoint).hostname.split(".")[0] || ""; }
  catch { return ""; }
}

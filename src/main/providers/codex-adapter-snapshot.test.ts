import { describe, expect, it } from "vitest";
import type { ConnectionSettings, SaveSettingsInput } from "../../shared/contracts";
import type { AssistantConfig } from "../assistant-config";
import { CodexAdapter } from "./codex-adapter";

describe("Codex provider availability", () => {
  it.each([false, true])("keeps Codex available and follows the Hermes setting (%s)", (hermesEnabled) => {
    const adapter = new CodexAdapter(testConfig(hermesEnabled));
    const providers = adapter.snapshot().providers;
    expect(providers.find(({ id }) => id === "codex")?.available).toBe(true);
    expect(providers.find(({ id }) => id === "hermes")?.available).toBe(hermesEnabled);
  });
});

function testConfig(hermesEnabled: boolean): AssistantConfig {
  const settings: ConnectionSettings = {
    hostName: "HEARTHHOST",
    endpoint: "wss://hearth.example.ts.net:4500",
    hermesEndpoint: hermesEnabled ? "wss://hearth.example.ts.net:4510/api/ws" : "",
    defaultCwd: "C:\\work",
    handoffScriptPath: "C:\\host\\handoff.ps1",
    configured: true,
    hermesEnabled,
    hasStoredToken: true,
  };
  return {
    load: async () => undefined,
    publicSettings: () => settings,
    getToken: () => "test-token",
    save: async (_input: SaveSettingsInput) => undefined,
  };
}

import type { ConnectionSettings, SaveSettingsInput } from "../shared/contracts";

export interface AssistantConfig {
  load(): Promise<void>;
  publicSettings(): ConnectionSettings;
  getToken(): string | null;
  save(input: SaveSettingsInput): Promise<void>;
}

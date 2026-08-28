import type {
  AppSnapshot,
  ApprovalOption,
  HandoffMode,
  HandoffResult,
  PromptAttachment,
  ProviderId,
  SaveSettingsInput,
} from "../shared/contracts";
import type { AssistantConfig } from "./assistant-config";
import type { AssistantAdapter } from "./providers/assistant-adapter";
import { CodexAdapter } from "./providers/codex-adapter";
import { HermesAdapter } from "./providers/hermes-adapter";

export class ProviderService {
  private adapter!: AssistantAdapter;
  private readonly listeners = new Set<(snapshot: AppSnapshot) => void>();
  private adapters!: Record<ProviderId, AssistantAdapter>;

  constructor(private readonly config: AssistantConfig) {}

  async initialize(): Promise<void> {
    await this.config.load();
    this.adapters = {
      codex: new CodexAdapter(this.config),
      hermes: new HermesAdapter(this.config),
    };
    this.adapter = this.adapters.codex;
    for (const candidate of Object.values(this.adapters)) {
      candidate.onSnapshot(() => { if (candidate === this.adapter) this.emit(); });
    }
  }

  snapshot(): AppSnapshot {
    return this.adapter.snapshot();
  }

  onSnapshot(listener: (snapshot: AppSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  connect(): Promise<void> { return this.adapter.connect(); }
  disconnect(): Promise<void> { return this.adapter.disconnect(); }
  refreshSessions(search?: string): Promise<void> { return this.adapter.refreshSessions(search); }
  openSession(sessionId: string): Promise<void> { return this.adapter.openSession(sessionId); }
  newSession(cwd?: string, profile?: string): Promise<void> { return this.adapter.newSession(cwd, profile); }
  sendMessage(text: string, attachments?: PromptAttachment[]): Promise<void> {
    return this.adapter.sendMessage(text, attachments);
  }
  interrupt(): Promise<void> { return this.adapter.interrupt(); }
  resolveApproval(requestId: number | string, optionId: ApprovalOption["id"]): Promise<void> {
    return this.adapter.resolveApproval(requestId, optionId);
  }
  answerQuestion(requestId: number | string, answers: Record<string, string[]>): Promise<void> {
    return this.adapter.answerQuestion(requestId, answers);
  }
  runHandoff(mode: HandoffMode): Promise<HandoffResult> { return this.adapter.runHandoff(mode); }
  saveSettings(input: SaveSettingsInput): Promise<void> { return this.adapter.saveSettings(input); }
  selectModel(provider: string, model: string): Promise<void> { return this.adapter.selectModel(provider, model); }

  async selectProvider(providerId: ProviderId): Promise<void> {
    if (providerId === this.adapter.id) return;
    if (providerId === "hermes" && !this.config.publicSettings().hermesEnabled) {
      throw new Error("Hermes support is not enabled for this host.");
    }
    await this.adapter.disconnect();
    this.adapter = this.adapters[providerId];
    this.emit();
    await this.adapter.connect();
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

import type {
  AppSnapshot,
  ApprovalOption,
  HandoffMode,
  HandoffResult,
  PromptAttachment,
  ProviderId,
  SaveSettingsInput,
} from "../../shared/contracts";

export interface AssistantAdapter {
  readonly id: ProviderId;
  snapshot(): AppSnapshot;
  onSnapshot(listener: (snapshot: AppSnapshot) => void): () => void;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  refreshSessions(search?: string): Promise<void>;
  openSession(sessionId: string): Promise<void>;
  newSession(cwd?: string, profile?: string): Promise<void>;
  sendMessage(text: string, attachments?: PromptAttachment[]): Promise<void>;
  interrupt(): Promise<void>;
  resolveApproval(requestId: number | string, optionId: ApprovalOption["id"]): Promise<void>;
  answerQuestion(requestId: number | string, answers: Record<string, string[]>): Promise<void>;
  runHandoff(mode: HandoffMode): Promise<HandoffResult>;
  saveSettings(input: SaveSettingsInput): Promise<void>;
  selectModel(provider: string, model: string): Promise<void>;
}

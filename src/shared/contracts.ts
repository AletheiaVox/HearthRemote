export type ProviderId = "codex" | "hermes";

export type ConnectionPhase =
  | "disconnected"
  | "connecting"
  | "control-only"
  | "ready"
  | "error";

export interface ProviderCapabilities {
  conversations: boolean;
  newConversation: boolean;
  approvals: boolean;
  questions: boolean;
  tools: boolean;
  files: boolean;
  reasoning: boolean;
  continuousResident: boolean;
}

export interface ProviderDescriptor {
  id: ProviderId;
  name: string;
  subtitle: string;
  available: boolean;
  capabilities: ProviderCapabilities;
}

export interface ConnectionSettings {
  hostName: string;
  endpoint: string;
  hermesEndpoint: string;
  defaultCwd: string;
  handoffScriptPath: string;
  configured: boolean;
  hermesEnabled: boolean;
  hasStoredToken: boolean;
}

export interface SetupStatus {
  computerName: string;
  tailscale: {
    installed: boolean;
    connected: boolean;
    dnsName?: string;
    version?: string;
    message: string;
  };
}

export interface ModelChoice {
  provider: string;
  model: string;
  label: string;
}

export interface HermesProfileChoice {
  id: string;
  label: string;
  model?: string;
  provider?: string;
}

export type SessionActivity = "idle" | "working" | "attention" | "error";

export interface SessionSummary {
  id: string;
  title: string;
  preview: string;
  cwd: string;
  updatedAt: number;
  activity: SessionActivity;
  cliVersion?: string;
  profile?: string;
}

export interface FileChangeSummary {
  path: string;
  kind: string;
  diff?: string;
}

export type TimelineItem =
  | {
      id: string;
      kind: "user" | "assistant" | "reasoning" | "plan" | "system";
      text: string;
      streaming?: boolean;
      createdAt?: number;
    }
  | {
      id: string;
      kind: "tool";
      title: string;
      detail?: string;
      status: string;
      output?: string;
      toolKind: "command" | "file" | "mcp" | "dynamic" | "collaboration" | "other";
      changes?: FileChangeSummary[];
      createdAt?: number;
    };

export interface ApprovalOption {
  id: "accept" | "acceptForSession" | "decline" | "cancel" | "grantTurn" | "grantSession";
  label: string;
  tone: "primary" | "neutral" | "danger";
}

export interface PendingApproval {
  requestId: number | string;
  threadId: string;
  kind: "command" | "file" | "permissions";
  title: string;
  detail?: string;
  reason?: string;
  options: ApprovalOption[];
  requestedPermissions?: Record<string, unknown>;
}

export interface QuestionOption {
  label: string;
  description: string;
}

export interface PendingQuestionItem {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options?: QuestionOption[];
}

export interface PendingQuestion {
  requestId: number | string;
  threadId: string;
  questions: PendingQuestionItem[];
}

export interface HostHandoffState {
  host: string;
  desktopAppRunning: boolean;
  desktopServerRunning: boolean;
  remoteListenerRunning: boolean;
  readyForRemote: boolean;
  action?: string;
  timestamp?: string;
  error?: string;
}

export interface AppSnapshot {
  provider: ProviderId;
  providers: ProviderDescriptor[];
  connection: ConnectionPhase;
  connectionMessage: string;
  settings: ConnectionSettings;
  sessions: SessionSummary[];
  activeSessionId?: string;
  activeSessionTitle?: string;
  activeCwd?: string;
  timeline: TimelineItem[];
  busy: boolean;
  currentTurnId?: string;
  pendingApproval?: PendingApproval;
  pendingQuestion?: PendingQuestion;
  handoff?: HostHandoffState;
  error?: string;
  serverVersion?: string;
  models?: ModelChoice[];
  currentModel?: string;
  currentModelProvider?: string;
  hermesProfiles?: HermesProfileChoice[];
  activeProfile?: string;
  webClient?: {
    paired: boolean;
    host: string;
    label?: string;
  };
}

export interface SaveSettingsInput {
  hostName: string;
  endpoint: string;
  hermesEndpoint: string;
  defaultCwd: string;
  handoffScriptPath: string;
  hermesEnabled: boolean;
  token?: string;
}

export interface PromptAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataBase64: string;
}

export type HandoffMode = "status" | "prepare" | "force";

export interface HandoffResult {
  exitCode: number;
  state: HostHandoffState;
  stderr?: string;
}

export interface HearthApi {
  readonly clientKind?: "desktop" | "web" | "mock";
  getSnapshot(): Promise<AppSnapshot>;
  getSetupStatus?(): Promise<SetupStatus>;
  openExternal?(url: string): Promise<void>;
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
  selectProvider(providerId: ProviderId): Promise<void>;
  selectModel(provider: string, model: string): Promise<void>;
  pair?(code: string, label: string): Promise<void>;
  logout?(): Promise<void>;
  onSnapshot(callback: (snapshot: AppSnapshot) => void): () => void;
}

declare global {
  interface Window {
    hearth?: HearthApi;
  }
}

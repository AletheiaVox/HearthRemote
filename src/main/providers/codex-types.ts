export type JsonObject = Record<string, unknown>;

export interface CodexThreadStatus {
  type: "notLoaded" | "idle" | "systemError" | "active";
  activeFlags?: Array<"waitingOnApproval" | "waitingOnUserInput" | string>;
}

export interface CodexFileChange {
  path: string;
  kind: string;
  diff: string;
}

export type CodexUserInput =
  | { type: "text"; text: string; text_elements?: unknown[] }
  | { type: string; [key: string]: unknown };

/**
 * The wire union is generated from the installed Codex version during
 * development. Runtime normalization deliberately accepts unknown future
 * item fields so a new CLI item does not crash the whole client.
 */
export interface CodexThreadItem {
  type: string;
  id?: string;
  [key: string]: any;
}

export interface CodexTurn {
  id: string;
  items: CodexThreadItem[];
  status: string;
  startedAt: number | null;
  completedAt: number | null;
}

export interface CodexThread {
  id: string;
  sessionId: string;
  preview: string;
  modelProvider: string;
  createdAt: number;
  updatedAt: number;
  recencyAt: number | null;
  status: CodexThreadStatus;
  cwd: string;
  cliVersion: string;
  name: string | null;
  parentThreadId: string | null;
  turns: CodexTurn[];
}

export interface ThreadListResponse {
  data: CodexThread[];
  nextCursor: string | null;
}

export interface ThreadReadResponse {
  thread: CodexThread;
}

export interface ThreadResumeResponse extends ThreadReadResponse {
  model: string;
  modelProvider: string;
  cwd: string;
  reasoningEffort?: string | null;
}

export interface ThreadStartResponse extends ThreadResumeResponse {}

export interface ThreadLoadedListResponse {
  data: string[];
  nextCursor: string | null;
}

export interface ThreadUnsubscribeResponse {
  status: "notLoaded" | "notSubscribed" | "unsubscribed";
}

export interface TurnStartResponse {
  turn: CodexTurn;
}

export interface CommandExecResponse {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface InitializeResponse {
  userAgent?: string;
  platformFamily?: string;
  platformOs?: string;
}

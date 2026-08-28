import type { SessionActivity, SessionSummary, TimelineItem } from "../../shared/contracts";
import type { CodexFileChange, CodexThread, CodexThreadItem, CodexUserInput } from "./codex-types";

export function threadActivity(thread: CodexThread): SessionActivity {
  if (thread.status.type === "systemError") return "error";
  if (thread.status.type !== "active") return "idle";
  const flags = thread.status.activeFlags ?? [];
  if (flags.includes("waitingOnApproval") || flags.includes("waitingOnUserInput")) return "attention";
  return "working";
}

export function normalizeThread(thread: CodexThread): SessionSummary {
  const fallback = thread.preview.trim().split(/\r?\n/)[0]?.trim() || "Untitled task";
  return {
    id: thread.id,
    title: thread.name?.trim() || fallback,
    preview: thread.preview.trim(),
    cwd: thread.cwd,
    updatedAt: (thread.recencyAt ?? thread.updatedAt ?? thread.createdAt) * 1000,
    activity: threadActivity(thread),
    cliVersion: thread.cliVersion,
  };
}

export function normalizeThreadTimeline(thread: CodexThread): TimelineItem[] {
  const timeline: TimelineItem[] = [];
  for (const turn of thread.turns) {
    for (const item of turn.items) {
      const normalized = normalizeItem(item);
      if (normalized) timeline.push(normalized);
    }
  }
  return timeline;
}

export function normalizeItem(item: CodexThreadItem): TimelineItem | null {
  const id = typeof item.id === "string" ? item.id : `item-${crypto.randomUUID()}`;
  switch (item.type) {
    case "userMessage": {
      const content = Array.isArray(item.content) ? item.content : [];
      const text = content
        .filter((part: CodexUserInput): part is Extract<CodexUserInput, { type: "text" }> => part.type === "text")
        .map((part: Extract<CodexUserInput, { type: "text" }>) => part.text)
        .join("\n");
      return { id, kind: "user", text };
    }
    case "agentMessage":
      return { id, kind: "assistant", text: typeof item.text === "string" ? item.text : "" };
    case "reasoning": {
      const summary = Array.isArray(item.summary) ? item.summary.filter((value): value is string => typeof value === "string") : [];
      const content = Array.isArray(item.content) ? item.content.filter((value): value is string => typeof value === "string") : [];
      return { id, kind: "reasoning", text: [...summary, ...content].join("\n\n") };
    }
    case "plan":
      return { id, kind: "plan", text: item.text };
    case "commandExecution":
      return {
        id,
        kind: "tool",
        toolKind: "command",
        title: item.command || "Command",
        detail: item.cwd,
        status: item.status,
        output: item.aggregatedOutput ?? undefined,
      };
    case "fileChange":
      {
      const changes = Array.isArray(item.changes) ? item.changes as CodexFileChange[] : [];
      return {
        id,
        kind: "tool",
        toolKind: "file",
        title: changes.length === 1 ? `Changed ${changes[0]?.path ?? "file"}` : `Changed ${changes.length} files`,
        status: item.status,
        changes: changes.map((change: CodexFileChange) => ({ ...change })),
      };
      }
    case "mcpToolCall":
      return {
        id,
        kind: "tool",
        toolKind: "mcp",
        title: `${item.server} · ${item.tool}`,
        status: item.status,
        output: stringifyOutput(item.error ?? item.result),
      };
    case "dynamicToolCall":
      return {
        id,
        kind: "tool",
        toolKind: "dynamic",
        title: [item.namespace, item.tool].filter(Boolean).join(" · "),
        status: item.status,
        output: stringifyOutput(item.contentItems),
      };
    case "collabAgentToolCall":
      return {
        id,
        kind: "tool",
        toolKind: "collaboration",
        title: "Collaborating with another agent",
        detail: Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds.join(", ") : undefined,
        status: item.status,
      };
    default:
      return null;
  }
}

function stringifyOutput(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

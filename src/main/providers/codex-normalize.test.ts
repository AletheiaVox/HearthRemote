import { describe, expect, it } from "vitest";
import type { CodexThread } from "./codex-types";
import { normalizeItem, normalizeThread, normalizeThreadTimeline, threadActivity } from "./codex-normalize";

function thread(overrides: Partial<CodexThread> = {}): CodexThread {
  return {
    id: "thread-1",
    sessionId: "session-1",
    preview: "First line\nSecond line",
    modelProvider: "openai",
    createdAt: 100,
    updatedAt: 200,
    recencyAt: 300,
    status: { type: "idle" },
    cwd: "C:\\work",
    cliVersion: "0.test",
    name: null,
    parentThreadId: null,
    turns: [],
    ...overrides,
  };
}

describe("Codex normalization", () => {
  it("uses a named task, recency time, and attention state", () => {
    const source = thread({
      name: "Remote GUI",
      status: { type: "active", activeFlags: ["waitingOnApproval"] },
    });
    expect(threadActivity(source)).toBe("attention");
    expect(normalizeThread(source)).toMatchObject({
      title: "Remote GUI",
      updatedAt: 300_000,
      activity: "attention",
    });
  });

  it("maps conversation and tool items into one readable timeline", () => {
    const source = thread({
      turns: [{
        id: "turn-1",
        status: "completed",
        startedAt: 100,
        completedAt: 110,
        items: [
          { id: "u1", type: "userMessage", content: [{ type: "text", text: "Hello" }] },
          { id: "a1", type: "agentMessage", text: "Hi Tina" },
          { id: "r1", type: "reasoning", summary: ["Checking"], content: [] },
          { id: "c1", type: "commandExecution", command: "hostname", cwd: "C:\\work", status: "completed", aggregatedOutput: "HEARTHHOST" },
        ],
      }],
    });
    expect(normalizeThreadTimeline(source)).toEqual([
      { id: "u1", kind: "user", text: "Hello" },
      { id: "a1", kind: "assistant", text: "Hi Tina" },
      { id: "r1", kind: "reasoning", text: "Checking" },
      { id: "c1", kind: "tool", toolKind: "command", title: "hostname", detail: "C:\\work", status: "completed", output: "HEARTHHOST" },
    ]);
  });

  it("does not crash on a newer partially-known wire item", () => {
    expect(normalizeItem({ id: "future", type: "reasoning" })).toEqual({
      id: "future",
      kind: "reasoning",
      text: "",
    });
    expect(normalizeItem({ id: "unknown", type: "futureItem" })).toBeNull();
  });
});

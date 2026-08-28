import { describe, expect, it } from "vitest";
import { codexTestHelpers } from "./codex-adapter";

describe("host handoff output", () => {
  it("reads the final JSON state after human-readable PowerShell output", () => {
    const state = codexTestHelpers.parseHandoffState([
      "Checking the host safely; nothing has been closed yet.",
      "{\"desktopAppRunning\":false,\"listenerReady\":true,\"readyForRemote\":true}",
      "",
    ].join("\r\n"));
    expect(state.readyForRemote).toBe(true);
    expect(state.desktopAppRunning).toBe(false);
  });

  it("rejects output that cannot safely establish ownership", () => {
    expect(() => codexTestHelpers.parseHandoffState("desktop closed maybe")).toThrow(/unreadable handoff status/i);
  });
});

import { describe, expect, it } from "vitest";
import type { TimelineItem } from "../../../shared/contracts";
import { isNearTimelineBottom, timelineRevision } from "../timeline-scroll";

describe("timeline scroll behavior", () => {
  it("does not treat a cloned snapshot as new transcript content", () => {
    const items: TimelineItem[] = [
      { id: "user-1", kind: "user", text: "A long question" },
      { id: "assistant-1", kind: "assistant", text: "A much longer answer" },
    ];
    const cloned = structuredClone(items);

    expect(timelineRevision(cloned, false)).toBe(timelineRevision(items, false));
  });

  it("detects actual streaming, tool, and busy-state changes", () => {
    const message: TimelineItem[] = [{ id: "assistant-1", kind: "assistant", text: "Hello", streaming: true }];
    const longer: TimelineItem[] = [{ id: "assistant-1", kind: "assistant", text: "Hello there", streaming: true }];
    const tool: TimelineItem[] = [{ id: "tool-1", kind: "tool", title: "Read", status: "running", toolKind: "file" }];
    const completedTool: TimelineItem[] = [{ id: "tool-1", kind: "tool", title: "Read", status: "complete", toolKind: "file", output: "done" }];

    expect(timelineRevision(message, false)).not.toBe(timelineRevision(longer, false));
    expect(timelineRevision(tool, true)).not.toBe(timelineRevision(completedTool, false));
  });

  it("follows only while the reader remains near the bottom", () => {
    expect(isNearTimelineBottom(904, 500, 1500)).toBe(true);
    expect(isNearTimelineBottom(650, 500, 1500)).toBe(false);
  });
});

import type { TimelineItem } from "../../shared/contracts";

const BOTTOM_FOLLOW_DISTANCE_PX = 96;

export function timelineRevision(items: TimelineItem[], busy: boolean): string {
  return `${busy ? 1 : 0}|${items.map((item) => {
    if (item.kind === "tool") {
      return `${item.id}:${item.kind}:${item.status}:${item.output?.length ?? 0}:${item.changes?.length ?? 0}`;
    }
    return `${item.id}:${item.kind}:${item.text.length}:${item.streaming ? 1 : 0}`;
  }).join("|")}`;
}

export function isNearTimelineBottom(scrollTop: number, clientHeight: number, scrollHeight: number): boolean {
  return scrollHeight - scrollTop - clientHeight <= BOTTOM_FOLLOW_DISTANCE_PX;
}

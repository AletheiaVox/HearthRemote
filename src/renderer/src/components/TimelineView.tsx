import { ChevronDown, ChevronRight, FileCode2, Terminal, Wrench } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TimelineItem } from "../../../shared/contracts";
import { MarkdownBody } from "./MarkdownBody";
import { isNearTimelineBottom, timelineRevision } from "../timeline-scroll";

export function TimelineView({
  items,
  busy,
  conversationId,
  assistantName = "Codex",
  hostName,
}: {
  items: TimelineItem[];
  busy: boolean;
  conversationId: string;
  assistantName?: string;
  hostName: string;
}): React.JSX.Element {
  const timelineRef = useRef<HTMLElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const followingBottom = useRef(true);
  const previousConversationId = useRef<string | undefined>(undefined);
  const previousRevision = useRef("");
  const revision = useMemo(() => timelineRevision(items, busy), [items, busy]);

  useLayoutEffect(() => {
    const conversationChanged = previousConversationId.current !== conversationId;
    const contentChanged = previousRevision.current !== revision;
    if (conversationChanged || (contentChanged && followingBottom.current)) {
      endRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
      followingBottom.current = true;
    }
    previousConversationId.current = conversationId;
    previousRevision.current = revision;
  }, [conversationId, revision]);

  const rememberReadingPosition = (): void => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    followingBottom.current = isNearTimelineBottom(
      timeline.scrollTop,
      timeline.clientHeight,
      timeline.scrollHeight,
    );
  };

  return (
    <section ref={timelineRef} className="timeline" aria-live="polite" onScroll={rememberReadingPosition}>
      <div className="timeline-inner">
        {items.map((item) => <TimelineEntry key={item.id} item={item} assistantName={assistantName} />)}
        {busy && <div className="working-pulse"><span /><span /><span /><em>{assistantName} is working on {hostName}</em></div>}
        <div ref={endRef} />
      </div>
    </section>
  );
}

function TimelineEntry({ item, assistantName }: { item: TimelineItem; assistantName: string }): React.JSX.Element | null {
  if (item.kind === "tool") return <ToolEntry item={item} />;
  if (item.kind === "reasoning") return <ReasoningEntry text={item.text} streaming={item.streaming} />;
  if (item.kind === "system") return <div className="system-note">{item.text}</div>;
  if (item.kind === "plan") {
    return <article className="message plan-message"><div className="message-label">Plan</div><MarkdownBody text={item.text} /></article>;
  }
  return (
    <article className={`message ${item.kind}-message`}>
      <div className="message-label">{item.kind === "user" ? "You" : assistantName}</div>
      <MarkdownBody text={item.text} />
      {item.streaming && <span className="stream-caret" />}
    </article>
  );
}

function ReasoningEntry({ text, streaming }: { text: string; streaming?: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <button className="reasoning-card" onClick={() => setOpen((value) => !value)} type="button">
      <span className="reasoning-heading">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />} Working notes {streaming && <i />}</span>
      {open && <div className="reasoning-content"><MarkdownBody text={text} /></div>}
    </button>
  );
}

function ToolEntry({ item }: { item: Extract<TimelineItem, { kind: "tool" }> }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const Icon = item.toolKind === "command" ? Terminal : item.toolKind === "file" ? FileCode2 : Wrench;
  const hasDetails = Boolean(item.output || item.detail || item.changes?.length);
  return (
    <article className={`tool-card status-${item.status.toLowerCase()}`}>
      <button className="tool-summary" type="button" disabled={!hasDetails} onClick={() => setOpen((value) => !value)}>
        <span className="tool-icon"><Icon size={16} /></span>
        <span className="tool-title">{item.title}</span>
        <span className="tool-status">{item.status}</span>
        {hasDetails && (open ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
      </button>
      {open && (
        <div className="tool-details">
          {item.detail && <div className="tool-detail-line">{item.detail}</div>}
          {item.changes?.map((change) => (
            <details key={`${item.id}-${change.path}`} className="change-detail">
              <summary><span>{change.kind}</span>{change.path}</summary>
              {change.diff && <pre>{change.diff}</pre>}
            </details>
          ))}
          {item.output && <pre>{item.output}</pre>}
        </div>
      )}
    </article>
  );
}

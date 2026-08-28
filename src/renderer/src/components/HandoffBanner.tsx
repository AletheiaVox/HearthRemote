import { ArrowRightLeft, CheckCircle2, Monitor, TriangleAlert } from "lucide-react";
import type { AppSnapshot } from "../../../shared/contracts";

interface HandoffBannerProps {
  snapshot: AppSnapshot;
  hostName: string;
  working: boolean;
  needsForce: boolean;
  onPrepare(): void;
  onForce(): void;
  onCancelForce(): void;
  onReconnect(): void;
  onDisconnect(): void;
}

export function HandoffBanner(props: HandoffBannerProps): React.JSX.Element | null {
  const { snapshot } = props;
  if (snapshot.connection === "ready") {
    return (
      <div className="handoff-banner ready-banner">
        <CheckCircle2 size={18} />
        <span><strong>You have control</strong><small>Codex is running on {props.hostName}</small></span>
        <button
          type="button"
          className="button tone-neutral"
          disabled={snapshot.busy}
          title={snapshot.busy ? "Finish or stop this turn first" : undefined}
          onClick={props.onDisconnect}
        >Return control</button>
      </div>
    );
  }
  if (snapshot.connection === "connecting") {
    return <div className="handoff-banner"><span className="spinner" /><span><strong>Connecting securely…</strong><small>Checking {props.hostName} and your task history</small></span></div>;
  }
  if (snapshot.connection === "disconnected" || snapshot.connection === "error") {
    return (
      <div className="handoff-banner warning-banner">
        <TriangleAlert size={18} />
        <span><strong>{snapshot.connectionMessage}</strong><small>{snapshot.error ?? "The remote listener may be offline."}</small></span>
        <button type="button" className="button tone-primary" onClick={props.onReconnect}>Reconnect</button>
      </div>
    );
  }
  if (props.needsForce) {
    return (
      <div className="handoff-banner warning-banner force-banner">
        <TriangleAlert size={18} />
        <span><strong>The desktop app stayed open</strong><small>Force-close only Codex and its internal server? Other apps are untouched.</small></span>
        <button type="button" className="button tone-danger" disabled={props.working} onClick={props.onForce}>Force-close Codex</button>
        <button type="button" className="text-button" onClick={props.onCancelForce}>Cancel</button>
      </div>
    );
  }
  return (
    <div className="handoff-banner">
      <Monitor size={18} />
      <span><strong>{props.hostName} has control</strong><small>Finish any running turn there, then switch it to this device.</small></span>
      <button type="button" className="button tone-primary" disabled={props.working} onClick={props.onPrepare}>
        <ArrowRightLeft size={15} /> {props.working ? "Switching…" : "Switch to this device"}
      </button>
    </div>
  );
}

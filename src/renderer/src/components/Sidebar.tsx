import { Bot, ChevronDown, CircleAlert, Flame, LogOut, Plus, Search, Settings2, Sparkles } from "lucide-react";
import type { AppSnapshot, ProviderId, SessionSummary } from "../../../shared/contracts";

interface SidebarProps {
  snapshot: AppSnapshot;
  search: string;
  onSearch(search: string): void;
  onOpen(sessionId: string): void;
  onNew(): void;
  onSettings?(): void;
  onLogout?(): void;
  onProvider(providerId: ProviderId): void;
}

export function Sidebar(props: SidebarProps): React.JSX.Element {
  const { snapshot } = props;
  return (
    <aside className="sidebar">
      <div className="brand-row">
        <span className="brand-mark"><Flame size={19} /></span>
        <div><strong>Hearth Remote</strong><small>signal to signal</small></div>
        {props.onSettings && <button className="icon-button" type="button" aria-label="Settings" onClick={props.onSettings}><Settings2 size={18} /></button>}
        {props.onLogout && <button className="icon-button" type="button" aria-label="Forget this device" title="Forget this device" onClick={props.onLogout}><LogOut size={17} /></button>}
      </div>

      <div className="provider-switcher">
        {snapshot.providers.map((provider) => (
          <button
            key={provider.id}
            type="button"
            disabled={!provider.available}
            className={provider.id === snapshot.provider ? "active" : ""}
            onClick={() => props.onProvider(provider.id)}
            title={!provider.available ? "Coming in a later update" : provider.subtitle}
          >
            <span className={`provider-avatar provider-${provider.id}`}>{provider.id === "codex" ? <Bot size={16} /> : <Sparkles size={16} />}</span>
            <span><strong>{provider.name}</strong><small>{provider.subtitle}</small></span>
            {provider.id === snapshot.provider && <ChevronDown size={14} />}
          </button>
        ))}
      </div>

      <button className="new-task-button" type="button" onClick={props.onNew} disabled={snapshot.connection !== "ready"}>
        <Plus size={17} /> New task
      </button>

      <label className="search-box">
        <Search size={16} />
        <input value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder="Search tasks" />
      </label>

      <div className="task-list">
        {snapshot.sessions.map((session) => (
          <TaskRow key={session.id} session={session} active={session.id === snapshot.activeSessionId} onOpen={props.onOpen} />
        ))}
        {snapshot.sessions.length === 0 && <div className="empty-list">No matching tasks</div>}
      </div>

      <div className="sidebar-footer">
        <span className={`connection-dot phase-${snapshot.connection}`} />
        <div><strong>{snapshot.connectionMessage}</strong><small>{snapshot.serverVersion ?? snapshot.settings.endpoint}</small></div>
      </div>
    </aside>
  );
}

function TaskRow({ session, active, onOpen }: { session: SessionSummary; active: boolean; onOpen(id: string): void }): React.JSX.Element {
  const date = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(session.updatedAt);
  return (
    <button className={`task-row ${active ? "active" : ""}`} type="button" onClick={() => onOpen(session.id)}>
      <span className={`activity-dot activity-${session.activity}`}>{session.activity === "attention" && <CircleAlert size={11} />}</span>
      <span className="task-copy">
        <strong>{session.title}</strong>
        <small>{session.profile && <em className="profile-badge">{session.profile}</em>}{shortPath(session.cwd)}</small>
      </span>
      <time>{date}</time>
    </button>
  );
}

function shortPath(path: string): string {
  const pieces = path.split(/[\\/]/).filter(Boolean);
  return pieces.slice(-2).join(" / ") || path;
}

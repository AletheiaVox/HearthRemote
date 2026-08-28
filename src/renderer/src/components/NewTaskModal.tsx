import { Check, Folder, X } from "lucide-react";
import { useState } from "react";
import type { HermesProfileChoice } from "../../../shared/contracts";

export function NewTaskModal({ hostName, projects, defaultPath, profiles = [], defaultProfile, onClose, onCreate }: {
  hostName: string;
  projects: string[];
  defaultPath: string;
  profiles?: HermesProfileChoice[];
  defaultProfile?: string;
  onClose(): void;
  onCreate(cwd: string, profile?: string): Promise<void>;
}): React.JSX.Element {
  const [cwd, setCwd] = useState(defaultPath);
  const [profile, setProfile] = useState(defaultProfile || profiles[0]?.id || "");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();

  const create = async (): Promise<void> => {
    const selected = cwd.trim();
    if (!selected) return;
    setCreating(true);
    setError(undefined);
    try {
      await onCreate(selected, profile || undefined);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="new-task-modal" role="dialog" aria-modal="true" aria-labelledby="new-task-heading">
        <header>
          <div><span className="eyebrow">New task</span><h2 id="new-task-heading">Choose a project on {hostName}</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </header>

        {profiles.length > 0 && (
          <label className="profile-choice">
            Hermes profile
            <select value={profile} onChange={(event) => setProfile(event.target.value)}>
              {profiles.map((choice) => (
                <option key={choice.id} value={choice.id}>{choice.label}</option>
              ))}
            </select>
          </label>
        )}

        <div className="project-list">
          {projects.map((path) => (
            <button className={`project-option ${cwd === path ? "selected" : ""}`} type="button" key={path} onClick={() => setCwd(path)}>
              <span className="project-icon"><Folder size={17} /></span>
              <span><strong>{folderName(path)}</strong><small>{path}</small></span>
              {cwd === path && <Check size={17} />}
            </button>
          ))}
        </div>

        <label className="custom-project-path">
          Or enter another folder path on {hostName}
          <input value={cwd} onChange={(event) => setCwd(event.target.value)} spellCheck={false} placeholder="C:\Users\me\Documents\My project" />
        </label>
        <p className="settings-note">Recent project folders come from your existing tasks. The folder stays on {hostName}; nothing is copied to this device.</p>
        {error && <p className="form-error">{error}</p>}
        <footer>
          <button className="text-button" type="button" onClick={onClose}>Cancel</button>
          <button className="button tone-primary" type="button" disabled={creating || !cwd.trim()} onClick={() => void create()}>{creating ? "Opening…" : "Start task here"}</button>
        </footer>
      </section>
    </div>
  );
}

function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || path;
}

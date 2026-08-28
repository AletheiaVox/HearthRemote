import { Eye, EyeOff, X } from "lucide-react";
import { useState } from "react";
import type { ConnectionSettings, SaveSettingsInput } from "../../../shared/contracts";

export function SettingsModal({ settings, onClose, onSave }: {
  settings: ConnectionSettings;
  onClose(): void;
  onSave(input: SaveSettingsInput): Promise<void>;
}): React.JSX.Element {
  const [endpoint, setEndpoint] = useState(settings.endpoint);
  const [hostName, setHostName] = useState(settings.hostName);
  const [hermesEndpoint, setHermesEndpoint] = useState(settings.hermesEndpoint);
  const [hermesEnabled, setHermesEnabled] = useState(settings.hermesEnabled);
  const [cwd, setCwd] = useState(settings.defaultCwd);
  const [handoff, setHandoff] = useState(settings.handoffScriptPath);
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(undefined);
    try {
      await onSave({ hostName, endpoint, hermesEndpoint, hermesEnabled, defaultCwd: cwd, handoffScriptPath: handoff, token: token || undefined });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-heading">
        <header><div><span className="eyebrow">Connection</span><h2 id="settings-heading">{settings.hostName} settings</h2></div><button className="icon-button" type="button" onClick={onClose}><X size={19} /></button></header>
        <label>Host name<input value={hostName} onChange={(event) => setHostName(event.target.value)} spellCheck={false} /></label>
        <label>Codex WebSocket address<input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} spellCheck={false} /></label>
        <label className="settings-check"><input type="checkbox" checked={hermesEnabled} onChange={(event) => setHermesEnabled(event.target.checked)} /><span>Enable optional Hermes support</span></label>
        {hermesEnabled && <label>Hermes WebSocket address<input value={hermesEndpoint} onChange={(event) => setHermesEndpoint(event.target.value)} spellCheck={false} /></label>}
        <label>Default folder for new tasks<input value={cwd} onChange={(event) => setCwd(event.target.value)} spellCheck={false} /></label>
        <label>Host handoff script<input value={handoff} onChange={(event) => setHandoff(event.target.value)} spellCheck={false} /></label>
        <label>
          Capability token
          <div className="secret-input">
            <input
              type={showToken ? "text" : "password"}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={settings.hasStoredToken ? "Stored securely · leave blank to keep it" : "Paste the token from setup"}
              autoComplete="off"
            />
            <button type="button" onClick={() => setShowToken((value) => !value)}>{showToken ? <EyeOff size={17} /> : <Eye size={17} />}</button>
          </div>
        </label>
        <p className="settings-note">The token is encrypted with Windows protection and never exposed to the chat interface.</p>
        {error && <p className="form-error">{error}</p>}
        <footer><button className="text-button" type="button" onClick={onClose}>Cancel</button><button className="button tone-primary" type="button" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save and reconnect"}</button></footer>
      </section>
    </div>
  );
}

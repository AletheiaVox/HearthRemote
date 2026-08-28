import { Check, ExternalLink, Eye, EyeOff, FileKey, Network, RefreshCw, ShieldCheck, Upload } from "lucide-react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import type { ConnectionSettings, HearthApi, SaveSettingsInput, SetupStatus } from "../../../shared/contracts";
import { parseConnectionBundle } from "../connection-bundle";

const TAILSCALE_DOWNLOAD = "https://tailscale.com/download/windows";
const TAILSCALE_GUIDE = "https://tailscale.com/docs/how-to/quickstart";

export function SetupWizard({ api, settings, onSave }: {
  api: HearthApi;
  settings: ConnectionSettings;
  onSave(input: SaveSettingsInput): Promise<void>;
}): React.JSX.Element {
  const fileInput = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<SetupStatus>();
  const [advanced, setAdvanced] = useState(false);
  const [input, setInput] = useState<SaveSettingsInput>({
    hostName: settings.hostName,
    endpoint: settings.endpoint,
    hermesEndpoint: settings.hermesEndpoint,
    defaultCwd: settings.defaultCwd,
    handoffScriptPath: settings.handoffScriptPath,
    hermesEnabled: settings.hermesEnabled,
    token: "",
  });
  const [bundleName, setBundleName] = useState<string>();
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const refreshStatus = async (): Promise<void> => {
    if (!api.getSetupStatus) return;
    try { setStatus(await api.getSetupStatus()); } catch { setStatus(undefined); }
  };

  useEffect(() => { void refreshStatus(); }, []);

  const open = (url: string): void => { void api.openExternal?.(url); };

  const importBundle = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(undefined);
    try {
      const imported = parseConnectionBundle(await file.text());
      setInput(imported);
      setBundleName(file.name);
    } catch (reason) {
      setBundleName(undefined);
      setError(reason instanceof Error ? reason.message : "That connection file could not be read.");
    }
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(undefined);
    try { await onSave(input); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };

  return (
    <main className="setup-screen">
      <section className="setup-card">
        <div className="setup-brand"><span className="brand-orbit" /><span>Hearth Remote</span></div>
        <div className="setup-heading">
          <span className="eyebrow">Welcome home</span>
          <h1>Connect this computer to your AI host.</h1>
          <p>Your host is the Windows computer where Codex and your projects live. This computer becomes a private window into it—even while the Codex desktop app there is closed.</p>
        </div>

        <div className="setup-explainer">
          <Network size={21} />
          <div><strong>First, put both computers on the same tailnet.</strong><p>A tailnet is a private network made by Tailscale. It lets your own devices find the hidden Hearth Remote host service without exposing Codex to the public internet.</p></div>
        </div>

        <div className={`setup-status ${status?.tailscale.connected ? "is-ready" : ""}`}>
          <span className="setup-status-icon">{status?.tailscale.connected ? <Check size={18} /> : <Network size={18} />}</span>
          <div>
            <strong>{status?.tailscale.connected ? "Tailscale is connected on this computer" : status?.tailscale.installed ? "Tailscale needs attention" : "Tailscale is not connected yet"}</strong>
            <small>{status?.tailscale.message ?? "Checking this computer…"}</small>
          </div>
          <button className="icon-button" type="button" onClick={() => void refreshStatus()} title="Check again"><RefreshCw size={16} /></button>
        </div>

        {!status?.tailscale.connected && (
          <div className="setup-links">
            <button className="button tone-neutral" type="button" onClick={() => open(TAILSCALE_DOWNLOAD)}>Download Tailscale <ExternalLink size={13} /></button>
            <button className="text-button" type="button" onClick={() => open(TAILSCALE_GUIDE)}>Open the beginner guide <ExternalLink size={12} /></button>
          </div>
        )}

        <div className="setup-divider"><span>then</span></div>

        <div className="setup-import">
          <FileKey size={24} />
          <div><strong>Import the connection file from your host</strong><p>Run Hearth Remote setup on the host first. It creates the file you need here.</p></div>
          <input ref={fileInput} type="file" accept=".json,application/json" onChange={(event) => void importBundle(event)} hidden />
          <button className={`button ${bundleName ? "tone-success" : "tone-primary"}`} type="button" onClick={() => fileInput.current?.click()}>
            {bundleName ? <Check size={14} /> : <Upload size={14} />}{bundleName ? bundleName : "Choose connection file"}
          </button>
        </div>

        {bundleName && (
          <div className="setup-ready"><ShieldCheck size={18} /><span><strong>Ready to connect to {input.hostName}</strong><small>The capability token will be encrypted with Windows protection on this computer.</small></span></div>
        )}

        <button className="setup-advanced-toggle" type="button" onClick={() => setAdvanced((value) => !value)}>{advanced ? "Hide manual settings" : "Set up manually instead"}</button>

        {advanced && (
          <div className="setup-fields">
            <label>Host name<input value={input.hostName} onChange={(event) => setInput({ ...input, hostName: event.target.value })} placeholder="My desktop" /></label>
            <label>Codex WebSocket address<input value={input.endpoint} onChange={(event) => setInput({ ...input, endpoint: event.target.value })} placeholder="wss://my-host.example.ts.net:4500" spellCheck={false} /></label>
            <label>Default project folder<input value={input.defaultCwd} onChange={(event) => setInput({ ...input, defaultCwd: event.target.value })} placeholder="C:\Users\me\Documents\Codex" spellCheck={false} /></label>
            <label>Host handoff script<input value={input.handoffScriptPath} onChange={(event) => setInput({ ...input, handoffScriptPath: event.target.value })} placeholder="C:\Users\me\.hearth-remote\host\handoff-desktop.ps1" spellCheck={false} /></label>
            <label className="setup-check"><input type="checkbox" checked={input.hermesEnabled} onChange={(event) => setInput({ ...input, hermesEnabled: event.target.checked })} /><span>Enable optional Hermes support</span></label>
            {input.hermesEnabled && <label>Hermes WebSocket address<input value={input.hermesEndpoint} onChange={(event) => setInput({ ...input, hermesEndpoint: event.target.value })} placeholder="wss://my-host.example.ts.net:4510/api/ws" spellCheck={false} /></label>}
            <label>Capability token<div className="secret-input"><input type={showToken ? "text" : "password"} value={input.token ?? ""} onChange={(event) => setInput({ ...input, token: event.target.value })} autoComplete="off" /><button type="button" onClick={() => setShowToken((value) => !value)}>{showToken ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
          </div>
        )}

        {error && <p className="form-error">{error}</p>}
        <button className="setup-connect button tone-primary" type="button" disabled={saving || (!bundleName && !advanced)} onClick={() => void save()}>{saving ? "Connecting…" : `Connect${input.hostName ? ` to ${input.hostName}` : ""}`}</button>
        <p className="setup-footnote">Hearth Remote never opens a public port. Tailscale remains the private transport between your devices.</p>
      </section>
    </main>
  );
}

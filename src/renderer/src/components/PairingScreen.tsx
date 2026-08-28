import { Flame, LockKeyhole, Radio } from "lucide-react";
import { useState } from "react";
import type { HearthApi } from "../../../shared/contracts";

export function PairingScreen({ api, host }: { api: HearthApi; host: string }): React.JSX.Element {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("My phone");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();

  const pair = async (): Promise<void> => {
    if (!api.pair || !/^\d{6}$/.test(code)) return;
    setWorking(true);
    setError(undefined);
    try {
      await api.pair(code, label);
      window.location.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setWorking(false);
    }
  };

  return (
    <main className="pairing-screen">
      <section className="pairing-card">
        <div className="pairing-mark"><Flame size={30} /></div>
        <span className="eyebrow">A private window home</span>
        <h1>Pair with {host}</h1>
        <p>Enter the six-digit code created on {host}. This phone receives its own revocable session; the powerful Codex and Hermes token never leaves your desktop.</p>

        <label className="pairing-field">
          Pairing code
          <input
            autoComplete="one-time-code"
            autoFocus
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(event) => { if (event.key === "Enter") void pair(); }}
            placeholder="000000"
          />
        </label>
        <label className="pairing-field">
          Device name
          <input value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} placeholder="My phone" />
        </label>

        {error && <p className="form-error">{error}</p>}
        <button className="pairing-button" type="button" disabled={working || !/^\d{6}$/.test(code)} onClick={() => void pair()}>
          {working ? <><Radio size={17} className="pairing-pulse" /> Pairing…</> : <><LockKeyhole size={17} /> Pair securely</>}
        </button>
        <small className="pairing-footnote">Tailnet only · encrypted in transit · no credentials stored in JavaScript</small>
      </section>
    </main>
  );
}

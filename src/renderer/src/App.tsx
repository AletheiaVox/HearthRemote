import { ALargeSmall, Folder, PanelLeftClose, PanelLeftOpen, RotateCw, Sparkles, X } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppSnapshot, PromptAttachment, ProviderId, SaveSettingsInput } from "../../shared/contracts";
import { getApi } from "./api";
import { ApprovalCard } from "./components/ApprovalCard";
import { Composer } from "./components/Composer";
import { HandoffBanner } from "./components/HandoffBanner";
import { NewTaskModal } from "./components/NewTaskModal";
import { PairingScreen } from "./components/PairingScreen";
import { QuestionCard } from "./components/QuestionCard";
import { SettingsModal } from "./components/SettingsModal";
import { SetupWizard } from "./components/SetupWizard";
import { Sidebar } from "./components/Sidebar";
import { TimelineView } from "./components/TimelineView";
import { clampReadingSize, nextReadingSize, READING_SIZE_DEFAULT, readingSizeFromPinch } from "./reading-size";

const api = getApi();

export function App(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [search, setSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [handoffWorking, setHandoffWorking] = useState(false);
  const [needsForce, setNeedsForce] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [readingSize, setReadingSize] = useState<number>(() => {
    const stored = Number(window.localStorage.getItem("hearth-reading-size"));
    if (Number.isFinite(stored) && stored > 0) return clampReadingSize(stored);
    const legacy = window.localStorage.getItem("hearth-text-scale");
    if (legacy === "comfortable") return 20;
    if (legacy === "largest") return 28;
    return READING_SIZE_DEFAULT;
  });
  const [pinching, setPinching] = useState(false);
  const readingSizeRef = useRef(readingSize);

  useEffect(() => {
    let mounted = true;
    const unsubscribe = api.onSnapshot((next) => { if (mounted) setSnapshot(next); });
    void api.getSnapshot().then((initial) => {
      if (!mounted) return;
      setSnapshot(initial);
      if (initial.settings.hasStoredToken && initial.connection === "disconnected") {
        void api.connect().catch((error) => setNotice(errorMessage(error)));
      }
    }).catch((error) => { if (mounted) setNotice(errorMessage(error)); });
    return () => { mounted = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (api.clientKind !== "web") return;
    const onPopState = (event: PopStateEvent): void => {
      if (window.matchMedia("(max-width: 760px)").matches) setSidebarOpen(event.state?.hearthView !== "chat");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    readingSizeRef.current = readingSize;
  }, [readingSize]);

  useEffect(() => {
    if (api.clientKind !== "web") return;
    let startDistance: number | undefined;
    let startSize = readingSizeRef.current;
    const distance = (touches: TouchList): number => Math.hypot(
      touches[0]!.clientX - touches[1]!.clientX,
      touches[0]!.clientY - touches[1]!.clientY,
    );
    const begin = (event: TouchEvent): void => {
      if (event.touches.length !== 2) return;
      event.preventDefault();
      startDistance = distance(event.touches);
      startSize = readingSizeRef.current;
      setPinching(true);
    };
    const move = (event: TouchEvent): void => {
      if (startDistance === undefined || event.touches.length !== 2) return;
      event.preventDefault();
      const next = readingSizeFromPinch(startSize, startDistance, distance(event.touches));
      if (next === readingSizeRef.current) return;
      readingSizeRef.current = next;
      setReadingSize(next);
    };
    const finish = (event: TouchEvent): void => {
      if (startDistance === undefined || event.touches.length >= 2) return;
      startDistance = undefined;
      window.localStorage.setItem("hearth-reading-size", String(readingSizeRef.current));
      setPinching(false);
    };
    document.addEventListener("touchstart", begin, { passive: false });
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", finish, { passive: false });
    document.addEventListener("touchcancel", finish, { passive: false });
    return () => {
      document.removeEventListener("touchstart", begin);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", finish);
      document.removeEventListener("touchcancel", finish);
    };
  }, []);

  useEffect(() => {
    if (!snapshot || snapshot.connection === "disconnected" || snapshot.connection === "error") return;
    const timer = setTimeout(() => void api.refreshSessions(search).catch((error) => setNotice(errorMessage(error))), 250);
    return () => clearTimeout(timer);
  }, [search, snapshot?.connection]);

  const run = useCallback(async (action: () => Promise<unknown>): Promise<void> => {
    setNotice(undefined);
    try { await action(); } catch (error) { setNotice(errorMessage(error)); }
  }, []);

  const openSession = (id: string): void => {
    if (window.matchMedia("(max-width: 760px)").matches) {
      if (api.clientKind === "web") window.history.pushState({ hearthView: "chat" }, "");
      setSidebarOpen(false);
    }
    void run(() => api.openSession(id));
  };

  const newSession = (): void => {
    setNewTaskOpen(true);
  };

  const createNewSession = async (cwd: string, profile?: string): Promise<void> => {
    setNotice(undefined);
    try {
      await api.newSession(cwd, profile);
      if (window.matchMedia("(max-width: 760px)").matches) {
        if (api.clientKind === "web") window.history.pushState({ hearthView: "chat" }, "");
        setSidebarOpen(false);
      }
    } catch (error) {
      setNotice(errorMessage(error));
      throw error;
    }
  };

  const sendMessage = async (text: string, attachments: PromptAttachment[]): Promise<void> => {
    setNotice(undefined);
    try {
      await api.sendMessage(text, attachments);
    } catch (error) {
      setNotice(errorMessage(error));
      throw error;
    }
  };

  const prepareHandoff = async (): Promise<void> => {
    setHandoffWorking(true);
    setNeedsForce(false);
    try {
      const result = await api.runHandoff("prepare");
      if (!result.state.readyForRemote) setNeedsForce(true);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setHandoffWorking(false);
    }
  };

  const forceHandoff = async (): Promise<void> => {
    setHandoffWorking(true);
    try {
      const result = await api.runHandoff("force");
      setNeedsForce(!result.state.readyForRemote);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setHandoffWorking(false);
    }
  };

  const saveSettings = async (input: SaveSettingsInput): Promise<void> => {
    await api.saveSettings(input);
    await api.connect();
  };

  const selectModel = (value: string): void => {
    const [provider, ...modelParts] = value.split("\u0000");
    const model = modelParts.join("\u0000");
    if (provider && model) void run(() => api.selectModel(provider, model));
  };

  const cycleTextScale = (): void => {
    const next = nextReadingSize(readingSize);
    readingSizeRef.current = next;
    setReadingSize(next);
    window.localStorage.setItem("hearth-reading-size", String(next));
  };

  const toggleSidebar = (): void => {
    if (api.clientKind === "web" && !sidebarOpen && window.matchMedia("(max-width: 760px)").matches && window.history.state?.hearthView === "chat") {
      window.history.back();
      return;
    }
    setSidebarOpen((value) => !value);
  };

  const activeSession = useMemo(
    () => snapshot?.sessions.find((session) => session.id === snapshot.activeSessionId),
    [snapshot?.sessions, snapshot?.activeSessionId],
  );
  const projectPaths = useMemo(() => {
    const paths = [snapshot?.settings.defaultCwd, ...(snapshot?.sessions.map(({ cwd }) => cwd) ?? [])]
      .filter((path): path is string => Boolean(path?.trim()));
    return [...new Set(paths)].slice(0, 12);
  }, [snapshot?.settings.defaultCwd, snapshot?.sessions]);

  if (!snapshot) {
    return <main className="loading-screen"><span className="brand-orbit" /><strong>Lighting the connection…</strong></main>;
  }

  if (snapshot.webClient?.paired === false) {
    return <PairingScreen api={api} host={snapshot.webClient.host} />;
  }

  if (api.clientKind === "desktop" && !snapshot.settings.configured) {
    return <SetupWizard api={api} settings={snapshot.settings} onSave={saveSettings} />;
  }

  const readingStyle = snapshot.webClient ? {
    "--mobile-text-size": `${readingSize}px`,
    "--mobile-text-scale": readingSize / 20,
  } as CSSProperties : undefined;

  return (
    <div className={`app-shell ${sidebarOpen ? "" : "sidebar-collapsed"} ${snapshot.webClient ? "web-client" : ""}`} style={readingStyle}>
      {sidebarOpen && (
        <Sidebar
          snapshot={snapshot}
          search={search}
          onSearch={setSearch}
          onOpen={openSession}
          onNew={newSession}
          onSettings={snapshot.webClient ? undefined : () => setSettingsOpen(true)}
          onLogout={snapshot.webClient && api.logout ? () => {
            if (window.confirm("Forget this phone and require a new pairing code next time?")) {
              void api.logout!().then(() => window.location.reload());
            }
          } : undefined}
          onProvider={(id: ProviderId) => void run(() => api.selectProvider(id))}
        />
      )}

      <main className="main-pane">
        <header className="task-header">
          <button className="icon-button sidebar-toggle" type="button" onClick={toggleSidebar} aria-label="Toggle sidebar">
            {sidebarOpen ? <PanelLeftClose size={19} /> : <PanelLeftOpen size={19} />}
          </button>
          <div className="task-heading">
            <h1>{snapshot.activeSessionTitle ?? "Hearth Remote"}</h1>
            <span><Folder size={13} /> {snapshot.activeCwd ?? snapshot.settings.defaultCwd}</span>
          </div>
          {snapshot.provider === "hermes" && snapshot.models?.length ? (
            <label className="model-picker" title="Model for this Hermes conversation">
              <Sparkles size={14} />
              <select
                value={`${snapshot.currentModelProvider ?? ""}\u0000${snapshot.currentModel ?? ""}`}
                onChange={(event) => selectModel(event.target.value)}
                disabled={!snapshot.activeSessionId || snapshot.busy}
              >
                {snapshot.models.map((choice) => (
                  <option key={`${choice.provider}:${choice.model}`} value={`${choice.provider}\u0000${choice.model}`}>{choice.label}</option>
                ))}
              </select>
            </label>
          ) : null}
          {snapshot.webClient && (
            <button className="icon-button text-scale-button" type="button" onClick={cycleTextScale} aria-label={`Reading size: ${readingSize} pixels. Pinch with two fingers to adjust.`} title={`Reading size: ${readingSize}px`}>
              <ALargeSmall size={18} />
              <span aria-hidden="true">{readingSize}</span>
            </button>
          )}
          <button className="icon-button" type="button" onClick={() => void run(() => api.refreshSessions(search))} title="Refresh tasks"><RotateCw size={17} /></button>
        </header>

        {snapshot.provider === "codex" && <HandoffBanner
          snapshot={snapshot}
          hostName={snapshot.settings.hostName}
          working={handoffWorking}
          needsForce={needsForce}
          onPrepare={() => void prepareHandoff()}
          onForce={() => void forceHandoff()}
          onCancelForce={() => setNeedsForce(false)}
          onReconnect={() => void run(() => api.connect())}
          onDisconnect={() => void run(() => api.disconnect())}
        />}

        {notice && <div className="notice-bar"><span>{notice}</span><button type="button" onClick={() => setNotice(undefined)}><X size={15} /></button></div>}

        {snapshot.activeSessionId ? (
          <>
              <TimelineView
              items={snapshot.timeline}
              busy={snapshot.busy}
              conversationId={snapshot.activeSessionId}
                assistantName={snapshot.provider === "hermes" ? "Hermes" : "Codex"}
                hostName={snapshot.settings.hostName}
            />
            <div className="interaction-dock">
              {snapshot.pendingQuestion && (
                <QuestionCard request={snapshot.pendingQuestion} onSubmit={(answers) => void run(() => api.answerQuestion(snapshot.pendingQuestion!.requestId, answers))} />
              )}
              {!snapshot.pendingQuestion && snapshot.pendingApproval && (
                <ApprovalCard approval={snapshot.pendingApproval} onResolve={(option) => void run(() => api.resolveApproval(snapshot.pendingApproval!.requestId, option))} />
              )}
              <Composer
                hostName={snapshot.settings.hostName}
                disabled={snapshot.connection !== "ready" || Boolean(snapshot.pendingApproval || snapshot.pendingQuestion)}
                busy={snapshot.busy}
                onSend={sendMessage}
                onStop={() => run(() => api.interrupt())}
              />
              <div className="dock-meta"><span>{snapshot.settings.hostName}</span><span>{activeSession?.cliVersion ?? snapshot.serverVersion ?? (snapshot.provider === "hermes" ? "Hermes" : "Codex")}</span></div>
            </div>
          </>
        ) : (
          <section className="welcome-state">
            <div className="welcome-mark"><span /></div>
            <span className="eyebrow">Securely connected to your desktop</span>
            <h2>{snapshot.provider === "hermes" ? `Your local resident lives on ${snapshot.settings.hostName}.` : `Your Codex tasks live on ${snapshot.settings.hostName}.`}<br />This is simply another window into them.</h2>
            <p>{snapshot.provider === "hermes" ? "Select a conversation, or begin a new one in any project folder." : "Select a task from the sidebar, or start a new one after switching control to this device."}</p>
            <button className="button tone-primary" type="button" disabled={snapshot.connection !== "ready"} onClick={newSession}>Start a new task</button>
          </section>
        )}
      </main>

      {snapshot.webClient && pinching && <div className="pinch-size-indicator" role="status">Text {readingSize}px</div>}

      {settingsOpen && <SettingsModal settings={snapshot.settings} onClose={() => setSettingsOpen(false)} onSave={saveSettings} />}
      {newTaskOpen && (
        <NewTaskModal
          hostName={snapshot.settings.hostName}
          projects={projectPaths}
          defaultPath={snapshot.activeCwd ?? snapshot.settings.defaultCwd}
          profiles={snapshot.provider === "hermes" ? snapshot.hermesProfiles : undefined}
          defaultProfile={snapshot.activeProfile}
          onClose={() => setNewTaskOpen(false)}
          onCreate={createNewSession}
        />
      )}
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

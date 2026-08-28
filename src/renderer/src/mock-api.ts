import type {
  AppSnapshot,
  HearthApi,
  HandoffMode,
  ProviderId,
  SaveSettingsInput,
} from "../../shared/contracts";

export function createMockApi(clientKind: "mock" | "web" = "mock"): HearthApi {
  const listeners = new Set<(snapshot: AppSnapshot) => void>();
  let state: AppSnapshot = {
    provider: "codex",
    providers: [
      {
        id: "codex",
        name: "Codex",
        subtitle: "Remote on Hearth Desktop",
        available: true,
        capabilities: {
          conversations: true, newConversation: true, approvals: true, questions: true,
          tools: true, files: true, reasoning: true, continuousResident: false,
        },
      },
      {
        id: "hermes",
        name: "Local AI",
        subtitle: "Hermes resident",
        available: true,
        capabilities: {
          conversations: true, newConversation: true, approvals: true, questions: true,
          tools: true, files: true, reasoning: true, continuousResident: true,
        },
      },
    ],
    connection: "control-only",
    connectionMessage: "Hearth Desktop currently has control",
    settings: {
      hostName: "Hearth Desktop",
      endpoint: "wss://hearth-desktop.example.ts.net:4500",
      hermesEndpoint: "wss://hearth-desktop.example.ts.net:4510/api/ws",
      defaultCwd: "C:\\Users\\me\\Documents\\Codex",
      handoffScriptPath: "C:\\Users\\me\\.hearth-remote\\host\\handoff-desktop.ps1",
      configured: true,
      hermesEnabled: true,
      hasStoredToken: true,
    },
    sessions: [
      { id: "one", title: "Build the remote Codex GUI", preview: "Let's start building the thing.", cwd: "C:\\Users\\me\\Documents\\Codex\\hearth-remote", updatedAt: Date.now(), activity: "working" },
      { id: "two", title: "Local resident harness", preview: "Design a continuous local resident…", cwd: "C:\\Users\\me\\Documents\\Resident", updatedAt: Date.now() - 3_600_000, activity: "idle" },
      { id: "three", title: "Move Codex to the host", preview: "Move the canonical Codex state…", cwd: "C:\\Users\\me\\Documents\\Codex", updatedAt: Date.now() - 86_400_000, activity: "attention" },
    ],
    activeSessionId: "one",
    activeSessionTitle: "Build the remote Codex GUI",
    activeCwd: "C:\\Users\\me\\Documents\\Codex\\hearth-remote",
    timeline: [
      { id: "u1", kind: "user", text: "Let's start building the thing." },
      { id: "r1", kind: "reasoning", text: "I’m separating the shared interface from the Codex transport so Hermes and a phone client fit cleanly later." },
      { id: "t1", kind: "tool", toolKind: "command", title: "npm run typecheck", detail: "C:\\…\\hearth-remote", status: "completed", output: "TypeScript checks passed." },
      { id: "a1", kind: "assistant", text: "The foundation is in place. **Codex is the first adapter**, not the whole architecture." },
    ],
    busy: false,
    handoff: {
      host: "Hearth Desktop",
      desktopAppRunning: true,
      desktopServerRunning: true,
      remoteListenerRunning: true,
      readyForRemote: false,
    },
    serverVersion: "codex-cli 0.148.0-alpha.15",
    ...(clientKind === "web" ? { webClient: { paired: true, host: "Hearth Desktop" } } : {}),
  };

  if (new URLSearchParams(window.location.search).has("layoutStress")) {
    const sessionTemplates = state.sessions;
    state.sessions = Array.from({ length: 36 }, (_, index) => ({
      ...sessionTemplates[index % sessionTemplates.length]!,
      id: `layout-session-${index}`,
      title: `Layout test task ${index + 1}`,
      updatedAt: Date.now() - index * 3_600_000,
    }));
    const firstSession = state.sessions[0]!;
    state.activeSessionId = firstSession.id;
    state.activeSessionTitle = firstSession.title;
    state.timeline = Array.from({ length: 24 }, (_, index) => ({
      id: `layout-message-${index}`,
      kind: index % 2 === 0 ? "user" as const : "assistant" as const,
      text: `Scroll test message ${index + 1}. This deliberately makes the transcript taller than the window so layout QA can verify the independent scroll container.`,
    }));
  }

  const emit = (): void => {
    const snapshot = structuredClone(state);
    for (const listener of listeners) listener(snapshot);
  };

  return {
    clientKind,
    getSnapshot: async () => structuredClone(state),
    connect: async () => { state.connection = "control-only"; emit(); },
    disconnect: async () => { state.connection = "disconnected"; emit(); },
    refreshSessions: async () => undefined,
    openSession: async (id) => {
      const session = state.sessions.find((candidate) => candidate.id === id);
      if (session) {
        state.activeSessionId = id;
        state.activeSessionTitle = session.title;
        state.activeCwd = session.cwd;
      }
      emit();
    },
    newSession: async (cwd, profile) => {
      state.activeSessionId = "new";
      state.activeSessionTitle = "New task";
      state.activeCwd = cwd?.trim() || state.settings.defaultCwd;
      if (profile) state.activeProfile = profile;
      state.timeline = [];
      emit();
    },
    sendMessage: async (text, attachments = []) => {
      const attachmentText = attachments.length > 0 ? `\n\nAttached: ${attachments.map(({ name }) => name).join(", ")}` : "";
      state.timeline.push({ id: crypto.randomUUID(), kind: "user", text: `${text}${attachmentText}`.trim() });
      state.busy = true;
      emit();
      setTimeout(() => {
        state.timeline.push({ id: crypto.randomUUID(), kind: "assistant", text: "Mock reply from Hearth Desktop. The real app streams this as Codex works." });
        state.busy = false;
        emit();
      }, 500);
    },
    interrupt: async () => { state.busy = false; emit(); },
    resolveApproval: async () => { state.pendingApproval = undefined; emit(); },
    answerQuestion: async () => { state.pendingQuestion = undefined; emit(); },
    runHandoff: async (mode: HandoffMode) => {
      if (mode !== "status") {
        state.handoff = { ...state.handoff!, desktopAppRunning: false, desktopServerRunning: false, readyForRemote: true };
        state.connection = "ready";
        state.connectionMessage = "Running on Hearth Desktop · controlled from this device";
        emit();
      }
      return { exitCode: 0, state: state.handoff! };
    },
    saveSettings: async (input: SaveSettingsInput) => {
      state.settings = { ...state.settings, ...input, configured: true, hasStoredToken: state.settings.hasStoredToken || Boolean(input.token) };
      emit();
    },
    selectProvider: async (providerId: ProviderId) => {
      state.provider = providerId;
      state.connection = "ready";
      state.connectionMessage = providerId === "hermes" ? "Hermes resident on Hearth Desktop" : "Running on Hearth Desktop · controlled from this device";
      state.serverVersion = providerId === "hermes" ? "Hermes Agent" : "codex-cli 0.148.0-alpha.15";
      state.models = providerId === "hermes" ? [
        { provider: "lmstudio", model: "local-model", label: "LM Studio · local-model" },
        { provider: "example-cloud", model: "example-model", label: "Cloud · example-model" },
      ] : undefined;
      state.currentModelProvider = providerId === "hermes" ? "lmstudio" : undefined;
      state.currentModel = providerId === "hermes" ? "local-model" : undefined;
      state.hermesProfiles = providerId === "hermes" ? [
        { id: "local", label: "local", model: "local-model", provider: "lmstudio" },
        { id: "resident", label: "resident", model: "example-model", provider: "example-cloud" },
        { id: "research", label: "research", model: "example-model", provider: "example-cloud" },
        { id: "default", label: "default" },
      ] : undefined;
      state.activeProfile = providerId === "hermes" ? "local" : undefined;
      if (providerId === "hermes") {
        state.sessions = state.sessions.map((session, index) => ({ ...session, profile: ["local", "resident", "research"][index % 3] }));
      }
      emit();
    },
    selectModel: async (provider, model) => {
      state.currentModelProvider = provider;
      state.currentModel = model;
      emit();
    },
    onSnapshot: (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
}

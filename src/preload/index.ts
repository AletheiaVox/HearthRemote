import { contextBridge, ipcRenderer } from "electron";
import type {
  AppSnapshot,
  ApprovalOption,
  HearthApi,
  HandoffMode,
  PromptAttachment,
  ProviderId,
  SaveSettingsInput,
} from "../shared/contracts";

const api: HearthApi = {
  clientKind: "desktop",
  getSnapshot: () => ipcRenderer.invoke("hearth:getSnapshot"),
  getSetupStatus: () => ipcRenderer.invoke("hearth:getSetupStatus"),
  openExternal: (url: string) => ipcRenderer.invoke("hearth:openExternal", url),
  connect: () => ipcRenderer.invoke("hearth:connect"),
  disconnect: () => ipcRenderer.invoke("hearth:disconnect"),
  refreshSessions: (search?: string) => ipcRenderer.invoke("hearth:refreshSessions", search),
  openSession: (sessionId: string) => ipcRenderer.invoke("hearth:openSession", sessionId),
  newSession: (cwd?: string, profile?: string) => ipcRenderer.invoke("hearth:newSession", cwd, profile),
  sendMessage: (text: string, attachments?: PromptAttachment[]) => ipcRenderer.invoke("hearth:sendMessage", text, attachments),
  interrupt: () => ipcRenderer.invoke("hearth:interrupt"),
  resolveApproval: (requestId: number | string, optionId: ApprovalOption["id"]) =>
    ipcRenderer.invoke("hearth:resolveApproval", requestId, optionId),
  answerQuestion: (requestId: number | string, answers: Record<string, string[]>) =>
    ipcRenderer.invoke("hearth:answerQuestion", requestId, answers),
  runHandoff: (mode: HandoffMode) => ipcRenderer.invoke("hearth:runHandoff", mode),
  saveSettings: (input: SaveSettingsInput) => ipcRenderer.invoke("hearth:saveSettings", input),
  selectProvider: (providerId: ProviderId) => ipcRenderer.invoke("hearth:selectProvider", providerId),
  selectModel: (provider: string, model: string) => ipcRenderer.invoke("hearth:selectModel", provider, model),
  onSnapshot: (callback: (snapshot: AppSnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot): void => callback(snapshot);
    ipcRenderer.on("hearth:snapshot", handler);
    return () => ipcRenderer.off("hearth:snapshot", handler);
  },
};

contextBridge.exposeInMainWorld("hearth", api);

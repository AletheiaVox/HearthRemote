import { app, BrowserWindow, ipcMain, Menu, shell } from "electron";
import { join } from "node:path";
import type {
  ApprovalOption,
  HandoffMode,
  PromptAttachment,
  ProviderId,
  SaveSettingsInput,
} from "../shared/contracts";
import { ProviderService } from "./provider-service";
import { ConfigStore } from "./config-store";
import { getSetupStatus } from "./setup-service";

let service: ProviderService | undefined;
let mainWindow: BrowserWindow | null = null;
const smokeTest = process.env.HEARTH_REMOTE_SMOKE_TEST === "1" || process.argv.includes("--hearth-smoke-test");
let closeInProgress = false;

function getService(): ProviderService {
  if (!service) throw new Error("Hearth Remote has not finished starting.");
  return service;
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 920,
    minHeight: 640,
    backgroundColor: "#100f16",
    title: "Hearth Remote",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault();
  });
  mainWindow.on("close", (event) => {
    if (smokeTest || closeInProgress) return;
    event.preventDefault();
    closeInProgress = true;
    void getService().disconnect().then(() => {
      mainWindow?.destroy();
    }).catch((error: unknown) => {
      closeInProgress = false;
      console.warn("Hearth Remote kept the window open because Codex is still working:", error);
    });
  });
  if (!smokeTest) mainWindow.once("ready-to-show", () => mainWindow?.show());

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  if (smokeTest) {
    const title = await mainWindow.webContents.executeJavaScript("document.title");
    if (title !== "Hearth Remote") throw new Error(`Renderer smoke test loaded an unexpected title: ${title}`);
    const bridgeReady = await mainWindow.webContents.executeJavaScript(
      "Boolean(window.hearth && typeof window.hearth.getSnapshot === 'function')",
    );
    if (!bridgeReady) throw new Error("Renderer smoke test did not find the secure preload bridge.");
    const setupReady = await mainWindow.webContents.executeJavaScript(
      "document.body.textContent.includes('Connect this computer to your AI host.') && document.body.textContent.includes('Tailscale')",
    );
    if (!setupReady) throw new Error("Renderer smoke test did not find the first-run setup wizard.");
    console.log("Hearth Remote production renderer, preload bridge, and first-run wizard smoke test passed.");
    app.exit(0);
  }
}

function registerIpc(): void {
  const providerService = getService();
  ipcMain.handle("hearth:getSnapshot", () => providerService.snapshot());
  ipcMain.handle("hearth:getSetupStatus", () => getSetupStatus());
  ipcMain.handle("hearth:openExternal", (_event, url: string) => {
    const allowed = new Set([
      "https://tailscale.com/download/windows",
      "https://tailscale.com/docs/how-to/quickstart",
      "https://tailscale.com/docs/features/tailscale-serve",
    ]);
    if (!allowed.has(url)) throw new Error("Hearth Remote refused to open an unexpected setup link.");
    return shell.openExternal(url);
  });
  ipcMain.handle("hearth:connect", () => providerService.connect());
  ipcMain.handle("hearth:disconnect", () => providerService.disconnect());
  ipcMain.handle("hearth:refreshSessions", (_event, search?: string) => providerService.refreshSessions(search));
  ipcMain.handle("hearth:openSession", (_event, sessionId: string) => providerService.openSession(sessionId));
  ipcMain.handle("hearth:newSession", (_event, cwd?: string, profile?: string) => providerService.newSession(cwd, profile));
  ipcMain.handle(
    "hearth:sendMessage",
    (_event, text: string, attachments?: PromptAttachment[]) => providerService.sendMessage(text, attachments),
  );
  ipcMain.handle("hearth:interrupt", () => providerService.interrupt());
  ipcMain.handle(
    "hearth:resolveApproval",
    (_event, requestId: number | string, optionId: ApprovalOption["id"]) => providerService.resolveApproval(requestId, optionId),
  );
  ipcMain.handle(
    "hearth:answerQuestion",
    (_event, requestId: number | string, answers: Record<string, string[]>) => providerService.answerQuestion(requestId, answers),
  );
  ipcMain.handle("hearth:runHandoff", (_event, mode: HandoffMode) => providerService.runHandoff(mode));
  ipcMain.handle("hearth:saveSettings", (_event, input: SaveSettingsInput) => providerService.saveSettings(input));
  ipcMain.handle("hearth:selectProvider", (_event, providerId: ProviderId) => providerService.selectProvider(providerId));
  ipcMain.handle("hearth:selectModel", (_event, provider: string, model: string) => providerService.selectModel(provider, model));

  providerService.onSnapshot((snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("hearth:snapshot", snapshot);
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
  ]));
  service = new ProviderService(new ConfigStore());
  await service.initialize();
  registerIpc();
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
}).catch((error: unknown) => {
  console.error("Hearth Remote failed during startup:", error);
  app.exit(1);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

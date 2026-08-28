import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const packageRoot = join(process.cwd(), "node_modules", "electron");
const executable = join(packageRoot, "dist", process.platform === "win32" ? "electron.exe" : "electron");

if (!existsSync(executable)) {
  const installer = join(packageRoot, "install.js");
  if (!existsSync(installer)) {
    throw new Error("The Electron package is missing. Run npm ci first.");
  }
  console.log("Downloading the Electron runtime required for Windows packaging and smoke tests…");
  const result = spawnSync(process.execPath, [installer], { stdio: "inherit" });
  if (result.status !== 0 || !existsSync(executable)) {
    throw new Error("Electron's runtime download did not complete.");
  }
}

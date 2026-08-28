import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { hostname } from "node:os";
import { promisify } from "node:util";
import type { SetupStatus } from "../shared/contracts";

const execFileAsync = promisify(execFile);

export async function getSetupStatus(): Promise<SetupStatus> {
  const executable = await findTailscale();
  if (!executable) {
    return {
      computerName: hostname(),
      tailscale: {
        installed: false,
        connected: false,
        message: "Tailscale is not installed on this computer yet.",
      },
    };
  }

  try {
    const [{ stdout: statusText }, { stdout: versionText }] = await Promise.all([
      execFileAsync(executable, ["status", "--json"], { windowsHide: true, timeout: 8_000 }),
      execFileAsync(executable, ["version"], { windowsHide: true, timeout: 8_000 }),
    ]);
    const status = JSON.parse(statusText) as {
      BackendState?: string;
      Self?: { DNSName?: string };
    };
    const connected = status.BackendState === "Running";
    return {
      computerName: hostname(),
      tailscale: {
        installed: true,
        connected,
        dnsName: status.Self?.DNSName?.replace(/\.$/, ""),
        version: versionText.trim().split(/\r?\n/)[0],
        message: connected
          ? "Tailscale is connected. This computer can reach devices in your private tailnet."
          : "Tailscale is installed but not connected. Open it from the system tray and sign in.",
      },
    };
  } catch (error) {
    return {
      computerName: hostname(),
      tailscale: {
        installed: true,
        connected: false,
        message: `Tailscale is installed, but Hearth Remote could not read its connection status: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
}

async function findTailscale(): Promise<string | undefined> {
  const candidates = [
    `${process.env.ProgramFiles || "C:\\Program Files"}\\Tailscale\\tailscale.exe`,
    `${process.env.LOCALAPPDATA || ""}\\Tailscale\\tailscale.exe`,
  ];
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { /* Keep looking. */ }
  }
  try {
    const { stdout } = await execFileAsync("where.exe", ["tailscale.exe"], { windowsHide: true, timeout: 5_000 });
    return stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  } catch {
    return undefined;
  }
}

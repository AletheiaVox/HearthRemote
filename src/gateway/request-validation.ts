import type { HandoffMode } from "../shared/contracts";

export function handoffModeArg(value: unknown): HandoffMode {
  if (value === "status" || value === "prepare" || value === "force") return value;
  throw new Error("Handoff mode must be status, prepare, or force.");
}

export function isAllowedBrowserOrigin(
  origin: string | undefined,
  configuredPublicOrigin: string | undefined,
  localPort: number,
): boolean {
  const candidate = canonicalOrigin(origin);
  if (!candidate) return false;

  if (configuredPublicOrigin) {
    const configured = canonicalOrigin(configuredPublicOrigin);
    return configured !== undefined && candidate === configured;
  }

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return false;
    const effectivePort = url.port || (url.protocol === "https:" ? "443" : "80");
    return effectivePort === String(localPort);
  } catch {
    return false;
  }
}

function canonicalOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

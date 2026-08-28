import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface PairedDevice {
  idHash: string;
  label: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
}

interface PairingRecord {
  code: string;
  expiresAt: string;
}

const SESSION_DAYS = 90;
const PAIRING_MINUTES = 30;

export class GatewayAuthStore {
  private readonly devicesPath: string;
  private readonly pairingPath: string;
  private devices: PairedDevice[] = [];
  private pairing!: PairingRecord;

  constructor(private readonly root: string) {
    this.devicesPath = join(root, "paired-devices.json");
    this.pairingPath = join(root, "pairing-code.json");
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.devicesPath, "utf8")) as PairedDevice[];
      this.devices = parsed.filter((device) => Date.parse(device.expiresAt) > Date.now());
    } catch {
      this.devices = [];
    }
    await this.persistDevices();
    await this.createPairingCode();
  }

  pairingInfo(): PairingRecord {
    return { ...this.pairing };
  }

  async pair(code: string, label: string): Promise<string | null> {
    const expected = Buffer.from(this.pairing.code);
    const supplied = Buffer.from(code.trim());
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    if (Date.parse(this.pairing.expiresAt) <= Date.now()) return null;

    const id = randomBytes(32).toString("base64url");
    const now = new Date();
    const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    this.devices.push({
      idHash: hashId(id),
      label: sanitizeLabel(label),
      createdAt: now.toISOString(),
      expiresAt: expires.toISOString(),
      lastSeenAt: now.toISOString(),
    });
    await this.persistDevices();
    await unlink(this.pairingPath).catch(() => undefined);
    this.pairing = { code: "", expiresAt: new Date(0).toISOString() };
    return id;
  }

  async authenticate(id: string | undefined): Promise<PairedDevice | null> {
    if (!id) return null;
    const idHash = hashId(id);
    const device = this.devices.find((candidate) => constantStringEqual(candidate.idHash, idHash));
    if (!device || Date.parse(device.expiresAt) <= Date.now()) return null;
    const lastSeen = Date.parse(device.lastSeenAt);
    if (!Number.isFinite(lastSeen) || Date.now() - lastSeen > 60 * 60 * 1000) {
      device.lastSeenAt = new Date().toISOString();
      await this.persistDevices();
    }
    return { ...device };
  }

  async revoke(id: string | undefined): Promise<void> {
    if (!id) return;
    const idHash = hashId(id);
    this.devices = this.devices.filter((device) => !constantStringEqual(device.idHash, idHash));
    await this.persistDevices();
  }

  private async createPairingCode(): Promise<void> {
    this.pairing = {
      code: String(randomInt(100_000, 1_000_000)),
      expiresAt: new Date(Date.now() + PAIRING_MINUTES * 60 * 1000).toISOString(),
    };
    await atomicWrite(this.pairingPath, JSON.stringify(this.pairing, null, 2));
  }

  private persistDevices(): Promise<void> {
    return atomicWrite(this.devicesPath, JSON.stringify(this.devices, null, 2));
  }
}

function hashId(id: string): string {
  return createHash("sha256").update(id).digest("base64url");
}

function constantStringEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sanitizeLabel(label: string): string {
  const clean = label.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);
  return clean || "My phone";
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, content, { encoding: "utf8", mode: 0o600 });
  await rename(temp, path);
}

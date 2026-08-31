import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { request as createRequest } from "node:http";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { createHermesProxy } from "./proxy";

const args = parseArgs(process.argv.slice(2));
const hermesExe = requiredPath(args["hermes-exe"], "Hermes executable");
const tokenFile = requiredPath(args["token-file"], "capability token");
const logRoot = resolve(required(args["log-root"], "log folder"));
const publicPort = portArg(args["public-port"] ?? "4510", "public port");
const backendPort = portArg(args["backend-port"] ?? "4511", "backend port");
if (publicPort === backendPort) throw new Error("Hermes bridge ports must be different.");

const token = readFileSync(tokenFile, "utf8").trim();
if (!/^[A-Za-z0-9_-]{40,256}$/.test(token)) throw new Error("The Hermes bridge capability token is invalid.");
mkdirSync(logRoot, { recursive: true });

const supervisorLog = resolve(logRoot, "bridge-supervisor.log");
const stdoutLog = resolve(logRoot, "serve.stdout.log");
const stderrLog = resolve(logRoot, "serve.stderr.log");
let child: ChildProcess | undefined;
let starting = false;
let stopping = false;

const proxy = createHermesProxy({ backendHost: "127.0.0.1", backendPort, token });
proxy.listen(publicPort, "127.0.0.1", () => log(`bridge ready on 127.0.0.1:${publicPort} -> 127.0.0.1:${backendPort}`));
proxy.on("error", (error) => fatal(`bridge listener failed: ${error.message}`));

void ensureBackend();
const monitor = setInterval(() => void ensureBackend(), 10_000);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void shutdown(signal));
}

async function ensureBackend(): Promise<void> {
  if (stopping || starting) return;
  if (await backendHealthy()) return;
  if (child && child.exitCode === null) return;

  starting = true;
  try {
    const environment = { ...process.env, HERMES_DASHBOARD_SESSION_TOKEN: token };
    delete environment.HERMES_DASHBOARD_PUBLIC_URL;
    const stdout = createWriteStream(stdoutLog, { flags: "a" });
    const stderr = createWriteStream(stderrLog, { flags: "a" });
    child = spawn(hermesExe, ["serve", "--host", "127.0.0.1", "--port", String(backendPort), "--skip-build"], {
      env: environment,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.pipe(stdout);
    child.stderr?.pipe(stderr);
    log(`started Hermes backend pid=${child.pid ?? "unknown"} port=${backendPort}`);
    child.once("error", (error) => log(`Hermes backend launch error: ${error.message}`));
    child.once("exit", (code, signal) => {
      stdout.end();
      stderr.end();
      log(`Hermes backend exited code=${String(code)} signal=${String(signal)}`);
      child = undefined;
      if (!stopping) setTimeout(() => void ensureBackend(), 2_000);
    });
  } finally {
    starting = false;
  }
}

function backendHealthy(): Promise<boolean> {
  return new Promise((resolveHealth) => {
    const request = createRequest({ host: "127.0.0.1", port: backendPort, path: "/api/status", method: "GET", timeout: 2_000 }, (response) => {
      response.resume();
      resolveHealth(response.statusCode === 200);
    });
    request.once("timeout", () => { request.destroy(); resolveHealth(false); });
    request.once("error", () => resolveHealth(false));
    request.end();
  });
}

async function shutdown(reason: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearInterval(monitor);
  log(`stopping bridge: ${reason}`);
  await new Promise<void>((resolveClose) => proxy.close(() => resolveClose()));
  if (child?.pid) spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
  process.exit(0);
}

function log(message: string): void {
  appendFileSync(supervisorLog, `${new Date().toISOString()} ${message}\n`, "utf8");
}

function fatal(message: string): never {
  log(message);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(values: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`Invalid Hermes bridge argument: ${key ?? ""}`);
    parsed[key.slice(2)] = value;
  }
  return parsed;
}

function required(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`Missing ${label}.`);
  return value.trim();
}

function requiredPath(value: string | undefined, label: string): string {
  const path = resolve(required(value, label));
  if (!existsSync(path)) throw new Error(`${label} does not exist: ${path}`);
  return path;
}

function portArg(value: string, label: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`Invalid ${label}: ${value}`);
  return port;
}

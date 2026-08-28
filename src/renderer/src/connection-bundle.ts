import type { SaveSettingsInput } from "../../shared/contracts";

export function parseConnectionBundle(text: string): SaveSettingsInput {
  const raw = JSON.parse(text.replace(/^\uFEFF/, "")) as Record<string, unknown>;
  if (raw.format !== undefined && raw.format !== "hearth-remote-connection") {
    throw new Error("That JSON file is not a Hearth Remote connection file.");
  }
  if (raw.version !== undefined && raw.version !== 1) {
    throw new Error(`Connection-file version ${String(raw.version)} is not supported by this Hearth Remote build.`);
  }
  const connection = (raw.connection && typeof raw.connection === "object" ? raw.connection : raw) as Record<string, unknown>;
  const imported: SaveSettingsInput = {
    hostName: requiredString(connection, "hostName"),
    endpoint: requiredString(connection, "endpoint"),
    hermesEndpoint: optionalString(connection, "hermesEndpoint"),
    defaultCwd: requiredString(connection, "defaultCwd"),
    handoffScriptPath: requiredString(connection, "handoffScriptPath"),
    hermesEnabled: connection.hermesEnabled === true,
    token: requiredString(connection, "token"),
  };
  if (!/^wss:\/\//i.test(imported.endpoint)) throw new Error("The connection file does not contain a secure Codex address.");
  if (imported.hermesEnabled && !/^wss:\/\//i.test(imported.hermesEndpoint)) throw new Error("The connection file does not contain a secure Hermes address.");
  if (!/^[A-Za-z0-9_-]{40,256}$/.test(imported.token ?? "")) throw new Error("The connection file contains an invalid capability token.");
  return imported;
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const result = value[key];
  if (typeof result !== "string" || !result.trim()) throw new Error(`The connection file is missing ${key}.`);
  return result.trim();
}

function optionalString(value: Record<string, unknown>, key: string): string {
  const result = value[key];
  return typeof result === "string" ? result.trim() : "";
}

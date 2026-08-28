import { describe, expect, it } from "vitest";
import { parseConnectionBundle } from "../connection-bundle";

const bundle = {
  format: "hearth-remote-connection",
  version: 1,
  connection: {
    hostName: "Hearth Desktop",
    endpoint: "wss://hearth.example.ts.net:4500",
    hermesEndpoint: "",
    defaultCwd: "C:\\Users\\me\\Documents",
    handoffScriptPath: "C:\\Users\\me\\.hearth-remote\\host\\handoff-desktop.ps1",
    hermesEnabled: false,
    token: "a".repeat(64),
  },
};

describe("connection-file import", () => {
  it("accepts the versioned file emitted by host setup", () => {
    expect(parseConnectionBundle(JSON.stringify(bundle))).toMatchObject({
      hostName: "Hearth Desktop",
      endpoint: "wss://hearth.example.ts.net:4500",
      hermesEnabled: false,
    });
  });

  it("rejects insecure remote endpoints", () => {
    const insecure = structuredClone(bundle);
    insecure.connection.endpoint = "ws://hearth.example.ts.net:4500";
    expect(() => parseConnectionBundle(JSON.stringify(insecure))).toThrow(/secure Codex address/);
  });

  it("rejects future formats instead of guessing", () => {
    expect(() => parseConnectionBundle(JSON.stringify({ ...bundle, version: 99 }))).toThrow(/not supported/);
  });
});

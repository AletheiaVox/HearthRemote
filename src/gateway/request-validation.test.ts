import { describe, expect, it } from "vitest";
import { handoffModeArg, isAllowedBrowserOrigin } from "./request-validation";

describe("gateway request validation", () => {
  it("accepts only the three supported handoff modes", () => {
    expect(handoffModeArg("status")).toBe("status");
    expect(handoffModeArg("prepare")).toBe("prepare");
    expect(handoffModeArg("force")).toBe("force");
    expect(() => handoffModeArg("surprise")).toThrow(/handoff mode/i);
  });

  it("pins browser requests to the configured public origin", () => {
    const origin = "https://hearth.example.ts.net:4520";
    expect(isAllowedBrowserOrigin(origin, origin, 4520)).toBe(true);
    expect(isAllowedBrowserOrigin("https://attacker.example", origin, 4520)).toBe(false);
    expect(isAllowedBrowserOrigin("http://127.0.0.1:4520", origin, 4520)).toBe(false);
  });

  it("allows only the listener's loopback origin when no public origin is configured", () => {
    expect(isAllowedBrowserOrigin("http://127.0.0.1:4520", undefined, 4520)).toBe(true);
    expect(isAllowedBrowserOrigin("http://localhost:4520", undefined, 4520)).toBe(true);
    expect(isAllowedBrowserOrigin("http://localhost:9999", undefined, 4520)).toBe(false);
    expect(isAllowedBrowserOrigin("https://hearth.example.ts.net:4520", undefined, 4520)).toBe(false);
  });
});

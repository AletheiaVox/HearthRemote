import { describe, expect, it } from "vitest";
import { nextReadingSize, readingSizeFromPinch } from "./reading-size";

describe("phone reading size", () => {
  it("turns an outward pinch into larger reflowing text", () => {
    expect(readingSizeFromPinch(24, 100, 125)).toBe(30);
    expect(readingSizeFromPinch(24, 100, 200)).toBe(36);
  });

  it("turns an inward pinch into smaller text and clamps the accessible range", () => {
    expect(readingSizeFromPinch(28, 140, 100)).toBe(20);
    expect(readingSizeFromPinch(20, 100, 20)).toBe(18);
  });

  it("cycles the button through readable presets", () => {
    expect(nextReadingSize(20)).toBe(24);
    expect(nextReadingSize(27)).toBe(28);
    expect(nextReadingSize(32)).toBe(20);
  });
});

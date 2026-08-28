export const READING_SIZE_MIN = 18;
export const READING_SIZE_MAX = 36;
export const READING_SIZE_DEFAULT = 24;
export const READING_SIZE_PRESETS = [20, 24, 28, 32] as const;

export function clampReadingSize(value: number): number {
  return Math.max(READING_SIZE_MIN, Math.min(READING_SIZE_MAX, Math.round(value)));
}

export function readingSizeFromPinch(startSize: number, startDistance: number, currentDistance: number): number {
  if (!Number.isFinite(startDistance) || startDistance <= 0) return clampReadingSize(startSize);
  return clampReadingSize(startSize * (currentDistance / startDistance));
}

export function nextReadingSize(current: number): number {
  return READING_SIZE_PRESETS.find((size) => size > current) ?? READING_SIZE_PRESETS[0];
}

// Shared numeric bound checks for module validation. Plain ESM, no imports.
//
// Every "must be between" / "must fall between" check in editorial-core and
// catalogues A, B and C compares with the same tolerance, and prints its
// bounds rounded to 2 decimals. Bounds are often computed (a scene duration
// minus a lead-out), so the same value can come out as 0.78 in one command and
// 0.7799999999999987 in another; without a shared tolerance `launchclip
// validate` passed status-rack `at: 0.78` while layout-check rejected it with
// "must be between 0.28 and 0.7799999999999987".
//
// Canonical copy: kit/core/bounds.mjs.

/** Tolerance for every bound comparison (seconds or px). */
export const BOUND_EPSILON = 1e-6;

/** True when min − ε ≤ value ≤ max + ε. */
export function withinBounds(value, min, max) {
  return value >= min - BOUND_EPSILON && value <= max + BOUND_EPSILON;
}

/** A bound as printed in messages: rounded to 2 decimals. */
export function formatBound(value) {
  if (!Number.isFinite(value)) return String(value);
  const rounded = Math.round(value * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

import { readFile } from "node:fs/promises";
import { profileGeometry } from "@launchclip/core/layout-check.mjs";
import { decodePng } from "./visual_snapshot.js";

// Still-based confirmation for the geometric layout check: measure what the
// renderer actually drew inside the declared rects.

const CONTRAST_ERROR = 3;
const CONTRAST_WARNING = 4.5;
// Two colours closer than this (RGB distance) are treated as one surface, so
// anti-aliased glyph edges do not count as the text colour.
const DISTINCT_COLOR_DISTANCE = 64;
const MINIMUM_FOREGROUND_SHARE = 0.005;

export function relativeLuminance([red, green, blue]) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

export function contrastRatio(a, b) {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Dominant colour inside rect is the background; the most frequent clearly
// different colour is the foreground (the text).
export function dominantColors(image, rect) {
  const box = clipRect(image, rect);
  if (!box) return { background: null, foreground: null, backgroundShare: 0, foregroundShare: 0, samples: 0 };
  const stride = Math.max(1, Math.floor(Math.sqrt((box.width * box.height) / 60_000)));
  const buckets = new Map();
  let samples = 0;
  for (let y = box.y; y < box.y + box.height; y += stride) {
    for (let x = box.x; x < box.x + box.width; x += stride) {
      const [red, green, blue] = pixel(image, x, y);
      const key = (red >> 3) << 10 | (green >> 3) << 5 | (blue >> 3);
      const bucket = buckets.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 };
      bucket.count += 1; bucket.red += red; bucket.green += green; bucket.blue += blue;
      buckets.set(key, bucket);
      samples += 1;
    }
  }
  const ranked = [...buckets.values()].sort((a, b) => b.count - a.count).map((bucket) => ({
    color: [bucket.red / bucket.count, bucket.green / bucket.count, bucket.blue / bucket.count].map(Math.round),
    share: bucket.count / samples
  }));
  const background = ranked[0];
  // Merge near-background buckets into the background before choosing text.
  const candidates = ranked.slice(1).filter((entry) => distance(entry.color, background.color) >= DISTINCT_COLOR_DISTANCE);
  const groups = [];
  for (const entry of candidates) {
    const group = groups.find((existing) => distance(existing.color, entry.color) < DISTINCT_COLOR_DISTANCE / 2);
    if (group) group.share += entry.share;
    else groups.push({ color: entry.color, share: entry.share });
  }
  groups.sort((a, b) => b.share - a.share);
  const foreground = groups[0] && groups[0].share >= MINIMUM_FOREGROUND_SHARE ? groups[0] : null;
  return {
    background: background.color,
    foreground: foreground?.color ?? null,
    backgroundShare: round(background.share),
    foregroundShare: round(foreground?.share ?? 0),
    samples
  };
}

export function checkTextContrast(image, elements, { canvas } = {}) {
  const findings = [];
  const measurements = [];
  for (const element of elements ?? []) {
    if (element.role !== "text" && element.role !== "hero" && element.role !== "caption") continue;
    if (!element.rect) continue;
    const colors = dominantColors(image, scaleRect(element.rect, canvas, image));
    if (!colors.foreground) {
      measurements.push({ id: element.id, ...colors, ratio: null });
      findings.push({ rule: "contrast", severity: "warning", ids: [element.id], detail: "no distinct text colour found inside the rect; text may be missing or nearly invisible" });
      continue;
    }
    const ratio = round(contrastRatio(colors.foreground, colors.background), 2);
    measurements.push({ id: element.id, ...colors, ratio });
    if (ratio < CONTRAST_WARNING) {
      findings.push({
        rule: "contrast",
        severity: ratio < CONTRAST_ERROR ? "error" : "warning",
        ids: [element.id],
        detail: `text ${hex(colors.foreground)} on ${hex(colors.background)} is ${ratio}:1; need at least ${ratio < CONTRAST_ERROR ? CONTRAST_ERROR : CONTRAST_WARNING}:1`
      });
    }
  }
  return { findings, measurements };
}

// Region below the safe-zone midpoint, inside the safe zone. Flat pixels there
// mean nothing occupies the lower third.
export function checkLowerThird(image, { canvas, profile, minimumStandardDeviation = 4, minimumEdgeRatio = 0.002 } = {}) {
  const frame = canvas ?? { width: image.width, height: image.height };
  const geometry = profileGeometry(frame, profile);
  const safe = geometry.safeZone;
  const midpoint = safe.y + safe.height / 2;
  const region = scaleRect({ x: safe.x, y: midpoint, width: safe.width, height: safe.y + safe.height - midpoint }, frame, image);
  const stats = regionStats(image, region);
  const empty = stats.lumaStandardDeviation < minimumStandardDeviation && stats.edgeRatio < minimumEdgeRatio;
  return {
    applies: Boolean(geometry.profile.lowerThird),
    region,
    empty,
    ...stats
  };
}

export function checkStill(image, elements = [], { canvas, profile, at = null } = {}) {
  const frame = canvas ?? { width: image.width, height: image.height };
  const contrast = checkTextContrast(image, elements, { canvas: frame });
  const lowerThird = checkLowerThird(image, { canvas: frame, profile });
  const findings = contrast.findings.map((finding) => ({ ...finding, at }));
  if (lowerThird.applies && lowerThird.empty) {
    findings.push({ rule: "lower-third-empty", severity: "warning", ids: [], at, detail: `lower third is flat (luma σ ${lowerThird.lumaStandardDeviation}, edge ratio ${lowerThird.edgeRatio})` });
  }
  return {
    status: findings.some((finding) => finding.severity === "error") ? "failed" : "passed",
    findings,
    contrast: contrast.measurements,
    lowerThird
  };
}

export async function checkStillFile(pngPath, elements = [], options = {}) {
  const image = decodePng(await readFile(pngPath));
  return { still: pngPath, ...checkStill(image, elements, options) };
}

function regionStats(image, region) {
  const box = clipRect(image, region);
  if (!box) return { lumaStandardDeviation: 0, edgeRatio: 0, samples: 0 };
  const stride = Math.max(1, Math.floor(Math.sqrt((box.width * box.height) / 60_000)));
  let samples = 0, sum = 0, squared = 0, comparisons = 0, edges = 0;
  for (let y = box.y; y < box.y + box.height; y += stride) {
    let previous = null;
    for (let x = box.x; x < box.x + box.width; x += stride) {
      const rgb = pixel(image, x, y);
      const luma = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      samples += 1; sum += luma; squared += luma * luma;
      if (previous) {
        comparisons += 1;
        if (Math.max(Math.abs(rgb[0] - previous[0]), Math.abs(rgb[1] - previous[1]), Math.abs(rgb[2] - previous[2])) >= 20) edges += 1;
      }
      previous = rgb;
    }
  }
  const mean = sum / samples;
  return {
    lumaStandardDeviation: round(Math.sqrt(Math.max(0, squared / samples - mean * mean)), 3),
    edgeRatio: round(comparisons ? edges / comparisons : 0, 6),
    samples
  };
}

function pixel(image, x, y) {
  const offset = (y * image.width + x) * 4;
  const alpha = image.pixels[offset + 3] / 255;
  return [0, 1, 2].map((channel) => Math.round(image.pixels[offset + channel] * alpha + 255 * (1 - alpha)));
}

function scaleRect(rect, canvas, image) {
  if (!canvas) return rect;
  const sx = image.width / canvas.width, sy = image.height / canvas.height;
  return { x: rect.x * sx, y: rect.y * sy, width: rect.width * sx, height: rect.height * sy };
}

function clipRect(image, rect) {
  const x0 = Math.max(0, Math.floor(rect.x)), y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(image.width, Math.ceil(rect.x + rect.width)), y1 = Math.min(image.height, Math.ceil(rect.y + rect.height));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function hex(rgb) {
  return `#${rgb.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

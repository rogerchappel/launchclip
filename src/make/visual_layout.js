// The layout check of a visual explainer: where every piece really lands.
//
// A scene is drawn as code, sight unseen. Asking for good layout in the
// prompt is not enough: a model places a saw blade over a heading, calls a
// prop with its arguments in the wrong order (the piece lands in the top-left
// corner), or sets a label wider than its plate. So the scenes are played in
// a real browser and measured:
//
//   - every scene is looked at up to six times (as it opens, after its
//     beats, at its middle, near its end), away from the cuts;
//   - each visible shape and piece of text is measured in frame pixels, with
//     the camera's push and punches taken out;
//   - a finding counts only once the piece has settled there (seen at two
//     looks, or at the piece's last look), so a piece still flying in is not
//     a fault.
//
// What it reports, per scene: text off the frame or outside the area where
// it can be read, a heading that anything passes over, text covered by
// something drawn after it, two pieces of text on top of each other, a label
// wider than its plate, pieces left unpositioned at the top-left corner or
// never brought onto the screen, and a scene that is close to empty.
//
//   layoutFaults(looks, options)   → the faults of one scene, from its measurements (pure)
//   faultScore(faults)             → how bad they are, for "is the redraw better"
//   faultLines(faults)             → the faults as lines for the illustrator
//   measureVisual(options)         → Map(sceneId → {faults, shapes, shown}), or null with no browser
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveStory } from "@launchclip/core/story.mjs";
import { gsapFile } from "../preview.js";

const MAX_LOOKS = 6;
// How far from a cut a look stays, so the transition's own motion is not measured.
const CUT_CLEARANCE = 0.45;
const WEIGHT = Object.freeze({ "text-off-frame": 3, "text-outside-zone": 2, "heading-covered": 3, "text-covered": 2, "text-overlap": 2, "label-overflow": 1, unplaced: 3, "never-on-screen": 0.5, sparse: 6 });
// Type from this size up is a heading: nothing may pass over it, even for a moment.
const HEADING_PX = 56;
// A redraw is asked for from this score up: one small overflow alone is left.
export const REDRAW_FROM = 2;

const area = (box) => Math.max(box.w, 1) * Math.max(box.h, 1);
const overlap = (a, b) => {
  const w = Math.min(a.x + Math.max(a.w, 1), b.x + Math.max(b.w, 1)) - Math.max(a.x, b.x);
  const h = Math.min(a.y + Math.max(a.h, 1), b.y + Math.max(b.h, 1)) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};
const near = (a, b, by) => Math.abs(a.x - b.x) <= by && Math.abs(a.y - b.y) <= by && Math.abs(a.w - b.w) <= by && Math.abs(a.h - b.h) <= by;
const where = (box) => `x ${box.x} to ${box.x + box.w}, y ${box.y} to ${box.y + box.h}`;
const named = (leaf) => (leaf.tag === "text" ? `text "${leaf.text}"` : `${leaf.tag} (fill ${leaf.fill})`);

/** When a scene is looked at: after its beats, at its middle and near its end, away from the cuts. */
export function lookTimes(scene) {
  const from = scene.start + CUT_CLEARANCE, to = scene.end - CUT_CLEARANCE;
  if (!(to > from)) return [Math.round(((scene.start + scene.end) / 2) * 100) / 100];
  const beats = (scene.beats ?? []).map((beat) => Number(beat.at) + 0.5).filter((at) => at > from && at < to);
  const times = [...new Set([from, ...beats, (from + to) / 2, to].map((at) => Math.round(at * 100) / 100))].sort((a, b) => a - b);
  if (times.length <= MAX_LOOKS) return times;
  const step = (times.length - 1) / (MAX_LOOKS - 1);
  return [...new Set(Array.from({ length: MAX_LOOKS }, (_, index) => times[Math.round(index * step)]))];
}

/**
 * The faults of one scene. looks: [{t, leaves: [{i, o (opacity), tag, box
 * {x, y, w, h} in frame pixels, fill, text?, size? (font px), plate? (the
 * box of the plate behind a label), covered? (how many of three points along
 * the text are painted over), coveredBy?}]}]. options: {canvas {width,
 * height}, zone (where text can be read: {x, y, width, height}), count (the
 * scene's shapes)}. → [{kind, at, what, box, shapes?}]
 */
export function layoutFaults(looks, { canvas, zone, count = 0 } = {}) {
  const frame = { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const read = { x: zone.x - 12, y: zone.y - 12, w: zone.width + 24, h: zone.height + 24 };
  const found = new Map(), lastSeen = new Map(), onFrame = new Set(), info = new Map();
  const note = (key, leaf, look, fault, other = null) => { const entry = found.get(key) ?? { leaf, other, looks: [] }; entry.looks.push(look); entry.fault = fault; found.set(key, entry); };
  for (const [look, { t, leaves }] of looks.entries()) {
    const seen = leaves.filter((leaf) => leaf.o >= 0.12 && area(leaf.box) < canvas.width * canvas.height * 0.6);
    for (const leaf of seen) {
      lastSeen.set(leaf.i, look); info.set(leaf.i, leaf);
      const box = leaf.box, off = 1 - overlap(box, frame) / area(box);
      // On the frame at all: a picture may bleed off an edge, so only a piece wholly off it is missing.
      if (off < 0.95) onFrame.add(leaf.i);
      if (leaf.tag !== "text" || off >= 0.95) continue;
      if (off > 0.02) { note(`off:${leaf.i}`, leaf.i, look, { kind: "text-off-frame", at: t, what: `${named(leaf)} is ${Math.round(off * 100)}% off the frame at ${where(box)}`, box }); continue; }
      const outside = 1 - overlap(box, read) / area(box);
      if (outside > 0.08) note(`zone:${leaf.i}`, leaf.i, look, { kind: "text-outside-zone", at: t, what: `${named(leaf)} at ${where(box)} is outside the area where text can be read (x ${zone.x} to ${zone.x + zone.width}, y ${zone.y} to ${zone.y + zone.height}); the platform's buttons and the captions cover the rest`, box });
      if (leaf.plate && (box.x < leaf.plate.x - 6 || box.x + box.w > leaf.plate.x + leaf.plate.w + 6)) note(`plate:${leaf.i}`, leaf.i, look, { kind: "label-overflow", at: t, what: `${named(leaf)} is ${box.w} px wide but the plate behind it is ${leaf.plate.w} px (text x ${box.x} to ${box.x + box.w}, plate x ${leaf.plate.x} to ${leaf.plate.x + leaf.plate.w})`, box });
      // A heading is covered when any part of it is, at any look (a blade passing over a title is seen); smaller text when most of it is, once settled.
      const heading = Number(leaf.size) >= HEADING_PX;
      if (leaf.covered >= (heading ? 1 : 2)) note(`cover:${leaf.i}`, leaf.i, look, { kind: heading ? "heading-covered" : "text-covered", at: t, what: `${named(leaf)} at ${where(box)} is covered by a ${leaf.coveredBy?.tag ?? "shape"} (fill ${leaf.coveredBy?.fill ?? "?"}) drawn after it${leaf.coveredBy?.box ? `, which sits at ${where(leaf.coveredBy.box)}` : ""}`, box });
    }
    // Two different pieces of text on top of each other (a shadow copy of the same words is not one).
    const texts = seen.filter((leaf) => leaf.tag === "text" && leaf.text && leaf.text.length > 2 && leaf.o >= 0.5).map((leaf) => ({ ...leaf, ink: { x: leaf.box.x, y: Math.round(leaf.box.y + leaf.box.h * 0.2), w: leaf.box.w, h: Math.round(leaf.box.h * 0.6) } }));
    for (let a = 0; a < texts.length; a += 1) for (let b = a + 1; b < texts.length; b += 1) {
      const A = texts[a], B = texts[b];
      if (A.text === B.text && near(A.box, B.box, 24)) continue;
      const share = overlap(A.ink, B.ink) / Math.min(area(A.ink), area(B.ink));
      if (share > 0.15) note(`over:${A.i}:${B.i}`, A.i, look, { kind: "text-overlap", at: t, what: `text "${A.text}" (${where(A.box)}) and text "${B.text}" (${where(B.box)}) overlap by ${Math.round(share * 100)}%`, box: A.box }, B.i);
    }
  }
  const settled = [...found.values()].filter((entry) => entry.fault.kind === "heading-covered" || entry.looks.length >= 2 || (entry.looks.at(-1) === lastSeen.get(entry.leaf) && (entry.other == null || entry.looks.at(-1) === lastSeen.get(entry.other)))).map((entry) => entry.fault);
  // Pieces that are drawn but never come onto the screen: shapes that touch are one piece.
  const missing = [...info].filter(([i, leaf]) => !onFrame.has(i) && area(leaf.box) > 900).map(([, leaf]) => leaf);
  const groups = [];
  for (const leaf of missing) {
    const grown = { x: leaf.box.x - 20, y: leaf.box.y - 20, w: leaf.box.w + 40, h: leaf.box.h + 40 };
    const touching = groups.filter((group) => group.some((member) => overlap(grown, member.box) > 0));
    const merged = [leaf, ...touching.flat()];
    for (const group of touching) groups.splice(groups.indexOf(group), 1);
    groups.push(merged);
  }
  for (const group of groups) {
    const x0 = Math.min(...group.map((leaf) => leaf.box.x)), y0 = Math.min(...group.map((leaf) => leaf.box.y));
    const box = { x: x0, y: y0, w: Math.max(...group.map((leaf) => leaf.box.x + leaf.box.w)) - x0, h: Math.max(...group.map((leaf) => leaf.box.y + leaf.box.h)) - y0 };
    const fills = [...new Set(group.filter((leaf) => leaf.tag !== "text").map((leaf) => leaf.fill))].slice(0, 4);
    const texts = group.filter((leaf) => leaf.tag === "text").map((leaf) => `"${leaf.text}"`).slice(0, 3);
    // A piece left at the top-left corner was never positioned; one parked off another edge may only be waiting for a cut.
    const unplaced = box.x < 60 && box.y < 60;
    settled.push({ kind: unplaced ? "unplaced" : "never-on-screen", at: looks.at(-1)?.t ?? null, shapes: group.length, what: `a piece of ${group.length} shape${group.length === 1 ? "" : "s"}${fills.length ? ` (fills ${fills.join(", ")})` : ""}${texts.length ? ` with text ${texts.join(", ")}` : ""} ${unplaced ? "sits at the top-left corner and never comes onto the screen (it was created but not positioned)" : "never comes onto the screen"}: it is at ${where(box)}`, box });
  }
  if (count && onFrame.size < 12) settled.push({ kind: "sparse", at: null, what: `only ${onFrame.size} of the scene's ${count} shapes are ever on screen: the scene is close to empty`, box: null });
  return settled;
}

/** How bad a scene's faults are: a redraw is kept only when this falls. */
export function faultScore(faults) {
  return Math.round(faults.reduce((sum, fault) => sum + (WEIGHT[fault.kind] ?? 1) * (1 + Math.min(fault.shapes ?? 1, 20) / 10), 0) * 10) / 10;
}

/** The faults as lines for the illustrator, worst first. */
export function faultLines(faults, limit = 14) {
  return [...faults].sort((a, b) => (WEIGHT[b.kind] ?? 1) - (WEIGHT[a.kind] ?? 1)).slice(0, limit).map((fault) => `- ${fault.at == null ? "" : `at ${fault.at} s: `}${fault.what}`);
}

// Runs in the page: one scene at one time → its visible leaves, in frame pixels with the camera taken out.
/* c8 ignore start */
function measureInPage([sceneId, t, width, height]) {
  const tl = Object.values(window.__timelines)[0];
  tl.time(t);
  const root = [...document.querySelectorAll("[data-launchclip-scene]")].find((el) => el.dataset.launchclipScene === sceneId && el.dataset.launchclipPart !== "behind");
  const stage = root?.querySelector(".lc-custom svg");
  if (!stage) return { missing: true, leaves: [] };
  const group = stage.querySelector(":scope > g") ?? stage;
  const inverse = group.getScreenCTM().inverse();
  const framed = (r) => {
    const points = [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(inverse));
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    return { x: Math.round(Math.min(...xs)), y: Math.round(Math.min(...ys)), w: Math.round(Math.max(...xs) - Math.min(...xs)), h: Math.round(Math.max(...ys) - Math.min(...ys)) };
  };
  const opacity = (el) => { let o = 1; for (let n = el; n && n !== root; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === "none" || cs.visibility === "hidden") return 0; o *= parseFloat(cs.opacity); if (o < 0.02) return 0; } return o; };
  const leaves = [...group.querySelectorAll("text, path, rect, circle, ellipse, line, polygon, polyline, image")].filter((el) => !el.closest("defs, clipPath, mask, pattern, marker, symbol, linearGradient, radialGradient, filter"));
  return { leaves: leaves.map((el, i) => {
    const o = opacity(el);
    if (!o) return { i, o: 0 };
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const out = { i, o: Math.round(o * 100) / 100, tag: el.tagName.toLowerCase(), box: framed(r), fill: cs.fill };
    if (out.tag !== "text") return out;
    out.text = el.textContent.trim().slice(0, 60);
    out.size = parseFloat(cs.fontSize) || 0;
    let covered = 0, by = null;
    for (const f of [0.2, 0.5, 0.8]) {
      const px = r.left + r.width * f, py = r.top + r.height * 0.5;
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      const top = document.elementFromPoint(px, py);
      if (!top || top === el || el.contains(top) || !group.contains(top)) continue;
      const tcs = getComputedStyle(top);
      if (top.tagName.toLowerCase() === "text" || tcs.fill === "none" || parseFloat(tcs.fillOpacity) < 0.6 || opacity(top) < 0.6) continue;
      if (el.compareDocumentPosition(top) & Node.DOCUMENT_POSITION_FOLLOWING) { covered += 1; by = { tag: top.tagName.toLowerCase(), fill: tcs.fill, box: framed(top.getBoundingClientRect()) }; }
    }
    if (covered) { out.covered = covered; out.coveredBy = by; }
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let plate = null;
    for (const sibling of el.parentElement.querySelectorAll(":scope > rect")) {
      const b = sibling.getBoundingClientRect();
      if (cx > b.left && cx < b.right && cy > b.top && cy < b.bottom && b.width < width * 0.9 && (!plate || b.width * b.height < plate.area)) plate = { ...framed(b), area: b.width * b.height };
    }
    if (plate) out.plate = { x: plate.x, y: plate.y, w: plate.w, h: plate.h };
    return out;
  }) };
}
/* c8 ignore stop */

/**
 * Play the scenes in a browser and measure them. options: {storyboard (the
 * visual explainer's), fragments [{file, html}], scenes (the director's:
 * {id, start, end, beats, captions}), area (visualArea), words, adapters
 * {browser (async () → a Playwright browser, or null), compile}}.
 * → Map(sceneId → {faults, shapes, shown, looks}), or null when no browser
 * could be found (the check is then skipped, with the reason in `skipped`).
 */
export async function measureVisual({ storyboard, fragments, scenes, area, words = [], adapters = {} } = {}) {
  const browser = await (adapters.browser ?? defaultBrowser)();
  if (!browser) return null;
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-layout-"));
  try {
    for (const fragment of fragments) {
      await mkdir(path.dirname(path.join(dir, fragment.file)), { recursive: true });
      await writeFile(path.join(dir, fragment.file), fragment.html);
    }
    // Only the scenes are measured: no sound, no captions, no cuts between them.
    const bare = { ...structuredClone(storyboard), audio: {}, overlays: [], scenes: structuredClone(storyboard.scenes).map(({ in: _in, out: _out, hits: _hits, ...scene }) => scene) };
    const resolved = resolveStory(bare, { words });
    const compile = adapters.compile ?? (await import("../../kit/hyperframes/story-compiler.mjs")).compileStoryToHyperFrames;
    const compiled = await compile(resolved, { projectDir: dir, sourceDir: dir });
    let html = compiled.html;
    const cdn = html.match(/<script src="(https:\/\/[^"]*gsap[^"]*)"><\/script>/);
    const library = gsapFile();
    if (cdn && library) html = html.replace(cdn[0], `<script>${await readFile(library, "utf8")}</script>`);
    await writeFile(path.join(dir, "composition.html"), html);
    const { width, height } = area.canvas;
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(pathToFileURL(path.join(dir, "composition.html")).href);
    await page.waitForFunction(() => window.__timelines && Object.keys(window.__timelines).length > 0, null, { timeout: 20000 });
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: ".lc-scene, .lc-scene * { pointer-events: auto !important; }" });
    const out = new Map();
    for (const scene of scenes) {
      const times = lookTimes(scene);
      const looks = [];
      let count = 0;
      for (const t of times) {
        const measured = await page.evaluate(measureInPage, [scene.id, t, width, height]);
        if (measured.missing) break;
        count = measured.leaves.length;
        looks.push({ t, leaves: measured.leaves.filter((leaf) => leaf.o > 0) });
      }
      // A scene with its captions hidden may set type in the caption strip too.
      const zone = scene.captions === "hide" ? { ...area.text, height: area.strip.y + area.strip.height - area.text.y } : area.text;
      const faults = looks.length ? layoutFaults(looks, { canvas: area.canvas, zone, count }) : [{ kind: "sparse", at: null, what: "the scene is not on the page", box: null }];
      out.set(scene.id, { faults, shapes: count, shown: new Set(looks.flatMap((look) => look.leaves.map((leaf) => leaf.i))).size, looks: times });
    }
    return out;
  } finally {
    await browser.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
}

/** Playwright's Chromium, a system Chrome or the renderers' browser; null when there is none. */
async function defaultBrowser() {
  const { chromiumSearch, loadPlaywright } = await import("../demo/record.js");
  const chromium = await loadPlaywright();
  if (!chromium) return null;
  let pinned = null;
  try { pinned = chromium.executablePath(); } catch { pinned = null; }
  const search = await chromiumSearch({ playwrightPath: pinned });
  if (!search.path) return null;
  try { return await chromium.launch({ executablePath: search.path }); } catch { return null; }
}

// The taste linter: deterministic rules beyond schema validity. The schema
// answers "is it renderable"; this answers "is it good". Failures go back to
// the Director for repair; advisories are reported but don't block.
// Every recurring critic/human finding should graduate into a rule here.

const MAX_DEAD_AIR_SECONDS = 1.5;
const WORD_SNAP_TOLERANCE = 0.12;

// Scene types whose surface is continuously alive (footage plays, typing
// types, feeds scroll) vs. those alive only when an item lands.
const CONTINUOUS_SCENES = new Set(["talking_head", "screen", "prompt_card"]);

export function lintTimeline(timeline, { direction = null, assets = [] } = {}) {
  const failures = [];
  const advisories = [];

  checkCoverage(timeline, failures);
  checkDensity(timeline, failures);
  checkWordGrounding(timeline, failures, advisories);
  checkBudgets(timeline, failures, advisories);
  if (direction) checkDirectionHonored(timeline, direction, failures);
  if (assets.length) checkAssetsExist(timeline, assets, failures);

  return { ok: failures.length === 0, failures, advisories };
}

function sceneActivityTimes(scene) {
  const times = [scene.start];
  for (const item of scene.items ?? []) times.push(item.at);
  if (scene.type === "stat_counter" || scene.type === "quote_card") {
    times.push(scene.at, scene.at + 1.0);
  }
  return times;
}

function checkCoverage(timeline, failures) {
  const scenes = timeline.scenes ?? [];
  if (!scenes.length) {
    failures.push("no scenes — the timeline must be fully scene-driven");
    return;
  }
  const last = scenes[scenes.length - 1];
  if (scenes[0].start > 0.05) failures.push("first scene must start at 0");
  if (last.end < timeline.duration_seconds - 0.3) {
    failures.push(`scenes end at ${last.end}s but the video runs ${timeline.duration_seconds}s — cover the tail`);
  }
}

// Nothing may sit dead longer than MAX_DEAD_AIR_SECONDS: in a non-continuous
// scene, something must land at least that often.
function checkDensity(timeline, failures) {
  for (const scene of timeline.scenes ?? []) {
    if (CONTINUOUS_SCENES.has(scene.type) && scene.type !== "talking_head") continue;
    if (scene.type === "screenshot_pile" && scene.mode === "scroll") continue;
    const isSplitFace = scene.type === "talking_head";
    // Overlay events mark activity at both ends: the entrance and the
    // spring-out release are each visible transforms.
    const overlayMarks = (timeline.events ?? [])
      .filter((event) => event.end > scene.start && event.start < scene.end)
      .flatMap((event) => [event.start, event.end])
      .filter((time) => time >= scene.start && time <= scene.end);
    const marks = [...sceneActivityTimes(scene), ...overlayMarks].sort((a, b) => a - b);
    let previous = scene.start;
    for (const mark of [...marks, scene.end]) {
      const gap = mark - previous;
      const limit = isSplitFace ? MAX_DEAD_AIR_SECONDS * 2 : MAX_DEAD_AIR_SECONDS;
      if (gap > limit) {
        failures.push(
          `scene "${scene.id}" (${scene.type}) is idle for ${gap.toFixed(1)}s after t=${previous.toFixed(1)} — add an item, event, or split the scene (max ${limit}s)`
        );
        break;
      }
      previous = Math.max(previous, mark);
    }
  }
}

// Every build lands on a spoken word: item.at must match a word start.
function checkWordGrounding(timeline, failures, advisories) {
  const words = timeline.words ?? [];
  if (!words.length) {
    advisories.push("no word timings — builds cannot be verified against speech");
    return;
  }
  const starts = words.map((word) => word.start);
  for (const scene of timeline.scenes ?? []) {
    for (const item of scene.items ?? []) {
      const nearest = starts.reduce((best, start) => (Math.abs(start - item.at) < Math.abs(best - item.at) ? start : best), starts[0]);
      if (Math.abs(nearest - item.at) > WORD_SNAP_TOLERANCE) {
        failures.push(
          `scene "${scene.id}" item "${item.text || item.src}" lands at ${item.at}s, not on a word start (nearest: ${nearest}s) — builds land on speech`
        );
      }
    }
  }
}

function checkBudgets(timeline, failures, advisories) {
  const scenes = timeline.scenes ?? [];
  const zooms = (timeline.events ?? []).filter((event) => event.type === "punch_zoom");
  for (const scene of scenes) {
    const inScene = zooms.filter((event) => event.start >= scene.start && event.start < scene.end);
    if (inScene.length > 1) {
      failures.push(`scene "${scene.id}" has ${inScene.length} punch_zooms — at most one per scene`);
    }
  }
  if (scenes.length > 2) {
    const travels = scenes.slice(1).filter((scene) => scene.transition !== "cut").length;
    const share = travels / (scenes.length - 1);
    if (share === 0) failures.push("every transition is a hard cut — the camera must travel (swipe/zoom) for most moves");
    else if (share < 0.4 || share > 0.9) advisories.push(`travel-transition share is ${(share * 100).toFixed(0)}% — reference sits around 40-80%`);
  }
  // Emphasis-color ration: at most one emphasised word per typography scene.
  for (const scene of scenes) {
    if (scene.type !== "typography") continue;
    const emphasised = (scene.items ?? []).filter((item) => item.emphasis).length;
    if (emphasised > 2) failures.push(`scene "${scene.id}" has ${emphasised} emphasised words — accent is rationed (max 2, prefer 1)`);
  }
}

// The creative direction is a contract: requested steps/lines/assets must
// actually appear. This is what makes direction reliable rather than hopeful.
function checkDirectionHonored(timeline, direction, failures) {
  const haystack = JSON.stringify(timeline).toLowerCase();
  for (const must of direction.must_include ?? []) {
    const items = must.items ?? (must.text ? [must.text] : []);
    for (const text of items) {
      const needle = String(text).toLowerCase().slice(0, 40);
      const tokens = needle.split(/\s+/).filter((token) => token.length > 3);
      const present = tokens.length ? tokens.filter((token) => haystack.includes(token)).length / tokens.length >= 0.5 : haystack.includes(needle);
      if (!present) failures.push(`direction not honored: "${text}" does not appear in any scene`);
    }
  }
  if ((direction.chapters ?? []).length >= 2 && !(timeline.chapters ?? []).length) {
    failures.push("direction not honored: chapters were requested but the timeline has no chapter rail");
  }
  for (const ref of direction.asset_refs ?? []) {
    const base = String(ref.path).split("/").pop();
    if (!JSON.stringify(timeline).includes(base)) {
      failures.push(`direction not honored: asset "${ref.path}" (${ref.role ?? "asset"}) is never placed`);
    }
  }
}

// Every src the timeline references must exist in the manifest (or public/).
function checkAssetsExist(timeline, assets, failures) {
  const known = new Set(assets.map((asset) => asset.path));
  const srcs = [];
  for (const scene of timeline.scenes ?? []) {
    if (scene.src) srcs.push(scene.src);
    for (const item of scene.items ?? []) if (item.src) srcs.push(item.src);
  }
  for (const event of timeline.events ?? []) if (event.src) srcs.push(event.src);
  for (const src of srcs) {
    if (!known.has(src)) failures.push(`unknown asset "${src}" — only use paths from the asset manifest`);
  }
}

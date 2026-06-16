// The taste linter: deterministic rules beyond schema validity. The schema
// answers "is it renderable"; this answers "is it good". Failures go back to
// the Director for repair; advisories are reported but don't block.
// Every recurring critic/human finding should graduate into a rule here.

const MAX_DEAD_AIR_SECONDS = 1.5;
const MAX_REFERENCE_IDLE_SECONDS = 1.2;
const WORD_SNAP_TOLERANCE = 0.12;
const ITEM_BUILD_SECONDS = 0.55;
const STEP_FILLER_WORDS = new Set(["first", "next", "finally", "point", "and", "then", "use", "build", "it", "to"]);

// Scene types whose surface is continuously alive (footage plays, typing
// types, feeds scroll) vs. those alive only when an item lands.
const CONTINUOUS_SCENES = new Set(["talking_head", "screen", "prompt_card", "magnifier", "terminal_receipt"]);

export function lintTimeline(timeline, { direction = null, assets = [], presenterSrc = null, referenceGrade = false } = {}) {
  const failures = [];
  const advisories = [];

  checkCoverage(timeline, failures);
  checkDensity(timeline, failures, { maxDeadAirSeconds: referenceGrade ? MAX_REFERENCE_IDLE_SECONDS : MAX_DEAD_AIR_SECONDS });
  checkWordGrounding(timeline, failures, advisories);
  checkBudgets(timeline, failures);
  if (referenceGrade) checkReferenceGrade(timeline, failures);
  if (direction) checkDirectionHonored(timeline, direction, failures);
  if (assets.length) checkAssetsExist(timeline, assets, failures);
  if (presenterSrc) {
    for (const scene of timeline.scenes ?? []) {
      if (scene.type === "talking_head" && scene.src !== presenterSrc) {
        failures.push(`scene "${scene.id}" uses "${scene.src}" — talking_head scenes must use the presenter take "${presenterSrc}"`);
      }
    }
  }

  return { ok: failures.length === 0, failures, advisories };
}

function sceneActivityTimes(scene) {
  const times = [scene.start];
  for (const item of scene.items ?? []) {
    times.push(item.at, Math.min(scene.end, item.at + ITEM_BUILD_SECONDS));
  }
  if (scene.type === "stat_counter" || scene.type === "quote_card") {
    times.push(scene.at, scene.at + 1.0);
  }
  // A funnel branch and a profile_cards total are each a landing transform.
  if (scene.branch?.at !== undefined) times.push(scene.branch.at);
  if (scene.total?.at !== undefined) times.push(scene.total.at, scene.total.at + 1.0);
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
function checkDensity(timeline, failures, { maxDeadAirSeconds }) {
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
      const limit = isSplitFace ? maxDeadAirSeconds * 2 : maxDeadAirSeconds;
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

function checkReferenceGrade(timeline, failures) {
  const scenes = timeline.scenes ?? [];
  const sceneTypes = new Set(scenes.map((scene) => scene.type));
  if (sceneTypes.size < 4) {
    failures.push(`reference-grade timeline uses ${sceneTypes.size} scene types — use at least 4 for visual range`);
  }
  if (!scenes.some((scene) => scene.type === "artifact_grid" || scene.type === "terminal_receipt")) {
    failures.push("reference-grade timeline needs proof: include artifact_grid or terminal_receipt");
  }

  let repeated = 1;
  for (let index = 1; index < scenes.length; index += 1) {
    repeated = scenes[index].type === scenes[index - 1].type ? repeated + 1 : 1;
    if (repeated >= 3) {
      failures.push(`scene type "${scenes[index].type}" repeats ${repeated} times in a row — vary the visual grammar`);
      break;
    }
  }

  const counts = new Map();
  for (const scene of scenes) counts.set(scene.type, (counts.get(scene.type) ?? 0) + 1);
  for (const [type, count] of counts.entries()) {
    if (count >= 3 && count / Math.max(1, scenes.length) > 0.3) {
      failures.push(`scene type "${type}" appears ${count}/${scenes.length} times — reference-grade cuts need more visual families`);
    }
  }

  for (const scene of scenes) {
    if (scene.type === "card_steps") {
      const weakItems = (scene.items ?? []).filter((item) => isWeakStepLabel(item.text));
      if (weakItems.length) {
        failures.push(
          `card_steps "${scene.id}" uses caption fragments (${weakItems.map((item) => `"${item.text}"`).join(", ")}) — numbered cards must be real steps`
        );
      }
    }
    if (scene.type === "icon_flow" || scene.type === "funnel") {
      const weakItems = (scene.items ?? []).filter((item) => isFillerLabel(item.text));
      if (weakItems.length) {
        failures.push(
          `${scene.type} "${scene.id}" uses filler labels (${weakItems.map((item) => `"${item.text}"`).join(", ")}) — diagram labels must name concrete objects or actions`
        );
      }
    }
    if (scene.type === "magnifier" && /(^|\/)proof-[^/]+\.svg$/i.test(scene.src)) {
      failures.push(`magnifier "${scene.id}" uses generated proof card "${scene.src}" — use screenshot_pile or artifact_grid for proof cards`);
    }
    if (scene.type === "artifact_grid") {
      const missing = (scene.items ?? []).filter((item) => !item.path && !item.src).length;
      if (missing) failures.push(`artifact_grid "${scene.id}" has ${missing} item(s) without a path or src proof reference`);
    }
    if (scene.type === "terminal_receipt" && !String(scene.output ?? "").trim()) {
      failures.push(`terminal_receipt "${scene.id}" needs real output text, not just a command`);
    }
  }
}

function isWeakStepLabel(text) {
  const value = String(text ?? "").trim().toLowerCase();
  if (!value) return true;
  if (isFillerLabel(value)) return true;
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length === 1 && value.length < 8) return true;
  return false;
}

function isFillerLabel(text) {
  return STEP_FILLER_WORDS.has(String(text ?? "").trim().toLowerCase());
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

function checkBudgets(timeline, failures) {
  const scenes = timeline.scenes ?? [];
  const zooms = (timeline.events ?? []).filter((event) => event.type === "punch_zoom");
  for (const scene of scenes) {
    const inScene = zooms.filter((event) => event.start >= scene.start && event.start < scene.end);
    if (inScene.length > 1) {
      failures.push(`scene "${scene.id}" has ${inScene.length} punch_zooms — at most one per scene`);
    }
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
    for (const item of scene.items ?? []) {
      if (item.src) srcs.push(item.src);
      if (item.icon) srcs.push(item.icon);
      if (item.avatar) srcs.push(item.avatar);
    }
    for (const icon of scene.icons ?? []) srcs.push(icon);
  }
  for (const event of timeline.events ?? []) if (event.src) srcs.push(event.src);
  for (const src of srcs) {
    if (!known.has(src)) failures.push(`unknown asset "${src}" — only use paths from the asset manifest`);
  }
}

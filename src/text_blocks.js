// One idea per frame (docs/EXPLAINER_CLAIMS_RFC.md §3.3): how many text
// blocks are on screen at once. A frame with a title, a sub-line, two bullets
// and the captions reads as a slide, not a shot. Read from the layout check's
// declared rects, so the plan (before any render) and finish (on the resolved
// story) get the same verdict, as the visual-density gate does.
//
//   textBlockFindings(story, rects) → layout findings (rule "text-blocks"); the
//   planner reports them with its other layout findings, so an error one is a
//   repair note, as visualDensityErrors' are.
//
// A block is one scene's text: its own element and its parts merged, so a
// title with its sub-line is one block, one list's bullets are one block and a
// module whose job is text (comparison-table, a list, item-list, cta) counts
// once. Captions, decor and media are not blocks; nor are the brand frame's
// counter and progress bar, which are drawn outside the scene rects.
// A scene may hold two blocks with allow_text: 2 and a why (validated in kit/core/story.mjs).

export const TEXT_BLOCKS = Object.freeze({
  // More than one block for longer than this (s) is busy.
  busySeconds: 1,
  // This many blocks at once is crowded, however briefly.
  crowded: 3,
  // Ships as a warning for one release (RFC §6), the crowded case included. Make the crowded
  // case "error" (a planner repair note and a failed finish layout gate) once the planner meets it in most runs.
  severity: "warning"
});

const BLOCK_ROLES = new Set(["text", "hero"]);
const EPS = 1e-6;
const round = (value) => Math.round(value * 100) / 100;

/**
 * story: a resolved story (scenes with id, allow_text, why); rects: [{id, role,
 * rect, start, end, hide?}] (checkLayoutProject().rects, or the planner's
 * layout elements). → [{rule: "text-blocks", severity, at, ids, detail}]
 */
export function textBlockFindings(story, rects = [], options = {}) {
  const k = { ...TEXT_BLOCKS, ...options };
  const scenes = (story?.scenes ?? []).filter((scene) => scene?.id != null).map((scene) => ({ id: String(scene.id), allow: scene.allow_text === 2 && typeof scene.why === "string" && scene.why.trim() ? 2 : 1 }));
  // An element belongs to the scene whose id it is, or whose id prefixes it ("<scene>-<part>"); the longest such id wins.
  const sceneOf = (id) => scenes.filter((scene) => id === scene.id || id.startsWith(`${scene.id}-`)).sort((a, b) => b.id.length - a.id.length)[0] ?? { id, allow: 1 };
  const live = (entry, t) => entry.start <= t + EPS && entry.end > t + EPS && !(entry.hide ?? []).some(([a, b]) => a <= t + EPS && b > t + EPS);
  const texts = rects.filter((entry) => BLOCK_ROLES.has(entry.role) && entry.rect && Number(entry.end) > Number(entry.start)).map((entry) => ({ ...entry, start: Number(entry.start), end: Number(entry.end), scene: sceneOf(String(entry.id)) }));
  const captions = rects.filter((entry) => entry.role === "caption");
  const cuts = [...new Set(texts.flatMap((entry) => [entry.start, entry.end, ...(entry.hide ?? []).flat()]))].sort((a, b) => a - b);
  // Spans between cuts with the blocks on screen in each (sampled at the span's middle).
  const spans = [];
  for (let i = 0; i + 1 < cuts.length; i += 1) {
    const from = cuts[i], to = cuts[i + 1], t = (from + to) / 2;
    if (to - from < EPS) continue;
    const blocks = new Map();
    for (const entry of texts) if (live(entry, t)) blocks.set(entry.scene.id, entry.scene);
    const allowed = Math.max(1, ...[...blocks.values()].map((scene) => scene.allow));
    spans.push({ from, to, t, ids: [...blocks.keys()], count: blocks.size, over: blocks.size > allowed });
  }
  const findings = [];
  const note = (t) => (captions.some((entry) => live(entry, t))
    ? "the captions already say the words, so cut the sub-line or the bullets rather than shrinking them"
    : "keep one idea on screen: cut the sub-line or the bullets, or give each its own beat");
  // Runs of adjacent over-limit spans: busy when the run lasts over busySeconds, crowded where it reaches `crowded` blocks.
  for (let i = 0; i < spans.length;) {
    if (!spans[i].over) { i += 1; continue; }
    let j = i;
    while (j + 1 < spans.length && spans[j + 1].over && Math.abs(spans[j + 1].from - spans[j].to) < EPS) j += 1;
    const run = spans.slice(i, j + 1), from = run[0].from, to = run.at(-1).to;
    const ids = [...new Set(run.flatMap((span) => span.ids))];
    const peak = run.reduce((best, span) => (span.count > best.count ? span : best));
    if (peak.count >= k.crowded) {
      findings.push({ rule: "text-blocks", severity: k.severity, at: round(peak.from), ids: peak.ids,
        detail: `${peak.count} text blocks at once from ${round(peak.from)} s to ${round(peak.to)} s (${peak.ids.join(", ")}); ${note(peak.t)}` });
    } else if (to - from > k.busySeconds + EPS) {
      findings.push({ rule: "text-blocks", severity: k.severity, at: round(from), ids,
        detail: `${peak.count} text blocks on screen for ${round(to - from)} s (${round(from)}–${round(to)} s: ${ids.join(", ")}); ${note(run[0].t)}, or set allow_text: 2 with a why on the scene that needs both` });
    }
    i = j + 1;
  }
  return findings;
}


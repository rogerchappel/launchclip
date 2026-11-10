// Critic-driven repair for `launchclip make` (src/make/index.js stageCritic).
//
// The headless critic (src/make/critic.js) reviews the render and asks to
// ship, repair or replan. With rounds left (--critic-repairs, default 3),
// make turns its findings into known problems for the planner, re-plans
// (a targeted repair of the scenes named, or one whole new plan), renders
// again (only the changed scenes when the timeline held) and asks the
// critic again. A round that does not lower the blocking and major findings
// is undone: make never ships a worse cut than the one it had.
//
// The pure parts live here; the stage wiring lives in src/make/index.js.

export const DEFAULT_CRITIC_REPAIRS = 3;
export const MAX_CRITIC_REPAIRS = 3;
const MAX_PROBLEMS = 12;
const SEVERITY_ORDER = { blocking: 0, major: 1, minor: 2 };

/** --critic-repairs → rounds (0 to MAX_CRITIC_REPAIRS; default DEFAULT_CRITIC_REPAIRS). */
export function criticRepairBudget(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_CRITIC_REPAIRS;
  const rounds = Number(value);
  if (!Number.isFinite(rounds) || rounds < 0) throw new Error(`--critic-repairs must be a whole number from 0 to ${MAX_CRITIC_REPAIRS}; got ${value}`);
  return Math.min(MAX_CRITIC_REPAIRS, Math.floor(rounds));
}

/** A critique → {verdict, blocking, major, minor, total}. */
export function criticScore(critique) {
  const findings = Array.isArray(critique?.findings) ? critique.findings : [];
  const count = (severity) => findings.filter((finding) => finding?.severity === severity).length;
  return { verdict: critique?.verdict ?? null, blocking: count("blocking"), major: count("major"), minor: count("minor"), total: findings.length };
}

/** Whether `after` is a better cut than `before`: it ships where before did not, or it has fewer blocking + major findings. */
export function criticImproved(before, after) {
  if (!after?.verdict) return false;
  if (after.verdict === "ship" && before?.verdict !== "ship") return true;
  return after.blocking + after.major < before.blocking + before.major;
}

/** The base-track scene playing at `seconds` in a resolved story, else the overlay scene there. */
export function sceneAt(scenes, seconds) {
  const at = Number(seconds);
  if (!Number.isFinite(at)) return null;
  const playing = (scenes ?? []).filter((scene) => Number(scene?.start) <= at && at < Number(scene?.end));
  return (playing.find((scene) => (scene.track ?? 0) === 0) ?? playing[0])?.id ?? null;
}

/**
 * The scenes each finding is about: its evidence ids → the evidence
 * manifest's sample times → the resolved scene playing then.
 * → findings with `scenes: [ids]` (empty when nothing maps).
 */
export function findingScenes(findings, manifestEntries, resolvedScenes) {
  const times = new Map((manifestEntries ?? []).map((entry) => [entry.evidence_id, entry.at_seconds]));
  return (findings ?? []).map((finding) => {
    const ids = new Set();
    for (const id of finding?.evidence_ids ?? []) {
      const scene = sceneAt(resolvedScenes, times.get(id));
      if (scene) ids.add(scene);
    }
    return { ...finding, scenes: [...ids] };
  });
}

/**
 * "replan" when the critic asked for one, or a blocking or major narrative
 * finding sits on the opening scene (the hook): a whole new plan. Otherwise
 * "repair": the planner fixes the scenes named and keeps the rest.
 */
export function criticRepairRoute(critique, findings, openingSceneId) {
  if (critique?.verdict === "replan") return "replan";
  const hookProblem = (findings ?? []).some((finding) => finding.category === "narrative" && ["blocking", "major"].includes(finding.severity) && openingSceneId && finding.scenes?.includes(openingSceneId));
  return hookProblem ? "replan" : "repair";
}

/** The findings a round acts on: worst first, at most MAX_PROBLEMS. */
export function criticFindings(findings) {
  return [...(findings ?? [])]
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3))
    .slice(0, MAX_PROBLEMS);
}

/** Findings → the planner's known problems, worst first, prefixed "critic" (one line per criticFindings entry). */
export function criticProblems(findings) {
  return criticFindings(findings)
    .map((finding) => `critic (${finding.severity} ${finding.category}${finding.scenes?.length ? `, scene${finding.scenes.length === 1 ? "" : "s"} ${finding.scenes.join(", ")}` : ""}): ${String(finding.message ?? "").trim()}`);
}

/** The brief section a replan round adds: what the critic saw in the last cut. */
export function criticBriefSection(problems) {
  return ["", "## A reviewer watched the last cut", "", "Plan again so none of these happen:", "", ...problems.map((line) => `- ${line}`), ""].join("\n");
}

/**
 * The scenes to re-render after a repair: the ids whose scene changed, when
 * the timeline held (same scene ids in the same order with the same resolved
 * times, and nothing outside the scenes changed). null → render it all.
 */
export function changedScenes(before, after) {
  const scenes = (story) => story?.scenes ?? [];
  const a = scenes(before);
  const b = scenes(after);
  if (a.length !== b.length) return null;
  const rest = (story) => JSON.stringify({ ...story, scenes: undefined, meta: undefined });
  if (rest(before) !== rest(after)) return null;
  const changed = [];
  for (const [index, scene] of a.entries()) {
    const other = b[index];
    if (scene.id !== other.id || Number(scene.start) !== Number(other.start) || Number(scene.end) !== Number(other.end)) return null;
    if (JSON.stringify(scene) !== JSON.stringify(other)) changed.push(scene.id);
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Retakes (docs/ANIMATION_PIPELINE_RFC.md §4.7): a character story is fixed a
// shot at a time, by the cheapest step that could work. The pure parts are
// here; the rounds run in src/make/retakes.js.
//
//   step 1 "redirect":     the failing shot's cues, framing or set
//   step 2 "drop-hand-in": that shot's handed-in art (the hand-in phases)
//   step 3 "replan-beat":  every shot of the story beat the failing shot is in
//
// A retake never moves a shot's start or end: the animatic locked the timing.

export const RETAKES_SCHEMA = "launchclip.retakes.v1";
export const RETAKES_FILE = "qa/retakes.json";
export const RETAKE_STEPS = Object.freeze(["redirect", "drop-hand-in", "replan-beat"]);

const failing = (finding) => finding?.severity === "blocking" || finding?.severity === "major";

/**
 * The shots the blocking and major findings name, smallest first.
 * findings: findingScenes() output; shots: the shot list's shots.
 * → [{id, frames, beats, findings: [finding ids], categories}]
 */
export function failingShots(findings, shots) {
  const byId = new Map((shots ?? []).map((shot) => [shot.id, shot]));
  const named = new Map();
  for (const finding of (findings ?? []).filter(failing)) {
    for (const id of finding.scenes ?? []) {
      if (!byId.has(id)) continue;
      if (!named.has(id)) named.set(id, { id, frames: byId.get(id).frames ?? 0, beats: byId.get(id).beats ?? [], findings: [], categories: [] });
      named.get(id).findings.push(finding.id);
      if (!named.get(id).categories.includes(finding.category)) named.get(id).categories.push(finding.category);
    }
  }
  return [...named.values()].sort((a, b) => a.frames - b.frames);
}

/**
 * The step a retake round takes, and the shots it may change.
 * history: the earlier rounds' records ([{step, shots, kept}]).
 * - "replan-beat" when the critic asked for a replan, when a blocking or
 *   major narrative finding names a shot (the story is wrong there, not the
 *   acting), or when every failing shot was already redirected and still fails.
 * - "redirect" otherwise.
 * - step null when the blocking and major findings name no shot: there is
 *   nothing a retake can aim at.
 * → {step, shots, failing, beats, reason}
 */
export function retakeStep(critique, findings, shots, history = []) {
  const bad = failingShots(findings, shots);
  if (!bad.length) return { step: null, shots: [], failing: [], beats: [], reason: "the blocking and major findings name no shot" };
  const ids = bad.map((shot) => shot.id);
  const redirected = new Set((history ?? []).filter((round) => round.step === "redirect").flatMap((round) => round.shots ?? []));
  const story = bad.some((shot) => shot.categories.includes("narrative"));
  const reason = critique?.verdict === "replan" ? "the critic asked for a replan"
    : story ? "a narrative finding names the shot"
      : ids.every((id) => redirected.has(id)) ? "the shot was redirected and still fails"
        : null;
  if (!reason) return { step: "redirect", shots: ids, failing: ids, beats: [], reason: "a finding names the shot" };
  const beats = [...new Set(bad.flatMap((shot) => shot.beats))];
  const inBeat = (shots ?? []).filter((shot) => ids.includes(shot.id) || (shot.beats ?? []).some((beat) => beats.includes(beat))).map((shot) => shot.id);
  return { step: "replan-beat", shots: inBeat, failing: ids, beats, reason };
}

/**
 * A retake's storyboard: `before` with only the scenes in `ids` taken from
 * `after`, each keeping its id, track, start and end. Whatever else `after`
 * changed is left out and listed.
 * → {story, changed: [ids that differ from before], ignored: [what was left out]}
 */
export function scopedRetake(before, after, ids) {
  const allowed = new Set(ids ?? []);
  const proposed = new Map((Array.isArray(after?.scenes) ? after.scenes : []).filter((scene) => scene && typeof scene.id === "string").map((scene) => [scene.id, scene]));
  const changed = [];
  const ignored = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const scenes = (before?.scenes ?? []).map((scene) => {
    const other = proposed.get(scene.id);
    if (!other) return scene;
    if (!allowed.has(scene.id)) {
      if (!same(scene, other)) ignored.push(`scene ${scene.id} is outside the retake`);
      return scene;
    }
    if (!same(scene.start, other.start) || !same(scene.end, other.end)) ignored.push(`scene ${scene.id}'s start and end (the animatic locked the timing)`);
    const next = { ...other, id: scene.id, start: scene.start, end: scene.end };
    if (scene.track !== undefined) next.track = scene.track; else delete next.track;
    if (!same(scene, next)) changed.push(scene.id);
    return next;
  });
  for (const id of proposed.keys()) if (!(before?.scenes ?? []).some((scene) => scene.id === id)) ignored.push(`new scene ${id}`);
  return { story: { ...before, scenes }, changed, ignored };
}

/** What a retake round is asked to fix, for the planner: the findings on its shots, worst first. */
export function retakeProblems(findings, ids) {
  const wanted = new Set(ids ?? []);
  return criticProblems((findings ?? []).filter((finding) => (finding.scenes ?? []).some((id) => wanted.has(id))));
}

/** One round's record in qa/retakes.json. */
export function retakeRound({ round, plan, findings, before }) {
  const wanted = new Set(plan.failing ?? []);
  return {
    round,
    step: plan.step,
    reason: plan.reason,
    findings: criticFindings((findings ?? []).filter((finding) => (finding.scenes ?? []).some((id) => wanted.has(id)))).map((finding) => ({ id: finding.id, severity: finding.severity, category: finding.category, message: finding.message, shots: finding.scenes ?? [] })),
    shots: plan.failing ?? [],
    ...(plan.step === "replan-beat" ? { beats: plan.beats ?? [], scenes: plan.shots ?? [] } : {}),
    tried: null,
    rendered: [],
    verdict_before: before?.verdict ?? null,
    findings_before: before ?? null,
    kept: false
  };
}

/** qa/retakes.json: every round, and where the video stands. status: "ship" | "needs-repair". */
export function retakesDocument(rounds, { review = "final", limit = MAX_CRITIC_REPAIRS, verdict = null } = {}) {
  return { schema: RETAKES_SCHEMA, review, limit, status: verdict === "ship" ? "ship" : "needs-repair", verdict, rounds: rounds ?? [] };
}

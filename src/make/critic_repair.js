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

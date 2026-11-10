// Places a direction map's key actions into the scenes that play on their
// words (docs/DIRECTION_GUARDRAILS.md §2).
//
// The map says who does what on each line (line.action {verb, who, target});
// the storyboard's cast scenes carry the cues that make it happen. A planner
// that stages the right characters in the right shot and leaves the cue out
// (or writes a pose where the map names an action) fails the acting gate, and
// asking it again does not reliably fix it. When the character is already in
// the shot, the cue is tooling's to add: on the first word of the line the
// shot hears, with a target a cue can take. A character who is not in the
// shot is the planner's to stage, so that finding is left for its repair.
import { ACTIONS, NAMED_TARGETS, TARGET_REQUIRED } from "@launchclip/core/characters/actions.mjs";
import { ACTING } from "@launchclip/core/characters/acting.mjs";
import { POSES } from "@launchclip/core/characters/rig.mjs";
import { resolveModule } from "@launchclip/core/modules.mjs";
import { castRefId, resolveStory, storyCastIds } from "@launchclip/core/story.mjs";
import { actingGate } from "./direction_guardrails.js";

const round = (value) => Math.round(value * 1000) / 1000;

// The cast entry for a character in a raw scene: a cast-scene's params.cast member, or a cameo's params.
function actorEntry(scene, id, ids) {
  const params = scene?.params;
  if (!params || typeof params !== "object") return null;
  if (Array.isArray(params.cast)) return params.cast.find((entry) => entry && castRefId(entry.id, ids) === id) ?? null;
  return castRefId(params.character, ids) === id ? params : null;
}

// A target a cue can take for the map's words: the cast member in the shot it names, a named place it names, else across the frame.
function cueTarget(text, entry, scene, story, ids) {
  const said = String(text ?? "").toLowerCase();
  const others = (Array.isArray(scene.params?.cast) ? scene.params.cast : []).map((member) => castRefId(member?.id, ids)).filter((id) => typeof id === "string" && id !== castRefId(entry.id ?? entry.character, ids));
  const names = new Map((Array.isArray(story?.cast?.characters) ? story.cast.characters : []).map((member) => [member?.id, String(member?.name ?? "").toLowerCase()]));
  const named = others.find((id) => said.includes(id.toLowerCase().replace(/-/g, " ")) || said.includes(id.toLowerCase()) || (names.get(id) && said.includes(names.get(id))));
  if (named) return { character: named };
  const place = NAMED_TARGETS.find((name) => !["left", "right", "far"].includes(name) && said.includes(name));
  if (place && story?.world) return place;
  if (entry.target === "left" || entry.target === "right") return entry.target;
  const position = entry.position ?? entry.side ?? null;
  return position === "right" ? "left" : "right";
}

/**
 * storyboard: as written (anchors unresolved); direction: the map; words:
 * the narration's words.
 * → {storyboard (a copy when anything changed), changed: [what was added]}
 */
export function placeActions(storyboard, { direction = null, words = [] } = {}) {
  if (!direction || !Array.isArray(direction.sections) || !Array.isArray(storyboard?.scenes)) return { storyboard, changed: [] };
  const missing = (story) => {
    try {
      const resolved = resolveStory(structuredClone(story), { words });
      return { resolved, findings: actingGate(resolved, { map: direction, words }).findings.filter((finding) => finding.rule === "action-missing") };
    } catch { return null; }
  };
  let current = storyboard;
  const changed = [];
  const before = missing(current);
  for (const finding of before?.findings ?? []) {
    if (!finding.in_shot || !finding.line) continue;
    const state = missing(current);
    if (!state || !state.findings.some((entry) => entry.at === finding.at && entry.who === finding.who)) continue;
    const ids = storyCastIds(current);
    const [from, to] = [finding.line.start, finding.line.end];
    // The shot that hears most of the line, of those the character is in.
    const shots = state.resolved.scenes.filter((scene) => finding.present.includes(scene.id))
      .map((scene) => ({ scene, heard: Math.min(scene.end, to) - Math.max(scene.start, from) }))
      .sort((a, b) => b.heard - a.heard);
    for (const { scene } of shots) {
      const next = structuredClone(current);
      const raw = next.scenes.find((entry) => entry.id === scene.id);
      const entry = actorEntry(raw, finding.who, ids);
      if (!entry) continue;
      const last = scene.end - scene.start - ACTING.poseTween - (finding.line.verb === "walk-to" ? 0.6 : 0);
      // On the first word of the line the shot hears, else as the shot opens (the line began before the cut).
      const word = (words ?? []).find((item) => Number(item.start) >= Math.max(from, scene.start) - 1e-6 && Number(item.start) <= Math.min(to, scene.start + last) + 1e-6);
      const at = round(Math.max(0, Math.min(last, (word ? Number(word.start) : Math.max(from, scene.start)) - scene.start)));
      if (!(at >= 0)) continue;
      const verb = finding.line.verb;
      const cue = ACTIONS.includes(verb)
        ? { action: verb, ...(TARGET_REQUIRED.includes(verb) || (verb === "turn-to-look" && finding.line.target) ? { target: cueTarget(finding.line.target, entry, raw, next, ids) } : {}) }
        : POSES.includes(verb) ? { pose: verb } : null;
      if (!cue) continue;
      const cues = Array.isArray(entry.cues) ? entry.cues : (entry.cues = []);
      // A cue of its own already near that moment takes the action (two pose changes cannot sit that close).
      const resolvedActor = actorEntry(scene, finding.who, ids);
      const near = cues.findIndex((_, i) => Math.abs(Number(resolvedActor?.cues?.[i]?.at) - at) < ACTING.poseTween + 0.05);
      if (near >= 0) {
        const { pose, action, target, ...rest } = cues[near];
        cues[near] = { ...rest, ...(cue.pose ? { pose: cue.pose } : {}), ...(cue.action ? { action: cue.action } : action && !cue.pose ? { action } : {}), ...(cue.target !== undefined ? { target: cue.target } : cue.action ? {} : target !== undefined ? { target } : {}) };
      } else cues.push({ at, ...cue });
      // Kept only when the shot still resolves and the line's action is now performed.
      const after = missing(next);
      if (!after || after.findings.some((item) => item.at === finding.at && item.who === finding.who)) continue;
      try { resolveModule(after.resolved.scenes.find((item) => item.id === scene.id), after.resolved); } catch { continue; }
      current = next;
      changed.push(`gave ${finding.who} the map's ${verb} in ${scene.id} at ${at} s (${near >= 0 ? "on its cue there" : "a new cue"})`);
      break;
    }
  }
  return { storyboard: current, changed };
}

// When make plans a character-led explainer (kit/core/explainer.mjs).
//
// The ordinary one-prompt path (`launchclip make "<prompt>"`, no flags) with
// nothing to show used to plan line diagrams and text cards. It now plans a
// small cast that carries the idea. That is the default only where the video
// has no picture of its own:
//
//   - a motion lane (no recording is the base), not a character story
//     (--animation plans its own cast from a show bible);
//   - no media in the assets folder and no asset provider to ask for shots;
//   - the script is an explainer or a short-form piece, on its format's own
//     skeleton (a library skeleton designs its own key shot);
//   - the style is make's seeded one (a style the user chose keeps its look
//     and its cast), so the seed also takes a lively tone and, where the
//     topic suits one, a whole-scene look.
import { EXPLAINER_TONE, explainerLook } from "@launchclip/core/explainer.mjs";

const FORMATS = ["explainer", "short-form"];

/**
 * Whether this video's content calls for a character-led explainer, before
 * its style is known. options: {lane, format (the script plan's), bible,
 * animation, media (count of files the video can show), provider (an asset
 * provider answers shot requests), skeleton (a library skeleton), longForm}.
 */
export function explainerContent({ lane, format, bible = null, animation = false, media = 0, provider = false, skeleton = null, longForm = false } = {}) {
  return lane !== "footage-led" && !bible && !animation && !longForm && !skeleton && !provider && !(media > 0) && FORMATS.includes(format);
}

/** explainerContent, and the style is make's seeded one (or none). */
export function characterLed(content, style) {
  return Boolean(content) && (!style || style.source === "generated");
}

/**
 * The seeded style of an explainer: the tone when the prompt names none, and
 * the constraints its topic adds (a whole-scene look, never over one given).
 * → {tone, constraints}
 */
export function explainerSeed(text, { tone = null, constraints = {} } = {}) {
  const look = constraints.look === undefined && constraints.medium === undefined ? explainerLook(text) : null;
  return { tone: tone ?? EXPLAINER_TONE, constraints: look ? { ...constraints, look } : constraints };
}

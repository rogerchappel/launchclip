// The generation brief for a footage shot (docs/GENERATED_FOOTAGE_RFC.md
// §4, §4.2): an asset-provider shot request (src/asset_provider.js) turned
// into the one shape every provider adapter reads:
//
//   {id, kind: "footage", steps: ["image"] | ["image", "video"],
//    image: {prompt, negative, width, height, references: [absolute paths]},
//    video: {prompt, seconds, pad_seconds, fps} | null,
//    brief_hash: "sha256:…" (over the canonical JSON of everything else)}
//
// Step 1 (image) is the keyframe: subject, look and composition. Step 2
// (video) animates that keyframe, so its prompt is motion and camera only.
// Story shots (§4.1) are a later phase.
import path from "node:path";
import { readFile } from "node:fs/promises";
import { hashValue, loadWords } from "../finish.js";
import { resolveShots } from "../asset_provider.js";

// Generated clips drift at their ends, so each is asked for this much longer
// at each end and source_start trims it back (§6). A constant to tune on fixtures.
export const EDGE_PAD_SECONDS = 0.3;
// A request with no resolved length (no narration timings yet).
export const DEFAULT_SHOT_SECONDS = 4;
export const DEFAULT_FPS = 30;

// What no generated keyframe may show (§4.2 "Never").
export const FOOTAGE_NEGATIVE = "text, lettering, captions, subtitles, signs with words, logos, brand marks, watermarks, user interface, readable screens, real or named people, celebrities, public figures";

/**
 * Why a request is not generated, or null when it may be. A generated shot
 * illustrates and never stands in for a real product, person, place or event
 * (§4.2 "Not evidence").
 * shortcut: a capitalised word not opening a sentence, or a mixed-case word
 * (iPhone), is read as a name, plus ™/®/@; `shows` is written in plain lower case by the planner.
 * Upgrade to an entity check (src/resolve_entities) if it refuses too much.
 */
export function refusalReason(request) {
  const shows = String(request?.shows ?? "").trim();
  if (!shows) return 'the request has no "shows"';
  if (/[™®©@]/.test(shows)) return `"${shows}" names a brand or account`;
  // A sentence's first word is capitalised anyway (a backdrop's shows quotes the narration).
  const names = shows.split(/[.!?:]\s+/).flatMap((sentence) => sentence.split(/\s+/).slice(1)).map((word) => word.replace(/^[^\p{L}]+|[^\p{L}\d]+$/gu, "")).filter((word) => (/^\p{Lu}/u.test(word) && word !== "I") || /\p{Ll}\p{Lu}/u.test(word));
  if (names.length) return `"${shows}" names a real product, person, place or event (${names.join(", ")}); left to the library`;
  return null;
}

/** The story's look as one fixed paragraph, pasted into every footage brief of the story so the shots match. */
export function lookParagraph(story) {
  const colors = Object.entries(story?.brand?.colors ?? {}).map(([name, hex]) => `${name} ${hex}`);
  const look = typeof story?.look === "string" ? story.look : story?.look?.name;
  const grade = typeof story?.grade === "string" ? story.grade : story?.grade?.name;
  return [
    "Look: a photographic, naturally lit shot",
    look ? `in the ${look} treatment` : null,
    grade ? `with a ${grade} grade` : null,
    colors.length ? `colour graded toward the palette ${colors.join(", ")}` : null
  ].filter(Boolean).join(", ") + ". Every shot in this video shares this look.";
}

/**
 * A request → the shared brief, or null when refusalReason() refuses it.
 * look: the story's lookParagraph(). fps: the story's rate.
 */
export function footageBrief(request, { look = lookParagraph(null), fps = DEFAULT_FPS } = {}) {
  if (refusalReason(request)) return null;
  const still = request.type === "image" || request.still === true;
  const backdrop = request.role === "background";
  const line = String(request.line ?? "").trim();
  const prompt = [
    `${String(request.shows).trim()}.`,
    look,
    backdrop
      ? "Composition: a calm, even background with no strong subject; text will sit over all of it."
      : "Composition: keep the lower third calm, captions sit there.",
    line ? `Context only, never shown as text, the narration over this shot: "${line}"` : null
  ].filter(Boolean).join(" ");
  const seconds = Number(request.duration) > 0 ? Number(request.duration) : DEFAULT_SHOT_SECONDS;
  const body = {
    id: request.id,
    kind: "footage",
    steps: still ? ["image"] : ["image", "video"],
    image: { prompt, negative: FOOTAGE_NEGATIVE, width: request.format?.width ?? null, height: request.format?.height ?? null, references: [] },
    video: still ? null : {
      prompt: backdrop
        ? "Low motion: one slow, steady pan or push in. Nothing enters or leaves the frame."
        : "One slow camera move or one simple action. The subject, place and light stay as in the start frame.",
      seconds: Math.round((seconds + 2 * EDGE_PAD_SECONDS) * 1000) / 1000,
      pad_seconds: EDGE_PAD_SECONDS,
      fps
    }
  };
  return { ...body, brief_hash: `sha256:${hashValue(body)}` };
}

/**
 * Every footage shot request in a project's storyboard, with its brief (or the
 * reason it is refused). Calls no provider: requests are collected by asking
 * a provider that records them and answers null.
 * → [{request, brief, reason}]
 */
export async function projectBriefs(project) {
  const story = JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8"));
  const words = (await loadWords(project, story)) ?? [];
  const requests = [];
  await resolveShots(story, { assets: { findShot: (request) => { requests.push(request); return null; } }, words });
  const look = lookParagraph(story);
  const fps = Number(story.format?.fps) || DEFAULT_FPS;
  return requests.map((request) => {
    const reason = refusalReason(request);
    return { request, brief: reason ? null : footageBrief(request, { look, fps }), reason };
  });
}

/** projectBriefs() as text a person can paste into any generation tool. */
export function formatBriefs(briefs) {
  if (!briefs.length) return "No footage shot requests in this storyboard.\n";
  return briefs.map(({ request, brief, reason }) => {
    const head = `# ${request.id} (scene ${request.scene_id ?? "?"}${request.role === "background" ? ", backdrop" : ""})`;
    if (!brief) return `${head}\nrefused: ${reason}\n`;
    const lines = [head, `steps: ${brief.steps.join(" → ")}`, `size: ${brief.image.width}×${brief.image.height}`, "", "image prompt:", brief.image.prompt, "", "negative:", brief.image.negative];
    if (brief.video) lines.push("", `video prompt (${brief.video.seconds} s at ${brief.video.fps} fps, ${brief.video.pad_seconds} s padding each end):`, brief.video.prompt);
    lines.push("", brief.brief_hash);
    return `${lines.join("\n")}\n`;
  }).join("\n");
}

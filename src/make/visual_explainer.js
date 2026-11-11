// A visual explainer: what make plans when a video has nothing to show.
//
// With no recording, no images and no asset provider, every scene is a
// picture of what the narration says at that moment, drawn for this topic in
// an editorial-illustration style and timed to the spoken words. A cast of
// characters is no longer the default for that case (`--explainer characters`
// keeps it).
//
// One call directs, then every scene is drawn at once:
//
//   director      the look every scene follows, the scenes (their times, what
//                 each shows, the beats and the sound cues), and the shared
//                 props: drawing functions for what recurs, so the scenes
//                 match though they are drawn apart.
//   illustrators  one call per scene, all in flight together (the model gate
//                 sets how many). Each sees the look, the props and its own
//                 scene, and returns that scene's drawing code.
//
// A scene's code is checked before it is used (it must parse, and it must
// keep the custom-module rules: no clock, no chance, no timers, nothing from
// outside). A scene that fails is drawn once more with the reason; one that
// fails again becomes a type card of its heading, so no scene is ever blank.
//
// Each scene is a custom module in its own fragment (hyperframes/visual/
// <scene>.html): the drawing helpers, the director's props and the scene's
// code. Custom modules of this kind have a HyperFrames form only, so a visual
// explainer is planned for that renderer.
//
//   visualExplainer(content, options)   → whether make plans one
//   visualArea(format)                  → where pictures and text may sit
//   planVisualExplainer(options)        → {storyboard, fragments, direction, plan, attempts, warnings}
import vm from "node:vm";
import { lintCustomFragment } from "../../kit/hyperframes/custom-module.mjs";
import { DIRECTION_SCHEMA, classifyIntent } from "@launchclip/core/direction.mjs";
import { profileGeometry } from "@launchclip/core/layout-check.mjs";
import { estimateModelUsageCost } from "../cost_tracker.js";

export const VISUAL_DIR = "hyperframes/visual";
export const EXPLAINER_MODES = Object.freeze(["visual", "characters"]);
const CUES = Object.freeze(["pop", "impact", "whoosh", "tick", "success"]);
// The shortest scene a viewer can read, and the lengths the director aims for.
const MIN_SCENE_SECONDS = 1.4;
const SCENE_SECONDS = Object.freeze([2.5, 4.5]);
const DIRECTOR_TOKENS = 30000;
const SCENE_TOKENS = 24000;
// The cuts between scenes, in turn: the kit's own transitions.
const TRANSITIONS = Object.freeze([{ type: "whip", dur: 0.25, direction: "left" }, { type: "push", dur: 0.3, direction: "up" }, { type: "push", dur: 0.3, direction: "left" }, { type: "whip", dur: 0.25, direction: "up" }, { type: "fade", dur: 0.2 }]);

/** --explainer: visual (default) or characters. */
export function explainerMode(value) {
  if (value === undefined || value === null || value === "" || value === true) return "visual";
  const mode = String(value).toLowerCase();
  if (!EXPLAINER_MODES.includes(mode)) throw new Error(`--explainer must be ${EXPLAINER_MODES.join(" or ")}; got ${value}`);
  return mode;
}

/**
 * Whether make plans a visual explainer. content: the video has nothing to
 * show and is an explainer (src/make/explainer.js explainerContent). It is
 * the default there, on the HyperFrames renderer (asked for, or not chosen),
 * outside a fast draft (whose plan is rule-made) and its --refine (which
 * finishes the video the draft showed).
 */
export function visualExplainer(content, { mode = "visual", renderer = null, draft = false } = {}) {
  return Boolean(content) && !draft && mode === "visual" && (renderer == null || String(renderer).toLowerCase() === "hyperframes");
}

const round2 = (value) => Math.round(Number(value) * 100) / 100;
const whole = (value) => Math.round(Number(value));

/**
 * Where a scene may draw, in frame pixels. text: the platform's safe zone
 * above the caption band (labels, numbers and anything that must be read).
 * picture: the wider area a drawing may fill. caption: the band's top.
 */
export function visualArea(format) {
  const canvas = { width: Number(format.width), height: Number(format.height) };
  const { safeZone, captionBand } = profileGeometry(canvas, null);
  const bottom = whole(Math.min(safeZone.y + safeZone.height, captionBand.y) - 10);
  const text = { x: whole(safeZone.x), y: whole(safeZone.y), width: whole(safeZone.width), height: bottom - whole(safeZone.y) };
  const top = whole(Math.max(canvas.height * 0.06, text.y - canvas.height * 0.08));
  const side = whole(canvas.width * 0.04);
  return { canvas, text, picture: { x: side, y: top, width: canvas.width - side * 2, height: bottom - top }, caption: whole(captionBand.y) };
}

function luminance(hex) {
  const raw = String(hex ?? "").replace("#", "");
  const full = raw.length === 3 ? raw.replace(/./g, "$&$&") : raw;
  if (!/^[0-9a-f]{6}/i.test(full)) return 1;
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The colours every scene is given, from the brand: the line colour is the one that reads on the background. */
export function visualPalette(brand) {
  const colors = brand?.colors ?? {};
  const bg = colors.bg ?? "#f4ead9";
  const light = luminance(bg) > 0.5;
  return { BG: bg, INK: light ? "#1d1a16" : "#f7f2e8", PAPER: light ? "#fffaf0" : "#2a2622", PRIMARY: colors.primary ?? "#c8552b", ACCENT: colors.accent ?? "#2f6f5e", HIGHLIGHT: "#f2b233" };
}

/** The drawing helpers every scene's code runs with (the fragment's own script, before the props and the scene). */
export function visualHelpers(palette) {
  return `const NS = 'http://www.w3.org/2000/svg';
const svg = root.querySelector('svg');
const ${Object.entries(palette).map(([name, value]) => `${name} = '${value}'`).join(", ")};
const S = (tag, attrs = {}, parent = svg, text = null) => {
  const el = document.createElementNS(NS, tag);
  for (const key in attrs) el.setAttribute(key, attrs[key]);
  if (text != null) el.textContent = text;
  parent.appendChild(el);
  return el;
};
const G = (parent = svg, attrs = {}) => S('g', attrs, parent);
const hide = (el) => { el.style.opacity = 0; return el; };
const O = { immediateRender: false };
const pop = (el, at, dur = 0.34, from = 0.2) => tl.fromTo(hide(el), { opacity: 0, scale: from, transformOrigin: '50% 50%' }, { opacity: 1, scale: 1, duration: dur, ease: 'back.out(2.2)', ...O }, at);
const slam = (el, at, dur = 0.26) => tl.fromTo(hide(el), { opacity: 0, scale: 2.6, transformOrigin: '50% 50%' }, { opacity: 1, scale: 1, duration: dur, ease: 'power4.in', ...O }, at);
const fly = (el, at, x, y, dur = 0.38, ease = 'expo.out') => tl.fromTo(hide(el), { opacity: 0, x, y }, { opacity: 1, x: 0, y: 0, duration: dur, ease, ...O }, at);
const fade = (el, at, to = 0, dur = 0.25) => tl.to(el, { opacity: to, duration: dur, ease: 'power1.out', ...O }, at);
const draw = (path, at, dur = 0.5) => { const n = path.getTotalLength(); path.setAttribute('stroke-dasharray', n); path.setAttribute('stroke-dashoffset', n); tl.to(path, { attr: { 'stroke-dashoffset': 0 }, duration: dur, ease: 'power2.out', ...O }, at); return path; };
const drift = (el, x, y, rot = 0) => tl.fromTo(el, { x: -x, y: -y, rotation: -rot, transformOrigin: '50% 50%' }, { x, y, rotation: rot, duration: scene.duration, ease: 'none', ...O }, scene.start);
const shake = (el, at, amount = 10) => tl.fromTo(el, { y: -amount }, { y: 0, duration: 0.5, ease: 'elastic.out(1.2,0.35)', ...O }, at);`;
}

const HELPER_NOTES = `S(tag, attrs, parent = svg, text) creates an SVG element and returns it. G(parent) makes a group. pop, slam and fly hide the element and bring it in at a time (fly comes from an offset x, y). draw(path, at, dur) draws a stroke on. fade(el, at, to) fades to an opacity. drift(el, x, y, rot) moves an element slowly for the whole scene. shake(el, at) drops it into place with a bounce. \`scene.start\`, \`scene.end\` and \`scene.duration\` are the current scene's times.
Text: S('text', { x, y, 'font-size': n, 'text-anchor': 'middle', class: 'd' }, parent, 'words'). Class "d" is the display face, class "m" is small capitals in the mono face, no class is the body face. Text is INK unless you set style: 'fill:#hex'.`;

const QUALITY = `What makes it good:
- Every scene is a picture of what the narration is saying at that moment. Show the thing itself (the object, its parts, how it works, what goes wrong, the comparison), drawn for this topic the way someone who works with it would recognise. Never a generic icon beside the words, never a character reacting, never a text card standing in for a picture.
- It is fast and dense: something new lands on almost every phrase, at the exact second the word is spoken. Things slam, slide, drop, draw on, get crossed out, get ringed, count up. Nothing sits still for more than a second: once an element is in, keep the scene alive (a slow drift, a rotation, a sweep, a pulse).
- Short labels, numbers and stamps are part of the picture. Big type where a word is the point.`;

function toolNotes({ area, palette, helpers }) {
  const { canvas, text, picture } = area;
  return `How drawing works. Code builds SVG into \`svg\` (its viewBox is the frame, ${canvas.width}x${canvas.height}) and schedules motion on the GSAP timeline \`tl\`. All times are ABSOLUTE seconds of the video. These helpers and colours already exist; use them, and plain \`tl.to\` / \`tl.fromTo\` (always spread \`...O\`) for anything else:

${helpers}

${HELPER_NOTES}
The colours: BG ${palette.BG} is the background already behind every scene, INK ${palette.INK} is the line and text colour, PAPER ${palette.PAPER} is the light fill, PRIMARY ${palette.PRIMARY} and ACCENT ${palette.ACCENT} are the brand's two colours, HIGHLIGHT ${palette.HIGHLIGHT} is for the one thing to look at.

Hard rules:
- Text, numbers and anything that must be read stay inside x ${text.x} to ${text.x + text.width}, y ${text.y} to ${text.y + text.height} (outside it the platform's own buttons cover them). Pictures may fill x ${picture.x} to ${picture.x + picture.width}, y ${picture.y} to ${picture.y + picture.height}. Captions are drawn for you from y ${area.caption} down: leave that band and everything under it empty.
- Check that text fits: a display character is about 0.55 of its font-size wide, a mono capital about 0.62 plus its letter spacing. No text smaller than 26 px; labels 32 px or more. A label on a plate is narrower than the plate.
- No Math.random, no Date, no setTimeout or requestAnimationFrame, no CSS animations or transitions, no fetch, no external images or fonts. Do not redeclare the helpers.
- An element that should appear later must be brought in with pop, slam or fly (they hide it until then).
- Plain JavaScript only, and correct: an error means the scene is replaced by a plain card.`;
}

export const DIRECTOR_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["look", "scenes", "props"],
  properties: {
    look: { type: "string" },
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "heading", "start", "end", "brief", "beats", "hits"],
        properties: {
          id: { type: "string" },
          heading: { type: "string" },
          start: { type: "number" },
          end: { type: "number" },
          brief: { type: "string" },
          beats: { type: "array", items: { type: "object", additionalProperties: false, required: ["at", "what"], properties: { at: { type: "number" }, what: { type: "string" } } } },
          hits: { type: "array", items: { type: "object", additionalProperties: false, required: ["at", "cue"], properties: { at: { type: "number" }, cue: { type: "string", enum: [...CUES] } } } }
        }
      }
    },
    props: { type: "string" }
  }
});

export const SCENE_SCHEMA = Object.freeze({ type: "object", additionalProperties: false, required: ["code"], properties: { code: { type: "string" } } });

function directorInstructions({ format, tools }) {
  return `You are the director of a ${format.height > format.width ? "vertical" : "widescreen"} video (${format.width}x${format.height}, ${round2(format.duration)} seconds) for social media. There is no footage: every scene is animated SVG in an editorial-illustration style (flat colour, bold ink outlines, hand-made shapes, clear labels). You plan it; a team of illustrators then draws all the scenes at the same time, each seeing only your plan. They must come out looking like one video.

${QUALITY}
- A new scene every ${SCENE_SECONDS[0]} to ${SCENE_SECONDS[1]} seconds, each with its own composition. Scenes tile the whole video: the first starts at 0, the last ends at ${round2(format.duration)}, each starts where the one before ends, on the start of a spoken phrase.
- The first scene's main picture is already there on the very first frame (drawn with no entrance); only what is added to it animates in.

${tools}

Answer with:
- look: the rules every illustrator follows so the scenes match: how headings are set (position, size, class), line weights, how labels and stamps look, the colour each recurring thing always has, how elements enter, the mood. Specific enough to follow without seeing the other scenes.
- scenes: for each, id (short, lower-case, hyphens), heading (the two to four words that name it on screen), start and end (seconds), brief (exactly what the scene shows and how it is composed: where each thing sits in the frame, and which shared props it uses), beats (at: the second, what: what lands at that moment and on which word), hits (the moments that get a sound: at, and cue pop, impact, whoosh, tick or success).
- props: JavaScript source. Constants for this topic's own colours, and a few functions for the things that recur across scenes (how each recurring object is drawn), so every illustrator draws them the same way. Each function takes a parent group, a position and a size, returns its group, and has a one-line comment giving its arguments and what it draws. Name them prop followed by a capital (propSomething). Only definitions: nothing is drawn at the top level.`;
}

function sceneInstructions({ format, tools }) {
  return `You are one of the illustrators of a ${format.height > format.width ? "vertical" : "widescreen"} video (${format.width}x${format.height}, ${round2(format.duration)} seconds). The director has planned it; every scene is being drawn at the same time by a different illustrator. You draw ONE scene as animated SVG, in an editorial-illustration style (flat colour, bold ink outlines, hand-made shapes, clear labels). Follow the director's look exactly and use the shared props, so your scene matches the others.

${QUALITY}

${tools}

Answer with code: the JavaScript that draws your scene and schedules its motion (statements only, no function wrapper, no markdown). It runs once, after the helpers and the props. Read each prop's arguments before you call it. Make the scene rich: it is the whole picture for these seconds.`;
}

const spoken = (words, from, to) => words.filter((word) => word.start >= from && word.start < to).map((word) => `${word.text ?? word.word}@${round2(word.start)}`).join(" ");

function sceneInput({ brief, plan, scene, words, first }) {
  const outline = plan.scenes.map((entry) => `- ${entry.id} (${entry.start}-${entry.end} s): ${entry.brief}`).join("\n");
  return `${brief}

The director's look:
${plan.look}

The shared props (already defined; call them, do not redefine them):
${plan.props || "(none)"}

The whole video, for context:
${outline}

YOUR SCENE: ${scene.id} ("${scene.heading}"), from ${scene.start} s to ${scene.end} s.
What it shows: ${scene.brief}
Beats:
${scene.beats.map((beat) => `- ${beat.at} s: ${beat.what}`).join("\n") || "- (none given: time each thing to the word that names it)"}
The words spoken during it, with their times: ${spoken(words, scene.start - 0.3, scene.end)}
${first ? "\nThis is the opening scene: its main picture is drawn with no entrance, so it is there on the very first frame. Only what is added to it animates in.\n" : ""}`;
}

/** What is wrong with a piece of scene or props code, or null. It is parsed, never run. */
export function codeProblem(code, { helpers = "", props = "" } = {}) {
  if (typeof code !== "string" || !code.trim()) return "there was no code";
  const rules = lintCustomFragment(`<script>${code}</script>`);
  if (rules.length) return `it ${rules.join("; ")}`;
  try { new vm.Script(`(function (root, scene, params, tl, brand, format, model) {\n${helpers}\n${props}\n{\n${code}\n}\n})`); } catch (error) {
    return `it does not parse: ${String(error?.message ?? error).split("\n")[0]}`;
  }
  return null;
}

const slug = (value, fallback) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28) || fallback;

/**
 * The director's scenes made to tile the video: in order, the first at 0,
 * each ending where the next starts, the last at the end; a scene too short
 * to read joins the one before it. Beats and hits outside their scene are
 * dropped. → {scenes, notes}
 */
export function tileScenes(raw, duration) {
  const notes = [];
  const listed = (Array.isArray(raw) ? raw : []).filter((scene) => scene && Number.isFinite(Number(scene.start))).map((scene) => ({ ...scene, start: Number(scene.start) })).sort((a, b) => a.start - b.start);
  const kept = [];
  for (const scene of listed) {
    const start = kept.length ? Math.min(Math.max(scene.start, 0), duration) : 0;
    const previous = kept.at(-1);
    if (previous && start - previous.start < MIN_SCENE_SECONDS) { notes.push(`scene ${scene.id} starts ${round2(start - previous.start)} s after ${previous.id}: joined to it`); previous.joined.push(scene); continue; }
    if (duration - start < MIN_SCENE_SECONDS && previous) { notes.push(`scene ${scene.id} would run under ${MIN_SCENE_SECONDS} s: joined to ${previous.id}`); previous.joined.push(scene); continue; }
    kept.push({ ...scene, start: round2(start), joined: [] });
  }
  const ids = new Set();
  const scenes = kept.map((scene, index) => {
    const end = index + 1 < kept.length ? kept[index + 1].start : round2(duration);
    let id = slug(scene.id, `scene-${index + 1}`);
    if (ids.has(id)) id = `${id}-${index + 1}`;
    ids.add(id);
    const inside = (entry) => Number.isFinite(Number(entry?.at)) && Number(entry.at) >= scene.start && Number(entry.at) < end;
    const all = [scene, ...scene.joined];
    return {
      id,
      heading: String(scene.heading ?? "").trim() || id.replace(/-/g, " "),
      start: scene.start,
      end,
      brief: all.map((entry) => String(entry.brief ?? "").trim()).filter(Boolean).join(" Then: "),
      beats: all.flatMap((entry) => entry.beats ?? []).filter(inside).map((beat) => ({ at: round2(beat.at), what: String(beat.what ?? "") })).sort((a, b) => a.at - b.at),
      hits: all.flatMap((entry) => entry.hits ?? []).filter(inside).map((hit) => ({ at: round2(hit.at), cue: CUES.includes(hit.cue) ? hit.cue : "pop" })).sort((a, b) => a.at - b.at)
    };
  });
  return { scenes, notes };
}

const text = (value) => JSON.stringify(String(value ?? "")).replace(/</g, "\\u003c");

/** One scene's fragment: the helpers, the props and its code (null: a type card of its heading). */
export function sceneFragment({ scene, code, helpers, props, area }) {
  const { canvas, text: zone } = area;
  const cx = whole(zone.x + zone.width / 2), cy = whole(zone.y + zone.height / 2);
  const size = Math.max(64, Math.min(150, whole(zone.width / Math.max(6, scene.heading.length) / 0.58)));
  // The card a scene falls back to: its heading, set large, with a rule drawn under it.
  const card = `svg.replaceChildren();
  const cardTitle = S('text', { x: ${cx}, y: ${cy}, 'font-size': ${size}, 'text-anchor': 'middle', class: 'd' }, svg, ${text(scene.heading)});
  const cardRule = S('path', { d: 'M ${cx - whole(zone.width * 0.3)} ${cy + 50} H ${cx + whole(zone.width * 0.3)}', stroke: PRIMARY, 'stroke-width': 10, 'stroke-linecap': 'round', fill: 'none' }, svg);
  ${scene.start > 0 ? "slam(cardTitle, scene.start + 0.1);" : ""}
  draw(cardRule, scene.start + 0.3, 0.6);`;
  const body = code == null ? `{\n  ${card}\n}` : `try {\n${code}\n} catch (error) {\n  (window.__lcErrors = window.__lcErrors || []).push(scene.id + ': ' + error.message);\n  ${card}\n}`;
  return `<!-- Visual explainer scene "${scene.id}": drawn for this video. Every time is an absolute story second. -->
<style>
  svg { position: absolute; left: 0; top: 0; width: ${canvas.width}px; height: ${canvas.height}px; overflow: visible; }
  text { font-family: var(--lc-font-body); fill: var(--ve-ink); }
  .d { font-family: var(--lc-font-display); }
  .m { font-family: var(--lc-font-meta); letter-spacing: 3px; }
</style>
<svg viewBox="0 0 ${canvas.width} ${canvas.height}"></svg>
<script>
${helpers}
svg.style.setProperty('--ve-ink', INK);
${props}
${body}
// The camera never stops: a slow push for the whole scene.
tl.fromTo(svg, { scale: 1, transformOrigin: '50% 45%' }, { scale: 1.04, duration: scene.duration, ease: 'none', ...O }, scene.start);
</script>
`;
}

/** The storyboard of a directed video: one custom scene per directed scene. base: the fixed inputs ({lane, format, brand, audio}). */
export function visualStoryboard({ base, scenes, area, title = null }) {
  const rect = { ...area.text };
  return {
    schema: "launchclip.story.v1",
    ...(title ? { title } : {}),
    lane: base.lane,
    format: base.format,
    brand: base.brand,
    audio: { ...(base.audio ?? {}), sfx: "auto", sfx_density: "high" },
    base: null,
    scenes: scenes.map((scene, index) => ({
      id: scene.id,
      module: "custom",
      source: { hyperframes: `${VISUAL_DIR}/${scene.id}.html` },
      start: scene.start,
      end: scene.end,
      ...(index ? { in: { ...TRANSITIONS[(index - 1) % TRANSITIONS.length] } } : {}),
      // rect: where the scene's text sits, for the layout and density checks (the drawing itself is the fragment's).
      params: { component: `Visual${index + 1}`, heading: scene.heading, rect },
      hits: scene.hits.map((hit, at) => ({ at: hit.at, event: `${scene.id}-${at + 1}`, cue: hit.cue }))
    })),
    overlays: [{ type: "captions", position: "auto" }]
  };
}

/**
 * The direction map of a directed video: a section per scene, whose one line
 * is the words spoken under it and what the scene shows for them. The
 * director planned line by line; this is that plan in the map's form, so the
 * direction and coverage checks read it as they read any planned video's.
 */
export function visualDirection(scenes, words, { profile = null } = {}) {
  const sections = [];
  for (const scene of scenes) {
    const spokenHere = words.map((word, index) => ({ word, index })).filter(({ word }) => word.start >= scene.start && word.start < scene.end);
    if (!spokenHere.length) continue;
    const said = spokenHere.map(({ word }) => word.text ?? word.word).join(" ");
    sections.push({ id: `v${sections.length + 1}`, title: scene.heading, layout: "full", lines: [{ words: [spokenHere[0].index, spokenHere.at(-1).index], intent: classifyIntent(said, { index: sections.length }), treatment: "dress", scenes: [scene.id], why: scene.brief }] });
  }
  return { schema: DIRECTION_SCHEMA, ...(profile ? { profile } : {}), sections };
}

async function ask(client, request, { provider, model }) {
  const started = performance.now();
  const result = await client.runStructured({ ...request, model: model ?? undefined, onDelta: () => {} });
  let value = result?.value && typeof result.value === "object" ? result.value : null;
  if (!value && typeof result?.text === "string") { try { value = JSON.parse(result.text.slice(result.text.indexOf("{"), result.text.lastIndexOf("}") + 1)); } catch { value = null; } }
  const cost = estimateModelUsageCost(provider ?? client?.provider ?? "openai", result?.model ?? model, result?.usage ?? {});
  return { value, usage: result?.usage ?? {}, cost_usd: cost.estimated_usd, model: result?.model ?? model, seconds: Math.round(performance.now() - started) / 1000 };
}

/**
 * Direct the video, then draw every scene at once.
 * options: {client (runStructured; the run's gated client), model, provider,
 * brief (the prompt and what the video is for), words ([{text, start, end}]),
 * narration (the spoken text), format, brand, lane, audio, title, profile
 * (the cadence profile's id), say}.
 * → {status: "passed" | "failed", storyboard, fragments: [{file, html}],
 *    direction (the direction map),
 *    plan: {look, props, scenes}, attempts: [{kind, id, ok, error, cost_usd,
 *    usage, model, seconds}], warnings, errors, seconds: {director, scenes}}
 */
export async function planVisualExplainer({ client, model = null, provider = null, brief, words = [], narration = "", format, brand, lane = "motion", audio = null, title = null, profile = null, say = () => {} } = {}) {
  if (!client || typeof client.runStructured !== "function") throw new Error("planVisualExplainer needs a client with runStructured()");
  const duration = Number(format.duration);
  const area = visualArea(format);
  const palette = visualPalette(brand);
  const helpers = visualHelpers(palette);
  const tools = toolNotes({ area, palette, helpers });
  const attempts = [], warnings = [];
  const who = { provider, model };
  const head = `${String(brief).trim()}\n\nThe narration is recorded and fixed:\n${narration}`;

  // 1. The director.
  const t0 = performance.now();
  let plan = null, problem = null;
  for (let attempt = 1; attempt <= 2 && !plan; attempt += 1) {
    const input = `${head}\n\nEvery word with the second it is spoken:\n${spoken(words, 0, Infinity)}\n\nPlan the video.${problem ? `\n\nYour last plan could not be used: ${problem}. Answer again with that fixed.` : ""}\n`;
    const answer = await ask(client, { instructions: directorInstructions({ format, tools }), input, schema: DIRECTOR_SCHEMA, schemaName: "launchclip_visual_director", maxOutputTokens: DIRECTOR_TOKENS }, who);
    const value = answer.value;
    const tiled = tileScenes(value?.scenes, duration);
    const props = typeof value?.props === "string" ? value.props.trim() : "";
    problem = !value ? "it was not the JSON asked for" : !tiled.scenes.length ? "it had no scenes" : props && codeProblem(props, { helpers }) ? `the props code is wrong: ${codeProblem(props, { helpers })}` : null;
    attempts.push({ kind: "director", id: `director-${attempt}`, ok: !problem, error: problem, cost_usd: answer.cost_usd, usage: answer.usage, model: answer.model, seconds: answer.seconds });
    if (!problem) { plan = { look: String(value.look ?? "").trim(), props, scenes: tiled.scenes }; warnings.push(...tiled.notes); }
  }
  const directorSeconds = Math.round(performance.now() - t0) / 1000;
  if (!plan) return { status: "failed", storyboard: null, fragments: [], plan: null, attempts, warnings, errors: [`the director's plan could not be used: ${problem}`], seconds: { director: directorSeconds, scenes: 0 } };
  say(`visual explainer: directed ${plan.scenes.length} scenes in ${Math.round(directorSeconds)} s; drawing them all at once`);

  // 2. Every scene at once (the model gate sets how many are in flight).
  const t1 = performance.now();
  const drawn = await Promise.all(plan.scenes.map(async (scene, index) => {
    const input = sceneInput({ brief: String(brief).trim(), plan, scene, words, first: index === 0 });
    let fault = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      let answer;
      try {
        answer = await ask(client, { instructions: sceneInstructions({ format, tools }), input: `${input}\nDraw it.${fault ? `\n\nYour last code could not be used: ${fault}. Answer again with the corrected code.` : ""}\n`, schema: SCENE_SCHEMA, schemaName: "launchclip_visual_scene", maxOutputTokens: SCENE_TOKENS }, who);
      } catch (error) {
        if (error?.code === "LAUNCHCLIP_COST_LIMIT") throw error;
        fault = `the call failed (${String(error?.message ?? error).split("\n")[0].slice(0, 160)})`;
        attempts.push({ kind: "scene", id: `${scene.id}-${attempt}`, ok: false, error: fault, cost_usd: 0, usage: {}, model, seconds: 0 });
        continue;
      }
      const code = typeof answer.value?.code === "string" ? answer.value.code.trim() : "";
      fault = codeProblem(code, { helpers, props: plan.props });
      attempts.push({ kind: "scene", id: `${scene.id}-${attempt}`, ok: !fault, error: fault, cost_usd: answer.cost_usd, usage: answer.usage, model: answer.model, seconds: answer.seconds });
      if (!fault) return code;
    }
    warnings.push(`scene ${scene.id} could not be drawn (${fault}); it shows its heading as a card`);
    return null;
  }));
  const sceneSeconds = Math.round(performance.now() - t1) / 1000;
  const cards = drawn.filter((code) => code == null).length;
  if (cards > plan.scenes.length / 2) return { status: "failed", storyboard: null, fragments: [], plan, attempts, warnings, errors: [`${cards} of ${plan.scenes.length} scenes could not be drawn`], seconds: { director: directorSeconds, scenes: sceneSeconds } };

  const fragments = plan.scenes.map((scene, index) => ({ file: `${VISUAL_DIR}/${scene.id}.html`, html: sceneFragment({ scene, code: drawn[index], helpers, props: plan.props, area }) }));
  const storyboard = visualStoryboard({ base: { lane, format: { fps: 30, ...format }, brand, audio }, scenes: plan.scenes, area, title });
  return { status: "passed", storyboard, fragments, direction: visualDirection(plan.scenes, words, { profile }), plan, attempts, warnings, errors: [], seconds: { director: directorSeconds, scenes: sceneSeconds }, drawn: plan.scenes.length - cards };
}

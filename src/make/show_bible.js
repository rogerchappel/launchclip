// The show bible stage of `launchclip make --animation`
// (docs/ANIMATION_PIPELINE_RFC.md §4.2, §6.1): one structured call in which
// the model is the cast and world designer, then tooling.
//
//   designBible          the call: for each character of the script a look as
//                        set paths (the edit language of `launchclip cast
//                        create`), or a starter or saved character to use; a
//                        side of the frame each; the world, the sets, and a
//                        few continuity rules
//   normalizeBibleDesign the answer checked against the rig's own options
//                        (src/cast_design.js checkedSets), so the model can
//                        only choose what the rig can draw
//   castFromDesign       each character through the door `cast create` uses:
//                        a saved character file in <project>/cast/, or a
//                        starter (changed or as it is)
//   makeBible            a draft BIBLE.json, then `bible freeze`
//                        (src/bible.js): the sheets, the hash
//
// The cast is drawn `chibi` unless a style pack or the brief names another
// drawing style, and the designer is told to keep people cute, relatable and
// simply dressed. Voices are tooling's: each character keeps the voice the
// script was voiced in, so designing the cast does not revoice the take.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { BIBLE_FILE, BIBLE_SCHEMA } from "@launchclip/core/bible.mjs";
import { STARTER_CAST, isStarterId, starterCharacter } from "@launchclip/core/characters/cast.mjs";
import { CHARACTER_PATHS, CHARACTER_SCHEMA, applyCharacterSets, characterCastEntry, normalizeCharacter } from "@launchclip/core/characters/character.mjs";
import { DRAWING_STYLES, KOKORO_VOICES } from "@launchclip/core/characters/cues.mjs";
import { SETS } from "@launchclip/core/characters/sets.mjs";
import { WORLD_KINDS, WORLD_TIMES, suggestWorld } from "@launchclip/core/worlds/index.mjs";
import { freezeBible } from "../bible.js";
import { castCreate, characterOptionLines, checkedSets, kindConsistentSets } from "../cast_design.js";
import { listCharacters, loadCharacter } from "../character_store.js";
import { estimateModelUsageCost } from "../cost_tracker.js";
import { RULES_HEADING } from "./script.js";

/** The drawing style a designed cast gets unless a style pack or the brief names another. */
export const DEFAULT_DRAWING_STYLE = "chibi";
/** The set paths the designer may use: a look. The name, the voice and the drawing style are tooling's. */
export const DESIGN_PATHS = Object.freeze(CHARACTER_PATHS.filter((name) => !["name", "voice", "style"].includes(name)));
export const POSITIONS = Object.freeze(["left", "centre", "right"]);
export const MAX_BIBLE_SETS = 3;
export const MAX_BIBLE_RULES = 3;
// The world a story gets when neither the model nor the brief's words name one the kit draws.
const FALLBACK_WORLD = "living-room";

const text = (value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
const slug = (value) => text(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const titleCase = (id) => id.split("-").filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");

export const BIBLE_DESIGN_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["characters", "drawing_style", "world", "sets", "rules"],
  properties: {
    characters: {
      type: "array",
      description: "One entry per character of the script, by its id.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "use", "sets", "position"],
        properties: {
          id: { type: "string", description: "The character's id, exactly as the script lists it." },
          use: { type: "string", description: "\"\" to design a new character; else the id of a starter or saved character to use for this role." },
          sets: {
            type: "array",
            description: "The look, as set paths. With `use`, the changes to that character ([] keeps it as it is).",
            items: { type: "object", additionalProperties: false, required: ["path", "op", "value"], properties: { path: { type: "string", enum: [...DESIGN_PATHS] }, op: { type: "string", enum: ["=", "+=", "-="] }, value: { type: "string" } } }
          },
          position: { type: "string", enum: ["", ...POSITIONS], description: "The side of the frame this character keeps in every shot it shares." }
        }
      }
    },
    drawing_style: { type: "string", enum: ["", ...DRAWING_STYLES], description: `"" for the default (${DEFAULT_DRAWING_STYLE}); another only when the brief asks for a drawing style.` },
    world: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "time"],
      properties: { kind: { type: "string", enum: [...WORLD_KINDS] }, time: { type: "string", enum: [...WORLD_TIMES] } }
    },
    sets: { type: "array", description: `The sets the story plays on, ${MAX_BIBLE_SETS} at most.`, items: { type: "string", enum: [...SETS] } },
    rules: { type: "array", description: `Up to ${MAX_BIBLE_RULES} continuity rules; [] when there are none.`, items: { type: "string" } }
  }
});

const DESIGNER_ROLE = `You are the character and world designer of a short animated story. Its characters are drawn in code by a rig: you choose from the rig's options, listed below, and can choose nothing else.

For each character of the script, give:
- use: "" to design a new character, which is the usual choice. Name a starter or a saved character (lists below) only when the brief asks for one, or one plainly is this role.
- sets: the look, as set paths. Each value must be one of the options listed for its path; choose the nearest option when the words name something the rig lacks. For a new character set at least skin, hair.style, hair.color, outfit.top and colors.top. With use, sets are the changes to that character, and [] keeps it as it is.
- A character is a person unless the story makes it an animal, a mascot or an object (a foal, a cat, a robot, a coffee cup). For one of those, set kind to the nearest option and then only size, marks, colors.body, colors.detail and colors.accent: it has no skin, hair, age, build, outfit or accessories, and those are left out if you set them.
- position: the side of the frame the character keeps in every shot it shares: left, centre or right, a different one each. The lead usually takes the left.

The look to aim for is cute, relatable and simply dressed:
- everyday clothes (a tee, a hoodie, a sweater, a shirt) in one or two plain colours;
- at most one accessory, and only when it says who the person is;
- no costume, uniform or headwear unless the role or the brief calls for it;
- characters a viewer can tell apart at a glance: different hair, a different top colour, and a different build or height.
What the brief says about anyone's look, age or dress comes first: follow it exactly. A character is an illustrative person. If the brief names a real person, use only the plain traits it states (hair, clothes, build) and never try for a likeness.

Also choose:
- drawing_style: "" keeps the default (${DEFAULT_DRAWING_STYLE}). Name another only when the brief asks for a particular drawing style.
- world: the kind of place the story happens in, and the time of day.
- sets: the sets the story plays on, ${MAX_BIBLE_SETS} at most. Include every place the script names.
- rules: up to ${MAX_BIBLE_RULES} short continuity rules a director must keep ("Sam never raises his voice."), or [].

Do not choose voices, names or lines: those are set. Return only the JSON object.`;

function scriptLines(script) {
  return (script.beats ?? []).map((beat) => [`${beat.beat}${beat.place ? ` (${beat.place})` : ""}:`, ...(beat.lines ?? []).map((entry) => (entry.speaker === null ? `  [silent] ${entry.action}` : `  ${entry.speaker}: ${entry.text}`))].join("\n"));
}

/** The places a script names, in order (each a set of the kit). */
export const scriptPlaces = (script) => [...new Set((script?.beats ?? []).map((beat) => beat.place).filter((place) => SETS.includes(place)))];

/**
 * The call. options: {client, provider, model, prompt, notes, rules, script
 * (the screenplay), saved: [{id, name, personality?}] (characters already
 * saved in the project or the library), styleFixed (a drawing style a style
 * pack pins, or null)}
 * → {design (normalizeBibleDesign's), usage, cost_usd, model}
 */
export async function designBible(options = {}) {
  const { client, script, saved = [], styleFixed = null } = options;
  if (!client || typeof client.runStructured !== "function") throw new Error("the show bible needs a model client");
  const characters = script?.characters ?? [];
  if (!characters.length) throw new Error("designBible needs a script with characters");
  const lines = [
    "Design the cast and the world of this story.",
    "",
    "## Brief",
    "",
    text(options.prompt),
    ...((options.notes ?? []).length ? ["", "## Notes from the assets folder", "", ...options.notes.map((note) => String(note).trim().slice(0, 4000))] : []),
    ...(options.rules && String(options.rules).trim() ? ["", RULES_HEADING, "", String(options.rules).trim().slice(0, 6000)] : []),
    "",
    "## The story",
    "",
    ...(script.logline ? [`Logline: ${script.logline}`, ""] : []),
    ...scriptLines(script),
    "",
    "## Characters to design (ids)",
    "",
    ...characters.map((character) => `- ${character.id}${character.name ? ` (${character.name})` : ""}: ${[character.role, character.want ? `wants ${character.want}` : "", character.speech ? `speaks ${character.speech}` : "", character.voice_type && character.voice_type !== "either" ? `a ${character.voice_type} voice` : ""].filter(Boolean).join("; ")}${isStarterId(character.id) ? ` [shares its id with the starter "${character.id}": it is that starter unless you name another in use; sets change it]` : ""}${saved.some((entry) => entry.id === character.id) ? " [already designed and saved under this id: it is used as it is]" : ""}`),
    ...(styleFixed ? ["", `The drawing style is fixed by the style pack: ${styleFixed}.`] : []),
    "",
    "## Set paths and their options",
    "",
    ...characterOptionLines(DESIGN_PATHS),
    "",
    "## Starter characters (for use)",
    "",
    ...STARTER_CAST.map((entry) => `- ${entry.id}: ${entry.summary}`),
    ...(saved.length ? ["", "## Saved characters (for use)", "", ...saved.map((entry) => `- ${entry.id}: ${[entry.name, entry.personality].filter(Boolean).join("; ")}`)] : [])
  ];
  const result = await client.runStructured({ instructions: DESIGNER_ROLE, input: `${lines.join("\n")}\n`, schema: BIBLE_DESIGN_SCHEMA, schemaName: "launchclip_animation_bible", maxOutputTokens: 3000, model: undefined });
  const value = result?.value && typeof result.value === "object" ? result.value : parseText(result?.text);
  if (!value || !Array.isArray(value.characters)) throw new Error("the designer returned no cast");
  const usage = result?.usage ?? {};
  const used = result?.model ?? options.model ?? null;
  return { design: normalizeBibleDesign(value, { characters, places: scriptPlaces(script), prompt: options.prompt }), usage, model: used, cost_usd: estimateModelUsageCost(options.provider ?? client.provider ?? "openai", used, usage).estimated_usd };
}

/**
 * A designer's answer in a checked shape. Every script character gets an
 * entry (one the model left out is designed from the defaults), every set is
 * one the rig has, each character has a side of its own (three at most have
 * one), and the world and the sets are ones the kit draws.
 * → {characters: [{id, use, sets, rejected, position}], drawing_style | null,
 *    world: {kind, time}, sets, rules}
 */
export function normalizeBibleDesign(value, { characters = [], places = [], prompt = "" } = {}) {
  const given = new Map();
  for (const entry of Array.isArray(value?.characters) ? value.characters : []) {
    const named = slug(entry?.id);
    const id = characters.find((character) => character.id === named || slug(character.name) === named)?.id;
    if (id && !given.has(id)) given.set(id, entry);
  }
  const taken = new Set();
  const cast = characters.map((character) => {
    const entry = given.get(character.id) ?? {};
    const allowed = (Array.isArray(entry.sets) ? entry.sets : []).filter((set) => DESIGN_PATHS.includes(set?.path));
    const checked = checkedSets(allowed);
    // A foal with a person's age or hair: keep what applies to what the character is, and report the rest.
    const agreed = kindConsistentSets(checked.kept);
    const kept = agreed.kept, rejected = [...checked.rejected, ...agreed.rejected];
    const side = POSITIONS.includes(entry.position) && !taken.has(entry.position) ? entry.position : null;
    if (side) taken.add(side);
    return { id: character.id, use: slug(entry.use) || null, sets: kept.map(({ path: where, op, value: option }) => ({ path: where, op, value: option })), rejected, position: side };
  });
  // Sides nobody chose, in the order a two-shot reads: left, right, then the centre.
  const free = ["left", "right", "centre"].filter((side) => !taken.has(side));
  for (const member of cast) if (!member.position && free.length) member.position = free.shift();
  const suggested = suggestWorld(prompt);
  const world = { kind: WORLD_KINDS.includes(value?.world?.kind) ? value.world.kind : suggested?.kind ?? FALLBACK_WORLD, time: WORLD_TIMES.includes(value?.world?.time) ? value.world.time : "day" };
  const sets = [...new Set([...places, ...(Array.isArray(value?.sets) ? value.sets : []).filter((name) => SETS.includes(name))])].slice(0, Math.max(MAX_BIBLE_SETS, places.length));
  const rules = [...new Set((Array.isArray(value?.rules) ? value.rules : []).map(text).filter((rule) => rule && rule.length <= 200))].slice(0, MAX_BIBLE_RULES);
  return { characters: cast, drawing_style: DRAWING_STYLES.includes(value?.drawing_style) ? value.drawing_style : null, world, sets, rules };
}

const setFlag = (set) => `${set.path}${set.op}${set.value}`;
const kokoro = (voice) => typeof voice === "string" && KOKORO_VOICES.includes(voice);

/**
 * The story cast a design makes, each character through the door `cast
 * create` uses. → {entries (draft bible cast entries), characters: [{id,
 * source: "designed" | "starter" | "saved", from?, file?, applied, rejected}]}
 *
 * - A character already saved under the role's id, which make did not design
 *   (`own`), is the user's: it is used as it is.
 * - A role whose id is a starter's is that starter (or the starter `use`
 *   names) with the sets applied; a starter id cannot be a saved file.
 * - Any other role is saved to <project>/cast/<id>.character.json: designed
 *   from the sets, or started from the character `use` names.
 * voices: Map id → the voice the script was voiced in (kept, so the take
 * stands); a saved character keeps its own when no other speaker has it.
 */
export async function castFromDesign({ project, script, design, style, voices = new Map(), narratorVoice = null, own = [], home } = {}) {
  const store = { projectDir: project, home };
  const entries = [];
  const characters = [];
  const spoken = new Set([narratorVoice, ...voices.values()].filter(Boolean));
  for (const role of script.characters) {
    const plan = design.characters.find((entry) => entry.id === role.id) ?? { use: null, sets: [], rejected: [], position: null };
    const name = text(role.name) || null;
    const extra = { ...(name ? { name } : {}), ...(plan.position ? { position: plan.position } : {}) };
    let voice = voices.get(role.id) ?? null;
    const saved = isStarterId(role.id) || own.includes(role.id) ? null : await loadCharacter(role.id, store);
    if (saved) {
      // The user's own design under this id: its look, and its voice when it is free.
      const theirs = saved.character.voice;
      if (kokoro(theirs) && theirs !== voice && !spoken.has(theirs)) { spoken.delete(voice); voice = theirs; spoken.add(theirs); }
      entries.push({ id: role.id, ...extra, ...(voice ? { voice } : {}) });
      characters.push({ id: role.id, source: "saved", file: path.relative(project, saved.file), applied: [], rejected: plan.rejected });
      continue;
    }
    const useStarter = plan.use && isStarterId(plan.use) ? plan.use : null;
    if (isStarterId(role.id)) {
      const base = useStarter ?? role.id;
      if (base === role.id && !plan.sets.length) entries.push({ id: role.id, ...extra, ...(voice ? { voice } : {}) });
      else {
        // The starter with the designer's changes, written out in full (normalised under a stand-in id: a starter id is not a saved character's).
        const starter = starterCharacter(base);
        const { skin: _skin, hair: _hair, ...colors } = starter.params.colors;
        const draft = applyCharacterSets({ schema: CHARACTER_SCHEMA, id: "draft", name: name ?? starter.name, style, params: { ...starter.params, colors } }, plan.sets);
        const { id: _id, name: _name, voice: _voice, ...look } = characterCastEntry(normalizeCharacter(draft));
        entries.push({ id: role.id, name: name ?? starter.name, ...(plan.position ? { position: plan.position } : {}), ...(voice ? { voice } : {}), ...look });
      }
      characters.push({ id: role.id, source: "starter", from: base, applied: plan.sets.map(setFlag), rejected: plan.rejected });
      continue;
    }
    const from = useStarter ?? (plan.use && plan.use !== role.id && (await loadCharacter(plan.use, store)) ? plan.use : null);
    const made = await castCreate(role.id, { project, force: true, "no-sheet": true, name: name ?? titleCase(role.id), style, ...(voice ? { voice } : {}), ...(from ? { from } : {}), set: plan.sets.map(setFlag) }, { home });
    entries.push({ id: role.id, ...extra, ...(voice ? { voice } : { voice: made.character.voice }) });
    characters.push({ id: role.id, source: from ? (useStarter ? "starter" : "saved") : "designed", ...(from ? { from } : {}), file: path.relative(project, made.file), applied: made.applied, ...(made.assumed?.length ? { assumed: made.assumed } : {}), rejected: plan.rejected });
  }
  return { entries, characters };
}

/**
 * The bible from a design: the cast (castFromDesign), a draft BIBLE.json, and
 * `bible freeze`, which draws the sheets and writes the hash. An earlier
 * bible in the project is replaced: this is a new bible.
 * options: {project, script, design, style (the drawing style), voices,
 *   narratorVoice, own, pack (the project's style pack name), seed, chromium}
 * hooks: {render(html, png) (stands in for Chromium), home}
 * → {bible: freezeBible's result, characters, style}
 */
export async function makeBible(options = {}, hooks = {}) {
  const { project, design, style } = options;
  const cast = await castFromDesign({ ...options, home: hooks.home });
  const draft = {
    schema: BIBLE_SCHEMA,
    frozen: false,
    cast: { style, characters: cast.entries },
    world: { kind: design.world.kind, time: design.world.time, ...(design.sets.length ? { sets: design.sets } : {}) },
    style: { drawing_style: style },
    ...(design.rules.length ? { rules: design.rules } : {})
  };
  await writeFile(path.join(project, BIBLE_FILE), `${JSON.stringify(draft, null, 2)}\n`);
  const frozen = await freezeBible(project, { style, force: true, pin: false, ...(options.pack ? { pack: options.pack } : {}), ...(options.seed != null ? { seed: options.seed } : {}), ...(options.chromium ? { chromium: options.chromium } : {}) }, hooks);
  return { bible: frozen, characters: cast.characters, style };
}

/** The characters a designer may be offered by id: those saved in the project or the library. */
export async function savedForDesign(project, { home } = {}) {
  return (await listCharacters({ projectDir: project, home })).filter((row) => !row.error && !row.shadowed).map((row) => ({ id: row.id, name: row.name, personality: row.personality ?? null }));
}

function parseText(value) {
  if (typeof value !== "string") return null;
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(value.slice(start, end + 1)); } catch { return null; }
}

/**
 * The planner's brief for a character story: the screenplay with its line
 * ids, the frozen bible, and how to stage talk. → markdown lines.
 * A talk-heavy two-shot that never changes fails finish's density and motion
 * gates, so the staging notes ask for a change of shot and for acting.
 */
export function animationBriefLines({ script, bible }) {
  const lines = [];
  const cast = Array.isArray(bible?.cast?.characters) ? bible.cast.characters : [];
  const role = new Map((script?.characters ?? []).map((character) => [character.id, character]));
  lines.push("## Screenplay (SCRIPT.json; already voiced, one voice a speaker, and the word timings carry each word's speaker)", "");
  if (script?.logline) lines.push(`Logline: ${script.logline}`, "");
  for (const beat of script?.beats ?? []) {
    lines.push(`${beat.beat}${beat.place ? ` (place: ${beat.place})` : ""}:`);
    for (const entry of beat.lines ?? []) lines.push(entry.speaker === null ? `- ${entry.id} [silent, ${entry.seconds}s] ${entry.action}` : `- ${entry.id} ${entry.speaker}: ${entry.text}${entry.playing ? ` (playing: ${entry.playing})` : ""}`);
    lines.push("");
  }
  lines.push("A direction-map line that plays a script line names it (`\"line\": \"l3\"`); its section's `beat` is the script's beat. A silent line has no words: play it as an acting cue in the pause after the spoken line before it.", "");
  if (cast.length) {
    lines.push(`## Show bible (${bible.hash ? "frozen; " : ""}the cast is fixed)`, "");
    for (const member of cast) {
      const who = role.get(member.id);
      lines.push(`- ${member.id}${member.name ? ` (${member.name})` : ""}${member.position ? `, stands ${member.position}` : ""}: ${[who?.role, who?.want ? `wants ${who.want}` : "", who?.speech ? `speaks ${who.speech}` : ""].filter(Boolean).join("; ") || "a character"}. Look: ${(member.must_keep ?? []).join(", ") || "see the sheet"}.`);
    }
    if (bible.world?.kind) lines.push(`- World: ${bible.world.kind}${bible.world.time ? `, ${bible.world.time}` : ""}.${bible.world.sets?.length ? ` Sets: ${bible.world.sets.join(", ")}.` : ""}`);
    for (const rule of bible.rules ?? []) lines.push(`- Rule: ${rule}`);
    lines.push("", `Drawn ${bible.cast.style}. Never add, drop, rename or restyle a character; a scene names who is in it by id.`, "");
  }
  lines.push(
    "## Staging (a story told by its characters)",
    "",
    "- Every beat is played by the cast: cast-scene shots on the sets above (character-cameo for one character beside a card). No slideshow of cards over a voice.",
    "- While a character speaks, a shot with that character is on screen, with `says: \"auto\"` so the mouth moves on its own lines. The narrator's lines play over the cast acting what is told.",
    "- Change the shot with the story: a new shot when the place, the speaker or the feeling changes, and no shot longer than about six seconds. Move between a wide two-shot and a medium or close shot of one character (`shot`), and give each shot a pose or expression cue on a word, so nobody stands frozen while someone talks.",
    "- The listener reacts: a look, a change of expression or a pose on the line that lands on them.",
    "- Keep each character on its side of the frame in every shot it shares.",
    "- The cast check fails a limb or a head that reaches off the canvas or out of the safe zone. A closer shot (`shot: \"medium\"` or `\"close\"`) of one seated or gesturing character usually brings it back inside; so does a calmer pose.",
    ""
  );
  return lines;
}

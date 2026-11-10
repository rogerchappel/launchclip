// Storyboard planner: brief (+ narration) → storyboard.json through one model
// call and a bounded repair loop (docs/STORYBOARD_ENGINE_RFC.md §7).
//
//   planStoryboard({brief, words, lane, format, brand, tier, model, client})
//
// 1. The model gets planningPrompt() (generated from the module registry) and
//    the brief, and returns one storyboard JSON object.
// 2. Tooling pins the fixed inputs (lane, format, brand, voice, words, base),
//    then checks the result: validateStory against knownModules(), the tier rules,
//    anchor resolution, resolveModule() for every scene (param errors), and the
//    layout check on the declared geometry.
// 3. On failure the exact errors go back to the model, which returns a
//    corrected storyboard; at most `maxRepairs` (default 2) times. Repairs
//    target scenes and params; the checks and their thresholds never change.
//
// `client` is any object with runStructured(request) → {value?, text?, usage,
// model, response_id} (src/model_provider.js clients, the Anthropic adapter
// below, or a fake in tests), so the planner runs keyless in tests.

import { STORY_LANES, resolveStory, validateStory } from "@launchclip/core/story.mjs";
import { validateModuleParams } from "@launchclip/core/module-schemas.mjs";
import { isEditorialKind, knownModules, formatAspect, resolveModule, sceneRenderEnd, subjectDensityWarnings } from "@launchclip/core/modules.mjs";
import { DIRECTION_LANES, directionMeasures, draftDirectionMap, validateDirection } from "@launchclip/core/direction.mjs";
import { isLongForm, structureLongForm } from "@launchclip/core/long-form.mjs";
import { compareMeasures } from "@launchclip/core/profiles.mjs";
import { checkLayout, elementsFromEditorialLayout, elementsFromStory, layoutExtras } from "@launchclip/core/layout-check.mjs";
import { castCaptionZones } from "@launchclip/core/cast-captions.mjs";
import { captionZones } from "@launchclip/core/footage-layout.mjs";
import { DEFAULT_BRAND, PLANNER_TIERS, TUNING_PARAMS, directionPrompt, planningPrompt, suggestModules } from "@launchclip/core/planning-prompt.mjs";
import { applyStyle } from "@launchclip/core/style.mjs";
import { clipLedFindings, clipLedPlan } from "@launchclip/core/clip-led.mjs";
import { validateCastCues } from "@launchclip/core/characters/cues.mjs";
import { createStructuredClient, parseModelRoute } from "./model_provider.js";
import { estimateModelUsageCost } from "./cost_tracker.js";
import { backdropPrompt, cardBackdrops, minShotsError, resolveShots, shotPrompt, shotRequestLimit, shotRequests } from "./asset_provider.js";
import { restoreMisses, varyInserts } from "./insert_variety.js";
import { fitTimings } from "./timing_fit.js";
import { fitDirectionCast, normalizeCastCues, plannedCast } from "./cast_fit.js";
import { bibleCast, bibleRef, directionWithBible } from "@launchclip/core/bible.mjs";
import { castGate } from "./cast.js";
import { actingGate } from "./direction_guardrails.js";
import { placeActions } from "./acting_place.js";
import { lipSyncGate } from "./quality_gates.js";
import { SHORT_FORM_HOLD, fitDurations, paceErrors } from "./duration_fit.js";
import { captionBandWarning, settleCaptionBand } from "./caption_band_fit.js";
import { captionBandFor } from "./layout_check.js";
import { fitDiagrams } from "./diagram_fit.js";
import { fitFaceClear } from "./face_clear_fit.js";
import { checkConstraints, constraintsPrompt, enforceHiddenLines, fillConstraints, hasConstraints, reconcileMap } from "./constraints.js";
import { featuredPrompt, unusedFeatured } from "./asset_understanding.js";
import { bareNotesLine, mediaNotesLine, snapMediaWindows } from "./inventory_notes.js";
import { cardErrors, fitShotCallouts, hookErrors, hookTimingErrors, storyboardSeconds } from "./short_form_checks.js";
import { layoutSpec, talkingHeadLayout } from "./talking_head_layout.js";
import { abstractErrors, castFromDirection, characterErrors, characterShare, defaultExplainerCast, openingErrors } from "@launchclip/core/explainer.mjs";
import { readingFindings } from "./direction_guardrails.js";
import { fitCastCuts } from "./cast_cut_fit.js";

export const STORYBOARD_PLAN_VERSION = "launchclip.storyboard-plan.v1";
export const DEFAULT_MAX_REPAIRS = 2;
// Repairs for the direction map itself, before the storyboard is planned.
export const DIRECTION_MAX_REPAIRS = 1;

// Strict-mode compatible envelope: the storyboard travels as a JSON string,
// because its params are open objects that strict JSON schemas cannot express.
export const STORYBOARD_ENVELOPE_SCHEMA = Object.freeze({
  type: "object",
  properties: { storyboard_json: { type: "string", description: "The complete storyboard.json document, serialised as JSON." } },
  required: ["storyboard_json"],
  additionalProperties: false
});

export const DIRECTION_ENVELOPE_SCHEMA = Object.freeze({
  type: "object",
  properties: { direction_json: { type: "string", description: "The complete DIRECTION.json document, serialised as JSON." } },
  required: ["direction_json"],
  additionalProperties: false
});

// A repair returns both artifacts; an empty direction_json keeps the map.
export const PLAN_REPAIR_ENVELOPE_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    storyboard_json: { type: "string", description: "The complete corrected storyboard.json document, serialised as JSON." },
    direction_json: { type: "string", description: "The complete corrected DIRECTION.json, serialised as JSON, or an empty string to keep it unchanged." }
  },
  required: ["storyboard_json", "direction_json"],
  additionalProperties: false
});

// Profile measures a plan must land inside before it passes; the rest of the
// band is checked by finish and reported here as warnings.
const PLAN_BAND_ERRORS = Object.freeze(["coverage", "longest_undressed_seconds"]);

// What a repair does about a measure outside its band.
function bandRepair(band) {
  if (band.measure === "coverage") return band.status === "below" ? "dress more lines (turn face lines whose intent calls for a visual into dress or insert lines with scenes)" : "hold more lines on the presenter";
  if (band.measure === "longest_undressed_seconds") return "dress a line inside the longest undressed run";
  if (band.measure === "face_time" && band.status === "above") return "cut away from the presenter: make the lines that name something the viewer could see (a thing, a place, a step) insert lines with a full-frame scene (a shot, or a full-frame graphic)";
  return "adjust the scenes";
}

/**
 * Plan a storyboard. Returns a report (never throws on a model or check
 * failure; status is "passed" or "failed"):
 * {schema_version, status, storyboard, tier, lane, model, attempts, repairs_used,
 *  valid_first_attempt, errors, warnings, layout, usage, cost, elapsed_ms, phrase_hints}
 */
export async function planStoryboard(options = {}) {
  const { brief, words = null, beats = null, lane = "motion", format, tier = "structured", model = null, client, audio = null, base = null, maxRepairs = DEFAULT_MAX_REPAIRS, now = () => Date.now(), style = null, extraCheck = null, subject = null, profile = null, assets = null, project = null, featured = null } = options;
  // constraints: the app's hard rules (src/constraints.js, parsed); media:
  // the supplied clips and images [{src, kind, duration?, width?, height?,
  // notes?, description?}] the deterministic pass may place, whose notes'
  // usable windows set video in points.
  const constraints = hasConstraints(options.constraints) ? options.constraints : null;
  // subjectTrack: the presenter's whole-video head track (src/subject/project.js
  // readStoryTrack), so tooling keeps cards off the face; none → the default head.
  const subjectTrack = options.subjectTrack ?? null;
  const media = Array.isArray(options.media) ? options.media : [];
  // bible: the project's frozen show bible (kit/core/bible.mjs). Its cast is
  // the story's cast in every attempt (pinned like the brand, so a repair or a
  // replan cannot change who is in the story), and the storyboard and the map
  // name it. script: the raw SCRIPT.json, so a map line's `line` id is checked.
  const bible = options.bible?.frozen === true ? options.bible : null;
  const script = options.script && typeof options.script === "object" ? options.script : null;
  // direction: true plans DIRECTION.json first (one call, RFC §6.4), a map
  // object plans against that map, false or omitted plans no map.
  // style: a loaded launchclip.style.v2 pack. Its brand is the default brand,
  // the planned storyboard names it, and the checks run on the merged story.
  const brand = options.brand ?? (style?.brand ? styleBrand(style) : DEFAULT_BRAND);
  if (!nonEmpty(brief)) throw new Error("planStoryboard needs a non-empty brief");
  if (!PLANNER_TIERS.includes(tier)) throw new Error(`tier must be one of ${PLANNER_TIERS.join(", ")}`);
  if (!STORY_LANES.includes(lane)) throw new Error(`lane must be one of ${STORY_LANES.join(", ")}`);
  if (!format || !Number.isInteger(format.width) || !Number.isInteger(format.height) || !(format.duration > 0)) throw new Error("planStoryboard needs format {width, height, fps, duration}");
  if (!client || typeof client.runStructured !== "function") throw new Error("planStoryboard needs a client with runStructured()");
  const repairs = Math.max(0, Math.min(5, Number.isInteger(maxRepairs) ? maxRepairs : DEFAULT_MAX_REPAIRS));
  const wordList = Array.isArray(words) ? words : Array.isArray(words?.words) ? words.words : [];
  const fixed = fixedInputs({ lane, format, brand, audio, base });
  // A talking-head layout for the whole video (src/talking_head_layout.js):
  // options.layout full (default), stacked; footage-led only.
  const layout = lane === "footage-led" ? layoutSpec(talkingHeadLayout(options.layout)) : null;
  if (style?.name) fixed.style = style.name;
  // subject: the presenter probe summary ({usable, reasons, framing, headroom,
  // head}); subject modules are offered only when it is usable.
  const started = now();
  const attempts = [];
  const wantsMap = options.direction === true && DIRECTION_LANES.includes(lane) && wordList.length > 0;
  let direction = options.direction && typeof options.direction === "object" ? options.direction : null;
  let directionSource = direction ? "given" : null;
  let directionPlan = { attempts: [], warnings: [] };
  // The cast the story will have (the seed storyboard's, else the style's):
  // the direction map's cues are planned and checked against it, and a
  // seeded style's default roster takes the story's own names (src/cast_fit.js).
  const castPlan = plannedCast({ story: options.seed?.storyboard ?? null, style, bible });
  let boundCast = null;
  // explainer: a character-led explainer (kit/core/explainer.mjs): a one-prompt
  // explainer with nothing to show is carried by a small cast the direction
  // map chooses, and the checks hold the storyboard to it. A seed storyboard
  // (a repair of a planned video) keeps the cast it has.
  const wantsCast = options.explainer === true && lane !== "footage-led" && !bible;
  let explainer = null;
  if (wantsCast && options.seed?.storyboard?.cast?.characters?.length) explainer = { cast: JSON.parse(JSON.stringify(options.seed.storyboard.cast)), roles: [], dropped: [] };
  if (wantsMap) {
    directionPlan = await planDirection({ client, model, brief, fixed, profile, words: wordList, subject, segments: style?.segments ?? null, now, constraints, cast: castPlan, script, explainer: wantsCast && !explainer });
    direction = directionPlan.map;
    directionSource = direction ? "model" : null;
    if (wantsCast && !explainer) explainer = directionPlan.casting ?? { ...defaultExplainerCast(), dropped: [] };
    else if (direction && directionPlan.bound?.length) boundCast = directionPlan.cast;
  } else if (direction) {
    if (wantsCast && !explainer) explainer = castFromDirection(direction) ?? { ...defaultExplainerCast(), dropped: [] };
    // A given map gets the same fit: kit values for free text, names bound.
    const fit = fitDirectionCast(direction, { cast: castPlan, words: wordList });
    direction = fit.map;
    directionPlan.warnings.push(...fit.warnings);
    if (fit.bound.length) boundCast = fit.cast;
  }
  // A bound cast is written into the storyboard (pinned like the brand), so
  // the style never re-applies its own roster; the prompt names it too.
  let planStyle = style;
  if (wantsCast && !explainer) explainer = { ...defaultExplainerCast(), dropped: [] };
  // The explainer's cast is the story's, pinned like a bound one.
  if (explainer) boundCast = explainer.cast;
  if (boundCast) {
    fixed.cast = boundCast;
    if (style) planStyle = { ...style, cast: { ...(style.cast ?? {}), members: boundCast.characters, ...(explainer ? { drawing_style: boundCast.style } : {}) } };
  }
  // The show bible's cast is pinned the same way, whatever the style or the
  // map say, and both files name the bible they were planned against.
  const pinMap = (map) => (bible && map ? directionWithBible(map, bible) : map);
  if (bible) {
    fixed.cast = bibleCast(bible);
    fixed.bible = bibleRef(bible);
    // The bible's world is the story's place (its sets stay the bible's own list).
    if (typeof bible.world?.kind === "string") fixed.world = { kind: bible.world.kind, ...(bible.world.time ? { time: bible.world.time } : {}), ...(Array.isArray(bible.world.props) && bible.world.props.length ? { props: bible.world.props } : {}) };
    if (style?.cast) planStyle = { ...style, cast: { ...style.cast, drawing_style: fixed.cast.style, members: fixed.cast.characters } };
    direction = pinMap(direction);
  }
  // Lines over a hidden range are insert lines, whatever the model chose.
  const constraintWarnings = [];
  if (constraints && direction) {
    const enforced = enforceHiddenLines(direction, constraints, wordList);
    direction = enforced.map;
    for (const change of enforced.changed) constraintWarnings.push(`constraints: direction line words [${change.words.join(", ")}] was "${change.from}" over a hidden range; it is an insert line`);
  }
  if (assets && typeof assets.findShot !== "function") throw new Error("assets must be an asset provider with findShot(request)");
  // assets: the app's asset provider (src/asset_provider.js). The model may
  // then ask for shots, which are found or generated before the checks.
  // Clip-led planning (kit/core/clip-led.mjs): with footage to cut (options.clips,
  // [{src, kind, duration?}] from the asset manifest, or the asset provider) and
  // a low density dial (options.density, else the style pack's dials.density),
  // supplied footage carries the video in full-frame clip scenes.
  // minShots (make --min-shots): with a provider, a storyboard asking for
  // fewer shots gets a repair note; when the repairs run out the best one is
  // kept with a warning, never failed. Without a provider it is ignored.
  const askedMin = Number.isFinite(Number(options.minShots)) ? Math.max(0, Math.floor(Number(options.minShots))) : 0;
  const shotLimit = shotRequestLimit(fixed.format?.duration);
  const minShots = assets ? Math.min(askedMin, shotLimit) : 0;
  const shotWarnings = [];
  if (assets && askedMin > shotLimit) shotWarnings.push(`shots: minShots ${askedMin} is more than a plan may ask for; using ${shotLimit}`);
  if (!assets && askedMin > 0) shotWarnings.push(`shots: minShots ${askedMin} ignored: there is no asset provider to ask for shots`);
  const clipLed = clipLedPlan({ lane, ...densityDial(options.density, style), clips: Array.isArray(options.clips) ? options.clips : [], provider: Boolean(assets), profile });
  // cardBackdrops "footage" (make --card-backdrops): with a provider, the
  // model may put a full-screen card on a library clip, and the card scenes
  // it leaves on a stock plate ask for one too (src/asset_provider.js).
  const footageBackdrops = Boolean(assets) && options.cardBackdrops === "footage" && lane !== "footage-led";
  if (!assets && options.cardBackdrops === "footage") shotWarnings.push("backdrops: card backdrops ignored: there is no asset provider to ask for footage");
  const instructions = [planningPrompt({ tier, lane, format: fixed.format, brand: fixed.brand, words: wordList.length ? wordList : undefined, style: planStyle, artDirection: brief, subject, profile, direction, clipLed, explainer }), ...(layout ? [layout.prompt()] : []), ...(assets ? [shotPrompt({ min: minShots, max: shotLimit })] : []), ...(footageBackdrops ? [backdropPrompt()] : []), ...(constraints ? [constraintsPrompt(constraints, { words: wordList, mediaLines: mediaNoteMap(media) })] : []), ...(featured?.length ? [featuredPrompt(featured)] : []), ...(bible ? [biblePrompt(bible)] : [])].join("\n\n");
  const shotCache = new Map();
  let shots = [];
  const hints = suggestModules([brief, wordList.map((entry) => entry?.text ?? entry?.word ?? "").join(" ")].join(" "), { lane, subject: Boolean(subject?.usable) });
  // history: a "Recent videos" section (src/visual_history.js historyPrompt)
  // naming what earlier videos in the series chose, so this plan differs.
  const request = planRequest({ brief, fixed, hints, direction, history: options.history ?? null });
  let previous = null;
  let last = null;
  // The storyboard that passed everything but the shot minimum, with the most requests.
  let best = null;
  // A storyboard that misses only the cadence bands (a run of face time a
  // second over the profile's limit) or has a card the model left as
  // placeholders, kept in case the repairs run out: a near miss beats no video.
  let paced = null;

  // seed {storyboard, errors}: start from an existing storyboard and a list
  // of known problems (a critic's findings on its render) instead of a fresh
  // plan; every attempt is a repair, checked like any other.
  const seed = options.seed?.storyboard ? options.seed : null;
  if (seed) previous = { candidate: seed.storyboard, errors: Array.isArray(seed.errors) ? seed.errors : [] };
  for (let attempt = 0; attempt <= repairs; attempt += 1) {
    const kind = attempt === 0 && !seed ? "plan" : "repair";
    const input = kind === "plan" ? request : repairRequest({ request, previous: previous?.candidate ?? null, errors: previous?.errors ?? [], attempt, repairs, direction, shots: previous?.shotCounts?.shots ?? [] });
    const callStarted = now();
    let result;
    try {
      result = await client.runStructured({
        instructions,
        input,
        schema: kind === "repair" && direction ? PLAN_REPAIR_ENVELOPE_SCHEMA : STORYBOARD_ENVELOPE_SCHEMA,
        schemaName: "launchclip_storyboard",
        model: bareModelId(model) ?? undefined,
        temperature: 0,
        maxOutputTokens: 16_000
      });
    } catch (error) {
      // A transport failure is not something a repair prompt can fix.
      attempts.push({ attempt, kind, ok: false, errors: [`model: ${message(error)}`], warnings: [], layout: { errors: 0, warnings: 0 }, usage: emptyUsage(), cost_usd: 0, model, elapsed_ms: now() - callStarted });
      last = { ok: false, errors: [`model: ${message(error)}`], warnings: [], storyboard: null, layout: emptyLayout() };
      break;
    }
    const usage = normalizeUsage(result?.usage);
    const cost = estimateModelUsageCost(providerOf(client, model), result?.model ?? model, usage);
    const extracted = extractStoryboard(result);
    let checked;
    if (!extracted.ok) checked = { ok: false, errors: [`json: ${extracted.error}`], warnings: [], storyboard: null, layout: emptyLayout(), candidate: extracted.text ?? null };
    else {
      const pinned = pinInputs(extracted.storyboard, fixed);
      // A repair may return a corrected map with the storyboard.
      const repairedMap = kind === "repair" && direction ? extractDirection(result) : null;
      if (repairedMap?.ok) {
        // A repaired map's free-text cues get the kit's values, as the first map's did.
        const normalized = normalizeCastCues(repairedMap.map);
        direction = bible ? pinMap(fitDirectionCast(normalized.map, { cast: castPlan, words: wordList }).map) : normalized.map;
        // A repaired map keeps the explainer's cast (the repair does not recast).
        if (explainer) direction = { ...direction, cast: explainer.cast };
        if (normalized.changed.length) pinned.warnings = [...pinned.warnings, ...normalized.changed.map((entry) => `cast: tooling mapped DIRECTION.json ${entry}`)];
      }
      let shotErrors = [];
      let shotCounts = null;
      let shotMedia = [];
      // Footage inserts vary their frame (src/insert_variety.js), before the
      // shots are asked for, so a converted insert may get a moving clip.
      const varied = varyInserts(pinned.storyboard, { style });
      if (varied.changed.length) {
        pinned.storyboard = varied.storyboard;
        pinned.warnings = [...pinned.warnings, `inserts: tooling varied ${varied.changed.join("; ")}`];
      }
      // The talking-head layout rebuilds the sections over the whole video.
      let laidOut = false;
      if (layout) {
        const laid = layout.apply(pinned.storyboard, { words: wordList, beats, duration: fixed.format?.duration });
        if (laid.skipped) pinned.warnings = [...pinned.warnings, `layout: ${laid.skipped}; planned sections kept`];
        else {
          pinned.storyboard = laid.storyboard;
          laidOut = true;
          if (laid.changed.length) pinned.warnings = [...pinned.warnings, `layout: tooling ${laid.changed.join("; ")}`];
        }
      }
      if (assets) {
        const requested = shotRequests(pinned.storyboard).length;
        if (footageBackdrops) pinned.storyboard = cardBackdrops(pinned.storyboard, { words: wordList, brief }).storyboard;
        const found = await resolveShots(pinned.storyboard, { assets, words: wordList, brief, format: fixed.format, project, cache: shotCache });
        const kept = restoreMisses(found.storyboard, found.errors, varied.originals);
        pinned.storyboard = kept.storyboard;
        shots = found.shots;
        shotErrors = kept.errors.map((entry) => `assets: ${entry}`);
        if (kept.restored.length) pinned.warnings = [...pinned.warnings, `inserts: no shot for ${kept.restored.join(", ")}; kept the card${kept.restored.length === 1 ? "" : "s"} as planned, with the placeholder`];
        if (found.warnings?.length) pinned.warnings = [...pinned.warnings, ...found.warnings.map((entry) => `assets: ${entry}`)];
        shotCounts = { requested, answered: found.shots.filter((shot) => shot.slot !== "backdrop").length, shots: found.shots };
        shotMedia = found.media ?? [];
        // A callout or grid label that names what the shot was asked for, on a
        // shot the app's notes say shows something else, is dropped: the shot
        // plays as B-roll under the line instead of contradicting it.
        const fitted = fitShotCallouts(pinned.storyboard, found.shots);
        if (fitted.dropped.length) {
          pinned.storyboard = fitted.storyboard;
          pinned.warnings = [...pinned.warnings, `assets: tooling dropped labels the shots do not show: ${fitted.dropped.join("; ")}`];
        }
      }
      // Notes' usable windows (the supplied media's, and the shots' the app
      // described): a video scene outside them starts in the best one.
      if (media.length || shotMedia.length) {
        const snapped = snapMediaWindows(pinned.storyboard, [...media, ...shotMedia], { times: sceneTimes(pinned.storyboard, wordList, beats), words: wordList });
        pinned.storyboard = snapped.storyboard;
        if (snapped.moved.length) pinned.warnings = [...pinned.warnings, `notes: tooling moved ${snapped.moved.join("; ")}`];
      }
      // The map names the inserts that really cover each hidden range.
      if (constraints && direction) direction = reconcileMap(direction, resolvedOrNull(pinned.storyboard, wordList, beats), constraints, wordList);
      // Line sketches planned as Feynman diagrams become line-diagrams, and
      // labels a scene cannot hold for a read are dropped (src/diagram_fit.js).
      const diagrams = fitDiagrams(pinned.storyboard, { words: wordList, beats });
      if (diagrams.changed.length) {
        pinned.storyboard = diagrams.storyboard;
        pinned.warnings = [...pinned.warnings, ...diagrams.changed.map((entry) => `diagrams: tooling ${entry}`)];
      }
      // One copy of a character at a time: a join between two character scenes that share one is a cut (src/cast_cut_fit.js).
      // An explainer's character scenes sit on track 0 with transitions of their own; a character story's ride their world plates, which the kit already handles.
      const cuts = explainer ? fitCastCuts(pinned.storyboard) : { changed: [] };
      if (cuts.changed.length) {
        pinned.storyboard = cuts.storyboard;
        pinned.warnings = [...pinned.warnings, ...cuts.changed.map((entry) => `cast: tooling made ${entry}`)];
      }
      // A character story: a map action whose character is in the shot without the cue is tooling's to add (src/acting_place.js).
      if (bible && direction) {
        const placed = placeActions(pinned.storyboard, { direction, words: wordList });
        if (placed.changed.length) {
          pinned.storyboard = placed.storyboard;
          pinned.warnings = [...pinned.warnings, ...placed.changed.map((entry) => `acting: tooling ${entry}`)];
        }
      }
      const checkOptions = { words: wordList, beats, tier, style, direction, profile, clipLed, bandErrors: directionSource === "model" || directionSource === "given", constraints, minHold: SHORT_FORM_HOLD, ...(script ? { script } : {}), ...(bible || explainer ? { castGate: true } : {}) };
      checked = checkStoryboard(pinned.storyboard, checkOptions);
      // A scene shorter than its module allows, or an event time just outside
      // its module's window, is tooling's to fix, not a repair call's; a fix
      // can expose the next one, so a few rounds.
      const moved = [];
      const lengthened = [];
      for (let round = 0; round < 3 && !checked.ok; round += 1) {
        const sized = fitDurations(pinned.storyboard, checked.errors, { words: wordList, beats, direction });
        if (sized.changed.length) {
          pinned.storyboard = sized.storyboard;
          direction = sized.direction;
          checkOptions.direction = direction;
          lengthened.push(...sized.changed);
          checked = checkStoryboard(pinned.storyboard, checkOptions);
          if (checked.ok) break;
        }
        const fitted = fitTimings(pinned.storyboard, checked.errors);
        if (!fitted.moved.length && !sized.changed.length) break;
        if (!fitted.moved.length) continue;
        pinned.storyboard = fitted.storyboard;
        moved.push(...fitted.moved);
        checked = checkStoryboard(pinned.storyboard, checkOptions);
      }
      // A card in the caption band while captions show: the captions dip out
      // under it (a caption position the module layout does not plan for, such
      // as the middle of the frame, otherwise fails every attempt).
      // Repeated, as finish does: one round can expose the next clash.
      const banded = settleCaptionBand(pinned.storyboard, checked, (candidate) => checkStoryboard(candidate, checkOptions));
      if (banded.hidden.length) {
        pinned.storyboard = banded.storyboard;
        checked = banded.checked;
        pinned.warnings = [...pinned.warnings, captionBandWarning(banded.hidden)];
      }
      // A shot tooling could not give the short-form hold (no neighbour had
      // time to lend) ships as a warning: a repair call for pace alone costs
      // more than a quick shot does.
      const quick = checked.errors.filter((entry) => entry.startsWith("pace: "));
      if (quick.length) {
        checked.errors = checked.errors.filter((entry) => !entry.startsWith("pace: "));
        checked.ok = checked.errors.length === 0;
        pinned.warnings = [...pinned.warnings, ...quick];
      }
      if (lengthened.length) pinned.warnings = [...pinned.warnings, `timing: tooling fitted scenes to their module's minimum length: ${lengthened.join("; ")}`];
      if (moved.length) pinned.warnings = [...pinned.warnings, `timing: tooling moved ${moved.join("; ")} into the module's window`];
      // The deterministic pass (src/constraints.js fillConstraints): when the
      // constraints are all that is left, or on the last attempt, tooling
      // covers hidden ranges and places must_use media itself.
      if (constraints && !checked.ok && checked.storyboard && (attempt === repairs || checked.errors.every(isConstraintError))) {
        const fill = fillConstraints(pinned.storyboard, constraints, { words: wordList, media, beats });
        if (fill.added.length || fill.changed.length) {
          const map = direction ? reconcileMap(direction, resolvedOrNull(fill.storyboard, wordList, beats), constraints, wordList, { added: fill.added }) : direction;
          const rechecked = checkStoryboard(fill.storyboard, { ...checkOptions, direction: map });
          if (rechecked.ok || rechecked.errors.length < checked.errors.length) {
            pinned.storyboard = fill.storyboard;
            direction = map;
            checked = rechecked;
            pinned.warnings = [...pinned.warnings, ...fill.added.map((entry) => `constraints: tooling added ${entry.id} (${entry.src ?? "a title card"}) over ${entry.start}–${entry.end} s (${entry.reason})`), ...fill.changed.map((entry) => `constraints: tooling ${entry}`)];
          }
        }
        if (fill.errors.length && !checked.ok) checked.errors = [...checked.errors, ...fill.errors.filter((entry) => !checked.errors.includes(entry))];
      }
      // Cards off the presenter's face (src/face_clear_fit.js): after every
      // other fit, so nothing moves a card back; kept only when the checks
      // are no worse for it.
      if (lane === "footage-led" && checked.storyboard) {
        const cleared = clearFace(pinned.storyboard, checked, { words: wordList, beats, track: subjectTrack, checkOptions: { ...checkOptions, direction } });
        pinned.storyboard = cleared.storyboard;
        checked = cleared.checked;
        pinned.warnings = [...pinned.warnings, ...cleared.warnings];
      }
      if (shotErrors.length) { checked.errors = [...shotErrors, ...checked.errors]; checked.ok = false; }
      checked.warnings = [...pinned.warnings, ...checked.warnings];
      checked.candidate = extracted.storyboard;
      // extraCheck(storyboard) → [error strings]: caller rules (for example,
      // `launchclip make` allows only the files in its asset manifest).
      if (typeof extraCheck === "function" && checked.storyboard) {
        const extra = (extraCheck(checked.storyboard) ?? []).map((entry) => `assets: ${entry}`);
        if (extra.length) { checked.errors = [...checked.errors, ...extra]; checked.ok = false; }
      }
      // The opening and the card mix of every short, footage or not (src/short_form_checks.js).
      if (checked.storyboard) {
        const seconds = storyboardSeconds(checked.storyboard, wordList);
        const footage = Boolean(assets) && lane !== "footage-led";
        const opensOnBase = lane === "footage-led" || Boolean(fixed.base);
        const short = [...hookErrors(checked.storyboard, { seconds, base: opensOnBase }), ...hookTimingErrors(checked.storyboard, { seconds, words: wordList, times: sceneTimes(checked.storyboard, wordList, beats), profile, base: opensOnBase }), ...cardErrors(checked.storyboard, { seconds, footage })];
        if (short.length) { checked.errors = [...checked.errors, ...short]; checked.ok = false; }
        // A handed-in file the user clearly meant to feature that no scene shows (src/asset_understanding.js).
        const left = unusedFeatured(checked.storyboard, featured ?? []);
        if (left.length) { checked.errors = [...checked.errors, ...left]; checked.ok = false; }
        // What the finish gates would fail, caught while a repair can still fix it: a card with more words than its time
        // on screen allows (ghosting), an opening that draws itself from an empty plate (structure), a video of only
        // diagrams and text cards (variety); and, for a character-led explainer, characters on screen for most of it.
        const timed = lane === "footage-led" ? null : resolvedOrNull(checked.storyboard, wordList, beats);
        if (timed) {
          const picture = [...planReadingErrors(timed), ...openingErrors(timed), ...abstractErrors(timed), ...(explainer ? characterErrors(timed, { cast: explainer.cast }) : [])];
          if (picture.length) { checked.errors = [...checked.errors, ...picture]; checked.ok = false; }
          if (explainer) checked.character_share = characterShare(timed).share;
        }
        if (laidOut) {
          const resolved = resolvedOrNull(checked.storyboard, wordList, beats);
          const laid = layout.check(resolved ?? checked.storyboard, { seconds });
          checked.warnings = [...checked.warnings, ...laid.warnings, ...(resolved ? layout.faces(resolved) : [])];
          if (laid.errors.length) { checked.errors = [...checked.errors, ...laid.errors]; checked.ok = false; }
        }
      }
      checked.shotCounts = shotCounts;
      // Fewer shot requests than minShots: a repair note, counted against the
      // same budget; a storyboard that fails only this is kept as a fallback.
      if (!checked.ok && checked.storyboard && checked.errors.length && checked.errors.every((entry) => NEAR_MISS.some((prefix) => entry.startsWith(prefix))) && (!paced || checked.errors.length < paced.cadence.length)) {
        paced = { ...checked, ok: true, errors: [], warnings: [...checked.warnings], cadence: [...checked.errors], direction };
      }
      const shortfall = shotCounts ? minShotsError(shotCounts.requested, minShots) : "";
      if (shortfall) {
        // Near misses (a weak hook, a card too many) ride along as warnings.
        const nearOnly = checked.storyboard && checked.errors.every((entry) => NEAR_MISS.some((prefix) => entry.startsWith(prefix)));
        if (nearOnly && (!best || shotCounts.requested > best.shotCounts.requested)) best = { ...checked, ok: true, errors: [], warnings: [...checked.warnings, ...checked.errors], direction };
        checked.errors = [...checked.errors, shortfall];
        checked.ok = false;
      }
    }
    attempts.push({
      attempt,
      kind,
      ok: checked.ok,
      errors: checked.errors,
      warnings: checked.warnings,
      layout: { errors: checked.layout.errors, warnings: checked.layout.warnings },
      modules: checked.storyboard ? moduleIds(checked.storyboard) : [],
      usage,
      cost_usd: cost.estimated_usd,
      cost_warning: cost.warning,
      model: result?.model ?? model,
      response_id: result?.response_id ?? null,
      elapsed_ms: now() - callStarted
    });
    last = checked;
    previous = checked;
    if (checked.ok) break;
  }
  if (!last?.ok && !best && paced) {
    direction = paced.direction;
    const { cadence, ...kept } = paced;
    last = { ...kept, warnings: [...kept.warnings, ...cadence, `${cadence.every((entry) => entry.startsWith("cadence: ")) ? "cadence" : "plan"}: kept the storyboard closest to the profile after ${repairs} repair${repairs === 1 ? "" : "s"}`] };
    delete last.direction;
  }
  if (!last?.ok && best) {
    direction = best.direction;
    last = { ...best, warnings: [...best.warnings, `shots: the storyboard asks for ${best.shotCounts.requested} shot${best.shotCounts.requested === 1 ? "" : "s"}, fewer than the ${minShots} wanted, after ${repairs} repair${repairs === 1 ? "" : "s"}; kept the best storyboard`] };
    delete last.direction;
  }
  if (assets) shots = last?.shotCounts?.shots ?? shots;

  // The model returned no usable map: draft one from the planned storyboard
  // so validation and the gates still have one, and say so.
  if (wantsMap && !direction && last?.ok && last.storyboard) {
    try {
      const resolved = resolveStory(JSON.parse(JSON.stringify(last.storyboard)), { words: wordList, beats });
      direction = pinMap(draftDirectionMap(resolved, wordList, { profile: profile?.id ?? null }));
      if (constraints) direction = reconcileMap(direction, resolved, constraints, wordList);
      directionSource = "drafted";
      last.warnings = [...last.warnings, "direction: the model returned no valid direction map; DIRECTION.json was drafted from the storyboard (check its treatments)"];
    } catch (error) {
      last.warnings = [...last.warnings, `direction: no direction map (${message(error)})`];
    }
  }

  // Long form (RFC §10.2): chapters from the map's sections, an opening
  // promise, section cards and the progress line, placed deterministically
  // on the passing plan; kept only when the structured story passes too.
  let longForm = null;
  if (last?.ok && last.storyboard && (options.longForm ?? isLongForm(last.storyboard, profile)) && options.longForm !== false) {
    try {
      const structured = structureLongForm(last.storyboard, { words: wordList, map: direction, profile, segments: style?.segments });
      const checked = checkStoryboard(structured.story, { words: wordList, beats, tier, style, direction: structured.map, profile, bandErrors: false });
      longForm = { chapters: structured.chapters, added: structured.added, changed: structured.changed, resets: structured.resets, segments: structured.segments, warnings: structured.warnings };
      if (checked.ok) {
        last = { ...checked, warnings: [...last.warnings, ...structured.warnings.map((entry) => `long form: ${entry}`), ...checked.warnings.filter((entry) => !last.warnings.includes(entry))] };
        if (direction) direction = structured.map;
      } else {
        longForm.rejected = checked.errors.slice(0, 12);
        last.warnings = [...last.warnings, `long form: the chapter structure failed the checks and was left out (${checked.errors.slice(0, 3).join("; ")}); run launchclip story long-form after fixing them`];
      }
    } catch (error) {
      last.warnings = [...last.warnings, `long form: ${message(error)}`];
    }
  }

  const allAttempts = [...directionPlan.attempts, ...attempts];
  const totals = allAttempts.reduce((sum, entry) => ({
    input_tokens: sum.input_tokens + entry.usage.input_tokens,
    output_tokens: sum.output_tokens + entry.usage.output_tokens,
    total_tokens: sum.total_tokens + entry.usage.total_tokens
  }), emptyUsage());
  const priced = allAttempts.filter((entry) => entry.cost_usd != null);
  const costWarnings = [...new Set(allAttempts.map((entry) => entry.cost_warning).filter(Boolean))];
  return {
    schema_version: STORYBOARD_PLAN_VERSION,
    status: last?.ok ? "passed" : "failed",
    storyboard: last?.storyboard ?? null,
    tier,
    lane,
    model,
    attempts,
    repairs_used: Math.max(0, attempts.length - 1),
    max_repairs: repairs,
    valid_first_attempt: Boolean(attempts[0]?.ok),
    errors: last?.errors ?? [],
    warnings: [...directionPlan.warnings, ...constraintWarnings, ...shotWarnings, ...(last?.warnings ?? [])],
    layout: last?.layout ?? emptyLayout(),
    direction,
    direction_source: directionSource,
    direction_attempts: directionPlan.attempts,
    // Shots the app's asset provider supplied for the final storyboard.
    ...(assets ? { shots } : {}),
    // How many shots the final storyboard asked for and got, against minShots.
    ...(assets ? { shot_counts: { min: minShots, requested: last?.shotCounts?.requested ?? 0, answered: last?.shotCounts?.answered ?? 0 } } : {}),
    profile: profile?.id ?? null,
    cadence: last?.cadence ?? null,
    // The clip-led rule the plan ran under, and the clip share it reached.
    clip_led: { ...clipLed, share: last?.clip_share ?? null },
    // A character-led explainer: the cast the map chose, what each plays, and the share of the runtime a character is on screen.
    ...(explainer ? { explainer: { cast: explainer.cast, roles: explainer.roles, character_share: last?.character_share ?? null, ...(explainer.dropped?.length ? { dropped: explainer.dropped } : {}) } } : {}),
    long_form: longForm,
    usage: totals,
    cost: {
      estimated_usd: Math.round(priced.reduce((sum, entry) => sum + entry.cost_usd, 0) * 1e8) / 1e8,
      complete: priced.length === allAttempts.length && attempts.length > 0,
      warnings: costWarnings
    },
    elapsed_ms: now() - started,
    phrase_hints: hints
  };
}

// ---------------------------------------------------------------------------
// Checks

// fitFaceClear in the planner: cards moved (or, as a last resort, dropped)
// off the face, the captions dipped under any card moved over their band,
// and the result kept only when the checks are no worse for it; else the
// moves alone; else nothing. → {storyboard, checked, warnings}
function clearFace(storyboard, checked, { words, beats, track, checkOptions }) {
  const warnings = [];
  let kept = [];
  for (const drop of [true, false]) {
    const cleared = fitFaceClear(storyboard, { words, beats, track, drop });
    kept = cleared.kept;
    if (!cleared.moved.length && !cleared.dropped.length) break;
    let candidate = cleared.storyboard;
    let rechecked = checkStoryboard(candidate, checkOptions);
    const banded = settleCaptionBand(candidate, rechecked, (story) => checkStoryboard(story, checkOptions));
    candidate = banded.storyboard;
    rechecked = banded.checked;
    const hidden = banded.hidden;
    if (rechecked.errors.length > checked.errors.length) {
      if (!drop) warnings.push(`face: tooling could not move ${cleared.moved.map((entry) => entry.split(" ")[0]).join(", ")} off the presenter's face without breaking other checks`);
      continue;
    }
    if (cleared.moved.length) warnings.push(`face: tooling ${cleared.moved.join("; ")}`);
    if (cleared.dropped.length) warnings.push(...cleared.dropped.map((entry) => `face: tooling ${entry}`));
    if (hidden.length) warnings.push(captionBandWarning(hidden));
    return { storyboard: candidate, checked: rechecked, warnings: [...warnings, ...kept.map((entry) => `face: ${entry}`)] };
  }
  return { storyboard, checked, warnings: [...warnings, ...kept.map((entry) => `face: ${entry}`)] };
}

/**
 * Check one storyboard the way the planner does. Returns
 * {ok, errors, warnings, storyboard, layout:
 * {errors, warnings, findings}}. Error strings are prefixed by stage:
 * "validation:", "tier:", "anchors:", "params:", "layout:".
 */
export function checkStoryboard(raw, { words = [], beats = null, tier = "structured", style = null, direction = null, profile = null, bandErrors = true, clipLed = null, constraints = null, minHold = 0, script = null, castGate: gated = false } = {}) {
  const errors = [];
  const warnings = [];
  const layout = emptyLayout();
  // The checks see the story as every renderer will: with the style merged.
  const input = style && raw && typeof raw === "object" && !Array.isArray(raw) && raw.style ? applyStyle(raw, style).story : raw;
  const validation = validateStory(input, { modules: knownModules(), moduleParams: validateModuleParams });
  errors.push(...validation.errors.map((entry) => `validation: ${entry}`));
  warnings.push(...validation.warnings);
  errors.push(...tierErrors(input, tier, { style }).map((entry) => `tier: ${entry}`));
  if (errors.length) return { ok: false, errors, warnings, storyboard: input, layout };

  const storyboard = JSON.parse(JSON.stringify(input));
  let resolved;
  try {
    resolved = resolveStory(storyboard, { words, beats });
  } catch (error) {
    errors.push(`anchors: ${message(error)}`);
    return { ok: false, errors, warnings, storyboard, layout };
  }
  const second = validateStory(resolved, { modules: knownModules(), moduleParams: validateModuleParams });
  errors.push(...second.errors.filter((entry) => !validation.errors.includes(entry)).map((entry) => `validation: ${entry} (after resolving anchors)`));
  if (second.ok) warnings.push(...subjectDensityWarnings(resolved, { profile }));
  // The direction map against this storyboard, and the measures it gives
  // against the cadence profile (RFC §6.2).
  let cadence = null;
  if (second.ok && direction) {
    // Cast cues are checked against the story's cast, as finish's cast gate
    // does; a repair can fix either side (the map's cues or story.cast).
    const map = validateDirection(direction, { words, story: resolved, cast: resolved.cast ?? direction.cast ?? null, validateCast: validateCastCues, ...(Array.isArray(style?.segments) ? { segments: style.segments } : {}), ...(script ? { script } : {}) });
    errors.push(...map.errors.map((entry) => `direction: ${entry}`));
    warnings.push(...map.warnings.map((entry) => `direction: ${entry}`));
    if (map.ok && profile && words.length) {
      const measures = directionMeasures(direction, resolved, { words });
      const bands = compareMeasures(measures, profile);
      cadence = { profile: profile.id, coverage: measures.coverage, face_time: measures.face_time, longest_undressed_seconds: measures.longest_undressed_seconds, bands: bands.filter((band) => band.status !== "inside") };
      for (const band of bands) {
        if (band.status === "inside") continue;
        const line = `cadence: ${band.detail} (profile ${profile.id}); ${bandRepair(band)}`;
        // The app's hidden ranges force coverage up; that is not the plan's to fix.
        const forced = band.measure === "coverage" && band.status === "above" && (constraints?.ranges ?? []).some((range) => range.picture === "hidden");
        // Too much face is the plan's to fix (cut away); too little may be forced by the footage.
        const planned = PLAN_BAND_ERRORS.includes(band.measure) || (band.measure === "face_time" && band.status === "above");
        if (bandErrors && planned && !forced) errors.push(line);
        else warnings.push(line);
      }
    }
  }
  // castGate: the cast gate finish runs (src/cast.js), here so a repair can
  // fix what it finds: a limb off the canvas, a character who changes sides.
  // On for a story pinned to a show bible, whose every shot is a cast shot.
  if (second.ok && gated) {
    const gate = castGate(resolved, { direction });
    if (gate.status === "failed") errors.push(...[...new Set(gate.findings.map((finding) => `cast: ${finding.detail}`))].filter((entry) => !errors.some((error) => error.endsWith(entry.slice(6)))).slice(0, 8));
  }
  // The acting and lip-sync gates finish runs, here for the same reason: a
  // line's action that nobody on screen performs (the character is in another
  // shot, or its cue was dropped), and a mouth that stays shut on its words.
  if (second.ok && gated) {
    const acting = direction ? actingGate(resolved, { map: direction, words }) : null;
    errors.push(...(acting?.findings ?? []).filter((finding) => finding.rule === "action-missing").map((finding) => `acting: ${finding.detail}`).slice(0, 6));
    const lips = lipSyncGate({ resolved, words });
    if (lips.status === "failed") errors.push(...lips.errors.slice(0, 6).map((entry) => `lip-sync: ${entry}`));
  }
  // The app's constraints (src/constraints.js): hidden ranges covered,
  // must_use present, never_use absent; errors are prefixed "constraints:".
  if (second.ok && hasConstraints(constraints)) {
    const found = checkConstraints(resolved, constraints, { map: direction, words, story: storyboard });
    errors.push(...found.errors);
    warnings.push(...found.warnings);
  }

  // Clip-led plans (kit/core/clip-led.mjs): the share of the runtime the footage carries.
  let clipShareValue = null;
  if (second.ok && clipLed && clipLed.mode !== "graphics") {
    const clips = clipLedFindings(clipLed, resolved);
    clipShareValue = clips.share;
    errors.push(...clips.errors.map((entry) => `clips: ${entry}`));
    warnings.push(...clips.warnings.map((entry) => `clips: ${entry}`));
  }

  const models = new Map();
  for (const scene of resolved.scenes) {
    if (scene.module === "custom") { warnings.push(`${scene.id} is a custom module; its params and layout are not checked here`); continue; }
    try { models.set(scene.id, resolveModule(scene, resolved, { end: sceneRenderEnd(resolved, scene) })); }
    catch (error) { errors.push(`params: ${message(error)}`); }
  }
  // The layout check needs every module resolved, and nothing else: a plan
  // outside a cadence band (or short of footage, or with a cast finding) is
  // still laid out, so its layout errors reach the fits and the repair in
  // the same attempt instead of surfacing after the plan was kept.
  if (errors.some((entry) => entry.startsWith("params: ") || entry.startsWith("validation: "))) return { ok: false, errors, warnings, storyboard, layout, cadence, clip_share: clipShareValue };

  const canvas = { width: resolved.format.width, height: resolved.format.height };
  try {
    const elements = elementsFromStory(resolved, {
      moduleLayout: (scene) => {
        const model = models.get(scene.id);
        if (!model?.layout?.rect) return [];
        const hidesCaptions = model.hidesCaptions === true || model.layout.hidesCaptions === true;
        const extras = layoutExtras(model.layout, { id: scene.id, start: Number(scene.start), end: Number(scene.end), canvas, hidesCaptions });
        return [...elementsFromEditorialLayout(model.layout, {
          id: scene.id,
          role: model.layout.role ?? (scene.module === "media-window" ? "media" : "text"),
          start: Number(scene.start),
          end: Number(scene.end),
          canvas,
          ...(model.layout.minTextPx !== undefined ? { minTextPx: model.layout.minTextPx } : {}),
          ...(extras.allowOcclusion ? { allowOcclusion: extras.allowOcclusion } : {}),
          hidesCaptions
        }), ...extras.parts];
      },
      // The band the captions really take: at their position, grown to the tallest line their preset and size draw (as finish checks it).
      captionBand: captionBandFor(resolved, canvas),
      captionZones: resolved.base ? captionZones(resolved) : castCaptionZones(resolved)
    });
    const report = checkLayout({ canvas, elements, duration: Number(resolved.resolved?.duration) || undefined });
    layout.findings = report.findings;
    layout.errors = report.findings.filter((finding) => finding.severity === "error").length;
    layout.warnings = report.findings.filter((finding) => finding.severity !== "error").length;
    for (const finding of report.findings) {
      const line = `${finding.rule} @${finding.at}s [${finding.ids.join(", ")}] ${finding.detail}`;
      if (finding.severity === "error") errors.push(`layout: ${line}`);
      else warnings.push(`layout: ${line}`);
    }
  } catch (error) {
    errors.push(`layout: ${message(error)}`);
  }
  errors.push(...placeholderErrors(storyboard));
  // minHold: a short video's shots hold at least this long (src/duration_fit.js paceErrors).
  if (minHold > 0) errors.push(...paceErrors(resolved, { hold: minHold }));
  return { ok: errors.length === 0, errors, warnings, storyboard, layout, cadence, clip_share: clipShareValue };
}

// Errors a storyboard may still ship with when the repairs run out.
// A storyboard that fails only these still ships when the repairs run out: a
// weak hook or one card too many beats no video.
const NEAR_MISS = ["cadence: ", "placeholder: ", "hook: ", "cards: ", "featured: ", "reading: ", "opening: ", "variety: ", "characters: "];

/** Cards that hold more words than their time on screen allows (src/direction_guardrails.js readingFindings), as repair notes. */
export function planReadingErrors(resolved) {
  let found = [];
  try { found = readingFindings(resolved); } catch { found = []; }
  return found.map((entry) => entry.fits < 1
    ? `reading: ${entry.id} (${entry.module}) is fully on screen for ${entry.hold} s, and a card needs at least ${entry.need} s to be read; lengthen the scene, or drop it and give its ${entry.words} word${entry.words === 1 ? "" : "s"} to the scene before or after it`
    : `reading: ${entry.id} (${entry.module}) shows ${entry.words} words but is fully on screen for ${entry.hold} s, which is time to read ${entry.fits}; cut its copy to ${entry.fits} word${entry.fits === 1 ? "" : "s"} or fewer (title, body, labels and steps together), or split it into two scenes`);
}

// A card's text that only holds its place: dashes, question marks, an
// ellipsis, "TBD". A model with nothing to say fills a list or a table with
// these, and the card ships empty.
const PLACEHOLDER_TEXT = /^\s*(?:[-–—?…·.*_]+|tbd|tbc|n\/?a|xx+)\s*$/i;

/**
 * Scenes whose text is mostly placeholders (at least two, and 40% of the
 * text fields; a table's empty cells count): one error each, prefixed
 * "placeholder:". A single dash for "no" in a full table stays.
 */
export function placeholderErrors(storyboard) {
  const errors = [];
  const scenes = Array.isArray(storyboard?.scenes) ? storyboard.scenes : [];
  scenes.forEach((scene, index) => {
    if (!scene?.params || typeof scene.params !== "object") return;
    let texts = 0, empty = 0;
    const walk = (value, inArray) => {
      if (typeof value === "string") { texts += 1; if (PLACEHOLDER_TEXT.test(value)) empty += 1; }
      else if (value === null && inArray) { texts += 1; empty += 1; }
      else if (Array.isArray(value)) value.forEach((item) => walk(item, true));
      else if (value && typeof value === "object") Object.values(value).forEach((item) => walk(item, false));
    };
    walk(scene.params, false);
    if (empty >= 2 && empty / texts >= 0.4) {
      errors.push(`placeholder: scenes[${index}]${scene.id ? ` (${scene.id})` : ""} (${scene.module}): ${empty} of ${texts} text fields are placeholders ("—", "?", empty cells); write the real words from the script, or use a module that needs fewer`);
    }
  });
  return errors;
}

/**
 * The density dial a plan runs under: the planner's density option, else the
 * style pack's dials.density; null when neither sets one (the clip-led rule
 * then stays off). → {density, densitySource}
 */
export function densityDial(density, style = null) {
  if (density !== undefined && density !== null && density !== "") {
    const value = Number(density);
    if (!(Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error(`density must be a number from 0 to 1; got ${density}`);
    return { density: value, densitySource: "density option" };
  }
  const own = style?.dials?.density;
  if (typeof own === "number" && Number.isFinite(own)) return { density: own, densitySource: `style ${style.name ?? "pack"} dials` };
  return { density: null, densitySource: null };
}

/**
 * Tier rules (RFC §7) as error strings. A tuning param that holds the style
 * pack's own value for the module is tooling's (applyStyle fills it in), so
 * the model is never asked to remove what it did not write.
 */
export function tierErrors(story, tier, { style = null } = {}) {
  const errors = [];
  if (tier === "bespoke") return errors;
  const scenes = Array.isArray(story?.scenes) ? story.scenes : [];
  scenes.forEach((scene, index) => {
    const where = `scenes[${index}]${scene?.id ? ` (${scene.id})` : ""}`;
    if (scene?.module === "custom") errors.push(`${where} uses "custom", which only the bespoke tier may use; pick the nearest catalogue module`);
    if (tier !== "structured") return;
    const params = scene?.params && typeof scene.params === "object" ? scene.params : {};
    const styled = style?.modules?.params?.[scene?.module] ?? {};
    for (const key of TUNING_PARAMS) if (key in params && !sameValue(params[key], styled[key])) errors.push(`${where}.params.${key} is not allowed in the structured tier; remove it (tooling places and styles modules)`);
    if (scene?.track !== undefined && scene.track !== 0) errors.push(`${where}.track is not allowed in the structured tier; remove it`);
  });
  return errors;
}

function sameValue(a, b) {
  return b !== undefined && JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// Inputs and prompts

/** A style pack's brand over the default brand (roles the pack omits keep the default). */
export function styleBrand(pack) {
  return {
    colors: { ...DEFAULT_BRAND.colors, ...(pack?.brand?.colors ?? {}) },
    fonts: { ...DEFAULT_BRAND.fonts, ...(pack?.brand?.fonts ?? {}) }
  };
}

/** The tooling-owned fields: the model never chooses them (RFC §3). */
export function fixedInputs({ lane, format, brand = DEFAULT_BRAND, audio = null, base = null }) {
  const fixed = {
    lane,
    format: { fps: 30, ...format },
    brand: brand ?? DEFAULT_BRAND,
    audio: {},
    base: null
  };
  if (audio && typeof audio === "object") {
    for (const key of ["voice", "words", "mix"]) if (audio[key] != null) fixed.audio[key] = audio[key];
  }
  if (lane === "footage-led") {
    if (!nonEmpty(base)) throw new Error("the footage-led lane needs a base recording path (assets/…)");
    fixed.base = base;
  }
  return fixed;
}

export function pinInputs(story, fixed) {
  const warnings = [];
  if (!story || typeof story !== "object" || Array.isArray(story)) return { storyboard: story, warnings };
  const copy = JSON.parse(JSON.stringify(story));
  for (const key of ["lane", "format", "brand"]) {
    if (copy[key] !== undefined && JSON.stringify(copy[key]) !== JSON.stringify(fixed[key])) warnings.push(`${key} was changed by the model and has been reset to the fixed input`);
    copy[key] = JSON.parse(JSON.stringify(fixed[key]));
  }
  if (Object.keys(fixed.audio).length) copy.audio = { ...(copy.audio && typeof copy.audio === "object" ? copy.audio : {}), ...fixed.audio };
  if (fixed.lane === "footage-led") copy.base = fixed.base;
  else if (copy.base !== undefined && copy.base !== null) { warnings.push("base is only for the footage-led lane and has been removed"); copy.base = null; }
  if (copy.schema === undefined) copy.schema = "launchclip.story.v1";
  if (fixed.cast) {
    if (copy.cast !== undefined && JSON.stringify(copy.cast) !== JSON.stringify(fixed.cast)) warnings.push(fixed.bible ? "cast was changed by the model and has been reset to the show bible's cast: a plan cannot change who is in the story" : "cast was changed by the model and has been reset to the story's bound cast");
    copy.cast = JSON.parse(JSON.stringify(fixed.cast));
  }
  // The show bible the story is pinned to (kit/core/bible.mjs withBible).
  if (fixed.bible) copy.bible = { ...fixed.bible };
  // Its world too: the place and the time are the bible's; props and detail stay the plan's.
  if (fixed.world) copy.world = { ...(copy.world && typeof copy.world === "object" && !Array.isArray(copy.world) ? copy.world : {}), ...fixed.world };
  if (fixed.style) {
    if (copy.style !== undefined && (typeof copy.style === "string" ? copy.style : copy.style?.name) !== fixed.style) warnings.push("style was changed by the model and has been reset to the fixed input");
    copy.style = typeof copy.style === "object" && copy.style?.name === fixed.style ? copy.style : fixed.style;
  }
  return { storyboard: copy, warnings };
}

/**
 * The planner's first call: DIRECTION.json from the brief and the narration
 * lines, with at most DIRECTION_MAX_REPAIRS repairs. Scene names are checked
 * for shape only; the storyboard pass checks them against real scenes.
 * → {map | null, attempts, warnings, cast?, bound?}: cast is the story cast
 * the map's cues name (a style default cast with the story's names bound).
 */
export async function planDirection({ client, model = null, brief, fixed, profile = null, words, subject = null, segments = null, now = () => Date.now(), constraints = null, cast = null, script = null, explainer = false }) {
  // cast: plannedCast() (src/cast_fit.js), the cast the story will have, or
  // null when the storyboard defines it (its cues are then checked there).
  // explainer: the map casts the characters that carry the video (kit/core/explainer.mjs); → casting.
  const instructions = directionPrompt({ lane: fixed.lane, format: fixed.format, profile, words, subject, segments, cast: cast ? { characters: cast.cast.characters, bindable: cast.bindable } : null, explainer });
  const rules = constraints ? constraintsPrompt(constraints, { words }) : "";
  const base = ["Write the direction map for this brief.", "", "## Brief", "", String(brief).trim(), "", `lane: ${fixed.lane}`, `profile: ${profile?.id ?? "(none)"}`, "", ...(rules ? [rules] : [])].join("\n");
  const attempts = [];
  const warnings = [];
  let previous = null;
  for (let attempt = 0; attempt <= DIRECTION_MAX_REPAIRS; attempt += 1) {
    const kind = attempt === 0 ? "direction" : "direction-repair";
    const input = attempt === 0 ? base : [base, `## Repair ${attempt} of ${DIRECTION_MAX_REPAIRS}`, "", "Your previous direction map failed these checks:", "", ...previous.errors.map((entry) => `- ${entry}`), "", "Previous map:", "", previous.text ?? "(no parseable JSON object was returned)", "", "Return the complete corrected direction map as one JSON object.", ""].join("\n");
    const started = now();
    let result;
    try {
      result = await client.runStructured({ instructions, input, schema: DIRECTION_ENVELOPE_SCHEMA, schemaName: "launchclip_direction", model: bareModelId(model) ?? undefined, temperature: 0, maxOutputTokens: 8_000 });
    } catch (error) {
      attempts.push({ attempt, kind, ok: false, errors: [`model: ${message(error)}`], warnings: [], layout: { errors: 0, warnings: 0 }, usage: emptyUsage(), cost_usd: 0, model, elapsed_ms: now() - started });
      warnings.push(`direction: the direction call failed (${message(error)})`);
      break;
    }
    const usage = normalizeUsage(result?.usage);
    const cost = estimateModelUsageCost(providerOf(client, model), result?.model ?? model, usage);
    const extracted = extractDirection(result);
    let errors = extracted.ok ? [] : [`json: ${extracted.error}`];
    let fit = null;
    let casting = null;
    if (extracted.ok) {
      // The explainer's cast: what the map chose, as a story cast (a character the kit cannot draw is dropped; none at all takes the default pair).
      if (explainer) {
        casting = castFromDirection(extracted.map) ?? { ...defaultExplainerCast(), dropped: ["the map cast no character the kit can draw; the default pair is used"] };
        extracted.map.cast = casting.cast;
        cast = { cast: casting.cast, source: "story", bindable: false };
      }
      // Tooling first (src/cast_fit.js): free-text poses, expressions and
      // sets take the kit's nearest values, and a style default cast takes
      // the story's names; what is left goes back to the model.
      fit = fitDirectionCast(extracted.map, { cast, words });
      extracted.map = fit.map;
      const map = extracted.map;
      if (profile && !map.profile) map.profile = profile.id;
      const check = validateDirection(map, { words, lane: fixed.lane, deferScenes: true, ...(cast ? { cast: fit.cast, validateCast: validateCastCues } : {}), ...(Array.isArray(segments) ? { segments } : {}), ...(script ? { script } : {}) });
      errors = check.errors;
    }
    attempts.push({ attempt, kind, ok: errors.length === 0, errors, warnings: fit?.warnings ?? [], layout: { errors: 0, warnings: 0 }, usage, cost_usd: cost.estimated_usd, cost_warning: cost.warning, model: result?.model ?? model, response_id: result?.response_id ?? null, elapsed_ms: now() - started });
    if (!errors.length) return { map: extracted.map, attempts, warnings: [...warnings, ...fit.warnings, ...(casting?.dropped ?? []).map((entry) => `cast: ${entry}`)], cast: fit.cast, bound: fit.bound, ...(casting ? { casting } : {}) };
    previous = { errors, text: extracted.ok ? JSON.stringify(extracted.map) : extracted.text ?? null };
  }
  return { map: null, attempts, warnings };
}

/**
 * Pull a direction map out of a client result: {direction_json: "<json>"},
 * a map object, or raw text. → {ok: true, map} | {ok: false, error, text}
 */
export function extractDirection(result) {
  const value = result?.value;
  const isMap = (candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate) && Array.isArray(candidate.sections);
  const fromText = (text) => {
    if (typeof text !== "string" || !text.trim()) return { ok: false, error: "the model returned no direction map", text: null };
    const parsed = parseText(text);
    if (!parsed.ok) return { ok: false, error: parsed.error, text: parsed.text };
    const candidate = parsed.storyboard;
    if (isMap(candidate)) return { ok: true, map: candidate };
    if (typeof candidate?.direction_json === "string") return fromText(candidate.direction_json);
    if (isMap(candidate?.direction_json)) return { ok: true, map: candidate.direction_json };
    return { ok: false, error: "the JSON object is not a direction map (no sections)", text: JSON.stringify(candidate).slice(0, 40_000) };
  };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (typeof value.direction_json === "string") return fromText(value.direction_json);
    if (isMap(value.direction_json)) return { ok: true, map: value.direction_json };
    if (isMap(value)) return { ok: true, map: value };
    return { ok: false, error: "the model returned no direction map", text: JSON.stringify(value).slice(0, 40_000) };
  }
  if (typeof value === "string") return fromText(value);
  return fromText(result?.text);
}

/**
 * The planner's section for a frozen show bible: who is in the story and
 * where each of them stands. The cast is fixed; the model casts scenes from it.
 */
export function biblePrompt(bible) {
  const cast = bibleCast(bible);
  const members = (cast?.characters ?? []).map((entry) => `"${entry.id}"${entry.name ? ` (${entry.name})` : ""}${entry.position ? `, ${entry.position}` : ""}`);
  const sets = Array.isArray(bible.world?.sets) && bible.world.sets.length ? ` Sets the story may use: ${bible.world.sets.join(", ")}.` : "";
  return [
    "## Show bible (frozen)",
    "",
    `story.cast is fixed by the show bible and tooling writes it: ${members.join("; ")}, drawn ${cast.style}. Name characters in cast-scene and character-cameo by these ids only. Never add, drop, rename or restyle a character, and never write a look into a scene: a scene names who is in it, their pose, expression and cues.${sets}${bible.world?.kind ? ` story.world is the bible's too: ${bible.world.kind}${bible.world.time ? `, ${bible.world.time}` : ""}.` : ""}`
  ].join("\n");
}

function planRequest({ brief, fixed, hints, direction = null, history = null }) {
  const lines = [
    "Write the storyboard for this brief.",
    "",
    "## Brief",
    "",
    String(brief).trim(),
    "",
    "## Fixed inputs (copy exactly)",
    "",
    `lane: ${fixed.lane}`,
    `format: ${JSON.stringify(fixed.format)}`,
    `brand: ${JSON.stringify(fixed.brand)}`
  ];
  if (fixed.style) lines.push(`style: ${JSON.stringify(fixed.style)}`);
  if (fixed.bible) lines.push(`bible: ${JSON.stringify(fixed.bible)}`, `cast: ${JSON.stringify({ style: fixed.cast.style, characters: fixed.cast.characters.map((entry) => entry.id) })} (the show bible's; tooling writes the full cast, so you may leave story.cast out)`);
  if (Object.keys(fixed.audio).length) lines.push(`audio: ${JSON.stringify(fixed.audio)} (add music and sfx as you see fit)`);
  if (fixed.base) lines.push(`base: ${JSON.stringify(fixed.base)}`);
  if (direction) lines.push("", "## Direction map", "", "Plan the storyboard against DIRECTION.json (in the instructions): every scene a line names, on that line's words.");
  if (nonEmpty(history)) lines.push("", "## Recent videos (do not repeat)", "", String(history).trim());
  if (hints.length) {
    lines.push("", "## Phrase hints (from the phrase → module table)", "");
    for (const hint of hints.slice(0, 24)) lines.push(`- "${hint.sentence.slice(0, 160)}" → ${hint.modules.join(", ")}`);
  }
  return `${lines.join("\n")}\n`;
}

// The shots the app found for the previous storyboard, with what it says they
// show, so a repair places and trims them knowing (only when the app sent notes).
function shotNotesSection(shots) {
  const described = shots.filter((shot) => shot.notes);
  if (!described.length) return [];
  return [
    "",
    "Shots the app found for your previous storyboard, with the app's notes on what each shows. Keep a shot only on a line it fits; ask again with a different \"shows\" where it does not. A video starts at params.media.sourceStart: keep it inside a usable window and the scene no longer than that window.",
    "",
    ...described.map((shot) => `- scene ${shot.scene_id} (${shot.kind}${shot.duration ? `, ${Math.round(shot.duration * 10) / 10} s` : ""}) for "${shot.shows}":${mediaNotesLine({ notes: shot.notes })}`)
  ];
}

function repairRequest({ request, previous, errors, attempt, repairs, direction = null, shots = [] }) {
  const prior = previous == null ? "(no parseable JSON object was returned)" : typeof previous === "string" ? previous.slice(0, 40_000) : JSON.stringify(previous);
  return [
    request.trimEnd(),
    "",
    `## Repair ${attempt} of ${repairs}`,
    "",
    "Your previous storyboard failed these checks:",
    "",
    ...errors.map((entry) => `- ${entry}`),
    "",
    "Previous storyboard:",
    "",
    prior,
    ...shotNotesSection(shots),
    "",
    "A params error names the first offending item a module found (rows[1], steps[0], left.label…); the same rule applies to every sibling item, so fix all of them in that scene, not only the one named.",
    "",
    "Return the complete corrected storyboard as one JSON object. Fix only the scenes and params the errors name (shorten copy, change a param, retime or swap a scene's module); keep everything else. Keep lane, format, brand, audio and base exactly as given. The checks and their thresholds are fixed and cannot be relaxed.",
    ...(direction ? ["", "Errors prefixed direction: or cadence: are about the direction map and the profile band. Fix them in the storyboard (add or move the scenes a line names), in the map (a line's treatment, scenes or why), or both. Return {storyboard_json, direction_json}; direction_json is the complete corrected map, or an empty string to keep it.", "", "Current direction map:", "", JSON.stringify(direction)] : []),
    ""
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Model output

/**
 * Pull the storyboard object out of a client result: the strict envelope
 * ({storyboard_json: "<json>"}), a storyboard object returned directly, or
 * raw text (fenced or with prose around one JSON object).
 * → {ok: true, storyboard} | {ok: false, error, text}
 */
export function extractStoryboard(result) {
  const value = result?.value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (typeof value.storyboard_json === "string") return parseText(value.storyboard_json);
    if (value.storyboard_json && typeof value.storyboard_json === "object") return { ok: true, storyboard: value.storyboard_json };
    if (value.storyboard && typeof value.storyboard === "object") return { ok: true, storyboard: value.storyboard };
    if ("scenes" in value || "schema" in value) return { ok: true, storyboard: value };
  }
  if (typeof value === "string") return parseText(value);
  if (typeof result?.text === "string") return parseText(result.text);
  if (typeof result === "string") return parseText(result);
  return { ok: false, error: "the model returned no storyboard JSON", text: null };
}

function parseText(text) {
  const trimmed = String(text ?? "").trim();
  const candidates = [];
  const fence = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i);
  if (fence) candidates.push(fence[1]);
  candidates.push(trimmed);
  const object = firstJsonObject(trimmed);
  if (object) candidates.push(object);
  let lastError = "no JSON object found";
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        if (typeof parsed.storyboard_json === "string") return parseText(parsed.storyboard_json);
        return { ok: true, storyboard: parsed.storyboard && typeof parsed.storyboard === "object" && !parsed.scenes ? parsed.storyboard : parsed };
      }
      lastError = "the JSON value is not an object";
    } catch (error) {
      lastError = error.message;
    }
  }
  return { ok: false, error: `could not parse a storyboard JSON object (${lastError})`, text: trimmed.slice(0, 40_000) };
}

// The first balanced {...} span, honouring strings.
function firstJsonObject(text) {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Clients

/**
 * "provider:model[@reasoning]" → a client with runStructured(). anthropic:<id>
 * uses @anthropic-ai/sdk (ANTHROPIC_API_KEY; request.images go as image content blocks); openai, openrouter, ollama and
 * compatible use src/model_provider.js (OPENAI_API_KEY, OPENROUTER_API_KEY, …).
 */
export function createPlannerClient(modelSpec, options = {}) {
  const spec = String(modelSpec ?? "").trim();
  if (!spec) throw new Error("No planner model: pass --model provider:model (for example anthropic:<model-id> or openrouter:<vendor>/<model>) or set LAUNCHCLIP_PLANNER_MODEL");
  const separator = spec.indexOf(":");
  const provider = separator > 0 ? spec.slice(0, separator).toLowerCase() : "";
  if (provider === "anthropic") {
    const model = spec.slice(separator + 1);
    return { client: new AnthropicPlannerClient({ model, apiKey: options.apiKey, sdk: options.sdk }), provider, model };
  }
  const route = parseModelRoute(spec);
  return { client: (options.createClient ?? createStructuredClient)(route, options), provider: route.provider, model: route.model, reasoning: route.reasoning };
}

// Requests asking for more output tokens than this are streamed.
export const ANTHROPIC_STREAM_ABOVE = 16_000;
const ANTHROPIC_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/**
 * make's images ([{url: a data: URL or an https URL, detail?}]) → Anthropic
 * image content blocks. A data URL becomes a base64 source, an https URL a
 * url source; anything else (or a type the API does not take) throws, so a
 * critic never reviews fewer sheets than it lists.
 */
export function anthropicImageBlocks(images) {
  return (Array.isArray(images) ? images : []).map((image, index) => {
    const url = String(image?.url ?? "");
    const data = /^data:([^;,]+);base64,(.+)$/s.exec(url);
    if (data) {
      if (!ANTHROPIC_IMAGE_TYPES.has(data[1])) throw new Error(`image ${index + 1} is ${data[1]}; the Anthropic API takes JPEG, PNG, GIF or WebP`);
      return { type: "image", source: { type: "base64", media_type: data[1], data: data[2].replace(/\s+/g, "") } };
    }
    if (/^https:\/\//i.test(url)) return { type: "image", source: { type: "url", url } };
    throw new Error(`image ${index + 1} is neither a base64 data URL nor an https URL`);
  });
}

export class AnthropicPlannerClient {
  // The Messages API takes images, so the headless critic can run on this client.
  supportsImages = true;

  constructor({ model, apiKey, sdk } = {}) {
    if (!nonEmpty(model)) throw new Error("anthropic planner needs a model id");
    this.provider = "anthropic";
    this.supportsImages = true;
    this.model = model;
    this.apiKey = apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!this.apiKey && !sdk) throw new Error("ANTHROPIC_API_KEY is not set");
    this.sdk = sdk ?? null;
  }

  async runStructured(options = {}) {
    if (!this.sdk) {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      this.sdk = new Anthropic({ apiKey: this.apiKey });
    }
    const text_ = typeof options.input === "string" ? options.input : JSON.stringify(options.input ?? {});
    // Images (the headless critic's contact sheets) go first, as image content blocks; the text follows them (anthropicContent).
    const request = {
      model: options.model ?? this.model,
      max_tokens: Number(options.maxOutputTokens ?? 16_000),
      system: String(options.instructions ?? ""),
      messages: [{ role: "user", content: anthropicContent(text_, options.images) }]
    };
    // A large max_tokens is streamed: the SDK refuses a non-streaming request that could run past its timeout.
    const message = request.max_tokens > ANTHROPIC_STREAM_ABOVE ? await this.sdk.messages.stream(request).finalMessage() : await this.sdk.messages.create(request);
    const text = (message?.content ?? []).filter((block) => block?.type === "text").map((block) => block.text).join("");
    const usage = message?.usage ?? {};
    return {
      response_id: message?.id ?? null,
      model: message?.model ?? this.model,
      status: "completed",
      text,
      value: null,
      usage: {
        input_tokens: Number(usage.input_tokens ?? 0),
        output_tokens: Number(usage.output_tokens ?? 0),
        total_tokens: Number(usage.input_tokens ?? 0) + Number(usage.output_tokens ?? 0),
        cached_tokens: Number(usage.cache_read_input_tokens ?? 0)
      }
    };
  }
}

/**
 * The user turn for the Messages API. Text alone stays a string. With images
 * it is the image blocks first (anthropicImageBlocks), then the text, as the
 * API reference recommends. `detail` is an OpenAI field and is not sent.
 */
export function anthropicContent(input, images = []) {
  const text = typeof input === "string" ? input : JSON.stringify(input ?? {});
  const blocks = anthropicImageBlocks(images);
  return blocks.length ? [...blocks, { type: "text", text }] : text;
}

// ---------------------------------------------------------------------------
// Helpers

/**
 * "openai:gpt-5.6-luna@medium" → "gpt-5.6-luna": the id a client sends to its
 * API. The provider prefix and reasoning suffix belong to the route, not the
 * request body. A bare id is returned unchanged; null stays null.
 */
export function bareModelId(spec) {
  if (spec == null) return null;
  let value = String(spec).trim();
  if (!value) return null;
  const at = value.lastIndexOf("@");
  if (at > 0 && /^(none|low|medium|high|xhigh|max)$/i.test(value.slice(at + 1))) value = value.slice(0, at);
  const separator = value.indexOf(":");
  if (separator > 0 && /^(openai|anthropic|openrouter|ollama|local|compatible|openai-compatible)$/i.test(value.slice(0, separator))) value = value.slice(separator + 1);
  return value;
}

function providerOf(client, model) {
  if (client?.provider) return client.provider;
  const spec = String(model ?? "");
  return spec.includes(":") ? spec.split(":")[0] : "unknown";
}

// Errors the deterministic constraints pass can fix: the constraints'
// own, and a map line naming an insert the fill gives (hidden-<n>).
function isConstraintError(entry) {
  return /^constraints: /.test(entry) || /^direction: .*names scene "(hidden|must-use)-\d+", which is not in the storyboard/.test(entry);
}

function resolvedOrNull(storyboard, words, beats) {
  try { return resolveStory(JSON.parse(JSON.stringify(storyboard)), { words, beats }); } catch { return null; }
}

function sceneTimes(storyboard, words, beats) {
  const resolved = resolvedOrNull(storyboard, words, beats);
  return new Map((resolved?.scenes ?? []).map((scene) => [scene.id, { start: Number(scene.start), end: Number(scene.end) }]));
}

// assets-relative src → the notes text the constraints prompt quotes for a must_use file.
function mediaNoteMap(media) {
  return new Map(media.filter((item) => item?.notes).map((item) => [String(item.src).replace(/^assets\//, ""), bareNotesLine(item)]));
}

function moduleIds(story) {
  return (Array.isArray(story?.scenes) ? story.scenes : []).map((scene) => scene?.module).filter((id) => typeof id === "string");
}

function normalizeUsage(usage = {}) {
  const input = Number(usage?.input_tokens ?? usage?.prompt_tokens ?? 0) || 0;
  const output = Number(usage?.output_tokens ?? usage?.completion_tokens ?? 0) || 0;
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: Number(usage?.total_tokens) || input + output,
    cached_tokens: Number(usage?.cached_tokens ?? 0) || 0
  };
}

function emptyUsage() {
  return { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
}

function emptyLayout() {
  return { errors: 0, warnings: 0, findings: [] };
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function message(error) {
  return String(error?.message ?? error).replace(/\b(?:sk|sess)-[a-z0-9_-]{12,}\b/gi, "[REDACTED]");
}

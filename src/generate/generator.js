// The footage generator (docs/GENERATED_FOOTAGE_RFC.md §3, §6, §7): an asset
// provider (src/asset_provider.js findShot contract) that answers footage shot
// requests by generating them, keyframe first.
//
//   const generator = createGenerator({project, image, video, budget, tier, notice, ...});
//   await resolveShots(story, {assets: generator, project, words});
//   generator.report()  // {quotes, stopped, notes}
//
// Per request: the library first (when given) → the brief (a refused request
// is null) → an accepted file in the ledger is reused → the money gate before
// every paid call → image step (submit, poll, fetch) → keyframe check → video
// step from the keyframe when the brief wants video. Every attempt, accepted or
// not, is one ledger line. A rejected keyframe is retried with one changed line,
// up to MAX_ATTEMPTS per shot and step (counted across runs), then null.
//
// Quote first: requests asked together (concurrency > 1 makes resolveShots
// ask them all at once) are quoted as one batch before any is generated. A
// batch needs a budget it fits in, or, attended (approve given), a yes; the
// approved quote then becomes the budget. A provider with no price (quote
// amount null) reports no cost either, so no budget can see its spend: it is
// refused unless maxCalls caps its paid calls (counted across runs in the ledger).
import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { MAX_ASSET_PROVIDER_CONCURRENCY, createCommandAssetProvider } from "../asset_provider_cmd.js";
import { footageBrief, lookParagraph, refusalReason } from "./brief.js";
import { FREE_UNITS, MAX_ATTEMPTS, appendLedger, checkBudget, nextAttempt, quoteBatch, readLedger, spendGate, spentTotal } from "./ledger.js";

export const GENERATED_DIR = path.join("assets", "shots", "generated");
// Poll pace (the ElevenLabs docs ask for no more than every 2 s for images, 10 s for video).
export const POLL_MS = Object.freeze({ image: 2000, video: 10_000 });

// Keyframe candidates per round: stills are cheap next to a clip, so several are
// made and the best one is animated. One by default.
export const MAX_KEYFRAME_CANDIDATES = 6;

export function createGenerator({ project, image, video = null, budget = null, daily = null, tier = "final", maxCalls = null, library = null, check = null, approve = null, candidates = 1, look = lookParagraph(null), fps, pollMs = POLL_MS, notice = () => {} }) {
  if (!project) throw new Error("createGenerator needs a project");
  if (!image) throw new Error("createGenerator needs an image provider (the keyframe step)");
  const notes = [];
  const quotes = [];
  const say = (line) => { notes.push(line); notice(`generate: ${line}`); };
  let count = parseKeyframeCandidates(candidates) ?? 1;
  // Paying for several stills with nothing to choose between them is waste.
  if (count > 1 && !check) { say(`no vision model is configured to choose between keyframe candidates, so one is made per shot, not ${count}`); count = 1; }
  // given: the user's --budget; without one, each approved quote becomes the budget.
  const given = Boolean(budget && Object.keys(budget).length);
  let limit = given ? { ...budget } : null;
  let stopped = null;
  let pending = [];
  let checkNoted = false;

  const providerFor = (step) => (step === "image" ? image : video);
  // keyframeOnly: a story draft stops at its approved keyframe; the clip is made once the draft is approved.
  const wantsVideo = (job) => Boolean(job.brief.video) && !job.request.keyframeOnly;

  // The batch: quote what is left to generate, then let it through or refuse it.
  async function flush(batch) {
    const todo = [];
    for (const job of batch) {
      try {
        const shot = library ? await library.findShot(job.request, { signal: job.signal }) : null;
        if (shot) { job.resolve(shot); continue; }
        if (job.request.storyBrief) {
          // A story shot or plate brings its own brief (brief.js storyBrief / plateBrief).
          if (!video && job.request.storyBrief.video && !job.request.keyframeOnly) { say(`${job.request.id}: not generated, no video provider is set (--generate-video)`); job.resolve(null); continue; }
          job.brief = job.request.storyBrief;
        } else {
          const reason = refusalReason(job.request);
          if (reason) { say(`${job.request.id}: not generated, ${reason}`); job.resolve(null); continue; }
          // No video provider: a video request is left alone, an "any" one is answered with a still.
          if (!video && job.request.type === "video" && !job.request.still) { say(`${job.request.id}: not generated, no video provider is set (--generate-video)`); job.resolve(null); continue; }
          job.brief = footageBrief(video ? job.request : { ...job.request, still: true }, { look, ...(fps ? { fps } : {}) });
        }
        job.cached = await cachedSteps(project, job.brief, image, video, tier);
        if (job.cached.video || (job.cached.image && !wantsVideo(job))) { job.resolve(finished(job)); continue; }
        todo.push(job);
      } catch (error) { job.reject(error); }
    }
    if (!todo.length) return;
    let allowed;
    try { allowed = await allow(todo); } catch (error) { for (const job of todo) job.reject(error); return; }
    if (!allowed) { for (const job of todo) job.resolve(null); return; }
    // One at a time: the budget is checked against spend recorded by the call before.
    for (const job of todo) await generate(job).then(job.resolve, job.reject);
  }

  async function allow(todo) {
    const items = { image: [], video: [] };
    for (const job of todo) {
      if (!job.cached.image) for (let i = 0; i < count; i += 1) items.image.push({ brief: job.brief, step: "image", tier });
      if (wantsVideo(job)) items.video.push({ brief: job.brief, step: "video", tier });
    }
    const unpriced = new Set();
    const untimed = new Set();
    const totals = {};
    for (const step of ["image", "video"]) {
      if (!items[step].length) continue;
      const provider = providerFor(step);
      // A null amount is "no price known": counted as 0 here, and the batch then needs a call cap (maxCalls).
      const quoted = await quoteBatch(items[step], { id: provider.id, quote: async (...args) => {
        const quote = await provider.quote(...args);
        if (quote?.amount == null && quote?.unit) { (FREE_UNITS.has(quote.unit) ? untimed : unpriced).add(quote.unit); return { amount: 0, unit: quote.unit }; }
        return quote;
      } });
      for (const [unit, amount] of Object.entries(quoted.totals)) totals[unit] = (totals[unit] ?? 0) + amount;
    }
    const text = `${todo.length} shot(s), ${Object.entries(totals).map(([unit, amount]) => `${unpriced.has(unit) || untimed.has(unit) ? "unknown" : round(amount)} ${unit}`).join(" + ") || "nothing to pay"}`;
    const spent = await spentTotal(project);
    quotes.push({ shots: todo.map((job) => job.request.id), totals, unpriced: [...unpriced] });
    // An unpriced provider reports no cost either, so no budget can see its spend: only a cap on its calls bounds it.
    if (unpriced.size && !(maxCalls > 0)) { say(`quote: ${text}; refused: the provider gives no price in ${[...unpriced].join(", ")} and reports no cost, so its spend can't be counted or held to --budget; pass --max-generations <n> to cap its paid calls`); return false; }
    // Local time is not money: a batch that spends only seconds needs no budget, cap or approval.
    const pricedSpend = Object.entries(totals).some(([unit, amount]) => !unpriced.has(unit) && !FREE_UNITS.has(unit) && amount > 0);
    const units = Object.keys(totals);
    if (units.length && units.every((unit) => FREE_UNITS.has(unit))) { say(`quote: ${text}; local time only, no money spent`); return true; }
    if (given) {
      const fits = checkBudget({ quote: totals, budget: limit, spent });
      if (!fits.ok) { say(`quote: ${text}; refused: ${fits.reasons.join("; ")}`); return false; }
      if (!approve) { say(`quote: ${text}; within the budget`); return true; }
    }
    if (!approve && !pricedSpend && unpriced.size) { say(`quote: ${text}; spend not tracked, capped at ${maxCalls} unpriced call(s) (--max-generations)`); return true; }
    if (!approve) { say(`quote: ${text}; refused: generating without a person to ask needs --budget`); return false; }
    if (!(await approve(`generate: ${text}. Generate them?`))) { say(`quote: ${text}; not approved`); return false; }
    say(`quote: ${text}; approved`);
    // The yes is for this quote: it becomes the budget, on top of what is already spent.
    if (!given) limit = { ...limit, ...Object.fromEntries(Object.entries(totals).map(([unit, amount]) => [unit, round((spent[unit] ?? 0) + amount)])) };
    return true;
  }

  async function generate(job) {
    if (stopped) { say(`${job.request.id}: not generated, ${stopped}`); return null; }
    const { brief, signal } = job;
    if (!job.cached.image) {
      job.cached.image = await keyframe(job);
      if (!job.cached.image) return null;
    }
    if (wantsVideo(job) && !job.cached.video) {
      job.cached.video = await step(job, "video", brief, { startFrame: path.resolve(project, job.cached.image.file), signal }, null);
      if (!job.cached.video) return null;
    }
    return finished(job);
  }

  // The keyframe, checked: a rejection retries with the check's one changed line.
  async function keyframe(job) {
    let brief = job.brief;
    let changed = null;
    for (;;) {
      const made = await step(job, "image", brief, { signal: job.signal }, changed);
      if (!made) return null;
      if (made.verdict === "accepted") return made;
      changed = made.change;
      brief = { ...job.brief, image: { ...job.brief.image, prompt: `${job.brief.image.prompt} ${changed}` } };
    }
  }

  // One step until accepted, rejected (image) or out of attempts/budget. An
  // image attempt is a round of `count` candidate stills sharing one attempt
  // number; the check picks the one to keep, and the rest are logged rejected.
  async function step(job, name, brief, options, changed) {
    const provider = providerFor(name);
    const want = name === "image" ? count : 1;
    for (;;) {
      const attempt = await nextAttempt(project, job.request.id, name);
      if (attempt == null) { say(`${job.request.id}: ${name} not generated after ${MAX_ATTEMPTS} attempts; the shot needs simplifying`); return null; }
      const made = [];
      for (let i = 1; i <= want; i += 1) {
        const quote = await provider.quote(brief, name, tier);
        const gate = await spendGate({ project, provider: provider.id, quote, budget: limit ?? {}, daily, maxCalls });
        const { priced } = gate;
        if (!gate.ok) {
          stopped = gate.reasons.join("; ");
          say(`${job.request.id}: not generated, ${stopped}`);
          if (made.length) break;
          return null;
        }
        const entry = { shot: job.request.id, step: name, tier, attempt, ...(want > 1 ? { candidate: i } : {}), provider: provider.id, brief_hash: job.brief.brief_hash, ...(changed ? { changed } : {}) };
        const started = Date.now();
        let result;
        try {
          result = await run(provider, brief, name, tier, options, path.join(project, GENERATED_DIR, job.request.id, `${name}-${tier}-${attempt}${want > 1 ? `-c${i}` : ""}`), pollMs[name] ?? 0);
        } catch (error) {
          if (error?.name === "AbortError") throw error;
          // shortcut: a failed call is logged at its quote (or 0 when unpriced); providers that report a refund-free failure can return cost 0 from fetch later.
          await appendLedger(project, { ...entry, model: error.model ?? null, cost: priced ? cost(quote) : { amount: 0, unit: quote.unit }, ...(priced ? {} : { cost_unknown: true }), seconds: secondsSince(started), verdict: "failed", reason: String(error?.message ?? error).slice(0, 300) });
          say(`${job.request.id}: ${name} attempt ${attempt}${want > 1 ? ` candidate ${i}` : ""} failed (${String(error?.message ?? error).split("\n")[0]})`);
          continue;
        }
        const spent = result.cost ? cost(result.cost) : priced ? cost(quote) : { amount: 0, unit: quote.unit };
        made.push({ abs: result.file, base: { ...entry, model: result.model ?? null, seed: result.seed ?? null, cost: spent, ...(!result.cost && !priced ? { cost_unknown: true } : {}), seconds: secondsSince(started), file: path.relative(project, result.file), licence: result.licence ?? null } });
      }
      if (!made.length) continue;
      if (name !== "image") return await appendLedger(project, { ...made[0].base, verdict: "accepted" });
      const { best, verdicts, change } = await chooseKeyframe(made.map((entry) => entry.abs), brief, job.request);
      let accepted = null;
      for (const [i, entry] of made.entries()) {
        const verdict = verdicts[i] ?? {};
        if (i === best) accepted = await appendLedger(project, { ...entry.base, verdict: "accepted" });
        else await appendLedger(project, { ...entry.base, verdict: "rejected", reason: verdict.ok ? "another candidate was chosen" : (verdict.reason ?? "the keyframe does not show the request") });
      }
      if (accepted) {
        if (made.length > 1) say(`${job.request.id}: keyframe candidate ${accepted.candidate} of ${made.length} chosen`);
        return accepted;
      }
      const reason = verdicts.map((verdict) => verdict?.reason).filter(Boolean)[0] ?? "no reason given";
      say(`${job.request.id}: keyframe attempt ${attempt} rejected${made.length > 1 ? ` (all ${made.length} candidates)` : ""} (${reason})`);
      return { verdict: "rejected", change: change || (job.request.shows ? `It must clearly show: ${job.request.shows}.` : "Match the reference sheets and the description exactly.") };
    }
  }

  // → {best: index | null, verdicts: [{ok, reason}], change}. A check with rank()
  // compares the candidates in one look; one without checks them in turn and keeps the first that passes.
  async function chooseKeyframe(files, brief, request) {
    if (!check) {
      // shortcut: no vision route configured, so the keyframe is accepted unseen; configure a model that takes images to check it.
      if (!checkNoted) { say("no vision model is configured, so keyframes are accepted without a check"); checkNoted = true; }
      return { best: 0, verdicts: files.map(() => ({ ok: true })), change: null };
    }
    try {
      if (files.length > 1 && check.rank) return await check.rank({ files, brief, request });
      const verdicts = [];
      for (const file of files) {
        const verdict = await check({ file, brief, request });
        verdicts.push(verdict);
        if (verdict.ok) return { best: verdicts.length - 1, verdicts, change: null };
      }
      return { best: null, verdicts, change: verdicts.at(-1)?.change ?? null };
    } catch (error) {
      // A check that cannot run (the model is down) would fail every retry the same way: the first paid keyframe is kept.
      say(`${request.id}: the keyframe check failed (${String(error?.message ?? error).split("\n")[0]}); the keyframe is accepted unchecked`);
      return { best: 0, verdicts: files.map(() => ({ ok: true })), change: null };
    }
  }

  function finished(job) {
    const { image: still, video: clip } = job.cached;
    const last = clip ?? still;
    const made = [still, clip].filter(Boolean).map((entry) => `${entry.provider}:${entry.model ?? "?"}`);
    const licences = [...new Set([clip?.licence, still?.licence].filter(Boolean))];
    return {
      kind: clip ? "video" : "image",
      file: path.resolve(project, last.file),
      source: { made_with: made.join(" → "), licence: licences.join("; keyframe: ") || null, generated: true, provider: last.provider, model: last.model ?? null, brief_hash: job.brief.brief_hash },
      ...(clip ? { sourceStart: job.brief.video.pad_seconds } : {})
    };
  }

  return {
    // resolveShots asks every request at once when this is above 1, so they are quoted as one batch.
    concurrency: MAX_ASSET_PROVIDER_CONCURRENCY,
    findShot(request, { signal } = {}) {
      return new Promise((resolve, reject) => {
        if (!pending.length) setImmediate(() => { const batch = pending; pending = []; flush(batch); });
        pending.push({ request, signal, resolve, reject });
      });
    },
    report: () => ({ quotes, stopped, notes }),
    async close() {
      await library?.close?.();
      await image.close?.();
      if (video !== image) await video?.close?.();
    }
  };
}

// The accepted ledger lines this brief can reuse, per step. The key is the
// unchanged brief's hash, the provider, the tier (the video step's; a keyframe
// serves every tier, so a final animates the keyframe its draft was approved
// from) and, once known, the model.
async function cachedSteps(project, brief, image, video, tier) {
  const entries = (await readLedger(project)).reverse();
  const find = (step, provider) => entries.find((entry) => entry.verdict === "accepted" && entry.step === step && (step === "image" || entry.tier === tier) && entry.provider === provider.id && entry.brief_hash === brief.brief_hash && entry.file && existsSync(path.resolve(project, entry.file))) ?? null;
  return { image: find("image", image), video: brief.video && video ? find("video", video) : null };
}

async function run(provider, brief, step, tier, options, outDir, wait) {
  const job = await provider.submit(brief, step, tier, options);
  for (;;) {
    const state = await provider.poll(job);
    if (state.state === "done") break;
    if (state.state === "failed") throw Object.assign(new Error(state.error ?? `${step} failed`), { model: job.model });
    await sleep(wait, undefined, { signal: options.signal });
  }
  return provider.fetch(job, outDir);
}

/**
 * --generate / --generate-image / --generate-video / --generate-draft-video
 * values → {image, video} specs {provider, model}. provider is fal,
 * elevenlabs, local (model is a ComfyUI workflow file) or cmd (model is then the command).
 */
export function generateSpecs({ generate, image, video, draftVideo } = {}) {
  const parse = (value, flag) => {
    if (value == null || value === true || value === "") return value === true ? fail(flag) : null;
    const text = String(value);
    const at = text.indexOf(":");
    const provider = (at < 0 ? text : text.slice(0, at)).toLowerCase();
    if (!GENERATE_PROVIDERS.includes(provider)) throw new Error(`${flag} must name ${GENERATE_PROVIDERS.join(", ")}; got ${provider}`);
    const model = at < 0 ? null : text.slice(at + 1);
    if (provider === "cmd" && !model) throw new Error(`${flag} cmd needs a command: ${flag} "cmd:<command>"`);
    return { provider, model };
  };
  const fail = (flag) => { throw new Error(`${flag} needs a value: ${flag} <provider>[:<model>]`); };
  const base = parse(generate, "--generate");
  const specs = { image: parse(image, "--generate-image") ?? base, video: parse(video, "--generate-video") ?? base, draftVideo: parse(draftVideo, "--generate-draft-video") };
  if (!specs.image && (specs.video || specs.draftVideo)) throw new Error("--generate-video needs a keyframe provider too: --generate <provider> or --generate-image <provider>:<model>");
  if (specs.draftVideo && specs.video && specs.draftVideo.provider !== specs.video.provider) throw new Error("--generate-draft-video must use the same provider as the video step");
  return specs.image ? specs : null;
}

export const GENERATE_PROVIDERS = Object.freeze(["fal", "elevenlabs", "local", "cmd"]);

/** "5", "5usd", "200credits", "5usd,200credits" → {usd: 5, credits: 200}; nothing → null. */
export function parseBudget(value, flag = "--budget") {
  if (value == null || value === "") return null;
  if (value === true) throw new Error(`${flag} needs an amount: ${flag} 5usd or ${flag} 200credits`);
  const budget = {};
  for (const part of String(value).split(",")) {
    const match = /^\s*(\d+(?:\.\d+)?)\s*(usd|credits)?\s*$/i.exec(part);
    if (!match) throw new Error(`${flag} must be <n>[usd|credits]; got ${part}`);
    budget[(match[2] ?? "usd").toLowerCase()] = Number(match[1]);
  }
  return budget;
}

/** Specs → provider adapters; the same provider for both steps is one adapter with both models. */
export async function createProviders(specs, { env = process.env, fetch, notice, cwd } = {}) {
  const make = async (provider, models) => {
    if (provider === "fal") return (await import("./providers/fal.js")).createFalProvider({ ...models, env, ...(fetch ? { fetch } : {}) });
    if (provider === "local") return (await import("./providers/local.js")).createLocalProvider({ ...models, env, ...(fetch ? { fetch } : {}), ...(cwd ? { cwd } : {}) });
    if (provider === "elevenlabs") return (await import("./providers/elevenlabs.js")).createElevenLabsProvider({ ...models, env, ...(fetch ? { fetch } : {}) });
    return createCommandProvider(models.command, { env, notice, cwd });
  };
  const { image, video, draftVideo } = specs;
  const models = (spec, step) => (spec.provider === "cmd" ? { command: spec.model } : { [`${step}Model`]: spec.model ?? undefined });
  if (!video) return { image: await make(image.provider, models(image, "image")), video: null };
  if (video.provider === image.provider && (image.provider !== "cmd" || video.model === image.model)) {
    const shared = await make(image.provider, { ...models(image, "image"), ...models(video, "video"), ...(draftVideo ? { draftVideoModel: draftVideo.model } : {}) });
    return { image: shared, video: shared };
  }
  return { image: await make(image.provider, models(image, "image")), video: await make(video.provider, { ...models(video, "video"), ...(draftVideo ? { draftVideoModel: draftVideo.model } : {}) }) };
}

/**
 * A provider that is a command speaking one JSON line per call
 * (src/asset_provider_cmd.js): it reads {id, op: "quote" | "generate", brief,
 * step, tier, startFrame?} and answers with the same id and
 * {amount, unit} for a quote, or {file, model?, seed?, licence?, cost?} (or
 * {error}) for a generation. The file is copied into the project.
 */
export function createCommandProvider(command, { env = process.env, notice, cwd, timeoutMs = 20 * 60_000 } = {}) {
  const cmd = createCommandAssetProvider(command, { env, notice, cwd, timeoutMs });
  let calls = 0;
  const send = (body) => cmd.findShot({ id: `generate-${++calls}`, ...body });
  return {
    id: "cmd",
    steps: ["image", "video"],
    async quote(brief, step, tier) {
      const answer = await send({ op: "quote", brief, step, tier });
      return { amount: Number.isFinite(answer?.amount) ? answer.amount : null, unit: answer?.unit ?? "usd" };
    },
    async submit(brief, step, tier, { startFrame } = {}) {
      const answer = await send({ op: "generate", brief, step, tier, ...(startFrame ? { startFrame } : {}) });
      if (!answer?.file) throw new Error(`the generate command gave no file for ${brief.id} (${answer?.error ?? "no answer"})`);
      return { ...answer, step };
    },
    poll: () => ({ state: "done" }),
    async fetch(job, outDir) {
      await mkdir(outDir, { recursive: true });
      const file = path.join(outDir, `${job.step}${path.extname(job.file)}`);
      await copyFile(job.file, file);
      return { file, model: job.model ?? null, seed: job.seed ?? null, licence: job.licence ?? null, ...(job.cost ? { cost: job.cost } : {}) };
    },
    close: () => cmd.close()
  };
}

/**
 * The keyframe check from a model that takes images (src/model_provider.js
 * runStructured): does the still show `shows`, with no text, logos or UI?
 * → check({file, brief, request}) → {ok, reason, change}
 */
export function visionKeyframeCheck(client, { readImage = defaultReadImage } = {}) {
  const check = async ({ file, request }) => {
    const result = await client.runStructured({
      instructions: "You check a generated keyframe for a video. Say whether it clearly shows the requested subject, and whether any text, lettering, logo, user interface or recognisable real person is visible (that fails it). When it fails, give one short sentence to add to the image prompt that fixes the main problem.",
      input: `Requested subject: ${request.shows}`,
      images: [{ url: await readImage(file), detail: "low" }],
      schema: KEYFRAME_SCHEMA,
      schemaName: "launchclip_keyframe_check",
      // Room for a reasoning model to think before it answers (a small cap returned nothing on a real run).
      maxOutputTokens: 2000
    });
    const value = result?.value ?? {};
    const ok = Boolean(value.shows_subject) && !value.has_text_or_logo;
    return { ok, reason: ok ? null : String(value.finding ?? "the keyframe does not show the request"), change: ok ? null : String(value.change ?? "") || null };
  };
  // Several candidates in one look: each passes or fails as above (plus anomalies), and the
  // best passing one is the highest look match plus aesthetics. → {best, verdicts, change}
  check.rank = async ({ files, brief, request }) => {
    const result = await client.runStructured({
      instructions: "You compare candidate keyframes for one shot of a video, numbered from 1 in the order given. For each, say whether it clearly shows the requested subject; whether any text, lettering, logo, user interface or recognisable real person is visible; whether it has anomalies (malformed hands or faces, extra or missing fingers or limbs, melted or impossible objects, physics that cannot happen); and score from 0 to 10 how well it matches the look asked for and how good it is to look at (composition, light, focus, a calm lower third). Give a short finding for each. Then give one short sentence to add to the image prompt that would fix the main problem if every candidate fails.",
      input: `Requested subject: ${request.shows ?? brief?.image?.prompt ?? ""}\nThe look asked for: ${brief?.image?.prompt ?? ""}\nCandidates: ${files.length}`,
      images: await Promise.all(files.map(async (file) => ({ url: await readImage(file), detail: "low" }))),
      schema: RANK_SCHEMA,
      schemaName: "launchclip_keyframe_rank",
      maxOutputTokens: 4000
    });
    const rows = Array.isArray(result?.value?.candidates) ? result.value.candidates : [];
    const verdicts = files.map((_, i) => {
      const row = rows.find((entry) => Number(entry.index) === i + 1) ?? rows[i] ?? {};
      const ok = Boolean(row.shows_subject) && !row.has_text_or_logo && !row.anomalies;
      return { ok, score: (Number(row.look_match) || 0) + (Number(row.aesthetics) || 0), reason: ok ? null : String(row.finding ?? "the keyframe does not pass") };
    });
    const passing = verdicts.map((verdict, i) => [verdict, i]).filter(([verdict]) => verdict.ok);
    const best = passing.length ? passing.reduce((a, b) => (b[0].score > a[0].score ? b : a))[1] : null;
    return { best, verdicts, change: best == null ? String(result?.value?.change ?? "") || null : null };
  };
  return check;
}

const RANK_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["candidates", "change"],
  properties: {
    candidates: { type: "array", items: { type: "object", additionalProperties: false, required: ["index", "shows_subject", "has_text_or_logo", "anomalies", "look_match", "aesthetics", "finding"], properties: { index: { type: "integer" }, shows_subject: { type: "boolean" }, has_text_or_logo: { type: "boolean" }, anomalies: { type: "boolean" }, look_match: { type: "integer" }, aesthetics: { type: "integer" }, finding: { type: "string" } } } },
    change: { type: "string" }
  }
});

/** --keyframe-candidates <n>: stills per keyframe round, 1 to MAX_KEYFRAME_CANDIDATES; nothing → null. */
export function parseKeyframeCandidates(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_KEYFRAME_CANDIDATES) throw new Error(`--keyframe-candidates must be a whole number from 1 to ${MAX_KEYFRAME_CANDIDATES}; got ${value}`);
  return n;
}

const KEYFRAME_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["shows_subject", "has_text_or_logo", "finding", "change"],
  properties: { shows_subject: { type: "boolean" }, has_text_or_logo: { type: "boolean" }, finding: { type: "string" }, change: { type: "string" } }
});

async function defaultReadImage(file) {
  const { readFile } = await import("node:fs/promises");
  const mime = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[path.extname(file).toLowerCase()] ?? "image/png";
  return `data:${mime};base64,${(await readFile(file)).toString("base64")}`;
}

const cost = ({ amount, unit }) => ({ amount, unit });
const round = (value) => Math.round(value * 10_000) / 10_000;
const secondsSince = (started) => Math.round((Date.now() - started) / 100) / 10;

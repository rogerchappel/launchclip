// Fast scoring with a decision model (docs/SCORING_ROADMAP.md, stages 1 and 2).
//
// A decision model answers closed questions about some content: yes/no
// (`noul`), pick one (`choice`) or rate on an ordered scale (`score`). It
// returns a probability for every answer and writes no text.
//
//   ask({state, questions, model?})        → {answers, model, usage}
//   parseRubric(value)                     → {model, pass_at, questions}
//   judge(question, answer, passAt)        → {status, value, p?}
//   scoreItems(items, rubric, options)     → the gate report
//
// A rubric is a brand's taste as closed questions. Each question may add, on
// top of the model's own fields (type, instructions, criteria):
//
//   on      the item kinds it is asked of ("hook", ["slide", "script"]); all when left out
//   want    noul only: false when "yes" is the failure (a banned claim). Default true
//   min     score only: the lowest level index that passes
//   allow   choice only: the options that pass
//   gate    false makes the question a tag whatever its type. Default true
//
// A choice with no `allow`, a score with no `min`, or any question with
// `"gate": false` is a tag: recorded, never failed. Fields the scorer does not
// know (a drafted rubric's `evidence`) are kept in the rubric and never sent. A question passes when the probability of a passing answer is
// at least `pass_at` (default 0.7), fails at or below 1 - pass_at, and is
// "unsure" in between. An item fails when any question fails, and is "review"
// when none fails but one is unsure.
//
// The content scored can argue for its own answer (research text, a
// competitor's caption), so nothing here acts on an answer; it only reports.
//
// shortcut: one hosted endpoint (OpenRouter's Decisions API), no local model
// and no shuffling of option order; add a backend when stage 0 of the roadmap
// has measured one worth gating on.
import { mapLimit } from "./concurrency.js";

export const SCORER_URL = "https://openrouter.ai/api/alpha/decisions";
export const DEFAULT_SCORER_MODEL = "typesafe/jev-1.13";
export const DEFAULT_PASS_AT = 0.7;
export const QUESTION_TYPES = Object.freeze(["noul", "choice", "score"]);
const QUESTION_KEY = /^[A-Za-z0-9_-]{1,64}$/;
const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 524, 529]);

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const kindsOf = (on) => (on == null ? null : [on].flat().map(String));

/** value: the parsed rubric file. → {model, pass_at, questions}; throws naming every problem. */
export function parseRubric(value) {
  const errors = [];
  if (!isObject(value) || !isObject(value.questions) || !Object.keys(value.questions).length) throw new Error('a rubric is {"questions": {"<key>": {type, instructions, criteria}}} with at least one question');
  const passAt = value.pass_at ?? DEFAULT_PASS_AT;
  if (!(passAt > 0.5 && passAt < 1)) errors.push(`pass_at must be above 0.5 and below 1; got ${passAt}`);
  for (const [key, question] of Object.entries(value.questions)) {
    const err = (message) => errors.push(`questions.${key}: ${message}`);
    if (!QUESTION_KEY.test(key)) err("the key must be 1 to 64 letters, digits, _ or -");
    if (!isObject(question)) { err("must be an object"); continue; }
    if (!QUESTION_TYPES.includes(question.type)) { err(`type must be one of ${QUESTION_TYPES.join(", ")}`); continue; }
    if (typeof question.instructions !== "string" || !question.instructions.trim()) err("instructions must be the full question, as text");
    const { criteria } = question;
    if (question.type === "choice") {
      if (!isObject(criteria) || Object.keys(criteria).length < 2) err("criteria must be an object of 2 or more options: {option: when it applies}");
      else if (question.allow !== undefined && (!Array.isArray(question.allow) || !question.allow.length || question.allow.some((option) => !Object.hasOwn(criteria, option)))) err(`allow must list options from criteria (${Object.keys(criteria).join(", ")})`);
    }
    if (question.type === "score") {
      if (!Array.isArray(criteria) || criteria.length < 2 || criteria.some((level) => typeof level !== "string" || !level.trim())) err("criteria must be a list of 2 or more level descriptions, lowest first");
      else if (question.min !== undefined && !(Number.isInteger(question.min) && question.min >= 1 && question.min < criteria.length)) err(`min must be a level index from 1 to ${criteria.length - 1}`);
    }
    if (question.type === "noul" && question.want !== undefined && typeof question.want !== "boolean") err("want must be true or false");
    if (question.gate !== undefined && typeof question.gate !== "boolean") err("gate must be true or false");
  }
  if (errors.length) throw new Error(`the rubric has ${errors.length} problem(s):\n- ${errors.join("\n- ")}`);
  return { model: value.model ?? null, pass_at: passAt, questions: value.questions };
}

/** The questions asked of an item of this kind, with the gate's own fields left out. */
export function questionsFor(rubric, kind) {
  const asked = {};
  for (const [key, question] of Object.entries(rubric.questions)) {
    const kinds = kindsOf(question.on);
    if (kinds && !kinds.includes(kind)) continue;
    asked[key] = { type: question.type, instructions: question.instructions, ...(question.criteria !== undefined ? { criteria: question.criteria } : {}) };
  }
  return asked;
}

/**
 * One request: every question against one state. state: text, or an object or
 * list of related context. fetch defaults to the global one, which the CLI has
 * already wrapped with its cost limit.
 */
export async function ask({ state, questions, model = process.env.LAUNCHCLIP_SCORER_MODEL || DEFAULT_SCORER_MODEL, apiKey = process.env.OPENROUTER_API_KEY, url = SCORER_URL, fetch = globalThis.fetch, maxRetries = 2, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set: scoring uses a hosted decision model through OpenRouter");
  const body = JSON.stringify({ model, state, questions });
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body });
    if (response.ok) {
      const value = await response.json();
      if (!isObject(value?.answers)) throw new Error(`the scorer (${model}) returned no answers`);
      return { answers: value.answers, model: value.model ?? model, usage: value.usage ?? {} };
    }
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    if (!RETRY_STATUS.has(response.status) || attempt >= maxRetries) throw new Error(`the scorer (${model}) answered ${response.status}: ${detail}`);
    await sleep(500 * 2 ** attempt);
  }
}

/** One answer against its rubric question. → {status: "pass"|"fail"|"unsure"|"tag", value, p?} */
export function judge(question, answer, passAt = DEFAULT_PASS_AT) {
  const answered = isObject(answer) && answer.type === question.type;
  if (question.gate === false) return { status: "tag", value: answered ? answer[question.type] : null };
  if (!answered) return { status: "unsure", value: null, p: null };
  let p = null;
  let value;
  if (question.type === "noul") {
    value = answer.noul;
    p = question.want === false ? 1 - answer.noul : answer.noul;
  } else if (question.type === "choice") {
    value = answer.choice;
    if (question.allow) p = question.allow.reduce((sum, option) => sum + (answer.probabilities?.[option] ?? 0), 0);
  } else {
    value = answer.score;
    if (question.min !== undefined) p = Object.entries(answer.probabilities ?? {}).reduce((sum, [level, share]) => sum + (Number(level) >= question.min ? share : 0), 0);
  }
  if (p === null) return { status: "tag", value };
  if (!Number.isFinite(p)) return { status: "unsure", value, p: null };
  const rounded = Math.round(p * 1000) / 1000;
  return { status: rounded >= passAt ? "pass" : rounded <= 1 - passAt ? "fail" : "unsure", value, p: rounded };
}

/**
 * items: [{id, kind, text, ...context}]. rubric: from parseRubric. context:
 * fields added to every item's state (the brief). → {status, model, counts,
 * cost_usd, items: [{id, kind, text, status, failed, unsure, tags, answers}]}
 */
export async function scoreItems(items, rubric, { model, concurrency = 16, context = {}, ...request } = {}) {
  const route = model ?? rubric.model ?? undefined;
  let cost = 0;
  let served = null;
  const scored = await mapLimit(items, concurrency, async (item) => {
    const questions = questionsFor(rubric, item.kind);
    if (!Object.keys(questions).length) return { ...item, status: "skipped", failed: [], unsure: [], tags: {}, answers: {} };
    const { id, ...content } = item;
    const reply = await ask({ ...request, ...(route ? { model: route } : {}), state: { ...context, ...content }, questions });
    cost += Number(reply.usage?.cost) || 0;
    served ??= reply.model;
    const answers = {};
    const tags = {};
    const failed = [];
    const unsure = [];
    for (const key of Object.keys(questions)) {
      const verdict = judge(rubric.questions[key], reply.answers[key], rubric.pass_at);
      answers[key] = verdict;
      if (verdict.status === "tag") tags[key] = verdict.value;
      if (verdict.status === "fail") failed.push(key);
      if (verdict.status === "unsure") unsure.push(key);
    }
    return { ...item, status: failed.length ? "failed" : unsure.length ? "review" : "passed", failed, unsure, tags, answers };
  });
  const counts = { passed: 0, review: 0, failed: 0, skipped: 0 };
  for (const item of scored) counts[item.status] += 1;
  return { stage: "score", status: counts.failed ? "failed" : counts.review ? "review" : "passed", model: served ?? route ?? null, pass_at: rubric.pass_at, counts, cost_usd: Math.round(cost * 1e6) / 1e6, items: scored };
}

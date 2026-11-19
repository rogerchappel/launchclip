// The per-project generation ledger and money gate (docs/GENERATED_FOOTAGE_RFC.md §6, §7, §10).
// Pure Node: no provider calls. Contract for the generator (wave 2 wires it into make):
//
//   Ledger: <project>/qa/generation-log.jsonl, one JSON line per attempt:
//     {shot, step: "image"|"video", tier: "draft"|"final", attempt, provider, model, seed,
//      brief_hash, bible_hash?, changed?, cost: {amount, unit}, seconds?, file?,
//      verdict: "accepted"|"rejected"|"failed", reason?, licence?, at}
//     appendLedger(project, entry, {now?}) → the line written (adds `at`)
//     readLedger(project) → entries (a torn or foreign line is skipped, never thrown)
//     cacheKey({brief_hash, provider, model, step, tier, seed}) → "sha256:…"
//     findAccepted(project, key) → the newest accepted entry with that key whose file still exists, else null
//
//   Money: a quote or a spend is a units map, e.g. {usd: 1.2, credits: 40}; units are never added across.
//     quoteBatch(items: [{brief, step, tier}], provider) → {totals, lines}
//     checkBudget({quote, budget, spent}) → {ok, reasons, remaining}
//     spentTotal(project) / spentToday(project, {now?}) → units map of recorded spend (every attempt costs)
//     beforeCall({project, budget, daily?, nextQuote, now?}) → {ok, reasons, spent, remaining}
//   Budget is enforced on recorded spend plus the next call's quote (§10). A unit with no budget is
//   refused, except "seconds" (local time, not money). A budget is a units map: {usd: 5}.
//
//   Retries: nextAttempt(project, shot, step) → the next attempt number, or null once MAX_ATTEMPTS were made.
//   Costs: ledgerCosts(project) → {line_items, by_unit}; line items have the cost tracker's shape
//     (launchclip.costs.v1), so MAKE.json can add them to its costs.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export const LEDGER_FILE = path.join("qa", "generation-log.jsonl");
export const MAX_ATTEMPTS = 3;
// Units that measure time on this machine, not money: no budget is needed to spend them.
export const FREE_UNITS = new Set(["seconds", "local"]);

export function ledgerPath(project) {
  return path.join(project, LEDGER_FILE);
}

/** Append one attempt. One appendFile of one line, so concurrent writers interleave whole lines. */
export async function appendLedger(project, entry, { now = () => new Date().toISOString() } = {}) {
  for (const field of ["shot", "step", "tier", "provider"]) {
    if (typeof entry?.[field] !== "string" || !entry[field]) throw new Error(`ledger entry needs ${field}`);
  }
  if (!Number.isInteger(entry.attempt) || entry.attempt < 1) throw new Error("ledger entry needs attempt, a whole number from 1");
  checkCost(entry.cost, `ledger entry for ${entry.shot}`);
  const line = { ...entry, at: entry.at ?? now() };
  const file = ledgerPath(project);
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(line)}\n`);
  return line;
}

export async function readLedger(project) {
  let text;
  try { text = await readFile(ledgerPath(project), "utf8"); } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const entries = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    // A crash mid-append leaves a torn last line: skip it rather than lose the whole ledger.
    try {
      const entry = JSON.parse(line);
      if (entry && typeof entry === "object") entries.push(entry);
    } catch {}
  }
  return entries;
}

export function cacheKey({ brief_hash, provider, model, step, tier, seed }) {
  const parts = [brief_hash, provider, model, step, tier, seed ?? null];
  return `sha256:${createHash("sha256").update(JSON.stringify(parts)).digest("hex")}`;
}

export async function findAccepted(project, key) {
  const entries = await readLedger(project);
  for (const entry of entries.reverse()) {
    if (entry.verdict !== "accepted" || !entry.file || cacheKey(entry) !== key) continue;
    if (existsSync(path.resolve(project, entry.file))) return entry;
  }
  return null;
}

/** Quote every item; totals per unit. A quote that is not {amount ≥ 0, unit} throws, so a batch is never under-quoted. */
export async function quoteBatch(items, provider) {
  const totals = {};
  const lines = [];
  for (const { brief, step, tier } of items) {
    const quote = await provider.quote(brief, step, tier);
    checkCost(quote, `${provider.id} quote for ${brief?.id ?? "a brief"} (${step}, ${tier})`);
    totals[quote.unit] = (totals[quote.unit] ?? 0) + quote.amount;
    lines.push({ shot: brief?.id ?? null, step, tier, amount: quote.amount, unit: quote.unit });
  }
  return { totals: rounded(totals), lines };
}

/** Refuse when spent + quote passes the budget in a quoted unit, or when a quoted money unit has no budget. */
export function checkBudget({ quote = {}, budget = {}, spent = {} }) {
  const reasons = [];
  const remaining = {};
  for (const [unit, limit] of Object.entries(budget ?? {})) remaining[unit] = round(limit - (spent[unit] ?? 0));
  for (const unit of Object.keys(quote)) {
    const need = (spent[unit] ?? 0) + (quote[unit] ?? 0);
    const limit = budget?.[unit];
    if (limit == null) {
      if (!FREE_UNITS.has(unit) && need > 0) reasons.push(`no budget in ${unit} (need ${round(need)} ${unit})`);
    } else if (need > limit) {
      reasons.push(`${round(need)} ${unit} would pass the budget of ${limit} ${unit} (${round(spent[unit] ?? 0)} spent)`);
    }
  }
  return { ok: reasons.length === 0, reasons, remaining };
}

export async function spentTotal(project) {
  return sumCosts(await readLedger(project));
}

// shortcut: "today" is the UTC day of `at`; switch to the local day if users near midnight UTC find it surprising.
export async function spentToday(project, { now = () => new Date().toISOString() } = {}) {
  const day = now().slice(0, 10);
  return sumCosts((await readLedger(project)).filter((entry) => String(entry.at ?? "").slice(0, 10) === day));
}

/** Stop when the next call, on top of what the ledger records, would pass the project or the daily budget. */
export async function beforeCall({ project, budget = {}, daily = null, nextQuote, now }) {
  checkCost(nextQuote, "the next call's quote");
  const quote = { [nextQuote.unit]: nextQuote.amount };
  const spent = await spentTotal(project);
  const total = checkBudget({ quote, budget, spent });
  if (!daily) return { ...total, spent };
  const today = checkBudget({ quote, budget: daily, spent: await spentToday(project, { now }) });
  return { ok: total.ok && today.ok, reasons: [...total.reasons, ...today.reasons.map((reason) => `today: ${reason}`)], spent, remaining: total.remaining };
}

/** Attempts count per shot and step, across tiers. */
export async function nextAttempt(project, shot, step) {
  const made = (await readLedger(project)).filter((entry) => entry.shot === shot && entry.step === step);
  const next = Math.max(0, ...made.map((entry) => Number(entry.attempt) || 0)) + 1;
  return next > MAX_ATTEMPTS ? null : next;
}

/**
 * The ledger as cost-tracker line items (src/cost_tracker.js pricedItem shape). Spend in usd is priced;
 * credits are unpriced with a warning (no exchange rate is guessed); local seconds cost nothing.
 */
export async function ledgerCosts(project) {
  const entries = (await readLedger(project)).filter((entry) => entry.cost);
  const line_items = entries.map((entry) => {
    const { amount, unit } = entry.cost;
    const item = { provider: entry.provider ?? "unknown", product: `generation-${entry.step ?? "unknown"}`, model: entry.model ?? null, request_id: null, usage: { [unit]: amount, attempts: 1 } };
    // Unknown spend is not free spend: the agent's tool or the provider reported no cost.
    if (entry.cost_unknown) return { ...item, estimated_usd: null, fallback: false, pricing: null, warning: `${entry.provider} reported no cost for this generation; check its own billing` };
    if (unit === "usd") return { ...item, estimated_usd: amount, fallback: false, pricing: { unit: "USD recorded in the generation ledger", source: LEDGER_FILE } };
    if (FREE_UNITS.has(unit)) return { ...item, estimated_usd: 0, fallback: false, pricing: { unit: "local generation, no money spent", source: LEDGER_FILE } };
    return { ...item, estimated_usd: null, fallback: false, pricing: null, warning: `${entry.provider} generation is billed in ${unit}, which has no USD rate` };
  });
  return { line_items, by_unit: sumCosts(entries) };
}

function sumCosts(entries) {
  const totals = {};
  for (const { cost } of entries) {
    if (!cost || !Number.isFinite(cost.amount)) continue;
    totals[cost.unit] = (totals[cost.unit] ?? 0) + cost.amount;
  }
  return rounded(totals);
}

function checkCost(cost, what) {
  if (!cost || typeof cost.unit !== "string" || !cost.unit || !Number.isFinite(cost.amount) || cost.amount < 0) {
    throw new Error(`${what} needs cost {amount ≥ 0, unit}, received ${JSON.stringify(cost)}`);
  }
}

function round(value) { return Math.round(value * 100_000_000) / 100_000_000; }
function rounded(totals) { return Object.fromEntries(Object.entries(totals).map(([unit, amount]) => [unit, round(amount)])); }

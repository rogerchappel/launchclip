// The one limit on model calls in a `launchclip make` run.
//
// Every model call make sends goes through one gate (stageModel wraps the
// run's client), so work that overlaps (asset descriptions, a second opening
// beside a render, the long-form chunks) never has more than
// --model-concurrency calls in flight, whichever stage started them.
//
//   --model-concurrency <n>, else LAUNCHCLIP_MODEL_CONCURRENCY, else 4.
//   1 sends one call at a time, as make did before calls could overlap.
//
// A rate-limit answer (HTTP 429) does not fail the stage. The clients retry
// a few times on their own; when one still gives up, the gate holds every
// call for the provider's Retry-After (or a doubling wait), lowers the limit
// by one for the rest of the run, and sends the same request again.
//
// The gate changes when a call is sent, never what is sent: a request and its
// answer are the same at any limit, so the files a run writes are too.

export const DEFAULT_MODEL_CONCURRENCY = 4;
export const MAX_MODEL_CONCURRENCY = 32;
export const MODEL_CONCURRENCY_ENV = "LAUNCHCLIP_MODEL_CONCURRENCY";
// Rate-limit waits per call before its error is the stage's.
export const RATE_LIMIT_RETRIES = 5;
const BACKOFF_FIRST_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;

/** --model-concurrency, else LAUNCHCLIP_MODEL_CONCURRENCY, else the default. Throws on anything but a whole number from 1 to 32. */
export function modelConcurrency(value, env = process.env) {
  const flagged = value !== undefined && value !== null && value !== "";
  const raw = flagged ? value : env?.[MODEL_CONCURRENCY_ENV];
  if (raw === undefined || raw === null || raw === "") return DEFAULT_MODEL_CONCURRENCY;
  const count = raw === true ? NaN : Number(raw);
  if (!Number.isInteger(count) || count < 1 || count > MAX_MODEL_CONCURRENCY) throw new Error(`${flagged ? "--model-concurrency" : MODEL_CONCURRENCY_ENV} must be a whole number from 1 to ${MAX_MODEL_CONCURRENCY}; got ${raw}`);
  return count;
}

/** Whether a client's error is the provider saying "too many requests". */
export function isRateLimit(error) {
  if (!error || error.code === "LAUNCHCLIP_COST_LIMIT") return false;
  if (Number(error.status ?? error.statusCode) === 429) return true;
  return /\(429\)|\b429\b.*(rate|too many)|rate[ _-]?limit|too many requests/i.test(String(error.message ?? error));
}

/** The provider's Retry-After in ms (SDK errors carry the response headers), or null. */
export function retryAfterMs(error) {
  const headers = error?.headers;
  const raw = typeof headers?.get === "function" ? headers.get("retry-after") : headers?.["retry-after"];
  const seconds = Number(raw);
  return raw !== undefined && raw !== null && raw !== "" && Number.isFinite(seconds) && seconds >= 0 ? Math.min(BACKOFF_MAX_MS, seconds * 1000) : null;
}

/**
 * options: {limit, now (ms), sleep(ms), say(line), retries}.
 * → {limit, wrap(client), run(call), stage(name), sideBySide(what, slots), report()}
 *
 * wrap(client) is the client with runStructured() behind the gate; stage(name)
 * names the make stage the calls that follow belong to; report() is MAKE.json's
 * model_calls: how many calls ran, how many at once, and where they overlapped.
 */
export function createModelGate({ limit = DEFAULT_MODEL_CONCURRENCY, now = () => performance.now(), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), say = () => {}, retries = RATE_LIMIT_RETRIES } = {}) {
  let allowed = limit;
  let active = 0;
  let holdUntil = 0;
  let current = null;
  const waiting = [];
  const running = new Set();
  const totals = { calls: 0, peak: 0, overlapped: 0, waits: 0, waited_ms: 0 };
  const stages = new Map();

  const pump = () => {
    while (active < allowed && waiting.length) {
      active += 1;
      waiting.shift()();
    }
  };
  const acquire = () => new Promise((resolve) => { waiting.push(resolve); pump(); });
  const release = () => { active -= 1; pump(); };
  const stageEntry = (name) => {
    if (!stages.has(name)) stages.set(name, { calls: 0, call_ms: 0, peak: 0, overlapped: 0, local: [] });
    return stages.get(name);
  };

  // One attempt in flight: counted, and marked when another call ran beside it.
  async function attempt(call, record) {
    running.add(record);
    if (running.size > 1) for (const other of running) other.overlapped = true;
    totals.peak = Math.max(totals.peak, running.size);
    record.entry.peak = Math.max(record.entry.peak, [...running].filter((other) => other.entry === record.entry).length);
    const started = now();
    try { return await call(); } finally {
      running.delete(record);
      record.entry.call_ms += now() - started;
    }
  }

  async function run(call) {
    const entry = stageEntry(current ?? "run");
    await acquire();
    const record = { entry, overlapped: false };
    totals.calls += 1;
    entry.calls += 1;
    try {
      for (let tries = 0; ; tries += 1) {
        const hold = holdUntil - now();
        if (hold > 0) await sleep(hold);
        try { return await attempt(call, record); } catch (error) {
          if (!isRateLimit(error) || tries >= retries) throw error;
          const wait = retryAfterMs(error) ?? Math.min(BACKOFF_MAX_MS, BACKOFF_FIRST_MS * 2 ** tries);
          holdUntil = Math.max(holdUntil, now() + wait);
          if (allowed > 1) allowed -= 1;
          totals.waits += 1;
          totals.waited_ms += wait;
          say(`model: the provider answered with a rate limit; waiting ${Math.round(wait / 100) / 10}s, then sending the call again (try ${tries + 2} of ${retries + 1}); model calls now run ${allowed} at a time`);
        }
      }
    } finally {
      if (record.overlapped) { totals.overlapped += 1; entry.overlapped += 1; }
      release();
    }
  }

  return {
    limit,
    run,
    stage(name) { current = name; },
    // Local work the current stage runs side by side (candidate stills, reference sheets), for the report.
    sideBySide(what, slots) {
      const entry = stageEntry(current ?? "run");
      const line = `${what}: ${slots} at a time`;
      if (!entry.local.includes(line)) entry.local.push(line);
    },
    wrap(client) {
      // The client's own fields (provider, model, supportsImages) read through; only the call is gated.
      const gated = Object.create(client);
      gated.runStructured = (request) => run(() => client.runStructured(request));
      return gated;
    },
    report() {
      const seconds = (ms) => Math.round(ms / 100) / 10;
      return {
        concurrency: limit,
        calls: totals.calls,
        peak: totals.peak,
        overlapped: totals.overlapped,
        ...(totals.waits ? { rate_limit: { waits: totals.waits, waited_seconds: seconds(totals.waited_ms), concurrency_after: allowed } } : {}),
        stages: Object.fromEntries([...stages].filter(([, entry]) => entry.calls || entry.local.length).map(([name, entry]) => [name, { calls: entry.calls, call_seconds: seconds(entry.call_ms), peak: entry.peak, overlapped: entry.overlapped, ...(entry.local.length ? { side_by_side: entry.local } : {}) }]))
      };
    }
  };
}

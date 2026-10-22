// Demo autopilot guardrails: where it may point a browser, what it may type,
// and what it writes to logs.
//
// - URLs: local or staging only by default. localhost, loopback, private
//   network addresses, *.localhost / *.test / *.local, and hosts with a
//   staging-style label (staging, stage, dev, test, qa, sandbox, preview).
//   Anything else is refused unless the caller names the host in allowHosts.
// - Typing: a password field only takes a value from a test account (seed
//   file or LAUNCHCLIP_DEMO_* env), referenced as {account: "password"}; the
//   plan never carries a literal password.
// - Logs: secret-looking strings are redacted, and typed account values are
//   masked.

const STAGING_LABEL = /^(staging|stage|stg|dev|develop|development|test|testing|qa|uat|sandbox|preview|demo|local)$/;
const LOCAL_SUFFIX = /\.(localhost|test|local|internal|lan)$/;

function privateIp(host) {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 0);
}

/** "local" | "staging" | "production" for a URL's host. */
export function classifyHost(url) {
  const host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || privateIp(host) || LOCAL_SUFFIX.test(host) || !host.includes(".")) return "local";
  const labels = host.split(".").slice(0, -2);
  if (labels.some((label) => label.split("-").some((part) => STAGING_LABEL.test(part)))) return "staging";
  return "production";
}

/**
 * Throw unless `url` is http(s) on a local or staging host, or its host is
 * listed in allowHosts (the explicit --allow-host opt-in).
 */
export function assertSafeUrl(url, { allowHosts = [] } = {}) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error(`demo URL "${url}" is not a valid URL`); }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error(`demo URL ${url} must be http or https`);
  if (allowHosts.map((host) => String(host).toLowerCase()).includes(parsed.hostname.toLowerCase())) return "allowed";
  const kind = classifyHost(url);
  if (kind === "production") throw new Error(`demo URL ${url} looks like a production host; demo autopilot records local or staging apps only. Pass --allow-host ${parsed.hostname} if this really is a test environment`);
  return kind;
}

const SECRET_PATTERNS = [
  [/\b(sk-[A-Za-z0-9_-]{12,})\b/g, "[REDACTED_SECRET]"],
  [/\b(sk_(?:live|test)_[A-Za-z0-9]{8,})\b/g, "[REDACTED_SECRET]"],
  [/\b(gh[pousr]_[A-Za-z0-9_]{12,})\b/g, "[REDACTED_SECRET]"],
  [/\b(xox[abpr]-[A-Za-z0-9-]{10,})\b/g, "[REDACTED_SECRET]"],
  [/\b(AKIA[0-9A-Z]{16})\b/g, "[REDACTED_SECRET]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_JWT]"],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, "$1[REDACTED_SECRET]"],
  [/\b((?:api[_-]?key|token|secret|password|passwd|pwd|auth)\s*["']?\s*[:=]\s*["']?)([^\s'"`,}]+)/gi, "$1[REDACTED_SECRET]"],
  [/(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/([^:@/\s]+):([^@/\s]+)@/gi, "$1://$2:[REDACTED_SECRET]@"]
];

/** Redact secret-looking strings (API keys, tokens, JWTs, passwords, DSN passwords). */
export function redactSecrets(text) {
  let out = String(text ?? "");
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

/** Redact secrets and mask every value in `masks` (typed account values). */
export function redactWith(text, masks = []) {
  let out = redactSecrets(text);
  for (const value of masks.filter((item) => typeof item === "string" && item.length >= 3)) out = out.split(value).join("•".repeat(Math.min(value.length, 12)));
  return out;
}

/**
 * Check one `type` step: a literal value must not look like a secret, and a
 * password field (selector or label mentions password, or the step sets
 * secret: true) must take its value from a test account.
 * → null when fine, else the reason.
 */
export function typeStepProblem(step) {
  const target = `${step.selector ?? ""} ${step.text ?? ""} ${step.label ?? ""}`.toLowerCase();
  const passwordField = step.secret === true || /pass(word)?|pwd/.test(target);
  if (step.value && typeof step.value === "object") {
    if (!["email", "password", "username"].includes(step.value.account)) return `value.account must be email, password or username; got ${JSON.stringify(step.value.account)}`;
    if (passwordField && step.value.account !== "password") return "a password field must take {account: \"password\"}";
    return null;
  }
  if (typeof step.value !== "string") return "value must be a string or {account: \"email\"|\"password\"|\"username\"}";
  if (passwordField) return "never type a literal into a password field; use {account: \"password\"} (from the seed data or LAUNCHCLIP_DEMO_PASSWORD)";
  if (redactSecrets(step.value) !== step.value) return "the typed value looks like a secret";
  return null;
}

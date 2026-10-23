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
// - Sessions: a plan's ready signed-in session (app.session, for SSO apps)
//   holds test values only: no live API keys, no signed JWTs, no long random
//   tokens that don't say they are test data.
// - Logs: secret-looking strings are redacted, and typed account values and
//   session values are masked.

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

const API_KEYS = [
  /\b(sk-[A-Za-z0-9_-]{12,})\b/g,
  /\b(sk_(?:live|test)_[A-Za-z0-9]{8,})\b/g,
  /\b(gh[pousr]_[A-Za-z0-9_]{12,})\b/g,
  /\b(xox[abpr]-[A-Za-z0-9-]{10,})\b/g,
  /\b(AKIA[0-9A-Z]{16})\b/g
];
const SECRET_PATTERNS = [
  ...API_KEYS.map((pattern) => [pattern, "[REDACTED_SECRET]"]),
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

const TEST_MARKER = /test|demo|fake|mock|example|fixture|dummy|sample|placeholder|not-?real/i;

function base64Json(segment) {
  try { return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")); } catch { return null; }
}

function entropy(text) {
  const counts = new Map();
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  return [...counts.values()].reduce((sum, n) => sum - (n / text.length) * Math.log2(n / text.length), 0);
}

/**
 * Check one value of a plan's signed-in session (a localStorage value or a
 * cookie). It must be a test value: not an API key, not a signed JWT (an
 * unsigned one, alg "none" or a fake signature, is fine), and not a long
 * random token unless the value says it is test data (test, demo, fake…).
 * → null when fine, else the reason.
 */
export function sessionValueProblem(value) {
  const text = String(value ?? "");
  for (const pattern of API_KEYS) if (new RegExp(pattern.source, pattern.flags).test(text)) return "looks like a real API key";
  if (/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i.test(text) && !TEST_MARKER.test(text)) return "looks like a real bearer token";
  for (const [, header, signature] of text.matchAll(/\b([A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}\.([A-Za-z0-9_-]+)/g)) {
    const alg = base64Json(header)?.alg;
    if (alg && alg !== "none" && signature.length >= 16) return `is a signed JWT (alg ${alg}); use an unsigned test token (alg "none", or a fake signature such as "signature")`;
  }
  if (!TEST_MARKER.test(text)) {
    for (const [run] of text.matchAll(/[A-Za-z0-9+/=_-]{40,}/g)) if (entropy(run) > 4) return "looks like a real session token (a long random string); use an obviously fake value, or one that says test, demo or fake";
  }
  return null;
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

// Headers a captured HAR carries that are always real credentials.
const CREDENTIAL_HEADERS = new Set(["authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key", "x-auth-token", "x-csrf-token", "x-xsrf-token"]);
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;
const TEST_DOMAIN = /(^|\.)(example\.(com|org|net)|test|example|invalid|localhost)$/i;

/**
 * Problems that keep a HAR from being committed as demo data: credential
 * headers and cookies, token- or key-like values in URLs and bodies, and
 * email addresses outside example and .test domains (a capture from staging
 * holds real people). → [{entry, url, problem}]
 */
export function harProblems(har) {
  const out = [];
  (har?.log?.entries ?? []).forEach((entry, index) => {
    const url = String(entry?.request?.url ?? "?").slice(0, 120);
    const add = (problem) => out.push({ entry: index, url, problem });
    for (const [side, message] of [["request", entry?.request], ["response", entry?.response]]) {
      for (const header of message?.headers ?? []) if (CREDENTIAL_HEADERS.has(String(header.name).toLowerCase())) add(`${side} header ${header.name}; remove it`);
      if ((message?.cookies ?? []).length) add(`${side} cookies (${message.cookies.map((cookie) => cookie.name).join(", ")}); remove them`);
    }
    const texts = [
      ["URL", entry?.request?.url],
      ["request body", entry?.request?.postData?.text],
      ["response body", entry?.response?.content?.encoding === "base64" ? null : entry?.response?.content?.text]
    ];
    for (const [where, raw] of texts) {
      if (typeof raw !== "string" || !raw) continue;
      const text = raw.slice(0, 200_000);
      if (redactSecrets(text) !== text || sessionValueProblem(text)) add(`${where} holds a token, key or password; replace it with a fake value`);
      const real = [...new Set([...text.matchAll(EMAIL)].filter((match) => !TEST_DOMAIN.test(match[1])).map((match) => match[0]))];
      if (real.length) add(`${where} holds email addresses (${real.slice(0, 3).join(", ")}${real.length > 3 ? "…" : ""}); replace them with @example.com ones`);
    }
  });
  return out;
}

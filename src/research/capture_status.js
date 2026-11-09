// What became of the captures research asked for, said out loud. A verified
// claim that wanted its source page on screen and did not get it is never
// passed over quietly: the run report, `launchclip doctor` and the research
// gate each say which claim, why, and what to do about it.
//
// A blocked page (a paywall, a bot check, a sign-in wall) is a finding, not
// something to work round: the fix is another public source or a card that
// cites the claim, never a way past the block.
import { RESEARCH_PATHS } from "./schema.js";

export const CAPTURE_STATUS_SCHEMA = "launchclip.research-captures.v1";
export const CAPTURE_STATUS_FILE = "capture-status.json";

const FIXES = {
  "no-recorder": "install the recorder (npm install playwright && npx playwright install chromium, and ffmpeg on PATH), or pass --capture-cmd; then run again. `launchclip doctor` shows what is missing",
  paywall: "the page is behind a paywall, which is never bypassed: give another public source with --url, or let the claim show as a card that cites it",
  "bot-check": "the site refused an automated browser, which is never worked round: give another public source with --url, or let the claim show as a card that cites it",
  "sign-in": "the page needs a sign-in, and research never signs in: give a public source with --url, or let the claim show as a card that cites it",
  "http-error": "the page did not load; check the URL still works, or give another source with --url",
  "target-missing": "the page loaded but the quoted words were not found on it as rendered; check the page still says it, or edit the request's beat targets and run `launchclip evidence capture` on it",
  timeout: "the recorder gave no answer in time; run again, or lower --capture-concurrency on a busy machine",
  other: "see the reason; run `launchclip evidence capture <request>` on its own to look closer"
};

/** A capture failure's reason → the kind of failure it is. */
export function captureFailureKind(reason) {
  const text = String(reason ?? "");
  if (/no local recorder|playwright|no Chromium|ffmpeg is not on PATH|capture command (?:exited|failed to start)/i.test(text)) return "no-recorder";
  if (/paywall/i.test(text)) return "paywall";
  if (/bot check|block page|captcha/i.test(text)) return "bot-check";
  if (/sign-in wall|sign in/i.test(text)) return "sign-in";
  if (/no answer from the capture command|timed? ?out|timeout/i.test(text)) return "timeout";
  if (/HTTP \d{3}|net::|ERR_|empty page/i.test(text)) return "http-error";
  if (/target|not found|hidden|no element|matched nothing/i.test(text)) return "target-missing";
  return "other";
}

/**
 * ledger + capture requests + what the recorder did → the status.
 * result: {recorded: [request], failed: [{id, url, reason}]} or null when nothing was attempted.
 * → {schema, requested, recorded, missing, status: "none" | "recorded" | "partial" | "missing" | "not-attempted",
 *    captures: [{id, url, claims, status: "recorded" | "missing" | "not-attempted", kind?, reason?, fix?}],
 *    claims_without_capture: [{id, text, capture, kind, reason, fix}]}
 */
export function captureStatus(ledger, requests = [], result = null) {
  const recorded = new Set((result?.recorded ?? []).map((request) => request.id));
  const failed = new Map((result?.failed ?? []).map((entry) => [entry.id, entry]));
  // A recorder that never started fails every request at once (id "*").
  const blanket = failed.get("*") ?? null;
  const verified = (ledger?.claims ?? []).filter((claim) => claim.status === "verified");
  const captures = requests.map((request) => {
    const claims = verified.filter((claim) => claim.capture === request.id).map((claim) => claim.id);
    if (recorded.has(request.id)) return { id: request.id, url: request.url, claims, status: "recorded" };
    const failure = failed.get(request.id) ?? blanket;
    if (!failure) return { id: request.id, url: request.url, claims, status: "not-attempted" };
    const kind = captureFailureKind(failure.reason);
    return { id: request.id, url: request.url, claims, status: "missing", kind, reason: failure.reason, fix: FIXES[kind] };
  });
  const byId = new Map(captures.map((capture) => [capture.id, capture]));
  const without = verified.filter((claim) => claim.capture && byId.get(claim.capture)?.status === "missing").map((claim) => {
    const capture = byId.get(claim.capture);
    return { id: claim.id, text: claim.text, capture: capture.id, url: capture.url, kind: capture.kind, reason: capture.reason, fix: capture.fix };
  });
  const missing = captures.filter((capture) => capture.status === "missing").length;
  const done = captures.filter((capture) => capture.status === "recorded").length;
  const status = !captures.length ? "none" : !result ? "not-attempted" : !missing ? "recorded" : done ? "partial" : "missing";
  return { schema: CAPTURE_STATUS_SCHEMA, requested: captures.length, recorded: done, missing, status, captures, claims_without_capture: without };
}

/** The status in a few plain lines, loudest first; empty when every capture was recorded. */
export function captureStatusLines(status) {
  if (!status?.missing) return [];
  const lines = [];
  const kinds = new Map();
  for (const capture of status.captures.filter((entry) => entry.status === "missing")) kinds.set(capture.kind, [...(kinds.get(capture.kind) ?? []), capture]);
  lines.push(`${status.missing} of ${status.requested} source page${status.requested === 1 ? "" : "s"} research wanted on screen ${status.missing === 1 ? "was" : "were"} not recorded${status.claims_without_capture.length ? `, so ${status.claims_without_capture.length} verified claim${status.claims_without_capture.length === 1 ? " has" : "s have"} no page to show` : ""}`);
  for (const [kind, list] of kinds) lines.push(`${KIND_WORDS[kind]} (${list.map((capture) => capture.id).join(", ")}): ${FIXES[kind]}`);
  return lines;
}

const KIND_WORDS = { "no-recorder": "no recorder on this machine", paywall: "paywall", "bot-check": "bot check", "sign-in": "sign-in wall", "http-error": "page did not load", "target-missing": "quoted words not found on the page", timeout: "recorder timed out", other: "not recorded" };

/** The research gate with the capture status folded in: missing captures hold it at pending. */
export function gateWithCaptures(gate, status) {
  if (!status || status.status === "none" || status.status === "not-attempted") return gate;
  const captures = { requested: status.requested, recorded: status.recorded, missing: status.missing };
  if (!status.missing) return gate ? { ...gate, captures } : gate;
  const reason = captureStatusLines(status)[0];
  if (!gate || gate.status === "passed") return { status: "pending", reason: `${reason}; see captures in MAKE.json and ${RESEARCH_PATHS.dir}/${CAPTURE_STATUS_FILE}`, captures };
  return { ...gate, reason: `${gate.reason}; ${reason}`, captures };
}

/** Whether this machine can record captures at all → {available, reasons, hint?} (for doctor and the research report). */
export async function captureRecorderStatus(options = {}) {
  const check = options.recorderAvailability ?? (await import("../demo/record.js")).recorderAvailability;
  let available;
  try { available = await check({ env: options.env }); } catch (error) { available = { ok: false, reasons: [error.message] }; }
  return { available: available.ok, required_for_rendering: false, reasons: available.reasons ?? [], ...(available.ok ? {} : { hint: `evidence captures (source pages on screen) cannot be recorded: ${(available.reasons ?? []).join("; ")}. Fix: ${FIXES["no-recorder"].split(";")[0].replace(/, or pass --capture-cmd$/, "")}` }) };
}

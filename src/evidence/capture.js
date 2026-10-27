// Evidence capture, step 2: open a real public page, check it is really there,
// and turn a capture request into a clip, a poster and a sidecar.
//
// Same browser setup as the demo recorder (src/demo/record.js: Playwright's
// chromium, an installed Chromium, the system ffmpeg), but a different job:
// the page is evidence, so nothing on it is faked or skipped.
//
// - Public pages only: http(s) on a public host; localhost and private
//   addresses are refused. A fresh context every run (no cookies, no
//   profile), no downloads, service workers blocked. Nothing is ever typed
//   and no form is submitted, so it never signs in.
// - Consent banners are answered with the most privacy-preserving choice:
//   "Reject all" / "Only necessary" / "Decline" when the banner offers it,
//   in the page or a consent iframe. A banner with no such button is hidden
//   (which consents to nothing); "Accept" is never pressed.
// - Blocks fail loudly: an HTTP error, a bot check, a sign-in wall or a
//   paywall stops the capture with the reason (EvidenceBlockedError), and
//   never produces a clip of the wall.
// - Every beat target must be found on the page; a missing one is an error.
//
// The page is then frozen (animations and transitions paused, carets
// hidden), scrolled through once so lazy content loads, measured, and shot
// once at deviceScaleFactor 2. The beats play over that shot as a
// frame-pure timeline (src/evidence/timeline.js, src/evidence/player.js), so
// a re-run of the same page draws the same frames. The sidecar records what
// was captured: provenance, the final URL, the sha256 of the HTML snapshot,
// the full-page screenshot, and every text span selected or highlighted.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile, copyFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { classifyHost } from "../demo/guardrails.js";
import { recorderAvailability } from "../demo/record.js";
import { SIDECAR_SCHEMA, requestDuration, targetLabel, validateCaptureRequest } from "./request.js";
import { buildTimeline } from "./timeline.js";
import { chromeHeight, renderClip } from "./player.js";

export class EvidenceBlockedError extends Error {
  constructor(reason, detail = {}) {
    super(`evidence capture blocked: ${reason}`);
    this.name = "EvidenceBlockedError";
    this.reason = reason;
    this.detail = detail;
  }
}

const SHOT_SCALE = 2;
const MAX_PAGE_HEIGHT = 7600; // CSS px: 2× stays inside Chromium's 16k texture limit

/** Throw unless `url` is a public http(s) page (evidence never points at a local or private host). */
export function assertPublicUrl(url) {
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error(`evidence URL ${url} must be http or https`);
  if (classifyHost(url) === "local") throw new Error(`evidence URL ${url} is a local or private address; evidence capture records public pages only`);
  return parsed;
}

// ---------------------------------------------------------------------------
// Consent banners

// Button labels that refuse optional cookies, most privacy-preserving first.
export const REJECT_LABELS = [
  /^reject( all)?( cookies)?$/i, /^decline( all)?( cookies)?$/i, /^refuse( all)?$/i, /^deny( all)?$/i,
  /^(use |accept )?(only )?(strictly )?(necessary|essential|required)( cookies)?( only)?$/i,
  /^reject (non-essential|optional|additional)( cookies)?$/i, /^continue without (accepting|agreeing|consent)/i,
  /^do not (accept|consent)$/i, /^i do not accept$/i, /^disagree( and close)?$/i, /^no,? thanks$/i
];
// Known consent platforms: their reject button, and their container (hidden when nothing refuses).
const CMP_REJECT = ["#onetrust-reject-all-handler", "#CybotCookiebotDialogBodyButtonDecline", "#didomi-notice-disagree-button", ".fc-cta-do-not-consent", "[data-testid='uc-deny-all-button']", ".qc-cmp2-summary-buttons button[mode='secondary']", "#truste-consent-required"];
const CMP_CONTAINERS = ["#onetrust-consent-sdk", "#CybotCookiebotDialog", "#didomi-host", ".fc-consent-root", "#usercentrics-root", ".qc-cmp2-container", "[id^='sp_message_container']", "#truste-consent-track", ".truste_box_overlay", "#cookie-banner", "#cookie-consent", ".cookie-banner", ".cookie-consent", "[aria-label*='cookie' i][role='dialog']", "[aria-label*='consent' i][role='dialog']", "[class*='CookieBanner']", "[class*='cookie-notice']"];

/** Whether a button's label is a privacy-preserving refusal. */
export const isRejectLabel = (label) => REJECT_LABELS.some((pattern) => pattern.test(String(label).replace(/\s+/g, " ").trim()));

/**
 * Answer a consent banner with the most privacy-preserving choice.
 * → {action: "none" | "rejected" | "hidden", via?: label or selector, frame?: url}
 */
export async function dismissConsent(page, { log = () => {} } = {}) {
  for (const frame of page.frames()) {
    for (const selector of CMP_REJECT) {
      const button = frame.locator(selector).filter({ visible: true }).first();
      if (await button.count().catch(() => 0)) {
        await button.click({ timeout: 3000 }).catch(() => {});
        log(`consent: pressed ${selector}`);
        await page.waitForTimeout(600);
        return { action: "rejected", via: selector, frame: frame === page.mainFrame() ? null : frame.url() };
      }
    }
    const buttons = frame.locator("button, [role='button'], a[role='button'], input[type='button'], input[type='submit']").filter({ visible: true });
    const count = Math.min(await buttons.count().catch(() => 0), 400);
    for (let i = 0; i < count; i++) {
      const button = buttons.nth(i);
      const label = ((await button.innerText({ timeout: 500 }).catch(() => "")) || (await button.getAttribute("value").catch(() => "")) || (await button.getAttribute("aria-label").catch(() => "")) || "").trim();
      if (label && label.length < 60 && isRejectLabel(label)) {
        // Only inside something that is about cookies or consent: a page's own "Decline" buttons are left alone.
        const about = await button.evaluate((el) => { let node = el; for (let i = 0; i < 8 && node; i++, node = node.parentElement) { const text = (node.innerText || "").slice(0, 2000); if (/cookie|consent|privacy|tracking|gdpr/i.test(text + " " + (node.id || "") + " " + (node.className || ""))) return true; } return false; }).catch(() => false);
        if (!about) continue;
        await button.click({ timeout: 3000 }).catch(() => {});
        log(`consent: pressed "${label}"`);
        await page.waitForTimeout(600);
        return { action: "rejected", via: label, frame: frame === page.mainFrame() ? null : frame.url() };
      }
    }
  }
  const hidden = await page.evaluate((selectors) => {
    const found = [];
    for (const selector of selectors) for (const node of document.querySelectorAll(selector)) { const box = node.getBoundingClientRect(); if (box.width * box.height > 0) { node.style.setProperty("display", "none", "important"); found.push(selector); } }
    // A fixed bar about cookies or privacy that matched no known platform (and offered no refusal).
    for (const node of document.querySelectorAll("body *")) {
      const s = getComputedStyle(node);
      if (s.position !== "fixed" && s.position !== "sticky") continue;
      const box = node.getBoundingClientRect();
      if (box.width < innerWidth * 0.5 || box.height > innerHeight * 0.45 || box.height < 30) continue;
      if (box.top > 8 && box.bottom < innerHeight - 8) continue;
      if (!/cookie|consent|your privacy|privacy (rights|choices|policy)/i.test((node.innerText || "").slice(0, 1500))) continue;
      node.style.setProperty("display", "none", "important");
      found.push(`fixed bar "${(node.innerText || "").trim().split("\n")[0].slice(0, 40)}"`);
    }
    if (found.length) { document.documentElement.style.removeProperty("overflow"); document.body.style.removeProperty("overflow"); }
    return [...new Set(found)];
  }, CMP_CONTAINERS).catch(() => []);
  if (hidden.length) { log(`consent: no refuse button; hid ${hidden.join(", ")}`); return { action: "hidden", via: hidden.join(", ") }; }
  return { action: "none" };
}

/** Hide the request's page furniture (request.hide). → the selectors that matched something. */
export async function hideFurniture(page, selectors) {
  return page.evaluate((list) => list.filter((selector) => {
    let nodes = [];
    try { nodes = [...document.querySelectorAll(selector)]; } catch { return false; }
    for (const node of nodes) node.style.setProperty("display", "none", "important");
    return nodes.length > 0;
  }), selectors);
}

// ---------------------------------------------------------------------------
// Blocks, walls and paywalls

const BOT_CHECK = /(verify (that )?you are (a )?human|are you a robot|checking your browser|just a moment\.\.\.|attention required|enable javascript and cookies to continue|unusual traffic from your computer|press (and|&) hold|captcha|access denied|request blocked|you have been blocked)/i;
const SIGN_IN_WALL = /^(sign in|log in|login)( to (continue|github|your account))?\b/i;
const PAYWALL = /(subscribe (now )?to (continue|keep) reading|this (article|story|content) is (for|available to) (subscribers|members)( only)?|to continue reading,? (please )?(subscribe|sign in|log in)|you('ve| have) reached your (free )?(article )?limit|create a free account to (continue|read))/i;
const PAYWALL_SELECTORS = ["[class*='paywall' i]", "[id*='paywall' i]", ".tp-modal", ".tp-backdrop", "[data-testid*='paywall' i]", "#gateway-content", ".meteredContent", "[class*='regwall' i]"];

/**
 * Why a loaded page is not the evidence it claims to be, or null when it is.
 * Pure over a page summary: {status, requested, final, title, text, paywall: [selector]}.
 */
export function blockReason({ status, requested, final, title = "", text = "", paywall = [] }) {
  if (status && status >= 400) return `HTTP ${status} from ${final}`;
  const head = `${title}\n${text.slice(0, 3000)}`;
  if (BOT_CHECK.test(head) && text.length < 4000) return `a bot check or block page ("${(head.match(BOT_CHECK) ?? [""])[0]}")`;
  const req = new URL(requested), fin = new URL(final);
  if (fin.pathname !== req.pathname && /\/(login|signin|sign-in|sign_in|auth|session|account\/login|accounts\/login)\b/i.test(fin.pathname)) return `a sign-in wall (redirected to ${fin.origin}${fin.pathname})`;
  if (SIGN_IN_WALL.test(title.trim()) && text.length < 3000) return `a sign-in wall ("${title.trim()}")`;
  if (PAYWALL.test(text)) return `a paywall ("${(text.match(PAYWALL) ?? [""])[0]}")`;
  if (paywall.length) return `a paywall overlay (${paywall.join(", ")})`;
  if (text.replace(/\s+/g, "").length < 80) return "an empty page (under 80 characters of text)";
  return null;
}

async function pageSummary(page, { requested, status }) {
  const { title, text, paywall } = await page.evaluate((selectors) => ({
    title: document.title,
    text: document.body?.innerText ?? "",
    paywall: selectors.filter((selector) => [...document.querySelectorAll(selector)].some((node) => { const r = node.getBoundingClientRect(); const s = getComputedStyle(node); return r.width * r.height > 40000 && s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0.1; }))
  }), PAYWALL_SELECTORS);
  return { status, requested, final: page.url(), title, text, paywall };
}

// ---------------------------------------------------------------------------
// Freeze and measure

const FREEZE_CSS = "*,*::before,*::after{animation-play-state:paused!important;animation-delay:-0.0001s!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}::-webkit-scrollbar{display:none!important}";

/** Freeze the page and scroll through `height` px once so lazy content loads. */
async function freeze(page, height) {
  await page.addStyleTag({ content: FREEZE_CSS }).catch(() => {});
  await page.evaluate(async (until) => {
    for (const media of document.querySelectorAll("video, audio")) { try { media.pause(); } catch {} }
    const step = Math.max(400, innerHeight * 0.8);
    for (let y = 0; y < until; y += step) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
    scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 300));
    await document.fonts?.ready;
  }, height);
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
}

// In the page: a target → [{x, y, width, height}] in page CSS px (scroll 0),
// with the text a text target matched. Text search runs over the visible text
// nodes joined in order with whitespace collapsed, so a phrase split across
// <span>s (a highlighted diff line) still matches; exact case first, then any.
function measureInPage(target) {
  const scope = target.within ? document.querySelector(target.within) : document.body;
  if (!scope) return { error: `within ${target.within} matched nothing` };
  const px = (r) => ({ x: Math.round((r.left + scrollX) * 10) / 10, y: Math.round((r.top + scrollY) * 10) / 10, width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 });
  const visible = (node) => { const el = node.nodeType === 1 ? node : node.parentElement; if (!el) return false; const s = getComputedStyle(el); if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) return false; return el.getClientRects().length > 0; };
  if (target.selector !== undefined) {
    let nodes;
    try { nodes = [...scope.querySelectorAll(target.selector)].filter(visible); } catch (error) { return { error: `invalid selector ${target.selector}: ${error.message}` }; }
    const node = nodes[target.nth ?? 0];
    if (!node) return { error: `no visible element matches ${target.selector}${target.nth ? ` (nth ${target.nth} of ${nodes.length})` : ""}` };
    const r = node.getBoundingClientRect();
    return { rects: [px(r)], text: (node.innerText || "").replace(/\s+/g, " ").trim().slice(0, 200) };
  }
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  const nodes = [], starts = [];
  let joined = "", lastSpace = true;
  const map = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue || !visible(node)) continue;
    const tag = node.parentElement?.closest("script, style, noscript, template");
    if (tag) continue;
    nodes.push(node); starts.push(joined.length);
    const value = node.nodeValue;
    for (let i = 0; i < value.length; i++) {
      const space = /\s/.test(value[i]);
      if (space && lastSpace) continue;
      joined += space ? " " : value[i];
      map.push([nodes.length - 1, i]);
      lastSpace = space;
    }
  }
  const want = target.text.replace(/\s+/g, " ").trim();
  const find = (hay, needle) => { const hits = []; let at = hay.indexOf(needle); while (at >= 0 && hits.length <= (target.nth ?? 0)) { hits.push(at); at = hay.indexOf(needle, at + 1); } return hits; };
  let hits = find(joined, want);
  if (!hits.length) hits = find(joined.toLowerCase(), want.toLowerCase());
  const at = hits[target.nth ?? 0];
  if (at === undefined) return { error: `text "${want}" is not on the page${target.nth ? ` (wanted match ${target.nth}, found ${hits.length})` : ""}` };
  const [n0, o0] = map[at], [n1, o1] = map[at + want.length - 1];
  const range = document.createRange();
  range.setStart(nodes[n0], o0);
  range.setEnd(nodes[n1], o1 + 1);
  // One rect per line: merge the fragments a range returns for the same line.
  const lines = [];
  for (const r of range.getClientRects()) {
    if (r.width < 1 || r.height < 1) continue;
    const line = lines.find((l) => Math.abs(l.top - r.top) < r.height * 0.5);
    if (line) { line.left = Math.min(line.left, r.left); line.right = Math.max(line.right, r.right); line.top = Math.min(line.top, r.top); line.bottom = Math.max(line.bottom, r.bottom); }
    else lines.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
  }
  if (!lines.length) return { error: `text "${want}" is on the page but not visible` };
  if (target.closest) {
    // The element round the phrase (a diff row, a table row, a card) instead of the phrase itself.
    const start = nodes[n0].parentElement?.closest(target.closest);
    if (!start) return { error: `text "${want}" has no ancestor matching ${target.closest}` };
    return { rects: [px(start.getBoundingClientRect())], text: joined.slice(at, at + want.length) };
  }
  return { rects: lines.map((l) => px({ left: l.left, top: l.top, width: l.right - l.left, height: l.bottom - l.top })), text: joined.slice(at, at + want.length) };
}

/** Measure a target on the page. Throws when it is missing. */
export async function measureTarget(page, target, where = "target") {
  await page.evaluate(() => scrollTo(0, 0));
  const result = await page.evaluate(measureInPage, target);
  if (result.error) throw new Error(`${where} ${targetLabel(target)}: ${result.error}`);
  return result;
}

// ---------------------------------------------------------------------------
// Open

async function launch(available) {
  return available.chromium.launch({ executablePath: available.executablePath, headless: true, args: ["--hide-scrollbars", "--disable-features=Translate,MediaRouter", "--no-first-run", "--no-default-browser-check", "--mute-audio"] });
}

/**
 * Open a request's page in a fresh context and get it ready to measure:
 * loaded, consent answered, checked for walls, frozen. → {context, page, status, consent}
 * Throws EvidenceBlockedError on a block, a wall or a paywall.
 */
export async function openEvidencePage(browser, request, { viewport, scale = SHOT_SCALE, log = () => {} } = {}) {
  assertPublicUrl(request.url);
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale, locale: "en-US", timezoneId: "UTC", colorScheme: request.theme, reducedMotion: "reduce", acceptDownloads: false, serviceWorkers: "block", javaScriptEnabled: true });
  // Typing and form submission are never part of a capture: refuse any POST of a form the page might try.
  await context.route("**/*", (route) => (route.request().method() === "POST" && route.request().resourceType() === "document" ? route.abort("blockedbyclient") : route.continue()));
  const page = await context.newPage();
  try {
    log(`opening ${request.url}`);
    const response = await page.goto(request.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForLoadState("load", { timeout: 20000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    const consent = await dismissConsent(page, { log });
    if (request.wait_for) await page.locator(request.wait_for).first().waitFor({ state: "visible", timeout: 15000 }).catch(() => { throw new EvidenceBlockedError(`wait_for ${request.wait_for} never showed`, { url: page.url() }); });
    const hidden = request.hide?.length ? await hideFurniture(page, request.hide) : [];
    if (hidden.length) log(`hid ${hidden.join(", ")}`);
    const summary = await pageSummary(page, { requested: request.url, status: response?.status() ?? null });
    const reason = blockReason(summary);
    if (reason) throw new EvidenceBlockedError(reason, { url: summary.final, title: summary.title, status: summary.status });
    return { context, page, status: summary.status, consent, title: summary.title, hidden };
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const rel = (from, file) => path.relative(from, file).split(path.sep).join("/");

/**
 * Run one capture request. → {video, poster, sidecar, fullpage, snapshot, record}
 * Files land next to `request.out` (resolved from `root`): <id>.mp4|webm,
 * <id>.poster.png, <id>.evidence.json, <id>.fullpage.png, <id>.snapshot.html.
 */
export async function captureEvidence(input, { root = process.cwd(), log = () => {}, availability = recorderAvailability } = {}) {
  const { errors, request } = validateCaptureRequest(input);
  if (errors.length) throw new Error(`capture request has errors:\n- ${errors.join("\n- ")}`);
  assertPublicUrl(request.url);
  const available = await availability();
  if (!available.ok) throw new Error(`cannot capture: ${available.reasons.join("; ")}`);
  const out = path.resolve(root, request.out);
  const dir = path.dirname(out);
  await mkdir(dir, { recursive: true });
  const base = path.join(dir, request.id);
  const chrome = chromeHeight(request.viewport, request.chrome);
  const windowSize = { width: request.viewport.width, height: request.viewport.height - chrome };
  const duration = requestDuration(request);
  const workDir = await mkdtemp(path.join(os.tmpdir(), `launchclip-evidence-${request.id}-`));
  const browser = await launch(available);
  try {
    const { context, page, status, consent, title, hidden } = await openEvidencePage(browser, request, { viewport: windowSize, log });
    let measured, pageSize, html, finalUrl;
    try {
      const docHeight = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0));
      await freeze(page, Math.min(docHeight, MAX_PAGE_HEIGHT));
      measured = [];
      for (const beat of request.beats) {
        if (!beat.target) { measured.push({ ...beat, rects: [] }); continue; }
        const result = await measureTarget(page, beat.target, `beats[${beat.index}] (${beat.action})`);
        measured.push({ ...beat, rects: result.rects, text: result.text });
      }
      const lowest = Math.max(0, ...measured.flatMap((beat) => beat.rects.map((r) => r.y + r.height)));
      if (lowest > MAX_PAGE_HEIGHT) throw new Error(`a beat target sits ${Math.round(lowest)} px down the page; evidence capture reaches ${MAX_PAGE_HEIGHT} px. Link to an anchor nearer the target`);
      const fullHeight = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0));
      const height = Math.round(Math.min(MAX_PAGE_HEIGHT, fullHeight, Math.max(windowSize.height, lowest + windowSize.height * 1.2)));
      pageSize = { width: windowSize.width, height };
      html = await page.content();
      await page.screenshot({ path: path.join(workDir, "page.png"), clip: { x: 0, y: 0, width: pageSize.width, height }, fullPage: true, animations: "disabled", caret: "hide" });
      finalUrl = page.url();
    } finally {
      await context.close().catch(() => {});
    }
    const timeline = buildTimeline({ viewport: request.viewport, chrome, page: pageSize, beats: measured, duration });
    const poster = `${base}.poster.png`;
    log(`rendering ${request.id} (${duration} s)`);
    const clip = await renderClip(browser, { timeline, workDir, image: "page.png", url: finalUrl, theme: request.theme, out, poster, fps: request.fps, log });
    const fullpage = `${base}.fullpage.png`, snapshot = `${base}.snapshot.html`;
    await copyFile(path.join(workDir, "page.png"), fullpage);
    await writeFile(snapshot, html);
    const record = {
      schema: SIDECAR_SCHEMA,
      id: request.id,
      kind: request.kind,
      request_url: request.url,
      final_url: finalUrl,
      http_status: status,
      page_title: title,
      provenance: { ...request.provenance },
      captured_at: new Date().toISOString(),
      consent,
      hidden,
      video: rel(dir, out),
      poster: rel(dir, poster),
      fullpage: { path: rel(dir, fullpage), width: pageSize.width, height: pageSize.height, scale: SHOT_SCALE },
      snapshot: { path: rel(dir, snapshot), sha256: sha256(html), bytes: Buffer.byteLength(html) },
      viewport: request.viewport,
      chrome,
      fps: request.fps,
      duration: clip.duration,
      frames: clip.frames,
      spans: measured.filter((beat) => beat.action === "select" || beat.action === "highlight").map((beat) => ({ beat: beat.index, action: beat.action, text: beat.text, rects: beat.rects })),
      beats: timeline.effects.map((effect) => {
        const beat = measured.find((entry) => entry.index === effect.index);
        return { index: effect.index, action: effect.action, at: beat.at, dur: beat.dur, target: targetLabel(beat.target), ...(beat.label ? { label: beat.label } : {}), ...(beat.text ? { matched: beat.text } : {}), start: effect.start, end: effect.end, box: effect.box };
      })
    };
    const sidecar = `${base}.evidence.json`;
    await writeFile(sidecar, `${JSON.stringify(record, null, 2)}\n`);
    return { video: out, poster, sidecar, fullpage, snapshot, record };
  } finally {
    await browser.close().catch(() => {});
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * --still: one hi-res crop of a target (or the top of the page) for
 * rebuilding as a card. → {still, sidecar, record}. Writes <id>.still.png
 * and <id>.still.json (provenance, final URL, snapshot sha256, crop box).
 */
export async function captureStill(input, { root = process.cwd(), target = null, scale, pad, log = () => {}, availability = recorderAvailability } = {}) {
  const { errors, request } = validateCaptureRequest({ beats: [], ...input });
  if (errors.length) throw new Error(`capture request has errors:\n- ${errors.join("\n- ")}`);
  const available = await availability();
  if (!available.ok) throw new Error(`cannot capture: ${available.reasons.join("; ")}`);
  const want = target ?? request.still?.target ?? null;
  const k = scale ?? request.still?.scale ?? 3, margin = pad ?? request.still?.pad ?? 24;
  const dir = path.dirname(path.resolve(root, request.out));
  await mkdir(dir, { recursive: true });
  const base = path.join(dir, request.id);
  const browser = await launch(available);
  try {
    const viewport = { width: request.viewport.width, height: request.viewport.height };
    const { context, page, status, consent, title, hidden } = await openEvidencePage(browser, request, { viewport, scale: k, log });
    try {
      await freeze(page, viewport.height * 3);
      let box = { x: 0, y: 0, width: viewport.width, height: viewport.height }, matched = null;
      if (want) {
        const result = await measureTarget(page, want, "still target");
        const r = result.rects.reduce((a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), right: Math.max(a.right, b.x + b.width), bottom: Math.max(a.bottom, b.y + b.height) }), { x: Infinity, y: Infinity, right: -Infinity, bottom: -Infinity });
        const docWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        const x = Math.max(0, r.x - margin), y = Math.max(0, r.y - margin);
        box = { x, y, width: Math.min(docWidth, r.right + margin) - x, height: r.bottom + margin - y };
        matched = result.text;
      }
      const html = await page.content();
      const still = `${base}.still.png`;
      await page.screenshot({ path: still, clip: box, fullPage: true, animations: "disabled", caret: "hide" });
      const record = { schema: SIDECAR_SCHEMA, id: request.id, kind: request.kind, mode: "still", request_url: request.url, final_url: page.url(), http_status: status, page_title: title,
        provenance: { ...request.provenance }, captured_at: new Date().toISOString(), consent, hidden, still: { path: rel(dir, still), box, scale: k, pixels: { width: Math.round(box.width * k), height: Math.round(box.height * k) } },
        target: want ? targetLabel(want) : null, ...(matched ? { matched } : {}), snapshot: { sha256: sha256(html), bytes: Buffer.byteLength(html) } };
      const sidecar = `${base}.still.json`;
      await writeFile(sidecar, `${JSON.stringify(record, null, 2)}\n`);
      return { still, sidecar, record };
    } finally {
      await context.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

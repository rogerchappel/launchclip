// The skeleton library on disk and in the gates (docs/VIRAL_FORMATS_RFC.md).
// The skeletons and their checks live in kit/core/skeleton-library.mjs; this
// file reads the user's own (~/.launchclip/skeletons, then
// <project>/.launchclip/skeletons; later wins), runs the structure gate for
// finish and cinematic-check, and backs `launchclip skeletons list|show|choose`.
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TITLE_CARD_MODULES, chooseSkeleton, kitCapabilities, mergeSkeletons, skeletonById, skeletonFeasibility, skeletonProblems, skeletonStale, structureCheck } from "@launchclip/core/skeleton-library.mjs";
import { SCRIPT_SKELETONS } from "@launchclip/core/script-formats.mjs";
import { readProjectScript } from "./publish_manifest.js";
import { pinnedHome } from "./state_dirs.js";

/** Where skeletons are read from, in override order: the user's, then the project's. */
export function skeletonDirs({ project = null, home = os.homedir(), env = process.env } = {}) {
  const user = pinnedHome("skeletons") ?? (env.LAUNCHCLIP_HOME ? path.join(env.LAUNCHCLIP_HOME, "skeletons") : path.join(home, ".launchclip", "skeletons"));
  return [user, ...(project ? [path.join(project, ".launchclip", "skeletons")] : [])];
}

/** The library: the starters plus every readable *.json in the skeleton dirs. → {skeletons, problems} */
export function loadSkeletonLibrary(options = {}) {
  const extra = [];
  const problems = [];
  for (const dir of skeletonDirs(options)) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter((file) => file.endsWith(".json")).sort()) {
      const file = path.join(dir, name);
      try { extra.push({ skeleton: JSON.parse(readFileSync(file, "utf8")), source: file }); } catch (error) { problems.push(`${file}: ${error.message}`); }
    }
  }
  const merged = mergeSkeletons(extra);
  return { skeletons: merged.skeletons, problems: [...problems, ...merged.problems] };
}

/**
 * The structure gate for a finished story: the short-video rules for any
 * video of 90 s or less, plus the key shot when story.skeleton names a
 * library skeleton. Beats come from STORY.json (the agent path) or SCRIPT.json
 * (make), titles from SCRIPT.json or SCRIPT.md's Titles section. prototype: only the opening is judged.
 * → {status: "passed" | "failed" | "skipped", skeleton?, checks, findings, reason?}
 */
export async function structureGate({ project, story, words = [], prototype = false, duration = null, video = null, pixels = openingPixels }) {
  const id = story?.skeleton?.id;
  const skeleton = id ? skeletonById(id, loadSkeletonLibrary({ project }).skeletons) : null;
  if (id && !skeleton) return { status: "failed", checks: {}, findings: [`skeleton ${id} is not in the skeleton library (launchclip skeletons list)`] };
  const storyReceipt = await readJson(path.join(project, "STORY.json"));
  // SCRIPT.json (make) or SCRIPT.md's Titles section (the agent path): the packaging check runs on both.
  const script = await readProjectScript(project);
  const beats = Array.isArray(storyReceipt?.beats) ? storyReceipt.beats : scriptBeats(script, skeleton);
  const titles = Array.isArray(script?.title_options) ? script.title_options : undefined;
  // A story receipt's author assigns the roles, so it must carry the share beat; make's script marks it only on a library skeleton.
  const check = structureCheck(story, skeleton, { words, beats, titles, duration, requireShare: Array.isArray(storyReceipt?.beats) });
  // The opening, in pixels: the storyboard can say an image opens the video while its first frame is empty.
  if (check.checks.first_frame && video && existsSync(video)) {
    const opening = await pixels(video);
    check.checks.opening_pixels = { ok: opening.ok, detail: opening.detail };
    if (!opening.ok) { check.findings.push(`opening_pixels: ${opening.detail}`); check.status = "failed"; }
  }
  if (prototype && check.status !== "skipped") {
    const first = check.checks.first_frame;
    if (!first) return { status: "skipped", reason: "prototype: the opening is a recording", checks: {}, findings: [] };
    const opening = check.checks.opening_pixels;
    const kept = { first_frame: first, ...(opening ? { opening_pixels: opening } : {}) };
    const findings = Object.entries(kept).filter(([, entry]) => !entry.ok).map(([name, entry]) => `${name}: ${entry.detail}`);
    return { status: findings.length ? "failed" : "passed", ...(check.skeleton ? { skeleton: check.skeleton } : {}), scope: "prototype: the opening only", checks: kept, findings };
  }
  return check;
}

const execFileAsync = promisify(execFile);
// Frame 0 must carry at least this share of the content the frame at
// OPENING_SETTLED_SECONDS does (the spread of its luma, at 72×128): an
// opening that fades up from an empty background fails.
export const OPENING_CONTENT_SHARE = 0.5;
export const OPENING_SETTLED_SECONDS = 1;

/** The spread (standard deviation) of a frame's luma, 0-255, at 72×128. */
export async function frameContent(video, at) {
  const { stdout } = await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(at), "-i", video, "-frames:v", "1", "-vf", "scale=72:128,format=gray", "-f", "rawvideo", "-"], { encoding: "buffer", maxBuffer: 1 << 20 });
  const values = [...stdout];
  if (!values.length) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

/**
 * The rendered opening, measured: frame 0 against the frame a second in.
 * → {ok, detail, frame0, settled}
 */
export async function openingPixels(video, { measure = frameContent } = {}) {
  let frame0, settled;
  try { [frame0, settled] = await Promise.all([measure(video, 0), measure(video, OPENING_SETTLED_SECONDS)]); } catch { return { ok: true, detail: "the render could not be measured" }; }
  if (!Number.isFinite(frame0) || !Number.isFinite(settled)) return { ok: true, detail: "the render could not be measured", frame0, settled };
  const ok = settled <= 0 || frame0 >= settled * OPENING_CONTENT_SHARE;
  return { ok, frame0: Math.round(frame0 * 10) / 10, settled: Math.round(settled * 10) / 10, detail: `frame 0 carries ${Math.round(frame0 / Math.max(settled, 1e-9) * 100)}% of the content at ${OPENING_SETTLED_SECONDS} s${ok ? "" : `: it fades up from an empty background (the opening image must be drawn on frame 0)`}` };
}

/** SCRIPT.json's beats as story beats {role, spoken}: the beat's own role, else the skeleton's role for its id. */
export function scriptBeats(script, skeleton = null) {
  if (!Array.isArray(script?.beats)) return [];
  return script.beats.map((entry) => ({ role: entry.role ?? skeleton?.beats.find((item) => item.id === entry.beat)?.role ?? entry.beat, spoken: entry.text ?? entry.spoken ?? "" }));
}

/** `launchclip skeletons list|show|choose`. */
export async function runSkeletonsCommand(action, target, flags = {}, { project = process.cwd() } = {}) {
  const { skeletons, problems } = loadSkeletonLibrary({ project });
  const kit = kitCapabilities();
  if (!action || action === "list") {
    const wanted = skeletons.filter((skeleton) => (!flags.medium || skeleton.media.includes(String(flags.medium))) && (!flags.fits || (skeleton.fits ?? []).some((pattern) => new RegExp(pattern, "i").test(String(flags.fits)))));
    return {
      action: "list",
      skeletons: wanted.map((skeleton) => {
        const feasible = skeletonFeasibility(skeleton, kit);
        return { id: skeleton.id, title: skeleton.title, family: skeleton.family, media: skeleton.media, aspects: skeleton.aspects, duration: skeleton.duration, share: skeleton.share.kind, voice: skeleton.voice.tier, status: feasible.ok ? "ready" : "blocked", ...(feasible.ok ? {} : { missing: feasible.missing }), ...(skeletonStale(skeleton) ? { stale: `version ${skeleton.version} is due for review` } : {}), source: skeleton.source };
      }),
      script_skeletons: Object.keys(SCRIPT_SKELETONS),
      problems
    };
  }
  if (action === "show") {
    if (!target) throw new Error("usage: launchclip skeletons show <id>");
    const skeleton = skeletonById(target, skeletons);
    if (!skeleton) {
      if (SCRIPT_SKELETONS[target]) return { action: "show", skeleton: SCRIPT_SKELETONS[target], kind: "script-format skeleton" };
      throw new Error(`unknown skeleton ${target}; run launchclip skeletons list`);
    }
    const feasible = skeletonFeasibility(skeleton, kit);
    return { action: "show", skeleton, kind: "library skeleton", status: feasible.ok ? "ready" : "blocked", missing: feasible.missing, problems: skeletonProblems(skeleton), stale: skeletonStale(skeleton), title_cards: TITLE_CARD_MODULES };
  }
  if (action === "choose") {
    const result = chooseSkeleton({ prompt: target ?? "", duration: Number(flags.duration ?? 30), aspect: flags.aspect ?? "9:16", medium: flags.medium ?? "motion", requested: flags.skeleton ?? "auto", skeletons, kit });
    return { action: "choose", skeleton: result.skeleton?.id ?? null, reasons: result.reasons, candidates: result.candidates, blocked: result.blocked };
  }
  throw new Error(`unknown skeletons action ${action}; use list, show or choose`);
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
}

#!/usr/bin/env node
// Build the phase-2 temporal evidence for `launchclip cinematic-check`: one
// browser still and one encoded-draft frame per scheduled sample, hashed into
// qa/temporal-evidence/manifest.json, plus paired contact sheets for the
// fresh-context critic.
// Usage: node build-evidence.mjs <project> [--renderer hyperframes|remotion] [--video renders/draft.mp4] [--entry <remotion-entry>] [--no-sheets]
// The renderer defaults to remotion when the project has storyboard.json and no
// index.html, otherwise hyperframes.
// HyperFrames stills: set HYPERFRAMES_BIN to a local hyperframes binary; otherwise npx is used.
// Remotion stills: set REMOTION_BIN to a local remotion binary; otherwise npx is used.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildTemporalEvidenceSchedule, parseDeclaredSequenceBoundaries } from '../cinematic_evidence.js';
import { hyperframesEnv } from '../renderers/hyperframes_env.js';
import { remotionRoot } from '../renderers/remotion_segments.js';

const HYPERFRAMES_VERSION = '0.7.58';
const REMOTION_VERSION = '4.0.536';
const COMPOSITION_ID = 'LaunchclipStory';
const BROWSER_SOURCE = 'browser-still';
const HERE = path.dirname(fileURLToPath(import.meta.url));
// The package root: two folders up from src/scripts/ (three from a skill's
// scripts/ copy, which scripts/sync-skills.mjs rewrites).
const ROOT = path.resolve(HERE, '../..');
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const hasExactFile = (dir, name) => existsSync(dir) && readdirSync(dir).includes(name);

// commands: optional {hyperframes, remotion} argv prefixes (e.g. [node, cli.js])
// that replace the HYPERFRAMES_BIN / REMOTION_BIN / npx lookup.
let COMMANDS = {};

function hyperframes(args) {
  const options = { stdio: 'ignore', env: hyperframesEnv() };
  if (COMMANDS.hyperframes) return execFileSync(COMMANDS.hyperframes[0], [...COMMANDS.hyperframes.slice(1), ...args], options);
  const bin = process.env.HYPERFRAMES_BIN;
  if (bin) return execFileSync(bin, args, options);
  return execFileSync('npx', ['--yes', `hyperframes@${HYPERFRAMES_VERSION}`, ...args], options);
}

// options: execFileSync options, e.g. {cwd} for a bundle.
function remotion(args, options = {}) {
  const run = (command, argv) => execFileSync(command, argv, { stdio: 'ignore', ...options });
  if (COMMANDS.remotion) return run(COMMANDS.remotion[0], [...COMMANDS.remotion.slice(1), ...args]);
  const bin = process.env.REMOTION_BIN;
  if (bin) return run(bin, args);
  return run('npx', ['--yes', `@remotion/cli@${REMOTION_VERSION}`, ...args]);
}

function attr(html, name) {
  return html.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1];
}

export function detectRenderer(project) {
  return hasExactFile(project, 'storyboard.json') && !hasExactFile(project, 'index.html') ? 'remotion' : 'hyperframes';
}

export function evidenceSchedule(html) {
  const duration = Number(attr(html, 'data-duration'));
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('index.html root has no valid data-duration');
  const parsed = parseDeclaredSequenceBoundaries(html, duration);
  if (!parsed.ok) throw new Error(`invalid declared boundaries: ${parsed.errors.join('; ')}`);
  return buildTemporalEvidenceSchedule(duration, parsed.boundaries);
}

// The story module is a copy of kit/core/story.mjs next to this script when the
// skill ships standalone, else @launchclip/core's story.mjs.
export async function loadStoryModule(source) {
  if (source && typeof source === 'object') return source;
  const candidates = source ? [path.resolve(source)] : [path.join(HERE, 'story.mjs'), coreFile('@launchclip/core/story.mjs')].filter(Boolean);
  const file = candidates.find((candidate) => existsSync(candidate));
  if (!file) throw new Error(`storyboard.json support needs story.mjs (looked in ${candidates.join(', ')})`);
  return import(pathToFileURL(file).href);
}

function coreFile(specifier) {
  try {
    return fileURLToPath(import.meta.resolve(specifier));
  } catch {
    return null;
  }
}

function readOptionalJson(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

// Resolves storyboard.json against NARRATION.json and BEATS.json.
export async function resolveProjectStory(project, { storyModule } = {}) {
  const module = await loadStoryModule(storyModule);
  const story = JSON.parse(readFileSync(path.join(project, 'storyboard.json'), 'utf8'));
  const words = readOptionalJson(path.join(project, 'NARRATION.json'))?.words ?? [];
  const resolved = module.resolveStory(story, { words, beats: readOptionalJson(path.join(project, 'BEATS.json')) });
  return { module, story, resolved, format: module.storyFormat(resolved) };
}

// storyboard.json wins over index.html, matching declaredBoundariesForProject() in src/cinematic_evidence.js.
// story: an already resolved story to use instead of the project's storyboard.json.
export async function projectEvidenceSchedule(projectPath, { storyModule, story: injected } = {}) {
  const project = path.resolve(projectPath);
  if (injected) {
    const module = await loadStoryModule(storyModule);
    const format = module.storyFormat(injected);
    return { schedule: buildTemporalEvidenceSchedule(format.duration, module.deriveBoundaries(injected)), story: { module, story: injected, resolved: injected, format } };
  }
  if (!hasExactFile(project, 'storyboard.json')) return { schedule: evidenceSchedule(readFileSync(path.join(project, 'index.html'), 'utf8')), story: null };
  const story = await resolveProjectStory(project, { storyModule });
  const boundaries = story.module.deriveBoundaries(story.resolved);
  return { schedule: buildTemporalEvidenceSchedule(story.format.duration, boundaries), story };
}

// Every sample is one frame index, shared by the browser still and the
// encoded-draft frame, so the pair always shows the same frame. Blind test 2:
// the encoded frame came from `ffmpeg -ss t`, which returns the first frame at
// or after t (ceil(t × fps)), while Remotion stills took round(t × fps) and
// HyperFrames snapshots floor(t × fps), so at transition midpoints the draft
// ran a frame ahead of the stills (more on a whip-pan's fastest frames).

/** The frame index of a sample at t seconds: round(t × fps), clamped to the last frame. */
export function evidenceFrame(t, fps, duration) {
  const last = Number.isFinite(duration) && duration > 0 ? Math.max(0, Math.round(duration * fps) - 1) : Infinity;
  return Math.max(0, Math.min(last, Math.round(t * fps + 1e-9)));
}

/** `hyperframes snapshot --at` time that lands on frame N (snapshot floors seconds × fps). */
export function snapshotTime(frame, fps) {
  return Math.round(((frame + 0.25) / fps) * 1e6) / 1e6;
}

/** ffmpeg args that decode frame N exactly (by frame number, never by seeking). */
export function encodedFrameArgs(draft, frame, output) {
  return ['-hide_banner', '-loglevel', 'error', '-i', draft, '-vf', `select=eq(n\\,${frame})`, '-vsync', '0', '-frames:v', '1', '-y', output];
}

function draftFps(draft) {
  try {
    const rate = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', draft], { encoding: 'utf8' }).trim();
    const [num, den = 1] = rate.split('/').map(Number);
    if (num > 0 && den > 0) return num / den;
  } catch { /* fall through */ }
  return 30;
}

function hyperframesStills(project, schedule, out, frames) {
  const snapshots = path.join(project, 'snapshots');
  rmSync(snapshots, { recursive: true, force: true });
  hyperframes(['snapshot', project, '--at', schedule.timestamps.map((t) => snapshotTime(frames.of(t), frames.fps)).join(',')]);
  // Snapshot files are numbered in request order; HyperFrames may append extras after them.
  const files = readdirSync(snapshots).filter((file) => /^frame-\d+/.test(file)).sort();
  if (files.length < schedule.timestamps.length) throw new Error(`expected ${schedule.timestamps.length} snapshots, got ${files.length}`);
  for (const sample of schedule.entries) {
    copyFileSync(path.join(snapshots, files[schedule.timestamps.indexOf(sample.at_seconds)]), path.join(out, `${sample.evidence_id}-${BROWSER_SOURCE}.png`));
  }
}

// serveUrl is either an entry file (bundled per call, with the project as the
// public dir) or a directory made by `remotion bundle`.
export function remotionStillArgs({ serveUrl, propsFile, project, frame, output, bundled = false, browser = process.env.LAUNCHCLIP_REMOTION_BROWSER?.trim() || null }) {
  // LAUNCHCLIP_REMOTION_BROWSER: the Chrome the render used (src/renderers/remotion_segments.js).
  return ['still', serveUrl, COMPOSITION_ID, output, '--props', propsFile, ...(bundled ? [] : ['--public-dir', project]), `--frame=${frame}`, '--overwrite', '--log', 'warn', ...(browser ? ['--browser-executable', browser] : [])];
}

function remotionEntry(project, entry) {
  const candidates = entry ? [path.resolve(entry)] : [process.env.REMOTION_ENTRY, path.join(project, 'remotion/entry.tsx'), path.join(ROOT, 'kit/remotion/entry.tsx')].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`Remotion entry not found (looked in ${candidates.join(', ')}); pass --entry`);
  return found;
}

function remotionStills(project, schedule, out, story, entry, frames) {
  const propsFile = path.join(project, '.launchclip/story.resolved.json');
  mkdirSync(path.dirname(propsFile), { recursive: true });
  writeFileSync(propsFile, `${JSON.stringify(story.resolved, null, 2)}\n`);
  // Bundle once outside the project (the project is the public dir), then take every still from the bundle.
  const bundle = mkdtempSync(path.join(os.tmpdir(), 'launchclip-remotion-bundle-'));
  try {
    // From the project's own Remotion root (src/renderers/remotion_segments.js remotionRoot), so the bundle never clears another project's webpack cache.
    remotion(['bundle', remotionEntry(project, entry), '--public-dir', project, '--out-dir', bundle, '--log', 'warn'], { cwd: remotionRoot(project) });
    const byTime = new Map();
    for (const at of schedule.timestamps) {
      const output = path.join(out, `.still-${String(byTime.size).padStart(3, '0')}.png`);
      remotion(remotionStillArgs({ serveUrl: bundle, bundled: true, propsFile, project, frame: frames.of(at), output }));
      byTime.set(at, output);
    }
    for (const sample of schedule.entries) copyFileSync(byTime.get(sample.at_seconds), path.join(out, `${sample.evidence_id}-${BROWSER_SOURCE}.png`));
    for (const file of byTime.values()) rmSync(file, { force: true });
  } finally {
    rmSync(bundle, { recursive: true, force: true });
  }
}

// Options for embedding (launchclip finish): story (a resolved story instead of
// storyboard.json), stillsProject (the compiled HyperFrames project to snapshot,
// default the project) and commands ({hyperframes, remotion} argv prefixes).
export async function buildEvidence(projectPath, { video = 'renders/draft.mp4', sheets = true, renderer, entry, storyModule, story: injected, stillsProject, commands = {} } = {}) {
  const project = path.resolve(projectPath);
  const draft = path.resolve(project, video);
  if (!existsSync(draft)) throw new Error(`draft video not found: ${draft}`);
  const engine = renderer ?? detectRenderer(project);
  if (!['hyperframes', 'remotion'].includes(engine)) throw new Error(`unknown renderer: ${engine}`);
  COMMANDS = commands ?? {};
  const { schedule, story } = await projectEvidenceSchedule(project, { storyModule, story: injected });
  const out = path.join(project, 'qa/temporal-evidence');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const fps = Number(story?.format?.fps) > 0 ? Number(story.format.fps) : draftFps(draft);
  const duration = Number(story?.format?.duration);
  const frames = { fps, of: (t) => evidenceFrame(t, fps, duration) };
  if (engine === 'remotion') {
    if (!story) throw new Error('the remotion renderer needs storyboard.json');
    remotionStills(project, schedule, out, story, entry, frames);
  } else {
    hyperframesStills(path.resolve(stillsProject ?? project), schedule, out, frames);
  }
  const entries = [];
  for (const sample of schedule.entries) {
    const browser = path.join(out, `${sample.evidence_id}-${BROWSER_SOURCE}.png`);
    const encoded = path.join(out, `${sample.evidence_id}-encoded-draft.png`);
    const frame = frames.of(sample.at_seconds);
    execFileSync('ffmpeg', encodedFrameArgs(draft, frame, encoded));
    if (!existsSync(encoded)) throw new Error(`ffmpeg wrote no frame ${frame} from ${draft}`);
    for (const [source, file] of [[BROWSER_SOURCE, browser], ['encoded-draft', encoded]]) {
      entries.push({ sample_id: sample.evidence_id, evidence_id: `${sample.evidence_id}-${source}`, source, role: sample.role, at_seconds: sample.at_seconds, frame, sequence_id: sample.sequence_id, boundary_id: sample.boundary_id, file: path.relative(project, file), sha256: sha(file) });
    }
  }
  writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify({ schema_version: 'launchclip.subscription-temporal-evidence.v1', renderer: engine, video_sha256: sha(draft), entries }, null, 2)}\n`);
  const sheetFiles = sheets ? writeCriticSheets(project, schedule, draft, engine, frameSize(story, draft)) : [];
  return { renderer: engine, samples: schedule.entries.length, artifacts: entries.length, sheets: sheetFiles };
}

// The frame size for the contact sheets: the story's format, else the draft's
// first video stream, else portrait 1080x1920.
function frameSize(story, draft) {
  const width = Number(story?.format?.width);
  const height = Number(story?.format?.height);
  if (width > 0 && height > 0) return { width, height };
  try {
    const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', draft], { encoding: 'utf8' }).trim().split('x').map(Number);
    if (w > 0 && h > 0) return { width: w, height: h };
  } catch { /* fall through */ }
  return { width: 1080, height: 1920 };
}

/**
 * Aspect-aware contact-sheet geometry. Tiles keep the frame's aspect (the long
 * side is 480 px), four tiles per row (two browser/encoded pairs), so a 16:9
 * cut gets 480x270 tiles in a 1920 px wide sheet and a 9:16 cut 270x480 tiles.
 * The overview grid is 5x4 for portrait and 4x5 for landscape or square.
 * -> {tile: {width, height}, columns, overview: {columns, rows}, orientation}
 */
export function contactSheetLayout({ width, height } = {}) {
  const w = Number(width) > 0 ? Number(width) : 1080;
  const h = Number(height) > 0 ? Number(height) : 1920;
  const even = (value) => Math.max(2, Math.round(value / 2) * 2);
  const long = 480;
  const tile = h >= w ? { width: even(long * w / h), height: long } : { width: long, height: even(long * h / w) };
  const orientation = h > w ? 'portrait' : w > h ? 'landscape' : 'square';
  return { tile, columns: 4, overview: orientation === 'portrait' ? { columns: 5, rows: 4 } : { columns: 4, rows: 5 }, orientation };
}

// Each sheet pairs browser (left) and encoded (right) tiles, six samples per sheet in schedule order.
function writeCriticSheets(project, schedule, draft, engine, size) {
  const { tile, columns, overview, orientation } = contactSheetLayout(size);
  const dir = path.join(project, 'qa/critic-sheets');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const ids = [...schedule.entries].sort((a, b) => a.at_seconds - b.at_seconds).map((entry) => entry.evidence_id);
  const written = [];
  const index = [];
  for (let i = 0; i < ids.length; i += 6) {
    const group = ids.slice(i, i + 6);
    const inputs = group.flatMap((id) => ['-i', path.join(project, 'qa/temporal-evidence', `${id}-${BROWSER_SOURCE}.png`), '-i', path.join(project, 'qa/temporal-evidence', `${id}-encoded-draft.png`)]);
    const n = group.length * 2;
    const scaled = Array.from({ length: n }, (_, j) => `[${j}]scale=${tile.width}:${tile.height}[s${j}]`).join(';');
    const layout = Array.from({ length: n }, (_, j) => `${(j % columns) * tile.width}_${Math.floor(j / columns) * tile.height}`).join('|');
    const name = `sheet-${String(i / 6 + 1).padStart(2, '0')}.jpg`;
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', `${scaled};${Array.from({ length: n }, (_, j) => `[s${j}]`).join('')}xstack=inputs=${n}:layout=${layout}`, path.join(dir, name)]);
    written.push(name);
    index.push({ sheet: name, samples: group });
  }
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', draft, '-vf', `fps=2/3,scale=${tile.width}:${tile.height},tile=${overview.columns}x${overview.rows}`, '-frames:v', '1', path.join(dir, 'overview-every-1.5s.jpg')]);
  writeFileSync(path.join(dir, 'index.json'), `${JSON.stringify({ tiles: `each sample is a pair: left = ${engine} browser still, right = encoded draft; ${columns} tiles per row`, tile: { ...tile, orientation }, sheets: index }, null, 2)}\n`);
  return [...written, 'overview-every-1.5s.jpg', 'index.json'];
}

const VALUE_FLAGS = new Set(['--video', '--renderer', '--entry']);

async function main(argv) {
  const project = argv.find((arg, index) => !arg.startsWith('--') && !VALUE_FLAGS.has(argv[index - 1]));
  if (!project) throw new Error('usage: build-evidence.mjs <project> [--renderer hyperframes|remotion] [--video renders/draft.mp4] [--entry <remotion-entry>] [--no-sheets]');
  const value = (flag) => (argv.indexOf(flag) >= 0 ? argv[argv.indexOf(flag) + 1] : undefined);
  console.log(JSON.stringify(await buildEvidence(project, { video: value('--video') ?? 'renders/draft.mp4', renderer: value('--renderer'), entry: value('--entry'), sheets: !argv.includes('--no-sheets') })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exit(1); });

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
import { buildTemporalEvidenceSchedule, parseDeclaredSequenceBoundaries } from '../../../src/cinematic_evidence.js';

const HYPERFRAMES_VERSION = '0.7.58';
const REMOTION_VERSION = '4.0.536';
const COMPOSITION_ID = 'LaunchclipStory';
const BROWSER_SOURCE = 'browser-still';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const hasExactFile = (dir, name) => existsSync(dir) && readdirSync(dir).includes(name);

// commands: optional {hyperframes, remotion} argv prefixes (e.g. [node, cli.js])
// that replace the HYPERFRAMES_BIN / REMOTION_BIN / npx lookup.
let COMMANDS = {};

function hyperframes(args) {
  if (COMMANDS.hyperframes) return execFileSync(COMMANDS.hyperframes[0], [...COMMANDS.hyperframes.slice(1), ...args], { stdio: 'ignore' });
  const bin = process.env.HYPERFRAMES_BIN;
  if (bin) return execFileSync(bin, args, { stdio: 'ignore' });
  return execFileSync('npx', ['--yes', `hyperframes@${HYPERFRAMES_VERSION}`, ...args], { stdio: 'ignore' });
}

function remotion(args) {
  if (COMMANDS.remotion) return execFileSync(COMMANDS.remotion[0], [...COMMANDS.remotion.slice(1), ...args], { stdio: 'ignore' });
  const bin = process.env.REMOTION_BIN;
  if (bin) return execFileSync(bin, args, { stdio: 'ignore' });
  return execFileSync('npx', ['--yes', `@remotion/cli@${REMOTION_VERSION}`, ...args], { stdio: 'ignore' });
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
// skill ships standalone, else the repo's canonical kit/core/story.mjs.
export async function loadStoryModule(source) {
  if (source && typeof source === 'object') return source;
  const candidates = source ? [path.resolve(source)] : [path.join(HERE, 'story.mjs'), path.resolve(HERE, '../../../kit/core/story.mjs')];
  const file = candidates.find((candidate) => existsSync(candidate));
  if (!file) throw new Error(`storyboard.json support needs story.mjs (looked in ${candidates.join(', ')})`);
  return import(pathToFileURL(file).href);
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

function hyperframesStills(project, schedule, out) {
  const snapshots = path.join(project, 'snapshots');
  rmSync(snapshots, { recursive: true, force: true });
  // snapshot floors seconds × fps; nudge each time well under a frame.
  hyperframes(['snapshot', project, '--at', schedule.timestamps.map(t => Math.round((t + 1e-4) * 1e6) / 1e6).join(',')]);
  // Snapshot files are numbered in request order; HyperFrames may append extras after them.
  const frames = readdirSync(snapshots).filter((file) => /^frame-\d+/.test(file)).sort();
  if (frames.length < schedule.timestamps.length) throw new Error(`expected ${schedule.timestamps.length} snapshots, got ${frames.length}`);
  for (const sample of schedule.entries) {
    copyFileSync(path.join(snapshots, frames[schedule.timestamps.indexOf(sample.at_seconds)]), path.join(out, `${sample.evidence_id}-${BROWSER_SOURCE}.png`));
  }
}

// serveUrl is either an entry file (bundled per call, with the project as the
// public dir) or a directory made by `remotion bundle`.
export function remotionStillArgs({ serveUrl, propsFile, project, frame, output, bundled = false }) {
  return ['still', serveUrl, COMPOSITION_ID, output, '--props', propsFile, ...(bundled ? [] : ['--public-dir', project]), `--frame=${frame}`, '--overwrite', '--log', 'warn'];
}

function remotionEntry(project, entry) {
  const candidates = entry ? [path.resolve(entry)] : [process.env.REMOTION_ENTRY, path.join(project, 'remotion/entry.tsx'), path.resolve(HERE, '../../../kit/remotion/entry.tsx')].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`Remotion entry not found (looked in ${candidates.join(', ')}); pass --entry`);
  return found;
}

function remotionStills(project, schedule, out, story, entry) {
  const propsFile = path.join(project, '.launchclip/story.resolved.json');
  mkdirSync(path.dirname(propsFile), { recursive: true });
  writeFileSync(propsFile, `${JSON.stringify(story.resolved, null, 2)}\n`);
  const { fps, duration } = story.format;
  const lastFrame = Math.max(0, Math.round(duration * fps) - 1);
  // Bundle once outside the project (the project is the public dir), then take every still from the bundle.
  const bundle = mkdtempSync(path.join(os.tmpdir(), 'launchclip-remotion-bundle-'));
  try {
    remotion(['bundle', remotionEntry(project, entry), '--public-dir', project, '--out-dir', bundle, '--log', 'warn']);
    const byTime = new Map();
    for (const at of schedule.timestamps) {
      const output = path.join(out, `.still-${String(byTime.size).padStart(3, '0')}.png`);
      remotion(remotionStillArgs({ serveUrl: bundle, bundled: true, propsFile, project, frame: Math.min(lastFrame, Math.round(at * fps)), output }));
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
  if (engine === 'remotion') {
    if (!story) throw new Error('the remotion renderer needs storyboard.json');
    remotionStills(project, schedule, out, story, entry);
  } else {
    hyperframesStills(path.resolve(stillsProject ?? project), schedule, out);
  }
  const entries = [];
  for (const sample of schedule.entries) {
    const browser = path.join(out, `${sample.evidence_id}-${BROWSER_SOURCE}.png`);
    const encoded = path.join(out, `${sample.evidence_id}-encoded-draft.png`);
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(sample.at_seconds), '-i', draft, '-frames:v', '1', '-y', encoded]);
    for (const [source, file] of [[BROWSER_SOURCE, browser], ['encoded-draft', encoded]]) {
      entries.push({ sample_id: sample.evidence_id, evidence_id: `${sample.evidence_id}-${source}`, source, role: sample.role, at_seconds: sample.at_seconds, sequence_id: sample.sequence_id, boundary_id: sample.boundary_id, file: path.relative(project, file), sha256: sha(file) });
    }
  }
  writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify({ schema_version: 'launchclip.subscription-temporal-evidence.v1', renderer: engine, video_sha256: sha(draft), entries }, null, 2)}\n`);
  const sheetFiles = sheets ? writeCriticSheets(project, schedule, draft, engine) : [];
  return { renderer: engine, samples: schedule.entries.length, artifacts: entries.length, sheets: sheetFiles };
}

// Each sheet pairs browser (left) and encoded (right) tiles, six samples per sheet in schedule order.
function writeCriticSheets(project, schedule, draft, engine) {
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
    const scaled = Array.from({ length: n }, (_, j) => `[${j}]scale=270:480[s${j}]`).join(';');
    const layout = Array.from({ length: n }, (_, j) => `${(j % 4) * 270}_${Math.floor(j / 4) * 480}`).join('|');
    const name = `sheet-${String(i / 6 + 1).padStart(2, '0')}.jpg`;
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', `${scaled};${Array.from({ length: n }, (_, j) => `[s${j}]`).join('')}xstack=inputs=${n}:layout=${layout}`, path.join(dir, name)]);
    written.push(name);
    index.push({ sheet: name, samples: group });
  }
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', draft, '-vf', 'fps=2/3,scale=270:480,tile=5x4', '-frames:v', '1', path.join(dir, 'overview-every-1.5s.jpg')]);
  writeFileSync(path.join(dir, 'index.json'), `${JSON.stringify({ tiles: `each sample is a pair: left = ${engine} browser still, right = encoded draft; 4 tiles per row`, sheets: index }, null, 2)}\n`);
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

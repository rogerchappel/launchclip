#!/usr/bin/env node
// Build the phase-2 temporal evidence for `launchclip cinematic-check`: one
// HyperFrames snapshot and one encoded-draft frame per scheduled sample, hashed
// into qa/temporal-evidence/manifest.json, plus paired contact sheets for the
// fresh-context critic.
// Usage: node build-evidence.mjs <project> [--video renders/draft.mp4] [--no-sheets]
// Set HYPERFRAMES_BIN to a local hyperframes binary; otherwise npx is used.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTemporalEvidenceSchedule, parseDeclaredSequenceBoundaries } from '../../../src/cinematic_evidence.js';

const HYPERFRAMES_VERSION = '0.7.58';
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

function hyperframes(args) {
  const bin = process.env.HYPERFRAMES_BIN;
  if (bin) return execFileSync(bin, args, { stdio: 'ignore' });
  return execFileSync('npx', ['--yes', `hyperframes@${HYPERFRAMES_VERSION}`, ...args], { stdio: 'ignore' });
}

function attr(html, name) {
  return html.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1];
}

export function evidenceSchedule(html) {
  const duration = Number(attr(html, 'data-duration'));
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('index.html root has no valid data-duration');
  const parsed = parseDeclaredSequenceBoundaries(html, duration);
  if (!parsed.ok) throw new Error(`invalid declared boundaries: ${parsed.errors.join('; ')}`);
  return buildTemporalEvidenceSchedule(duration, parsed.boundaries);
}

export function buildEvidence(projectPath, { video = 'renders/draft.mp4', sheets = true } = {}) {
  const project = path.resolve(projectPath);
  const draft = path.resolve(project, video);
  if (!existsSync(draft)) throw new Error(`draft video not found: ${draft}`);
  const schedule = evidenceSchedule(readFileSync(path.join(project, 'index.html'), 'utf8'));
  const out = path.join(project, 'qa/temporal-evidence');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const snapshots = path.join(project, 'snapshots');
  rmSync(snapshots, { recursive: true, force: true });
  hyperframes(['snapshot', project, '--at', schedule.timestamps.join(',')]);
  // Snapshot files are numbered in request order; HyperFrames may append extras after them.
  const frames = readdirSync(snapshots).filter((file) => /^frame-\d+/.test(file)).sort();
  if (frames.length < schedule.timestamps.length) throw new Error(`expected ${schedule.timestamps.length} snapshots, got ${frames.length}`);
  const entries = [];
  for (const sample of schedule.entries) {
    const browser = path.join(out, `${sample.evidence_id}-hyperframes.png`);
    copyFileSync(path.join(snapshots, frames[schedule.timestamps.indexOf(sample.at_seconds)]), browser);
    const encoded = path.join(out, `${sample.evidence_id}-encoded-draft.png`);
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(sample.at_seconds), '-i', draft, '-frames:v', '1', '-y', encoded]);
    for (const [source, file] of [['hyperframes', browser], ['encoded-draft', encoded]]) {
      entries.push({ sample_id: sample.evidence_id, evidence_id: `${sample.evidence_id}-${source}`, source, role: sample.role, at_seconds: sample.at_seconds, sequence_id: sample.sequence_id, boundary_id: sample.boundary_id, file: path.relative(project, file), sha256: sha(file) });
    }
  }
  writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify({ schema_version: 'launchclip.subscription-temporal-evidence.v1', video_sha256: sha(draft), entries }, null, 2)}\n`);
  const sheetFiles = sheets ? writeCriticSheets(project, schedule, draft) : [];
  return { samples: schedule.entries.length, artifacts: entries.length, sheets: sheetFiles };
}

// Each sheet pairs browser (left) and encoded (right) tiles, six samples per sheet in schedule order.
function writeCriticSheets(project, schedule, draft) {
  const dir = path.join(project, 'qa/critic-sheets');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const ids = [...schedule.entries].sort((a, b) => a.at_seconds - b.at_seconds).map((entry) => entry.evidence_id);
  const written = [];
  const index = [];
  for (let i = 0; i < ids.length; i += 6) {
    const group = ids.slice(i, i + 6);
    const inputs = group.flatMap((id) => ['-i', path.join(project, 'qa/temporal-evidence', `${id}-hyperframes.png`), '-i', path.join(project, 'qa/temporal-evidence', `${id}-encoded-draft.png`)]);
    const n = group.length * 2;
    const scaled = Array.from({ length: n }, (_, j) => `[${j}]scale=270:480[s${j}]`).join(';');
    const layout = Array.from({ length: n }, (_, j) => `${(j % 4) * 270}_${Math.floor(j / 4) * 480}`).join('|');
    const name = `sheet-${String(i / 6 + 1).padStart(2, '0')}.jpg`;
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', `${scaled};${Array.from({ length: n }, (_, j) => `[s${j}]`).join('')}xstack=inputs=${n}:layout=${layout}`, path.join(dir, name)]);
    written.push(name);
    index.push({ sheet: name, samples: group });
  }
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', draft, '-vf', 'fps=2/3,scale=270:480,tile=5x4', '-frames:v', '1', path.join(dir, 'overview-every-1.5s.jpg')]);
  writeFileSync(path.join(dir, 'index.json'), `${JSON.stringify({ tiles: 'each sample is a pair: left = hyperframes snapshot, right = encoded draft; 4 tiles per row', sheets: index }, null, 2)}\n`);
  return [...written, 'overview-every-1.5s.jpg', 'index.json'];
}

async function main(argv) {
  const project = argv.find((arg) => !arg.startsWith('--') && argv[argv.indexOf(arg) - 1] !== '--video');
  if (!project) throw new Error('usage: build-evidence.mjs <project> [--video renders/draft.mp4] [--no-sheets]');
  const videoIndex = argv.indexOf('--video');
  console.log(JSON.stringify(buildEvidence(project, { video: videoIndex >= 0 ? argv[videoIndex + 1] : 'renders/draft.mp4', sheets: !argv.includes('--no-sheets') })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exit(1); });

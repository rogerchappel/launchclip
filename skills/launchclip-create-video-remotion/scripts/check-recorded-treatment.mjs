#!/usr/bin/env node
import {readFile, stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

// Exclude only the top-level review, preserving every declared production choice.
export function directionSha256(plan) {
  const {critique, ...direction} = plan;
  return createHash('sha256').update(JSON.stringify(canonical(direction))).digest('hex');
}

async function fileSha256(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

// Evidence consistency is deterministic; creative quality remains a critic's judgment.
export async function checkRecordedTreatment(planPath) {
  const issues = [], warnings = [];
  const fail = message => issues.push(message);
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const text = value => typeof value === 'string' && value.trim().length > 0;
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  let plan;
  try { plan = JSON.parse(await readFile(planPath, 'utf8')); }
  catch (error) { return {status: 'needs-attention', issues: [`Cannot read direction plan: ${error.message}`], warnings}; }
  if (!object(plan)) return {status: 'needs-attention', issues: ['Direction plan must be an object'], warnings};
  const base = dirname(resolve(planPath));
  async function file(entry, label, requireHash = false) {
    if (!object(entry) || !text(entry.path)) { fail(`${label}: local path required`); return; }
    if (requireHash && !hash(entry.sha256)) fail(`${label}: SHA-256 required`);
    if (entry.sha256 !== undefined && !hash(entry.sha256)) fail(`${label}: malformed SHA-256`);
    try {
      const path = resolve(base, entry.path);
      const info = await stat(path);
      if (!info.isFile() || info.size === 0) { fail(`${label}: nonempty local file required`); return; }
      if (hash(entry.sha256)) {
        const actual = await fileSha256(path);
        if (actual !== entry.sha256) fail(`${label}: file changed since review`);
      }
    } catch (error) { fail(`${label}: file unavailable (${error.code || error.message})`); }
  }
  if (plan.version !== 1) fail('version must be 1');
  const target = object(plan.target) ? plan.target : {};
  const duration = target.durationSeconds;
  if (!finite(duration) || duration <= 0) fail('target.durationSeconds must be positive');
  const aspects = {'16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1};
  if (!Object.hasOwn(aspects, target.aspectRatio)) fail('target.aspectRatio must be 16:9, 9:16 or 1:1');
  const dimensions = value => Number.isInteger(value.width) && value.width > 0 && Number.isInteger(value.height) && value.height > 0;
  if (!dimensions(target)) fail('target needs positive integer width and height');
  else if (Object.hasOwn(aspects, target.aspectRatio) && Math.abs(target.width / target.height - aspects[target.aspectRatio]) > 0.002) fail('target dimensions do not match aspectRatio');
  if (!['preview', 'publishable'].includes(target.delivery)) fail('target.delivery must be preview or publishable');
  const source = object(plan.source) ? plan.source : {};
  await file(source, 'source');
  if (!dimensions(source)) fail('source needs measured positive integer width and height');
  else if (dimensions(target) && Math.max(target.width / source.width, target.height / source.height) > 1.001) {
    if (target.delivery === 'publishable') fail('Source resolution requires upscaling: use native footage or mark delivery preview');
    else warnings.push('Preview uses upscaled source; do not call it final-ready');
  }
  const resources = new Map();
  if (!Array.isArray(plan.resources)) fail('resources must be an array (empty is valid)');
  else for (const resource of plan.resources) {
    if (!object(resource) || !text(resource.id)) { fail('Resource needs an id'); continue; }
    if (resources.has(resource.id)) fail(`Duplicate resource id: ${resource.id}`);
    if (typeof resource.used !== 'boolean') fail(`Resource ${resource.id}: used must be boolean`);
    if (resource.used === false && !text(resource.unusedReason)) fail(`Resource ${resource.id}: unusedReason required`);
    resources.set(resource.id, resource);
    await file(resource, `Resource ${resource.id}`, resource.used === true);
  }
  function chosen(id, label) {
    const resource = resources.get(id);
    if (!resource) fail(`${label}: unknown resource ${id}`);
    else if (resource.used !== true) fail(`${label}: resource ${id} must be marked used`);
  }
  const beats = new Map(), ranges = [];
  if (!Array.isArray(plan.beats) || plan.beats.length === 0) fail('beats must contain at least one purposeful beat');
  else for (const beat of plan.beats) {
    if (!object(beat) || !text(beat.id)) { fail('Beat needs an id'); continue; }
    if (beats.has(beat.id)) fail(`Duplicate beat id: ${beat.id}`);
    beats.set(beat.id, beat);
    if (!finite(beat.start) || !finite(beat.end) || beat.start < 0 || beat.end <= beat.start || beat.end > duration) fail(`Beat ${beat.id}: invalid output timeline bounds`);
    else ranges.push(beat);
    for (const field of ['purpose', 'visualDevelopment', 'motionIntent', 'layer']) if (!text(beat[field])) fail(`Beat ${beat.id}: ${field} required`);
    if (!Array.isArray(beat.events)) { fail(`Beat ${beat.id}: events must be an array (empty is valid)`); continue; }
    const ids = new Set();
    for (const event of beat.events) {
      if (!object(event) || !text(event.id)) { fail(`Beat ${beat.id}: event id required`); continue; }
      if (ids.has(event.id)) fail(`Beat ${beat.id}: duplicate event ${event.id}`);
      ids.add(event.id);
      if (!finite(event.time) || event.time < beat.start || event.time > beat.end) fail(`Beat ${beat.id}: event ${event.id} outside beat`);
    }
    if (beat.resourceIds !== undefined) {
      if (!Array.isArray(beat.resourceIds)) fail(`Beat ${beat.id}: resourceIds must be an array`);
      else for (const id of beat.resourceIds) chosen(id, `Beat ${beat.id}`);
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  for (let i = 0; i < ranges.length; i++) for (let j = i + 1; j < ranges.length && ranges[j].start < ranges[i].end; j++) {
    if (ranges[i].layer === ranges[j].layer) fail(`Beats ${ranges[i].id} and ${ranges[j].id} overlap on layer ${ranges[i].layer}`);
  }
  if (finite(duration) && duration > 0) {
    let coveredUntil = 0;
    for (const beat of ranges) {
      if (beat.start - coveredUntil > 0.05 + 1e-9) fail(`Uncovered output timeline: ${coveredUntil}s to ${beat.start}s`);
      coveredUntil = Math.max(coveredUntil, beat.end);
    }
    if (duration - coveredUntil > 0.05 + 1e-9) fail(`Uncovered output timeline: ${coveredUntil}s to ${duration}s`);
  }
  const audio = object(plan.audio) ? plan.audio : {};
  const music = object(audio.music) ? audio.music : {};
  if (!['none', 'local'].includes(music.choice)) fail('audio.music.choice must explicitly be none or local');
  if (music.choice === 'local') chosen(music.resourceId, 'Music');
  if (music.choice === 'none' && music.resourceId !== undefined) fail('Music choice none cannot select a resource');
  if (!Array.isArray(audio.sfx)) fail('audio.sfx must be an array (empty is valid)');
  else for (const sfx of audio.sfx) {
    if (!object(sfx)) { fail('SFX must be an object'); continue; }
    chosen(sfx.resourceId, 'SFX');
    const beat = beats.get(sfx.beatId);
    const event = Array.isArray(beat?.events) && beat.events.find(value => value?.id === sfx.eventId);
    if (!event) fail(`SFX: unknown visible event ${sfx.beatId}/${sfx.eventId}`);
    if (!finite(sfx.time) || sfx.time < 0 || sfx.time > duration) fail('SFX: invalid output time');
    else if (event && (!finite(event.time) || Math.abs(sfx.time - event.time) > 0.05 + 1e-9)) fail(`SFX: time differs from visible event ${sfx.eventId} by more than 0.05s`);
  }
  const prototype = object(plan.prototype) ? plan.prototype : {};
  await file(prototype, 'prototype', true);
  if (!finite(prototype.start) || !finite(prototype.end) || prototype.start < 0 || prototype.end <= prototype.start || prototype.end > duration) fail('prototype: invalid representative output range');
  const critique = object(plan.critique) ? plan.critique : {};
  if (!hash(critique.directionSha256) || critique.directionSha256 !== directionSha256(plan)) fail('critique: direction changed since review or direction hash absent');
  if (critique.outcome !== 'pass') fail('critique: revision required or passing review absent');
  if (!hash(critique.prototypeSha256) || critique.prototypeSha256 !== prototype.sha256) fail('critique: review does not bind to current prototype');
  if (critique.reviewedMotion !== true) fail('critique: motion review must be attested');
  const expectsAudio = music.choice === 'local' || (Array.isArray(audio.sfx) && audio.sfx.length > 0) || audio.narration !== 'none';
  if (expectsAudio ? critique.reviewedAudio !== true : ![true, 'none'].includes(critique.reviewedAudio)) fail('critique: audio review required (none allowed only when narration, music and SFX are absent)');
  if (!['source', 'none'].includes(audio.narration)) fail('audio.narration must explicitly be source or none');
  if (!text(critique.notes)) fail('critique: specific review notes required');
  if (!text(critique.reviewedAt) || !Number.isFinite(Date.parse(critique.reviewedAt))) fail('critique: reviewedAt date required');
  return {status: issues.length ? 'needs-attention' : 'evidence-ready', issues, warnings,
    limitation: 'Checks declared timing, local files and review binding only; does not certify artistic quality, media metadata, audio mix or final delivery.'};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length === 4 && process.argv[2] === '--hash') {
    try {
      const plan = JSON.parse(await readFile(process.argv[3], 'utf8'));
      if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('Direction plan must be an object');
      console.log(directionSha256(plan));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  } else if (process.argv.length !== 3) {
    console.error('Usage: node check-recorded-treatment.mjs [--hash] path/to/EDIT-DIRECTION.json');
    process.exitCode = 2;
  } else {
    const result = await checkRecordedTreatment(process.argv[2]);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === 'evidence-ready' ? 0 : 1;
  }
}

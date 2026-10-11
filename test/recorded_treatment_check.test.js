import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {checkRecordedTreatment, directionSha256} from '../skills/launchclip-create-video/scripts/check-recorded-treatment.mjs';

const sha = content => createHash('sha256').update(content).digest('hex');
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'recorded-treatment-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  await writeFile(join(dir, 'source.mp4'), 'source placeholder');
  await writeFile(join(dir, 'prototype.mp4'), 'render placeholder');
  await writeFile(join(dir, 'tick.wav'), 'audio placeholder');
  const plan = {
    version: 1, target: {durationSeconds: 40, aspectRatio: '16:9', width: 1920, height: 1080, delivery: 'publishable'},
    source: {path: 'source.mp4', width: 3840, height: 2160}, resources: [],
    beats: [{id: 'hold', start: 0, end: 40, layer: 'presenter', purpose: 'Let the invitation land', visualDevelopment: 'Presenter holds attention', motionIntent: 'Deliberate stillness', events: []}],
    audio: {narration: 'source', music: {choice: 'none'}, sfx: []},
    prototype: {path: 'prototype.mp4', sha256: sha('render placeholder'), start: 0, end: 10},
    critique: {prototypeSha256: sha('render placeholder'), outcome: 'pass', notes: 'Watched motion and listened for intelligibility; hold serves the invitation.', reviewedAt: '2026-10-11T00:00:00Z', reviewedMotion: true, reviewedAudio: true}
  };
  const path = join(dir, 'EDIT-DIRECTION.json');
  async function check(refresh = true) { if (refresh) plan.critique.directionSha256 = directionSha256(plan); await writeFile(path, JSON.stringify(plan)); return checkRecordedTreatment(path); }
  return {dir, path, plan, check};
}

test('asset-free quiet treatment is evidence-ready without style or density quotas', async t => {
  const {check} = await fixture(t);
  assert.equal((await check()).status, 'evidence-ready');
});

test('selected assets bind file bytes and SFX to visible event within 50ms', async t => {
  const {plan, check, dir} = await fixture(t);
  plan.resources = [{id: 'tick', path: 'tick.wav', used: true, sha256: sha('audio placeholder')}];
  plan.beats[0].events = [{id: 'lock', time: 5}];
  plan.audio.sfx = [{resourceId: 'tick', beatId: 'hold', eventId: 'lock', time: 5.05}];
  assert.equal((await check()).status, 'evidence-ready');
  plan.audio.sfx[0].time = 5.051;
  assert.match((await check()).issues.join('\n'), /more than 0.05s/);
  plan.audio.sfx[0].time = 5;
  await writeFile(join(dir, 'tick.wav'), 'replaced audio');
  assert.match((await check()).issues.join('\n'), /file changed/);
});

test('review is stale after prototype replacement and failed critique cannot pass', async t => {
  const {plan, check, dir} = await fixture(t);
  await writeFile(join(dir, 'prototype.mp4'), 'new render');
  assert.match((await check()).issues.join('\n'), /file changed/);
  plan.prototype.sha256 = sha('new render');
  assert.match((await check()).issues.join('\n'), /does not bind/);
  plan.critique.prototypeSha256 = plan.prototype.sha256;
  plan.critique.outcome = 'revise';
  assert.match((await check()).issues.join('\n'), /revision required/);
});

test('missing assets, undeclared selection and missing events need attention', async t => {
  const {plan, check} = await fixture(t);
  plan.resources = [{id: 'missing', path: 'gone.wav', used: false}];
  plan.audio.music = {choice: 'local', resourceId: 'missing'};
  plan.audio.sfx = [{resourceId: 'unknown', beatId: 'hold', eventId: 'unknown', time: 4}];
  const issues = (await check()).issues.join('\n');
  for (const pattern of [/unusedReason/, /file unavailable/, /marked used/, /unknown resource/, /unknown visible event/]) assert.match(issues, pattern);
});

test('range and aspect errors fail while intentional separate layers can overlap', async t => {
  const {plan, check} = await fixture(t);
  plan.beats.push({...plan.beats[0], id: 'overlay', layer: 'overlay', start: 3, end: 6});
  assert.equal((await check()).status, 'evidence-ready');
  plan.beats[1].layer = 'presenter';
  assert.match((await check()).issues.join('\n'), /overlap/);
  plan.beats[1].end = 41;
  plan.target.aspectRatio = '9:16';
  const issues = (await check()).issues.join('\n');
  assert.match(issues, /timeline bounds/);
  assert.match(issues, /do not match aspectRatio/);
});

test('portrait and square targets valid; declared proxy is preview only', async t => {
  const {plan, check} = await fixture(t);
  for (const [aspectRatio, width, height] of [['9:16', 1080, 1920], ['1:1', 1080, 1080]]) {
    Object.assign(plan.target, {aspectRatio, width, height});
    assert.equal((await check()).status, 'evidence-ready');
  }
  Object.assign(plan.source, {width: 960, height: 540});
  assert.match((await check()).issues.join('\n'), /upscaling/);
  plan.target.delivery = 'preview';
  assert.equal((await check()).status, 'evidence-ready');
  assert.match((await check()).warnings.join('\n'), /upscaled/);
});

test('reviewedAudio none requires deliberately silent plan, motion review always required', async t => {
  const {plan, check} = await fixture(t);
  plan.critique.reviewedAudio = 'none';
  assert.match((await check()).issues.join('\n'), /audio review required/);
  plan.audio.narration = 'none';
  assert.equal((await check()).status, 'evidence-ready');
  plan.critique.reviewedMotion = false;
  assert.match((await check()).issues.join('\n'), /motion review/);
});

test('malformed input returns diagnostics and CLI exposes exit contract', async t => {
  const {path, check} = await fixture(t);
  await check();
  const script = new URL('../skills/launchclip-create-video/scripts/check-recorded-treatment.mjs', import.meta.url);
  assert.equal(spawnSync(process.execPath, [script.pathname, path]).status, 0);
  const hashResult = spawnSync(process.execPath, [script.pathname, '--hash', path], {encoding: 'utf8'});
  assert.equal(hashResult.status, 0);
  assert.match(hashResult.stdout.trim(), /^[a-f0-9]{64}$/);
  await writeFile(path, '{broken');
  assert.equal((await checkRecordedTreatment(path)).status, 'needs-attention');
  assert.equal(spawnSync(process.execPath, [script.pathname, path]).status, 1);
  assert.equal(spawnSync(process.execPath, [script.pathname]).status, 2);
});


test('whole timeline coverage includes quiet beats and permits only 50ms rounding gaps', async t => {
  const {plan, check} = await fixture(t);
  plan.beats[0].start = 0.05;
  plan.beats[0].end = 39.95;
  assert.equal((await check()).status, 'evidence-ready');
  plan.beats[0].start = 0.051;
  assert.match((await check()).issues.join('\n'), /Uncovered output timeline/);
  plan.beats[0].start = 0;
  plan.beats[0].end = 19;
  plan.beats.push({...plan.beats[0], id: 'second', start: 20, end: 40});
  assert.match((await check()).issues.join('\n'), /19s to 20s/);
});

test('direction and audio changes invalidate passing review; key order and review edits do not', async t => {
  const {plan, check} = await fixture(t);
  assert.equal((await check()).status, 'evidence-ready');
  const initial = directionSha256(plan);
  const reversed = Object.fromEntries(Object.entries(plan).reverse());
  assert.equal(directionSha256(reversed), initial);
  plan.critique.notes = 'Additional review details';
  assert.equal((await check(false)).status, 'evidence-ready');
  plan.beats[0].motionIntent = 'New motion treatment';
  assert.match((await check(false)).issues.join('\n'), /direction changed/);
  await check();
  plan.audio.narration = 'none';
  assert.match((await check(false)).issues.join('\n'), /direction changed/);
  plan.audio.narration = 'source';
  await check();
  plan.beats[0].events.push({id: 'new-event', time: 5});
  assert.match((await check(false)).issues.join('\n'), /direction changed/);
});

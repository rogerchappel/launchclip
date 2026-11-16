// The pace gate on renders and the plan against the render
// (docs/PLAN_AND_PACE_RFC.md §2, phase 7).
import test from 'node:test';
import assert from 'node:assert/strict';
import {cadenceTarget} from '@launchclip/core/cadence.mjs';
import {profilePace, renderPaceFindings} from '@launchclip/core/pace-check.mjs';
import {renderPaceGate} from '../src/quality_gates.js';

const short = cadenceTarget('short-form').pace;
const rules = (findings) => findings.map(f => `${f.severity}:${f.rule}`).sort();
const beats = Array.from({length: 40}, (_, i) => i * 0.5);

test('a profile\'s measured pace tightens the band and never loosens it', () => {
  const tight = profilePace(short, {measures: {hook_rate_ratio: {p10: 2}, max_event_gap_seconds: {p90: 2}, cuts_on_beat_ratio: {p10: 0.8}}});
  assert.deepEqual([tight.hook_ratio, tight.gap_warn, tight.cuts_on_beat], [2, 2, 0.8]);
  const loose = profilePace(short, {measures: {hook_rate_ratio: {p10: 0.5}, max_event_gap_seconds: {p90: 9}}});
  assert.deepEqual([loose.hook_ratio, loose.gap_warn], [short.hook_ratio, short.gap_warn]);
});

test('planned against measured: missing events, a lost hook, cuts off the beat', () => {
  const planned = [0, 0.8, 1.6, 2.4, 4, 6, 8, 10, 12];
  // The render shows only the cuts, each 0.2 s off the beat.
  const measuredCuts = [4.2, 6.2, 8.2, 10.2, 12.2];
  const findings = renderPaceFindings({planned, measured: measuredCuts, measuredCuts, beats, pace: short, duration: 20});
  assert.deepEqual(rules(findings), ['warning:cuts-off-beat', 'warning:hook-lost', 'warning:planned-events-missing']);
  // Shown as planned, on the beat: clean.
  assert.deepEqual(renderPaceFindings({planned, measured: planned, measuredCuts: [4, 6, 8, 10, 12], beats, pace: short, duration: 20}), []);
});

test('cuts on every beat for eight beats warn', () => {
  const cuts = Array.from({length: 9}, (_, i) => 2 + i * 0.5);
  assert.deepEqual(rules(renderPaceFindings({planned: cuts, measured: cuts, measuredCuts: cuts, beats, pace: short, duration: 20})), ['warning:cuts-on-every-beat']);
});

test('a planned cut mid-move warns cut-mid-motion; one at a calm moment does not', () => {
  // A fast move at 4.5–5.5 s, calm elsewhere.
  const values = Array.from({length: 241}, (_, i) => (i / 12 >= 4.5 && i / 12 <= 5.5 ? 20 : i % 2 ? 4 : 6));
  const curve = {fps: 12, values};
  const flagged = renderPaceFindings({planned: [5.25, 9], cuts: [5.25, 9], measured: [5.25, 9], curve, beats, pace: short, duration: 20});
  assert.deepEqual(flagged.filter(f => f.rule === 'cut-mid-motion').map(f => f.at), [5.25]);
});

test('renderPaceGate fails a slow hook and a frozen frame read from the pixels', () => {
  const resolved = {resolved: {duration: 20}, format: {duration: 20}, scenes: [{id: 'a', module: 'hook-title', start: 0, end: 10, params: {headline: 'x'}}, {id: 'b', module: 'hook-title', start: 10, end: 20, params: {headline: 'y'}}]};
  const motion = {duration_seconds: 20, cuts: [10], motion: {bursts: [{start_seconds: 1}, ...Array.from({length: 8}, (_, i) => ({start_seconds: 4 + i * 2}))], still_spans: [{start: 11, end: 12.5, seconds: 1.5}, {start: 19, end: 20, seconds: 1, closing: true}]}};
  const gate = renderPaceGate({resolved, motion, profile: {id: 'short-motion'}});
  assert.equal(gate.status, 'failed');
  assert.equal(gate.source, 'render');
  assert.ok(gate.findings.some(f => f.rule === 'slow-hook' && f.severity === 'error'));
  assert.deepEqual(gate.findings.filter(f => f.rule === 'frozen-frame').map(f => [f.severity, f.at]), [['error', 11]]);
  assert.equal(renderPaceGate({resolved, motion: null}).status, 'skipped');
});

// A member in its own tone (kit/core/member-tone.mjs, docs/FLUID_MOTION_RFC.md §10):
// named steps of the brand palette, each at least 3:1 on bg, never a hex.
import test from 'node:test';
import assert from 'node:assert/strict';
import {makeCheck} from '@launchclip/core/catalog-b-base.mjs';
import {contrastRatio} from '@launchclip/core/oklch.mjs';
import {TONE_NAMES, memberTone, toneHex} from '@launchclip/core/member-tone.mjs';

const dark = {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'};
const light = {bg: '#f4f1ea', primary: '#2f6bff', accent: '#ff6a3d', ink: '#111111', paper: '#ffffff'};
const check = makeCheck('');

test('member tone: every step keeps 3:1 on bg, and the plain hue is the brand colour', () => {
  for (const colors of [dark, light]) for (const name of TONE_NAMES) assert.ok(contrastRatio(toneHex(colors, name), colors.bg) >= 3 - 1e-9, `${name} on ${colors.bg}`);
  assert.equal(toneHex(dark, 'accent'), dark.accent);
  assert.notEqual(toneHex(dark, 'accent-deep'), toneHex(dark, 'accent-light'));
});

test('member tone: a hex is refused with the nearest step; an unknown name lists the steps', () => {
  assert.throws(() => memberTone(check, '#46d0fa', 'tone', dark), /not a hex.*nearest is "accent"/);
  assert.throws(() => memberTone(check, 'teal', 'tone', dark), /must be one of primary/);
  const tone = memberTone(check, 'primary-deep', 'tone', dark);
  assert.equal(tone.ink, dark.ink);
  assert.ok(contrastRatio(tone.ink, tone.color) >= 4.5);
});

// A member in its own tone (docs/FLUID_MOTION_RFC.md §10): one member of a set
// takes a colour of its own instead of the module's palette. A tone is a
// named step of the brand palette, never a hex, so it stays on-brand and keeps
// contrast: a hue (primary, accent, paper) at a lightness step (deeper, deep,
// as given, light, lighter), walked in OKLCH and then pushed away from the
// ground until it clears 3:1 on bg (graphics contrast). The ink on it is the
// brand colour that reads best.
//
// The `tone` member module (kit/core/members.mjs) is a card in its tone: the
// card's fields plus `tone`; node-graph runs its wire and lit rim in it too.
//
// Canonical copy: kit/core/member-tone.mjs.

import {contrastRatio, fitContrast, hexToOklab, hexToOklch, oklchToHex} from './oklch.mjs';
import {graphicNodes, graphicSpec, graphicWidth} from './graphic.mjs';

export const TONE_HUES = Object.freeze(['primary', 'accent', 'paper']);
// OKLCH lightness offset per step from the brand colour as given.
export const TONE_STEPS = Object.freeze({deeper: -0.16, deep: -0.08, light: 0.08, lighter: 0.16});
export const TONE_NAMES = Object.freeze(TONE_HUES.flatMap(hue => [hue, ...Object.keys(TONE_STEPS).map(step => `${hue}-${step}`)]));
export const TONE_MIN_CONTRAST = 3;

/** One line for a member's params: what a `tone` may be. */
export const TONE_PARAM = `a step of the brand palette (${TONE_HUES.join(' | ')}, or one with -deeper | -deep | -light | -lighter: "accent-deep"); never a hex`;

/** The hex of a named tone on these brand colours ({bg, primary, accent, paper}); ≥ 3:1 on bg. */
export function toneHex(colors, name) {
  const [hue, step] = String(name).split('-');
  const lch = hexToOklch(colors[hue]);
  const l = Math.min(0.98, Math.max(0.05, lch.l + (step ? TONE_STEPS[step] : 0)));
  const hex = oklchToHex({...lch, l});
  return contrastRatio(hex, colors.bg) >= TONE_MIN_CONTRAST ? hex : fitContrast({...lch, l}, colors.bg, TONE_MIN_CONTRAST) ?? colors.paper;
}

// The text colour (ink, paper or bg) that reads best on a fill.
function inkOn(colors, fill) {
  return [colors.ink, colors.paper, colors.bg].filter(Boolean).reduce((best, c) => contrastRatio(c, fill) > contrastRatio(best, fill) ? c : best);
}

// The named tone nearest a hex (OKLab distance), for the error a hex gets.
function nearestTone(colors, hex) {
  const a = hexToOklab(hex);
  const d = name => hexToOklab(toneHex(colors, name)).reduce((sum, v, i) => sum + (v - a[i]) ** 2, 0);
  return TONE_NAMES.reduce((best, name) => d(name) < d(best) ? name : best);
}

/** A validated member tone → {name, color, ink}, or a check.fail naming what to change. */
export function memberTone(check, raw, path, colors) {
  if (typeof raw === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw)) check.fail(path, `must be a step of the brand palette, not a hex, so it stays on-brand and keeps contrast; the nearest is "${nearestTone(colors, raw)}"`);
  const name = check.oneOf(raw, path, TONE_NAMES);
  const color = toneHex(colors, name);
  return {name, color, ink: inkOn(colors, color)};
}

// A card's fields plus its tone.
const CARD = ['icon', 'label', 'badge'];

/** The `tone` member module: a card in its own tone. */
export const toneMember = {
  id: 'tone',
  describe: 'A member in its own colour: a card (icon, label, count badge) in a step of the brand palette instead of the set\'s colour.',
  params: {tone: TONE_PARAM, icon: 'icon name (optional)', label: 'string (optional; one of icon or label)', badge: '≤ 3 chars (optional)'},
  face: 'card',
  spec(check, raw, path, {labelMax, base}) {
    for (const key of Object.keys(raw)) if (key !== 'tone' && !CARD.includes(key)) check.fail(`${path}.${key}`, `is not supported (allowed: module, tone, ${CARD.join(', ')})`);
    if (raw.tone === undefined) check.fail(`${path}.tone`, `is required: ${TONE_PARAM}`);
    const {tone, ...card} = raw;
    const {name, color, ink} = memberTone(check, tone, `${path}.tone`, base.colors);
    return {...graphicSpec(check, {kind: 'card', ...card}, path, labelMax ? {labelMax} : undefined), tone: name, color, ink};
  },
  width: (spec, L) => graphicWidth({...spec, kind: 'card'}, L),
  nodes: (spec, W, H, look) => graphicNodes({...spec, kind: 'card'}, W, H, {...look, color: spec.color, ink: spec.ink})
};

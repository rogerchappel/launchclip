// value-card: a member module (docs/FLUID_MOTION_RFC.md §10): a card whose
// face is a value or multiplier too long for a badge ("$7.15", "×3.2"), set
// in the display face in the member's colour, with an optional label under it,
// as map-highlight and cell-grid show theirs. It joins a set through
// kit/core/members.mjs; the set lays it out and moves it.

import {r2, textWidth} from './catalog-h-base.mjs';
import {label} from './catalog-h-view.mjs';
import {graphicNodes, graphicSpec} from './graphic.mjs';

const VALUE_MAX = 10;
const VALUE = 1.9; // the value's size, in label sizes: the card's icon slot, about
const PAD = 1.25; // the card's side padding, in label sizes (graphicWidth's)

const slot = (I, L) => Math.max(I, VALUE * L * 1.1);

export const valueCard = {
  id: 'value-card',
  describe: 'A card whose face is a value or multiplier longer than a badge holds ("$7.15", "×3.2", "1,250"), with a label under it.',
  params: {value: `≤ ${VALUE_MAX} chars ("$7.15", "×3.2")`, label: '≤ the set\'s label length (optional)'},
  face: 'card',
  spec(check, raw, path, {labelMax} = {}) {
    for (const key of Object.keys(raw)) if (!['value', 'label'].includes(key)) check.fail(`${path}.${key}`, 'is not supported (allowed: module, value, label)');
    if (raw.value === undefined) check.fail(`${path}.value`, 'is required');
    if (typeof raw.value !== 'string' && typeof raw.value !== 'number') check.fail(`${path}.value`, 'must be text or a number ("$7.15", "×3.2")');
    // The label validates as a card graphic's.
    const card = raw.label === undefined ? {label: null} : graphicSpec(check, {kind: 'card', label: raw.label}, path, labelMax ? {labelMax} : undefined);
    return {label: card.label, value: check.str(String(raw.value), `${path}.value`, VALUE_MAX)};
  },
  // Sized from the label, so the fit that keeps the label over the floor keeps the value in the card.
  width: (spec, L) => Math.max(textWidth(spec.value, VALUE * L, 'display'), spec.label ? textWidth(spec.label, L, 'body') : 0) + PAD * L,
  height: (spec, I, L) => r2(I * 72 / 66 + slot(I, L) + (spec.label ? L * 1.25 : 0)),
  nodes(spec, W, H, look) {
    const {icon: I, labelSize: L, fonts, fg, color} = look;
    const V = r2(VALUE * L), line = L * 1.25;
    // The card's face (and the set's lit rim) with no icon or label of its own.
    const kids = graphicNodes({kind: 'card'}, W, H, look);
    const valueY = spec.label ? 30 * I / 66 + (slot(I, L) - V * 1.1) / 2 : (H - V * 1.1) / 2;
    kids.push(label(`${look.key}-value`, 0, r2(valueY), W, spec.value, {size: V, family: fonts.display, color, align: 'center', lineHeight: 1.1}));
    if (spec.label) kids.push(label(null, 0, r2(H - line - 24 * I / 66), W, spec.label, {size: L, family: fonts.body, color: fg, align: 'center', weight: 700, lineHeight: 1.25}));
    return kids;
  }
};

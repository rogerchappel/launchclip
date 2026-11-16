// sub-card: a member module (docs/FLUID_MOTION_RFC.md §10) — the default card
// with a second line under its label, in the meta face and a muted ink, the
// "sub" that map pins, grid-race, cell-grid and the results cards carry.
// It joins a set through kit/core/members.mjs; the set lays it out and moves it.

import {mixColor, r2, textWidth} from './catalog-h-base.mjs';
import {label} from './catalog-h-view.mjs';
import {cardHeight, graphicNodes, graphicSpec} from './graphic.mjs';

const SUB_MAX = 24;
const PAD = 1.25; // the card's side padding, in label sizes (graphicWidth's)

export const subCard = {
  id: 'sub-card',
  describe: 'A card with an icon, a label and a second line under it ("Baker" / "3 a.m. start").',
  params: {label: '≤ the set\'s label length', sub: `≤ ${SUB_MAX} chars, the second line`, icon: 'kit/core/icons.mjs name (optional)', badge: '≤ 3 chars (optional)'},
  face: 'card',
  spec(check, raw, path, {labelMax} = {}) {
    for (const key of Object.keys(raw)) if (!['label', 'sub', 'icon', 'badge'].includes(key)) check.fail(`${path}.${key}`, 'is not supported (allowed: module, label, sub, icon, badge)');
    if (raw.label === undefined) check.fail(`${path}.label`, 'is required');
    if (raw.sub === undefined) check.fail(`${path}.sub`, 'is required (without one, use the default member or a card graphic)');
    // The card's own fields validate as a card graphic.
    const card = graphicSpec(check, {kind: 'card', label: raw.label, ...(raw.icon === undefined ? {} : {icon: raw.icon}), ...(raw.badge === undefined ? {} : {badge: raw.badge})}, path, labelMax ? {labelMax} : undefined);
    return {...card, sub: check.str(raw.sub, `${path}.sub`, SUB_MAX)};
  },
  // The sub is the label's size in the meta face, so it never falls under the floor the label is fitted to.
  width: (spec, L) => Math.max(textWidth(spec.label, L, 'body'), textWidth(spec.sub, L, 'meta')) + PAD * L,
  height: (spec, I, L) => r2(cardHeight(I, L) + L * 1.25),
  nodes(spec, W, H, look) {
    const {icon: I, labelSize: L, fonts, fg, panel} = look;
    const line = L * 1.25;
    // The card's face and label drawn one line short, then the face stretched to the full height and the sub laid under the label.
    const top = H - line;
    const kids = graphicNodes({...spec, kind: 'card'}, W, top, look);
    kids[0] = {...kids[0], style: {...kids[0].style, height: H}};
    const subY = spec.icon ? top - 24 * I / 66 : (top + line) / 2;
    kids.push(label(`${look.key}-sub`, 0, r2(subY), W, spec.sub, {size: L, family: fonts.meta, color: mixColor(fg, panel, 0.4), align: 'center', weight: 500, lineHeight: 1.25}));
    return kids;
  }
};

// The member hookup (docs/FLUID_MOTION_RFC.md §10): how a set module
// (node-graph, icon-grid, …) takes a member module in place of its default
// member. It extends the planner-drawn graphic (kit/core/graphic.mjs): a set
// member is `{graphic: {kind, …}}` (the closed list) or `{member: {module, …}}`
// (a catalogue member module), and the set module reads both through the four
// calls below, so it sizes, paints, lights and times either the same way.
//
// A member module is a plain object registered in MEMBERS:
//   id        catalogue id, what `member.module` names
//   describe  one sentence for the planner
//   params    {key: doc} for the planner line (module is implied)
//   face      'card' (the set lights its rim) or 'glow' (it glows from behind)
//   spec(check, raw, path, {labelMax, base}) → a plain spec with `label`
//             (the member's name, or null); `base` is the set's createHBase
//             (colours, timeOf, unit) for members that need them
//   width(spec, L) → px it needs at label size L (in proportion to L)
//   height?(spec, I, L) → px it needs with an I px icon (default: a card's)
//   nodes(spec, W, H, look) → view nodes in a W × H box at (0, 0); `look` is
//             graphicNodes' (colour, ink, fg, panel, fonts, unit, icon,
//             labelSize, colors, canvas, key, over); ids start with look.key
//   timeline?(ops, spec, {key, start, landAt, settle}) → ops on its own ids,
//             after the set's flock and idle (status over time, a count-up)

import {GRAPHIC_PARAM, cardHeight, fitGraphic, graphicNodes, graphicSpec, graphicWidth} from './graphic.mjs';
import {r2} from './catalog-h-base.mjs';
import {personMember} from './member-person.mjs';
import {toneMember} from './member-tone.mjs';

// One line per member module; each member session appends its own.
const LIST = [
  toneMember,
  personMember
];

// Not frozen: a test may register a stand-in member.
export const MEMBERS = Object.fromEntries(LIST.map(m => [m.id, m]));

/** One line for a set module's params: what a `member` may be. */
export const MEMBER_PARAM = LIST.length
  ? `{module: ${LIST.map(m => m.id).join(' | ')}, …} a member module (RFC §10): ${LIST.map(m => `${m.id} {${Object.entries(m.params).map(([k, v]) => `${k} ${v}`).join(', ')}}`).join('; ')}`
  : '{module, …} a member module (RFC §10; none registered yet)';

/** A member module's spec (raw is `{module, …}`), tagged with its module id. */
export function memberSpec(check, raw, path, opts = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) check.fail(path, `must be a member: ${MEMBER_PARAM}`);
  const def = MEMBERS[raw.module];
  if (!def) check.fail(`${path}.module`, `must be one of ${Object.keys(MEMBERS).join(', ') || '(none yet)'}, got ${JSON.stringify(raw.module)}`);
  const {module, ...rest} = raw;
  return {...def.spec(check, rest, path, opts), module};
}

/**
 * The member an item of a set gives, or null for the set's default member:
 * `{graphic}` (the closed list) or `{member}` (a member module), never both,
 * and neither alongside the `replaces` keys (the default member's own fields).
 */
export function memberOf(check, raw, path, {replaces = [], labelMax, base} = {}) {
  const has = key => raw[key] !== undefined;
  if (has('graphic') && has('member')) check.fail(`${path}.member`, 'replaces the graphic; give one of them');
  const key = has('member') ? 'member' : has('graphic') ? 'graphic' : null;
  if (!key) return null;
  const clash = replaces.filter(has);
  if (clash.length) check.fail(`${path}.${key}`, `replaces ${replaces.join(' and ')}; give the ${key} or ${replaces.join(' and ')}`);
  return key === 'member' ? memberSpec(check, raw.member, `${path}.member`, {labelMax, base}) : graphicSpec(check, raw.graphic, `${path}.graphic`, labelMax ? {labelMax} : undefined);
}

const def = spec => (spec.module ? MEMBERS[spec.module] : null);

/** px a graphic or member needs at label size L. */
export const memberWidth = (spec, L) => (def(spec) ? def(spec).width(spec, L) : graphicWidth(spec, L));

/** fitGraphic for a graphic or member: the largest label size ≤ preferred that fits `width`; fails under `min`. */
export function fitMember(check, path, spec, width, {preferred, min}) {
  if (!def(spec)) return fitGraphic(check, path, spec, width, {preferred, min});
  const need = def(spec).width(spec, 1);
  const size = r2(Math.min(preferred, need > 0 ? width / need : preferred));
  if (size < min) check.fail(path, `does not fit ${r2(width)}px at ${r2(min)}px type; shorten it`);
  return size;
}

/** px tall a graphic or member is with an I px icon and L px label. */
export const memberHeight = (spec, I, L) => def(spec)?.height?.(spec, I, L) ?? cardHeight(I, L);

/** Whether the set lights its rim (a card face) or glows it from behind. */
export const memberFace = spec => (def(spec) ? def(spec).face : spec.kind === 'card' ? 'card' : 'glow');

/** View nodes for a graphic or member in a W × H box. */
export const memberNodes = (spec, W, H, look) => (def(spec) ? def(spec).nodes(spec, W, H, look) : graphicNodes(spec, W, H, look));

/** A member module's own ops (none for a graphic). */
export const memberOps = (ops, spec, at) => def(spec)?.timeline?.(ops, spec, at);

/** The params line for a set member: the graphic's and the member's. */
export const SET_MEMBER_PARAM = `{graphic: ${GRAPHIC_PARAM}} | {member: ${MEMBER_PARAM}}`;

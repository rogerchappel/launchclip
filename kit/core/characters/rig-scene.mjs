// STUB (rig-compile branch only): the rig core lands the real
// kit/core/characters/rig-scene.mjs (rigSceneTree, rigScenePrepare,
// validateRigScenePlan, RIG_FRAME_STYLES). This file stands in for it so the
// cue compiler and its tests run before the merge; take the rig core's
// version over this one.
//
// Imports nothing.

export const RIG_FRAME_STYLES = Object.freeze(['stick', 'stick-classic', 'rubber-hose']);

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const num = v => typeof v === 'number' && Number.isFinite(v);
const point = v => Array.isArray(v) && v.length === 2 && v.every(num);

/** Structural problems with a rig-scene plan (the shared contract), as strings. */
export function validateRigScenePlan(plan) {
  const out = [];
  if (!isObj(plan)) return ['plan must be an object'];
  if (plan.schema !== 'launchclip.rig-scene.v1') out.push('schema must be "launchclip.rig-scene.v1"');
  const actors = Array.isArray(plan.actors) ? plan.actors : (out.push('actors must be an array'), []);
  const ids = new Set(actors.map(a => a?.id));
  const props = new Set((plan.props ?? []).map(p => p?.id));
  const timed = (list, where, check = () => {}) => {
    if (!Array.isArray(list)) { out.push(`${where} must be an array`); return; }
    list.forEach((k, i) => {
      if (!isObj(k) || !num(k.t)) out.push(`${where}[${i}].t must be a number`);
      else if (i && !(k.t > list[i - 1].t)) out.push(`${where}[${i}].t must come after the key before`);
      else check(k, `${where}[${i}]`);
    });
  };
  actors.forEach((a, i) => {
    const w = `actors[${i}]`;
    if (!isObj(a?.character) || !RIG_FRAME_STYLES.includes(a.character.style)) out.push(`${w}.character.style must be one of ${RIG_FRAME_STYLES.join(', ')}`);
    if (!isObj(a?.at) || !['x', 'floor', 'scale'].every(k => num(a.at[k]))) out.push(`${w}.at must be {x, floor, scale}`);
    const tr = a?.track;
    if (!isObj(tr) || !num(tr.x) || !['left', 'right'].includes(tr.facing)) { out.push(`${w}.track must have x and facing`); return; }
    timed(tr.keys ?? [], `${w}.track.keys`, (k, kw) => { for (const c of ['lean', 'crouch', 'shift', 'head']) if (k[c] !== undefined && !num(k[c])) out.push(`${kw}.${c} must be a number`); });
    timed(tr.facings ?? [], `${w}.track.facings`, (k, kw) => { if (!['left', 'right'].includes(k.facing)) out.push(`${kw}.facing must be left or right`); });
    timed(tr.squash ?? [], `${w}.track.squash`);
    (tr.walks ?? []).forEach((wk, k) => { if (!num(wk.start) || !num(wk.end) || !(wk.end > wk.start) || !num(wk.to)) out.push(`${w}.track.walks[${k}] must be {start < end, to}`); });
    for (const limb of ['hands', 'feet']) for (const side of Object.keys(tr[limb] ?? {})) {
      if (!['l', 'r'].includes(side)) out.push(`${w}.track.${limb}.${side} must be l or r`);
      timed(tr[limb][side], `${w}.track.${limb}.${side}`, (k, kw) => {
        if (!point(k.at)) out.push(`${kw}.at must be [x, y]`);
        if (k.grip !== undefined && !props.has(k.grip)) out.push(`${kw}.grip names no prop`);
      });
    }
    timed(a.expressions ?? [], `${w}.expressions`);
    if (a.mouth !== undefined) timed(a.mouth, `${w}.mouth`);
  });
  (plan.props ?? []).forEach((p, i) => timed(p?.path, `props[${i}].path`, (k, kw) => {
    if (k.holder) { if (!ids.has(k.holder.actor) || !['l', 'r'].includes(k.holder.hand)) out.push(`${kw}.holder must name an actor and a hand`); }
    else if (!point(k.at)) out.push(`${kw}.at must be [x, y]`);
  }));
  return out;
}

/** Stub: the rig core precomputes walk plans here. */
export const rigScenePrepare = plan => ({plan});

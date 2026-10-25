// Placement checks for character scenes (the cast gate, src/cast.js):
//
// - reach: every pose a character takes in a scene (and each gesture's far
//   swing, and a held phone) stays on the canvas, and inside the safe zone
//   at the sides and top (a pointing hand under a Shorts UI rail is lost);
//   feet stand on the set's floor, so the bottom is checked against the
//   canvas only. The reach is each model actor's `reach`
//   (catalog-characters.mjs actorReach).
// - sides: two characters who share consecutive cast scenes keep their
//   left-to-right order, unless both scenes place them with an explicit
//   `position` (a deliberate swap). The order of the cast list decides the
//   side otherwise, so reordering it swaps a couple between shots.
//
// Imports only kit/core files.

import {profileGeometry} from '../layout-check.mjs';

const px = value => Math.round(value);

/**
 * Placement findings for a story's character scene models (resolved, in
 * story order). story: the resolved story (format, scenes with params).
 * → [{scene, id, detail}]
 */
export function castPlacement(story, models) {
  const findings = [];
  const canvas = {width: story?.format?.width, height: story?.format?.height};
  if (!(canvas.width > 0 && canvas.height > 0)) return findings;
  const safe = profileGeometry(canvas).safeZone;
  for (const model of models) {
    for (const actor of model?.content?.actors ?? []) {
      const r = actor.reach;
      if (!r) continue;
      const poses = [...new Set(actor.states.map(state => state.pose))].join(', ');
      const fix = `move it (position) or turn it (facing) so the gesture points into the frame, or choose another pose`;
      const off = [r.left < 0 && `x ${px(r.left)}`, r.right > canvas.width && `x ${px(r.right)}`, r.top < 0 && `y ${px(r.top)}`, r.bottom > canvas.height && `y ${px(r.bottom)}`].filter(Boolean);
      if (off.length) {
        findings.push({scene: model.sceneId, id: actor.id, detail: `${actor.id} in ${model.sceneId} reaches off the canvas (${off.join(', ')}; canvas ${canvas.width}x${canvas.height}) in ${poses} facing ${actor.facing}; ${fix}`});
        continue;
      }
      const out = [r.left < safe.x && `left to x ${px(r.left)} (safe from ${px(safe.x)})`, r.right > safe.x + safe.width && `right to x ${px(r.right)} (safe to ${px(safe.x + safe.width)})`, r.top < safe.y && `up to y ${px(r.top)} (safe from ${px(safe.y)})`].filter(Boolean);
      if (out.length) findings.push({scene: model.sceneId, id: actor.id, detail: `${actor.id} in ${model.sceneId} reaches out of the safe zone ${out.join(', ')} in ${poses} facing ${actor.facing}${actor.holds ? ` holding a ${actor.holds}` : ''}; ${fix}`});
    }
  }
  // Sides: consecutive cast scenes that share a pair keep its order.
  const explicit = model => {
    const scene = (story.scenes ?? []).find(item => item.id === model.sceneId);
    const entries = Array.isArray(scene?.params?.cast) ? scene.params.cast : [];
    return new Set(entries.filter(entry => entry?.position !== undefined).map(entry => entry.id));
  };
  const scenes = models.filter(model => (model?.content?.actors ?? []).length > 1);
  for (let i = 1; i < scenes.length; i++) {
    const before = scenes[i - 1], after = scenes[i];
    const x = model => new Map(model.content.actors.map(actor => [actor.id, actor.x]));
    const a = x(before), b = x(after);
    const shared = [...a.keys()].filter(id => b.has(id));
    const placedA = explicit(before), placedB = explicit(after);
    for (let p = 0; p < shared.length; p++) for (let q = p + 1; q < shared.length; q++) {
      const [one, two] = [shared[p], shared[q]];
      if (Math.sign(a.get(one) - a.get(two)) === Math.sign(b.get(one) - b.get(two))) continue;
      if ([one, two].every(id => placedA.has(id) && placedB.has(id))) continue;
      const left = id => (a.get(id) < a.get(one === id ? two : one) ? 'left' : 'right');
      findings.push({scene: after.sceneId, id: one, detail: `${one} and ${two} swap sides between ${before.sceneId} and ${after.sceneId} (${one} was on the ${left(one)}); the cast list order sets the side, so keep it, or give both a position (or a story cast position) to keep them put; give both scenes explicit positions if the swap is meant`});
    }
  }
  return findings;
}

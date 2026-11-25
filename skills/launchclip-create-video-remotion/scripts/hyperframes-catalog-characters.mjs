// HyperFrames emitters for the character modules (cast-scene,
// character-cameo). Same shape as catalogue E (emitParts): the module's
// layer, a screen video hoisted to the root with the cast as its overlay,
// one op list for GSAP. emitParts lets GSAP own the rig joints' transforms
// (gsapOwnedTransforms in catalog-b.mjs).
//
// A cast scene with content.rigScene draws its characters per frame
// (kit/core/characters/rig-scene-layer.mjs): an empty rig layer in the tree,
// and a proxy tween over the scene whose onUpdate paints the frame at the
// timeline's time with the inlined painter (RIG_RUNTIME, once per page, added
// by the story compiler), the same pure function Remotion calls.

import {charactersTimeline, charactersView} from './catalog-characters.mjs';
import {rigLayerId, rigScenePrepare} from './characters/rig-scene-layer.mjs';
import {emitParts} from './hyperframes-catalog-e.mjs';

export {gsapOwnedTransforms, transformProps} from './hyperframes-catalog-b.mjs';

const num = value => Math.round(value * 1e4) / 1e4;
const js = value => JSON.stringify(value).replace(/</g, '\\u003c');

export function emitCharacters(model) {
  const out = emitParts(model, charactersView(model), charactersTimeline(model));
  return model.content?.rigScene ? {...out, motion: [out.motion, rigSceneMotion(model)].filter(Boolean).join('\n')} : out;
}

/** The rig layer's proxy tween: every update (and every seek) paints the frame at the clock's time. */
export function rigSceneMotion(model) {
  const plan = model.content.rigScene;
  const start = num(model.start), end = num(model.end);
  return `(function () {
  var host = document.getElementById(${js(rigLayerId(model))}), plan = ${js(plan)}, prepared = ${js(rigScenePrepare(plan))}, canvas = ${js({width: model.canvas.width, height: model.canvas.height})}, clock = {t: ${start}};
  var paint = function () { window.lcRigScene(host, plan, prepared, clock.t - ${start}, canvas); };
  paint();
  tl.fromTo(clock, {t: ${start}}, {t: ${end}, duration: ${num(end - start)}, ease: 'none', immediateRender: false, onUpdate: paint}, ${start});
})();`;
}

export const EMITTERS = {
  'cast-scene': emitCharacters,
  'character-cameo': emitCharacters,
  'sprite-scene': emitCharacters,
};

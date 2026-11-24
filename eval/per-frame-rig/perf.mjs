// What a per-frame rig frame costs (docs/rd/per-frame-rig.md): rigFrame
// replayed from 0 against resuming from the prepared checkpoints, and the
// whole scene tree, over the prototype's 8 s at 30 fps.
//   node eval/per-frame-rig/perf.mjs
import {rigFrame} from '@launchclip/core/characters/rig-frame.mjs';
import {prototypePlan, rigScenePrepare, rigSceneTree} from '@launchclip/core/characters/rig-scene.mjs';

const plan = prototypePlan();
let t0 = performance.now();
const prepared = rigScenePrepare(plan);
const prepareMs = performance.now() - t0;
const {track, walk, checkpoints} = prepared.actors.oliver;
const character = plan.actors[0].character;
const frames = Array.from({length: 241}, (_, i) => i / 30);
const time = fn => { const out = []; for (const t of frames) { const s = performance.now(); fn(t); out.push(performance.now() - s); } return out; };
const stats = ms => ({avg: ms.reduce((a, b) => a + b, 0) / ms.length, last: ms.slice(-30).reduce((a, b) => a + b, 0) / 30});
time(t => rigFrame(character, track, t, {plan: walk, checkpoints})); // warm up
const replay = stats(time(t => rigFrame(character, track, t, {plan: walk})));
const resumed = stats(time(t => rigFrame(character, track, t, {plan: walk, checkpoints})));
const tree = stats(time(t => rigSceneTree(plan, t, {width: 1080, height: 1920}, prepared)));
const r = x => Math.round(x * 1000) / 1000;
console.log(`prepare ${r(prepareMs)} ms (${JSON.stringify(prepared).length} bytes of JSON)`);
console.log(`rigFrame, replay from 0: avg ${r(replay.avg)} ms, last second ${r(replay.last)} ms`);
console.log(`rigFrame, from checkpoints: avg ${r(resumed.avg)} ms, last second ${r(resumed.last)} ms`);
console.log(`rigSceneTree (prepared): avg ${r(tree.avg)} ms, last second ${r(tree.last)} ms`);

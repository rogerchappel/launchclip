// World-camera parity (docs/KIT_CONTRACTS.md, "World camera"): whole-story
// stills of the camera goldens through both renderer adapters, at rest and
// mid-move (pans, the push into the gauge's gap bracket, the orbit and the
// motion-blurred whip-pan home). Slow, so it runs only with LAUNCHCLIP_PARITY=1.
// Times sit on the 30 fps frame grid: Remotion renders whole frames, so an
// off-grid time inside a whip-pan compares two different frames.
//
// Thresholds: cuts-mode camera moves hold the usual 0.97. World mode draws
// the parallax background's soft brand glows, whose gradient dithering the
// two Chrome pipelines rasterise differently (SSIM 0.968–0.976 on otherwise
// identical frames; 0.997 after a 2 px blur), so world stills use 0.96.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runStoryParity} from '../scripts/parity.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const enabled = process.env.LAUNCHCLIP_PARITY === '1';

export const CAMERA_PARITY = Object.freeze([
  {id: 'explainer-9x16', threshold: 0.97, times: [3.2, 4.6, 4.7, 4.8, 9.5]},
  {id: 'world-camera-9x16', threshold: 0.96, times: [1.2, 3.0, 3.1, 9.4, 12.5, 16.0, 18.0, 20.7, 22.6, 22.8, 22.9]}
]);

for (const {id, threshold, times} of CAMERA_PARITY) {
  test(`parity: camera story ${id}`, {skip: enabled ? false : 'set LAUNCHCLIP_PARITY=1 to render camera parity', timeout: 900_000}, async () => {
    const report = await runStoryParity(path.join(ROOT, 'examples', 'story', id), {times, threshold, out: path.join(ROOT, 'qa', 'parity', `camera-${id}`)});
    for (const sample of report.samples) assert.ok(sample.pass, `camera story ${id} t=${sample.time}: ssim ${sample.ssim} < ${threshold} (see ${report.outDir}/${sample.sideBySide})`);
  });
}

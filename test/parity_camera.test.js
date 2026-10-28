// World-camera parity (docs/KIT_CONTRACTS.md, "World camera"): whole-story
// stills of the camera goldens through both renderer adapters, at rest and
// mid-move (pans, the push into the gauge's gap bracket, the orbit and the
// motion-blurred whip-pan home). Slow, so it runs only with LAUNCHCLIP_PARITY=1.
// Times sit on the 30 fps frame grid: Remotion renders whole frames, so an
// off-grid time inside a whip-pan compares two different frames.
//
// Both hold the usual 0.97 (world-camera-9x16 measured 0.987–0.994 at these
// times). The parallax glows are small separate gradient elements on a fixed
// lattice: one huge multi-gradient layer, scaled with the zoom, dithered
// differently in the two Chrome pipelines and fell to 0.956. With ambient's
// field present the depth layer is the field alone (tiled across the world),
// never glows under it: the two stacked fell to 0.963 in 16:9.
//
// Seam check (blind-test regression): at t = 8 (settled after the first pan)
// the old field box's edge sat at x = 717 as a 3–4 level luma step in both
// renderers. A band of background-only rows across it must now step by less
// than 1.5 levels per column (the real gradient is ~0.5).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {runStoryParity} from '../scripts/parity.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const enabled = process.env.LAUNCHCLIP_PARITY === '1';

export const CAMERA_PARITY = Object.freeze([
  {id: 'explainer-9x16', threshold: 0.97, times: [3.2, 4.6, 4.7, 4.8, 9.5]},
  {id: 'world-camera-9x16', threshold: 0.97, times: [1.2, 3.0, 3.1, 8.0, 9.4, 12.5, 16.0, 18.0, 20.7, 22.6, 22.8, 22.9],
    seams: [{time: 8.0, y: 1600, x0: 600, x1: 1000}]},
  // Zooms inside a shot (kit/core/zooms.mjs): a box zoom on the title and a
  // target zoom on bar 0 handing over to bar 2, at rest inside each zoom and
  // mid-move, through the world camera and through cuts-mode wrappers.
  {id: 'zoom-world-9x16', threshold: 0.97, times: [0.8, 1.5, 2.6, 6.8, 8.0, 9.4, 10.6, 11.8]},
  {id: 'zoom-cuts-9x16', threshold: 0.97, times: [0.8, 1.5, 2.6, 6.8, 8.0, 9.4, 10.6, 11.8]},
  // The overview move: out over four held, frozen shots plus the incoming
  // one, the hold, the push in and settled.
  {id: 'overview-world-9x16', threshold: 0.97, times: [10.0, 16.6, 17.4, 18.2, 19.5]},
  // An evidence clip on a world plate: mid-push in, settled, inside a 1.5×
  // zoom in the shot, mid-pull out, and the overview with the clip held on
  // its last frame. Its <video> now rides the camera in HyperFrames (it was
  // left full-size on the root: 0.31 in the zoom). 0.9 as the d-evidence-clip
  // fixture: Chrome scales the testsrc <video> differently in each renderer
  // (0.948 settled, 0.910 at 1.5×); the frame, tag and cursor match.
  {id: 'evidence-world-16x9', threshold: 0.9, times: [3.5, 4.6, 6.6, 10.4, 15.8, 16.6, 17.4],
    files: {'assets/evidence-static.mp4': {from: 'test/fixtures/parity/assets/evidence-static.mp4'}}}
]);

// Largest luma step between neighbouring columns x0…x1, averaged over 16 rows from y.
export function columnStep(file, {y, x0, x1, rows = 16}) {
  const width = Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width', '-of', 'csv=p=0', file], {encoding: 'utf8'}).trim());
  const raw = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', `crop=${width}:${rows}:0:${y}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
  const col = (x) => { let sum = 0; for (let r = 0; r < rows; r += 1) sum += raw[r * width + x]; return sum / rows; };
  let max = 0;
  for (let x = x0; x < x1; x += 1) max = Math.max(max, Math.abs(col(x + 1) - col(x)));
  return max;
}

for (const {id, threshold, times, seams = [], files = null} of CAMERA_PARITY) {
  test(`parity: camera story ${id}`, {skip: enabled ? false : 'set LAUNCHCLIP_PARITY=1 to render camera parity', timeout: 900_000}, async () => {
    const report = await runStoryParity(path.join(ROOT, 'examples', 'story', id), {times, threshold, files, out: path.join(ROOT, 'qa', 'parity', `camera-${id}`)});
    for (const sample of report.samples) assert.ok(sample.pass, `camera story ${id} t=${sample.time}: ssim ${sample.ssim} < ${threshold} (see ${report.outDir}/${sample.sideBySide})`);
    for (const seam of seams) {
      const sample = report.samples.find((entry) => entry.time === seam.time);
      for (const still of [sample.hyperframes, sample.remotion]) {
        const step = columnStep(path.join(report.outDir, still), seam);
        assert.ok(step < 1.5, `camera story ${id} t=${seam.time} ${still}: background steps ${step.toFixed(2)} luma levels between columns ${seam.x0}–${seam.x1} (a seam)`);
      }
    }
  });
}

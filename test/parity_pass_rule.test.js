// The parity pass rule (scripts/parity.mjs samplePasses): SSIM decides, except
// on a near-black frame where SSIM misreads sub-visible banding.
import assert from 'node:assert/strict';
import test from 'node:test';
import {DEFAULT_THRESHOLD, samplePasses} from '../scripts/parity.mjs';

test('parity: a sample passes on SSIM, or on an invisible error when SSIM misreads a dark frame', () => {
  assert.equal(samplePasses({ssim: 0.97, psnr: 20}), true, 'at the threshold');
  // A near-black light-sweep frame measured on Linux: identical to the eye, about one grey level of error.
  assert.equal(samplePasses({ssim: 0.9249, psnr: 49.24}), true);
  assert.equal(samplePasses({ssim: 0.9249, psnr: 34}), false, 'a visible error still fails');
  // The light-sweep filter bug: one renderer dark, the other not.
  assert.equal(samplePasses({ssim: 0.1472, psnr: 9}), false);
  assert.equal(samplePasses({ssim: 0.85, psnr: 60}), false, 'a structural difference fails however small the error');
  assert.equal(samplePasses({ssim: 0.9, psnr: Infinity}), true, 'identical pixels pass');
  assert.equal(DEFAULT_THRESHOLD.ssim, 0.97, 'the SSIM threshold itself is unchanged');
});

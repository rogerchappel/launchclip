// Renderer parity (docs/KIT_CONTRACTS.md, "Parity harness"). Slow: it renders
// every fixture in test/fixtures/parity/ with HyperFrames and Remotion, so it
// runs only with LAUNCHCLIP_PARITY=1. Reports land in qa/parity/<fixture>/.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DEFAULT_ENTRY, runParity} from '../scripts/parity.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = path.join(ROOT, 'test', 'fixtures', 'parity');
const enabled = process.env.LAUNCHCLIP_PARITY === '1';
// The real kit entry once it exists; the test-only ModuleReview entry until then.
const entry = process.env.LAUNCHCLIP_PARITY_ENTRY ?? (existsSync(DEFAULT_ENTRY) ? DEFAULT_ENTRY : path.join(ROOT, 'test', 'fixtures', 'parity-entry', 'entry.tsx'));

for (const file of readdirSync(DIR).filter(name => name.endsWith('.json')).sort()) {
  test(`parity: ${file}`, {skip: enabled ? false : 'set LAUNCHCLIP_PARITY=1 to render parity fixtures', timeout: 600_000}, async () => {
    const report = await runParity(path.join(DIR, file), {entry, out: path.join(ROOT, 'qa', 'parity', file.replace(/\.json$/, ''))});
    for (const sample of report.samples) assert.ok(sample.pass, `${file} ${sample.name} t=${sample.time}: ssim ${sample.ssim} < ${report.threshold.ssim} (see ${report.outDir}/${sample.sideBySide})`);
  });
}

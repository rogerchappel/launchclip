// Every module is drawn by both renderers and has a per-module parity fixture
// (scripts/parity-coverage.mjs). Structural only: it reads the registries and
// the fixture files and renders nothing, so it runs in the fast suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FIXTURE_ALLOWLIST, moduleCoverage} from '../scripts/parity-coverage.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const report = await moduleCoverage();
const list = ids => ids.join(', ');

test('every module has a HyperFrames emitter', () => {
  assert.deepEqual(report.missingHyperframes, [], `add an emitter to an EMITTERS map in kit/hyperframes/ for: ${list(report.missingHyperframes)}`);
});

test('every module has a Remotion component', () => {
  assert.deepEqual(report.missingRemotion, [], `add a component to a registry merged by kit/remotion/modules/index.ts for: ${list(report.missingRemotion)}`);
});

test('neither renderer registers a module the core does not know', () => {
  assert.deepEqual(report.unknownHyperframes, [], `HyperFrames emitters with no module in kit/core: ${list(report.unknownHyperframes)}`);
  assert.deepEqual(report.unknownRemotion, [], `Remotion components with no module in kit/core: ${list(report.unknownRemotion)}`);
});

test('every module has a per-module parity fixture, or is on the allowlist', () => {
  assert.deepEqual(report.uncovered, [], `add a fixture under test/fixtures/parity/ (CONTRIBUTING.md, "Add a parity fixture") for: ${list(report.uncovered)}`);
  for (const files of Object.values(report.fixtures)) for (const file of files) assert.ok(existsSync(path.join(ROOT, file)), file);
});

test('the fixture allowlist only names known modules that still have no fixture', () => {
  assert.deepEqual(report.unknownAllowlist, [], `not a module: ${list(report.unknownAllowlist)}`);
  assert.deepEqual(report.staleAllowlist, [], `these now have a fixture, so remove them from FIXTURE_ALLOWLIST: ${list(report.staleAllowlist)}`);
  for (const [id, reason] of Object.entries(FIXTURE_ALLOWLIST)) assert.ok(typeof reason === 'string' && reason.length > 0, `${id} needs a reason`);
});

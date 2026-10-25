#!/usr/bin/env node
// Runs the media tests (test/helpers/media.js): every test file that imports
// the helper, with LAUNCHCLIP_MEDIA_TESTS=1. Extra arguments go to node --test.
//
//   npm run test:media
//   npm run test:media -- --test-name-pattern=remotion
import {spawnSync} from 'node:child_process';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEST = path.join(ROOT, 'test');

export function mediaTestFiles(dir = TEST) {
  return readdirSync(dir)
    .filter(name => name.endsWith('.test.js') && /from ["']\.\/helpers\/media\.js["']/.test(readFileSync(path.join(dir, name), 'utf8')))
    .sort()
    .map(name => path.join('test', name));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = mediaTestFiles();
  const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {...process.env, LAUNCHCLIP_MEDIA_TESTS: '1'}
  });
  process.exit(result.status ?? 1);
}

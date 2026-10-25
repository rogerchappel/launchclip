#!/usr/bin/env node
// Runs node --test with a temporary directory of its own, removed when the run
// ends. Test files and the Remotion bundler write to os.tmpdir(), and most never
// clean up, so without this every run leaves folders behind. Extra arguments go
// to node --test.
//
//   npm test
//   npm test -- test/beats.test.js
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function runTests(args, env = process.env) {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'launchclip-test-run-'));
  try {
    const result = spawnSync(process.execPath, ['--test', ...args], {
      stdio: 'inherit',
      env: {...env, TMPDIR: temporary, TMP: temporary, TEMP: temporary}
    });
    return result.status ?? 1;
  } finally {
    rmSync(temporary, {recursive: true, force: true});
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(runTests(process.argv.slice(2)));
}

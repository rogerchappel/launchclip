#!/usr/bin/env node
// Writes a parity fixture per module variant (test/fixtures/parity/
// g-<module>-<variant>.json): the variant-sheet sample in one scene, 9:16 for
// the first and third non-default variants, 16:9 for the rest, so each module
// is checked at both aspects. The default variant keeps its existing fixtures.
//
//   node scripts/variant-fixtures.mjs [--modules concept-card,icon-row]
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {moduleVariants} from '../kit/core/modules.mjs';
import {BRAND, SAMPLES} from './variant-sheet.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const at = process.argv.indexOf('--modules');
const all = moduleVariants();
const modules = at >= 0 ? process.argv[at + 1].split(',') : Object.keys(all);
// Catalogue G fixtures are g-<module>-<variant>; editorial ones <module>-<variant>; catalogue A a-<module>-<variant>.
const name_ = (module, variant) => (['checklist', 'step-rail', 'metric', 'callout'].includes(module) ? `${module}-${variant}` : ['hook-title', 'cta'].includes(module) ? `a-${module}-${variant}` : `g-${module}-${variant}`);
for (const module of modules) {
  for (const [i, variant] of all[module].slice(1).entries()) {
    const portrait = i % 2 === 0;
    const name = name_(module, variant);
    const story = {schema: 'launchclip.story.v1', title: `Variant parity: ${name}`, lane: 'motion',
      format: portrait ? {width: 1080, height: 1920, fps: 30, duration: 4, platform: 'youtube-shorts'} : {width: 1920, height: 1080, fps: 30, duration: 4, platform: 'youtube'},
      brand: BRAND, base: null, scenes: [{id: 'card', module, start: 0, end: 4, params: {...SAMPLES[module], variant}}]};
    await writeFile(path.join(ROOT, 'test', 'fixtures', 'parity', `${name}.json`), `${JSON.stringify({story, sceneId: 'card', threshold: {ssim: 0.97}}, null, 2)}\n`);
    console.log(name, portrait ? '9:16' : '16:9');
  }
}

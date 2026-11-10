#!/usr/bin/env node
// Contact sheet for the scene looks (kit/core/look.mjs): the test scene (two
// characters in a world, then a card) in each look, rendered by both
// renderers and compared. Look at it by eye after adding or changing a look.
//
//   node scripts/look-sheet.mjs [--out qa/looks] [--looks blueprint,hologram]
//     [--times 0.4,2,5] [--landscape] [--world office] [--frame] [--renderer hyperframes|remotion]
//
// Writes <out>/<look>/<time>-<renderer>.png, <out>/<look>/sheet.png
// (HyperFrames left, Remotion right, one pair per time) and prints the SSIM
// of each pair. "none" renders the scene with no look.

import {spawnSync} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {LOOK_NAMES, applyLook} from '@launchclip/core/look.mjs';
import {resolveStory} from '@launchclip/core/story.mjs';
import {compileStoryToHyperFrames} from '../kit/hyperframes/story-compiler.mjs';
import {getRenderer} from '../src/renderers/index.js';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const has = name => args.includes(name);
const out = resolve(flag('--out', 'qa/looks'));
const looks = flag('--looks', LOOK_NAMES.filter(name => name !== 'none').join(',')).split(',').filter(Boolean);
const times = flag('--times', '0.4,2,5').split(',').map(Number);
const renderers = flag('--renderer', 'hyperframes,remotion').split(',');
const landscape = has('--landscape');
// A look's palette fills these only where the look has none.
const FALLBACK = {bg: '#14122b', primary: '#6d5dfc', accent: '#ffb547', ink: '#14122b', paper: '#f6f3ee'};

/** The test scene with a look applied: two characters in a world for 4 s, then a card. */
export function lookTestStory(look, {landscape = false, world = 'office', frame = false} = {}) {
  const base = {
    schema: 'launchclip.story.v1', title: 'Rollback plan', lane: 'motion',
    format: landscape ? {width: 1920, height: 1080, fps: 30, duration: 6} : {width: 1080, height: 1920, fps: 30, duration: 6, platform: 'youtube-shorts'},
    brand: {fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}},
    world: {kind: world},
    cast: {characters: [{id: 'maya', position: 'left'}, {id: 'theo', position: 'right'}]},
    ...(look && look !== 'none' ? {look} : {}),
    ...(frame ? {frame: {kicker: {label: 'Ship mode'}}} : {}),
    scenes: [
      {id: 'room', module: 'world', start: 0, end: 4, params: {camera: 'drift'}},
      {id: 'pair', module: 'cast-scene', track: 1, start: 0, end: 4, params: {set: 'standing', cast: [{id: 'maya', pose: 'point', expression: 'happy'}, {id: 'theo', pose: 'wave', cues: [{at: 2.5, pose: 'think', expression: 'surprised'}]}]}},
      {id: 'idea', module: 'concept-card', start: 4, end: 6, params: {text: 'Test the rollback', icon: 'rocket', tone: 'primary'}}
    ]
  };
  const story = applyLook(base).story;
  story.brand.colors = {...FALLBACK, ...(story.brand.colors ?? {})};
  if (!story.cast.style) story.cast.style = 'flat';
  return story;
}

async function main() {
  for (const look of looks) {
    const project = join(out, `${look}${landscape ? '-wide' : ''}`);
    await mkdir(join(project, 'qa'), {recursive: true});
    const story = lookTestStory(look, {landscape, world: flag('--world', 'office'), frame: has('--frame')});
    await writeFile(join(project, 'storyboard.json'), `${JSON.stringify(story, null, 2)}\n`);
    if (renderers.includes('hyperframes')) await compileStoryToHyperFrames(resolveStory(story), {projectDir: project});
    await Promise.all(renderers.map(async renderer => {
      for (const t of times) await getRenderer(renderer).still(project, t, join(project, 'qa', `${t}-${renderer}.png`));
    }));
    const files = times.flatMap(t => renderers.map(renderer => join(project, 'qa', `${t}-${renderer}.png`)));
    const scores = renderers.length === 2 ? times.map(t => {
      const result = spawnSync('ffmpeg', ['-hide_banner', '-i', join(project, 'qa', `${t}-hyperframes.png`), '-i', join(project, 'qa', `${t}-remotion.png`), '-lavfi', 'ssim', '-f', 'null', '-'], {encoding: 'utf8'});
      return `${t}s ${(result.stderr.match(/All:([0-9.]+)/) ?? [null, '?'])[1]}`;
    }) : [];
    const width = Math.min(1920, (landscape ? 640 : 320) * files.length);
    spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...files.flatMap(file => ['-i', file]), '-filter_complex', `${files.map((_, i) => `[${i}]`).join('')}${files.length > 1 ? `hstack=inputs=${files.length},` : ''}scale=${width}:-1`, join(project, 'sheet.png')]);
    console.log(`${look}: ${join(project, 'sheet.png')}${scores.length ? ` (ssim ${scores.join(', ')})` : ''}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) await main();

#!/usr/bin/env node
// Turn measured narration word timings into short-form caption chunks plus a
// deterministic, seek-safe HyperFrames/GSAP runtime that highlights the active
// word. Usage:
//   node word-captions.mjs <NARRATION.json> <out-dir> [--max-words 3] [--max-chars 18]
// NARRATION.json may be {words:[{text,start,end}]} or a flat array of words.
// Chunking, runtime and CSS live in ./captions.mjs (a copy of
// kit/core/captions.mjs), which the Remotion WordCaptions component shares.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPTION_CSS, captionRuntime, chunkWords } from './captions.mjs';

export { CAPTION_CSS, CAPTION_MOTION, captionRuntime, chunkWords } from './captions.mjs';

async function main(argv) {
  const [input, outDir, ...rest] = argv;
  if (!input || !outDir) throw new Error('usage: word-captions.mjs <NARRATION.json> <out-dir> [--max-words N] [--max-chars N]');
  const flag = (name, fallback) => { const index = rest.indexOf(name); return index >= 0 ? Number(rest[index + 1]) : fallback; };
  const data = JSON.parse(await readFile(input, 'utf8'));
  const words = Array.isArray(data) ? data : data.words;
  if (!Array.isArray(words) || !words.length) throw new Error('No word timings found; captions need measured words, not segment-only times.');
  const chunks = chunkWords(words, { maxWords: flag('--max-words', 3), maxChars: flag('--max-chars', 18) });
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'captions.json'), `${JSON.stringify({ schema_version: 'launchclip.word-captions.v1', chunks }, null, 2)}\n`);
  await writeFile(path.join(outDir, 'captions.js'), captionRuntime(chunks));
  await writeFile(path.join(outDir, 'captions.css'), CAPTION_CSS);
  const covered = chunks.reduce((sum, chunk) => sum + chunk.words.length, 0);
  console.log(JSON.stringify({ chunks: chunks.length, words: covered, coverage: covered / words.length }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exit(1); });

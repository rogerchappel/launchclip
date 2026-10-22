// Project fonts for the parity verifiers that build a one-module HyperFrames
// project by hand (parity-b, parity-cat-a, parity-cat-b and the internal
// builder in parity.mjs). It does what kit/hyperframes/story-compiler.mjs does
// for a full project: copy the registry font files into fonts/, declare them
// with @font-face and start them loading before the fonts.ready wait, so the
// HyperFrames stills use the same bundled files as Remotion.
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {FONT_WARMUP, copyProjectFonts, projectFontFaces} from '../kit/hyperframes/story-compiler.mjs';

/** Adds the story's fonts to <projectDir>/index.html (written already) → warnings */
export async function injectParityFonts(story, projectDir) {
  const fonts = await projectFontFaces(story?.brand, {sourceDir: projectDir});
  await copyProjectFonts(fonts.copies, projectDir);
  const file = path.join(projectDir, 'index.html');
  const html = await readFile(file, 'utf8');
  if (!html.includes('</head>')) throw new Error(`${file} has no </head> to put the font faces in`);
  await writeFile(file, html.replace('</head>', `<style>${fonts.css}</style><script>${FONT_WARMUP}</script></head>`));
  return fonts.warnings;
}

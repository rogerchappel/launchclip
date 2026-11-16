// Silkscreen: the frame pulled through up to six flat inks on cream stock,
// a halftone screen in the mid-tones and the screens slightly out of
// register. The look is a finish (docs/FINISHING_AND_ELEMENTS_RFC.md §E.1):
// it lists passes for src/finish_pass.js instead of an SVG grade.
//
// Finish: `silkscreen` (each pixel to its nearest ink, the mid-tones a
// halftone of the second-nearest read off register), then a light `grain`.
// A story's own finish entries win, pass by pass.

const PAPER = '#f2ead8', INK = '#1d1b26';

export const LOOK = {
  describe: 'the frame screen-printed in six flat inks on cream stock (black, vermilion, blue, yellow, green), a halftone screen in the mid-tones and the screens slightly out of register',
  words: ['\\bsilk[- ]?screen(?:ed)?\\b', '\\bscreen[- ]print(?:ed)?\\b', '\\bserigraph\\b', '\\bwarhol (?:look|style)\\b'],
  defaults: { strength: 1, step: 0 },
  // The ink set, so the brand's cards land on solid inks rather than on the screen.
  presets: () => ({ colors: { bg: PAPER, primary: '#2b6cb0', accent: '#e4572e', ink: PAPER, paper: INK } }),
  finish: [{ pass: 'silkscreen' }, { pass: 'grain', amount: 0.04, size: 1.5 }]
};

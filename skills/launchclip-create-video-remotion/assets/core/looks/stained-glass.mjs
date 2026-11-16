// Stained glass: the frame as backlit panes of coloured glass in thick lead
// lines, streaked and bubbled, with a bloom that eats into the lead. The
// look is a finish (docs/FINISHING_AND_ELEMENTS_RFC.md §E.1): it reads the
// finished frame, so it lists passes for src/finish_pass.js instead of an SVG
// grade, and both renderers draw the scenes untouched beneath it.
//
// Finish: `stained-glass` (a seeded Voronoi of panes, each the picture's
// colour at its site, lead on every border and on the picture's strong
// edges), then `bloom`. A story's own finish entries win, pass by pass.
//
// Technique rewritten from the reference demo's description (§E.10).

export const LOOK = {
  describe: 'the frame as backlit panes of stained glass in thick lead lines, each pane the picture\'s colour, streaked and bubbled, with a glow that eats into the lead',
  words: ['\\bstained[- ]glass\\b', '\\bleaded glass\\b', '\\bcathedral window (?:look|style)\\b'],
  defaults: { strength: 1, step: 0 },
  // Deep jewel tones that read as glass once lit.
  presets: () => ({ colors: { bg: '#141026', primary: '#e0a526', accent: '#2f6fd6', ink: '#141026', paper: '#fbf3dc' } }),
  finish: [{ pass: 'stained-glass' }, { pass: 'bloom', threshold: 0.6, radius: 1.2, strength: 0.9, tint: '#fff2d6' }]
};

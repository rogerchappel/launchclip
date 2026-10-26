// Composing characters and cards together (docs/DIRECTION_GUARDRAILS.md §5):
// the planner vocabulary for a dense frame, and the bands a 9:16 shot uses.
// The density and variety gates (src/direction_guardrails.js) measure the
// result; these lines tell the planner how to get there.
//
// Pure ESM; no imports.

/** Where things go in a 9:16 frame, as shares of the height (top → bottom). */
export const PORTRAIT_BANDS = Object.freeze({ card: [0.12, 0.45], captions: [0.6, 0.74], cast: [0.45, 0.95] });

/** Planner lines on density, variety and 9:16 composition (planning prompt, skills). */
export function compositionPromptLines() {
  return [
    'Density: every third of the frame (top, middle, bottom in 9:16) has something in it within 4 s; a card never sits alone over an empty set for more than 3 s. Keep a character in the shot under a card, reacting to it or pointing at it.',
    'Variety: never repeat a shot back to back. Two cast scenes in a row need a different set, a different cast or different poses and actions; moving the same pair to a new background is not a new shot.',
    `9:16 composition: a card takes the top band (about ${Math.round(PORTRAIT_BANDS.card[0] * 100)}–${Math.round(PORTRAIT_BANDS.card[1] * 100)}% of the height, rect y ≈ 230–860 at 1080x1920), the cast stands in the lower half on the world's ground, and captions sit in the band between them. Use at most two seated characters in 9:16.`,
    'A proof or quote beat keeps the cast on screen: the speaker points up at the card (point-at {x, y} of the card) or reacts to it, rather than leaving the set empty.'
  ];
}

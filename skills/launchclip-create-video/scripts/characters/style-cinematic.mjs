// Drawing style "cinematic": the lifelike body (real.mjs) lit like a film
// frame by the scene's key light (light.mjs): warm highlights and cool,
// deeper shadows; a rim of the light's colour on every lit edge; light
// falling off down the body; and a long soft shadow cast on the floor away
// from the light (longer as the light drops). Worlds pass their own light, so
// the cast sits in the world's light; without one it is a soft key from the
// upper left.
//
// Imports only sibling kit/core files.

import {drawReal, realGeometry, realHeight} from './real.mjs';

export function drawCinematic(params, colors, options) {
  const k = options?.light?.intensity ?? 0.55;
  return drawReal(params, colors, options, {cinematic: true, falloff: {torso: 0.03 + 0.03 * k, legs: 0.08 + 0.12 * k}});
}

export const STYLE = {draw: drawCinematic, height: realHeight, geometry: realGeometry, describe: 'cinematic: lifelike, with a rim light, cast shadow and falloff from the scene\'s key light'};

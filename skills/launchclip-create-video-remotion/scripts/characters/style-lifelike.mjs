// Drawing style "lifelike": realistic proportions, anatomical contours,
// hands with fingers, detailed faces and hair, and layered gradient shading
// from the key light (real.mjs, real-pen.mjs).
//
// Imports only sibling kit/core files.

import {drawReal, realGeometry, realHeight} from './real.mjs';

export function drawLifelike(params, colors, options) {
  return drawReal(params, colors, options, {cinematic: false});
}

export const STYLE = {draw: drawLifelike, height: realHeight, geometry: realGeometry, describe: 'lifelike: realistic proportions, layered shading, detailed faces, hair and hands'};

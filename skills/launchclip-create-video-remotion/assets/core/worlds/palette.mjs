// World palettes: the brand palette regraded for a time of day.
//
// A world is drawn from neutral materials (wood, brick, foliage, asphalt…)
// and the brand's primary and accent (awnings, doors, mugs, neon), then
// graded for the time: day is neutral and bright, dusk is warm and lower,
// night is deep blue. Emissive colours (lit windows, lamps, neon, screens,
// the sun and moon) are never graded, so a night world glows. Inside worlds
// at night are lit by their lamps, so they grade milder than the street.
//
// Imports only sibling kit/core files.

import {mixColor, luminance} from '../catalog-b-base.mjs';

export const WORLD_TIMES = Object.freeze(['day', 'dusk', 'night']);

const HEX6 = /^#[0-9a-f]{6}$/i;

// Grades: the tint mixed in, then a brightness multiply, then a pull toward
// the time's shadow hue for the darkest materials.
const GRADE = {
  outside: {
    day: {tint: '#fff6e6', amount: 0.05, bright: 1},
    dusk: {tint: '#ff7b4a', amount: 0.2, bright: 0.8},
    night: {tint: '#22346e', amount: 0.55, bright: 0.4}
  },
  inside: {
    day: {tint: '#fff8ec', amount: 0.04, bright: 1},
    dusk: {tint: '#ff8a4c', amount: 0.2, bright: 0.8},
    night: {tint: '#2c2342', amount: 0.4, bright: 0.44}
  }
};

// Sky and light per time (before the brand tint).
const SKY = {
  day: {top: '#4f93db', mid: '#93c3ee', low: '#dbeef9', sun: '#fff8dc', key: '#fff1d6', keyIntensity: 0.9, shadow: '#1f2f52', shadowAlpha: 0.2, haze: '#e4eef8', hazeAlpha: 0.38, cloud: '#ffffff'},
  dusk: {top: '#272a5e', mid: '#b4566d', low: '#ffb466', sun: '#ffd894', key: '#ffad63', keyIntensity: 0.66, shadow: '#3b1d3c', shadowAlpha: 0.32, haze: '#ff9f72', hazeAlpha: 0.3, cloud: '#ffb48c'},
  night: {top: '#04071a', mid: '#0c1537', low: '#1e2c5c', sun: '#eef2ff', key: '#a6b8ff', keyIntensity: 0.34, shadow: '#000000', shadowAlpha: 0.46, haze: '#2a3a74', hazeAlpha: 0.28, cloud: '#2b3766'}
};

// Neutral materials, drawn in daylight.
const MATERIAL = {
  wood: '#b88156', woodShade: '#8d5d3a', woodLight: '#d6a274',
  metal: '#a4acb6', metalShade: '#6f7883', metalLight: '#d4d9df',
  concrete: '#b3aea6', concreteShade: '#8c877f',
  asphalt: '#40444d', asphaltShade: '#2f333a', line: '#e9e3d2',
  brick: '#b4624a', brickShade: '#8e4a37',
  foliage: '#4f9150', foliageShade: '#3a6f3f', foliageLight: '#7ab865',
  grass: '#79b35d', grassShade: '#5b9149', trunk: '#7a5236',
  sand: '#ead19c', sandShade: '#d1b47c', water: '#3a8fc4', waterLight: '#8fd0ee',
  rock: '#8d8a88', rockShade: '#66625f', rockLight: '#b4b0aa', snow: '#f4f7fc',
  white: '#f7f5f0', black: '#1e2027', glass: '#bfd9ea', fabric: '#6c7a8f', skin: '#d9a07a'
};

const hexOk = value => typeof value === 'string' && HEX6.test(value);
const dark = (hex, amount) => mixColor('#000000', hex, amount);
const light = (hex, amount) => mixColor('#ffffff', hex, amount);

/** Is a colour dark (for picking outline and text tones)? */
export const isDark = hex => luminance(hex) < 0.2;

/**
 * The palette for a world group (inside | outside) at a time, from the
 * brand colours {bg, primary, accent, ink, paper}. Every value is #rrggbb.
 * `g(hex)` grades any extra colour the same way (props use it).
 */
export function worldPalette(colors, time = 'day', group = 'outside') {
  const brand = {primary: '#3d7cff', accent: '#ff7a59', bg: '#101218', paper: '#f4f1ea', ink: '#101218', ...Object.fromEntries(Object.entries(colors ?? {}).filter(([, v]) => hexOk(v)).map(([k, v]) => [k, v.toLowerCase()]))};
  const grade = GRADE[group === 'inside' ? 'inside' : 'outside'][time] ?? GRADE.outside.day;
  const g = hex => {
    const tinted = mixColor(grade.tint, hex, grade.amount);
    return grade.bright >= 1 ? tinted : dark(tinted, 1 - grade.bright);
  };
  const sky = SKY[time] ?? SKY.day;
  // The brand tints the sky a little: primary by day and night, accent at dusk.
  const skyTint = time === 'dusk' ? brand.accent : brand.primary;
  const tintSky = (hex, amount) => mixColor(skyTint, hex, amount);
  const m = Object.fromEntries(Object.entries(MATERIAL).map(([k, v]) => [k, g(v)]));
  const wallBase = mixColor(brand.primary, '#eee8dd', 0.12);
  const floorBase = mixColor(brand.primary, '#c9b39a', 0.08);
  const primary = g(brand.primary), accent = g(brand.accent);
  const pal = {
    time, group, brand, g,
    skyTop: tintSky(sky.top, time === 'night' ? 0.03 : 0.12), skyMid: tintSky(sky.mid, time === 'night' ? 0.04 : 0.1), skyLow: tintSky(sky.low, time === 'night' ? 0.05 : 0.06),
    sun: sky.sun, key: sky.key, keyIntensity: sky.keyIntensity,
    shadow: sky.shadow, shadowAlpha: sky.shadowAlpha, haze: sky.haze, hazeAlpha: sky.hazeAlpha,
    cloud: time === 'night' ? sky.cloud : mixColor(sky.cloud, sky.low, 0.75),
    star: '#f3f5ff', moon: '#eef1fb',
    ...m,
    ink: time === 'night' ? '#090b16' : g('#1d1f2a'),
    wall: g(wallBase), wallShade: g(dark(wallBase, 0.12)), wallLight: g(light(wallBase, 0.3)), trim: g(light(wallBase, 0.55)),
    floor: g(floorBase), floorShade: g(dark(floorBase, 0.16)), floorLight: g(light(floorBase, 0.18)),
    primary, primaryShade: dark(primary, 0.22), primaryLight: light(primary, 0.28),
    accent, accentShade: dark(accent, 0.22), accentLight: light(accent, 0.28),
    paper: g(brand.paper), cream: g('#f3ead8'),
    // Emissive: never graded.
    lit: time === 'night' ? '#ffd27e' : time === 'dusk' ? '#ffd7a0' : '#fff3cf',
    lamp: '#ffe2a6', lampWarm: '#ffbf6a',
    neonA: light(brand.primary, 0.18), neonB: light(brand.accent, 0.18),
    screen: time === 'night' ? '#9cc4ff' : '#7fb0e8', screenDark: '#141824',
    // Window glass seen from inside: the sky outside.
    view: time === 'night' ? '#0d1638' : time === 'dusk' ? '#f0956a' : '#bfe0f6',
    viewLow: time === 'night' ? '#1b2650' : time === 'dusk' ? '#ffc583' : '#e6f3fb',
    // Distant silhouettes (far hills, skylines) sit into the sky's haze.
    far: time === 'night' ? '#121a3c' : time === 'dusk' ? mixColor('#6b3f6e', tintSky(sky.mid, 0.1), 0.6) : mixColor('#8fb0c9', sky.low, 0.7),
    farther: time === 'night' ? '#0e1531' : time === 'dusk' ? mixColor('#b4607a', tintSky(sky.mid, 0.1), 0.5) : mixColor('#b2cbdd', sky.low, 0.6)
  };
  return pal;
}

/** Light that a world at a time throws on characters: {dir:{x,y}, color, intensity}. */
export function timeLight(time, {dir = null, color = null, intensity = null, inside = false} = {}) {
  const sky = SKY[time] ?? SKY.day;
  const base = {
    day: {x: 0.5, y: 0.87},
    dusk: {x: 0.94, y: 0.34},
    night: {x: -0.42, y: 0.91}
  }[time] ?? {x: 0.5, y: 0.87};
  const d = dir ?? base;
  const len = Math.hypot(d.x, d.y) || 1;
  const warmNight = inside && time === 'night';
  return {
    dir: {x: Math.round(d.x / len * 1000) / 1000, y: Math.round(d.y / len * 1000) / 1000},
    color: color ?? (warmNight ? '#ffd29a' : sky.key),
    intensity: intensity ?? (warmNight ? 0.55 : sky.keyIntensity)
  };
}

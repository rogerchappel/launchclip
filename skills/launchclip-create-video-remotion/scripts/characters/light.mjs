// The light a character stands in: one key light, which the shaded drawing
// styles read (soft-shade and lifelike shade away from it, outlined puts its
// cel shadow on the far side, cinematic adds a rim light on the lit edges, a
// cast shadow on the floor and depth falloff). Worlds (kit/core/worlds/)
// supply it to match their own lighting; a scene may set it too.
//
//   light = {dir, color, intensity}
//     dir        degrees: the screen direction the light comes from;
//                0 = from the right, 90 = from straight above, 180 = from
//                the left (y up). Default 125: a key light high on the left.
//     color      #rrggbb, the light's tint (default a soft warm white)
//     intensity  0..1: 0 is flat ambient light, 1 a hard key (default 0.55)
//
// Imports nothing.

export const DEFAULT_LIGHT = Object.freeze({dir: 125, color: '#fff1dc', intensity: 0.55});
const HEX6 = /^#[0-9a-fA-F]{6}$/;
const isObj = value => value && typeof value === 'object' && !Array.isArray(value);

/** Problems with a light, as strings (empty when it is valid or absent). */
export function lightErrors(light, path = 'light') {
  if (light === undefined || light === null) return [];
  if (!isObj(light)) return [`${path} must be {dir?, color?, intensity?}`];
  const errors = [];
  for (const key of Object.keys(light)) if (!['dir', 'color', 'intensity'].includes(key)) errors.push(`${path}.${key} is not supported (allowed: dir, color, intensity)`);
  if (light.dir !== undefined && !(Number.isFinite(light.dir) && light.dir >= -360 && light.dir <= 360)) errors.push(`${path}.dir must be degrees (0 = from the right, 90 = from above, 180 = from the left)`);
  if (light.color !== undefined && !(typeof light.color === 'string' && HEX6.test(light.color))) errors.push(`${path}.color must be a six-digit hex`);
  if (light.intensity !== undefined && !(Number.isFinite(light.intensity) && light.intensity >= 0 && light.intensity <= 1)) errors.push(`${path}.intensity must be 0 to 1`);
  return errors;
}

/**
 * A complete light: the defaults filled in, dir in [0, 360). Throws on an
 * invalid light. → {dir, color, intensity, x, y}, where (x, y) is the unit
 * vector toward the light on screen (y down, SVG).
 */
export function normalizeLight(light = null, path = 'light') {
  const errors = lightErrors(light, path);
  if (errors.length) throw new Error(errors.join('; '));
  const dir = (((light?.dir ?? DEFAULT_LIGHT.dir) % 360) + 360) % 360;
  const rad = dir * Math.PI / 180;
  const r4 = value => Math.round(value * 10000) / 10000;
  return {dir, color: (light?.color ?? DEFAULT_LIGHT.color).toLowerCase(), intensity: light?.intensity ?? DEFAULT_LIGHT.intensity, x: r4(Math.cos(rad)), y: r4(-Math.sin(rad))};
}

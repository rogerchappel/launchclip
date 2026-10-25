// Detail levels: how richly a world is drawn, following the cast's drawing
// style so a stick-figure video gets a simple world and a cinematic one gets
// light, haze and depth.
//
//   simple    flat fills, fewer small objects, ink outlines (stick, line)
//   standard  flat fills with soft gradients, shadows and glows (flat,
//             outlined, paper, soft-shade)
//   rich      shaded gradients, haze between the depth layers, depth of
//             field on the back layer, light pools and volumetric rays
//             (lifelike, cinematic)
//
// The drawing style also flavours its level: line and stick worlds are
// drawn as pale fills under ink lines, outlined worlds keep standard detail
// with outlines, paper worlds lift each layer on a cut-paper shadow, and
// cinematic worlds add a vignette and a stronger grade.

export const DETAIL_LEVELS = Object.freeze(['simple', 'standard', 'rich']);
export const STYLE_DETAIL = Object.freeze({
  stick: 'simple', line: 'simple',
  flat: 'standard', outlined: 'standard', paper: 'standard', 'soft-shade': 'standard',
  lifelike: 'rich', cinematic: 'rich'
});
export const WORLD_STYLES = Object.freeze(Object.keys(STYLE_DETAIL));

/** The detail level for a drawing style (unknown styles draw at standard). */
export function detailForStyle(style) {
  return STYLE_DETAIL[style] ?? 'standard';
}

/**
 * Everything the pen and the worlds read about detail:
 * {level, n (0 | 1 | 2), style, outline, outlineWidth, mono, gradients,
 * shadows, glows, haze, dof (back-layer blur, px at 1080), pools, rays,
 * vignette, paperLift, grade}.
 */
export function detailSpec(level = 'standard', style = null) {
  const lvl = DETAIL_LEVELS.includes(level) ? level : 'standard';
  const n = DETAIL_LEVELS.indexOf(lvl);
  const s = style ?? {simple: 'line', standard: 'flat', rich: 'lifelike'}[lvl];
  const outline = ['stick', 'line', 'outlined'].includes(s);
  return {
    level: lvl, n, style: s,
    outline,
    outlineWidth: s === 'stick' ? 3.2 : s === 'line' ? 2.6 : 3,
    mono: s === 'stick' || s === 'line',
    gradients: n >= 1,
    shadows: n >= 1,
    glows: true,
    haze: n >= 1 ? (n === 2 ? 1 : 0.55) : 0,
    dof: n === 2 ? (s === 'cinematic' ? 3.2 : 2.2) : 0,
    pools: n >= 1,
    rays: n === 2 || s === 'soft-shade',
    vignette: s === 'cinematic' ? 0.5 : n === 2 ? 0.28 : 0,
    paperLift: s === 'paper',
    grade: s === 'cinematic'
  };
}

// Panel treatments (docs/SEEDED_STYLES_RFC.md §3.2): the surface a module's
// card or panel sits on, chosen once per video by story.panel (a style pack's
// layouts.panel, merged by kit/core/style.mjs applyStyle). Plain ESM, no
// imports. Contract: docs/KIT_CONTRACTS.md, "Backgrounds and panels".
//
//   solid        an opaque brand-background card with a thin border and drop
//                shadow (today's card; the default when story.panel is absent)
//   glass        a translucent card that blurs what is behind it
//   paper        a sheet a shade off the background, with a crisp edge shadow
//   outline      no fill to speak of: a primary-colour border over a faint wash
//   soft-shadow  an opaque card with no border, lifted by a wide, soft shadow
//   rim-glass    the long-form explainer's glass: a translucent, blurred
//                fill, a 1 px primary rim with an outer glow and a soft inner
//                highlight; catalogue H frames and tables opt in through
//                glassSurface() (VISUAL_GAP_MAP D5)
//
// Every treatment follows the theme: panelTheme() reads light or dark from the
// background, and shadows, borders and glass tints change with it. Text on a
// panel stays the module's own colour (paper on bg), so each fill keeps to the
// background's side of the contrast; panelFill() says what text sits on, for
// the contrast gate (kit/core/backgrounds.mjs backgroundContrastFindings).

export const PANEL_TREATMENTS = Object.freeze(['solid', 'glass', 'paper', 'outline', 'soft-shadow', 'rim-glass']);
export const PANEL_RADIUS = Object.freeze({ min: 0, max: 48 });

const HEX = /^#[0-9a-fA-F]{6}$/;
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const r2 = (value) => Math.round(value * 100) / 100;

/** Validation messages for story.panel (empty = valid). */
export function panelErrors(value, path = 'panel') {
  if (value === undefined || value === null) return [];
  if (!isObject(value)) return [`${path} must be an object {treatment, radius?, fill?}`];
  const errors = [];
  for (const key of Object.keys(value)) if (!['treatment', 'radius', 'fill'].includes(key)) errors.push(`${path}.${key} is not supported (allowed: treatment, radius, fill)`);
  // fill is a background {kind, params}: kit/core/backgrounds.mjs backgroundErrors checks it.
  if (value.fill !== undefined && !isObject(value.fill)) errors.push(`${path}.fill must be a background {kind, params?}`);
  if (!PANEL_TREATMENTS.includes(value.treatment)) errors.push(`${path}.treatment must be one of ${PANEL_TREATMENTS.join(', ')}`);
  if (value.radius !== undefined && !(typeof value.radius === 'number' && value.radius >= PANEL_RADIUS.min && value.radius <= PANEL_RADIUS.max)) errors.push(`${path}.radius must be a number from ${PANEL_RADIUS.min} to ${PANEL_RADIUS.max} (px at a 1080 px short side)`);
  return errors;
}

/**
 * The story's panel → {treatment, radius | null, fill?}, or null when the
 * story sets none (today's cards). fill is the raw {kind, params} a panel
 * carries inside it (kit/core/backgrounds.mjs panelFillPlan resolves it).
 */
export function storyPanel(story) {
  const value = story?.panel;
  if (!isObject(value) || !PANEL_TREATMENTS.includes(value.treatment)) return null;
  return { treatment: value.treatment, radius: typeof value.radius === 'number' ? value.radius : null, ...(isObject(value.fill) ? { fill: value.fill } : {}) };
}

// ---------------------------------------------------------------------------
// Colour

export function rgbOf(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

export function hexOf(rgb) {
  return `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

/** a mixed toward b by k (0 → a, 1 → b), in sRGB as a browser composites. */
export function mix(a, b, k) {
  const A = rgbOf(a), B = rgbOf(b);
  return hexOf(A.map((v, i) => v + (B[i] - v) * k));
}

/** WCAG relative luminance. */
export function relativeLuminance(hex) {
  const [r, g, b] = rgbOf(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two #rrggbb colours. */
export function contrast(a, b) {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** #rrggbb + alpha (0–1) → #rrggbbaa. */
export function withAlpha(hex, alpha) {
  return `${hex}${Math.max(0, Math.min(255, Math.round(alpha * 255))).toString(16).padStart(2, '0')}`;
}

/** "light" when the background is lighter than mid grey (text on it is dark), else "dark". */
export function panelTheme(colors = {}) {
  const bg = HEX.test(colors.bg ?? '') ? colors.bg : '#000000';
  return contrast(bg, '#000000') > contrast(bg, '#ffffff') ? 'light' : 'dark';
}

// ---------------------------------------------------------------------------
// Surfaces

/**
 * What text on the panel sits on → {color, alpha}: the panel fill and how
 * opaque it is (alpha < 1 lets the background through; the gate composites it
 * over every background tone).
 */
export function panelFill(treatment, colors) {
  const { bg, paper } = colors;
  const light = panelTheme(colors) === 'light';
  switch (treatment) {
    case 'glass': return { color: light ? mix(bg, '#ffffff', 0.35) : bg, alpha: light ? 0.7 : 0.66 };
    // A breath of the rim colour in the glass, so the panel reads as lit by its own edge.
    case 'rim-glass': return { color: light ? mix(bg, '#ffffff', 0.4) : mix(bg, colors.primary ?? paper, 0.06), alpha: light ? 0.72 : 0.58 };
    case 'paper': return { color: mix(bg, paper, light ? 0.03 : 0.06), alpha: 1 };
    case 'outline': return { color: bg, alpha: 0.35 };
    case 'soft-shadow': return { color: mix(bg, paper, light ? 0.02 : 0.04), alpha: 1 };
    default: return { color: bg, alpha: 1 };
  }
}

/**
 * CSS (camelCase) for a panel surface of a given treatment.
 *   treatment  one of PANEL_TREATMENTS
 *   colors     the brand colours {bg, paper, primary, ...}
 *   unit       canvas short side / 1080
 *   border     the module theme's border colour (solid keeps it)
 *   radius     corner radius in px at 1080 (default 32, today's card)
 * solid with the default radius is exactly today's card surface.
 */
export function panelSurfaceStyle(treatment, { colors, unit = 1, border, radius = 32 } = {}) {
  const u = (value) => r2(value * unit);
  const light = panelTheme(colors) === 'light';
  const fill = panelFill(treatment, colors);
  const background = fill.alpha < 1 ? withAlpha(fill.color, fill.alpha) : fill.color;
  const shadowInk = light ? mix(colors.bg, '#000000', 0.7) : '#000000';
  const base = { boxSizing: 'border-box', borderRadius: u(radius), background };
  switch (treatment) {
    case 'glass':
      return { ...base, backdropFilter: `blur(${u(18)}px)`, border: `${u(1.5)}px solid ${light ? withAlpha('#ffffff', 0.7) : withAlpha(colors.paper, 0.22)}`,
        boxShadow: `0 ${u(16)}px ${u(44)}px ${withAlpha(shadowInk, light ? 0.14 : 0.4)}` };
    case 'rim-glass': {
      const rim = colors.primary ?? colors.paper;
      // The sheen: a top-lit gradient over the fill; the inner highlight is a
      // hairline along the top edge and a faint inner wash of the rim colour.
      return { ...base, background: `linear-gradient(180deg, ${withAlpha('#ffffff', light ? 0.3 : 0.07)} 0%, ${withAlpha('#ffffff', 0)} 38%), ${background}`,
        backdropFilter: `blur(${u(24)}px) saturate(1.2)`, border: `${u(1.5)}px solid ${withAlpha(rim, light ? 0.85 : 0.78)}`,
        boxShadow: [`inset 0 ${u(1)}px 0 ${withAlpha('#ffffff', light ? 0.6 : 0.16)}`, `inset 0 0 ${u(28)}px ${withAlpha(rim, light ? 0.06 : 0.1)}`,
          `0 0 ${u(2)}px ${withAlpha(rim, 0.55)}`, `0 0 ${u(22)}px ${withAlpha(rim, light ? 0.22 : 0.32)}`, `0 ${u(26)}px ${u(64)}px ${withAlpha(shadowInk, light ? 0.16 : 0.5)}`].join(', ') };
    }
    case 'paper':
      return { ...base, border: `${u(1)}px solid ${mix(colors.bg, colors.paper, light ? 0.1 : 0.14)}`,
        boxShadow: `0 ${u(2)}px 0 ${withAlpha(shadowInk, light ? 0.12 : 0.5)}, 0 ${u(10)}px ${u(22)}px ${withAlpha(shadowInk, light ? 0.1 : 0.35)}` };
    case 'outline':
      return { ...base, border: `${u(3)}px solid ${colors.primary}`, boxShadow: 'none' };
    case 'soft-shadow':
      return { ...base, border: 'none', boxShadow: `0 ${u(28)}px ${u(72)}px ${withAlpha(shadowInk, light ? 0.18 : 0.6)}, 0 ${u(6)}px ${u(16)}px ${withAlpha(shadowInk, light ? 0.08 : 0.3)}` };
    default:
      return { ...base, border: `${u(2)}px solid ${border}`, boxShadow: `0 ${u(18)}px ${u(48)}px #00000073` };
  }
}

/**
 * The glass role for a module that draws its own frame (a window, a table, a
 * card group): the rim-glass surface CSS when the story's panel is rim-glass
 * (model.panel, copied by resolveModule), else null and the module keeps its
 * own look. radius in px at 1080 (default: the panel's, else 24).
 */
export function glassSurface(model, { radius } = {}) {
  if (model?.panel?.treatment !== 'rim-glass' || !model.theme) return null;
  return panelSurfaceStyle('rim-glass', { colors: model.theme, unit: model.unit ?? 1, radius: radius ?? model.panel.radius ?? 24 });
}

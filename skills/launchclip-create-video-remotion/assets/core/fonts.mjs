// Brand font roles → CSS family names and fallback stacks, shared by the
// HyperFrames compiler and the Remotion kit so both resolve brand.fonts the
// same way. Plain ESM with no imports. Canonical copy: kit/core/fonts.mjs.
//
// storyboard.json names fonts by slug ("space-grotesk") or by family
// ("Space Grotesk"). Slugs map to Google Fonts family names.

// Slugs whose family name is not simple title case.
const SPECIAL = Object.freeze({
  'jetbrains-mono': 'JetBrains Mono', 'ibm-plex-mono': 'IBM Plex Mono', 'ibm-plex-sans': 'IBM Plex Sans',
  'ibm-plex-serif': 'IBM Plex Serif', 'ibm-plex-sans-condensed': 'IBM Plex Sans Condensed', 'dm-sans': 'DM Sans',
  'dm-mono': 'DM Mono', 'dm-serif-display': 'DM Serif Display', 'pt-sans': 'PT Sans', 'pt-serif': 'PT Serif',
  'pt-mono': 'PT Mono', 'eb-garamond': 'EB Garamond', 'noto-sans-jp': 'Noto Sans JP', 'mplus-1p': 'M PLUS 1p',
  'source-code-pro': 'Source Code Pro', 'bebas-neue': 'Bebas Neue', 'sf-pro': 'SF Pro'
});

// Fallback stacks per role, so a font that fails to load degrades to a
// deliberate system face, not to Times.
export const FONT_FALLBACKS = Object.freeze({
  display: "'Arial Narrow', 'Helvetica Neue', Impact, system-ui, sans-serif",
  body: "system-ui, -apple-system, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
  meta: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
});

export const FONT_ROLES = Object.freeze(['display', 'body', 'meta']);

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'cursive']);

/** "space-grotesk" → "Space Grotesk"; a name with capitals or spaces is kept. */
export function fontFamilyName(value) {
  const raw = String(value ?? '').trim().replace(/^["']|["']$/g, '');
  if (!raw) return null;
  if (GENERIC.has(raw.toLowerCase())) return raw.toLowerCase();
  if (/[A-Z\s]/.test(raw)) return raw;
  const slug = raw.toLowerCase();
  if (SPECIAL[slug]) return SPECIAL[slug];
  return slug.split(/[-_]+/).filter(Boolean).map((part) => /^\d/.test(part) ? part : part[0].toUpperCase() + part.slice(1)).join(' ');
}

/** "Space Grotesk" → "SpaceGrotesk" (the @remotion/google-fonts module name). */
export function googleFontModuleName(family) {
  return String(family ?? '').replace(/[^A-Za-z0-9]+/g, '');
}

/** "Space Grotesk" → "space-grotesk" (file-name slug for frozen font files). */
export function fontSlug(family) {
  return String(family ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * brand.fonts → {display, body, meta, families}: each role is a full CSS
 * font-family stack. Unknown role names in brand.fonts are kept as extra
 * families (so they load) but have no stack. A missing display role falls
 * back to the body family; any other missing role to its system stack.
 */
export function brandFontStacks(brand) {
  const fonts = brand && typeof brand.fonts === 'object' && brand.fonts ? brand.fonts : {};
  const families = [];
  const named = {};
  for (const [role, value] of Object.entries(fonts)) {
    const family = fontFamilyName(value);
    if (!family) continue;
    named[role] = family;
    if (!GENERIC.has(family) && !families.includes(family)) families.push(family);
  }
  const quote = (family) => GENERIC.has(family) ? family : `'${family.replace(/'/g, '')}'`;
  const stack = (role) => {
    // display falls back to the body family; meta (monospace) only to a "mono" entry.
    const family = named[role] ?? (role === 'meta' ? named.mono : role === 'display' ? named.body : undefined);
    return family ? `${quote(family)}, ${FONT_FALLBACKS[role]}` : FONT_FALLBACKS[role];
  };
  return { display: stack('display'), body: stack('body'), meta: stack('meta'), families };
}

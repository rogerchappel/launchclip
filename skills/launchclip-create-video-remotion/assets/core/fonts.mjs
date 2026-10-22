// The LaunchClip font registry: every family both renderers can draw, the
// exact font files that hold it, and the CSS stack each type role uses. The
// HyperFrames compiler and the Remotion kit both read this file, so the two
// renderers load the same files and resolve brand.fonts the same way. Plain
// ESM with no imports. Canonical copy: kit/core/fonts.mjs.
//
// Files come from pinned @fontsource packages (dependencies in package.json,
// latin subset, OFL-1.1, see THIRD_PARTY_NOTICES.md). Nothing is fetched at
// render time:
// - HyperFrames: the story compiler copies each face's file into the project
//   (fonts/<file>) and declares it with @font-face.
// - Remotion: kit/remotion/fonts.ts imports each file through the bundler and
//   loads it with the FontFace API inside delayRender/continueRender.
//
// storyboard.json names fonts by slug ("space-grotesk") or by family
// ("Space Grotesk"). A family outside the registry still works when its files
// are frozen under assets/fonts/ (frozenFontFaces); otherwise it falls back
// to the role's registry family, never to a host system font.

/** Licence of every registered family (SIL Open Font License 1.1). */
export const FONT_LICENSE = 'OFL-1.1';

const variable = (slug, axes, styles = ['normal']) => styles.map((style) => ({ file: `${slug}-latin-wght-${style}.woff2`, weight: axes, style }));
const fixed = (slug, weight, styles = ['normal']) => styles.map((style) => ({ file: `${slug}-latin-${weight}-${style}.woff2`, weight, style }));
const entry = (family, pkg, generic, faces) => Object.freeze({ family, slug: pkg.split('/')[1], package: pkg, version: '5.3.0', license: FONT_LICENSE, generic, faces: Object.freeze(faces.map(Object.freeze)) });

/**
 * family → {family, slug, package, version, license, generic, faces:[{file, weight, style}]}.
 * `weight` is a CSS font-weight descriptor: one weight for static files, a
 * "min max" range for variable (wght axis) files. `package` + `/files/` +
 * `file` is the module path of the woff2 inside node_modules.
 */
export const FONT_REGISTRY = Object.freeze({
  'Anton': entry('Anton', '@fontsource/anton', 'sans-serif', fixed('anton', '400')),
  'Archivo Black': entry('Archivo Black', '@fontsource/archivo-black', 'sans-serif', fixed('archivo-black', '400')),
  'Bricolage Grotesque': entry('Bricolage Grotesque', '@fontsource-variable/bricolage-grotesque', 'sans-serif', variable('bricolage-grotesque', '200 800')),
  'Instrument Serif': entry('Instrument Serif', '@fontsource/instrument-serif', 'serif', fixed('instrument-serif', '400', ['normal', 'italic'])),
  'Inter': entry('Inter', '@fontsource-variable/inter', 'sans-serif', variable('inter', '100 900')),
  'JetBrains Mono': entry('JetBrains Mono', '@fontsource-variable/jetbrains-mono', 'monospace', variable('jetbrains-mono', '100 800')),
  'Space Grotesk': entry('Space Grotesk', '@fontsource-variable/space-grotesk', 'sans-serif', variable('space-grotesk', '300 700')),
  'STIX Two Math': entry('STIX Two Math', '@fontsource/stix-two-math', 'serif', fixed('stix-two-math', '400')),
  'STIX Two Text': entry('STIX Two Text', '@fontsource-variable/stix-two-text', 'serif', variable('stix-two-text', '400 700', ['normal', 'italic'])),
  'Syne': entry('Syne', '@fontsource-variable/syne', 'sans-serif', variable('syne', '400 800')),
  'Unbounded': entry('Unbounded', '@fontsource-variable/unbounded', 'sans-serif', variable('unbounded', '200 900'))
});

/** The registry family each type role uses when brand.fonts does not name one. */
export const FONT_ROLE_DEFAULTS = Object.freeze({
  display: 'Anton',
  body: 'Inter',
  meta: 'JetBrains Mono',
  math: 'STIX Two Text',
  serif: 'Instrument Serif'
});

/**
 * Last registered family in every stack. The fontsource files are latin
 * subsets; STIX Two Math is not subset and covers arrows, operators and other
 * symbols (→ ∝ ≈ ≤ ✓ …), so a glyph missing from the role font still comes
 * from a bundled file instead of whatever the host has installed.
 */
export const SYMBOL_FALLBACK = 'STIX Two Math';

export const FONT_ROLES = Object.freeze(['display', 'body', 'meta']);
const ALL_ROLES = Object.freeze(['display', 'body', 'meta', 'math', 'serif']);
const ROLE_GENERIC = Object.freeze({ display: 'sans-serif', body: 'sans-serif', meta: 'monospace', math: 'serif', serif: 'serif' });

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'cursive', 'math']);

// Slugs whose family name is not simple title case (outside the registry).
const SPECIAL = Object.freeze({
  'ibm-plex-mono': 'IBM Plex Mono', 'ibm-plex-sans': 'IBM Plex Sans', 'ibm-plex-serif': 'IBM Plex Serif',
  'ibm-plex-sans-condensed': 'IBM Plex Sans Condensed', 'dm-sans': 'DM Sans', 'dm-mono': 'DM Mono',
  'dm-serif-display': 'DM Serif Display', 'pt-sans': 'PT Sans', 'pt-serif': 'PT Serif', 'pt-mono': 'PT Mono',
  'eb-garamond': 'EB Garamond', 'noto-sans-jp': 'Noto Sans JP', 'mplus-1p': 'M PLUS 1p', 'source-code-pro': 'Source Code Pro',
  'bebas-neue': 'Bebas Neue', 'sf-pro': 'SF Pro'
});

/** "Space Grotesk" → "space-grotesk" (file-name slug for frozen font files). */
export function fontSlug(family) {
  return String(family ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const BY_SLUG = new Map(Object.keys(FONT_REGISTRY).map((family) => [fontSlug(family), family]));

/** "jetbrains-mono" / "JETBRAINS MONO" / "JetBrains Mono" → "JetBrains Mono"; null when not registered. */
export function registeredFamily(value) {
  return BY_SLUG.get(fontSlug(String(value ?? '').replace(/^["']|["']$/g, ''))) ?? null;
}

/** "space-grotesk" → "Space Grotesk"; registered families get their canonical spelling, other names with capitals or spaces are kept. */
export function fontFamilyName(value) {
  const raw = String(value ?? '').trim().replace(/^["']|["']$/g, '');
  if (!raw) return null;
  if (GENERIC.has(raw.toLowerCase())) return raw.toLowerCase();
  const registered = registeredFamily(raw);
  if (registered) return registered;
  if (/[A-Z\s]/.test(raw)) return raw;
  const slug = raw.toLowerCase();
  if (SPECIAL[slug]) return SPECIAL[slug];
  return slug.split(/[-_]+/).filter(Boolean).map((part) => /^\d/.test(part) ? part : part[0].toUpperCase() + part.slice(1)).join(' ');
}

const quote = (family) => GENERIC.has(family) ? family : `'${family.replace(/'/g, '')}'`;

/**
 * The CSS stack for a family in a role: the family, the role's registry
 * family, the symbol fallback, then the role's generic family. Every named
 * family in it is a bundled file, so no host font is ever reached while the
 * files load. family may be null (the role default alone).
 *   fontStack('space-grotesk', 'body') → "'Space Grotesk', 'Inter', 'STIX Two Math', sans-serif"
 */
export function fontStack(family, role = 'body') {
  if (!ALL_ROLES.includes(role)) throw new Error(`unknown font role "${role}"; use ${ALL_ROLES.join(', ')}`);
  const names = [];
  const add = (name) => { if (name && !names.includes(name)) names.push(name); };
  const named = family ? fontFamilyName(family) : null;
  if (named && !GENERIC.has(named)) add(named);
  add(FONT_ROLE_DEFAULTS[role]);
  add(SYMBOL_FALLBACK);
  add(ROLE_GENERIC[role]);
  return names.map(quote).join(', ');
}

/**
 * brand.fonts → {display, body, meta, math, serif, families}: each role is a
 * full CSS font-family stack (fontStack). families lists the non-generic
 * families brand.fonts names, in order (unknown role names are kept so they
 * load). A missing display role uses the body family; meta (monospace) uses a
 * "mono" entry; anything else missing uses the role's registry family.
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
  const pick = (role) => {
    const family = named[role] ?? (role === 'meta' ? named.mono : role === 'display' ? named.body : undefined);
    return fontStack(family && !GENERIC.has(family) ? family : null, role);
  };
  return { display: pick('display'), body: pick('body'), meta: pick('meta'), math: pick('math'), serif: pick('serif'), families };
}

/**
 * The families a project loads: every role default, the symbol fallback and
 * the brand families. Modules draw with role defaults even when the brand
 * names other fonts (equation-lockup's maths serif, archive-card's quote
 * serif, the editorial kinds), so both renderers always load all of them.
 */
export function projectFontFamilies(brand) {
  const families = [...new Set([...Object.values(FONT_ROLE_DEFAULTS), SYMBOL_FALLBACK])];
  for (const family of brandFontStacks(brand).families) if (!families.includes(family)) families.push(family);
  return families;
}

/**
 * Registered faces for a family list → [{family, package, file, module, weight, style, format}].
 * module is the import specifier of the file ("@fontsource/anton/files/anton-latin-400-normal.woff2").
 * Families outside the registry are skipped (see frozenFontFaces).
 */
export function registryFontFaces(families) {
  const out = [];
  for (const name of families) {
    const family = registeredFamily(name);
    if (!family) continue;
    const item = FONT_REGISTRY[family];
    for (const face of item.faces) out.push({ family, package: item.package, file: face.file, module: `${item.package}/files/${face.file}`, weight: face.weight, style: face.style, format: 'woff2' });
  }
  return out;
}

/** Every face in the registry, in registry order. */
export function allFontFaces() {
  return registryFontFaces(Object.keys(FONT_REGISTRY));
}

const FORMATS = Object.freeze({ woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' });

/**
 * Frozen files for a family outside the registry: file names under
 * assets/fonts/ that start with the family slug (space-grotesk-700.woff2,
 * a CamelCase name such as SpaceGrotesk-Bold.ttf does not match). The weight is the
 * first standalone 100–900 in the name (or 700 for "bold", else 400) and the
 * style is italic when the name says so.
 *   → [{family, file, weight, style, format}] sorted by file name
 */
export function frozenFontFaces(family, fileNames) {
  const slug = fontSlug(family);
  if (!slug) return [];
  return [...fileNames]
    .map((name) => String(name).split('/').pop())
    .filter((file) => /\.(woff2?|ttf|otf)$/i.test(file) && file.toLowerCase().replace(/[^a-z0-9]+/g, '-').startsWith(slug))
    .sort()
    .map((file) => ({
      family,
      file,
      weight: file.match(/(?:^|[^0-9])([1-9]00)(?:[^0-9]|$)/)?.[1] ?? (/bold/i.test(file) ? '700' : '400'),
      style: /italic/i.test(file) ? 'italic' : 'normal',
      format: FORMATS[file.split('.').pop().toLowerCase()]
    }));
}

/** @deprecated "Space Grotesk" → "SpaceGrotesk"; kept until the renderers stop loading from Google Fonts. */
export function googleFontModuleName(family) {
  return String(family ?? '').replace(/[^A-Za-z0-9]+/g, '');
}

/** One @font-face rule (font-display: block, so text never paints in a fallback first). */
export function fontFaceRule(face, url) {
  const safe = String(url).replace(/["\\\n]/g, (char) => encodeURIComponent(char));
  return `@font-face { font-family: '${face.family.replace(/'/g, '')}'; src: url("${safe}") format("${face.format}"); font-weight: ${face.weight}; font-style: ${face.style}; font-display: block; }`;
}

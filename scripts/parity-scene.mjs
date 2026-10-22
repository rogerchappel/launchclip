// Scene → editorial spec, for the parity harness and its test-only Remotion
// entry. It follows docs/KIT_CONTRACTS.md "Story fields used by the compilers":
// params carry the spec without id/kind/aspect/start/duration, accent defaults
// to brand.colors.primary and theme to the brand-derived palette. The real
// resolver is kit/core/modules.mjs resolveModule(); this is the fallback used
// until it exists. Plain ESM, no imports: it is bundled into Remotion too.

const HEX = /^#[0-9a-fA-F]{6}$/;

/** `top` at `amount` opacity over `bottom`, as #rrggbb. */
export function mixHex(top, bottom, amount) {
  const channel = (value, i) => parseInt(value.slice(1 + i * 2, 3 + i * 2), 16);
  return '#' + [0, 1, 2].map(i => Math.round(channel(top, i) * amount + channel(bottom, i) * (1 - amount)).toString(16).padStart(2, '0')).join('');
}

export function storyAspect(story) {
  const {width, height} = story.format ?? {};
  if (width * 16 === height * 9) return '9:16';
  if (width * 9 === height * 16) return '16:9';
  throw new Error(`editorial modules need a 9:16 or 16:9 format, got ${width}x${height}`);
}

export function brandTheme(brand) {
  const colors = brand?.colors ?? {};
  if (!HEX.test(colors.bg ?? '') || !HEX.test(colors.paper ?? '')) return undefined;
  return {surface: colors.bg, foreground: colors.paper, muted: mixHex(colors.paper, colors.bg, .62), border: mixHex(colors.paper, colors.bg, .18),
    accentText: HEX.test(colors.ink ?? '') ? colors.ink : colors.paper};
}

export function sceneDuration(scene) {
  if (typeof scene.duration === 'number') return scene.duration;
  return scene.end - scene.start;
}

/** The editorial spec for one scene of a (resolved) story. */
export function editorialSpecFromScene(scene, story) {
  const params = scene.params ?? {};
  const spec = {...params, id: scene.id, kind: scene.module, aspect: storyAspect(story), start: scene.start, duration: sceneDuration(scene)};
  const primary = story.brand?.colors?.primary;
  if (spec.accent === undefined && HEX.test(primary ?? '')) spec.accent = primary;
  if (spec.theme === undefined) {
    const theme = brandTheme(story.brand);
    if (theme) spec.theme = theme;
  }
  return spec;
}

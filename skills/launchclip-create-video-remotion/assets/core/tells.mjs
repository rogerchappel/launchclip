// Tells: the signs that a video is a default nobody chose (slop) or a craft
// failure (quality), as a dated registry with one detector per plan rule.
// Contract: docs/VIDEO_TELLS_RFC.md §1. Plain ESM; imports only kit/core.
//
// Each entry: {id, category: "slop" | "quality", severity: "error" | "warning"
// | "advisory", applies: "plan" | "frame" | "script", detector (the function
// name here, or null until its phase lands), fix, added, retired, source}.
// A tell is a fashion: `added` dates it, and a later review retires the ones
// that stop firing on real drafts (`retired` set, the detector no longer runs).
//
// planTells(input) runs every live plan rule on data the caller prepares
// (src/direction_guardrails.js tellsGate): the resolved story, and per scene
// its model, its view tree and its op list, the same ones both renderers
// draw and play. Nothing here renders.
//
// Provenance (RFC §7). The rules are written fresh in video terms from:
// - impeccable by Paul Bakaus, Apache License 2.0: rule ids and descriptions
//   of its detector, the overused-font list and the craft floor (rewritten).
// - unslop by Damir Sokolovsky, CC BY 4.0, adapted: the signs of generated
//   design and their fixes (translated from web pages to video frames,
//   thresholds changed, rules that do not transfer dropped).
// - the frontend-design skill, Apache License 2.0: the generated-design
//   clusters, the accent-word and eyebrow tells (rewritten).
// The roadmap's own video tells are LaunchClip's. See THIRD_PARTY_NOTICES.md.

import { FONT_ROLE_DEFAULTS } from './fonts.mjs';
import { CAPTION_ECHO_MODULES, sceneTextWords } from './captions.mjs';
import { resolveGrammar } from './grammar.mjs';
import { textWidth } from './catalog-b-base.mjs';

// Thresholds. Proposals from the RFC, calibrated on examples/story/* (RFC §1
// "Calibration" lists every change).
export const TELLS = Object.freeze({
  dissolveShare: 0.5, dissolveScenes: 5,
  hookStart: 0.5, hookHold: 1.5,
  echoShare: 0.6, echoWords: 3,
  entranceShare: 0.8, entranceScenes: 4, entranceDirections: 3,
  kickerWords: 3, kickerTracking: 0.08, kickerRatio: 1.5,
  trackedCaps: 0.1, crushedTracking: -0.04,
  hierarchy: 1.25, sizes: 4, sizeBucket: 0.1,
  headlineWords: 6, displayShare: 0.05, capsWords: 12,
  glowSaturation: 0.25, chromaSaturation: 0.3,
  stragglerLines: 3, organicPoints: 12, pulseShare: 0.02,
  heroMetrics: 1
});

const D = '2026-11-16';
const tell = (id, category, severity, applies, detector, fix, source) => Object.freeze({ id, category, severity, applies, detector, fix, added: D, retired: null, source });

export const TELL_REGISTRY = Object.freeze([
  // The roadmap's video tells.
  tell('quote-card-wide-set', 'slop', 'warning', 'plan', 'quoteOverWideSet', 'A character reacts to the card or points up at it, or a tighter set.', 'roadmap'),
  tell('dissolve-everywhere', 'slop', 'warning', 'plan', 'dissolveShare', 'Pick each transition by meaning: cut for contrast, push for continuation, whip for speed.', 'roadmap'),
  tell('centred-title-hook', 'slop', 'warning', 'plan', 'centredTitleHook', 'Open on the subject: the object, the place, the number on its thing.', 'roadmap'),
  tell('fact-card-vs-caption', 'slop', 'warning', 'plan', 'cardEchoesCaption', 'The card carries the figure or the name; the caption carries the sentence.', 'roadmap, impeccable'),
  tell('identical-entrance', 'slop', 'warning', 'plan', 'identicalEntrance', 'One authored entrance for the focal element; the supporting parts quieter.', 'roadmap, impeccable, unslop, frontend-design'),
  // Surfaces and colour.
  tell('ai-palette', 'slop', 'warning', 'plan', 'aiPalette', 'Take the palette from the world the subject belongs to.', 'impeccable, unslop'),
  tell('cream-default', 'slop', 'warning', 'plan', 'creamDefault', 'Take the palette from the world the subject belongs to.', 'impeccable, frontend-design'),
  tell('gradient-text', 'slop', 'error', 'plan', 'gradientText', 'Solid colour; emphasis by size or weight.', 'impeccable, unslop'),
  tell('glow', 'slop', 'warning', 'plan', 'glow', 'Keep a glow only where it is the information (a pulse running down a wire); otherwise step the surfaces.', 'impeccable, unslop'),
  tell('radial-wash', 'slop', 'warning', 'plan', 'radialWash', 'A plate from the world, or a neutral one.', 'impeccable'),
  tell('glass-default', 'slop', 'warning', 'plan', 'glassDefault', 'A solid panel, unless the world has glass.', 'impeccable, unslop'),
  tell('grid-stripes', 'slop', 'warning', 'plan', 'gridStripes', 'A plain plate, unless the world is a map, a blueprint or an instrument.', 'impeccable'),
  tell('accent-everywhere', 'slop', 'warning', 'frame', null, 'One accent, once or twice a frame.', 'unslop'),
  tell('chart-shades', 'slop', 'warning', 'plan', 'chartShades', 'Neutral steps for the other series, the accent on the one value the line names.', 'unslop'),
  tell('gray-on-color', 'quality', 'warning', 'plan', 'grayOnColor', 'Set the text in a darker shade of the panel\'s own hue.', 'impeccable'),
  tell('ghost-card', 'slop', 'warning', 'plan', 'ghostCard', 'One of the two: a border or a shadow.', 'impeccable'),
  tell('hard-offset-shadow', 'slop', 'advisory', 'plan', 'hardOffsetShadow', 'Only in a world that chose it.', 'impeccable'),
  // Type.
  tell('overused-font', 'slop', 'advisory', 'plan', 'overusedFont', 'Name a face chosen for the subject\'s character in brand.fonts.', 'impeccable'),
  tell('kicker', 'slop', 'warning', 'plan', 'kicker', 'Delete the label; the headline carries itself.', 'impeccable, unslop, frontend-design'),
  tell('numbered-labels', 'slop', 'warning', 'plan', 'numberedLabels', 'Numbers only for real steps.', 'impeccable, frontend-design'),
  tell('tracked-caps', 'slop', 'warning', 'plan', 'trackedCaps', 'Sentence case, normal tracking.', 'unslop, frontend-design'),
  tell('accent-word', 'slop', 'advisory', 'plan', 'accentWord', 'In a headline, emphasis by size; one styled word belongs in captions.', 'frontend-design'),
  tell('italic-serif-hook', 'slop', 'advisory', 'plan', 'italicSerifHook', 'A face chosen for the character.', 'impeccable'),
  tell('flat-hierarchy', 'quality', 'warning', 'plan', 'flatHierarchy', 'Fewer sizes, further apart.', 'impeccable, unslop'),
  tell('crushed-tracking', 'quality', 'warning', 'plan', 'crushedTracking', 'At most -0.02 to -0.03em, on display type only.', 'impeccable, unslop'),
  tell('mono-costume', 'slop', 'advisory', 'plan', 'monoCostume', 'The body face; mono for figures and code.', 'impeccable, frontend-design'),
  tell('oversized-headline', 'quality', 'warning', 'plan', 'oversizedHeadline', 'Fewer words, or a smaller step.', 'impeccable'),
  tell('straggler', 'quality', 'warning', 'plan', 'straggler', 'Balance the break so the last line holds more than one word.', 'impeccable'),
  tell('caps-body', 'quality', 'warning', 'plan', 'capsBody', 'Sentence case.', 'impeccable'),
  tell('mixed-number-format', 'quality', 'warning', 'plan', 'mixedNumberFormat', 'One number format through the video.', 'unslop'),
  // Structure, objects and pictures.
  tell('hero-metric', 'slop', 'warning', 'plan', 'heroMetric', 'Put the number on the thing it counts, in the world.', 'impeccable, unslop, frontend-design'),
  tell('card-grid', 'slop', 'warning', 'plan', 'cardGrid', 'Vary the sizes so one leads, or use item-list.', 'impeccable, unslop'),
  tell('icon-tile', 'slop', 'warning', 'plan', 'iconTile', 'The icon beside the text, or none.', 'impeccable'),
  tell('emoji-icons', 'slop', 'error', 'plan', 'emojiIcons', 'One icon set (catalog-h-icons) or none.', 'unslop, impeccable'),
  tell('decorative-chrome', 'slop', 'warning', 'plan', 'decorativeChrome', 'Remove it, or show the real series.', 'impeccable, unslop'),
  tell('pulsing-dot', 'slop', 'warning', 'plan', 'pulsingDot', 'Keep it still unless something is live.', 'impeccable, unslop'),
  tell('blinking-cursor', 'slop', 'advisory', 'plan', 'blinkingCursor', 'No caret outside a recorded terminal or editor.', 'impeccable'),
  tell('marquee', 'slop', 'advisory', 'plan', 'marquee', 'A list that builds.', 'impeccable'),
  tell('bounce', 'slop', 'error', 'plan', 'bounce', 'Expo or quart out; no overshoot.', 'impeccable, unslop'),
  tell('clipart', 'slop', 'advisory', 'plan', 'clipart', 'A real asset, a photo, or a drawn world.', 'impeccable, unslop'),
  tell('ai-stock-imagery', 'slop', 'warning', 'plan', 'aiStockImagery', 'Show what the software produces.', 'unslop'),
  tell('baked-text', 'slop', 'advisory', 'plan', 'bakedText', 'Real text over a clean image.', 'unslop'),
  tell('buried-raster', 'quality', 'warning', 'frame', null, 'Less dim, or no photo.', 'impeccable'),
  tell('unblended-media', 'quality', 'advisory', 'frame', null, 'Match the ground and soften the edge.', 'unslop'),
  tell('organic-mask', 'slop', 'warning', 'plan', 'organicMask', 'A real matte from subject matting.', 'impeccable')
]);

// ---------------------------------------------------------------------------
// Reading the plan.

const round = (value) => Math.round(value * 100) / 100;
const words = (text) => String(text).trim().split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
const em = (value) => (typeof value === 'string' && value.trim().endsWith('em') ? parseFloat(value) : typeof value === 'number' && value === 0 ? 0 : null);
const isCaps = (text) => /\p{Lu}/u.test(text) && text === text.toUpperCase();

/** "#rrggbb" → {h (0–360), s, l (0–1)} or null. */
export function hsl(hex) {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(hex ?? '').trim());
  if (!m) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

/** Text nodes of a view tree in document order: {id, text, style, spans}. */
export function viewTexts(tree) {
  const out = [];
  const walk = (node, inherited) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const child of node) walk(child, inherited); return; }
    const style = { ...inherited, ...(node.style ?? {}) };
    const kids = node.children ?? [];
    const own = kids.some((child) => typeof child === 'string' || typeof child === 'number');
    const spans = own ? kids.filter((child) => child && typeof child === 'object' && !Array.isArray(child) && (child.children ?? []).some((c) => typeof c === 'string')) : [];
    const text = kids.map((child) => (typeof child === 'object' ? (spans.includes(child) ? child.children.join('') : '') : String(child))).join('');
    if (own && text.trim()) out.push({ id: node.id ?? null, text, style, spans });
    for (const child of kids) if (child && typeof child === 'object' && !spans.includes(child)) walk(child, { fontFamily: style.fontFamily, fontSize: style.fontSize, letterSpacing: style.letterSpacing, textTransform: style.textTransform, fontStyle: style.fontStyle, color: style.color });
  };
  walk(tree, {});
  return out;
}

/** Every node of a view tree: [{node, depth}]. */
function viewNodes(tree) {
  const out = [];
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const child of node) walk(child, depth); return; }
    out.push({ node, depth });
    for (const child of node.children ?? []) walk(child, depth + 1);
  };
  walk(tree, 0);
  return out;
}

/** CSS shadow list → [{inset, x, y, blur, spread, color}] (px; colours as hex). */
function shadows(value) {
  if (typeof value !== 'string' || value === 'none') return [];
  return value.split(/,(?![^(]*\))/).map((part) => {
    const color = /#[0-9a-f]{6,8}\b/i.exec(part)?.[0] ?? null;
    const nums = [...part.replace(/#[0-9a-f]+/gi, '').matchAll(/-?\d*\.?\d+(?:px)?/g)].map((m) => parseFloat(m[0]));
    return { inset: /\binset\b/.test(part), x: nums[0] ?? 0, y: nums[1] ?? 0, blur: nums[2] ?? 0, spread: nums[3] ?? 0, color };
  });
}

const saturated = (color, floor) => { const c = hsl(color); return Boolean(c && c.s >= floor && c.l > 0.12 && c.l < 0.92); };
const family = (model, style) => {
  const ff = String(style.fontFamily ?? '');
  for (const role of ['display', 'meta', 'serif', 'math', 'body']) if (model?.fonts?.[role] && ff === model.fonts[role]) return role;
  return /mono/i.test(ff) ? 'meta' : 'body';
};
const isCard = (module) => /card|quote|excerpt|callout|panel/.test(module);
const overlaps = (a, b) => a.start < b.end - 1e-6 && b.start < a.end - 1e-6;
const CAST = new Set(['cast-scene', 'character-cameo']);
const PICTURED = /cast|character|world|photo|clip|media|product-demo|object|chart|bars|graph|map|set-prop|ui-scene|evidence|3d|rack|stack|scatter|plot/;
const METRIC = new Set(['stat-card', 'odometer', 'metric']);
const TITLE_CARDS = new Set(['hook-title', 'motion-title', 'title-decompose', 'kinetic-words', 'section-card', 'concept-card', 'emphasis-caption']);
const NUMBERED_OK = /list|step|process|timeline|leaderboard|countdown|rank|chapter|agenda/;
const TERMINAL = /terminal|code|editor|typing|ui-|product-demo|demo|excerpt/;
const BOUNCY = /^(back\.(out|inout)|elastic|bounce)/i;
const OVERUSED_FONTS = Object.freeze(['Inter', 'Space Grotesk', 'Instrument Serif', 'Fraunces', 'Plus Jakarta Sans']);
const EMOJI = /\p{Extended_Pictographic}/u;
const AI_STOCK = /\b(robots?|android|cyborg|glowing brain|brain|neural|circuit(?:s| board| lines)?|hologram|matrix code)\b/i;
const PROMPT_KEY = /prompt|query|search/i;
const kindOf = (value) => (typeof value === 'string' ? value : value?.kind ?? null);

function stringsUnder(value, keyTest, out = [], parentKey = '') {
  if (typeof value === 'string') { if (keyTest(parentKey)) out.push(value); return out; }
  if (Array.isArray(value)) { for (const item of value) stringsUnder(item, keyTest, out, parentKey); return out; }
  if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) stringsUnder(item, keyTest, out, key);
  return out;
}

// ---------------------------------------------------------------------------
// Detectors: (input) → [{at, ids, detail}]. input = {story, scenes: [{id,
// module, start, end, track, scene, model, view, ops}], words}.

const perScene = (input, fn) => input.scenes.flatMap((s) => { const hit = fn(s); return hit ? [{ at: s.start, ids: [s.id], detail: hit }] : []; });
const perText = (input, test, say) => perScene(input, (s) => {
  if (!s.view) return null;
  const hits = viewTexts(s.view).filter((t) => test(t, s));
  return hits.length ? say(s, hits) : null;
});
const quoted = (hits) => hits.slice(0, 3).map((t) => JSON.stringify(t.text.slice(0, 40))).join(', ');

const DETECTORS = {
  quoteOverWideSet(input) {
    const worlds = input.scenes.filter((s) => s.module === 'world');
    const cast = input.scenes.filter((s) => CAST.has(s.module));
    return input.scenes.filter((s) => (s.module === 'quote-card' || s.module === 'excerpt') && worlds.some((w) => w.id !== s.id && overlaps(w, s)) && !cast.some((c) => overlaps(c, s)))
      .map((s) => ({ at: s.start, ids: [s.id], detail: `${s.id} (${s.module}) floats over a world shot with no one in the set reacting to it` }));
  },
  dissolveShare(input) {
    const main = input.scenes.filter((s) => !s.track).sort((a, b) => a.start - b.start);
    if (main.length < TELLS.dissolveScenes) return [];
    const ins = main.slice(1).map((s) => String(s.scene?.in?.type ?? s.scene?.transition?.type ?? 'cut'));
    const fades = ins.filter((type) => /fade|dissolve|crossfade/.test(type));
    return fades.length / ins.length > TELLS.dissolveShare ? [{ at: 0, ids: main.filter((s, i) => i && /fade|dissolve|crossfade/.test(ins[i - 1])).map((s) => s.id), detail: `${fades.length} of ${ins.length} cuts are fades` }] : [];
  },
  centredTitleHook(input) {
    const first = [...input.scenes].sort((a, b) => a.start - b.start)[0];
    if (!first || first.start >= TELLS.hookStart || !TITLE_CARDS.has(first.module) || first.end - first.start <= TELLS.hookHold) return [];
    const pictured = input.scenes.some((s) => s !== first && overlaps(s, first) && PICTURED.test(s.module));
    return pictured ? [] : [{ at: first.start, ids: [first.id], detail: `the video opens on ${first.id} (${first.module}) with nothing pictured, held ${round(first.end - first.start)} s` }];
  },
  cardEchoesCaption(input) {
    const captions = (input.story?.overlays ?? []).some((o) => o?.type === 'captions');
    if (!captions || !input.words?.length) return [];
    return perScene(input, (s) => {
      if (CAPTION_ECHO_MODULES.includes(s.module) || !isCard(s.module)) return null;
      const shown = new Set(sceneTextWords(s.scene?.params ?? {}).filter((w) => w.length > 3));
      if (shown.size < TELLS.echoWords) return null;
      const said = new Set(input.words.filter((w) => w.start >= s.start - 0.2 && w.start < s.end).map((w) => String(w.word ?? w.text ?? '').toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')));
      const share = [...shown].filter((w) => said.has(w)).length / shown.size;
      return share >= TELLS.echoShare ? `${Math.round(share * 100)}% of the card's words are in the caption under it` : null;
    });
  },
  identicalEntrance(input) {
    const out = [];
    const signed = input.scenes.filter((s) => s.model?.motion?.enterFrom);
    if (signed.length >= TELLS.entranceScenes) {
      const sig = (s) => `${s.model.motion.enterEase}|${JSON.stringify(s.model.motion.enterFrom)}`;
      const counts = new Map();
      for (const s of signed) counts.set(sig(s), [...(counts.get(sig(s)) ?? []), s.id]);
      const [ids] = [...counts.values()].sort((a, b) => b.length - a.length);
      if (ids.length / signed.length >= TELLS.entranceShare) out.push({ at: 0, ids, detail: `${ids.length} of ${signed.length} scenes enter the same way` });
    }
    for (const s of input.scenes) {
      const dirs = new Set();
      for (const op of s.ops ?? []) {
        if (op.type !== 'tween' || op.from?.opacity !== 0) continue;
        const x = Number(op.from?.x) || 0, y = Number(op.from?.y) || 0;
        if (Math.abs(x) > 1 || Math.abs(y) > 1) dirs.add(Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'below' : 'above'));
      }
      if (dirs.size >= TELLS.entranceDirections) out.push({ at: s.start, ids: [s.id], detail: `${s.id} brings its parts in from ${dirs.size} directions (${[...dirs].join(', ')})` });
    }
    return out;
  },
  aiPalette(input) {
    const c = input.story?.brand?.colors ?? {};
    const bg = hsl(c.bg), hues = ['primary', 'accent'].map((k) => [k, hsl(c[k])]).filter(([, v]) => v && v.s > 0.35);
    const purple = hues.some(([, v]) => v.h >= 250 && v.h <= 300) && hues.some(([, v]) => v.h >= 200 && v.h < 250);
    const cyan = bg && bg.l < 0.08 && hues.find(([, v]) => v.h >= 180 && v.h <= 200);
    if (purple) return [{ at: 0, ids: [], detail: 'the brand pairs a purple with a blue' }];
    return cyan ? [{ at: 0, ids: [], detail: `the brand's ${cyan[0]} (${c[cyan[0]]}) is cyan on a near-black ground (${c.bg})` }] : [];
  },
  creamDefault(input) {
    const c = input.story?.brand?.colors ?? {}, f = input.story?.brand?.fonts ?? {};
    const near = (hex, h, s, l, tol) => { const v = hsl(hex); return v && Math.abs(v.h - h) < tol.h && Math.abs(v.s - s) < tol.s && Math.abs(v.l - l) < tol.l; };
    const ground = near(c.bg, 43, 0.3, 0.94, { h: 20, s: 0.25, l: 0.04 }) || near(c.paper, 43, 0.3, 0.94, { h: 20, s: 0.25, l: 0.04 }) && hsl(c.bg)?.l > 0.85;
    const clay = ['primary', 'accent'].some((k) => near(c[k], 15, 0.6, 0.6, { h: 10, s: 0.25, l: 0.1 }));
    const serif = /serif|fraunces|playfair|garamond|instrument/i.test(String(f.display ?? '')) && !/sans/i.test(String(f.display ?? ''));
    return ground && clay && serif ? [{ at: 0, ids: [], detail: 'cream ground, serif display and a clay accent' }] : [];
  },
  gradientText: (input) => perText(input, (t) => /text/.test(String(t.style.backgroundClip ?? t.style.WebkitBackgroundClip ?? '')) && /gradient/.test(String(t.style.backgroundImage ?? t.style.background ?? '')), (s, hits) => `${hits.length} text fill${hits.length > 1 ? 's are' : ' is a'} gradient (${quoted(hits)})`),
  glow: (input) => perScene(input, (s) => {
    const nodes = s.view ? viewNodes(s.view).filter(({ node }) => [node.style?.boxShadow, node.style?.textShadow].some((v) => shadows(v).some((sh) => !sh.x && !sh.y && sh.blur > 0 && saturated(sh.color, TELLS.glowSaturation)))) : [];
    const param = s.scene?.params?.presentation === 'rim-glass' || s.scene?.params?.callout?.treatment === 'glow' || s.scene?.params?.glow === true;
    return nodes.length || param ? `${nodes.length ? `${nodes.length} element${nodes.length > 1 ? 's glow' : ' glows'} in a colour` : 'a glow treatment is set'}` : null;
  }),
  radialWash(input) {
    const bg = input.story?.background ?? input.story?.brand?.background;
    if (kindOf(bg) !== 'blobs' && kindOf(bg) !== 'light-rays') return [];
    const colors = [bg?.color, bg?.colors].flat().filter(Boolean);
    return colors.some((c) => saturated(c, 0.5)) ? [{ at: 0, ids: [], detail: `the background is saturated ${kindOf(bg)}` }] : [];
  },
  glassDefault(input) {
    const asked = /glass/i.test(JSON.stringify([input.story?.style, input.story?.direction, input.story?.brand?.style] ?? ''));
    return asked ? [] : perScene(input, (s) => (['glass', 'rim-glass'].includes(s.scene?.params?.presentation) ? `${s.id} sets presentation "${s.scene.params.presentation}" with no glass in the direction` : null));
  },
  gridStripes(input) {
    const bg = kindOf(input.story?.background ?? input.story?.brand?.background);
    const world = /map|blueprint|instrument|graph paper|engineering/i.test(JSON.stringify(input.story?.direction ?? ''));
    return ['dot-grid', 'stripes'].includes(bg) && !world ? [{ at: 0, ids: [], detail: `the background is ${bg} as decoration` }] : [];
  },
  chartShades: (input) => perScene(input, (s) => {
    const p = s.scene?.params ?? {};
    const series = [p.series, p.chart?.series, p.data?.series].find(Array.isArray);
    return series && series.length >= 2 && !series.some((x) => x?.highlight || x?.color) && p.highlight === undefined && p.chart?.highlight === undefined ? `${series.length} series in the default shades with none highlighted` : null;
  }),
  grayOnColor: (input) => perScene(input, (s) => {
    const theme = s.model?.theme ?? {};
    const panel = hsl(theme.panel ?? theme.surface);
    if (!panel || panel.s <= TELLS.chromaSaturation || panel.l < 0.15 || !s.view || !theme.muted) return null;
    const hits = viewTexts(s.view).filter((t) => t.style.color === theme.muted);
    return hits.length ? `muted grey text (${quoted(hits)}) on a coloured panel (${theme.panel ?? theme.surface})` : null;
  }),
  ghostCard: (input) => perScene(input, (s) => {
    const hits = s.view ? viewNodes(s.view).filter(({ node }) => /\b[12](\.\d+)?px solid\b/.test(String(node.style?.border ?? '')) && shadows(node.style?.boxShadow).some((sh) => !sh.inset && sh.blur >= 24)) : [];
    return hits.length ? `${hits.length} panel${hits.length > 1 ? 's have' : ' has'} a hairline border under a wide soft shadow` : null;
  }),
  hardOffsetShadow: (input) => perScene(input, (s) => {
    const hits = s.view ? viewNodes(s.view).filter(({ node }) => shadows(node.style?.boxShadow).some((sh) => !sh.inset && sh.blur === 0 && Math.hypot(sh.x, sh.y) >= 4)) : [];
    return hits.length ? `${hits.length} element${hits.length > 1 ? 's cast' : ' casts'} an unblurred offset shadow` : null;
  }),
  overusedFont(input) {
    const named = input.story?.brand?.fonts ?? {};
    // The roles the planned text is set in; a face the brand names is a choice.
    const used = new Set(input.scenes.flatMap((s) => (s.view ? viewTexts(s.view).map((t) => family(s.model, t.style)) : [])));
    const listed = [...used].filter((role) => !named[role] && OVERUSED_FONTS.includes(FONT_ROLE_DEFAULTS[role]));
    return listed.length ? [{ at: 0, ids: [], detail: `${listed.map((role) => `${role} falls back to ${FONT_ROLE_DEFAULTS[role]}`).join('; ')}` }] : [];
  },
  kicker: (input) => perScene(input, (s) => {
    const label = ['kicker', 'eyebrow'].find((key) => typeof s.scene?.params?.[key] === 'string' && s.scene.params[key].trim());
    if (label) return `${s.id} sets params.${label} ${JSON.stringify(s.scene.params[label])} above its headline`;
    if (!s.view) return null;
    const texts = viewTexts(s.view);
    const hit = texts.find((t, i) => isCaps(t.text) && words(t.text).length <= TELLS.kickerWords && (em(t.style.letterSpacing) ?? 0) >= TELLS.kickerTracking && texts[i + 1] && Number(texts[i + 1].style.fontSize) >= Number(t.style.fontSize) * TELLS.kickerRatio);
    return hit ? `${JSON.stringify(hit.text)} is a small tracked caps label above a headline` : null;
  }),
  numberedLabels: (input) => perText(input, (t, s) => !NUMBERED_OK.test(s.module) && /^0\d(?:\s|[./)·—-])/.test(t.text.trim()), (s, hits) => `${quoted(hits)} numbered in a ${s.module}, which is not a sequence`),
  trackedCaps: (input) => perText(input, (t) => isCaps(t.text) && words(t.text).length > TELLS.kickerWords && (em(t.style.letterSpacing) ?? 0) >= TELLS.trackedCaps, (s, hits) => `${quoted(hits)} in tracked capitals`),
  accentWord: (input) => perText(input, (t, s) => t.spans.length === 1 && Number(t.style.fontSize) >= (s.model?.unit ?? 1) * 60 && (t.spans[0].style?.color && t.spans[0].style.color !== t.style.color || t.spans[0].style?.fontStyle === 'italic'), (s, hits) => `${quoted(hits)} styles one word apart in a headline`),
  italicSerifHook(input) {
    const first = [...input.scenes].sort((a, b) => a.start - b.start)[0];
    if (!first?.view) return [];
    const head = viewTexts(first.view).sort((a, b) => Number(b.style.fontSize) - Number(a.style.fontSize))[0];
    return head && head.style.fontStyle === 'italic' && /serif/i.test(String(head.style.fontFamily)) && !/sans-serif$/i.test(String(head.style.fontFamily).split(',')[0]) ? [{ at: first.start, ids: [first.id], detail: `the hook headline ${JSON.stringify(head.text.slice(0, 40))} is an italic serif` }] : [];
  },
  flatHierarchy: (input) => perScene(input, (s) => {
    if (!s.view) return null;
    const sizes = [...new Set(viewTexts(s.view).map((t) => Number(t.style.fontSize)).filter((v) => v > 0))].sort((a, b) => b - a);
    const buckets = sizes.reduce((out, size) => (out.length && out.at(-1) * (1 - TELLS.sizeBucket) <= size ? out : [...out, size]), []);
    if (buckets.length > TELLS.sizes) return `${buckets.length} text sizes (${buckets.map(Math.round).join(' / ')} px)`;
    return sizes.length >= 2 && sizes[0] / sizes[1] < TELLS.hierarchy ? `the headline (${Math.round(sizes[0])} px) is under ${TELLS.hierarchy}× the next size (${Math.round(sizes[1])} px)` : null;
  }),
  crushedTracking: (input) => perText(input, (t) => (em(t.style.letterSpacing) ?? 0) < TELLS.crushedTracking, (s, hits) => `${quoted(hits)} tracked under ${TELLS.crushedTracking}em`),
  monoCostume: (input) => perText(input, (t, s) => family(s.model, t.style) === 'meta' && !TERMINAL.test(s.module) && /[a-z]{3,}/i.test(t.text) && !/^[\d\s.,:%$€£×+\-/]+$/.test(t.text) && words(t.text).length >= 2 && /[a-z]{4,}\s+[a-z]{3,}/i.test(t.text), (s, hits) => `${quoted(hits)} set in mono, which is not code or a figure`),
  oversizedHeadline: (input) => perText(input, (t, s) => family(s.model, t.style) === 'display' && words(t.text).length > TELLS.headlineWords && Number(t.style.fontSize) >= (input.story?.format?.height ?? 1080) * TELLS.displayShare, (s, hits) => `${quoted(hits)} is a sentence at display size`),
  straggler: (input) => perText(input, (t, s) => {
    const width = Number(t.style.width), size = Number(t.style.fontSize);
    if (t.style.whiteSpace !== 'normal' || !(width > 0) || !(size > 0)) return false;
    const role = family(s.model, t.style) === 'display' ? 'display' : family(s.model, t.style) === 'meta' ? 'meta' : 'body';
    const lines = [];
    for (const word of words(t.text)) { const line = lines.length ? `${lines.at(-1)} ${word}` : word; if (lines.length && textWidth(line, size, role, em(t.style.letterSpacing) ?? 0) <= width) lines[lines.length - 1] = line; else lines.push(word); }
    return lines.length >= TELLS.stragglerLines && words(lines.at(-1)).length === 1;
  }, (s, hits) => `${quoted(hits)} leaves one word alone on its last line`),
  capsBody: (input) => perText(input, (t) => (isCaps(t.text) || t.style.textTransform === 'uppercase') && words(t.text).length > TELLS.capsWords, (s, hits) => `${quoted(hits)} sets a long line in capitals`),
  mixedNumberFormat(input) {
    const figures = input.scenes.flatMap((s) => stringsUnder(s.scene?.params ?? {}, (key) => /value|figure|stat|number/i.test(key)).map((v) => ({ s, v })))
      .map(({ s, v }) => ({ s, m: /^([$€£¥])\s?\d[\d,]*(\.\d+)?/.exec(v.trim()) })).filter(({ m }) => m);
    const decimals = new Set(figures.map(({ m }) => (m[2] ?? '').length));
    return decimals.size > 1 ? [{ at: 0, ids: [...new Set(figures.map(({ s }) => s.id))], detail: `money figures with ${[...decimals].sort().join(' and ')} decimals` }] : [];
  },
  heroMetric(input) {
    const first = [...input.scenes].sort((a, b) => a.start - b.start)[0];
    const bare = input.scenes.filter((s) => METRIC.has(s.module) && !input.scenes.some((o) => o !== s && overlaps(o, s) && PICTURED.test(o.module)));
    const hook = bare.find((s) => s === first);
    if (bare.length > TELLS.heroMetrics) return [{ at: bare[1].start, ids: bare.map((s) => s.id), detail: `${bare.length} scenes are a bare number with nothing else in frame` }];
    return hook ? [{ at: hook.start, ids: [hook.id], detail: `the video opens on a bare number (${hook.id}) with nothing else in frame` }] : [];
  },
  cardGrid: (input) => perScene(input, (s) => {
    if (!s.view) return null;
    for (const { node } of viewNodes(s.view)) {
      const kids = (node.children ?? []).filter((k) => k && typeof k === 'object' && k.style?.width && viewTexts(k).length >= 2);
      const shape = (k) => `${Math.round(k.style.width)}x${Math.round(k.style.height ?? 0)}|${viewNodes(k).map(({ node: n }) => n.tag).join(',')}`;
      if (kids.length >= 3 && new Set(kids.map(shape)).size === 1 && viewNodes(kids[0]).some(({ node: n }) => n.tag === 'svg')) return `${kids.length} cards of one size and one structure`;
    }
    return null;
  }),
  iconTile: (input) => perScene(input, (s) => {
    if (!s.view) return null;
    for (const { node } of viewNodes(s.view)) {
      const kids = (node.children ?? []).filter((k) => k && typeof k === 'object');
      const i = kids.findIndex((k) => (k.style?.background || k.style?.backgroundColor) && k.style?.borderRadius && viewNodes(k).some(({ node: n }) => n.tag === 'svg') && !viewTexts(k).length);
      if (i >= 0 && kids[i + 1] && viewTexts(kids[i + 1]).length) return 'an icon in a filled tile sits above the headline';
    }
    return null;
  }),
  emojiIcons: (input) => perScene(input, (s) => {
    const hits = stringsUnder(s.scene?.params ?? {}, () => true).filter((v) => EMOJI.test(v) && !/^(assets|https?:)\//.test(v));
    return hits.length ? `emoji on screen (${hits.slice(0, 3).map((v) => JSON.stringify(v.slice(0, 24))).join(', ')})` : null;
  }),
  decorativeChrome: (input) => perScene(input, (s) => (['sparkline', 'progress-ring'].includes(s.module) && !s.scene?.params?.source && !s.scene?.params?.sub ? `${s.id} (${s.module}) has no source for its values` : null)),
  pulsingDot: (input) => perScene(input, (s) => {
    const loops = (s.ops ?? []).filter((op) => op.type === 'loop' && Object.keys({ ...op.from, ...op.to }).some((k) => /opacity|scale/.test(k)));
    if (!loops.length || !s.view) return null;
    const area = (input.story?.format?.width ?? 1920) * (input.story?.format?.height ?? 1080);
    const small = viewNodes(s.view).filter(({ node }) => loops.some((op) => op.target === node.id) && Number(node.style?.width) * Number(node.style?.height) < area * TELLS.pulseShare);
    return small.length ? `${small.length} small element${small.length > 1 ? 's pulse' : ' pulses'} in a loop` : null;
  }),
  blinkingCursor: (input) => perScene(input, (s) => (!TERMINAL.test(s.module) && s.view && viewNodes(s.view).some(({ node }) => /caret|cursor/.test(String(node.id ?? ''))) ? `${s.id} draws a caret where nothing is typed` : null)),
  marquee: (input) => perScene(input, (s) => (s.module === 'ticker-tape' ? `${s.id} scrolls text past continuously` : null)),
  bounce(input) {
    if (resolveGrammar(input.story)?.id === 'playful') return [];
    return perScene(input, (s) => {
      const eases = [...new Set((s.ops ?? []).map((op) => op.ease).filter((ease) => BOUNCY.test(String(ease ?? ''))))];
      return eases.length ? `${s.id} eases with ${eases.join(', ')}` : null;
    });
  },
  clipart: (input) => perScene(input, (s) => {
    if (s.module !== 'custom' && s.module !== 'graphic') return null;
    const r = s.scene?.params?.rect, f = input.story?.format ?? {};
    return r && f.width && r.width * r.height > 0.3 * f.width * f.height ? `${s.id} is a planner-drawn picture over 30% of the frame` : null;
  }),
  aiStockImagery: (input) => perScene(input, (s) => {
    const hits = stringsUnder(s.scene?.params ?? {}, (key) => PROMPT_KEY.test(key)).filter((v) => AI_STOCK.test(v));
    return hits.length ? `an asset asks for ${JSON.stringify(AI_STOCK.exec(hits[0])[0])}` : null;
  }),
  bakedText: (input) => perScene(input, (s) => (stringsUnder(s.scene?.params ?? {}, (key) => /prompt/i.test(key)).some((v) => /["“][^"”]{2,}["”]/.test(v)) ? `${s.id} asks a generated image for quoted text` : null)),
  organicMask: (input) => perScene(input, (s) => {
    const hits = s.view ? viewNodes(s.view).filter(({ node }) => /polygon\(/.test(String(node.style?.clipPath ?? '')) && String(node.style.clipPath).split(',').length > TELLS.organicPoints) : [];
    return hits.length ? `${hits.length} clip path${hits.length > 1 ? 's' : ''} with more than ${TELLS.organicPoints} points` : null;
  })
};

/** The registry's live plan rules (not retired, with a detector). */
export const PLAN_TELLS = Object.freeze(TELL_REGISTRY.filter((t) => t.applies === 'plan' && !t.retired && t.detector));

/**
 * Every live plan rule on prepared plan data → findings in the gate shape:
 * [{rule, severity, at, ids, detail, added}], the detail ending in the fix.
 * A detector that throws on odd data is skipped, never fatal.
 */
export function planTells(input) {
  const data = { story: input?.story ?? {}, scenes: Array.isArray(input?.scenes) ? input.scenes : [], words: Array.isArray(input?.words) ? input.words : [] };
  const findings = [];
  for (const t of PLAN_TELLS) {
    let hits = [];
    try { hits = DETECTORS[t.detector](data) ?? []; } catch { hits = []; }
    for (const hit of hits) findings.push({ rule: t.id, severity: t.severity, at: hit.at ?? 0, ids: hit.ids ?? [], detail: `${hit.detail}; ${t.fix.charAt(0).toLowerCase()}${t.fix.slice(1)}`, added: t.added });
  }
  return findings;
}

export { DETECTORS as TELL_DETECTORS };

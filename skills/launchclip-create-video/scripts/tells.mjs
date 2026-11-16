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
  heroMetrics: 1, signatureScenes: 3,
  chipBoxes: 2, headlineEcho: 0.5, headlineLetters: 4,
  // Frame rules (frameTells): shares of the sampled frame, colour distances in RGB.
  accentShare: 0.1, accentDistance: 48, rasterDim: 0.85, edgeStep: 60, blackStep: 12, edgeSides: 3,
  // Text over footage (thin-text-on-footage): the share of edge pixels (a
  // luma step of busyStep) in a ring around the text that makes the shot
  // busy, and the least size (px at 1080) and weight type needs on it.
  busyStep: 24, busyShare: 0.14, footageTextPx: 56, footageTextWeight: 600
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
  tell('accent-everywhere', 'slop', 'warning', 'frame', 'accentEverywhere', 'One accent, once or twice a frame.', 'unslop'),
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
  // The pilot's cheap modules (a 9:16 explainer with the brand's own footage).
  tell('boxed-on-flat', 'slop', 'error', 'plan', 'boxedOnFlat', 'Free type over the footage or a photo: before-after for one thing in two states, media-compare for two options with footage, item-list over footage, media-grid photo-backed tiles, photo-scene lines; or the same module on a scene backdrop.', 'LaunchClip pilot review'),
  tell('stock-icon', 'slop', 'warning', 'plan', 'stockIcon', 'Show the thing itself (the footage, a photo, an object), or no icon.', 'LaunchClip pilot review'),
  tell('caption-echoes-headline', 'slop', 'warning', 'plan', 'captionEchoesHeadline', 'Make the on-screen text add what the narration does not say (the figure, the name, the trade-off), or drop the headline and let the caption carry the line.', 'LaunchClip pilot review'),
  tell('emoji-icons', 'slop', 'error', 'plan', 'emojiIcons', 'One icon set (catalog-h-icons) or none.', 'unslop, impeccable'),
  tell('decorative-chrome', 'slop', 'warning', 'plan', 'decorativeChrome', 'Remove it, or show the real series.', 'impeccable, unslop'),
  tell('pulsing-dot', 'slop', 'warning', 'plan', 'pulsingDot', 'Keep it still unless something is live.', 'impeccable, unslop'),
  tell('blinking-cursor', 'slop', 'advisory', 'plan', 'blinkingCursor', 'No caret outside a recorded terminal or editor.', 'impeccable'),
  tell('marquee', 'slop', 'advisory', 'plan', 'marquee', 'A list that builds.', 'impeccable'),
  tell('bounce', 'slop', 'error', 'plan', 'bounce', 'Expo or quart out; no overshoot.', 'impeccable, unslop'),
  tell('clipart', 'slop', 'advisory', 'plan', 'clipart', 'A real asset, a photo, or a drawn world.', 'impeccable, unslop'),
  tell('ai-stock-imagery', 'slop', 'warning', 'plan', 'aiStockImagery', 'Show what the software produces.', 'unslop'),
  tell('baked-text', 'slop', 'advisory', 'plan', 'bakedText', 'Real text over a clean image.', 'unslop'),
  tell('buried-raster', 'quality', 'warning', 'frame', 'buriedRaster', 'Less dim, or no photo.', 'impeccable'),
  tell('unblended-media', 'quality', 'advisory', 'frame', 'unblendedMedia', 'Match the ground and soften the edge.', 'unslop'),
  tell('thin-text-on-footage', 'quality', 'warning', 'frame', 'thinTextOnFootage', 'Set it larger and heavier on a local dark grade, or move it off the busy part of the shot.', 'pilot review'),
  tell('organic-mask', 'slop', 'warning', 'plan', 'organicMask', 'A real matte from subject matting.', 'impeccable'),
  // The art direction (RFC §3): read only when the plan has a direction block.
  tell('hero-missing', 'quality', 'warning', 'plan', 'heroMissing', 'Mark each scene\'s one bright element as scene.hero; it carries the colour and the biggest move.', 'unslop'),
  tell('signature-thin', 'quality', 'warning', 'plan', 'signatureThin', 'Draw the signature detail, by its element id, on at least three scenes.', 'unslop')
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
// Real interfaces rebuilt on screen, and diagrams and charts: their boxes are the information.
const REAL_UI = /social|tooltip|window|terminal|repo-|commit|diff|device|evidence|tokenizer|calendar|month|date-|heatmap|keyboard|ui-|table|code|chat|notification|browser|person-id|subscribe|watermark|chart|plot|map|diagram|graph|clock|odometer|grid|multiples|cloud|ticker|archive/;
const wordedBox = (node) => viewTexts(node).some((t) => words(t.text).filter((w) => /\p{L}{2,}/u.test(w)).length >= 2);
const isFill = (v) => typeof v === 'string' && v.trim() && !/^(transparent|none)$/i.test(v.trim()) && !/^#[0-9a-f]{6}00$/i.test(v.trim());
const isBox = (node) => Boolean(parseFloat(node.style?.borderRadius) || /%/.test(String(node.style?.borderRadius ?? ''))) && (isFill(node.style?.background) || isFill(node.style?.backgroundColor) || /\b(solid|dashed)\b/.test(String(node.style?.border ?? '')));
// Icons that stand for any topic: on a hero card they read as a placeholder.
const STOCK_ICONS = new Set(['layers', 'box', 'boxes', 'sparkle', 'sparkles', 'star', 'lightbulb', 'rocket', 'bolt', 'zap', 'check', 'check-circle', 'info', 'grid', 'layout', 'target', 'diamond', 'gear', 'puzzle', 'trophy', 'flag', 'help']);
const HERO_ICON = new Set(['concept-card', 'section-card', 'stat-card', 'object-card']);
const ECHO_STOP = new Set(['with', 'your', 'that', 'this', 'from', 'what', 'when', 'they', 'them', 'have', 'more', 'than', 'into', 'about', 'just', 'only', 'also', 'every', 'each', 'here', 'there', 'their', 'will', 'were', 'been']);
const echoToken = (w) => String(w ?? '').toLowerCase().replace(/[‘’]/g, "'").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
// The scene's headline: the largest text of two or more words in its view, else its longest title-like param.
function headlineOf(s) {
  if (s.view) return viewTexts(s.view).filter((t) => words(t.text).length >= 2).sort((a, b) => Number(b.style.fontSize) - Number(a.style.fontSize))[0]?.text ?? null;
  const p = s.scene?.params ?? {};
  return ['headline', 'title', 'heading', 'text', 'label'].map((k) => p[k]).filter((v) => typeof v === 'string' && words(v).length >= 2).sort((a, b) => b.length - a.length)[0] ?? null;
}
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
      // The fill sits on the tile itself or on its first layer (catalog-g-base iconTile).
      const filled = (k) => [k, ...(k.children ?? []).filter((c) => c && typeof c === 'object')].some((n) => (isFill(n.style?.background) || isFill(n.style?.backgroundColor)) && n.style?.borderRadius);
      const i = kids.findIndex((k) => filled(k) && viewNodes(k).some(({ node: n }) => n.tag === 'svg') && !viewTexts(k).length);
      if (i >= 0 && kids[i + 1] && viewTexts(kids[i + 1]).length) return 'an icon in a filled tile sits above the headline';
    }
    return null;
  }),
  boxedOnFlat: (input) => perScene(input, (s) => {
    if (!s.view || REAL_UI.test(s.module) || s.scene?.backdrop || input.scenes.some((o) => o !== s && overlaps(o, s) && PICTURED.test(o.module))) return null;
    const frame = Number(input.story?.format?.width) || 1080;
    for (const { node } of viewNodes(s.view)) {
      const boxes = (node.children ?? []).filter((k) => k && typeof k === 'object' && isBox(k) && wordedBox(k) && !(Number(k.style?.width) >= frame * 0.9));
      if (boxes.length >= TELLS.chipBoxes) return `${s.id} (${s.module}) sets ${boxes.length} boxed text panels side by side on a flat plate`;
    }
    return null;
  }),
  stockIcon: (input) => perScene(input, (s) => {
    const icon = s.scene?.params?.icon;
    if (!HERO_ICON.has(s.module) || !STOCK_ICONS.has(icon)) return null;
    const shown = new Set(sceneTextWords(s.scene.params));
    return icon.split('-').some((part) => shown.has(part)) ? null : `${s.id} (${s.module}) leads with the stock icon "${icon}", which names nothing in its text`;
  }),
  captionEchoesHeadline(input) {
    if (!(input.story?.overlays ?? []).some((o) => o?.type === 'captions') || !input.words?.length) return [];
    return perScene(input, (s) => {
      // Title cards hide their captions (captions.mjs captionEchoHide); cards are fact-card-vs-caption's.
      if (CAPTION_ECHO_MODULES.includes(s.module) || isCard(s.module)) return null;
      const head = headlineOf(s);
      const content = head ? [...new Set(words(head).map(echoToken).filter((w) => w.length >= TELLS.headlineLetters && !ECHO_STOP.has(w)))] : [];
      if (content.length < 2) return null;
      const said = new Set(input.words.filter((w) => w.start >= s.start - 0.2 && w.start < s.end).map((w) => echoToken(w.word ?? w.text)));
      const echoed = content.filter((w) => said.has(w));
      return echoed.length / content.length >= TELLS.headlineEcho ? `the caption says ${echoed.map((w) => JSON.stringify(w)).join(', ')} while the headline ${JSON.stringify(head.slice(0, 48))} is on screen` : null;
    });
  },
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
  heroMissing(input) {
    if (!input.story?.direction || typeof input.story.direction !== 'object') return [];
    const bare = input.scenes.filter((s) => !s.track && !(typeof s.scene?.hero === 'string' && s.scene.hero.trim()));
    return bare.length ? [{ at: bare[0].start, ids: bare.map((s) => s.id), detail: `${bare.length} scene${bare.length > 1 ? 's name' : ' names'} no hero (${bare.slice(0, 4).map((s) => s.id).join(', ')})` }] : [];
  },
  signatureThin(input) {
    const element = input.story?.direction?.signature?.element;
    if (typeof element !== 'string' || !element.trim()) return [];
    const token = new RegExp(`(^|[^a-z0-9_-])${element.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9_-])`, 'i');
    const on = input.scenes.filter((s) => token.test(JSON.stringify(s.scene?.params ?? {})) || token.test(String(s.scene?.hero ?? '')) || (s.view && viewNodes(s.view).some(({ node }) => token.test(String(node.id ?? '')))));
    return on.length < TELLS.signatureScenes ? [{ at: 0, ids: on.map((s) => s.id), detail: `the signature "${element}" is on ${on.length} scene${on.length === 1 ? '' : 's'}` }] : [];
  },
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

// ---------------------------------------------------------------------------
// Frame rules: judged on pixels the caller samples from the render and the
// assets (src/frame_tells.js). An image is {width, height, pixels} (RGBA).

const rgbOf = (hex) => { const m = /^#?([0-9a-f]{6})/i.exec(String(hex ?? '')); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const luma = (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
const px = (image, x, y) => { const o = (y * image.width + x) * 4; return [image.pixels[o], image.pixels[o + 1], image.pixels[o + 2]]; };

/** The share of an image's pixels within `within` (RGB distance) of a colour. */
export function colorShare(image, rgb, within = TELLS.accentDistance) {
  let near = 0;
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) if (dist(px(image, x, y), rgb) <= within) near += 1;
  return near / (image.width * image.height || 1);
}

/**
 * How a media rect sits on what is around it: per side, the mean colour step
 * across the edge (a 3 px strip inside against a 3 px strip outside, a pixel
 * clear of the edge itself), and the black levels (the darkest tenth of the
 * luma) inside the rect and in a ring around it. Sides at the frame edge are
 * skipped. → {sides: [step | null ×4], blackIn, blackOut}
 */
export function mediaEdge(image, rect, strip = 3) {
  const W = image.width, H = image.height;
  const x0 = Math.round(rect.x), y0 = Math.round(rect.y), x1 = Math.round(rect.x + rect.width), y1 = Math.round(rect.y + rect.height);
  const mean = (xa, ya, xb, yb) => {
    const sum = [0, 0, 0]; let n = 0;
    for (let y = Math.max(0, ya); y < Math.min(H, yb); y += 1) for (let x = Math.max(0, xa); x < Math.min(W, xb); x += 1) { const p = px(image, x, y); sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; n += 1; }
    return n ? sum.map((v) => v / n) : null;
  };
  const step = (inside, outside) => (inside && outside ? dist(inside, outside) : null);
  const g = strip + 1;
  const sides = [
    y0 - g >= 0 ? step(mean(x0, y0 + 1, x1, y0 + g), mean(x0, y0 - g, x1, y0 - 1)) : null,
    x1 + g <= W ? step(mean(x1 - g, y0, x1 - 1, y1), mean(x1 + 1, y0, x1 + g, y1)) : null,
    y1 + g <= H ? step(mean(x0, y1 - g, x1, y1 - 1), mean(x0, y1 + 1, x1, y1 + g)) : null,
    x0 - g >= 0 ? step(mean(x0 + 1, y0, x0 + g, y1), mean(x0 - g, y0, x0 - 1, y1)) : null
  ];
  const ring = 4 * strip, inner = [], outer = [];
  for (let y = Math.max(0, y0 - ring); y < Math.min(H, y1 + ring); y += 1) for (let x = Math.max(0, x0 - ring); x < Math.min(W, x1 + ring); x += 1) {
    const isIn = x >= x0 && x < x1 && y >= y0 && y < y1;
    (isIn ? inner : outer).push(luma(px(image, x, y)));
  }
  const dark = (list) => { if (!list.length) return null; const sorted = list.sort((a, b) => a - b); return sorted[Math.floor(sorted.length * 0.1)]; };
  return { sides, blackIn: dark(inner), blackOut: dark(outer) };
}

/** The share of edge pixels (a luma step of TELLS.busyStep right or down) in a ring `pad` px wide around rect. */
export function ringDetail(image, rect, pad) {
  const W = image.width, H = image.height;
  const x0 = Math.round(rect.x), y0 = Math.round(rect.y), x1 = Math.round(rect.x + rect.width), y1 = Math.round(rect.y + rect.height);
  let edges = 0, n = 0;
  for (let y = Math.max(0, y0 - pad); y < Math.min(H - 1, y1 + pad); y += 2) for (let x = Math.max(0, x0 - pad); x < Math.min(W - 1, x1 + pad); x += 2) {
    if (x >= x0 && x < x1 && y >= y0 && y < y1) continue;
    const v = luma(px(image, x, y));
    n += 1;
    if (Math.abs(v - luma(px(image, x + 1, y))) >= TELLS.busyStep || Math.abs(v - luma(px(image, x, y + 1))) >= TELLS.busyStep) edges += 1;
  }
  return n ? edges / n : 0;
}

const FRAME_DETECTORS = {
  // frames: [{id, at, image}], one per main-track scene, mid-hold.
  accentEverywhere(input) {
    const colors = input.story?.brand?.colors ?? {};
    const accent = rgbOf(colors.accent ?? colors.primary);
    // An accent that is the ground (or close to it) would read as everywhere on every frame.
    if (!accent || ['bg', 'background', 'paper'].some((key) => rgbOf(colors[key]) && dist(rgbOf(colors[key]), accent) <= TELLS.accentDistance)) return [];
    const moments = new Set(Array.isArray(input.story?.direction?.moments) ? input.story.direction.moments : []);
    return (input.frames ?? []).filter((f) => !moments.has(f.id)).flatMap((f) => {
      const share = colorShare(f.image, accent);
      return share > TELLS.accentShare ? [{ at: f.at, ids: [f.id], detail: `${Math.round(share * 100)}% of ${f.id}'s frame is the accent (over ${Math.round(TELLS.accentShare * 100)}%, outside a direction moment)` }] : [];
    });
  },
  // plates: [{id, at, path, dim, raw, dimmed}]: an image or video plate's edge share as the asset is (raw) and under its dim (dimmed).
  buriedRaster: (input) => (input.plates ?? []).filter((p) => p.dim > TELLS.rasterDim && p.raw >= p.minimum && p.dimmed < p.minimum)
    .map((p) => ({ at: p.at ?? 0, ids: [p.id], detail: `the picture on ${p.path} has detail (${round(p.raw * 100)}% edges) that its ${p.dim} dim washes out (${round(p.dimmed * 100)}%)` })),
  // media: [{id, at, rect, image}]: a media window (not full frame) on the frame it plays in.
  // texts: [{id, at, rect, size, weight, image}], text over footage at full size, mid-hold.
  thinTextOnFootage: (input) => (input.texts ?? []).flatMap((t) => {
    const scale = Math.min(t.image.width, t.image.height) / 1080;
    const small = Number(t.size) < TELLS.footageTextPx * scale - 1e-6, thin = Number(t.weight) > 0 && Number(t.weight) < TELLS.footageTextWeight;
    if (!small && !thin) return [];
    const busy = ringDetail(t.image, t.rect, Math.max(8, Math.round(Number(t.size) * 0.6) || 24));
    return busy >= TELLS.busyShare ? [{ at: t.at, ids: [t.id], detail: `${t.id} sets ${small ? `${Math.round(t.size)} px` : ''}${small && thin ? ', ' : ''}${thin ? `weight ${t.weight}` : ''} type over busy footage (${Math.round(busy * 100)}% edges around it)` }] : [];
  }),
  unblendedMedia: (input) => (input.media ?? []).flatMap((m) => {
    const edge = mediaEdge(m.image, m.rect);
    const measured = edge.sides.filter((v) => v !== null), hard = measured.filter((v) => v >= TELLS.edgeStep);
    const black = edge.blackIn !== null && edge.blackOut !== null ? Math.abs(edge.blackIn - edge.blackOut) : 0;
    return measured.length && hard.length >= Math.min(TELLS.edgeSides, measured.length) && black >= TELLS.blackStep
      ? [{ at: m.at, ids: [m.id], detail: `${m.id} meets the plate with a hard edge on ${hard.length} of ${measured.length} sides and a black ${Math.round(black)} levels apart` }] : [];
  })
};

/** The registry's live frame rules. */
export const FRAME_TELLS = Object.freeze(TELL_REGISTRY.filter((t) => t.applies === 'frame' && !t.retired && t.detector));

/** Every live frame rule on sampled pixels → findings in the gate shape (as planTells). */
export function frameTells(input) {
  const data = { story: input?.story ?? {}, frames: input?.frames ?? [], media: input?.media ?? [], plates: input?.plates ?? [], texts: input?.texts ?? [] };
  const findings = [];
  for (const t of FRAME_TELLS) {
    let hits = [];
    try { hits = FRAME_DETECTORS[t.detector](data) ?? []; } catch { hits = []; }
    for (const hit of hits) findings.push({ rule: t.id, severity: t.severity, at: hit.at ?? 0, ids: hit.ids ?? [], detail: `${hit.detail}; ${t.fix.charAt(0).toLowerCase()}${t.fix.slice(1)}`, added: t.added });
  }
  return findings;
}

export { DETECTORS as TELL_DETECTORS, FRAME_DETECTORS };

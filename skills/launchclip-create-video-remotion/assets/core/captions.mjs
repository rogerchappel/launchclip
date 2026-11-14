// Word captions core: chunk measured narration words into short-form caption
// lines, the caption preset system (captionPlan: one declarative DOM tree +
// GSAP tween list per preset) and the seek-safe GSAP runtime and CSS the
// HyperFrames compiler mounts. The Remotion kit
// (kit/remotion/captions/WordCaptions.tsx) builds the same plan and evaluates
// its tweens frame-purely (captionStateAt), so both renderers draw every
// preset identically. Imports only its kit/core siblings (motion.mjs,
// fonts.mjs). The CLI wrapper is word-captions.mjs in the create-video skills.
//
// Canonical copy: kit/core/captions.mjs.

import { getEase, interpolateColor } from './motion.mjs';
import { brandFontStacks } from './fonts.mjs';
import { captionSnapOffset, guardFrames, guardRect, resolveMotionBlur } from './motion-blur.mjs';
import { CHARACTER_CAPTIONS, isCharacterStory } from './character-story.mjs';

const STRONG_BREAK = /[.!?…]$/;
const SOFT_BREAK = /[,;:—–-]$/;

// Caption motion, shared by the GSAP runtime below and WordCaptions.tsx so
// both renderers pop, highlight and clear identically.
export const CAPTION_MOTION = Object.freeze({
  lineIn: Object.freeze({ from: Object.freeze({ opacity: 0, y: 26, scale: 0.86 }), duration: 0.16, ease: 'back.out(2.2)' }),
  wordOn: Object.freeze({ lead: 0.03, scale: 1.08, duration: 0.06, ease: 'power2.out' }),
  wordOff: Object.freeze({ minHold: 0.08, duration: 0.12, ease: 'power1.out' }),
  lineOut: Object.freeze({ to: Object.freeze({ opacity: 0, y: -10 }), duration: 0.1, ease: 'power2.in', minShow: 0.12, lead: 0.1 })
});

// Caption band and type, in the units captionCss() uses (fractions of the
// canvas for the band, px for type). The band is the layout check's caption
// band (kit/core/layout-check.mjs SAFE_ZONE_PROFILES), so the geometry it
// checks is where the captions render: Shorts (portrait, square and 4:5)
// clears the right-hand action rail; landscape sits in the lower title-safe
// band, below the content instead of across its middle.
export const CAPTION_BAND = Object.freeze({ left: 0.06, right: 0.15, top: 0.62, height: 0.12, fontSize: 74, fontWeight: 900, lineHeight: 1.05, gap: 0.42, stroke: 10, zIndex: 50 });
export const CAPTION_BAND_LANDSCAPE = Object.freeze({ ...CAPTION_BAND, left: 0.1, right: 0.1, top: 0.8, height: 140 / 1080 });

/** Caption band for a format {width, height}: landscape when wider than tall. */
export function captionBandFor(format) {
  return Number(format?.width) > Number(format?.height) ? CAPTION_BAND_LANDSCAPE : CAPTION_BAND;
}

export const CAPTION_DEFAULT_COLORS = Object.freeze({ idle: '#ffffff', active: '#ffd23f' });

// Transcript tokens that belong to the word before them: a hyphenated tail
// ("-free" after "hands"), bare closing punctuation, or a clitic ("'s", "n't").
const ATTACHES_BACK = /^(?:[-‐‑][\p{L}\p{N}]|[.,!?;:%…)\]}"”’]+$|['’](?:s|re|ve|ll|d|m|t)$|n['’]t$)/iu;
// A word ending in a hyphen, or a bare opening mark, takes the next token.
const ATTACHES_FORWARD = /(?:[\p{L}\p{N}][-‐‑]|^[(\["“‘])$/u;

/**
 * Words for display: tokens the transcript split off a word ("hands" +
 * "-free", "word" + ",") are joined back into one caption word that runs
 * from the first token's start to the last one's end. The transcript's own
 * word timings are never changed.
 */
export function joinAttachedWords(words) {
  const out = [];
  for (const word of words) {
    const previous = out.at(-1);
    if (previous && (ATTACHES_BACK.test(word.text) || ATTACHES_FORWARD.test(previous.text))) {
      out[out.length - 1] = { ...previous, text: previous.text + word.text, end: Math.max(previous.end, word.end) };
      continue;
    }
    out.push(word);
  }
  return out;
}

const lineChars = (words) => words.reduce((sum, word) => sum + word.text.length + 1, -1);

/**
 * A phrase's last word is kept with its phrase: when a line filled up one
 * word short of the phrase's end ("The foal watched the starting" / "gate."),
 * the fuller line hands words from its end to the lone word until the two
 * are about even ("The foal watched" / "the starting gate."). Only a lone
 * word that ends a phrase (a full stop, a comma) straight after a line that
 * was cut for size, spoken without a pause, and only when the line before
 * keeps two words or more; a one-word sentence ("No.") stays alone. Edits
 * chunks in place.
 */
function keepPhraseEnds(chunks, { maxWords, maxChars, gapSeconds }) {
  for (let i = 1; i < chunks.length; i += 1) {
    const before = chunks[i - 1].words, lone = chunks[i].words;
    if (lone.length !== 1 || before.length < 3) continue;
    const last = before.at(-1);
    if (!(STRONG_BREAK.test(lone[0].text) || SOFT_BREAK.test(lone[0].text)) || STRONG_BREAK.test(last.text) || SOFT_BREAK.test(last.text) || lone[0].start - last.end > gapSeconds) continue;
    let keep = before.length;
    // Hand over a word while the line before stays the longer one (or level), keeps two words, and the new line fits.
    while (keep > 2) {
      const moved = [...before.slice(keep - 1), ...lone];
      if (moved.length > maxWords || lineChars(moved) > maxChars) break;
      if (keep < before.length && lineChars(moved) > lineChars(before.slice(0, keep - 1))) break;
      keep -= 1;
    }
    if (keep === before.length) continue;
    const next = [...before.slice(keep), ...lone];
    chunks[i - 1] = { start: before[0].start, end: before[keep - 1].end, words: before.slice(0, keep) };
    chunks[i] = { start: next[0].start, end: next.at(-1).end, words: next };
  }
}

/**
 * Words → caption chunks: a line fills until the next word would pass
 * maxWords or maxChars, and ends on a full stop, a comma (after two words or
 * more) or a pause over gapSeconds. keepPhrase (off by default, so every
 * caption that was chunked before is chunked the same): a phrase's last word
 * is kept with its phrase (keepPhraseEnds); a character story's captions
 * turn it on.
 */
export function chunkWords(words, { maxWords = 3, maxChars = 18, gapSeconds = 0.28, keepPhrase = false } = {}) {
  const clean = joinAttachedWords(words
    .map((word) => ({ text: String(word.text ?? word.word ?? '').trim(), start: Number(word.start), end: Number(word.end) }))
    .filter((word) => word.text && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end >= word.start));
  const chunks = [];
  let current = [];
  const flush = () => {
    if (!current.length) return;
    chunks.push({ start: current[0].start, end: current.at(-1).end, words: current });
    current = [];
  };
  for (const word of clean) {
    const previous = current.at(-1);
    const length = current.reduce((sum, entry) => sum + entry.text.length + 1, 0) + word.text.length;
    if (previous && (word.start - previous.end > gapSeconds || current.length >= maxWords || length > maxChars)) flush();
    current.push(word);
    if (STRONG_BREAK.test(word.text) || (SOFT_BREAK.test(word.text) && current.length > 1)) flush();
  }
  flush();
  if (keepPhrase) keepPhraseEnds(chunks, { maxWords, maxChars, gapSeconds });
  // Hold each chunk until the next one starts (or briefly past its last word)
  // so captions never blink off between closely spaced phrases.
  return chunks.map((chunk, index) => {
    const next = chunks[index + 1];
    const hold = next ? Math.min(next.start, chunk.end + 0.6) : chunk.end + 0.4;
    return { id: `cap-${String(index + 1).padStart(3, '0')}`, start: round(chunk.start), end: round(Math.max(hold, chunk.end)), words: chunk.words.map((word) => ({ text: word.text, start: round(word.start), end: round(word.end) })) };
  });
}

/** Chunks from a captions.json document ({chunks}) or a bare chunk array. */
export function captionChunksFrom(data) {
  const chunks = Array.isArray(data) ? data : Array.isArray(data?.chunks) ? data.chunks : null;
  if (!chunks) throw new Error('captions.json must hold a chunks array');
  return chunks;
}

/** Words from NARRATION.json ({words}) or a bare word array. */
export function narrationWords(data) {
  return Array.isArray(data) ? data : Array.isArray(data?.words) ? data.words : [];
}

/**
 * Drop chunks whose start falls inside a hidden range, as mountCaptions does,
 * and end a chunk that runs into one at its start, so a line spoken just
 * before a full-frame title has left by the time the title arrives.
 */
export function visibleChunks(chunks, hide = []) {
  return chunks.filter((chunk) => !hide.some(([from, to]) => chunk.start >= from && chunk.start < to)).map((chunk) => {
    const cut = Math.min(...hide.map(([from]) => Number(from)).filter((from) => from > chunk.start && from < chunk.end));
    if (!Number.isFinite(cut)) return chunk;
    const words = (chunk.words ?? []).filter((word) => word.start < cut).map((word) => (word.end > cut ? { ...word, end: cut } : word));
    return { ...chunk, end: cut, words };
  });
}

// --- captions that repeat a card --------------------------------------------
// A line whose words a title card already shows (a call to action's "Save
// this video" under the spoken "save this video") is said twice on screen.
// Such a line is hidden while the card is up: CAPTION_ECHO of its words are
// on the card, which covers at least half of the line's spoken span. Only
// title cards (CAPTION_ECHO_MODULES): a list or chart that names what the
// narration says keeps its captions.

export const CAPTION_ECHO = Object.freeze({ share: 0.75, headlineWords: 3, minLetters: 4 });
export const CAPTION_ECHO_MODULES = Object.freeze(['hook-title', 'motion-title', 'title-decompose', 'kinetic-words', 'cta', 'subscribe-cta', 'section-card', 'concept-card', 'quote-card', 'stat-card', 'brand-lockup', 'equation-lockup', 'emphasis-caption']);
const TEXT_KEY = /title|headline|head|text|label|quote|body|eyebrow|kicker|cta|line|item|word|caption|name|note|stat|value|step|point/i;
const echoWord = (text) => String(text ?? '').toLowerCase().replace(/[‘’]/g, "'").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/** The words a scene shows as text: strings under its text-like params (lists included), never asset paths. */
export function sceneTextWords(params) {
  const out = [];
  const walk = (value, textual) => {
    if (typeof value === 'string') { if (textual && !/^(assets|https?:)\/|\.[a-z0-9]{2,4}$/i.test(value.trim())) out.push(...value.split(/\s+/).map(echoWord).filter(Boolean)); return; }
    if (Array.isArray(value)) { for (const item of value) walk(item, textual); return; }
    if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) walk(item, textual || TEXT_KEY.test(key));
  };
  walk(params, false);
  return out;
}

/** Spans ([[start, end]]) of caption chunks that repeat a card on screen with them (CAPTION_ECHO). */
export function captionEchoHide(story, chunks = []) {
  const scenes = (Array.isArray(story?.scenes) ? story.scenes : [])
    .filter((scene) => CAPTION_ECHO_MODULES.includes(scene?.module) && Number.isFinite(Number(scene?.start)) && Number.isFinite(Number(scene?.end)))
    .map((scene) => ({ start: Number(scene.start), end: Number(scene.end), words: sceneTextWords(scene.params) }))
    .filter((scene) => scene.words.length);
  if (!scenes.length) return [];
  const out = [];
  for (const chunk of chunks) {
    const words = (chunk.words ?? []).map((word) => echoWord(word.text)).filter(Boolean);
    if (!words.length) continue;
    const from = Number(chunk.start), to = Math.max(from + 1e-3, Number(chunk.words?.at(-1)?.end ?? chunk.end));
    const echoed = scenes.some((scene) => {
      if (Math.min(to, scene.end) - Math.max(from, scene.start) < (to - from) / 2 - 1e-6) return false;
      const shown = new Set(scene.words);
      if (words.length === 1) return words[0].length >= CAPTION_ECHO.minLetters && scene.words.length <= CAPTION_ECHO.headlineWords && shown.has(words[0]);
      return words.filter((word) => shown.has(word)).length / words.length >= CAPTION_ECHO.share - 1e-9;
    });
    if (echoed) out.push([round(from), round(Math.max(Number(chunk.end), to))]);
  }
  return out;
}

export function captionRuntime(chunks) {
  return `// Generated by word-captions.mjs. Call mountCaptions(tl, container) while
// building the paused root timeline; everything is created synchronously.
(function () {
  var CHUNKS = ${JSON.stringify(chunks)};
  window.mountCaptions = function (tl, container, opts) {
    opts = opts || {};
    var hidden = opts.hide || [];
    // GSAP cannot tween var(--x) strings, so resolve the palette to literal
    // colours once, synchronously, from the container's computed style.
    var style = getComputedStyle(container);
    function token(name, fallback) { var v = style.getPropertyValue(name).trim(); return v || fallback; }
    var idle = opts.idle || token('--cap-idle', '#ffffff');
    var active = opts.active || token('--cap-active', '#ffd23f');
    var spoken = opts.spoken || token('--cap-spoken', idle);
    function isHidden(t) { for (var i = 0; i < hidden.length; i++) if (t >= hidden[i][0] && t < hidden[i][1]) return true; return false; }
    CHUNKS.forEach(function (chunk) {
      if (isHidden(chunk.start)) return;
      var line = document.createElement('div');
      line.className = 'lc-cap';
      line.id = chunk.id;
      chunk.words.forEach(function (word, i) {
        var span = document.createElement('span');
        span.className = 'lc-cap-w';
        span.id = chunk.id + '-w' + i;
        span.textContent = word.text;
        line.appendChild(span);
      });
      container.appendChild(line);
      tl.fromTo(line, { opacity: 0, y: 26, scale: 0.86 }, { opacity: 1, y: 0, scale: 1, duration: 0.16, ease: 'back.out(2.2)' }, chunk.start);
      chunk.words.forEach(function (word, i) {
        var span = line.children[i];
        span.style.color = idle;
        tl.fromTo(span, { color: idle, scale: 1 }, { color: active, scale: 1.08, duration: 0.06, ease: 'power2.out', immediateRender: false }, Math.max(0, word.start - 0.03));
        tl.to(span, { color: spoken, scale: 1, duration: 0.12, ease: 'power1.out' }, Math.max(word.end, word.start + 0.08));
      });
      tl.to(line, { opacity: 0, y: -10, duration: 0.1, ease: 'power2.in' }, Math.max(chunk.start + 0.12, chunk.end - 0.1));
    });
  };
})();
`;
}

/** Caption CSS for the HyperFrames compiler, placed on the format's band. */
export function captionCss(format) {
  const b = captionBandFor(format);
  const pct = (value) => `${round(value * 100)}%`;
  return `.lc-captions { position: absolute; left: ${pct(b.left)}; right: ${pct(b.right)}; top: ${pct(b.top)}; height: ${pct(b.height)}; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: ${b.zIndex}; }
.lc-cap { position: absolute; display: flex; gap: ${b.gap}em; flex-wrap: wrap; justify-content: center; font: ${b.fontWeight} ${b.fontSize}px/${b.lineHeight} var(--cap-font, 'Anton', 'STIX Two Math', sans-serif); letter-spacing: -0.01em; text-transform: uppercase; opacity: 0; }
.lc-cap-w { display: inline-block; paint-order: stroke fill; -webkit-text-stroke: ${b.stroke}px rgba(0,0,0,.92); text-shadow: 0 6px 0 rgba(0,0,0,.55), 0 12px 28px rgba(0,0,0,.45); transform-origin: 50% 70%; }
`;
}

/** Portrait caption CSS (the band every format used before captionCss). */
export const CAPTION_CSS = captionCss({ width: 1080, height: 1920 });

function round(value) { return Math.round(value * 1000) / 1000; }

// ---------------------------------------------------------------------------
// Caption presets
//
// A preset is a combination of layout, typography and animation. captionPlan()
// turns chunks + a captions overlay into {css, nodes, tweens}:
//   nodes   a DOM tree (div/span, id, cls, text, children) both renderers draw;
//   css     the static styles for those classes (same text in both renderers);
//   tweens  [{id, at, dur, ease, from?, to, ir?}] GSAP fromTo/to calls on the
//           paused root timeline (from present → fromTo; ir → immediateRender).
// HyperFrames mounts them with captionPlanRuntime(); Remotion evaluates them at
// each frame with captionStateAt(), which reproduces GSAP's forward-seek
// semantics. Animated props: opacity, x, y, scale, scaleX, color,
// backgroundColor, width (percent). Rules that keep the plan seek-safe and
// frame-pure: per element and property, only the first tween may render
// immediately, and a `to` tween always follows an earlier tween of that
// property (so its start value is defined by the plan, not by frame sampling).

/** Legacy overlay `style` values; `line` maps to the minimal-line preset. */
export const CAPTION_LEGACY_STYLES = Object.freeze({ 'word-highlight': 'word-highlight', line: 'minimal-line', none: null });
// 'seam': on the line between a stacked section's panel and presenter
// (kit/core/footage-layout.mjs captionZone); 'chest': at the presenter's chest
// height, from the measured head (captionZones). Elsewhere both sit as 'auto' does.
export const CAPTION_POSITIONS = Object.freeze(['bottom', 'middle', 'low', 'top', 'auto', 'seam', 'chest']);
// 'low': centred 58% down the frame, below the middle: a word tag that sits
// on the panels' lower half (the interface-explainer look).
export const CAPTION_LOW_CENTRE = 0.58;
export const CAPTION_CASES = Object.freeze(['as-is', 'upper', 'title', 'lower']);
export const CAPTION_PLATE_STYLES = Object.freeze(['box', 'scrim']);
export const CAPTION_FONT_ROLES = Object.freeze(['display', 'body', 'meta']);
export const CAPTION_ENTRANCES = Object.freeze({
  pop: Object.freeze({ from: Object.freeze({ opacity: 0, y: 26, scale: 0.86 }), dur: 0.16, ease: 'back.out(2.2)' }),
  fade: Object.freeze({ from: Object.freeze({ opacity: 0, y: 0, scale: 1 }), dur: 0.2, ease: 'power1.out' }),
  'slide-up': Object.freeze({ from: Object.freeze({ opacity: 0, y: 44, scale: 1 }), dur: 0.24, ease: 'power3.out' }),
  'slide-left': Object.freeze({ from: Object.freeze({ opacity: 0, x: -48, y: 0, scale: 1 }), dur: 0.24, ease: 'power3.out' }),
  scale: Object.freeze({ from: Object.freeze({ opacity: 0, y: 0, scale: 1.28 }), dur: 0.2, ease: 'back.out(2.6)' }),
  // none: on screen within a blur sub-frame, like the none exit.
  none: Object.freeze({ from: Object.freeze({ opacity: 0, y: 0, scale: 1 }), dur: 0.005, ease: 'none' })
});
export const CAPTION_EXITS = Object.freeze({
  'fade-up': Object.freeze({ to: Object.freeze({ opacity: 0, y: -10 }), dur: 0.1, ease: 'power2.in' }),
  fade: Object.freeze({ to: Object.freeze({ opacity: 0 }), dur: 0.14, ease: 'power1.in' }),
  'slide-down': Object.freeze({ to: Object.freeze({ opacity: 0, y: 24 }), dur: 0.14, ease: 'power2.in' }),
  shrink: Object.freeze({ to: Object.freeze({ opacity: 0, scale: 0.82 }), dur: 0.12, ease: 'power2.in' }),
  // none: gone within a blur sub-frame (src/motion_blur.js samples a third of a frame apart).
  none: Object.freeze({ to: Object.freeze({ opacity: 0 }), dur: 0.005, ease: 'none' })
});

const SHADOW_HARD = '0 6px 0 rgba(0,0,0,.55), 0 12px 28px rgba(0,0,0,.45)';
const SHADOW_SOFT = '0 2px 14px rgba(0,0,0,.6)';
const SHADOW_LIFT = '0 3px 8px rgba(0,0,0,.88)';
const PRESET_COLORS = Object.freeze({ idle: 'paper', active: 'primary', spoken: null, accent: 'accent', box: 'primary', boxText: 'ink', plate: 'ink', band: 'primary', bandEdge: 'accent', chip: 'paper' });
const preset = (spec) => Object.freeze({
  font: 'display', weight: 900, size: 74, lineHeight: 1.05, letterSpacing: '-0.01em', case: 'upper', gap: 0.42,
  stroke: 10, strokeColor: 'rgba(0,0,0,.92)', shadow: SHADOW_HARD, layout: 'line', maxWords: 3, maxChars: 18,
  entrance: 'pop', exit: 'fade-up', word: 'highlight', emphasis: false, plate: false,
  ...spec,
  colors: Object.freeze({ ...PRESET_COLORS, ...(spec.colors ?? {}) })
});

/**
 * Every caption preset. word-highlight is the original LaunchClip caption,
 * unchanged. Keys are the values of a captions overlay's `preset` (or `style`).
 */
export const CAPTION_PRESETS = Object.freeze({
  'word-highlight': preset({ description: 'Bold uppercase chunks; the spoken word turns the brand primary and pops.' }),
  'karaoke-fill': preset({ description: 'A primary fill sweeps through each word as it is spoken.', word: 'fill' }),
  'pop-word': preset({ description: 'One big word at a time with a scale pop; keywords in the accent colour.', layout: 'single', word: 'pop', size: 104, emphasis: true, entrance: 'none', exit: 'fade' }),
  'seam-word': preset({ description: 'One bold white word at a time, as spoken: the stacked talking head\'s caption on the seam between panel and presenter.', layout: 'single', word: 'none', font: 'body', weight: 800, size: 64, case: 'as-is', letterSpacing: '-0.01em', stroke: 4, strokeColor: 'rgba(0,0,0,.6)', shadow: SHADOW_LIFT, maxWords: 1, maxChars: 24, entrance: 'none', exit: 'none', colors: { idle: '#ffffff', active: '#ffffff' } }),
  bounce: preset({ description: 'Each word hops and lands with a bounce as it is spoken.', word: 'bounce', size: 72, emphasis: true, entrance: 'slide-up' }),
  typewriter: preset({ description: 'Monospace letters type on over a dark plate.', font: 'meta', weight: 600, size: 50, case: 'as-is', letterSpacing: '0em', gap: 0.5, stroke: 0, shadow: 'none', word: 'type', maxWords: 5, maxChars: 26, entrance: 'fade', exit: 'fade', plate: true }),
  'box-highlight': preset({ description: 'A rounded primary box sits behind the active word.', word: 'box', size: 70, stroke: 0, shadow: SHADOW_SOFT, gap: 0.34 }),
  'underline-sweep': preset({ description: 'An underline sweeps under each word as it is spoken.', font: 'body', weight: 800, size: 62, case: 'as-is', stroke: 0, shadow: SHADOW_SOFT, word: 'underline', gap: 0.3, maxWords: 4, maxChars: 24, entrance: 'slide-up', exit: 'fade' }),
  'kinetic-stack': preset({ description: 'Words stack one per line, sized by emphasis.', layout: 'stack', word: 'stack', size: 66, lineHeight: 0.98, gap: 0.04, emphasis: true, entrance: 'none', exit: 'shrink' }),
  'minimal-line': preset({ description: 'One clean sentence-case line that fades in and out.', font: 'body', weight: 600, size: 50, lineHeight: 1.18, case: 'as-is', letterSpacing: '0em', gap: 0.26, stroke: 0, shadow: SHADOW_SOFT, word: 'none', maxWords: 7, maxChars: 34, entrance: 'fade', exit: 'fade' }),
  glow: preset({ description: 'Neon glow blooms behind the active word.', word: 'glow', stroke: 0, shadow: 'none', entrance: 'fade', exit: 'fade' }),
  'outline-heavy': preset({ description: 'Creator style: thick black outline, hard shadow, snap-in lines.', size: 84, stroke: 18, strokeColor: '#000000', shadow: '0 8px 0 #000000', word: 'highlight-big', emphasis: true, entrance: 'scale', exit: 'shrink', gap: 0.3 }),
  'split-color': preset({ description: 'Keywords in the accent colour; they pop when spoken.', word: 'emphasis', weight: 800, size: 70, case: 'title', stroke: 8, emphasis: true, entrance: 'slide-up', exit: 'fade', maxWords: 4, maxChars: 22, gap: 0.3 }),
  'lower-band': preset({ description: 'A broadcast band slides in; sentence-case text sits on it.', layout: 'band', font: 'body', weight: 700, size: 50, lineHeight: 1.1, case: 'as-is', letterSpacing: '0em', gap: 0.26, stroke: 0, shadow: 'none', word: 'none', maxWords: 6, maxChars: 30, entrance: 'slide-left', exit: 'fade', colors: { idle: 'ink' } }),
  // The interface-explainer caption: a single word, uppercase and bare, on a
  // small translucent chip that reads over busy panels without competing
  // with the headline.
  'word-chip': preset({ description: 'One word at a time, as spoken, uppercase with no punctuation, on a small opaque dark chip: a quiet word tag over busy interface panels.', layout: 'single', word: 'none', font: 'body', weight: 700, size: 40, case: 'upper', letterSpacing: '0.04em', stroke: 0, shadow: 'none', maxWords: 1, maxChars: 24, entrance: 'none', exit: 'none', punctuation: false, colors: { idle: '#f4f6ee', active: '#f4f6ee', plate: '#20231c' }, plate: 'card' }),
  bubble: preset({ description: 'Each word is a rounded chip; the active chip turns primary.', font: 'body', weight: 800, size: 54, case: 'as-is', letterSpacing: '0em', gap: 0.2, stroke: 0, shadow: 'none', word: 'chip', maxWords: 4, maxChars: 22, entrance: 'none', exit: 'fade', colors: { idle: 'ink' } }),
  // The footage-led default (docs/VIDEO_QUALITY_RFC.md §9.1): quiet enough to
  // sit under a talking head all the way through.
  'quiet-accent': preset({ description: 'Quiet sentence-case lines; one accent word per line in the accent colour.', font: 'body', weight: 600, size: 52, lineHeight: 1.16, case: 'as-is', letterSpacing: '0em', gap: 0.26, stroke: 0, shadow: SHADOW_SOFT, word: 'none', emphasis: true, accents: 1, maxWords: 6, maxChars: 32, entrance: 'fade', exit: 'fade' }),
  // Motion-graphics captions: the line builds up word by word and stays;
  // connecting words are small, one hero word per line is large and glows
  // in the active colour (captionHierarchy). No box: a line that needs help
  // to read gets a soft scrim, not a plate.
  'kinetic-hierarchy': preset({ description: 'The line builds up word by word; small connecting words, one large hero word per line glowing in the active colour.', weight: 900, size: 60, lineHeight: 1.05, case: 'as-is', letterSpacing: '-0.022em', gap: 0.24, stroke: 1, strokeColor: 'rgba(0,0,0,.38)', shadow: SHADOW_LIFT, word: 'hierarchy', maxWords: 3, maxChars: 24, entrance: 'none', exit: 'fade', plateStyle: 'scrim' }),
  'soft-card': preset({ description: 'The whole line sits on a rounded card in the plate colour (the brand primary), in bold ink type.', colors: { idle: 'ink', plate: 'primary' }, font: 'body', weight: 900, size: 60, case: 'as-is', letterSpacing: '0em', gap: 0.26, stroke: 0, shadow: 'none', word: 'none', maxWords: 4, maxChars: 24, entrance: 'pop', exit: 'fade', plate: 'card' }),
  // The satisfying-motion captions: the sentence builds word by word and
  // stays, plain and quiet, and the key phrase lands in a solid ink chip
  // (tag-chips) or turns serif italic in the brand colour (serif-accent).
  'tag-chips': preset({ description: 'The sentence builds word by word; key phrases land in solid chips (ink on a light brand, paper on a dark one) that wipe in as they are said.', colors: { box: 'ink', boxText: 'paper' }, font: 'body', weight: 800, size: 58, lineHeight: 1.14, case: 'as-is', letterSpacing: '-0.01em', gap: 0.24, stroke: 0, shadow: SHADOW_SOFT, word: 'tag', emphasis: true, accents: 2, maxWords: 6, maxChars: 32, entrance: 'none', exit: 'fade' }),
  'serif-accent': preset({ description: 'The sentence builds word by word; one key word per line turns serif italic in the brand colour.', colors: { accent: 'primary' }, font: 'body', weight: 750, size: 58, lineHeight: 1.14, case: 'as-is', letterSpacing: '-0.01em', gap: 0.24, stroke: 0, shadow: SHADOW_SOFT, word: 'serif', emphasis: true, accents: 1, maxWords: 6, maxChars: 32, entrance: 'none', exit: 'fade' })
});

export const CAPTION_PRESET_NAMES = Object.freeze(Object.keys(CAPTION_PRESETS));

const ROLE_FALLBACK = Object.freeze({ paper: '#ffffff', primary: '#ffd23f', accent: '#46d4ff', ink: '#0b0b0f', bg: '#000000' });
const HEX6 = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;

/** A brand role name ("primary") or a hex colour → a lowercase hex colour. */
export function captionColor(value, brandColors = {}, fallback = '#ffffff') {
  if (typeof value === 'string' && HEX6.test(value)) return value.toLowerCase();
  if (typeof value === 'string' && typeof brandColors?.[value] === 'string' && HEX6.test(brandColors[value])) return brandColors[value].toLowerCase();
  if (typeof value === 'string' && ROLE_FALLBACK[value]) return ROLE_FALLBACK[value];
  return fallback;
}

/** The captions overlay of a story (the first one that is not "none"), or null. */
export function captionsOverlayOf(story) {
  return (Array.isArray(story?.overlays) ? story.overlays : []).find((entry) => entry?.type === 'captions' && entry.style !== 'none' && entry.preset !== 'none') ?? null;
}

/**
 * The preset a captions overlay that names none gets: quiet-accent in a
 * footage-led story that names no style pack (a pack's own caption defaults
 * apply through applyStyle instead), word-highlight everywhere else.
 */
export function captionDefaultPreset(story) {
  const style = story?.style;
  const named = (typeof style === 'string' && style.trim()) || (style && typeof style === 'object' && typeof style.name === 'string' && style.name.trim());
  return story?.lane === 'footage-led' && !named ? 'quiet-accent' : 'word-highlight';
}

/** Preset name of a captions overlay: preset, else style (legacy names mapped), else the story's default (captionDefaultPreset). */
export function captionPresetName(overlay, story) {
  const fallback = captionDefaultPreset(story);
  const value = overlay?.preset ?? overlay?.style ?? fallback;
  if (Object.hasOwn(CAPTION_LEGACY_STYLES, value)) return CAPTION_LEGACY_STYLES[value];
  return Object.hasOwn(CAPTION_PRESETS, value) ? value : fallback;
}

/**
 * Caption times snapped to (k + offset) / fps, by default half-frame
 * boundaries. With motion blur (kit/core/motion-blur.mjs) each output frame
 * blends the sub-frames around it; offset is captionSnapOffset(plan), the
 * gap between two frames' one-frame windows (0.5 at 3 sub-frames per
 * frame), so a word change lands in neither blend: the picture smears, the
 * captions stay sharp and never show two words at once.
 */
export function snapCaptionChunks(chunks, fps, offset = 0.5) {
  const rate = Number(fps) || 30;
  const at = Number.isFinite(Number(offset)) ? Number(offset) : 0.5;
  // Rounded to the millisecond, well inside the gap (half a sub-frame: at
  // least 2 ms at 30 fps).
  const snap = (t) => (Number.isFinite(Number(t)) ? round((Math.round(Number(t) * rate - at) + at) / rate) : t);
  return chunks.map((chunk) => ({ ...chunk, start: snap(chunk.start), end: snap(chunk.end), ...(Array.isArray(chunk.words) ? { words: chunk.words.map((word) => ({ ...word, start: snap(word.start), end: snap(word.end) })) } : {}) }));
}

/**
 * The chunks as a story with motion.blur shows them, in either renderer:
 * snapped into the gap between two frames' one-frame windows. No blur, no
 * change. fps: the story's.
 */
export function blurSnappedChunks(chunks, story, fps) {
  const plan = resolveMotionBlur(story);
  return plan && Array.isArray(chunks) ? snapCaptionChunks(chunks, fps, captionSnapOffset(plan)) : chunks;
}

/**
 * The caption guard of a story with a shutter over one frame, or null: the
 * output frames whose heavy window straddles a word change, and the rect
 * (the caption band) they take from the one-frame blend (src/motion_blur.js).
 * chunks: the snapped chunks; captionsPlan: captionPlan() of them; format:
 * {width, height, fps}, fps the story's.
 */
export function captionBlurGuard(story, chunks, captionsPlan, format) {
  const plan = resolveMotionBlur(story);
  if (!plan?.overlap || !captionsPlan?.nodes?.length) return null;
  const changes = chunks.flatMap((chunk) => [chunk.start, chunk.end, ...(chunk.words ?? []).flatMap((word) => [word.start, word.end])]).map(Number);
  const frames = guardFrames(plan, changes, format.fps);
  return frames.length ? { frames, rect: guardRect(captionsPlan.options, format, /lc-cap-z\d/.test(captionsPlan.css)) } : null;
}

export function shownWords(words, preset) {
  if (preset?.punctuation !== false) return words;
  return words.map((word) => ({ ...word, text: String(word.text).replace(/^[\s"“‘(\[¡¿]+|[\s.,!?;:…"”’)\]]+$/gu, '') || String(word.text) }));
}

/** Band top (fraction of the canvas height) for a caption position. */
export function captionBandTop(format, position = 'auto') {
  const band = captionBandFor(format);
  const landscape = Number(format?.width) > Number(format?.height);
  if (position === 'top') return landscape ? 0.08 : 0.13;
  if (position === 'middle') return round(0.5 - band.height / 2);
  if (position === 'low') return round(CAPTION_LOW_CENTRE - band.height / 2);
  return band.top;
}

const normToken = (text) => String(text ?? '').toLowerCase().replace(/#\d+$/, '').replace(/[^\p{L}\p{N}-]+/gu, '');

/**
 * Emphasis words for a captions overlay: overlay.emphasis as a list, or
 * "auto" (default): words named by impact-style scene hits (word anchors) and
 * overlay.keywords. Words with digits always count.
 */
export function captionEmphasis(story, overlay = captionsOverlayOf(story)) {
  const out = new Set();
  if (Array.isArray(overlay?.emphasis)) { for (const word of overlay.emphasis) out.add(normToken(word)); return out; }
  if (overlay?.emphasis === 'none' || overlay?.emphasis === false) return out;
  for (const word of Array.isArray(overlay?.keywords) ? overlay.keywords : []) out.add(normToken(word));
  for (const scene of Array.isArray(story?.scenes) ? story.scenes : []) {
    for (const hit of Array.isArray(scene?.hits) ? scene.hits : []) {
      const anchor = typeof hit?.at === 'string' ? /^word:([^#\s+]+)/.exec(hit.at) : null;
      if (!anchor) continue;
      const strong = /impact|subdrop|riser|whoosh/.test(String(hit.cue ?? '')) || /emphasis|lockup|hit|reveal|stamp|headline/.test(String(hit.event ?? ''));
      if (strong) out.add(normToken(anchor[1]));
    }
  }
  return out;
}

const isEmphasis = (set, text) => set.has(normToken(text)) || /\d/.test(text);

/**
 * Indexes of a chunk's accent words for a preset with an accent limit: its
 * emphasis words in order, else its longest word of six letters or more,
 * at most `limit` of them.
 */
function accentWords(words, emphasis, limit) {
  const marked = words.map((word, i) => (isEmphasis(emphasis, word.text) ? i : -1)).filter((i) => i >= 0);
  if (marked.length) return new Set(marked.slice(0, limit));
  let best = -1, length = 5;
  words.forEach((word, i) => { const n = normToken(word.text).length; if (n > length) { best = i; length = n; } });
  return new Set(best >= 0 ? [best] : []);
}

// Connecting words a kinetic-hierarchy line sets small, and fillers.
const CONTEXT_WORDS = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'for', 'from', 'had', 'has', 'have', 'he', 'her', 'here', 'him', 'his', 'i', 'if', 'in', 'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or', 'our', 'she', 'so', 'that', 'the', 'their', 'them', 'then', 'there', 'they', 'this', 'to', 'up', 'us', 'was', 'we', "we're", "we've", "we'll", 'were', 'what', "what's", 'when', 'where', 'which', 'who', 'will', "won't", 'with', 'you', "you'll", "you're", 'your', 'ah', 'er', 'hmm', 'like', 'mm', 'okay', 'right', 'uh', 'um', 'well', 'yeah']);
export const CAPTION_HERO_SCALE = 1.85;
export const CAPTION_CONTEXT_SCALE = 0.72;

/**
 * The visual hierarchy of a kinetic-hierarchy line: each word's role
 * (context: a connecting word; body; hero: the one word that matters most)
 * and its size (em). The hero is an emphasis word if the line has one, else
 * the content word with digits, then the longest; a long hero shrinks toward
 * 1 em so it still fits the band (about 16 characters at the base size).
 * Lexical and deterministic. → [{role, scale}]
 */
export function captionHierarchy(words, emphasis = new Set()) {
  const norm = words.map((word) => String(word.text ?? '').toLowerCase().replace(/[‘’]/g, "'").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}']+$/gu, ''));
  const roles = norm.map((word) => ({ role: CONTEXT_WORDS.has(word) ? 'context' : 'body', scale: CONTEXT_WORDS.has(word) ? CAPTION_CONTEXT_SCALE : 1 }));
  const score = (word, i) => {
    if (!word || CONTEXT_WORDS.has(word)) return -1;
    return (isEmphasis(emphasis, word) && !/\d/.test(word) ? 1000 : 0) + (/\d/.test(word) ? 400 : 0) + (word.length >= 3 ? 60 : 0) + (word.length >= 7 ? 100 + word.length : word.length) - i * 1e-3;
  };
  let hero = -1, best = -1;
  norm.forEach((word, i) => { const value = score(word, i); if (value > best) { best = value; hero = i; } });
  if (hero >= 0) roles[hero] = { role: 'hero', scale: Math.round(Math.min(CAPTION_HERO_SCALE, Math.max(1, 16 / Math.max(1, [...norm[hero]].length))) * 20) / 20 };
  return roles;
}

// A tag chip is a solid block behind the key phrase: ink on a light brand
// background, paper on a dark one, so it stands out from what is behind the
// line; its text takes the other. An overlay's own box colour wins.
function tagChipColors(p, own, role, brandColors) {
  if (p.word !== 'tag' || own.box !== undefined) return { box: role('box'), boxText: role('boxText') };
  const ink = captionColor('ink', brandColors, '#0b0b0f'), paper = captionColor('paper', brandColors, '#ffffff'), bg = captionColor('bg', brandColors, '#000000');
  const box = captionContrast(ink, bg) >= captionContrast(paper, bg) ? ink : paper;
  return { box, boxText: own.boxText !== undefined ? role('boxText') : box === ink ? paper : ink };
}

/**
 * A character story's captions overlay with the character-story treatment
 * (character-story.mjs CHARACTER_CAPTIONS) under its own options, when it
 * names no preset or style of its own; any other overlay unchanged.
 */
export function characterCaptions(overlay, story) {
  if (!isCharacterStory(story) || overlay?.preset !== undefined || overlay?.style !== undefined) return overlay ?? {};
  return { ...CHARACTER_CAPTIONS, ...(overlay ?? {}), colors: { ...CHARACTER_CAPTIONS.colors, ...(overlay?.colors ?? {}) } };
}

/** Resolved options of a captions overlay: preset defaults overridden by the overlay's options. */
export function captionOptions(given = {}, { brand, format, fonts, story } = {}) {
  const overlay = characterCaptions(given, story);
  const name = captionPresetName(overlay, story) ?? 'word-highlight';
  const p = CAPTION_PRESETS[name];
  const brandColors = brand?.colors ?? {};
  const own = overlay?.colors && typeof overlay.colors === 'object' ? overlay.colors : {};
  const role = (key) => captionColor(own[key] ?? p.colors[key] ?? PRESET_COLORS[key], brandColors, captionColor(PRESET_COLORS[key] ?? 'paper', brandColors));
  const idle = role('idle');
  const fontRole = CAPTION_FONT_ROLES.includes(overlay?.font) ? overlay.font : p.font;
  const stacks = { ...brandFontStacks(brand), ...(fonts ?? {}) };
  const scale = Number(overlay?.size) > 0 ? Number(overlay.size) : 1;
  const stroke = overlay?.stroke === false ? 0 : Number.isFinite(Number(overlay?.stroke)) && overlay?.stroke !== null && overlay?.stroke !== true ? Math.max(0, Number(overlay.stroke)) : p.stroke;
  const shadow = overlay?.shadow === false ? 'none' : typeof overlay?.shadow === 'string' ? overlay.shadow : p.shadow;
  const position = CAPTION_POSITIONS.includes(overlay?.position) ? overlay.position : 'auto';
  const emphasis = overlay?.emphasis === false || overlay?.emphasis === 'none' ? false : p.emphasis || Array.isArray(overlay?.emphasis);
  // Highlight colours are text over footage: one that would not read there
  // is replaced (captionHighlightColor) and the change noted in colorFixes.
  const spoken = own.spoken ? captionColor(own.spoken, brandColors, idle) : p.colors.spoken ? role('spoken') : idle;
  const under = p.plate ? role('plate') : p.layout === 'band' ? role('band') : CAPTION_SHADOW_BACKDROP;
  const drawn = { active: CAPTION_ACTIVE_TEXT_WORDS.includes(p.word), spoken: true, accent: emphasis };
  const colorFixes = [];
  const highlight = (key, hex) => {
    if (!drawn[key]) return hex;
    const fixed = captionHighlightColor(hex, { key, idle, under, brandColors });
    if (fixed.color !== hex) colorFixes.push({ key, from: hex, to: fixed.color, via: fixed.via, explicit: typeof own[key] === 'string' && HEX6.test(own[key]) });
    return fixed.color;
  };
  return {
    preset: name,
    position,
    maxWords: Number.isInteger(overlay?.max_words) && overlay.max_words > 0 ? overlay.max_words : p.maxWords,
    maxChars: Number.isInteger(overlay?.max_chars) && overlay.max_chars > 0 ? overlay.max_chars : p.maxChars,
    case: CAPTION_CASES.includes(overlay?.case) ? overlay.case : p.case,
    font: stacks[fontRole] ?? stacks.display,
    serif: stacks.serif,
    fontRole,
    weight: Number.isInteger(overlay?.weight) && overlay.weight >= 100 && overlay.weight <= 950 ? overlay.weight : p.weight,
    size: Math.round(p.size * scale * 100) / 100,
    lineHeight: p.lineHeight,
    letterSpacing: Number.isFinite(overlay?.letter_spacing) && overlay.letter_spacing >= -0.1 && overlay.letter_spacing <= 0.5 ? `${overlay.letter_spacing}em` : p.letterSpacing,
    gap: p.gap,
    stroke,
    strokeColor: p.strokeColor,
    shadow,
    layout: p.layout,
    word: p.word,
    plate: p.plate,
    punctuation: p.punctuation ?? true,
    // How a line that does not read on what is behind it is helped: a solid
    // box (the default) or a soft scrim that keeps a box-less look (the default over a recording).
    plateStyle: CAPTION_PLATE_STYLES.includes(overlay?.plate_style) ? overlay.plate_style : p.plateStyle ?? (story?.lane === 'footage-led' ? 'scrim' : 'box'),
    emphasis,
    accents: p.accents ?? null,
    entrance: Object.hasOwn(CAPTION_ENTRANCES, overlay?.entrance) ? overlay.entrance : p.entrance,
    exit: Object.hasOwn(CAPTION_EXITS, overlay?.exit) ? overlay.exit : p.exit,
    // false: the type carries its own contrast (an outline), so a world plate's tone does not recolour it.
    worldTone: overlay?.world_tone !== false,
    // true: a phrase's last word is kept with its phrase when the lines are chunked (keepPhraseEnds).
    keepPhrase: overlay?.keep_phrase === true,
    offset: Number.isFinite(Number(overlay?.offset)) ? Math.max(-0.5, Math.min(0.5, Number(overlay.offset))) : 0,
    colors: {
      idle,
      active: highlight('active', role('active')),
      spoken: spoken === idle ? idle : highlight('spoken', spoken),
      accent: highlight('accent', role('accent')),
      ...tagChipColors(p, own, role, brandColors),
      plate: role('plate'),
      band: role('band'),
      bandEdge: role('bandEdge'),
      chip: role('chip')
    },
    band: captionBandFor(format),
    bandTop: captionBandTop(format, position),
    // Legibility (docs/DIRECTION_GUARDRAILS.md §3): lines named in
    // overlay.plates get a backing plate in the colour that holds the preset's
    // own text best. finish fills it from what is behind each line; a style
    // sets the look but never switches it off.
    plates: captionPlateIds(overlay?.plates),
    legiblePlate: captionLegiblePlate(idle, brandColors),
    colorFixes
  };
}

/**
 * The height (px) one caption line can take on a format: the preset's lines
 * at its size (a stack's words one per line, the larger hero or active word,
 * a line that wraps in the band), with room for a plate's padding and the
 * entrance's scale. The layout check grows the caption band to it, so a tall
 * line never reaches a card the band alone would miss.
 */
export function captionLineExtent(o, format) {
  const W = Number(format?.width) || 1080;
  const width = (1 - o.band.left - o.band.right) * W;
  const em = o.size;
  if (o.layout === 'stack') return round(em * o.lineHeight * (o.maxWords - 1 + 1.42) + em * 0.9);
  const big = o.word === 'hierarchy' ? CAPTION_HERO_SCALE : o.word === 'highlight-big' || o.word === 'pop' ? 1.12 : 1;
  const lines = Math.max(1, Math.ceil((o.maxChars * 0.55 * em * (o.word === 'hierarchy' ? 1.3 : 1)) / width));
  return round(em * o.lineHeight * (big + lines - 1) + em * 0.9);
}

/** overlay.plates → a Set of caption line ids, or "all". */
export function captionPlateIds(value) {
  if (value === 'all') return 'all';
  return new Set(Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []);
}

/**
 * The backing plate for a caption line that would not read on what is behind
 * it, against the text (the preset's own idle colour, which the plate never
 * changes): the first brand colour (ink, background, paper) that reaches
 * 7:1, so the plate stays in the style's palette; else whichever of those,
 * near-black or white contrasts most. → hex
 */
export function captionLegiblePlate(idle, brandColors = {}) {
  const hex = (value) => /^#[0-9a-f]{6}$/i.test(value ?? '');
  const brand = [brandColors.ink, brandColors.bg, brandColors.paper].filter(hex);
  const strong = brand.find((color) => captionContrast(idle, color) >= 7);
  if (strong) return strong;
  const options = [...brand, '#0b0d12', '#ffffff'];
  return options.reduce((best, color) => (captionContrast(idle, color) > captionContrast(idle, best) + 1e-9 ? color : best), options[0]);
}

/** Is this caption line plated (the preset's plate, or a legibility plate)? */
export const captionLinePlated = (o, id) => Boolean(o.plate) || o.plates === 'all' || Boolean(o.plates?.has?.(id));

/** Re-chunk words for a preset whose chunk size differs from the default chunking. */
export function chunksForCaptions(chunks, options) {
  if (options.maxWords === 3 && options.maxChars === 18 && !options.keepPhrase) return chunks;
  return chunkWords(chunks.flatMap((chunk) => chunk.words), { maxWords: options.maxWords, maxChars: options.maxChars, keepPhrase: Boolean(options.keepPhrase) });
}

const r4 = (value) => Math.round(value * 10000) / 10000;

/**
 * The zone a span of speech is mostly spoken in: the index into zones
 * ([{start, end, rect}]) that covers at least half of [start, end], or -1.
 */
export function captionZoneIndex(zones = [], start, end) {
  const span = Math.max(end - start, 1e-3);
  let best = -1, most = 0;
  zones.forEach((zone, index) => {
    const overlap = Math.min(end, zone.end) - Math.max(start, zone.start);
    if (overlap > most) { best = index; most = overlap; }
  });
  return best >= 0 && most >= span / 2 - 1e-6 ? best : -1;
}

// --- captions over worlds ------------------------------------------------------
// A preset's colours suit the brand background. Over a world plate (a track-0
// `world` scene) the band sits on the world instead, so a line spoken over a
// world whose tone its text cannot hold switches to a contrasting colour set:
// the first brand colour (paper, ink, bg) that reads on the world's tone,
// else white or near-black, and the accent pulled toward it until it reads. The tone is the world's light at its time of day, as it lies under
// the band (night skies and rooms are deep, dusk is mid, day is light).

export const CAPTION_WORLD_TONES = Object.freeze({ night: '#111a33', dusk: '#8d6a74', day: '#c9d6de' });
// Captions are large text: 3:1 is the floor (WCAG large text).
export const CAPTION_TONE_CONTRAST = 3;
// The halo behind a line over a world: light behind dark text, dark behind light text.
export const CAPTION_HALO = Object.freeze({ light: '0 0 6px rgba(255,255,255,.85), 0 0 18px rgba(255,255,255,.6)', dark: '0 0 6px rgba(0,0,0,.75), 0 0 18px rgba(0,0,0,.55)' });

const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const lum = (hex) => { const [r, g, b] = hexRgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const isHex = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
/** Contrast ratio of two #rrggbb colours (1–21). */
export function captionContrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
const mixHex = (a, b, t) => `#${hexRgb(a).map((c, i) => Math.round((c * (1 - t) + hexRgb(b)[i] * t) * 255).toString(16).padStart(2, '0')).join('')}`;

// --- highlight colours over footage --------------------------------------------
// The active, spoken and accent colours are text over footage, held up only
// by the caption's own dark stroke or shadow (or its plate or band). A brand
// colour that reads on a card can vanish there (a dark green over foliage),
// so each must hold CAPTION_HIGHLIGHT_CONTRAST against what is under it
// (CAPTION_FOOTAGE_CONTRAST against the shadow, which footage shows through)
// and stay CAPTION_HIGHLIGHT_DISTANCE (RGB) from the idle colour (or be the
// idle colour itself: no highlight), or it is
// replaced: the brand colour that contrasts most, else the colour lightened
// (or darkened) toward a tint that reads, else the default highlight.

export const CAPTION_HIGHLIGHT_CONTRAST = 3;
export const CAPTION_FOOTAGE_CONTRAST = 4.5;
export const CAPTION_HIGHLIGHT_DISTANCE = 60;
// A dark stroke or shadow over mid-tone footage (60% black over mid grey).
export const CAPTION_SHADOW_BACKDROP = '#333333';
// Word styles that draw the active colour as text (or a bar beside it).
export const CAPTION_ACTIVE_TEXT_WORDS = Object.freeze(['highlight', 'highlight-big', 'fill', 'bounce', 'glow', 'underline']);
const HIGHLIGHT_DEFAULTS = Object.freeze({ active: '#ffd23f', spoken: '#ffd23f', accent: '#46d4ff' });
const HIGHLIGHT_ROLES = ['primary', 'accent', 'paper', 'ink', 'bg'];
const rgbDistance = (a, b) => Math.hypot(...hexRgb(a).map((c, i) => (c - hexRgb(b)[i]) * 255));

/**
 * A highlight colour that reads as caption text over footage.
 * ctx: {key (active | spoken | accent), idle, under (the colour behind the
 * text), brandColors}. → {color, via: "kept" | "brand" | "tint" | "default"}
 */
export function captionHighlightColor(hex, { key = 'active', idle = '#ffffff', under = CAPTION_SHADOW_BACKDROP, brandColors = {} } = {}) {
  const six = (value) => (typeof value === 'string' && HEX6.test(value) ? value.slice(0, 7).toLowerCase() : null);
  const base = six(idle) ?? '#ffffff', back = six(under) ?? CAPTION_SHADOW_BACKDROP;
  const floor = back === CAPTION_SHADOW_BACKDROP ? CAPTION_FOOTAGE_CONTRAST : CAPTION_HIGHLIGHT_CONTRAST;
  const reads = (color) => captionContrast(color, back) >= floor && rgbDistance(color, base) >= CAPTION_HIGHLIGHT_DISTANCE;
  const own = six(hex);
  // The idle colour itself is a choice of no highlight, not a clash.
  if (!own || reads(own) || (own === base && captionContrast(own, back) >= floor)) return { color: hex, via: 'kept' };
  const brand = [...new Set(HIGHLIGHT_ROLES.map((role) => six(brandColors[role])).filter(Boolean))].filter(reads);
  if (brand.length) return { color: brand.reduce((best, color) => (captionContrast(color, back) > captionContrast(best, back) + 1e-9 ? color : best)), via: 'brand' };
  const toward = captionContrast('#ffffff', back) >= captionContrast('#000000', back) ? '#ffffff' : '#000000';
  for (let t = 0.15; t < 0.9; t += 0.15) {
    const tint = mixHex(own, toward, t);
    if (reads(tint)) return { color: tint, via: 'tint' };
  }
  return { color: HIGHLIGHT_DEFAULTS[key] ?? HIGHLIGHT_DEFAULTS.active, via: 'default' };
}

/** Report lines for the caption colours a host set explicitly that were changed to read over footage. */
export function captionColorWarnings(story) {
  const overlay = captionsOverlayOf(story);
  if (!overlay) return [];
  const { colorFixes } = captionOptions(overlay, { brand: story?.brand, format: story?.format, story });
  return colorFixes.filter((fix) => fix.explicit).map((fix) => `captions.colors.${fix.key} ${fix.from} does not read over footage (too little contrast against the caption's shadow, plate or band, or too close to the idle colour); using ${fix.to}`);
}

/** Track-0 world scenes of a (resolved) story as [{start, end, tone}] (tone: night | dusk | day). */
export function captionWorldSpans(story) {
  const base = story?.world && typeof story.world === 'object' ? story.world : {};
  return (Array.isArray(story?.scenes) ? story.scenes : [])
    .filter((scene) => scene?.module === 'world' && (scene.track ?? 0) === 0 && Number.isFinite(Number(scene.start)) && Number.isFinite(Number(scene.end)))
    .map((scene) => ({ start: Number(scene.start), end: Number(scene.end), tone: scene.params?.time ?? base.time ?? 'day' }))
    .filter((span) => Object.hasOwn(CAPTION_WORLD_TONES, span.tone));
}

/**
 * The colours a caption line uses over a world tone: the preset's own when
 * its text holds CAPTION_TONE_CONTRAST on the tone, else a contrasting set.
 * → {idle, accent, spoken, swapped}
 */
export function captionToneColors(colors, tone, brandColors = {}) {
  const under = CAPTION_WORLD_TONES[tone];
  if (!under || !isHex(colors.idle) || captionContrast(colors.idle, under) >= CAPTION_TONE_CONTRAST) return { ...colors, swapped: false };
  // A brand colour that reads (4.5:1) first, else whichever stands furthest from the tone.
  const brand = [brandColors.paper, brandColors.ink, brandColors.bg].filter(isHex);
  const idle = brand.find((hex) => captionContrast(hex, under) >= 4.5)
    ?? [...brand, '#ffffff', '#0b0b0f'].reduce((best, hex) => (captionContrast(hex, under) > captionContrast(best, under) ? hex : best));
  let accent = isHex(colors.accent) ? colors.accent : idle;
  for (let t = 0.15; captionContrast(accent, under) < CAPTION_TONE_CONTRAST && t <= 1.0001; t += 0.15) accent = mixHex(colors.accent, idle, Math.min(1, t));
  const spoken = colors.spoken === colors.idle ? idle : colors.spoken;
  return { ...colors, idle, accent, spoken, swapped: true };
}

/**
 * The caption plan for chunks under a captions overlay.
 * ctx: {brand, format, story (auto emphasis), hide: [[from, to]], zones}.
 * zones: caption zones ([{start, end, rect, scale?}] px: a footage layout's,
 * a cast's or the overlay's own, kit/core/cast-captions.mjs
 * storyCaptionZones): a line mostly spoken inside one is placed and wrapped
 * within its rect instead of the band, at the zone's scale of its size.
 * → {preset, options, css, nodes, tweens}
 */
export function captionPlan(chunks, overlay = {}, ctx = {}) {
  const o = captionOptions(overlay, ctx);
  const zones = Array.isArray(ctx.zones) ? ctx.zones.filter((zone) => zone?.rect) : [];
  const zoneOf = (start, end) => captionZoneIndex(zones, start, end);
  const used = new Set();
  const zoneCls = (index) => { if (index < 0) return ''; used.add(index); return ` lc-cap-z${index + 1}`; };
  const emphasis = o.emphasis ? captionEmphasis(ctx.story, overlay) : new Set();
  // Chunks from an older captions.json may still hold split tokens.
  const own = chunksForCaptions(chunks, o);
  const list = visibleChunks(own, [...(ctx.hide ?? []), ...captionEchoHide(ctx.story, own)]).map((chunk) => ({ ...chunk, words: joinAttachedWords(chunk.words) }));
  const spoken = (chunk) => [chunk.start, Math.max(chunk.start, chunk.words.at(-1)?.end ?? chunk.end)];
  const nodes = [];
  const tweens = [];
  const tw = (id, at, dur, ease, to, from, ir) => tweens.push({ id, at: r4(Math.max(0, at)), dur, ease, to, ...(from ? { from } : {}), ...(from && ir ? { ir: true } : {}) });
  const C = o.colors;
  // Lines over a world plate whose tone the preset's text cannot hold get a contrasting set.
  const worlds = captionWorldSpans(ctx.story);
  const toneOf = (start, end) => { const span = Math.max(end - start, 1e-3); const hit = worlds.find((w) => Math.min(end, w.end) - Math.max(start, w.start) >= span / 2 - 1e-6); return hit?.tone ?? null; };
  o.tones = {};
  const entrance = CAPTION_ENTRANCES[o.entrance];
  const exit = CAPTION_EXITS[o.exit];

  // lower-band: one band per run of chunks with gaps under 0.35 s.
  if (o.layout === 'band') {
    const segments = [];
    for (const chunk of list) {
      const last = segments.at(-1);
      const zone = zoneOf(...spoken(chunk));
      if (last && chunk.start - last.end < 0.35 && last.zone === zone) { last.end = Math.max(last.end, chunk.end); continue; }
      segments.push({ start: chunk.start, end: chunk.end, zone });
    }
    segments.forEach((segment, index) => {
      const id = `capband-${String(index + 1).padStart(3, '0')}`;
      nodes.push({ tag: 'div', id, cls: `lc-cap-band${zoneCls(segment.zone)}` });
      tw(id, segment.start - 0.06, 0.3, 'power3.out', { scaleX: 1, opacity: 1 }, { scaleX: 0, opacity: 1 }, false);
      tw(id, Math.max(segment.start + 0.26, segment.end - 0.16), 0.16, 'power1.in', { opacity: 0 });
    });
  }

  const heroScales = new Set();
  const heroWords = o.word === 'hierarchy' ? (o.emphasis ? emphasis : captionEmphasis(ctx.story, overlay)) : null;
  for (const chunk of list) {
    const accented = o.accents ? accentWords(chunk.words, emphasis, o.accents) : null;
    const roles = heroWords ? captionHierarchy(chunk.words, heroWords) : null;
    // A legibility plate holds the preset's own colours, so it takes no world tone.
    const legible = !o.plate && captionLinePlated(o, chunk.id);
    const tone = o.plate || legible || !o.worldTone ? null : toneOf(...spoken(chunk));
    const toned = tone ? captionToneColors(o.colors, tone, ctx.brand?.colors) : null;
    if (toned) o.tones[tone] = { idle: toned.idle, accent: toned.accent, swapped: toned.swapped };
    if (legible) o.legible = true;
    const toneCls = toned ? ` lc-cap-on-${tone}` : '';
    const line = { tag: 'div', id: chunk.id, cls: `${o.plate ? 'lc-cap lc-cap-plate' : legible ? 'lc-cap lc-cap-legible' : 'lc-cap'}${zoneCls(zoneOf(...spoken(chunk)))}${toneCls}`, children: [] };
    nodes.push(line);
    const C = toned?.swapped ? { ...o.colors, idle: toned.idle, accent: toned.accent, spoken: toned.spoken } : o.colors;
    const inTo = Object.fromEntries(Object.keys(entrance.from).map((key) => [key, key === 'opacity' || key === 'scale' ? 1 : 0]));
    // One word at a time: the line leaves when the next arrives, and its
    // entrance ends before that exit starts. On a seeked GSAP timeline an
    // entrance still running would draw the word back over its own exit.
    const nextStart = o.layout === 'single' ? list[list.indexOf(chunk) + 1]?.start : undefined;
    const room = Number.isFinite(nextStart) ? Math.max(0.01, nextStart - chunk.start) : Infinity;
    const exitDur = Math.min(exit.dur, room / 2);
    const exitAt = Math.max(chunk.start + 0.12, chunk.end - exitDur);
    const leaveAt = Number.isFinite(nextStart) ? Math.max(chunk.start, Math.min(exitAt, nextStart - exitDur)) : exitAt;
    const enterDur = Number.isFinite(nextStart) ? Math.max(0.005, Math.min(entrance.dur, leaveAt - chunk.start - 0.002)) : entrance.dur;
    tw(chunk.id, chunk.start, enterDur, entrance.ease, inTo, { ...entrance.from }, true);
    shownWords(chunk.words, o).forEach((word, i) => {
      const id = `${chunk.id}-w${i}`;
      const em = o.emphasis && (accented ? accented.has(i) : isEmphasis(emphasis, word.text));
      const start = word.start + o.offset, end = word.end + o.offset;
      const onAt = Math.max(0, start - 0.03);
      const offAt = Math.max(end, start + 0.08);
      const idle = em ? C.accent : C.idle;
      const span = { tag: 'span', id, cls: em ? 'lc-cap-w lc-cap-em' : 'lc-cap-w' };
      const kids = [];
      line.children.push(span);
      switch (o.word) {
        case 'highlight':
        case 'highlight-big': {
          span.text = word.text;
          tw(id, onAt, 0.06, 'power2.out', { color: C.active, scale: o.word === 'highlight-big' ? 1.12 : 1.08 }, { color: idle, scale: 1 }, false);
          tw(id, offAt, 0.12, 'power1.out', { color: em ? C.accent : C.spoken, scale: 1 });
          break;
        }
        case 'fill': {
          span.text = word.text;
          kids.push({ tag: 'span', id: `${id}-f`, cls: 'lc-cap-fill', text: word.text });
          tw(`${id}-f`, start, Math.max(0.08, r4(end - start)), 'none', { width: 100 }, { width: 0 }, false);
          break;
        }
        case 'pop': {
          span.text = word.text;
          tw(id, onAt, 0.16, 'back.out(2.6)', { opacity: 1, scale: 1 }, { opacity: 0, scale: 0.55 }, false);
          const next = chunk.words[i + 1];
          if (next) tw(id, Math.max(next.start + o.offset - 0.03, onAt + 0.16), 0.04, 'none', { opacity: 0 });
          break;
        }
        case 'bounce': {
          kids.push({ tag: 'span', id: `${id}-t`, cls: 'lc-cap-t', text: word.text });
          tw(id, onAt, 0.1, 'power2.out', { y: -28 }, { y: 0 }, false);
          tw(id, onAt + 0.1, 0.32, 'bounce.out', { y: 0 });
          tw(`${id}-t`, onAt, 0.06, 'power2.out', { color: C.active }, { color: idle }, false);
          tw(`${id}-t`, offAt, 0.12, 'power1.out', { color: idle });
          break;
        }
        case 'type': {
          const chars = [...word.text];
          const step = Math.min(0.05, Math.max(0.012, (end - start) / Math.max(1, chars.length)));
          chars.forEach((char, k) => {
            const cid = `${id}-c${k}`;
            kids.push({ tag: 'span', id: cid, cls: 'lc-cap-ch', text: char });
            tw(cid, start + k * step, 0.02, 'none', { opacity: 1 }, { opacity: 0 }, false);
          });
          break;
        }
        case 'box': {
          kids.push({ tag: 'span', id: `${id}-b`, cls: 'lc-cap-box' }, { tag: 'span', id: `${id}-t`, cls: 'lc-cap-t', text: word.text });
          tw(`${id}-b`, onAt, 0.1, 'back.out(2)', { opacity: 1, scale: 1 }, { opacity: 0, scale: 0.8 }, false);
          tw(`${id}-b`, offAt, 0.12, 'power1.out', { opacity: 0 });
          tw(`${id}-t`, onAt, 0.06, 'power2.out', { color: C.boxText }, { color: idle }, false);
          tw(`${id}-t`, offAt, 0.12, 'power1.out', { color: idle });
          break;
        }
        case 'underline': {
          span.text = word.text;
          kids.push({ tag: 'span', id: `${id}-u`, cls: 'lc-cap-ul' });
          tw(`${id}-u`, start, Math.max(0.12, r4(end - start)), 'power1.inOut', { scaleX: 1 }, { scaleX: 0 }, false);
          break;
        }
        case 'hierarchy': {
          span.text = word.text;
          const role = roles[i];
          if (role.role === 'context') span.cls += ' lc-cap-ctx';
          if (role.role === 'hero') { span.cls += ` lc-cap-hero lc-cap-h${Math.round(role.scale * 100)}`; heroScales.add(role.scale); }
          // Each word arrives as it is spoken and stays until the line goes.
          tw(id, start, 0.1, 'power2.out', { opacity: 1, y: 0, scale: 1 }, { opacity: 0, y: r4(0.16 * o.size * role.scale), scale: 0.92 }, false);
          break;
        }
        case 'stack': {
          span.text = word.text;
          tw(id, onAt, 0.2, 'power3.out', { opacity: 1, y: 0, scale: 1 }, { opacity: 0, y: 36, scale: 0.9 }, false);
          break;
        }
        case 'glow': {
          kids.push({ tag: 'span', id: `${id}-g`, cls: 'lc-cap-glow', text: word.text }, { tag: 'span', id: `${id}-t`, cls: 'lc-cap-t', text: word.text });
          tw(`${id}-g`, onAt, 0.08, 'power2.out', { opacity: 1 }, { opacity: 0 }, false);
          tw(`${id}-g`, offAt, 0.2, 'power1.out', { opacity: 0.3 });
          tw(`${id}-t`, onAt, 0.06, 'power2.out', { color: C.active }, { color: idle }, false);
          tw(`${id}-t`, offAt, 0.2, 'power1.out', { color: idle });
          break;
        }
        case 'emphasis': {
          span.text = word.text;
          if (em) {
            tw(id, onAt, 0.08, 'power2.out', { scale: 1.16 }, { scale: 1 }, false);
            tw(id, onAt + 0.08, 0.2, 'power2.out', { scale: 1 });
          }
          break;
        }
        case 'tag': {
          // Each word arrives as it is spoken and stays; a key phrase's chip wipes in under it.
          kids.push(...(em ? [{ tag: 'span', id: `${id}-b`, cls: 'lc-cap-tag-b' }] : []), { tag: 'span', id: `${id}-t`, cls: 'lc-cap-t', text: word.text });
          tw(id, start, 0.12, 'power2.out', { opacity: 1, y: 0 }, { opacity: 0, y: r4(0.18 * o.size) }, false);
          if (em) {
            tw(`${id}-b`, onAt, 0.16, 'power3.out', { scaleX: 1 }, { scaleX: 0 }, false);
            tw(`${id}-t`, onAt, 0.1, 'power2.out', { color: C.boxText }, { color: C.idle }, false);
          }
          break;
        }
        case 'serif': {
          span.text = word.text;
          if (em) span.cls += ' lc-cap-serif';
          tw(id, start, 0.12, 'power2.out', { opacity: 1, y: 0, scale: 1 }, { opacity: 0, y: r4(0.18 * o.size), scale: em ? 0.86 : 1 }, false);
          break;
        }
        case 'chip': {
          span.text = word.text;
          tw(id, onAt, 0.16, 'back.out(2.2)', { opacity: 1, scale: 1 }, { opacity: 0, scale: 0.6 }, false);
          tw(id, onAt, 0.06, 'power2.out', { backgroundColor: C.active }, { backgroundColor: C.chip }, false);
          tw(id, offAt, 0.12, 'power1.out', { backgroundColor: C.chip });
          break;
        }
        default:
          span.text = word.text;
      }
      if (kids.length) span.children = kids;
    });
    tw(chunk.id, leaveAt, exitDur, exit.ease, { ...exit.to });
  }
  o.heroScales = [...heroScales].sort((a, b) => a - b);
  const placed = [...used].sort((a, b) => a - b).map((index) => ({ index, rect: zones[index].rect, scale: zones[index].scale }));
  return { preset: o.preset, options: o, css: captionPlanCss(o, { zones: placed, format: ctx.format }), nodes, tweens };
}

// Caption zones narrower than this share of the canvas's short side set
// smaller type, down to CAPTION_ZONE_MIN_SCALE.
export const CAPTION_ZONE_WIDTH = 480 / 1080;
export const CAPTION_ZONE_MIN_SCALE = 0.7;

/**
 * CSS for caption zones: each zone's lines are centred in its rect and
 * wrap within it, bands span it. Percentages of the captions container (the
 * band at o.bandTop), so both renderers lay them out identically.
 */
function captionZoneCss(o, zones, format) {
  const W = Number(format?.width), H = Number(format?.height);
  if (!zones.length || !(W > 0 && H > 0)) return [];
  const b = o.band;
  const box = { x: b.left * W, y: o.bandTop * H, width: (1 - b.left - b.right) * W, height: b.height * H };
  const pct = (value) => `${round(value * 100)}%`;
  const out = [];
  for (const { index, rect, scale: own } of zones) {
    const l = (rect.x - box.x) / box.width, r = (box.x + box.width - rect.x - rect.width) / box.width;
    const t = (rect.y - box.y) / box.height, bt = (box.y + box.height - rect.y - rect.height) / box.height;
    const fw = rect.width / box.width, fh = rect.height / box.height;
    // A zone narrower than CAPTION_ZONE_WIDTH sets smaller type, so one long word still fits.
    // A zone may also set its own scale (a placed zone shorter than the band: cast-captions.mjs placedCaptionZones).
    const scale = Math.max(CAPTION_ZONE_MIN_SCALE, Math.min(1, rect.width / (CAPTION_ZONE_WIDTH * Math.min(W, H))) * (own > 0 && own < 1 ? own : 1));
    const size = scale < 1 ? ` font-size: ${round(o.size * scale)}px;` : '';
    out.push(`.lc-cap.lc-cap-z${index + 1} { left: ${pct(l)}; right: ${pct(r)}; top: ${pct(t)}; bottom: ${pct(bt)}; width: fit-content; height: fit-content; max-width: ${pct(fw)}; margin: auto;${size} }`);
    if (o.layout === 'band') out.push(`.lc-cap-band.lc-cap-z${index + 1} { left: ${pct(l - 0.02 * fw)}; right: ${pct(r - 0.02 * fw)}; top: ${pct(t + 0.04 * fh)}; bottom: ${pct(bt + 0.04 * fh)}; }`);
  }
  return out;
}

/** Static CSS for a caption plan's options and zones (identical text in both renderers). */
export function captionPlanCss(o, { zones = [], format } = {}) {
  const b = o.band;
  const pct = (value) => `${round(value * 100)}%`;
  const C = o.colors;
  const transform = o.case === 'upper' ? 'uppercase' : o.case === 'title' ? 'capitalize' : o.case === 'lower' ? 'lowercase' : 'none';
  const stroke = o.stroke > 0 ? ` paint-order: stroke fill; -webkit-text-stroke: ${o.stroke}px ${o.strokeColor};` : '';
  const shadow = o.shadow && o.shadow !== 'none' ? ` text-shadow: ${o.shadow};` : '';
  const lines = [
    `.lc-captions { position: absolute; left: ${pct(b.left)}; right: ${pct(b.right)}; top: ${pct(o.bandTop)}; height: ${pct(b.height)}; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: ${b.zIndex}; }`,
    `.lc-cap { position: absolute; display: flex; gap: ${o.gap}em; flex-wrap: wrap; justify-content: center; font: ${o.weight} ${o.size}px/${o.lineHeight} ${o.font}; letter-spacing: ${o.letterSpacing}; text-transform: ${transform}; opacity: 0; }`,
    `.lc-cap-w { display: inline-block; position: relative;${stroke}${shadow} transform-origin: 50% 70%; color: ${C.idle}; }`
  ];
  if (o.emphasis) lines.push(`.lc-cap-em { color: ${C.accent}; }`);
  // Lines over a world tone the preset's text cannot hold (captionToneColors).
  // Over any world a halo in the contrasting tone lifts the line off the
  // drawing behind it (presets with an outline keep their stroke).
  for (const [tone, colors] of Object.entries(o.tones ?? {})) {
    const halo = o.stroke > 0 ? '' : ` text-shadow: ${captionContrast(colors.idle, '#000000') < captionContrast(colors.idle, '#ffffff') ? CAPTION_HALO.light : CAPTION_HALO.dark};`;
    lines.push(`.lc-cap-on-${tone} .lc-cap-w { color: ${colors.idle};${halo} }`);
    if (o.emphasis) lines.push(`.lc-cap-on-${tone} .lc-cap-em { color: ${colors.accent}; }`);
  }
  if (o.plate === 'card') lines.push(`.lc-cap-plate { background: ${C.plate}; padding: 0.3em 0.55em 0.38em; border-radius: 0.3em; box-shadow: 0 12px 28px rgba(0,0,0,.28); }`);
  else if (o.plate) lines.push(`.lc-cap-plate { background: ${C.plate}d9; padding: 0.32em 0.6em; border-radius: 0.3em; }`);
  // A legibility plate: nearly opaque, so the line reads on anything behind
  // it; or, for a box-less preset, a scrim that fades out at its edges.
  if (o.legible && o.plateStyle === 'scrim') lines.push(`.lc-cap-legible { background: radial-gradient(closest-side, ${o.legiblePlate}d0, ${o.legiblePlate}a6 60%, ${o.legiblePlate}00); padding: 0.45em 1.1em; }`);
  else if (o.legible) lines.push(`.lc-cap-legible { background: ${o.legiblePlate}eb; padding: 0.18em 0.5em 0.22em; border-radius: 0.32em; }`, '.lc-cap-legible .lc-cap-w { text-shadow: none; }');
  switch (o.word) {
    case 'fill': lines.push(`.lc-cap-fill { position: absolute; left: 0; top: 0; width: 0%; overflow: hidden; white-space: nowrap; color: ${C.active}; }`); break;
    case 'pop': lines.push('.lc-cap { display: grid; place-items: center; }', '.lc-cap > .lc-cap-w { grid-area: 1 / 1; opacity: 0; transform-origin: 50% 50%; }'); break;
    case 'type': lines.push('.lc-cap-ch { opacity: 0; }'); break;
    case 'box': lines.push(`.lc-cap-box { position: absolute; left: -0.16em; right: -0.16em; top: -0.04em; bottom: -0.04em; background: ${C.box}; border-radius: 0.14em; opacity: 0; }`, '.lc-cap-t { position: relative; }'); break;
    case 'underline': lines.push(`.lc-cap-ul { position: absolute; left: 0; right: 0; bottom: -0.04em; height: 0.11em; background: ${C.active}; border-radius: 0.06em; transform-origin: 0% 50%; transform: scaleX(0); }`); break;
    case 'hierarchy': {
      // The hero glows: white light close in, then the active colour.
      const glow = captionContrast(C.idle, '#000000') >= captionContrast(C.idle, '#ffffff') ? '0 0 28px rgba(255,255,255,.94), ' : '';
      lines.push('.lc-cap { align-items: baseline; }', '.lc-cap-w { opacity: 0; transform-origin: 50% 75%; }', '.lc-cap-ctx { font-size: 0.72em; font-weight: 750; }',
        `.lc-cap-hero { margin: 0 0.04em; letter-spacing: -0.035em; -webkit-text-stroke-width: 0.5px; text-shadow: ${SHADOW_LIFT}, ${glow}0 0 48px ${C.active}99; }`);
      for (const scale of o.heroScales ?? []) lines.push(`.lc-cap-hero.lc-cap-h${Math.round(scale * 100)} { font-size: ${scale}em; }`);
      break;
    }
    case 'stack': lines.push('.lc-cap { flex-direction: column; flex-wrap: nowrap; align-items: center; }', '.lc-cap-w { opacity: 0; transform-origin: 50% 50%; }', '.lc-cap-em { font-size: 1.42em; }'); break;
    case 'glow': lines.push(`.lc-cap-glow { position: absolute; left: 0; top: 0; color: ${C.active}; filter: blur(14px); opacity: 0; }`, '.lc-cap-t { position: relative; }'); break;
    case 'chip': lines.push(`.lc-cap-w { background-color: ${C.chip}; padding: 0.06em 0.34em 0.1em; border-radius: 0.5em; box-shadow: 0 6px 18px rgba(0,0,0,.35); opacity: 0; transform-origin: 50% 50%; }`); break;
    case 'tag': lines.push('.lc-cap-w { opacity: 0; }', `.lc-cap-em { color: ${C.idle}; }`, '.lc-cap-t { position: relative; }',
      `.lc-cap-tag-b { position: absolute; left: -0.16em; right: -0.16em; top: 0.02em; bottom: -0.04em; background: ${C.box}; border-radius: 0.14em; box-shadow: 0 0.08em 0.3em rgba(0,0,0,.35); transform-origin: 0% 50%; transform: scaleX(0); }`); break;
    case 'serif': lines.push('.lc-cap { align-items: baseline; }', '.lc-cap-w { opacity: 0; transform-origin: 50% 80%; }',
      `.lc-cap-serif { font-family: ${o.serif ?? "'Instrument Serif', serif"}; font-style: italic; font-weight: 400; letter-spacing: 0; font-size: 1.14em; color: ${C.accent}; }`); break;
    default: break;
  }
  if (o.layout === 'band') lines.push(`.lc-cap-band { position: absolute; left: -2%; right: -2%; top: 4%; bottom: 4%; background: ${C.band}; border-left: ${round(o.size * 0.22)}px solid ${C.bandEdge}; border-radius: ${round(o.size * 0.12)}px; transform-origin: 0% 50%; transform: scaleX(0); }`);
  lines.push(...captionZoneCss(o, zones, format));
  return `${lines.join('\n')}\n`;
}

// --- captions during camera moves ---------------------------------------------
// captions.hide_during_moves: "auto" (default: dip out for camera moves that
// sweep panels vertically: vertical pans, dollies, orbits), true (every
// move) or false (never). The windows come from camera-world.mjs
// captionDipWindows; both renderers draw the same linear opacity dip on the
// captions container: HyperFrames as the tweens below, Remotion frame-purely.

export const CAPTION_DIP_RAMP = 0.12;
export const CAPTION_MOVE_HIDE = Object.freeze(['auto', true, false]);

/** captions.hide_during_moves of an overlay → "auto" | true | false. */
export function captionMoveHide(overlay) {
  const value = overlay?.hide_during_moves;
  return value === true || value === false ? value : 'auto';
}

// Windows closer than two ramps merge, so the dip tweens never overlap.
function mergeDips(windows) {
  const merged = [];
  for (const window of [...windows].sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && window.start - last.end < 2 * CAPTION_DIP_RAMP + 1e-6) last.end = Math.max(last.end, window.end);
    else merged.push({ start: window.start, end: window.end });
  }
  return merged;
}

const dipRamp = (window) => (window.end > window.start ? CAPTION_DIP_RAMP : 0);

/** Dip windows → GSAP tweens on the captions container: [{at, dur, from, to}] (linear opacity). */
export function captionDipTweens(windows = []) {
  const out = [];
  for (const window of mergeDips(windows)) {
    const ramp = r4(dipRamp(window));
    if (!(ramp > 0)) continue;
    // The ramps sit just outside the move, so the captions are fully out for
    // the whole move (the camera eases overshoot up to its last frame).
    out.push({ at: r4(Math.max(0, window.start - ramp)), dur: ramp, from: 1, to: 0 });
    out.push({ at: r4(window.end), dur: ramp, from: 0, to: 1 });
  }
  return out;
}

/** Captions container opacity at t for dip windows (the same values the tweens above play). */
export function captionDipOpacity(windows = [], t) {
  for (const tween of captionDipTweens(windows)) {
    if (t < tween.at) return tween.from === 1 ? 1 : 0;
    if (t < tween.at + tween.dur) return tween.from + (tween.to - tween.from) * ((t - tween.at) / tween.dur);
  }
  return 1;
}

/** Spans where the dip has captions under half opacity (the layout check treats them as hidden) → [[from, to]]. */
export function captionDipHidden(windows = []) {
  return mergeDips(windows).map((window) => { const ramp = dipRamp(window); return [r4(window.start - ramp / 2), r4(window.end + ramp / 2)]; }).filter(([a, b]) => b > a);
}

// --- frame-pure evaluation (Remotion) and GSAP mounting (HyperFrames) -------

const TRANSFORM_DEFAULTS = Object.freeze({ x: 0, y: 0, scale: 1, scaleX: 1 });

function lerpProp(from, to, p) {
  if (typeof from === 'number' && typeof to === 'number') return from + (to - from) * p;
  return interpolateColor(p, from, to);
}

/** Tweens grouped by element id, sorted by start time as GSAP renders them. */
export function indexCaptionTweens(tweens) {
  const byId = new Map();
  tweens.forEach((tween, order) => {
    if (!byId.has(tween.id)) byId.set(tween.id, []);
    byId.get(tween.id).push({ ...tween, order });
  });
  for (const list of byId.values()) list.sort((a, b) => a.at - b.at || a.order - b.order);
  return byId;
}

function propAt(list, prop, t) {
  const relevant = list.filter((tween) => Object.hasOwn(tween.to, prop));
  if (!relevant.length) return undefined;
  const valueAt = (time, upto) => {
    let value;
    const first = relevant[0];
    if (first.from && first.ir && Object.hasOwn(first.from, prop)) value = first.from[prop];
    for (let k = 0; k < upto; k += 1) {
      const tween = relevant[k];
      if (tween.at > time) break;
      const start = tween.from && Object.hasOwn(tween.from, prop) ? tween.from[prop] : valueAt(tween.at, k) ?? TRANSFORM_DEFAULTS[prop];
      if (start === undefined) continue;
      const progress = tween.dur <= 0 || time >= tween.at + tween.dur ? 1 : getEase(tween.ease)((time - tween.at) / tween.dur);
      value = lerpProp(start, tween.to[prop], progress);
    }
    return value;
  };
  return valueAt(t, relevant.length);
}

/**
 * Animated props of every element at time t (seconds), with GSAP's
 * forward-seek semantics: id → {opacity?, x?, y?, scale?, scaleX?, color?,
 * backgroundColor?, width?}. Elements no tween has touched yet are absent or {}.
 */
export function captionStateAt(plan, t, index = indexCaptionTweens(plan.tweens)) {
  const state = new Map();
  for (const id of index.keys()) state.set(id, captionElementStateAt(index, id, t));
  return state;
}

/** Animated props of one element at time t (see captionStateAt). */
export function captionElementStateAt(index, id, t) {
  const list = index.get(id);
  const values = {};
  if (!list) return values;
  for (const prop of new Set(list.flatMap((tween) => Object.keys(tween.to)))) {
    const value = propAt(list, prop, t);
    if (value !== undefined) values[prop] = value;
  }
  return values;
}

const r5 = (value) => Math.round(value * 100000) / 100000;

/** Animated props → inline CSS (camelCase keys), as GSAP writes them. */
export function captionInlineStyle(values = {}) {
  const style = {};
  if (values.opacity !== undefined) style.opacity = r5(values.opacity);
  if (values.color !== undefined) style.color = values.color;
  if (values.backgroundColor !== undefined) style.backgroundColor = values.backgroundColor;
  if (values.width !== undefined) style.width = `${r5(values.width)}%`;
  if (['x', 'y', 'scale', 'scaleX'].some((key) => values[key] !== undefined)) {
    const x = values.x ?? 0, y = values.y ?? 0;
    const sx = (values.scaleX ?? 1) * (values.scale ?? 1), sy = values.scale ?? 1;
    style.transform = `translate(${r5(x)}px, ${r5(y)}px) scale(${r5(sx)}, ${r5(sy)})`;
  }
  return style;
}

/** The HyperFrames runtime for a caption plan: mountCaptions(tl, container) builds the nodes and adds the tweens. */
export function captionPlanRuntime(plan) {
  return `// Generated by kit/core/captions.mjs (caption preset ${plan.preset}). Call
// mountCaptions(tl, container) while building the paused root timeline;
// everything is created synchronously, with no callbacks.
(function () {
  var NODES = ${JSON.stringify(plan.nodes)};
  var TWEENS = ${JSON.stringify(plan.tweens)};
  function build(node, parent) {
    var el = document.createElement(node.tag || 'div');
    if (node.id) el.id = node.id;
    if (node.cls) el.className = node.cls;
    if (node.text != null) el.appendChild(document.createTextNode(node.text));
    (node.children || []).forEach(function (child) { build(child, el); });
    parent.appendChild(el);
  }
  function vars(props) {
    var out = {};
    for (var key in props) out[key] = key === 'width' ? props[key] + '%' : props[key];
    return out;
  }
  window.mountCaptions = function (tl, container) {
    NODES.forEach(function (node) { build(node, container); });
    TWEENS.forEach(function (w) {
      var el = document.getElementById(w.id);
      if (!el) return;
      var to = vars(w.to);
      to.duration = w.dur; to.ease = w.ease; to.force3D = false;
      if (w.from) {
        if (!w.ir) to.immediateRender = false;
        tl.fromTo(el, vars(w.from), to, w.at);
      } else tl.to(el, to, w.at);
    });
  };
})();
`;
}

// storyboard.json (resolved) → a complete HyperFrames project.
//
//   const {html, files, warnings} = await compileStoryToHyperFrames(resolvedStory, {projectDir, sourceDir, sceneFilter});
//
// The output follows the standalone HyperFrames runtime contract
// (skills-src/references/standalone-hyperframes.md): one root with
// data-composition-id / data-duration / data-width / data-height, one paused
// GSAP timeline registered on window.__timelines, every module's emitter
// html/css/motion inside a scene layer, typed transitions between track-0
// scenes (kit/core/transitions.mjs, shared with the Remotion kit), the phase-2
// boundary attributes from deriveBoundaries, one root <audio> (audio.mix, or
// the voice), word captions (kit/core/captions.mjs), the loop ending and the
// brand fonts. Unknown modules render a labelled placeholder and a warning.
//
// Canonical copy: kit/hyperframes/story-compiler.mjs. Skills ship a copy whose
// ../core/ imports point at ./ (scripts/sync-skills.mjs).

import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { deriveBoundaries, validateStory } from './story.mjs';
import { knownModules, placeholderModel, PLACEHOLDER_STYLE, resolveModule } from './modules.mjs';
import { gsapVars, sceneWindows } from './transitions.mjs';
import { captionCss, CAPTION_DEFAULT_COLORS, captionChunksFrom, captionRuntime, chunkWords, narrationWords } from './captions.mjs';
import { brandFontStacks, fontSlug, googleFontModuleName } from './fonts.mjs';
import { EMITTERS as EDITORIAL_EMITTERS } from './editorial-ui-modules.mjs';
import { EMITTERS as CATALOG_A_EMITTERS } from './hyperframes-catalog-a.mjs';
import { EMITTERS as CATALOG_B_EMITTERS } from './hyperframes-catalog-b.mjs';

export const COMPOSITION_ID = 'launchclip-story';
export const GSAP_SRC = 'https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js';
const CSP = "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const FIRST_SCENE_TRACK = 2;
const TOGGLE_LEAD = 0.0005;

/** Every HyperFrames emitter, keyed by module id. */
export function hyperframesEmitters() {
  return { ...CATALOG_A_EMITTERS, ...CATALOG_B_EMITTERS, ...EDITORIAL_EMITTERS };
}

/**
 * Compile a resolved story into a HyperFrames project in options.projectDir.
 * options:
 *   projectDir   output directory (index.html, assets/); required when write is true
 *   sourceDir    the storyboard project holding assets/, captions and words (default projectDir)
 *   sceneFilter  scene id, id array or predicate: compile only those scenes on
 *                the background, without transitions, captions, audio or loop
 *                (the HyperFrames twin of the Remotion ModuleReview composition)
 *   write        false to return {html, files} without touching the disk
 *   copyAssets   false to skip copying sourceDir/assets into projectDir
 * → {html, files: [relative paths written], warnings, boundaries, compositionId}
 */
export async function compileStoryToHyperFrames(story, options = {}) {
  const { projectDir, sceneFilter, write = true, copyAssets = true } = options;
  const sourceDir = options.sourceDir ?? projectDir;
  if (write && !projectDir) throw new Error('compileStoryToHyperFrames needs options.projectDir');
  const warnings = [];
  const known = knownModules();
  const validation = validateStory(story, { modules: known });
  const unknown = (message) => /\.module "[^"]+" is not a known module$/.test(message);
  // Unknown modules are reported once per scene by build() below.
  const errors = validation.errors.filter((message) => !unknown(message));
  if (errors.length) throw new Error(`storyboard.json is invalid:\n- ${errors.join('\n- ')}`);
  warnings.push(...validation.warnings);
  if (!story.resolved || story.scenes.some((scene) => typeof scene.start !== 'number' || typeof scene.end !== 'number')) {
    throw new Error('compileStoryToHyperFrames needs a resolved story (run resolveStory first)');
  }

  const format = { width: story.format.width, height: story.format.height, fps: story.resolved.fps, duration: story.resolved.duration };
  const W = format.width, H = format.height, D = format.duration;
  const isolate = sceneFilter !== undefined && sceneFilter !== null;
  const keep = sceneSelector(sceneFilter);
  const colors = story.brand?.colors ?? {};
  const bg = colors.bg ?? '#000000';
  const emitters = hyperframesEmitters();
  const windows = sceneWindows(story);
  const layers = windows.scenes.filter((entry) => keep(entry.scene));
  if (isolate && !layers.length) throw new Error(`sceneFilter matched no scene (scenes: ${story.scenes.map((scene) => scene.id).join(', ')})`);
  if (isolate) for (const entry of layers) { entry.tweens = []; entry.renderEnd = entry.end; }

  // Tracks: 0 audio, 1 background; each scene takes a pair (root, root+1),
  // reused once its render window has ended.
  const trackEnds = [];
  const allocate = (start, end) => {
    let slot = trackEnds.findIndex((until) => until <= start + 1e-6);
    if (slot < 0) { slot = trackEnds.length; trackEnds.push(end); } else trackEnds[slot] = end;
    return FIRST_SCENE_TRACK + slot * 2;
  };

  const css = [];
  const markup = [];
  const hoisted = [];
  const motion = [];
  const hide = [];
  const boundaries = isolate ? [] : deriveBoundaries(story);
  const boundaryFor = new Map(boundaries.map((entry) => [entry.to_id, entry]));
  let z = 10;

  const build = (entry, { idSuffix = '', track, clone = false } = {}) => {
    const scene = idSuffix ? { ...entry.scene, id: `${entry.scene.id}${idSuffix}` } : entry.scene;
    const end = clone ? entry.scene.end : entry.renderEnd;
    let model;
    let reason = null;
    if (scene.module === 'custom') reason = 'custom modules render only in Remotion (remotion/modules/); use a catalogue module for HyperFrames';
    else {
      try { model = resolveModule(scene, story, { track, end }); }
      catch (error) { reason = error.message; }
    }
    if (model && !emitters[model.module]) reason = `no HyperFrames emitter for module "${model.module}"`;
    if (reason) {
      if (!clone) warnings.push(`${entry.scene.id}: ${reason}; rendering a placeholder`);
      model = placeholderModel(scene, story, reason, { end });
      model.track = track;
      return { model, out: emitPlaceholder(model) };
    }
    let out;
    try { out = emitters[model.module](model); }
    catch (error) {
      if (!clone) warnings.push(`${entry.scene.id}: HyperFrames emitter for "${model.module}" failed (${error.message}); rendering a placeholder`);
      model = placeholderModel(scene, story, error.message, { end });
      model.track = track;
      out = emitPlaceholder(model);
    }
    return { model, out };
  };

  for (const entry of layers) {
    const track = allocate(entry.start, entry.renderEnd);
    const { model, out } = build(entry, { track });
    if (model.hidesCaptions) hide.push([entry.start, entry.renderEnd]);
    const id = attr(entry.scene.id);
    const outer = `lc-scene-${id}`, inner = `lc-layer-${id}`;
    const media = hoistMedia(out.html ?? '');
    for (const element of media.elements) hoisted.push(withZIndex(element, z + 5));
    if (media.elements.length && entry.tweens.some((tw) => tw.prop !== 'opacity')) warnings.push(`${entry.scene.id}: root media does not follow ${entry.transitionIn?.type ?? 'transition'} transforms (HyperFrames keeps <video>/<audio> on the root)`);
    const boundary = boundaryFor.get(entry.scene.id);
    markup.push(`<div id="${outer}" class="lc-scene${entry.plate ? ' lc-plate' : ''}" data-launchclip-scene="${id}" data-launchclip-module="${attr(entry.scene.module)}" data-launchclip-start="${num(entry.start)}" data-launchclip-render-end="${num(entry.renderEnd)}"${boundaryAttrs(boundary)} style="z-index:${z}"><div id="${inner}" class="lc-layer">${media.html}</div></div>`);
    css.push(out.css ?? '');
    motion.push(`// ${entry.scene.id} (${entry.scene.module}) ${num(entry.start)}–${num(entry.renderEnd)}s`);
    motion.push(...toggle(`#${outer}`, entry.start, entry.renderEnd, D));
    motion.push(...entry.tweens.map((tw) => tweenCode(`#${inner}`, tw)));
    if (out.motion) motion.push(`{\n${out.motion}\n}`);
    z += 10;
  }

  // Loop ending: the loop_to scene's first state, held over the final window.
  const loop = isolate ? null : windows.loop;
  if (loop) {
    const entry = { ...windows.scenes.find((item) => item.id === loop.sceneId) };
    const { out } = build(entry, { idSuffix: '-loop', clone: true });
    const id = attr(`${loop.sceneId}-loop`);
    const outer = `lc-scene-${id}`, inner = `lc-layer-${id}`;
    const media = hoistMedia(out.html ?? '');
    const boundary = boundaries.find((item) => item.to_id === loop.sceneId && Math.abs(item.start_seconds - loop.start) < 1e-3);
    markup.push(`<div id="${outer}" class="lc-scene lc-plate lc-loop" data-launchclip-scene="${id}" data-launchclip-loop-to="${attr(loop.sceneId)}" data-launchclip-start="${num(loop.start)}"${boundaryAttrs(boundary)} style="z-index:${z}"><div id="${inner}" class="lc-layer">${unclip(media.html)}</div></div>`);
    if (media.elements.length) warnings.push(`${loop.sceneId}: root media is not repeated in the loop ending`);
    css.push(out.css ?? '');
    motion.push(`// loop ending → ${loop.sceneId} at its first state, ${num(loop.start)}–${num(loop.end)}s`);
    motion.push(...toggle(`#${outer}`, loop.start, loop.end + 1, D));
    motion.push(...loop.tweens.map((tw) => tweenCode(`#${inner}`, tw)));
    if (out.motion) {
      motion.push(`{\nconst loopTl = gsap.timeline({ paused: true });\n((tl) => {\n${out.motion}\n})(loopTl);\ntl.fromTo(loopTl, { time: ${num(entry.scene.start)} }, { time: ${num(entry.scene.start)}, duration: ${num(Math.max(0.001, loop.end - loop.start + TOGGLE_LEAD))}, ease: 'none', immediateRender: false }, ${num(Math.max(0, loop.start - TOGGLE_LEAD))});\n}`);
    }
    z += 10;
  }

  // Audio: exactly one root track.
  const audioSrc = isolate ? null : story.audio?.mix ?? story.audio?.voice ?? null;
  if (audioSrc && sourceDir && !existsSync(path.join(sourceDir, audioSrc))) warnings.push(`audio file ${audioSrc} was not found in ${sourceDir}`);
  const audio = audioSrc ? `<audio id="lc-audio" class="clip" src="${attr(audioSrc)}" data-start="0" data-duration="${num(D)}" data-media-start="0" data-volume="1" data-track-index="0"></audio>` : '';

  // Captions.
  let captions = null;
  const overlay = isolate ? null : (story.overlays ?? []).find((entry) => entry?.type === 'captions' && entry.style !== 'none');
  if (overlay) {
    const chunks = await loadCaptionChunks(story, overlay, sourceDir, warnings);
    if (chunks?.length) {
      for (const range of overlay.hide ?? []) hide.push([Number(range[0]), Number(range[1])]);
      captions = { chunks, hide };
    }
  }

  const fonts = brandFontStacks(story.brand);
  const fontCss = await fontFaces(fonts.families, sourceDir, warnings);
  const capIdle = colors.paper ?? CAPTION_DEFAULT_COLORS.idle;
  const capActive = colors.primary ?? CAPTION_DEFAULT_COLORS.active;
  const html = `<!doctype html>
<html lang="${attr(story.format.language ?? 'en')}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=${W}, height=${H}">
  <meta http-equiv="Content-Security-Policy" content="${CSP}">
  <title>${text(story.title ?? 'LaunchClip story')}</title>
  <script src="${GSAP_SRC}"></script>
${fontCss.links.map((href) => `  <link rel="stylesheet" href="${attr(href)}">`).join('\n')}
  <style>
${fontCss.css}
    * { box-sizing: border-box; }
    html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: ${bg}; }
    #launchclip-root { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; --lc-font-display: ${fonts.display}; --lc-font-body: ${fonts.body}; --lc-font-meta: ${fonts.meta}; --cap-font: ${fonts.display}; --cap-idle: ${capIdle}; --cap-active: ${capActive}; font-family: var(--lc-font-body); }
    #lc-bg { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; background: ${bg}; }
    .lc-scene { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; opacity: 0; isolation: isolate; overflow: hidden; pointer-events: none; }
    .lc-layer { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; transform-origin: 50% 50%; }
    .lc-plate > .lc-layer { background: ${bg}; }
    ${placeholderCss()}
    ${captions ? `${captionCss(format).trim().split('\n').join('\n    ')}\n    #lc-captions { z-index: 100000; }` : ''}
    ${css.filter(Boolean).join('\n    ')}
  </style>
</head>
<body>
  <div id="launchclip-root" data-composition-id="${COMPOSITION_ID}" data-start="0" data-duration="${num(D)}" data-width="${W}" data-height="${H}" data-fps="${format.fps}" data-launchclip-cinematic-contract="phase-2" data-launchclip-story="${attr(story.schema)}">
    <div id="lc-bg" class="clip" data-start="0" data-duration="${num(D)}" data-track-index="1"></div>
    ${audio}
    ${hoisted.join('\n    ')}
    ${markup.join('\n    ')}
    ${captions ? '<div id="lc-captions" class="lc-captions"></div>' : ''}
    ${captions ? `<script>\n${captionRuntime(captions.chunks)}</script>` : ''}
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
${motion.join('\n').split('\n').map((line) => `      ${line}`).join('\n')}
      ${captions ? `window.mountCaptions(tl, document.getElementById("lc-captions"), { hide: ${JSON.stringify(captions.hide)} });` : ''}
      window.__timelines["${COMPOSITION_ID}"] = tl;
    </script>
  </div>
</body>
</html>
`.replace(/\n\s*\n(?=\s*<)/g, '\n');

  const files = [];
  if (write) {
    await mkdir(projectDir, { recursive: true });
    if (copyAssets && sourceDir && path.resolve(sourceDir) !== path.resolve(projectDir) && existsSync(path.join(sourceDir, 'assets'))) {
      await cp(path.join(sourceDir, 'assets'), path.join(projectDir, 'assets'), { recursive: true, force: true });
      files.push('assets/');
    }
    await writeFile(path.join(projectDir, 'index.html'), html);
    files.push('index.html');
  }
  return { html, files, warnings, boundaries, compositionId: COMPOSITION_ID };
}

function sceneSelector(filter) {
  if (filter === undefined || filter === null) return () => true;
  if (typeof filter === 'function') return filter;
  const ids = new Set(Array.isArray(filter) ? filter : [filter]);
  return (scene) => ids.has(scene.id);
}

// Outer layer visibility: explicit zero-length fromTo states so the timeline
// gives the same frame whatever order it is sought in.
// Both switch half a millisecond early so a frame time (frame / fps) that
// rounds just below the boundary still lands on the right side of it, as a
// Remotion <Sequence> does with whole frames.
function toggle(selector, start, end, duration) {
  const at = (time) => num(Math.max(0, time - TOGGLE_LEAD));
  const lines = [`tl.fromTo(${js(selector)}, { opacity: 0 }, { opacity: 1, duration: 0, immediateRender: false }, ${at(start)});`];
  if (end < duration - 1e-6) lines.push(`tl.fromTo(${js(selector)}, { opacity: 1 }, { opacity: 0, duration: 0, immediateRender: false }, ${at(end)});`);
  return lines;
}

function tweenCode(selector, tw) {
  const from = gsapVars(tw.prop, tw.from), to = gsapVars(tw.prop, tw.to);
  return `tl.fromTo(${js(selector)}, ${js(from)}, ${js({ ...to, duration: round(tw.duration, 4), ease: tw.ease, immediateRender: false })}, ${num(tw.at)});`;
}

function boundaryAttrs(boundary) {
  if (!boundary) return '';
  let out = ` data-launchclip-boundary-id="${attr(boundary.boundary_id)}" data-launchclip-transition-kind="${boundary.kind}" data-launchclip-transition-start="${num(boundary.start_seconds)}" data-launchclip-transition-duration="${num(boundary.duration_seconds)}"`;
  if (boundary.sequence_id) out += ` data-launchclip-sequence-id="${attr(boundary.sequence_id)}"`;
  if (boundary.from_id) out += ` data-launchclip-transition-from="${attr(boundary.from_id)}"`;
  if (boundary.to_id) out += ` data-launchclip-transition-to="${attr(boundary.to_id)}"`;
  return out;
}

// HyperFrames only seeks media that is a direct child of the root, so
// <video>/<audio> leave the scene layer.
function hoistMedia(html) {
  const elements = [];
  const rest = html.replace(/<(video|audio)\b[^>]*>(?:[\s\S]*?<\/\1>)?/gi, (match) => { elements.push(match); return ''; });
  return { html: rest, elements };
}

function withZIndex(element, z) {
  return /\sstyle="/.test(element) ? element.replace(/\sstyle="/, ` style="z-index:${z};`) : element.replace(/^<(\w+)/, `<$1 style="z-index:${z}"`);
}

// The loop clone is shown by its layer, not by HyperFrames clip timing.
function unclip(html) {
  return html
    .replace(/\sclass="clip(?=[\s"])\s*/g, ' class="lc-unclipped ')
    .replace(/\sdata-(start|duration|track-index)="[^"]*"/g, '');
}

export function emitPlaceholder(model) {
  const { id, rect, start, duration, track, content } = model;
  const html = `<section id="${attr(id)}" class="clip lc-placeholder" data-start="${num(start)}" data-duration="${num(duration)}" data-track-index="${track ?? FIRST_SCENE_TRACK}" data-launchclip-placeholder="${attr(model.module ?? '')}" style="left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px"><div class="lc-placeholder-label">${text(content.label)}</div>${content.detail ? `<div class="lc-placeholder-detail">${text(content.detail)}</div>` : ''}</section>`;
  return { html, css: '', motion: '', events: [], layout: model.layout };
}

function placeholderCss() {
  const S = PLACEHOLDER_STYLE;
  return `.lc-placeholder { position: absolute; display: flex; flex-direction: column; justify-content: center; gap: 16px; padding: ${S.padding}px; overflow: hidden; background: ${S.surface}; color: ${S.foreground}; border: ${S.borderWidth}px dashed ${S.border}; border-radius: ${S.radius}px; font-family: ${S.fontFamily}; }
    .lc-placeholder-label { font-size: ${S.labelSize}px; font-weight: 800; line-height: 1.1; overflow-wrap: anywhere; }
    .lc-placeholder-detail { font-size: ${S.detailSize}px; line-height: 1.3; color: ${S.muted}; overflow-wrap: anywhere; }`;
}

async function loadCaptionChunks(story, overlay, sourceDir, warnings) {
  try {
    if (overlay.src) {
      if (!sourceDir) throw new Error('captions src needs options.sourceDir');
      return captionChunksFrom(JSON.parse(await readFile(path.join(sourceDir, overlay.src), 'utf8')));
    }
    const wordsFile = story.audio?.words;
    if (!wordsFile || !sourceDir) { warnings.push('captions overlay has no src and no audio.words file to chunk; captions skipped'); return null; }
    const words = narrationWords(JSON.parse(await readFile(path.join(sourceDir, wordsFile), 'utf8')));
    if (!words.length) { warnings.push(`${wordsFile} has no words; captions skipped`); return null; }
    return chunkWords(words);
  } catch (error) {
    warnings.push(`captions skipped: ${error.message}`);
    return null;
  }
}

// Brand fonts: frozen files under assets/fonts/ win (named <family-slug>*.woff2),
// then the exact Google Fonts files @remotion/google-fonts would load (so both
// renderers draw the same faces), then a Google Fonts stylesheet link.
async function fontFaces(families, sourceDir, warnings) {
  const rules = [];
  const links = [];
  let local = [];
  if (sourceDir && existsSync(path.join(sourceDir, 'assets/fonts'))) local = await readdir(path.join(sourceDir, 'assets/fonts'));
  for (const family of families) {
    const slug = fontSlug(family);
    const files = local.filter((file) => /\.(woff2?|ttf|otf)$/i.test(file) && file.toLowerCase().replace(/[^a-z0-9]+/g, '-').startsWith(slug));
    if (files.length) {
      for (const file of files.sort()) {
        const weight = file.match(/(?:^|[^0-9])([1-9]00)(?:[^0-9]|$)/)?.[1] ?? (/bold/i.test(file) ? '700' : '400');
        const style = /italic/i.test(file) ? 'italic' : 'normal';
        const format = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' }[file.split('.').pop().toLowerCase()];
        rules.push(`    @font-face { font-family: '${family}'; src: url("assets/fonts/${attr(file)}") format("${format}"); font-weight: ${weight}; font-style: ${style}; font-display: block; }`);
      }
      continue;
    }
    const info = await googleFontInfo(family);
    if (info) {
      for (const [weight, subsets] of Object.entries(info.fonts?.normal ?? {})) {
        const subset = subsets.latin ? 'latin' : Object.keys(subsets)[0];
        if (!subset) continue;
        const range = info.unicodeRanges?.[subset];
        rules.push(`    @font-face { font-family: '${family}'; src: url("${subsets[subset]}") format("woff2"); font-weight: ${weight}; font-style: normal; font-display: block;${range ? ` unicode-range: ${range};` : ''} }`);
      }
      continue;
    }
    warnings.push(`font "${family}" is not frozen under assets/fonts/; loading it from Google Fonts at render time`);
    links.push(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}&display=block`);
  }
  return { css: rules.join('\n'), links };
}

async function googleFontInfo(family) {
  try {
    const module = await import(`@remotion/google-fonts/${googleFontModuleName(family)}`);
    const info = module.getInfo?.();
    return info?.fontFamily === family ? info : null;
  } catch {
    return null;
  }
}

function attr(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function text(value) { return attr(value); }
function js(value) { return JSON.stringify(value).replace(/</g, '\\u003c'); }
function round(value, digits = 3) { const f = 10 ** digits; return Math.round(value * f) / f; }
function num(value) { return String(round(Number(value), 4)); }

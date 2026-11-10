// HyperFrames form of a custom module (`"module": "custom"`, bespoke tier).
// Contract: docs/KIT_CONTRACTS.md, "Custom modules".
//
// The scene names an HTML fragment in the project at source.hyperframes:
//
//   <style> .label { position: absolute; left: 80px; top: 600px; } </style>
//   <div class="label"></div>
//   <script>
//     const label = root.querySelector('.label');
//     label.textContent = params.text;
//     tl.fromTo(label, {opacity: 0, y: 40}, {opacity: 1, y: 0, duration: 0.4}, scene.start + 0.2);
//   </script>
//
// - The markup is placed in a full-canvas element, the scene's root.
// - The <style> rules are nested under that root, so they cannot restyle the
//   rest of the story.
// - Each <script> runs once when the page loads, with `tl` (the story's paused
//   GSAP timeline, in absolute seconds), `root` (the scene's root element) and
//   the same values the Remotion form receives as props: `scene` ({id, start,
//   end, duration}), `params`, `brand`, `format` and `model`.
// - The root carries the brand as CSS variables: --lc-bg, --lc-primary,
//   --lc-accent, --lc-ink, --lc-paper (the brand colours that are set) and
//   --lc-font-display, --lc-font-body, --lc-font-meta (the bundled font
//   stacks, also in model.fonts).
//
// Like every module it must be a pure function of time: everything that moves
// is a tween on `tl`. The fragment is refused when it reads a clock or a
// random number, schedules its own callbacks, animates with CSS, or loads
// anything from outside the project.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { customGapMessage, customSource } from '../core/custom-modules.mjs';
import { brandFontStacks } from '../core/fonts.mjs';
import { moduleDomId } from '../core/modules.mjs';

/** What a fragment may not contain: [pattern, why]. */
export const CUSTOM_FRAGMENT_RULES = Object.freeze([
  [/\bMath\s*\.\s*random\b/, 'Math.random (a frame must not depend on chance; derive values from params or the scene id)'],
  [/\bDate\s*\.\s*now\b|\bnew\s+Date\b|\bperformance\s*\.\s*now\b/, 'a clock (Date, performance.now); time comes from the timeline'],
  [/\bset(?:Timeout|Interval)\b|\brequestAnimationFrame\b|\brequestIdleCallback\b/, 'a timer or animation-frame callback; put motion on tl'],
  [/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|\bsendBeacon\b/, 'a network request'],
  [/\bimport\s*\(|\bimportScripts\b|\beval\s*\(|\bnew\s+Function\b/, 'dynamic code loading'],
  [/<script\b[^>]*\bsrc\s*=/i, 'an external script (<script src>); inline the code'],
  [/<(?:iframe|object|embed|link|meta|base)\b/i, 'an <iframe>, <object>, <embed>, <link>, <meta> or <base> element'],
  [/(?:\bsrc|\bhref|\bposter|\bsrcset)\s*=\s*["']?\s*(?:[a-z][a-z0-9+.-]*:)?\/\//i, 'a remote URL; use a project file under assets/'],
  [/url\(\s*["']?\s*(?:[a-z][a-z0-9+.-]*:)?\/\//i, 'a remote url(); use a project file under assets/'],
  [/@keyframes\b|(?:^|[;{\s])(?:animation|transition)(?:-[a-z-]+)?\s*:/i, 'a CSS animation or transition (they run on the wall clock); tween on tl instead'],
  [/@import\b/i, 'a CSS @import']
]);

const STYLE = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const SCRIPT = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;

/** A fragment's text → {html, css, scripts: [code]}. */
export function parseCustomFragment(text) {
  const source = String(text ?? '');
  const css = [...source.matchAll(STYLE)].map((match) => match[1].trim()).filter(Boolean).join('\n');
  const scripts = [...source.matchAll(SCRIPT)].map((match) => match[1].trim()).filter(Boolean);
  const html = source.replace(STYLE, '').replace(SCRIPT, '').replace(/<!--[\s\S]*?-->/g, '').trim();
  return { html, css, scripts };
}

/** What breaks the rules in a fragment: [reason]. Empty when it is clean. */
export function lintCustomFragment(text) {
  const source = String(text ?? '').replace(/<!--[\s\S]*?-->/g, '');
  const problems = CUSTOM_FRAGMENT_RULES.filter(([pattern]) => pattern.test(source)).map(([, why]) => `uses ${why}`);
  if (/<\/?(?:html|head|body)\b/i.test(source)) problems.push('is a whole document; write only the scene\'s markup, <style> and <script>');
  const { html, scripts } = parseCustomFragment(source);
  if (!html && !scripts.length) problems.push('is empty');
  return problems;
}

/**
 * Load and check the HyperFrames form of every custom scene.
 * → Map(sceneId → {file, fragment} | {error}), an entry per custom scene. A
 * scene with no HyperFrames form, a missing file or a fragment that breaks
 * the rules carries `error`, a sentence naming the scene and the renderer.
 */
export async function loadCustomModules(story, { sourceDir } = {}) {
  const out = new Map();
  for (const scene of Array.isArray(story?.scenes) ? story.scenes : []) {
    if (scene?.module !== 'custom') continue;
    const file = customSource(scene, 'hyperframes');
    if (!file) { out.set(scene.id, { error: customGapMessage(scene, 'hyperframes') }); continue; }
    const where = `scene "${scene.id}": the hyperframes form of its custom module (${file})`;
    if (!/\.html?$/i.test(file)) { out.set(scene.id, { error: `${where} must be an .html fragment` }); continue; }
    if (!sourceDir) { out.set(scene.id, { error: `${where} needs the project directory to be read from` }); continue; }
    let text;
    try { text = await readFile(path.join(sourceDir, file), 'utf8'); }
    catch { out.set(scene.id, { error: `${where} was not found in the project` }); continue; }
    const problems = lintCustomFragment(text);
    if (problems.length) { out.set(scene.id, { error: `${where} ${problems.join('; ')}` }); continue; }
    out.set(scene.id, { file, fragment: parseCustomFragment(text) });
  }
  return out;
}

/** The errors of loadCustomModules, for a check before rendering: [{id, module: "custom", reason}]. */
export async function customModuleProblems(story, { sourceDir } = {}) {
  const loaded = await loadCustomModules(story, { sourceDir });
  return [...loaded].filter(([, entry]) => entry.error).map(([id, entry]) => ({ id, module: 'custom', reason: entry.error }));
}

/** The model of a custom scene: a full-canvas layer that the fragment draws in. */
export function customModel(scene, story, { end, track } = {}) {
  const width = Number(story?.format?.width ?? 1080), height = Number(story?.format?.height ?? 1920);
  const start = Number(scene.start ?? 0), finish = Number(end ?? scene.end ?? start + 1);
  const duration = Math.round((finish - start) * 1e6) / 1e6;
  const rect = { x: 0, y: 0, width, height };
  const still = { opacity: 1, x: 0, y: 0, scale: 1 };
  return {
    id: moduleDomId(scene.id), module: 'custom', sceneId: scene.id, canvas: { width, height }, start, duration, end: finish, rect, track,
    motion: { enterStart: start, enterEnd: start, exitStart: finish, end: finish, enterFrom: still, exitTo: still, enterEase: 'none', exitEase: 'none' },
    content: { component: scene.params?.component ?? null }, events: [], fonts: (({ display, body, meta }) => ({ display, body, meta }))(brandFontStacks(story?.brand)),
    // The fragment owns its motion: no hold drift on top of it.
    layout: { canvas: { width, height }, rect, role: 'custom', drift: false, motion: { enterEnd: start, exitStart: finish, end: finish } },
    hidesCaptions: Boolean(scene.params?.hidesCaptions)
  };
}

const attr = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const js = (value) => JSON.stringify(value ?? null).replace(/</g, '\\u003c');
const num = (value) => String(Math.round(Number(value) * 1e4) / 1e4);

/** Model + fragment → {html, css, motion, events, layout}, the shape every emitter returns. */
export function emitCustom(model, fragment, { scene, story } = {}) {
  const root = `lc-custom-${model.id}`;
  const colors = Object.entries(story?.brand?.colors ?? {}).filter(([key, value]) => /^[a-z]+$/.test(key) && /^#[0-9a-f]{3,8}$/i.test(String(value))).map(([key, value]) => `--lc-${key}:${value}`);
  const fonts = Object.entries(model.fonts ?? {}).map(([role, stack]) => `--lc-font-${role}:${stack}`);
  const style = ['position:absolute', 'left:0', 'top:0', `width:${model.canvas.width}px`, `height:${model.canvas.height}px`, 'overflow:hidden', ...colors, ...fonts].join(';');
  const html = `<section id="${attr(root)}" class="clip lc-custom" data-start="${num(model.start)}" data-duration="${num(model.duration)}" data-track-index="${model.track ?? 2}" data-launchclip-custom="${attr(model.content.component ?? '')}" style="${attr(style)}">${fragment.html}</section>`;
  const css = fragment.css ? `#${root} {\n${fragment.css}\n}` : '';
  const facts = { id: scene?.id ?? model.sceneId, start: model.start, end: model.end, duration: model.duration };
  const args = [`document.getElementById(${js(root)})`, js(facts), js(scene?.params ?? {}), js(story?.brand ?? {}), js(story?.format ?? {}), js(model)].join(', ');
  const motion = fragment.scripts.map((code) => `((root, scene, params, brand, format, model) => {\n${code}\n})(${args});`).join('\n');
  return { html, css, motion, events: [], layout: model.layout };
}

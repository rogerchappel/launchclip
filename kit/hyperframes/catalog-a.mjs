// HyperFrames emitters for catalogue A (kit/core/catalog-a.mjs).
//
// EMITTERS[id](model) → {html, css, motion, events, layout}, the same shape as
// buildEditorialModule(). `motion` is GSAP code against the host's paused
// timeline `tl`. It is seek-safe by construction: every animated node gets a
// tl.set of its initial state at the module start, every tween is a fromTo
// with immediateRender:false and explicit endpoints taken from the model
// (whose tweens never overlap per prop and chain end-to-start), discrete text
// uses tl.set frames like the editorial textFrames, and nothing uses
// onUpdate, proxies or call().
import {gsapText} from '../core/motion.mjs';
import {CTA_ICONS, animatedNodes, cssFromProps, initialNodeProps, nodeId} from '../core/catalog-a.mjs';

const escape = value => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const js = value => JSON.stringify(value).replace(/</g, '\\u003c');
const kebab = key => key.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`);
const declarations = style => Object.entries(style).map(([key, value]) => `${kebab(key)}:${value}`).join(';');

/** GSAP vars for model props: blur becomes a filter string, the rest map 1:1. */
function gsapVars(props) {
  const out = {};
  for (const [key, value] of Object.entries(props)) {
    if (key === 'blur') out.filter = `blur(${value}px)`;
    else out[key] = value;
  }
  return out;
}

function stylesheet(model) {
  let css = '';
  for (const [node, style] of Object.entries(model.styles)) {
    const initial = cssFromProps(initialNodeProps(model, node));
    css += `#${nodeId(model, node)}{${declarations({...style, ...initial})}}`;
  }
  for (const [name, style] of Object.entries(model.classes ?? {})) css += `#${model.id} .a-${name}{${declarations(style)}}`;
  return css;
}

function timeline(model) {
  const lines = [];
  for (const node of animatedNodes(model)) {
    lines.push(`tl.set(${js(`#${nodeId(model, node)}`)}, ${js({...gsapVars(initialNodeProps(model, node)), force3D: false})}, ${model.start});`);
  }
  for (const a of model.animations) {
    const to = {...gsapVars(a.to), duration: a.duration, ease: a.ease, immediateRender: false, force3D: false};
    lines.push(`tl.fromTo(${js(`#${nodeId(model, a.node)}`)}, ${js(gsapVars(a.from))}, ${js(to)}, ${a.start});`);
  }
  for (const entry of model.texts ?? []) {
    const selector = js(`#${nodeId(model, entry.node)}`);
    lines.push(`tl.set(${selector}, {textContent:${js(gsapText(entry.initial))}}, ${model.start});`);
    for (const frame of entry.frames) lines.push(`tl.set(${selector}, {textContent:${js(gsapText(frame.text))}}, ${frame.time});`);
  }
  return lines.join('\n');
}

function tag(model, node, name = 'div', inner = '', attrs = '') {
  return `<${name} id="${nodeId(model, node)}"${attrs}>${inner}</${name}>`;
}

function shell(model, body) {
  const timing = `class="clip" data-start="${model.start}" data-duration="${model.duration}" data-track-index="${model.track}"`;
  return {
    html: `<section id="${model.id}" ${timing} data-module="${model.module}">${body}</section>`,
    css: stylesheet(model),
    motion: timeline(model),
    events: model.events,
    layout: model.layout
  };
}

const lineSpans = (model, lines, prefix) => lines.map((line, index) => tag(model, `${prefix}-${index}`, 'span', escape(line))).join('');

function headlineWords(model, lines, glow) {
  return lines.map(line => tag(model, `line-${line.index}`, 'span', line.words.map(word => {
    const node = `word-${word.index}`;
    if (!glow || word.emphasis === null) return tag(model, node, 'span', escape(word.text));
    return tag(model, node, 'span', tag(model, `${node}-glow`, 'span', escape(word.text), ' aria-hidden="true"') + tag(model, `${node}-text`, 'span', escape(word.text)) + tag(model, `${node}-bar`, 'span'));
  }).join(' '))).join('');
}

function atomsHtml(atoms) {
  return atoms.map(atom => {
    if (atom.type === 'frac') return `<span class="a-frac"><span class="a-frac-num">${atomsHtml(atom.num)}</span><span class="a-frac-bar"></span><span class="a-frac-den">${atomsHtml(atom.den)}</span></span>`;
    const cls = atom.type === 'op' ? (atom.wide ? 'op-wide' : atom.unary ? 'op-unary' : 'op') : atom.type;
    const sub = atom.sub ? `<span class="a-sub">${atomsHtml(atom.sub)}</span>` : '';
    const sup = atom.sup ? `<span class="a-sup">${atomsHtml(atom.sup)}</span>` : '';
    return `<span class="a-${cls}">${escape(atom.text)}</span>${sub}${sup}`;
  }).join('');
}

export function emitHookTitle(model) {
  const c = model.content;
  let body = tag(model, 'glow');
  if (c.eyebrow) body += tag(model, 'eyebrow', 'div', escape(c.eyebrow)) + tag(model, 'rule');
  body += tag(model, 'headline', 'h1', headlineWords(model, c.lines, true));
  if (c.kicker) body += tag(model, 'kicker', 'div', escape(c.kicker));
  return shell(model, body);
}

export function emitKineticWords(model) {
  const c = model.content;
  const body = c.beats.map(beat => {
    const node = `beat-${beat.index}`;
    const lines = beat.lines.map((line, index) => tag(model, `${node}-mask-${index}`, 'span', tag(model, `${node}-line-${index}`, 'span', escape(line)))).join('');
    return tag(model, node, 'div', tag(model, `${node}-text`, 'span', lines) + (model.styles[`${node}-bar`] ? tag(model, `${node}-bar`) : ''));
  }).join('');
  return shell(model, body);
}

export function emitCountUp(model) {
  const c = model.content;
  const sparks = c.spark ? tag(model, 'sparks', 'div', c.sparks.map(item => tag(model, `spark-${item.index}`, 'div', tag(model, `spark-${item.index}-ray`))).join('')) : '';
  const number = (c.prefix ? tag(model, 'prefix', 'span', escape(c.prefix)) : '') + tag(model, 'digits', 'span', escape(c.initialText)) + (c.suffix ? tag(model, 'suffix', 'span', escape(c.suffix)) : '') + (c.underline ? tag(model, 'bar') : '') + sparks;
  let body = tag(model, 'glow') + tag(model, 'number', 'div', number) + tag(model, 'label', 'div', lineSpans(model, c.labelLines, 'label-line'));
  if (c.note) body += tag(model, 'note', 'div', escape(c.note));
  return shell(model, body);
}

export function emitEquationLockup(model) {
  const c = model.content;
  let body = tag(model, 'glow');
  if (c.name) body += tag(model, 'name', 'div', escape(c.name));
  const terms = c.terms.map(term => tag(model, `term-${term.index}`, 'span', (term.index === c.highlight ? tag(model, `term-${term.index}-box`, 'span') : '') + tag(model, `term-${term.index}-text`, 'span', atomsHtml(term.atoms)))).join('');
  body += tag(model, 'rule-top') + tag(model, 'eq', 'div', terms) + tag(model, 'rule-bottom');
  if (c.note) body += tag(model, 'note', 'div', lineSpans(model, c.noteLines, 'note-line'));
  return shell(model, body);
}

export function emitCta(model) {
  const c = model.content;
  let body = tag(model, 'glow') + tag(model, 'action', 'h2', headlineWords(model, c.lines, false));
  if (c.detail) body += tag(model, 'detail', 'div', lineSpans(model, c.detailLines, 'detail-line'));
  if (c.handle) {
    // The icon node is a span around the svg so GSAP uses CSS transforms.
    const svg = `<svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="display:block">${CTA_ICONS[c.icon]}</svg>`;
    const icon = c.icon !== 'none' ? tag(model, 'icon', 'span', svg, ' aria-hidden="true"') : '';
    body += tag(model, 'pill', 'div', tag(model, 'ring') + tag(model, 'pill-body', 'div', `${icon}<span>${escape(c.handle)}</span>`));
  }
  return shell(model, body);
}

export const EMITTERS = Object.freeze({
  'hook-title': emitHookTitle,
  'kinetic-words': emitKineticWords,
  'count-up': emitCountUp,
  'equation-lockup': emitEquationLockup,
  cta: emitCta
});

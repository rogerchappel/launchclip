// Typesetting for the equation module (kit/core/catalog-i-math.mjs). The
// storyboard carries LaTeX in params.latex; this turns it into plain data
// the frame-pure module can draw in both renderers: the MathJax glyph
// outlines it uses, and every glyph and rule as a reference with its
// absolute matrix, split into layers (the base, then each marked term), with
// each term's box. kit/core never imports MathJax; readProjectStory and
// finish typeset the story in memory before it is validated or rendered.
//
// Marks in params.latex (one level, no nesting):
//   \term{…}  a term that reveals on its own cue
//   \add{…}   added in the diff (drawn green)
//   \del{…}   removed in the diff (drawn red and struck through)

import { texToSvg } from "./mathjax-tex-svg.js";

export const TYPESET_VERSION = 1;
const MARKS = { term: "term", add: "add", del: "del" };

/** LaTeX with \term / \add / \del → MathJax TeX with \class marks, and the marks in order. */
export function markTerms(latex) {
  if (typeof latex !== "string" || !latex.trim()) throw new Error("params.latex must be a LaTeX string");
  const marks = [];
  let out = "", i = 0, depth = null;
  while (i < latex.length) {
    const m = /^\\(term|add|del)\s*\{/.exec(latex.slice(i));
    if (m) {
      if (depth !== null) throw new Error(`params.latex: \\${m[1]}{…} cannot sit inside another mark`);
      out += `\\class{lc-${marks.length}}{`;
      marks.push(MARKS[m[1]]);
      depth = 0;
      i += m[0].length;
      continue;
    }
    const ch = latex[i];
    if (ch === "\\" && i + 1 < latex.length) { out += latex.slice(i, i + 2); i += 2; continue; }
    if (depth !== null) {
      if (ch === "{") depth++;
      else if (ch === "}") { if (depth === 0) depth = null; else depth--; }
    }
    out += ch;
    i++;
  }
  if (depth !== null) throw new Error("params.latex: a \\term, \\add or \\del mark is not closed");
  return { tex: out, marks };
}

// ---------------------------------------------------------------------------
// A small reader for MathJax's own SVG output (well-formed, few tags).

function parseSvg(markup) {
  const root = { tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  const re = /<(\/?)([a-zA-Z]+)((?:\s+[^\s=>]+="[^"]*")*)\s*(\/?)>/g;
  let m;
  while ((m = re.exec(markup))) {
    const [, close, tag, rawAttrs, selfClose] = m;
    if (close) { stack.pop(); continue; }
    const attrs = {};
    for (const a of rawAttrs.matchAll(/([^\s=]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    const node = { tag, attrs, children: [] };
    stack.at(-1).children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root.children[0];
}

const IDENTITY = [1, 0, 0, 1, 0, 0];
const mul = (p, q) => [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3], p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];
function parseTransform(text) {
  let m = IDENTITY;
  for (const [, fn, args] of String(text ?? "").matchAll(/(translate|scale|matrix)\(([^)]*)\)/g)) {
    const n = args.split(/[\s,]+/).filter(Boolean).map(Number);
    if (fn === "translate") m = mul(m, [1, 0, 0, 1, n[0], n[1] ?? 0]);
    else if (fn === "scale") m = mul(m, [n[0], 0, 0, n[1] ?? n[0], 0, 0]);
    else m = mul(m, n);
  }
  return m;
}
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Bounds of an absolute glyph path (control points included: a slight overestimate). */
function pathBounds(d) {
  const xs = [], ys = [];
  let x = 0, y = 0;
  for (const [, cmd, args] of d.matchAll(/([MLQTCHVZ])([^MLQTCHVZ]*)/gi)) {
    const n = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    const C = cmd.toUpperCase();
    if (C === "H") { for (const v of n) { x = v; xs.push(x); ys.push(y); } continue; }
    if (C === "V") { for (const v of n) { y = v; xs.push(x); ys.push(y); } continue; }
    for (let k = 0; k + 1 < n.length; k += 2) { x = n[k]; y = n[k + 1]; xs.push(x); ys.push(y); }
  }
  return xs.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : [0, 0, 0, 0];
}

const round = (v) => Math.round(v * 100) / 100;
const roundM = (m) => m.map((v, i) => (i < 4 ? Math.round(v * 1e5) / 1e5 : round(v)));

/**
 * LaTeX → {v, latex, viewBox, glyphs, layers, boxes}: glyphs maps a short
 * key to its outline; each layer {kind, items} holds glyph uses {g, m} and
 * rules {r: [x, y, w, h], m}, matrices in viewBox units (1 em = 1000).
 */
export function typesetLatex(latex) {
  const { tex, marks } = markTerms(latex);
  const svg = parseSvg(texToSvg(tex));
  const [vx, vy, vw, vh] = svg.attrs.viewBox.split(/\s+/).map(Number);
  const glyphs = {}, bounds = {};
  const defs = svg.children.find((node) => node.tag === "defs");
  for (const p of defs?.children ?? []) {
    const key = p.attrs.id.replace(/^MJX-\d+-TEX-/, "");
    glyphs[key] = p.attrs.d;
    bounds[key] = pathBounds(p.attrs.d);
  }
  const layers = [{ kind: "base", items: [] }, ...marks.map((kind) => ({ kind, items: [] }))];
  const boxes = marks.map(() => [Infinity, Infinity, -Infinity, -Infinity]);
  const grow = (index, m, [x0, y0, x1, y1]) => {
    if (index === 0) return;
    const b = boxes[index - 1];
    for (const [x, y] of [apply(m, x0, y0), apply(m, x1, y0), apply(m, x0, y1), apply(m, x1, y1)]) {
      b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
    }
  };
  const walk = (node, m, layer) => {
    const own = mul(m, parseTransform(node.attrs.transform));
    const mark = /\blc-(\d+)\b/.exec(node.attrs.class ?? "");
    const here = mark ? Number(mark[1]) + 1 : layer;
    if (node.tag === "use") {
      const key = (node.attrs["xlink:href"] ?? node.attrs.href ?? "").replace(/^#MJX-\d+-TEX-/, "");
      if (!glyphs[key]) throw new Error(`typeset: unknown glyph ${key}`);
      const at = mul(own, [1, 0, 0, 1, Number(node.attrs.x ?? 0), Number(node.attrs.y ?? 0)]);
      layers[here].items.push({ g: key, m: roundM(at) });
      grow(here, at, bounds[key]);
    } else if (node.tag === "rect") {
      const r = ["x", "y", "width", "height"].map((k) => round(Number(node.attrs[k] ?? 0)));
      layers[here].items.push({ r, m: roundM(own) });
      grow(here, own, [r[0], r[1], r[0] + r[2], r[1] + r[3]]);
    } else if (node.tag === "text" || node.tag === "image") {
      throw new Error(`typeset: params.latex uses a character MathJax draws as ${node.tag}; use TeX commands for it`);
    }
    for (const child of node.children) if (child.tag !== "defs") walk(child, own, here);
  };
  walk(svg, IDENTITY, 0);
  boxes.forEach((b, i) => { if (!Number.isFinite(b[0])) throw new Error(`params.latex: mark ${i + 1} (\\${marks[i]}) is empty`); });
  return { v: TYPESET_VERSION, latex, viewBox: [vx, vy, vw, vh].map(round), glyphs, layers, boxes: boxes.map((b) => b.map(round)) };
}

/**
 * Typeset every equation scene in a story, in place: params.typeset is set
 * (or refreshed when params.latex changed). Returns the number typeset.
 * A TeX error is left for validation to report against the scene.
 */
export function typesetStory(story) {
  let count = 0;
  for (const scene of Array.isArray(story?.scenes) ? story.scenes : []) {
    const params = scene?.module === "equation" ? scene.params : null;
    if (!params || typeof params.latex !== "string") continue;
    if (params.typeset?.v === TYPESET_VERSION && params.typeset.latex === params.latex) continue;
    try { params.typeset = typesetLatex(params.latex); count++; }
    catch (error) { params.typeset = { v: TYPESET_VERSION, latex: params.latex, error: error.message }; }
  }
  return count;
}

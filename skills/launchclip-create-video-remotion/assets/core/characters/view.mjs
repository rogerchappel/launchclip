// Character drawing → renderer-neutral view tree.
//
// A drawing style returns SVG shapes with `joint` nodes for the parts that
// move ({tag: 'joint', id, pivot: {x, y, mirror}, transform, children}).
// GSAP animates transforms on SVG elements through the transform attribute
// with its own origin rules, so joints become zero-size HTML <div>s instead:
// an outer div places the pivot (and mirrors the right side), an inner div
// with the joint's id carries the CSS transform the op list animates, with
// its origin on the pivot. Both renderers then transform the same divs the
// same way (catalog-b-view.mjs transformString order). Runs of plain shapes
// become one overflow-visible <svg> each, in drawing order, so layering is
// kept: shapes before a joint draw under it, shapes after it draw over it.
// A group that holds a joint (a face, a finger) becomes a div too, keeping
// its id and opacity.
//
// Imports only sibling kit/core files.

import {abs, el, transformString} from '../catalog-b-view.mjs';

const ORIGIN = '0px 0px';
const hasJoint = node => node && typeof node === 'object' && (node.tag === 'joint' || (node.children ?? []).some(hasJoint));

function staticTransform(attr) {
  if (!attr) return null;
  const translate = /translate\((-?[\d.]+)[ ,]+(-?[\d.]+)\)/.exec(attr);
  const mirror = /scale\(-1[ ,]+1\)/.test(attr);
  if (!translate && !mirror) throw new Error(`character view: unsupported group transform ${attr}`);
  return `${translate ? `translate(${translate[1]}px, ${translate[2]}px)` : ''}${mirror ? ' scale(-1, 1)' : ''}`.trim();
}

function convertList(children) {
  const out = [];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    out.push(el('svg', null, {position: 'absolute', left: 0, top: 0, overflow: 'visible'}, run, {width: 1, height: 1}));
    run = [];
  };
  for (const child of children ?? []) {
    if (hasJoint(child)) { flush(); out.push(convert(child)); }
    else run.push(child);
  }
  flush();
  return out;
}

function convert(node) {
  if (node.tag === 'joint') {
    const {pivot} = node;
    const inner = el('div', node.id, {...abs(0, 0, 0, 0), transform: transformString(node.transform), transformOrigin: ORIGIN}, convertList(node.children));
    return el('div', null, {...abs(pivot.x, pivot.y, 0, 0), ...(pivot.mirror ? {transform: 'scale(-1, 1)', transformOrigin: ORIGIN} : {})}, [inner]);
  }
  // A group holding a joint: a div with the group's id, opacity and static transform.
  const style = {...abs(0, 0, 0, 0)};
  if (node.style?.opacity !== undefined) style.opacity = node.style.opacity;
  const transform = staticTransform(node.attrs?.transform);
  if (transform) Object.assign(style, {transform, transformOrigin: ORIGIN});
  return el('div', node.id ?? null, style, convertList(node.children));
}

/**
 * A drawn character as a view tree: a zero-size div at (x, y) in canvas px,
 * scaled by `scale` (rig units → px), holding the converted drawing.
 */
export function characterView(drawing, {id, x, y, scale}) {
  return el('div', id, {...abs(x, y, 0, 0), transform: `scale(${scale})`, transformOrigin: ORIGIN}, convertList([drawing]));
}

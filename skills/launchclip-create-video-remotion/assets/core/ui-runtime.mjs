// The ui-scene painter entry point: paintUi(host, spec, t) and UI_RUNTIME, the
// source HyperFrames inlines into the page (the helpers and core components in
// ui-paint.mjs, the rest of the component library in ui-components.mjs, the
// pixel mascot host in ui-host.mjs).
// Remotion imports paintUi and calls it from a layout effect. Contract:
// docs/KIT_CONTRACTS.md, "UI scenes".

import * as core from './ui-paint.mjs';
import * as more from './ui-components.mjs';
import * as mascot from './ui-host.mjs';
import {uiStage, uiStageView} from './ui-paint.mjs';
import {UI_COMPONENT_TABLE} from './ui-components.mjs';

/**
 * Paint spec at absolute timeline time t into host. The host covers the
 * canvas; the drawing is in design px, scaled by spec.unit.
 */
function paintUi(host, spec, t) {
  if (!host) return;
  // Font stacks go inside style="…": double quotes would end the attribute.
  const fonts = {display: String(spec.fonts.display).replace(/"/g, "'"), body: String(spec.fonts.body).replace(/"/g, "'"), mono: String(spec.fonts.mono).replace(/"/g, "'")};
  const ctx = {c: spec.theme, fonts: fonts, components: uiComponentTable(), stage: spec.stage || null, width: spec.width, height: spec.height};
  let inner = uiStage(spec.elements, t - spec.start, ctx);
  // The stage's look-down: the whole drawing turned about rotateX, top away.
  if (spec.stage && spec.stage.tilt) {
    const v = uiStageView(spec.width, spec.height);
    inner = '<div style="position:absolute;left:0;top:0;width:' + spec.width + 'px;height:' + spec.height + 'px;transform-origin:' + v.cx + 'px ' + v.cy + 'px;transform:perspective(' + v.p + 'px) rotateX(' + spec.stage.tilt + 'deg)">' + inner + '</div>';
  }
  host.innerHTML = '<div style="position:absolute;left:0;top:0;width:' + spec.width + 'px;height:' + spec.height + 'px;transform-origin:0 0;transform:scale(' + spec.unit + ');color:' + spec.theme.ink + ';font-family:' + fonts.body + '">' + inner + '</div>';
}

/** Component kind → draw function. */
function uiComponentTable() {
  return Object.assign({
    headline: uiHeadline, chip: uiChip, waveform: uiWaveform, window: uiWindow, timeline: uiTimeline, 'lock-cards': uiLockCards, host: uiHost
  }, UI_COMPONENT_TABLE());
}

const {uiHeadline, uiChip, uiWaveform, uiWindow, uiTimeline, uiLockCards} = core;
const {uiHost} = mascot;

const RUNTIME_FUNCTIONS = [...Object.values(core), ...Object.values(more).filter(fn => typeof fn === 'function'), ...Object.values(mascot), uiComponentTable, paintUi];

/** The painter's source for the page: window.lcPaintUi(host, spec, t). */
export const UI_RUNTIME = `window.lcPaintUi = window.lcPaintUi || (function () {\n${RUNTIME_FUNCTIONS.map(String).join('\n')}\nreturn paintUi;\n})();`;

/** Every component kind the painter draws. */
export const UI_KINDS = Object.freeze(Object.keys(uiComponentTable()));

export {paintUi};

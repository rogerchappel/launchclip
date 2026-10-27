// Catalogue I: rendered 3D objects driven by data (glass bars and a
// staircase line-up, coin and cylinder stacks, a rack shelf and price rail,
// a device box with a live readout, paper and book stacks and a folder, and
// a product family as planets). They join the element library: catalogue H
// registers them (kit/core/catalog-h.mjs), so both renderers draw them from
// the same view tree and op list. The 3D is CSS 3D transforms on a fixed rig
// (kit/core/catalog-i-3d-base.mjs): a perspective stage, a tilted floor and a
// turntable whose rotation is the camera orbit. Contract: docs/KIT_CONTRACTS.md
// ("Catalogue I: 3D data objects").

import {BAR_MODULES} from './catalog-i-3d-bars.mjs';
import {STACK_MODULES} from './catalog-i-3d-stacks.mjs';
import {RACK_MODULES} from './catalog-i-3d-rack.mjs';
import {DEVICE_MODULES} from './catalog-i-3d-device.mjs';
import {PAPER_MODULES} from './catalog-i-3d-paper.mjs';

export const OBJECT_MODULES = [...BAR_MODULES, ...STACK_MODULES, ...RACK_MODULES, ...DEVICE_MODULES, ...PAPER_MODULES];

// Vendored from pixelfx 0.3.1 (https://github.com/patch-gg/pixelfx, src/core/index.js), MIT License,
// Copyright (c) 2026 Patch, Copyright (c) 2026 Hugo Duprez. Licence text: ../LICENSE.
// pixelfx core: everything an effect imports comes from here.
// Modified for LaunchClip: the actor rig, scenes, acts and createFx are not vendored.

export * from "./math.js";
export * from "./color.js";
export * from "./particles.js";
export * from "./shapes.js";
export { Particles, Bits, Lights, Blazes, P, PF, B, GRAVITY, FIRE_RAMP, SMOKE_RAMP, sparkle, flare, band, crystal } from "./sim.js";
export { Painter } from "./painter.js";
export { FONTS, textWidth } from "./font.js";
export { createFrame, clearFrame, composite, painterFor, resolveOptions } from "./fx.js";

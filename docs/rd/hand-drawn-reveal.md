# Hand-drawn reveal (R&D)

Roadmap: "A hand-drawn reveal look" in [ROADMAP.md](../ROADMAP.md). This note is the design for the first slice and what it leaves for later.

## The idea

An illustration scene is drawn the way a person draws it: a pen puts down the ink outline stroke by stroke, then colours it in, instead of the picture wiping on in one sweep.

## Why it can be renderer-neutral

Every illustration LaunchClip draws is already vector: the editorial objects (`illustration-objects.mjs`), the world-kit props (`worlds/props.mjs`) and the icons are view-tree nodes of SVG shapes. So there is no raster to trace. The reveal reads the shapes from the tree and works out the strokes in JS (`path-geometry.mjs` flattens paths, rects, circles and arcs to points). The ink is drawn with the dash draw-on both renderers already share (`strokePath` and `drawOps`). The colour is the original art under an inset clip (the `clip*` ops). The pen is a div moved by per-frame `set` ops, computed from the same points as the dash. Nothing new is needed in either renderer.

## First slice: the `hand-drawn` module (catalogue I)

- **Subject, and an optional second object:** the same closed vocabulary as `illustration` (a drawn object, a world-kit prop, or an icon at hero scale), on a paper plate.
- **Object by object:** the subject is inked and coloured before the second one starts.
- **Outline, then the inside:** each object's largest closed shape (its silhouette) goes down first. Every next stroke is the one whose start lies nearest to ink already on the page, so inner lines grow out of drawn ones rather than starting in empty space. Shapes that are only a soft shadow (translucent fills) get no ink.
- **Colour after ink:** the finished art is revealed top to bottom under an inset clip while the pen zigzags across it at the clip's edge, the way a marker fills a shape. When the colour is down, the ink stays on top, so the finish reads as inked and coloured.
- **A stroke budget from the scene's time:** the ink gets a share of the scene's time, and strokes are timed by length. If the object has more strokes than the pen can draw at a believable rate (6 a second), the shortest are left to arrive with the colour instead of being sped up.
- **The pen:** marker, pencil, brush or fountain pen (`sketch-pens.mjs`), or none. It lifts and travels between strokes. Optional text on the barrel (a brand or sponsor name), in every frame the pen is in.

## Left for later

- A light under-sketch rubbed out once the ink is down.
- Ink whose weight follows pen pressure, which needs variable-width strokes (a filled outline per stroke rather than a dashed line).
- Splitting one object into named parts (head, body, props) so colour goes part by part, and marker colour in light-to-dark passes.
- A drawn hand holding the pen.
- Words written on in stroke order as the narration says them.
- Timing each object to the narration line that names it, across scenes.
- Drawing a supplied raster illustration (needs line extraction and is a separate piece of work).

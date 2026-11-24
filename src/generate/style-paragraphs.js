// One locked drawing paragraph per drawing style (kit/core/characters/styles.mjs
// DRAWING_STYLES), pasted word for word into every story brief of a story in
// that style (docs/GENERATED_FOOTAGE_RFC.md §4.1 "The drawing is locked"):
//
//   drawing   the figures: line, palette, light and what they never do (keyframes)
//   place     the place drawn the same way (keyframes and plates; a plate has
//             nobody in it, so it never gets the figure sentences)
//   anatomy   for styles whose figures are lines (stick, rubber-hose): said in
//             the keyframe prompt as constraints, for models that ignore the negative
//   negative  added to the keyframe's negative for that style only
//   motion    the anatomy line the video prompt repeats
//
// The stick anatomy sentences marked "after the stickman director skill", and
// some phrases of the rubber-hose paragraphs (the pen outline before the
// paint, the neutral white face with no yellow tint, the even light and the
// never list), are adapted from the MIT-licensed "directing-stickman-videos"
// skill (references/a1-prompt-structure.md, assets/a7/approved-prompt-lock.json);
// provenance in the RFC.
//
// Change a paragraph only on purpose: it is hashed into every brief_hash, so
// an edit makes every generated shot in that style a new brief.

const STICK_ANATOMY = [
  // After the stickman director skill (A1 constraints), "the right arm" generalised.
  "Exactly two arms and two legs are visible per figure. Each limb appears only in its current pose: raising or lowering an arm replaces that arm's previous line, never leaving a resting arm beneath an active arm.",
  // After the stickman director skill (A7 character block), verbatim.
  "All joints visibly connected; head size and line width remain constant during bending.",
  "Background remains visible immediately beside both edges of the narrow spine, even between the shoulders."
].join(" ");
const STICK_NEGATIVE = "extra arms, extra legs, duplicate limbs, ghost limbs, a resting arm left under a raised arm, disconnected or floating limbs, a filled torso, a rounded or solid body, a thick or tapering spine, 3D shading, ambient occlusion, a yellow face";
const STICK_MOTION = "Throughout: exactly two arms and two legs, every joint connected, the spine one thin line; a moving limb replaces its old position, never leaves a copy.";
const FLAT_PLACE = "The place: clean outlines and flat colour areas, a few simple shapes for depth, quiet behind the figures; no 3D, photoreal or textured surfaces.";

export const STYLE_PARAGRAPHS = Object.freeze({
  flat: {
    drawing: "Drawing: a flat 2D cartoon. Every shape is one flat fill inside one dark outline of even weight; faces are friendly and simple. Palette: the characters' own colours as flat fills. Light: soft and even, at most one flat shadow shape under each figure. Never: gradients, texture, painterly brushwork, 3D or photoreal surfaces.",
    place: "The place: the same flat fills inside even dark outlines, a few flat colour areas for depth; no gradients, texture, 3D or photoreal surfaces."
  },
  line: {
    drawing: "Drawing: single-weight line art in one ink colour. Fills are paper white; only dark hair and dark clothes are inked in solid. Palette: ink on paper. Light: none drawn, no shading and no highlights. Never: colour fills on the characters, gradients, a line that thickens or thins, 3D or photoreal surfaces.",
    place: "The place: the same single-weight ink line on paper, in pale flat washes at most; no shading, gradients, 3D or photoreal surfaces."
  },
  outlined: {
    drawing: "Drawing: comic ink. A heavy, confident outline round every shape and one hard-edged cel shadow on the side away from the key light. Palette: the characters' own colours as flat fills, each shadow one darker flat step of its colour. Light: one key light, read only from where the hard shadows fall. Never: soft gradients, airbrushing, 3D or photoreal surfaces.",
    place: "The place: the same heavy ink outlines and flat fills with hard cel shadows away from the key light; no soft gradients, airbrushing, 3D or photoreal surfaces."
  },
  paper: {
    drawing: "Drawing: cut paper. Every shape is a hand-cut piece of coloured paper with slightly uneven edges and a fine paper grain, each layer casting a small offset shadow on the one below; no outlines. Palette: matte paper colours. Light: soft and even, read only through the offset shadows. Never: drawn outlines, gloss, 3D or photoreal surfaces.",
    place: "The place: layers of hand-cut matte paper with a fine grain and small offset shadows; no drawn outlines, gloss, 3D or photoreal surfaces."
  },
  "soft-shade": {
    drawing: "Drawing: soft vector shading. Shapes have no hard outline and are shaded by smooth gradients from the lit side to the shade. Palette: the characters' own colours, each running from a light tint to a deeper shade. Light: one soft key light, every gradient agreeing with its direction. Never: heavy outlines, hard cel shadows, photoreal texture.",
    place: "The place: smooth vector shapes with no hard outline, softly shaded toward the key light; no hard cel shadows or photoreal texture."
  },
  stick: {
    drawing: "Drawing: a stick figure. A round head with the character's own hair and face; the neck, spine, arms and legs are each one line of even width, coloured by the clothes over it and edged in dark ink; hands are small round dots and feet short strokes. Palette: the characters' line colours; the face keeps the skin colour of the reference sheets. Light: flat and even, no shading on the figure. Never: a filled or rounded torso, thick or tapering limbs, a realistic body, 3D shading.",
    place: FLAT_PLACE,
    anatomy: STICK_ANATOMY,
    negative: STICK_NEGATIVE,
    motion: STICK_MOTION
  },
  "stick-classic": {
    drawing: "Drawing: a classic black-and-white stick figure. A white round head with the character's hair and face in line art; the neck, spine, arms and legs are each one black ink line of even width. Palette: black ink on white for the figure. Light: flat and even, no shading on the figure. Never: colour on the figure, a filled or rounded torso, thick or tapering limbs, 3D shading.",
    place: FLAT_PLACE,
    anatomy: `${STICK_ANATOMY} The face is flat paper white with no yellow tint.`,
    negative: STICK_NEGATIVE,
    motion: STICK_MOTION
  },
  "rubber-hose": {
    drawing: "Drawing: a 1930s rubber-hose cartoon, hand inked. Arms and legs are bendy tubes of one even width with no elbows or knees, drawn in one confident black ink line; hands are white gloves, feet rounded shoes. Palette: a subdued period palette; the face and gloves are flat clean neutral white with no yellow tint. Light: uniform and diffuse. Never: CGI, 3D renders, smooth bevels, plastic or photoreal material, airbrushed gradients.",
    place: "The place: every object defined first by a visible black pen outline, coloured inside with flat matte paint in a few broad tone areas; uniform diffuse light with no lit pools, glints or bloom; no CGI, 3D renders or airbrushed gradients.",
    anatomy: "Exactly two arms and two legs are visible per figure, each one unbroken tube that bends in a smooth curve, never a sharp joint. A moving limb replaces its old position, never leaving a copy behind. Every limb stays attached to the body; the line width stays constant while it bends.",
    negative: "extra arms, extra legs, duplicate limbs, ghost limbs, elbows or knees, disconnected limbs, a yellow face, 3D shading, ambient occlusion, smooth bevels, plastic, airbrushed gradients",
    motion: "Throughout: exactly two arms and two legs, each a connected tube that bends in curves; a moving limb never leaves a copy."
  },
  lifelike: {
    drawing: "Drawing: lifelike illustration. Realistic proportions, layered shading and detailed faces, hair and hands. Palette: natural colours, the characters' own as the reference sheets show them. Light: the scene's key light, with soft shadows that agree with it. Never: cartoon outlines, flat fills, exaggerated proportions.",
    place: "The place: painted with the same layered, lifelike shading under the scene's key light; no cartoon outlines or flat fills."
  },
  cinematic: {
    drawing: "Drawing: cinematic illustration. Lifelike figures with a rim light, a cast shadow and falloff from the scene's key light. Palette: the characters' own colours under a filmic grade. Light: one strong key light with a rim on the far side and shadows that fall away from it. Never: flat even light, cartoon outlines, exaggerated proportions.",
    place: "The place: lifelike and filmically graded, lit by one strong key light with falloff into shadow; no flat even light or cartoon outlines."
  },
  avatar: {
    drawing: "Drawing: cute avatar proportions. A big head on a short, chunky body, soft shading and visible pin joints. Palette: the characters' own colours, softly shaded. Light: soft and even from the key light. Never: realistic proportions, hard outlines, photoreal surfaces.",
    place: "The place: simple rounded shapes, softly shaded under even light; no hard outlines or photoreal surfaces."
  },
  chibi: {
    drawing: "Drawing: the cute chibi family. A very big round head with large glossy eyes on a small soft body, flat fills and one even heavy outline. Palette: the characters' own colours as flat fills. Light: soft and even, a single gloss highlight in each eye. Never: realistic proportions, gradients on the body, thin or varying outlines, 3D or photoreal surfaces.",
    place: "The place: rounded shapes in flat fills inside one even heavy outline, soft even light; no gradients, 3D or photoreal surfaces."
  },
  "chibi-plain": {
    drawing: "Drawing: the cute chibi family as neutral figures. A very big round head on a small soft body, all in paper white with no skin tone, told apart only by hair and clothes; one even heavy outline. Palette: paper white figures, hair and clothes in their own colours. Light: soft and even. Never: skin tones, realistic proportions, gradients, 3D or photoreal surfaces.",
    place: "The place: rounded shapes in flat fills inside one even heavy outline, soft even light; no gradients, 3D or photoreal surfaces."
  }
});

/** A style's locked paragraphs, or a bare sentence for a style with none yet (a new style not given one). */
export const styleParagraph = (style) => (style ? STYLE_PARAGRAPHS[style] ?? { drawing: `Drawing: the ${style} style.`, place: `The place: drawn in the ${style} style.` } : null);

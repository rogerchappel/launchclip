# Explainers that show the claim: implementation plan

Status: draft for discussion. Roadmap entry: "Explainers that show the claim, not just say it" ([ROADMAP.md](ROADMAP.md)).

## 1. Summary

A review of a real comparison short gave us these rules. The short covered three decking materials, ended on a deciding question and a call to action, and was cut from customer footage. Its footage and ending worked. Its middle went flat:

- pale panels under the footage;
- a small boxed photo on a ring gradient;
- "Dollars / Weekends" as two words on a washed-out shot;
- still holds;
- points that named a category ("cheapest", "no oiling") rather than a fact.

The finish gates caught most of it (flat surface, motion, hook pace), but nothing in the plan prevented it and nothing repaired it.

This plan turns the eight roadmap rules into planner contracts, checks and repairs. Every rule is written for any business. The examples use the decking short only because it is the case we measured.

**The principle is the one [VIDEO_QUALITY_RFC.md](VIDEO_QUALITY_RFC.md) §4 already follows: plan it, check the plan, verify the render.** A rule that is only a prompt line gets ignored under pressure. Each rule here gets three things:
- a field the planner must fill;
- a deterministic check on the plan;
- where pixels matter, a gate on the render.

## 2. What already exists

This work builds on what is already in the code:

| Need | Already there | File |
|---|---|---|
| Lint the script before planning | `checkScript`, including `options-unexplained`, `hook-payoff` and `fact-trace` | `src/script_check.js` |
| One visual decision per line | The direction map (`DIRECTION.json`), with an intent and treatment for each line | `kit/core/direction.mjs`, VIDEO_QUALITY_RFC §6 |
| Phrase → module routing | `INTENT_RULES` / `VISUAL_INTENTS` (e.g. `number-line`, `grid-race`) | `kit/core/planning-prompt.mjs` |
| Element rects over time | The layout check, which reads declared rects and timing (renderer-neutral) | `src/layout_check.js` |
| Flat-surface share, sparse runs, sparse ending | `visualDensity` / `visualDensityGate` | `src/visual_density.js` |
| Drawn members in the brand palette | `graphic` (card, chip, badge, ribbon, prop) | `kit/core/graphic.mjs` |
| Motion findings with a named fix per span | The motion gates (still spans, zoom-kick and drift advice) | `src/quality_gates.js` |
| Planner repair loop | Plan errors fed back as repair notes (`visualDensityErrors` is the model) | `src/make/` |

## 3. Phase 1: the three rules that fix the flat middle

These three come first: one concrete fact per point (rule 1), an illustration of the line when no shot fits (rule 5), and one idea per frame (rule 6). Together they fix the weakest part of the reviewed video, and they help every customer, with footage or without. Each lands as its own PR.

### 3.1 One concrete fact per point (rule 1)

**Contract.** The script pass already sees option lists (`options-unexplained`). It now also returns `points` beside the narration:

```json
{ "points": [
  { "item": "treated pine", "fact": "chair legs dent it", "kind": "consequence", "words": "but chair legs dent it" },
  { "item": "hardwood", "fact": "the sun greys it in a summer", "kind": "consequence", "words": "skip the oil and the sun greys it" },
  { "item": "composite", "fact": "hot underfoot", "kind": "consequence", "words": "hot underfoot" }
] }
```

`kind` is one of `number`, `object` or `consequence`. A number is still traced to the brief by `fact-trace`, as today.

**Check (`point-fact` in `checkScript`):**
- **Error:** for each item in a list of two or more, `fact.words` must appear in the narration (found by the same loose match `locked_copy` uses).
- **Warning:** when the fact is only a category word. The list of category words is a small data table (`cheapest`, `best`, `easy`, `low maintenance`, `premium`, `durable`, `affordable`, `quality`, and others), and it can grow.

The check stays deterministic, because the model declares the fact and the check verifies it rather than judging what is "picturable".

**Planner hook:** a point's `fact` becomes the subject of that line in the direction map. Rule 5 draws it when no shot shows it.

**Tests:**
- A comparison script whose points have facts passes.
- One where an item is only "the cheapest option" warns.
- One whose declared fact never appears in the narration errors.
- A script with no list is unaffected.

### 3.2 An illustration of the line when no shot fits (rule 5)

**Contract.** A direction-map line gets a `subject` (the fact, object or consequence it shows), plus a resolution order when no shot fits:

1. **Footage that shows the subject**, chosen by the asset descriptions. Unchanged.
2. **Footage that is near enough, plus an annotation.** This is phase 2 (rule 4). Until then it is skipped.
3. **An illustration of the subject:** a scene drawn from a new `illustration` module, on a full-bleed plate.
4. **A typographic scene:** full-bleed type at hero size. This is the last resort.

These fallbacks stop counting as fallbacks: a flat brand panel, a small boxed photo (`object-card` or a `photo-scene` under 50% of the frame on a plain plate), and a gradient-only plate. A plan that uses one for a line with a subject gets a plan error, fed to the repair loop like `visualDensityErrors`.

**The `illustration` module.** This is the biggest piece of work. Like `graphic`, it is a closed vocabulary rather than free drawing:
- **Composition:** a subject object, an optional second object, and one change over time. The change is one of `wear` (greys, fades, cracks), `measure` (a value rising on a gauge or thermometer), `count` (a calendar or tally filling), `compare` (two objects side by side), `cause` (a force such as sun, a foot or rain acting on the object), or `before-after`.
- **Objects:** they come from the world-kit props and the icon set, drawn in the style's palette and line weight (the same painter `graphic` uses). An object the kit lacks falls back to its icon at hero scale, never to a placeholder.
- **Plate:** full-bleed, either a material texture (wood grain, stone, fabric, paper or metal from the backdrop plates) or the style's plate. Never a flat panel.
- **Motion:** the change is the motion. The camera drifts through the hold, and the change lands on the stressed word of the line.
- **Both renderers** draw it from one core model (`kit/core/illustration.mjs`), as editorial-core does, with parity fixtures.

Examples beyond decking show how general it is:
- a clinic's "recovery in two weeks" becomes `count` on a calendar;
- a SaaS's "reports take an hour" becomes `measure` on a clock;
- a café's "beans roasted Monday" becomes `cause` with heat on beans.

**Routing.** `INTENT_RULES` gains entries that route `consequence` and `object` points to `illustration` when the inventory has no matching shot, so the headless and skill paths classify alike. `subject_paths.test.js` is the model for the parity test.

**Tests:**
- Validator: closed vocabulary errors; an unknown object falls back to its icon.
- Model geometry: the subject fills 50–80% of the safe area.
- Parity: one fixture per change kind.
- Planner: a line with a subject and no shot resolves to `illustration`, and a boxed-photo fallback is a plan error.
- Density: an illustration counts as filled, through the layout check's media and hero rects.

### 3.3 One idea per frame (rule 6)

**Check (`text-blocks` in the layout check).** At each sample, count the text blocks on screen, excluding the caption band and decor. A block is a text element's rect after merging rects that belong to one module element. A title with its own sub-line is one block. Bullets in one list are one block.

- **Warning:** more than one block for over 1 s, outside planned exceptions.
- **Error** (fed to the repair loop): three or more blocks at once.
- **Exceptions:** a module whose job is text, such as `comparison-table`, a list module, `item-list` or a `cta`, counts as one block. A scene can opt out with `allow_text: 2` and a `why`, in the same way the direction map asks `face` for a `why`.

**Planner side:** the prompt states the rule, and when the caption already says the words, the repair note suggests cutting the scene's sub-line or bullets instead of shrinking them.

**Render side:** none needed. Rects are declared, so the plan and the render get the same verdict, as the density gate does.

**Tests:** a title plus caption passes; a title, sub, two bullets and a caption errors; a `comparison-table` counts once; `allow_text` with a `why` passes.

## 4. Phase 2: footage and the payoff

These follow phase 1 and reuse its contracts.

- **Annotate the footage itself (rule 4).** A new `annotate` op on a footage scene draws a circle, arrow, measure or label at a point in the shot.
  - The point is given in normalised frame coordinates at a time, and is held on the object through the camera's move. A fixed point in a moving shot is the honest first version; tracked points come later and reuse the subject-tracking used for face reframing.
  - It becomes step 2 of the §3.2 resolution order.
  - Gate: an annotation must overlap the scene's declared subject rect.
- **The payoff is the richest moment (rule 3).**
  - The direction map marks one section `payoff`.
  - The plan check requires its scene to be a data, illustration or side-by-side module, never type alone on a wash.
  - The render check requires its measured density and motion to be at or above the video's median.
  - Pacing: the scene lengths before the payoff must not grow.
- **Footage stays the main thing under type (rule 7).**
  - A scrim may darken or tint, but a scrim that raises the footage's mean luminance by more than a set amount, or drops its local contrast below a floor, is a gate finding. The gate samples the rendered frame inside the plate's rect.
  - Type on footage takes a local scrim or a calm position. The caption band fix (#724) already holds a band through a run.

## 5. Phase 3: the hook and the repairs

- **A hook that proves its claim (rule 2).** It extends `hook-payoff` and the measured hook in [PLAN_AND_PACE_RFC.md](PLAN_AND_PACE_RFC.md):
  - The script's first line must carry a `point`-style fact, for example the loss, the bill, or the before and after.
  - The direction map's `hook` line must name a subject that a shot or an illustration shows inside the first 3 s.
- **Repairs that apply the motion findings (rule 8).** The motion gates already name each still span and the move that fixes it (a drift through a hold, a camera kick on a stressed word). A repair pass:
  - maps each finding to a story edit: `camera.kicks` at the stressed word, or a drift on the scene's camera;
  - applies the edit and re-renders only the changed scenes;
  - re-checks, with at most two rounds.

  This is the "repair pass that fixes a finding by itself" already on the motion-check roadmap item, starting with the two fixes the gates name most.

## 6. Rollout and measurement

- **Order:** one PR each for 3.1, 3.3 and 3.2, in that order. The two checks are small and land first, so their warnings can be watched on real runs before they become errors. Then the illustration module (the large one), then phases 2 and 3.
- **Warnings before errors:** each new check ships as a warning for one release and records how often it fires on the golden samples and on real runs. It becomes an error once the planner meets it in most runs.
- **Success measure:** on a fixed set of footage-led and no-footage comparison prompts (decking, a clinic, a SaaS plan comparison, a café), we compare four numbers before and after:
  - the flat-surface share;
  - the text blocks per frame;
  - the share of points with a fact;
  - the critic's score.

  The reviewed short is in the set: 36% flat surface, with the "Lowest upfront cost" panel and the composite card as the cases to beat.

## 7. Open questions

1. Should `points` live in the script pass's output, as proposed, or in the direction map? The script pass sees the list first, but the map is where visuals are decided.
2. How large should the `illustration` object vocabulary be at launch? The proposal is the world-kit props plus icons at hero scale, and specific objects added as real prompts need them.
3. Should `text-blocks` count a persistent position device (a "2 of 3" counter, the progress bar on the roadmap) as a block? The proposal is no: it is decor, like the caption band.
4. For annotation, is a fixed point acceptable in a first version, given that most supplied footage here is slow, handheld or drone footage?

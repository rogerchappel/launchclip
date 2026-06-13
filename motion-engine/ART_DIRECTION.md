# Art Direction — motion-engine (v2, evidence-based)

Rewritten after frame-by-frame deconstruction of the two reference shorts (Greg Isenberg: "How to use Obsidian with Claude in 61 seconds" and the lead-gen agents short — local copies + contact sheets in `reference/`). v1 of this document was written from description and got the fundamentals wrong. Everything below is observed, not assumed.

## 0. What v1 got wrong (kept as a warning)

- **Wrong ground.** v1 specced near-black. The reference is a warm off-white paper ground (~#ECE8E1) with a faint drawn grid, on screen ~90% of the time. Dark exists only as *cards sitting on* the light ground.
- **Wrong text system.** v1 specced bottom-bar uppercase stroke captions (Hormozi style). The reference has NO bottom captions anywhere. Typography is staged *in the middle of the frame as the scene itself* — word groups building in place as they're spoken.
- **Wrong rhythm mechanism.** v1 specced hard cuts every 2–5s. Measured: only ~15 hard cuts in 61s (≈1 per 4s). The relentless motion comes from **continuous builds and transforms inside scenes** — something enters, multiplies, stacks, or morphs almost every second, but the scene itself persists.
- **Wrong assumption about the face.** The Obsidian video contains *no talking head at all*. The second video weaves the face in as one card among many. The face is optional garnish, not the foundation — which is excellent news for SaaS brands without a face.

## 1. The world model: everything is a physical object on paper

The video is a tabletop. The ground is warm paper with a faint grid; every piece of content — screenshot, prompt bar, app icon, diagram node, even the talking head — is a **rounded physical card with a soft, large drop shadow**, placed, stacked, fanned, and slid around on that paper. Nothing is ever a naked flat layer.

- Ground: ~#ECE8E1 warm gray-beige, faint grid lines (~6% opacity ink), subtle paper grain. Slight vignette acceptability; never pure white.
- Ink: near-black charcoal #1A1A18.
- Cards: white or near-black (#111), radius ~24–32px at 720w, shadow `0 18-30px 40-70px rgba(0,0,0,0.18-0.30)` — soft and believable, like the card hovers 2cm above the paper.
- Brand/semantic accents *replace* a fixed accent color: mint green (#62BD93-ish) for highlights/success, plus each referenced brand's own color (Obsidian purple, Claude coral) used on its name in type and its icon card. Color belongs to meaning, not to decoration.

## 2. Typography IS the captioning system

Spoken phrases appear as staged type compositions, center-frame, words/word-groups landing as spoken, then the whole composition leaves and the next phrase stages elsewhere.

- Two voices: a **chunky soft serif** for statements (reference resembles Cooper Black / Recoleta; closest Google Fonts: Fraunces Black) and a **swashy italic/script accent** for the emotional word (reference resembles Cooper Black Italic; Fraunces Black Italic works).
- Compositions are collaged: staggered baselines, mixed sizes within one phrase, ±2–4° rotation on individual words, the key word 1.5–2× larger and in its semantic color.
- Scale: phrase blocks occupy roughly the middle third; biggest word ~7–9% of height, support words 3–4%.
- Dark ink on paper. On dark cards, type is white or mint.
- Never more than ~7 words on screen in a type scene; the phrase builds word-group by word-group on the VO timing.

## 3. Scene vocabulary (v2)

| type | what it is | replaces/maps to |
|---|---|---|
| `typography` | staged word-build composition on paper | the caption track (primary connective tissue) |
| `prompt_card` | dark rounded chat-input card, text typing on, mic/plus glyphs, soft glow | console (for AI tools, the prompt IS the console) |
| `screenshot_pile` | real screenshots in cards: enter one → multiply into fans/grids/stacks | screen scene, evidence beats |
| `icon_flow` | brand-icon cards (black rounded squares with glyph) connected by dotted lines, building vertically | flow |
| `card_steps` | small rounded cards with icon + short label stacking into lists/funnels | steps |
| `talking_head` | real footage, either full-frame beat or a rounded card inserted beside content | talking_head (now optional) |
| `prop` | bespoke illustrated objects (magnifying glass over a screenshot, retro computer, character) | none — the artisanal tier, added per-video |

Content honesty unchanged: screenshots and footage are real; prompt text is the real prompt; diagrams are proudly graphic.

## 4. Motion grammar: builds, not cuts

- Hard cuts are rare (~1 per 4s) and reserved for chapter turns. Within a scene, **something must change every ~1s**: a card lands, a screenshot duplicates, a word arrives, a connector draws, the pile fans wider.
- Entrances are springy and physical: cards drop/slide in with overshoot and a shadow that grows as they "land." Same spring configs as v1 (damping 11–14, stiffness 220–260 in; 16–18/130–180 out).
- Multiplication is a signature move: one card → three → a 3×3 grid fan, each copy offset and slightly rotated, arriving in rapid stagger (~80–120ms apart).
- The camera drifts and punches gently over the tabletop (our punch_zoom survives), but the table does the work, not the lens.
- 2.5D: cards tilt a few degrees and carry believable shadows. v1's §3D rules survive with the same restraint caps.
- The connective tissue between scenes is often a shared element that persists and transforms (the icon card travels; the prompt bar shrinks into a corner) — when in doubt, morph the anchor rather than cutting.

## 4b. Tactility and the camera (second frame-pass, confirmed)

A 12fps strip study of transitions and the long cut-free stretches confirms the canvas is *travelled*, not cut between:

- **The canvas is continuous.** Video 2 runs 18 seconds (8.7s→26.5s) without a single hard cut: the screenshot wall slides left to reveal the next composition, feeds scroll vertically, the funnel stack shifts up as new chips land. Transitions are **swipes and zooms across one big tabletop**; hard cuts are chapter breaks only.
- **Real motion blur during travel.** Mid-transition frames show the *entire moving region* streaked — including the talking-head footage while it slides into place. Blur is transition-scoped: heavy during travel, perfectly crisp at rest.
- **Zoom-from-depth entrances.** Icon cards arrive by scaling from near-zero at a distant anchor toward final size — reads as flying in from depth. Pair with blur while small/fast.
- **Pseudo-3D chips.** The funnel/step cards have drawn thickness (darker bottom edge, like extruded plastic chips) plus the soft drop shadow. Flat cards are for screenshots; chips are for diagram nodes.
- **Talking head splits the frame.** The dominant face layout is **bottom ~50–55% of frame, graphics unfolding on the paper above**. Second layout: face in a shadowed rounded card (~50% width) beside typography. Full-bleed face appears only at the hook. The graphics are the protagonist; the face is the narrator.
- **Word-cadence is absolute.** "There" → "are" land as separate frames; "output" *gains its green script styling on the beat it's spoken*; funnel chips land one per beat. Nothing pre-exists its word.

## 4c. Third reference pass (OpenClaw video) — structure and character

- **Persistent chapter rail.** A thin progress rail across the top ("Intro · Docs · Setup · Split · Skills · Access" with numbered dots) lives through the ENTIRE video — a table of contents that tracks where the viewer is. Strong retention device; needs a `chapter_rail` component fed by the timeline's chapter names.
- **The brand mascot is the protagonist.** The OpenClaw red creature is a per-brand animated character: it appears inside an illustrated retro monitor, leaps out with extreme squash-and-stretch, holds props, reacts to errors. This is the artisanal tier upgraded to a *character system* — provided brand asset + a set of canned character moves.
- **Typography lands ON footage.** Words overlay the talking head directly (white/mint serif on the video), building per word — the face does not pause for type.
- **Chapter numerals**: oversized black circled "1 / 2 / 3" beats mark sections alongside the rail.
- **Chat-UI mockup cards** (Telegram-style bubbles) recreate real conversations as a scene type.
- **The grid fades radially** — visible in the center of the frame, dissolving to clean paper at the edges.
- **Density rule confirmed harder**: something is mid-animation in virtually every 1s frame sample. Stillness simply does not occur.

## 4d. Fluidity pass (fourth watch-through — the next level)

Compared against our own exports, three gaps define Phase 3 motion work:

1. **Fluid, not bouncy.** Reference springs glide with barely-visible overshoot
   (~2-3%); ours popped. Entrance springs are now damping 17 / stiffness 175 —
   tune by eye from here, never back toward bounce.
2. **Elements make room for each other.** New components don't just land —
   existing ones SLIDE up/down/sideways with acceleration/deceleration to open
   space, like a living layout being scrolled. BUILT (`reflow.js`): a
   presence-weighted stack solver — each item's slot grows with its entrance
   spring, so neighbours glide to their new positions on the same curve.
   Drives `card_steps` and `icon_flow`; typography instead stages its collage
   once and words pop into reserved slots (the reference type compositions
   are pre-designed, they don't shove each other).
3. **Micro-motion on focal objects.** Reference text inputs zoom in slowly,
   pan right-to-left, and wear an ANIMATED glowing border (a gradient sweep
   travelling the card edge). BUILT: `focalDrift` (slow eased push-in +
   right-to-left pan) on prompt/screen scenes, gentler on stat/quote cards;
   `GlowBorder` (conic sweep hugging the radius + blurred trail) on the
   prompt card. Focal cards are never statically framed.

OSS verdicts (both MIT, copy-in philosophy):
- remotion-ui ("shadcn for Remotion"): inspected for the reflow engine — its
  Stagger/Stack are fixed-delay entrance helpers, not a re-solving layout, so
  the reflow was built in-house instead. Still worth lifting from for the
  70+ icons/shapes (extends our 12) and LowerThird/StatBlock patterns.
- remotion-bits: particle systems, gradient transitions, animated text
  effects, charts (explainer diagrams) — still on the lift list.
- remotion-kit: skip — unlicensed, early dev, duplicates what we have.

## 4e. Client feedback pass (first production review, 2026-06-13) — all BUILT

Roger reviewed our output against the reference (frame study in
`reference/feedback-pass/`, key frame: the 34s composer close-up). Verdicts,
each now in the renderer:

1. **The composer glow was too shy.** Reference reads as a light source
   hugging the card: ~half the perimeter lit, bright mint core (near-white at
   the hot spot), wide bloom falling onto the paper. GlowBorder now sweeps a
   210° band with a #E4FFF2 core and a 3× bloom.
2. **The composer is a real input.** Pill starts MINIMIZED (icon row only:
   +, brand icon chips, mic, up-arrow send) and springs open line by line as
   the prompt types; the arrow presses when typing completes. `prompt_card`
   gained `icons?: [paths]` (max 3, manifest assets only).
3. **Shadows have a light source.** Top-left light → every shadow falls
   bottom-right and stays sharp (tight contact edge + moderate throw — a
   print shadow, not a soft hover). Staged type carries a hard offset
   print shadow too (`TYPE_SHADOW`).
4. **The frame is a lens.** Outer edges fall off into progressive gaussian
   blur (three masked backdrop-filter rings); anything travelling into the
   edge zone blurs with it. Focus belongs to the middle of the table.
5. **Travels and the boundary whoosh are retired.** Every scene change is a
   silent hard cut; the next composition's builds start immediately; text
   scenes just leave — no zoom-out/fade. Motion lives INSIDE scenes
   (entrances, reflow, drift, builds), not between them. The lint
   travel-share rule died with it; `transition` is legacy, ignored.
6. **Punch closer.** Reference punches in until the focal card crops at the
   frame (the 34s composer fills the width). punch_zoom guidance now
   1.15–1.25 on focal cards; the composer's own drift is 10% push + 3% pan
   while it types.

Spotted in the same study, banked for later: the pill morphs height
mid-scene as content grows (built for prompt_card; generalise?); a dark
circular "hub" scene with label chips popping in around it; feed-row stacks
where new rows slide in from the bottom edge.

## 4f. Second-reference teardown (srIaywtgV40) — the immersion gap

A denser, more advanced reference (sales-funnel explainer; frames in
`reference/feedback-pass-2/`). Same paper-world DNA, several tiers deeper.
What it taught us, by status:

**Shipped in the P4 quick-win + perspective passes:**
- **3D tabletop.** The whole world sits on ONE plane tilted back a few degrees
  (grid lines visibly converge). Cards higher on the table recede; shadows
  fall onto the angled surface. Built as a perspective+rotateX/Y wrapper in
  `MotionLayer` (`WORLD`); the lens and chapter rail stay screen-aligned. This
  was the single biggest "feel" gap and lifts every scene at once.
- **Glow = a travelling rim**, not a halo: a tight ~110° bright arc catching
  one edge (reference t23/t36), not a wide diffuse bloom.
- **Shadows** crisper/darker/tighter, hard bottom-right (t48).
- **Composer**: white circular ↵ send, paperclip; accent words snap to colour
  on the beat.

**Banked for the vocabulary pass (Stage 3) — what ours still lacks:**
- **Funnel layout**: trapezoidal step cards tapering into a funnel (t17/t20),
  numbered, each with a content-specific icon in a circular badge, a centre
  dotted spine, one card green (success) and a red branch on a curved dotted
  loop-back path. Plus a straight-stack variant with a green "output" card
  (t31).
- **Profile/person cards**: avatar + name + role pill (t13), sliding in and
  cascading; real screenshot cards tilted in depth.
- **Grid-multiply → total**: one card multiplies into a 4×4 grid, then a sum
  card lands ("Total… $6,000", t43). Price chips ($300/mo) as pills.
- **Magnifier prop**: a glass lens with chromatic fringing and prism text,
  gliding over a screenshot (t4.5).
- **Long-content card** with a bottom fade gradient gated by a price/lock
  (t39); a persistent anchor (the composer) that morphs across scenes; a
  camera pull-back that reveals two elements at once; brand mascot character.

## 5. Sound

(Largely as v1 — the reference confirms it.) Whoosh/pop on entrances, typing tick under prompt cards, ding on reveals; everything ducked under continuous VO. Music bed low. SFX variants rotate so repeats don't machine-gun.

## 6. The talking head, when there is one

- Full-frame face for the hook and big opinions (video 2's pattern), warm real environment, no chrome.
- Elsewhere the face rides in a rounded card (~28–35% width) parked beside the content it's reacting to.
- A video can have zero face (video 1) and still hit the grade — the SaaS path.

## 7. Pacing template (reference-measured, ~60s)

| beat | scenes |
|---|---|
| 0–4s hook | prop/illustrated moment or face full-frame; the brand objects introduced as characters |
| 4–10s problem | screenshot_pile multiplying (the overwhelm visualized) |
| 10–13s thesis | typography ("There are 3 levels to this.") |
| 13–25s level 1 | icon_flow connecting the tools, then prompt_card typing the first real prompt |
| 25–40s level 2 | screenshot_pile of results + typography interleaved, face insert if available |
| 40–52s level 3 | card_steps building the workflow/funnel |
| 52–60s payoff | typography with the emotional line, brand icons resting, CTA |

## 8. What disqualifies a render (v2)

- A dark full-bleed background (the paper ground is the brand of this grammar)
- Bottom-bar captions of any kind
- A naked layer — any content not sitting in a shadowed card on the paper
- Two seconds with nothing entering, multiplying, or transforming
- A fixed accent color applied without meaning; a brand word not in its brand color
- Hard cuts as the default transition; uniform type (no serif/script mix, no size contrast)
- Fake screenshots, invented prompt text, fabricated metrics

## 9. Asset implications (build list)

1. **Fonts**: Fraunces Black + Black Italic (Google Fonts) as the Cooper/Recoleta stand-in; swap candidates later.
2. **Paper ground component**: color + grid + grain, shared by every scene.
3. **Card primitive**: one component (radius/shadow/tilt presets) that screenshots, prompts, icons, steps, and face-inserts all reuse.
4. **Icon-card library**: brand glyph on black rounded square — generated per brand from logo assets.
5. **Screenshot harvesting**: real product screenshots are now a *primary input* (Roger: this is what product-videogen's media library already does well).
6. Illustrated props: out of scope for the engine; per-video artisanal assets, possibly AI-generated and approved by a human.

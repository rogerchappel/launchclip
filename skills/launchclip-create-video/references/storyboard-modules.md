# Storyboard modules

<!-- Generated from kit/core/planning-prompt.mjs by scripts/sync-skills.mjs. Do not edit by hand; run `npm run skills:sync`. -->

Use this reference when you author `storyboard.json` (launchclip.story.v1). It is generated from the module registry, so every module listed here exists in both renderers. The same text, specialised for one model tier, is what `launchclip story plan` sends to a model.

Check every edit with `launchclip story validate storyboard.json` and `launchclip layout-check <project>`.

## Model tiers

| Tier | May write | May not |
| --- | --- | --- |
| structured | catalogue modules and their content params, hits | `rect`, `theme`, `accent`, `motion`, `presentation`, `track`, `custom` |
| guided | the above plus enum variants and `rect`, `theme`, `accent`, `motion`, `presentation`, `track` | `custom` |
| bespoke | the above plus `custom` modules (pure functions of time with a catalogue fallback) | bypassing gates |

## Contract

- schema: "launchclip.story.v1" (exactly). lane: one of motion, voiceover-motion, footage-led (given; never change it).
- format: {width, height, fps, duration, platform?} and brand: {colors, fonts} are given; copy them unchanged.
- audio: {voice?, words?, music?, sfx?}; base: null, or the recording path for footage-led.
- audio.music: omit it (finish picks ElevenLabs when a key is set, else the synth bed), or "synth", "none", an assets/ path, or {provider: "elevenlabs" | "synth" | "file", prompt?, bpm?, file?, sync?: "auto" | "off" | "cuts" | "hits"}. The music follows scene energy, so set energy honestly: calm intro, "build" before the payoff, 3 on the payoff. A prompt describes style only (no vocals is added for you).
- scenes: [{id ("s1", "s2"…), module, start, end, energy (0 calm, 1 light, 2 groove, 3 full, "build"), in? {type: cut | fade | push | whip | zoom | iris | morph | pan | pull | orbit | whip-pan | rack-focus | glow-wipe | card-to-card | overview, dur, direction?, from_object?}, params, hits?, zooms?, ambient?, layer? (footage-led: "behind" draws it behind the presenter)}].
- in.dur must be shorter than the scene. Choose transitions by meaning: cut for contrast, push for continuation, whip for speed, zoom for scale change, morph for identity (name in.from_object, e.g. "s2.gap-bracket"), iris for focus; camera moves (pan, whip-pan, orbit, pull, world push) are under "Motion grammar and camera".
- overlays: [captions]. ending: {loop_to: "<first scene id>"} for a seamless loop (Shorts). For no loop, set ending {loop: false} (or loop_to: null, or omit ending without a looping style pack); the last scene then holds settled to the final frame (ending.final "hold", the default), or use final "fade" to fade it fully to the background by the final frame, or "exit" to play its own exit. ending accepts only loop_to, in, loop and final.
- ambient? (optional): {level: off | subtle | standard | lively, background?: boolean, drift?: boolean}, or just the level. Ambient motion keeps settled frames alive between beats: a slow push-in on each settled module (kept inside the safe zone) and soft brand-colour light drifting behind the plates.
- Usually leave ambient out: the level follows each scene's energy (0 → subtle, 1, 2 or "build" → standard, 3 → lively; every scene is lively under the cinematic grammar), and footage-led stories get no background field and drift overlays only. Set story ambient only to change the whole piece (for example "subtle" for a calm brand film); "off" makes settled frames hold still and fails the cinematic motion gate.
- A scene may set ambient to override the story: "off" for one deliberately still beat, {"drift": false} when the module's own motion should stand alone, or a level.
- world? (optional): {kind: office | home-desk | kitchen | living-room | classroom | cafe | workshop | server-room | studio | gym | city-street | shopfronts | crossing | alley | rooftop | skyline | park | beach | mountains | forest | space | abstract-stage, time?: day | dusk | night, props?: [prop ids]}. The default for every world scene; a style may set it. Pick the place that fits the topic (cooking → kitchen or cafe, fitness → gym or park, developer tools → home-desk or server-room) and the time the story is set at.
- A world scene is a plate on track 0. Put characters (cast-scene, character-cameo), cards or text on track 1 over it, and set its scrim ("auto") when text sits on top, so the text keeps 4.5:1.
- Recorded product flows (assets/demo/<flow>.mp4 with demo/<flow>.actions.json, from launchclip demo record) play in product-demo scenes. Copy the params the asset inventory gives for each flow (media, viewport, actions, callouts) unchanged: the zooms, outlines and SFX are timed from the real action log, so never invent or move action boxes or times. Time the scene to the clip window (media.sourceStart plus the scene length must stay inside the clip); you may shorten a scene from the end, and drop actions after it.
- Captured evidence (assets/evidence/<id>.mp4 with <id>.evidence.json, from launchclip evidence capture) plays in evidence-clip scenes. Copy the params the asset inventory gives (media, viewport, source) unchanged; the page's own beats (scroll, selection, focus ring, date pin) are already in the clip, so add focus or cursor only on boxes the sidecar lists, and never retype what the page says.
- Vary the modules: a 20–40 s piece uses at least four different modules and never the same module three times in a row.

## Lane rules

- motion: no voice. Full-frame modules cover the whole duration back to back on track 0 (no gaps). Time scenes in seconds or beat anchors. finish snaps second-timed cuts to the nearest downbeat (within 0.25 s), so plan cuts on bar lines where you can.
- voiceover-motion: audio.voice and audio.words are fixed inputs; copy them unchanged. Full-frame modules cover the whole duration on track 0. Start scenes and place hits on word anchors from the narration so visuals land on the spoken word. Add a captions overlay.
- footage-led: base (the edited recording under assets/) plays underneath and is a fixed input; copy it unchanged. Scenes are overlays beside the presenter and full-frame inserts (insert: true), placed where the direction map says: every dress or insert line gets its scenes, and face lines keep the recording on purpose. Coverage (the share of the runtime with a graphic on screen) lands inside the story's cadence profile band (references/profiles.md); no undressed run longer than the profile allows. Add a captions overlay.

## Motion grammar and camera

- motion? {grammar}: one feel for every entrance, exit, pop, stagger, transition and camera move. grammar is one of editorial, snappy, smooth, playful, documentary, cinematic, or {base, ...overrides} (ease: {enter, exit, move, camera, emphasis}, duration: {enter, exit, transition, camera}, stagger multiplier). Omit it for editorial, the default.
- editorial: Clean product-editorial motion: power3 entrances, quick power2 exits, no overshoot on entrances. The default. Camera ease power3.inOut, camera moves about 0.8 s, transitions about 0.45 s.
- snappy: Fast and punchy: expo-out entrances, short durations, a slight overshoot on pops, whips and anticipating camera moves. Camera ease back.inOut(1.2), camera moves about 0.55 s, transitions about 0.32 s.
- smooth: Calm and fluid: sine and power2 curves, long durations, no overshoot anywhere. Camera ease sine.inOut, camera moves about 1.1 s, transitions about 0.7 s.
- playful: Springy and bouncy: back-out entrances, elastic pops, bigger staggers and a camera that winds up and overshoots. Camera ease back.inOut(1.6), camera moves about 0.75 s, transitions about 0.5 s.
- documentary: Slow and restrained: power1 curves, long holds and gentle moves, nothing that calls attention to itself. Camera ease power1.inOut, camera moves about 1.3 s, transitions about 0.8 s.
- cinematic: Film-like: every entrance and move eases slow → fast → slow into its resting state (power2.inOut), long durations, no overshoot, and settled scenes never stop moving (a slow push-in on every scene, recorded clips included, and a livelier camera drift). Camera ease power2.inOut, camera moves about 1.3 s, transitions about 0.9 s.
- camera? {mode: "cuts" | "world", layout?: row | column | grid | path | auto, spacing?: 0–1, parallax?: boolean, blur?: boolean}. "cuts" (default): scenes replace each other. "world": every track-0 scene sits in one world and the camera travels to it, with a slow drift (never fully still), a parallax background (0.3×) and overlays at 1.15×. Motion blur: whip-pans always; pans, pushes, pulls and orbits get a moderate blur in snappy and playful; blur true blurs every move fully, false none.
- Camera transitions (scene.in or ending.in, track-0 scenes only): pan {direction: where the next scene sits, e.g. "right"}, whip-pan (fast, motion-blurred), orbit (pan with a slight turn), pull (dolly out to a wider scene) and, in world mode only, push (dolly into a named object: in.from_object "s3.gap-bracket", else the scene content). In cuts mode push keeps its slide meaning, and pan/whip-pan/orbit/pull still move a camera between the two scenes.
- Choose by meaning and art direction: pan for continuation along a path, push to go deeper into a detail, pull to reveal the bigger picture, orbit for a change of angle on the same subject, whip-pan for energy or a time jump, cut/fade when the story jumps. Give camera moves 0.6–1.2 s (whip-pan 0.3–0.5 s) and keep scenes at least 2 s longer than their move.
- Captions and camera moves: a vertical pan or whip-pan (up/down), push, pull or orbit carries panels through the caption band mid-move, so the captions dip out for those moves by default (captions overlay hide_during_moves: "auto"; true dips for every move, false never). Horizontal pans keep their captions. layout-check samples every frame of every camera move and flags key content crossing visible captions (camera-caption-band). When a line must stay captioned through the move, pan left or right.
- Zooms inside a shot: scenes[i].zooms [{at: <anchor>, box {x, y, width, height} (plate px, any module) | target (a state target: item index or element id, e.g. 0, "bar-2", "row-1", on the modules that run states) | object (a named object, e.g. "gap-bracket"), scale?: 1.15–3 (default fills ~70 % of the frame), until?: <anchor>}] (1–8, track-0 shots). The camera dives into the bar, row or number as the line names it, holds at least 1.2 s and eases back out at until (without until: straight on to the next zoom, or out by the shot's end). Never during the shot's entry move; with until, leave 0.8 s before the next zoom and before the shot ends. World mode moves the camera; cuts mode zooms the shot itself. Captions are unaffected. Use 2–3 a minute on the values the narration names.
- Overview (world mode only): in {type: "overview", dur ≥ 2 (2.4–3 s), span: "chapter" | 3–8, hold?: 0.6} pulls the camera back until the chapter's shots (or the last n) show as a map, frozen on their last frame, holds, then dives into this shot. Use one per chapter at most, on its last line or a recap line ("So…", "Either way…"), never into the first shot and at most one a minute.
- In world mode, an ending {"loop_to": "s1", "in": {"type": "whip-pan", "dur": 0.4}} travels home for a seamless loop.
- Lanes: footage-led keeps camera.mode "cuts" and uses punch-in for emphasis (no camera transitions). The motion and voiceover-motion lanes may use the world camera; use it when the direction asks for travel or the grammar is playful, snappy, smooth or cinematic.

## Direction guardrails (finish gates fail these)

- World physics: walls, furniture, parked cars, props and a cast set's desk or bench are anchored to the world; only the camera moves them (world params.camera: still, drift, pan-left, pan-right, push, pull). Never animate them on their own.
- Ambient things (clouds, water, flames, signs, light) move in place; mobile things (characters, vehicles, birds) move by acting cues (walk-to), never by drifting.
- Two world scenes of the same place (kind, time and props) joined by a cut make the room jump: make them one world scene, or move to a different place.
- A cast-scene over a world plate shares the plate's window (same start and end), so its set never pops in mid-plate.
- Acting cues (cast-scene cues[].action): look-far (shades the eyes and looks into the distance (default target: far)); turn-to-look (turns to face the target and looks at it, keeping the pose); gaze-at (looks at the target (head and eyes), keeping the pose and facing); point-at (faces the target and points at it); walk-to (turns and walks to the target at a walking pace, then stands); stand-up (gets up from a seat (seated sets) and stands); stretch (stretches both arms overhead).
- Targets (cue or actor `target`): far, window, horizon, street, skyline, left, right, {prop: id} (a prop in the world beneath), {character: id} or {x, y}. A character with a target faces it and turns its head toward it, not the camera: a standing character looking at something far (window, street, horizon, skyline) turns its back to the camera; seated or for nearer things it turns three-quarters. A cue may set view: front | three-quarter | back.
- Never cover what a character looks at: a card must not sit over the window, street or skyline point while someone looks at it (the acting gate fails it). Put the card to one side, or bring it in after the look.
- If the idea is an action (look away, get up, walk over, point at the proof), a character performs it on screen on that line, toward what it is about: a bench sitter looking at the street turns toward the street.
- No ghosting: one copy of a person on screen at a time. Never put a character in two scenes that overlap; the next shot's copy of a character appears by itself when the transition ends. Never fade a character in or out over a world that is already there.
- Text reads or is gone: cards fade in and out fast (0.5 s at most, whatever the grammar) and stay fully shown for their reading time (about 0.22 s a word, at least 1.2 s).
- Captions must read on what is behind them: finish measures every line on the render and adds a backing plate where it does not; keep captions out of a character's face and off busy props where you can.
- Density: every third of the frame (top, middle, bottom in 9:16) has something in it within 4 s; a card never sits alone over an empty set for more than 3 s. Keep a character in the shot under a card, reacting to it or pointing at it.
- Variety: never repeat a shot back to back. Two cast scenes in a row need a different set, a different cast or different poses and actions; moving the same pair to a new background is not a new shot.
- 9:16 composition: a card takes the top band (about 15–41% of the height: rect {x: 80, y: 290, width: 860, height: about 480} at 1080x1920, inside the Shorts safe zone), the cast stands in the lower half on the world's ground, and captions sit in the band between them. Use at most two seated characters in 9:16.
- A proof or quote beat keeps the cast on screen: the speaker points up at the card (point-at {x, y} of the card) or reacts to it, rather than leaving the set empty.

## Time anchors

- scene.start, scene.end, hits[].at and zooms[].at / until accept: seconds (2.5); "word:<text>" (the first time that word is spoken); "word:<text>#<n>" (its n-th occurrence); an optional offset ("word:fast-0.2"); "beat:<n>" or "downbeat:<n>" (from BEATS.json).
- Word anchors must name a word that is actually in the narration (case and punctuation are ignored; a hyphenated anchor matches hyphenated or consecutive words).
- Scenes on the same track must not overlap. scene.end must not exceed format.duration. A hit should fall inside its scene.
- hits: [{"at": <anchor>, "event": "<module event name>", "cue"?: "<sound>"}]. When the event matches a module event (for example "hit" on count-up or "gap-bar-0" on function-chart), the hit times that event.

## Safe zone

- shorts (1080x1920): key content within x 80–940, y 280–1450; caption band x 65–918, y 1190–1420; centre of mass near y 860; key text at least 44 px; keep the lower third occupied.
- landscape (1920x1080): key content within x 96–1824, y 54–1026; caption band x 192–1728, y 864–1004; centre of mass near y 540; key text at least 32 px.
- Catalogue modules size and place themselves inside the safe zone and fail with a param error when copy is too long; shorten copy rather than shrinking it.
- Editorial modules without a rect size and place themselves from their content inside the safe zone and above the caption band, with type scaled to fill the panel; omit rect unless the layout needs a specific position. With a rect in 16:9, also set density: "fill", or the text stays small and a bigger rect is just more empty panel. They need a 1080x1920 or 1920x1080 format.

## Captions

- Captions are one overlay: {"type": "captions", "style": "word-highlight" | "line" | "none"}. Use "word-highlight" whenever there is a voice, except in the footage-led lane. In the footage-led lane write {"type": "captions"} with no style or preset: the default is the quiet sentence-case quiet-accent preset with one accent word per line; name word-highlight only when the brief asks for loud captions.
- A caption preset may replace style: {"type": "captions", "preset": "<name>"}, one of word-highlight, karaoke-fill, pop-word, bounce, typewriter, box-highlight, underline-sweep, kinetic-stack, minimal-line, glow, outline-heavy, split-color, lower-band, bubble, quiet-accent. With a style pack, write {"type": "captions"} and let the pack choose the preset.
- Modules marked "hides captions" hide them while on screen; every other module keeps them visible, so its content stays above the caption band.
- On-screen copy is shorter than the narration; never put a whole sentence on screen.

## Data explainers (the study says)

- Format "the study says": the question (a choice: "10 heavy reps or 25 light ones?") → what everyone believes (the rule) → the fair test (the study: who, how many, what each group did) → the result → what to do. One idea per beat.
- Keep a near-empty stage and add or transform one element per beat rather than cutting to a new card: the belief is a number-line whose ranges light up on their words, the study is a unit-grid that counts in and then splits into its groups (split on the word that names them), the result lands on those groups (bar-chart, gauge-compare or stat-card), stacked fragments ("same program", "12 weeks", "every set to failure") are kinetic-words.
- No source, no study claim: a study, survey or "researchers found" line needs its citation in the brief or assets. Show it as a source note that stays along the bottom across the data scenes: frame.sources [{text ≤ 90 ("Morton et al., 2016 · J Appl Physiol"), scene | start, until? | end?}] (keep any other frame fields; with no brand frame write frame: {kicker: false, sections: false, sources: [...]}). Every unit-grid or number-line scene sits under a note or sets params.source. Never invent an author, year or journal; without one, cut the claim.

## Social posts

- A post on screen is a real post: its words verbatim (an excerpt marks cuts with …), its author, handle and date as posted, and a source block {url, captured_at, screenshot} from the capture (schema launchclip.capture.v1). validateStory warns on a post without source.url; never write a post someone did not post, and never fill a wall with made-up accounts.
- Sweep the phrase the narration reads (highlight: "<words of the post>"), timed with a scene hit on that word: hits [{at: "word:<text>", event: "highlight"}]. One card per beat; build the next card in the same shot (social-stack, social-sort) rather than cutting.

## Code evidence (the receipt)

- A claim about code ("they are already testing it", "it shipped") lands on its receipt: repo-pr-card (a PR), commit-card (a commit), diff-view (what changed, row by row) or terminal-session (a run). Box the token (a model name, a flag) with highlight and time highlightAt to its word: "highlightAt": "word:terra".
- Real data only: map a public PR or commit with `node src/evidence/github.js <url> --token <text>` (cached under assets/evidence/, avatars too) and paste its params; never type or invent repo names, numbers, shas, authors or lines. Lines stay verbatim (cropping round the token is the module's job).
- Several sources for one name: evidence-chain (2–4 cards, one per beat, the token joined by a dashed connector) or date-pinned-timeline (cards pinned to their dates on a scrubbing day axis; the summary variant is the "why now? N clues in N days" recap). Keep one shot and build it source by source rather than cutting card to card.

## Builds, not cuts (shot states)

- Builds, not cuts: a data or proof shot runs 2–4 states timed to the clauses on one plate (scene.states [{at: <anchor>, set: {...}}], 1–5 after the scene itself), so each line gets a new visual without a cut. Nothing holds one state longer than about 10 s, and nothing stands still over 3 s (the holds and states gates).
- A state sets any of: params (the module's state params, merged; arrays keep their length, so list every item and hold the later ones back with reveal), reveal [item], focus item | "<element id>" | null (a ring in the focus colour travels there and the rest dims to 30 %), glow item, guide {value, label} (bar-chart) or {target, edge, label}, note {text ≤ 32, target}, clear true. Items are indexes (bar 0, row 2); element ids drop the scene prefix ("cell-1-2", "line-3").
- States run on bar-chart (data, max, highlight), scatter-plot (points, highlight), comparison-table (rows, highlight), leaderboard (entries, highlight), unit-grid (highlight), process-steps (steps) and excerpt (lines). Example on bar-chart: the first bar ($1) → the second grows in (reveal [1]) → a dashed "half" guide → focus and glow on the winner.
- Between shots: "rack-focus" (the card blurs back while the next sharpens forward) is the default between builds; "card-to-card" when one card becomes the next; "glow-wipe" only for chapter breaks.

## Long-form look (plates and glass)

- Backdrop plates: plate {kind: hex-shell | silk | strands | bokeh | starfield | smoke | wash | image, params?: {focus, intensity, speed, depth 0–1 (speed 0–2), tint: neutral | primary | accent}, cycle?} sets an out-of-focus plate that drifts under every scene; it holds across a chapter and changes at the next (cycle: true walks the first four kinds per chapter, or set chapters[j].plate). scenes[i].backdrop (or .plate) overrides one scene ("none" for the story background). starfield (deep space) and smoke (grey wisps) are dark like the first four; wash is a bright full-frame gradient for a short punctuation shot (put a paneled card or ink text on it); image is a project still, blurred and dimmed: {kind: "image", params: {src: "assets/…", blur?: 0–80, dim?: 0–1}}. Build a chapter as several states over one plate rather than cutting to new backgrounds.
- World camera backdrops: with camera.mode "world" the backdrop moves with the camera and changes with its moves (a pan slides the next one in from the side it travels toward, a push or pull crossfades, a cut switches). For the open-world look give it a new backdrop every 6–10 s: plate.cycle {every: n, plates?: [kinds or {kind, params}]} rotates every n shots without naming each one (n ≈ 8 s ÷ your shot length), and chapters[j].plate or scenes[i].backdrop place a specific one (a wash on a punchline, a starfield for scale).
- Glass: panel {treatment: "rim-glass"} turns every card (stat-card, excerpt, quote-card, …), window-chrome and comparison-table into translucent glass with a cyan (primary) rim and glow. Type stays paper and primary; the accent is for the one brand being discussed.
- Channel furniture: logo-sting opens and closes (rain, particles or clear); subscribe-cta goes on track 1+ over a card scene for 5–6 s, two or three times in a long video, never over a key figure; channel-watermark goes on the highest track across the main body (decor: scenes pass under it).

## 3D data objects

- Catalogue I modules (glass-bars-3d, coin-stack, rack-shelf, device-box, paper-stack, planet-family) are real 3D objects drawn from data under a slow orbiting or dollying camera. Use one for the hero beat of a chapter (the price line-up, the cost gap, the model family), not for every number: a flat bar-chart or stat-card keeps the pace between them.
- Build, do not cut: give one 3D scene 2–4 states on the words that name them (bars grow, then the lit bar on "half the price"; trays stack, then the focus tray slides out on its name; the marker hops step to step; the readout counts while the narration talks about load; each paper section gets its check or flag on its word).
- Values, prices, scores and statuses come from the brief or assets only. Names are short (≤ 24, planets ≤ 16): the modules fail when text no longer fits at key size on its face, so shorten the copy or use fewer items rather than shrinking it.

## Footage layouts (sections)

A footage-led story may hold top-level `sections: [{id, start, end, layout, side?, panel?, room?, transition?}]`: one layout for a stretch of the recording, and the scenes inside render within it. Times are seconds or word anchors; sections may not overlap; time outside every section is `full`. Plan the layout per section of the direction map, then place the section's scenes in its panel.

| Layout | Presenter | Use it when the section… |
| --- | --- | --- |
| `full` | full frame, overlays only (no section needed) | the face carries the line: personal beats, the hook, the turn |
| `split-left` | reframed onto the left side | a list, steps, a comparison or a product shot held beside them for a stretch |
| `split-right` | reframed onto the right side | the same, mirrored; alternate sides between sections |
| `framed` | inset in a rounded frame (`side` left/right in 16:9, top/bottom in 9:16) | proof, numbers or a quote that needs most of the canvas while they keep talking |
| `stacked` | the bottom (or top, `side`) half, 9:16 only | a Short's explainer stretch: graphics on top, the presenter under them |
| `insert` | hidden; the voice continues | a full-canvas visual over the voice (a demo, a chart), as an insert without cutting away from the section |

- The panel is a brand colour (`panel`: bg (default), primary, accent, paper, ink or #rrggbb). `room`: "dim" or "replace" darkens or removes the recording behind the cut-out presenter (needs a matte over the section; `make` mattes it).
- Changing layout is a `layout-shift` transition (0.5 s; `transition: {type: "layout-shift" | "cut", dur?}`). Hold a layout for a whole section (about 4 s or more); do not flip layouts line by line.
- In a section with a panel, a checklist without `rect` fits the panel's safe area; give other modules a `rect` inside the panel, clear of the presenter's side.

## Phrase → module

| The script… | Module |
| --- | --- |
| states a question or claim as a headline (frame 0 visible); in a video of 90 s or less, never the first scene: an image of the hook's subject opens it | hook-title |
| lands 1–3 words per beat | kinetic-words |
| describes a quantity over time or a curve | function-chart |
| contrasts two values or states | gauge-compare |
| says "big X → fast, small X → slow" | flow-compare |
| counts people or things in a study or survey, or splits them into groups ("49 trained lifters", "split into two groups", "1 in 10 people"): one icon per unit counts in, then the grid splits into labelled groups or lights a few up | unit-grid |
| states a range, rule or threshold on a scale ("8–12 reps for size", "above 15 is cardio", "between 7 and 9 hours"): a ruler whose ranges light up one at a time, each with its label | number-line |
| states a huge count of small things to feel its size ("1,050,000 tokens in context", "a million rows", "2 million parameters"): one dot per unit fills a bracketed field as the counter counts, pulling back from close-up dots | dot-field |
| compares what the same budget or time buys from two options ("same $10 of output", "for the same money", "per dollar"): two unit grids fill side by side under live counters, "1 cell = X" | grid-race |
| compares costs, money or task counts as amounts ("$1.01 vs $7.15 per task", "24 of 100 tasks passed", "grew $200,000 to $1M"): grids at one cell size whose heights compare, with ticks, a lit subset, stacked segments and a ratio ("≈9× cheaper") | cell-grid |
| explains tokens or prices per token ("a token is part of a word", "$10 per million output tokens"): a real sentence split into token chips with each token's price, then the bills race to their totals | tokenizer |
| reveals a headline number or word that should feel computed or leaked ("60%", "6.1", "AGI?"): it assembles from (or dissolves into) glowing particles | particle-text |
| pits two labs, companies or products against each other by name ("OpenAI and Anthropic", "X takes on Y"): each mark drawn in particles inside an orbiting ring, side by side | particle-logo |
| points at what comes next after a line-up ("the next flagship", "what's coming", "the model after this"): steps rise to a dashed box that a particle cloud gathers round | particle-cloud |
| cites a study, survey or researchers ("according to", "a 2016 study", "researchers found", "et al."): a source note (author, year · journal) that stays along the bottom while the data scenes play (story.frame.sources, not a scene); no source in the brief, no study claim | frame.sources (story overlay, not a scene module) |
| quotes one real post, tweet or reply ("one user wrote", "he tweeted", "posted on X"): the post as a card, its key phrase swept with a highlight on the word | social-post |
| gathers a few reactions to one thing ("people were quick to respond", "the replies poured in"): 2–5 posts cascade in, one in front | social-stack |
| splits reactions into camps ("some can't wait, others are tired of it"): posts fly into labelled columns | social-sort |
| says a topic took over the feeds ("the internet exploded", "everyone was talking about it"): a drifting wall of posts, one or two pulled forward | social-wall |
| names a pull request or a change merged into a repo ("a PR in dotnet/efcore", "merged on Oct 16", "pull request #39217"): the PR rebuilt as a card, the token boxed on its word | repo-pr-card |
| names a commit, a sha or who committed what ("a commit by Copilot", "commit cc44805", "co-authored by"): the commit card with sha, Verified, co-authors and the hunk | commit-card |
| walks through what a change did line by line ("they swapped sol for terra", "the diff shows", "this line changed"): a Files-changed diff whose focus ring steps through the rows | diff-view |
| finds the same name in several places ("the same model name shows up in three repos", "and again here"): the sources side by side, the token joined by a dashed connector | evidence-chain |
| dates the clues ("on Oct 16 … then Oct 24", "three clues in nine days", "why now?"): a day axis that scrubs while each source pins to its date, or the why-now summary | date-pinned-timeline |
| runs something in a terminal ("clone the repo", "pip install", "run the tests", "38 scripts pass"): commands type, output streams PASS/FAIL rows, a ⏩ timer fast-forwards long runs | terminal-session |
| gives a number, time, price or count | count-up |
| gives a sourced figure that should stay on screen with captions | metric |
| lists steps, features or duties | checklist |
| explains a sequence or mechanism | process-steps |
| walks through the stages of a workflow | step-rail |
| names a law or formula | equation-lockup |
| cites history, a source or a quote | archive-card |
| names a specific date or launch day | date-card |
| shows the product in use: a recorded flow (assets/demo/<flow>.mp4 with <flow>.actions.json from launchclip demo record) [motion, voiceover-motion] | product-demo |
| shows a real public page as proof: a PR or diff, a model card, an announcement, an article (assets/evidence/<id>.mp4 with <id>.evidence.json from launchclip evidence capture) [motion, voiceover-motion] | evidence-clip |
| shows a product, site or repo (real capture) | media-window (planned module ui-showcase; use media-window) |
| shows a command or a few lines of code | code-snippet |
| names platforms or integrations | logo-row |
| shows a trend across several data points | trend-chart |
| shows growth that never declines | growth-chart |
| reports progress toward a goal | progress |
| reports the state of several systems | status-rack |
| quotes a passage from a doc, README or article | excerpt-window |
| speaks to several audiences or groups | audience-grid |
| picks one option from several | focus-flow |
| sets a scene or mood with a real photo or clip (assets/… image or video, full bleed) [motion, voiceover-motion] | photo-scene |
| names the brand on a title or end card, with its logo and wordmark images (and an app-store badge or URL on the end card) | brand-lockup |
| calls to action, or the loop ending | cta |
| asks the viewer to subscribe, like or ring the bell partway through a long video ("if you're new here, subscribe"): a glass subscribe pill on an overlay track (track 1+) over the scene, clicked on the word | subscribe-cta |
| opens or closes a channel's video on its name ("welcome back to …", "see you in the next one"): the channel's glass logo sting, 3–5 s, as the first or last scene | logo-sting |
| names a claim, a problem or a turn in a few words ("the problem is", "here's the thing", "too slow"): a big word or phrase with an icon and a sub-line (on a card beside the presenter, or full frame) | concept-card |
| lists two to five things, features, steps or audiences ("X, Y and Z", "three things"): an icon per item that pops on its word | icon-row |
| opens a new section or chapter ("part two", "first, the problem", "chapter", "let's start with"): the brand frame's kicker and the section title (usually an insert) | section-card |
| talks about a thing the product is or makes (a box, a launch, a calendar, a laptop, an inbox): a simple illustrated object with a caption | object-card |
| states a real figure with its source in the brief or assets ("87% of", "saves $1,400", "3× faster"): the figure counts up with a label and a source line (no source, no stat-card) | stat-card |
| quotes a named person or outlet, with the exact words in the brief ("as Ada put it", "said", "wrote"): the quote with its attribution (never "a customer") | quote-card |
| shows real lines from code, a README, docs, a changelog or an article, supplied verbatim: the lines in a window with the key ones highlighted | excerpt |
| contrasts the old way and the new, or two options ("before", "instead of", "the old way", "X versus Y"): two panels, before and after (or two columns) | compare |
| walks through steps in order, a history or a roadmap ("first… then… finally", "day one", "by week three", "next quarter"): nodes along a line that land on their words | timeline |
| names the product or the one idea the video is about ("meet X", "this is X", "it's called X"): one word behind the presenter's head [footage-led] (needs the subject) | masthead |
| lands a realisation, reveal or turn ("that's when", "it hit me", "everything changed"): the room moves, the presenter holds [footage-led] (needs the subject) | dolly-zoom |
| shows or describes the product on screen ("here's the dashboard", "this is the app"), with a screenshot or recording in the assets: the UI fills the top, their head over its edge [footage-led] (needs the subject) | app-stage |
| shows the product on a phone or a mobile flow, with a recording or screenshot in the assets (a demo-autopilot flow fits) [footage-led] | phone-stage |
| turns from the problem to the product ("so we built", "that's why", "enter"): the room gives way to a brand backdrop [footage-led] (needs the subject) | backdrop-swap |
| talks about posting, going viral or "this exact video": the frame becomes a feed window they break out of [footage-led] (needs the subject) | feed-frame |
| reveals how the video or result was made, or a process finishing ("made with", "it transcribes, cuts…"): the frame pulls back into an app window while real steps tick [footage-led] | pull-back |
| names the one idea or the brand in a premium or tech piece: one glass word on the wall behind their head [footage-led] (needs the subject) | glass-word |
| lists many things or shows social proof ("all these tools", "people keep telling me"), with real items in the assets or brief: cards circle them [footage-led] (needs the subject) | orbit-cards |
| "everyone is talking about it", press, reviews or a launch buzz, with real quotes and sources in the brief: proof pins to the wall behind them [footage-led] (needs the subject) | proof-wall |
| a warm, personal creator line about the presenter or what they made ("I built this", "my favourite part", "love this") [footage-led] (needs the subject) | doodle-outline |
| calls out a number or claim in a playful, handmade beat ("100%", "3X", "$0", "free") [footage-led] (needs the subject) | scrapbook |
| says "all you need to do is", "three steps" or runs through a process: rows tick as each is said, beside the presenter (no rect: it places itself above their head or on their chest) [footage-led] | checklist |
| gives a growth result ("doubled", "took off in week three"): a line kicks up behind their head [footage-led] (needs the subject) | growth-line |
| turns on a contrast or jumps between takes ("but", "or you can", "instead"): rush into the cut, burst out of the next take [footage-led] | zoom-through |
| footage-led emphasis on a word (steps for a build of emphasised words; blur for energy) [footage-led] | punch-in |
| footage-led claim sticker or label pointing at something on screen [footage-led] | footage-callout |
| introduces the speaker or a guest by name and title [footage-led] | lower-third |
| one to three spoken words that deserve a big on-screen pop [footage-led] | emphasis-caption |
| tells a story with people ("meet Maya, a…", "imagine you're…", someone stuck or frustrated, then the product fixes it): animated characters from story.cast act it out in a set, with poses and expressions cued to words; the screen set plays a real capture [motion, voiceover-motion] | cast-scene |
| puts the story in a place and no photo or clip of it is supplied (an office, a kitchen, a city street at night, a park at dusk, a beach, space): a drawn environment at day, dusk or night as the plate, with characters, cards or captions on higher tracks over it; story.world sets the video-wide place [motion, voiceover-motion] | world |
| gives the viewer's situation a face for one beat ("if you're a…", "your customer", "someone like you"): one animated character beside a card or on a panel | character-cameo |
| a short note, tip or warning card [motion, voiceover-motion] | callout |
| compares a few real values side by side ("by platform", "per region", "each month"): bars grow to their values, one can stay lit | bar-chart |
| splits a whole into shares ("half of", "a third", "the split", "breakdown"): a donut or pie sweeps on with its legend | pie-chart |
| shows a real series over time ("every month since", "over the year"): the area reveals left to right | area-chart |
| walks a conversion path ("of those", "signed up", "drop-off", "funnel"): stages narrow with the rate between them | funnel-chart |
| explains how a total changed through gains and losses ("we gained… but lost…", "net"): steps from the start to the new total | waterfall |
| shows where something flows ("where the money goes", "how traffic splits"): ribbons from sources to destinations | sankey |
| shows when or where activity peaks across two dimensions ("busiest day and hour"): cells shade in a wave | heatmap |
| ranks things ("top five", "the most popular", "number one"): rows land from last place to first | leaderboard |
| compares products feature by feature ("unlike X, it…", "the only one that"): a table of ticks and crosses with the pick outlined | comparison-table |
| gives a big running total ("so far", "all time", "and counting"): every digit rolls on its own reel to the figure | odometer |
| counts down to a moment ("in 3, 2, 1", "launches in", "doors open"): each number punches in, then the end word | countdown |
| turns a date, year or time over ("from 2024 to 2026", "at midnight"): split-flap cards flip to the new value | flip-clock |
| names who or what it is for among several ("for founders, teachers or creators", "whatever you make"): a reel of words spins and lands on one | slot-roll |
| shows the product on a device ("on your phone", "in the browser", "on any laptop"): a browser, phone, laptop or tablet frame with a screenshot from the assets (or a brand mock screen) | device-frame |
| runs real commands or shows real lines in a terminal or app window ("run", "type", "one command"): the lines type on in a window | window-chrome |
| voices what someone says or thinks ("they asked", "you're thinking", "what if"): a speech or thought bubble pops from its tail | speech-bubble |
| stamps one short label on the moment ("new", "free", "beta", "sale"): a die-cut, round or starburst sticker slaps on | sticker |
| awards or certifies something ("award-winning", "certified", "open source", "version 2"): a badge spins in and stamps down | badge |
| points at one thing on screen ("see this", "right here", "this button"): an arrow draws from a label to the spot and rings it | callout-arrow |
| explains one control or spot in the product ("hover", "click here", "tap"): a dot lands on it and a tooltip rises beside it | tooltip |
| announces or names something in a few words ("announcing", "introducing", "say hello to"): a title built by the style's text effect, with a kicker and sub-line | motion-title |
| lists six or more features, tools or integrations ("works with", "everything you need", "all the features"): a grid of icons that pop in with labels | icon-grid |
| names countries or where something happens ("in 40 countries", "across Europe", "from Brazil to Japan"): a world map that zooms and fills the countries the brief names | map-highlight |
| states one real percentage of a whole ("87% of renders", "nine in ten"): a ring fills while it counts | progress-ring |
| compares a few prices, scores or sizes as a premium 3D beat, or a line-up from top to bottom ("the line-up", "from $50 down to $0.50", "the cheapest of the family"): glass bars grow under an orbiting camera, or a staircase of steps with a score marker hopping between them | glass-bars-3d |
| compares costs or token counts as piles ("$1 versus $10", "ten times the cost", "three times more tokens"): stacks of coins or token discs drop in, sized by value | coin-stack |
| lays out a family of models or plans row by row with a score and a price ("model by model", "each tier", "on the shelf"), or places them on a price scale: trays stack in and one slides out, or cubes glide along a price rail | rack-shelf |
| talks about a server, GPU or box running live ("one GPU", "on a single node", "it has been up for", "requests so far"): the device lands with a screen counting requests and an uptime clock | device-box |
| walks through a long document, report or paper section by section, with what passed and what failed ("chapter by chapter", "page 14", "the audit found", "red flags"): sections land as a stack and each gets a check or a red flag (books, or a folder that opens, as variants) | paper-stack |
| introduces a product family from small to large ("the small one, the mid one, the flagship", "three sizes", "light, standard and pro"): each member as a moon, earth, sun or galaxy with its name and tagline, the camera tracking across | planet-family |
| reads an official benchmark chart or a score against cost or size ("on the chart", "cost per task", "the official numbers vs the re-run"): series lines draw on, one glows, guides and callouts land one at a time, an official chart and a re-run side by side | scatter-plot |
| says one thing is N times faster or finishes first ("3× faster", "in half the time"): rows fill like progress bars at their own speeds and the winner gets its badge | race-bars |
| walks through several benchmarks or tests at once ("across four benchmarks", "wins 18 of 20"): a dashboard of mini bar charts with one legend, each lighting its winner | small-multiples |
| goes back or forward to a date ("rewind to October 5th", "three weeks earlier", "on launch day"): day cards rewind under a REWIND sign and land on the day with its event | date-carousel |
| counts a run of days ("28 days", "every day for a month", "a daily release"): a month calendar whose day cells fill in sequence, with marks on the days that matter | month-grid |
| introduces a real person by name and role in an explainer ("Professor X at Y", "the paper's author", "her advisor"): their photo with a glowing name pill and role | person-id |
| traces who taught or worked with whom ("his doctoral advisor", "her student", "trained under"): photos linked by dashed connectors with role labels | lineage-graph |
| shows or changes a formula ("the equation", "a sign error", "this term"): typeset LaTeX that reveals term by term, boxes the term in question and diffs red to green | equation |
| unpacks a paper or report title word by word ("the paper's title", "in plain English that means"): the title as word chips, each key term linked to an icon and a gloss | title-decompose |
| describes particle interactions or loop corrections ("one loop", "exchanges a photon", "self-energy"): a Feynman diagram that draws itself line by line | feynman-diagram |
| states one real percentage of a whole ("87% of renders", "nine in ten"): a ring fills while it counts | progress-ring |

## Modules

### media-window (editorial panel, keeps captions)
A browser/desktop window showing a real local image or video capture of a product, site or repo.
Common: title (required, ≤ 54 chars); `at` values are seconds from the scene start, at least 0.28 and at least 0.45 s before the scene ends.
params:
- title: string ≤ 54, required
- media: {kind: "image" | "video", src: "assets/…", sourceStart?: seconds (video only)}
- rect: {x, y, width, height} canvas px (width ≥ 420, height ≥ 160); usually omit it [guided and bespoke tiers only]
- density: "fill" (an explicit rect's text grows to fill it; recommended with rect in 16:9) | "fixed" [guided and bespoke tiers only]
- accent: #rrggbb [guided and bespoke tiers only]
- theme: {surface, foreground, muted, border, accentText?} [guided and bespoke tiers only]
- presentation: "solid" | "glass" [guided and bespoke tiers only]
- motion: {enter, exit, distance, enterDuration, exitDuration, scale} [guided and bespoke tiers only]
events: enter

### checklist (editorial panel, keeps captions)
Rows that tick from pending to active to done: a real list of steps, features or conditions.
Common: title (required, ≤ 54 chars); `at` values are seconds from the scene start, at least 0.28 and at least 0.45 s before the scene ends.
params:
- title: string ≤ 54, required
- rows: [{label, status: "pending" | "active" | "done", at, doneAt?}] up to 6
- statusLabels: {pending, active, done} ≤ 14 chars each (optional, e.g. "Covered")
- variant: one of the variants below, the panel's designed look (optional; default: the style's variants[module], else the first); usually leave it to the style
- rect: {x, y, width, height} canvas px (width ≥ 420, height ≥ 160); usually omit it [guided and bespoke tiers only]
- density: "fill" (an explicit rect's text grows to fill it; recommended with rect in 16:9) | "fixed" [guided and bespoke tiers only]
- accent: #rrggbb [guided and bespoke tiers only]
- theme: {surface, foreground, muted, border, accentText?} [guided and bespoke tiers only]
- presentation: "solid" | "glass" [guided and bespoke tiers only]
- motion: {enter, exit, distance, enterDuration, exitDuration, scale} [guided and bespoke tiers only]
events: enter, row-<i>-state, row-<i>-covered
variants: panel (default), flat, outline, banner

### step-rail (editorial panel, keeps captions)
Ordered stages on a rail that fills as each step lights up.
Common: title (required, ≤ 54 chars); `at` values are seconds from the scene start, at least 0.28 and at least 0.45 s before the scene ends.
params:
- title: string ≤ 54, required
- steps: [{label, at}] 2–6, strictly increasing at
- numbered: boolean (optional)
- variant: one of the variants below, the panel's designed look (optional; default: the style's variants[module], else the first); usually leave it to the style
- rect: {x, y, width, height} canvas px (width ≥ 420, height ≥ 160); usually omit it [guided and bespoke tiers only]
- density: "fill" (an explicit rect's text grows to fill it; recommended with rect in 16:9) | "fixed" [guided and bespoke tiers only]
- accent: #rrggbb [guided and bespoke tiers only]
- theme: {surface, foreground, muted, border, accentText?} [guided and bespoke tiers only]
- presentation: "solid" | "glass" [guided and bespoke tiers only]
- motion: {enter, exit, distance, enterDuration, exitDuration, scale} [guided and bespoke tiers only]
events: enter, step-<i>-settle
variants: panel (default), flat, outline, banner

### callout (editorial panel, keeps captions)
A short explanation panel: a title over one body line, or a treated panel with icon, glow and highlighted segments.
Common: title (required, ≤ 54 chars); `at` values are seconds from the scene start, at least 0.28 and at least 0.45 s before the scene ends.
params:
- title: string ≤ 54, required
- body: string ≤ 160 (plain)
- treatment: {icon?: "terminal" | "branch" | "users" | "rocket" | "check" | "warning", monospace?, glow?, corners?, segments?: [{text, highlight?, underlineAt?}] (replace body), at?}
- variant: one of the variants below, the panel's designed look (optional; default: the style's variants[module], else the first); usually leave it to the style
- rect: {x, y, width, height} canvas px (width ≥ 420, height ≥ 160); usually omit it [guided and bespoke tiers only]
- density: "fill" (an explicit rect's text grows to fill it; recommended with rect in 16:9) | "fixed" [guided and bespoke tiers only]
- accent: #rrggbb [guided and bespoke tiers only]
- theme: {surface, foreground, muted, border, accentText?} [guided and bespoke tiers only]
- presentation: "solid" | "glass" [guided and bespoke tiers only]
- motion: {enter, exit, distance, enterDuration, exitDuration, scale} [guided and bespoke tiers only]
events: enter, treatment-settle, underline-<i>-settle
variants: panel (default), flat, outline, banner

### audience-grid (editorial panel, keeps captions)
A grid of audience tiles that highlight in turn; illustrative, never a claim about real users.
Common: title (required, ≤ 54 chars); `at` values are seconds from the scene start, at least 0.28 and at least 0.45 s before the scene ends.
params:
- title: string ≤ 54, required
- audience: {tiles: [{label ≤ 24, emoji?, at}] 2–12, columns?: 2–4}
- rect: {x, y, width, height} canvas px (width ≥ 420, height ≥ 160); usually omit it [guided and bespoke tiers only]
- density: "fill" (an explicit rect's text grows to fill it; recommended with rect in 16:9) | "fixed" [guided and bespoke tiers only]
- accent: #rrggbb [guided and bespoke tiers only]
- theme: {surface, foreground, muted, border, accentText?} [guided and bespoke tiers only]
- presentation: "solid" | "glass" [guided and bespoke tiers only]
- motion: {enter, exit, distance, enterDuration, exitDuration, scale} [guided and bespoke tiers only]
events: enter, viewer-<i>-settle

### trend-chart (editorial panel, keeps captions)
Bars for a trend across 2–8 points with a counter that follows the selected point.
Common: title (required, ≤ 54 chars); `at` values are seconds from the scene start, at least 0.28 and at least 0.45 s before the scene ends.
params:
- title: string ≤ 54, required
- chart: {mode: "illustration" | "data", points: [{label ≤ 16, value (whole number ≥ 0), at}] 2–8 (≥ 0.5 s apart), unit ≤ 18, source (required for data)}
- rect: {x, y, width, height} canvas px (width ≥ 420, height ≥ 160); usually omit it [guided and bespoke tiers only]
- density: "fill" (an explicit rect's text grows to fill it; recommended with rect in 16:9) | "fixed" [guided and bespoke tiers only]
- accent: #rrggbb [guided and bespoke tiers only]
- theme: {surface, foreground, muted, border, accentText?} [guided and bespoke tiers only]
- presentation: "solid" | "glass" [guided and bespoke tiers only]
- motion: {enter, exit, distance, enterDuration, exitDuration, scale} [guided and bespoke tiers only]
events: enter, point-<i>-settle

### metric (editorial panel, keeps captions)
One formatted number panel that steps through 1–8 values, with an attribution line.
Common: title (required, ≤ 54 chars); `at` values are seconds from the scene start, at least 0.28 and at least 0.45 s before the scene ends.
params:
- title: string ≤ 54, required
- metric: {mode: "illustration" | "data", unit ≤ 18, format: "number" | "percent" | "currency", currency? (three-letter code, currency only), decimals?: 0–2, values: [{value, at}] 1–8 (≥ 0.65 s apart), source? (required for data)}
- variant: one of the variants below, the panel's designed look (optional; default: the style's variants[module], else the first); usually leave it to the style
- rect: {x, y, width, height} canvas px (width ≥ 420, height ≥ 160); usually omit it [guided and bespoke tiers only]
- density: "fill" (an explicit rect's text grows to fill it; recommended with rect in 16:9) | "fixed" [guided and bespoke tiers only]
- accent: #rrggbb [guided and bespoke tiers only]
- theme: {surface, foreground, muted, border, accentText?} [guided and bespoke tiers only]
- presentation: "solid" | "glass" [guided and bespoke tiers only]
- motion: {enter, exit, distance, enterDuration, exitDuration, scale} [guided and bespoke tiers only]
events: enter, value-<i>-settle
variants: panel (default), flat, outline, banner

### progress (editorial panel, keeps captions)
A progress bar toward an explicit goal (not an elapsed-time clock).
Common: title (required, ≤ 54 chars); `at` values are seconds from the scene start, at least 0.28 and at least 0.45 s before the scene ends.
params:
- title: string ≤ 54, required
- progress: {mode, values: [{value, at}] 1–8, max?, label? ≤ 32, source?}
- rect: {x, y, width, height} canvas px (width ≥ 420, height ≥ 160); usually omit it [guided and bespoke tiers only]
- density: "fill" (an explicit rect's text grows to fill it; recommended with rect in 16:9) | "fixed" [guided and bespoke tiers only]
- accent: #rrggbb [guided and bespoke tiers only]
- theme: {surface, foreground, muted, border, accentText?} [guided and bespoke tiers only]
- presentation: "solid" | "glass" [guided and bespoke tiers only]
- motion: {enter, exit, distance, enterDuration, exitDuration, scale} [guided and bespoke tiers only]
events: enter, value-<i>-settle

### date-card (editorial panel, keeps captions)
A calendar card for one specific date, with an optional caption.
Common: title (required, ≤ 54 chars); `at` values are seconds from the scene start, at least 0.28 and at least 0.45 s before the scene ends.
params:
- title: string ≤ 54, required
- date: {month: 1–12, day, year?, caption? ≤ 42, at?}
- rect: {x, y, width, height} canvas px (width ≥ 420, height ≥ 160); usually omit it [guided and bespoke tiers only]
- density: "fill" (an explicit rect's text grows to fill it; recommended with rect in 16:9) | "fixed" [guided and bespoke tiers only]
- accent: #rrggbb [guided and bespoke tiers only]
- theme: {surface, foreground, muted, border, accentText?} [guided and bespoke tiers only]
- presentation: "solid" | "glass" [guided and bespoke tiers only]
- motion: {enter, exit, distance, enterDuration, exitDuration, scale} [guided and bespoke tiers only]
events: enter, date-settle

### status-rack (editorial panel, keeps captions)
A rack of rows with three status lights each that change state over time.
Common: title (required, ≤ 54 chars); `at` values are seconds from the scene start, at least 0.28 and at least 0.45 s before the scene ends.
params:
- title: string ≤ 54, required
- rack: {mode, source?, rows: [{label ≤ 24, states: [{at, lights: [bool, bool, bool], tone?: "pending" | "active" | "pass" | "fail"}]}] 1–8}
- palette: "status" (optional: lights mean fail, active, pass by position, and tones colour red → green; a light may be a tone name instead of true)
- rect: {x, y, width, height} canvas px (width ≥ 420, height ≥ 160); usually omit it [guided and bespoke tiers only]
- density: "fill" (an explicit rect's text grows to fill it; recommended with rect in 16:9) | "fixed" [guided and bespoke tiers only]
- accent: #rrggbb [guided and bespoke tiers only]
- theme: {surface, foreground, muted, border, accentText?} [guided and bespoke tiers only]
- presentation: "solid" | "glass" [guided and bespoke tiers only]
- motion: {enter, exit, distance, enterDuration, exitDuration, scale} [guided and bespoke tiers only]
events: enter, rack-<i>-state-<j>

### code-snippet (editorial panel, keeps captions)
One to three lines of tokenised code, optionally typed on.
Common: title (required, ≤ 54 chars); `at` values are seconds from the scene start, at least 0.28 and at least 0.45 s before the scene ends.
params:
- title: string ≤ 54, required
- code: {language? ≤ 24, source?: "example" | "real", filename? ≤ 40, typing?: boolean, lines: [{tokens: [{text, type: "plain" | "keyword" | "string" | "number" | "comment" | "operator"}], at, typeDuration?}] 1–3}
- label: string ≤ 40 or false (label row; default "<language> · Example", the language alone for source "real", the filename when given)
- rect: {x, y, width, height} canvas px (width ≥ 420, height ≥ 160); usually omit it [guided and bespoke tiers only]
- density: "fill" (an explicit rect's text grows to fill it; recommended with rect in 16:9) | "fixed" [guided and bespoke tiers only]
- accent: #rrggbb [guided and bespoke tiers only]
- theme: {surface, foreground, muted, border, accentText?} [guided and bespoke tiers only]
- presentation: "solid" | "glass" [guided and bespoke tiers only]
- motion: {enter, exit, distance, enterDuration, exitDuration, scale} [guided and bespoke tiers only]
events: enter, code-<i>-settle, code-<i>-typing-start

### excerpt-window (editorial panel, keeps captions)
A passage from a doc, README or article that zooms to one line and highlights it.
Common: title (required, ≤ 54 chars); `at` values are seconds from the scene start, at least 0.28 and at least 0.45 s before the scene ends.
params:
- title: string ≤ 54, required
- excerpt: {mode, source?, lines: [{segments: [{text, highlight?}]}] 1–5, focus: {line, scale: 1–1.3, at}, highlightMotion?}
- rect: {x, y, width, height} canvas px (width ≥ 420, height ≥ 160); usually omit it [guided and bespoke tiers only]
- density: "fill" (an explicit rect's text grows to fill it; recommended with rect in 16:9) | "fixed" [guided and bespoke tiers only]
- accent: #rrggbb [guided and bespoke tiers only]
- theme: {surface, foreground, muted, border, accentText?} [guided and bespoke tiers only]
- presentation: "solid" | "glass" [guided and bespoke tiers only]
- motion: {enter, exit, distance, enterDuration, exitDuration, scale} [guided and bespoke tiers only]
events: enter, excerpt-focus, highlight-sweep-settle

### focus-flow (editorial panel, keeps captions)
Two to four options arrive, one is chosen, the others fade and a progress line runs.
Common: title (required, ≤ 54 chars); `at` values are seconds from the scene start, at least 0.28 and at least 0.45 s before the scene ends.
params:
- title: string ≤ 54, required
- focus: {options: [string ≤ 24] 2–4, selected: index, arriveAt?, chooseAt?, progressAt?, progressDuration?, progressLabel? ≤ 32, icon?}
- rect: {x, y, width, height} canvas px (width ≥ 420, height ≥ 160); usually omit it [guided and bespoke tiers only]
- density: "fill" (an explicit rect's text grows to fill it; recommended with rect in 16:9) | "fixed" [guided and bespoke tiers only]
- accent: #rrggbb [guided and bespoke tiers only]
- theme: {surface, foreground, muted, border, accentText?} [guided and bespoke tiers only]
- presentation: "solid" | "glass" [guided and bespoke tiers only]
- motion: {enter, exit, distance, enterDuration, exitDuration, scale} [guided and bespoke tiers only]
events: enter, options-settle, chosen-task, focus-progress-settle

### growth-chart (editorial panel, keeps captions)
Growth bars whose values never decrease (use trend-chart for declines).
Common: title (required, ≤ 54 chars); `at` values are seconds from the scene start, at least 0.28 and at least 0.45 s before the scene ends.
params:
- title: string ≤ 54, required
- growth: {mode, points: [{label, value, at}] 2–8 non-decreasing, unit? (default "reach"), source?, showValues?}
- rect: {x, y, width, height} canvas px (width ≥ 420, height ≥ 160); usually omit it [guided and bespoke tiers only]
- density: "fill" (an explicit rect's text grows to fill it; recommended with rect in 16:9) | "fixed" [guided and bespoke tiers only]
- accent: #rrggbb [guided and bespoke tiers only]
- theme: {surface, foreground, muted, border, accentText?} [guided and bespoke tiers only]
- presentation: "solid" | "glass" [guided and bespoke tiers only]
- motion: {enter, exit, distance, enterDuration, exitDuration, scale} [guided and bespoke tiers only]
events: enter, point-<i>-settle

### hook-title (hides captions)
Opening claim or question, readable on frame 0, with 1–3 kinetic emphasis words and an optional kicker sticker. Hides captions.
params:
- headline: string, required, max 90 — the opening line (set in display caps, up to five balanced lines)
- emphasis: string | [{text, at?, color?}], max 3 — whole words of the headline that light up at `at` (scene seconds) with a bar and glow
- kicker: string, max 18 — short sticker line that pops in, e.g. "Why?"
- kickerAt: seconds — scene seconds for the kicker pop
- eyebrow: string, max 32 — small mono label above the headline
- color: string, one of "primary" | "accent", default "primary" — brand colour role for emphasis
- align: string, one of "center" | "left", default "center (left for flush and low)"
- rect: object, optional — {x,y,width,height} canvas px inside the safe zone; default: centred near the centre of mass [guided and bespoke tiers only]
- variant: string, one of "centered" | "flush" | "boxed" | "low", optional — the layout: centered (glow), flush (left, accent bar), boxed (bordered panel) or low (left, bottom of the frame); default: the style's variants[module], else centered; usually leave it to the style
events: title, emphasis-<n>, kicker
variants: centered (default), flush, boxed, low

### kinetic-words (hides captions)
Lands 1–3 words per beat, timed to the voice; each beat replaces the last (or stacks into a sentence). Hides captions.
params:
- words: [{text, at, emphasis?, color?}], required, max 12 — beats: 1–3 words each, `at` in scene seconds (at least 0.3 s apart)
- variant: string, one of "scale" | "rise", default "scale" — scale: punch in from large and blurred; rise: lines rise through a mask
- layout: string, one of "replace" | "stack", default "replace" — stack keeps up to 5 beats on screen and dims earlier ones
- color: string, one of "primary" | "accent", default "primary" — brand colour role for emphasis
- rect: object, optional — {x,y,width,height} canvas px inside the safe zone; default: centred near the centre of mass [guided and bespoke tiers only]
events: beat-<n>

### count-up (keeps captions)
One big number that counts from `from` to `value` with prefix/suffix, then hits with an underline and/or spark burst. Keeps captions.
params:
- value: number, required
- from: number, default 0
- prefix: string, max 4 — e.g. "$"
- suffix: string, max 6 — e.g. "%", "k", "×"
- decimals: integer, min 0, max 3, default 0
- separator: boolean, default true — thousands commas
- label: string, required, max 60 — what the number means (two lines at most)
- note: string, max 48 — source or qualifier in small mono caps
- countAt: seconds, default 0.35
- countDuration: seconds, min 0.3, max 6, default 1.2
- hit: string, one of "underline" | "spark" | "both" | "none", default "underline"
- color: string, one of "primary" | "accent", default "primary" — brand colour role for emphasis
- rect: object, optional — {x,y,width,height} canvas px inside the safe zone; default: centred near the centre of mass [guided and bespoke tiers only]
events: count, hit

### equation-lockup (hides captions)
Names a law or formula: typeset terms land one by one, an optional term is boxed, with a name above and a caption line below. Hides captions.
params:
- equation: string, max 64 — e.g. "dT/dt = −k (T − T_room)"; spaces outside parentheses split terms; a/b is a fraction, x_sub and x^2 are scripts
- terms: [string], max 9 — explicit terms instead of `equation`
- name: string, max 48 — the law's name, set in small caps above
- note: string, max 70 — one caption line below
- highlight: integer | string — term index or exact term text to box in the emphasis colour
- highlightAt: seconds
- at: seconds, default 0.35 — first term lands
- stagger: seconds, default 0.22
- color: string, one of "primary" | "accent", default "primary" — brand colour role for emphasis
- rect: object, optional — {x,y,width,height} canvas px inside the safe zone; default: centred near the centre of mass [guided and bespoke tiers only]
events: term-<n>, lockup, highlight

### cta (hides captions)
End card: big action line, optional detail, and a handle/URL pill with a pulsing ring; `loop: true` fades to the background for a seamless loop. Hides captions.
params:
- action: string, required, max 40 — e.g. "Follow for part two"
- emphasis: string, max 30 — whole words of the action to colour
- detail: string, max 80 — two lines at most; shrinks to the 44 px floor, and a long URL may wrap after "/"
- handle: string, max 64 — @handle or URL, no spaces (fits github.com/<owner>/<repo>; the pill shrinks to the 44 px floor before failing)
- icon: string, one of "arrow" | "plus" | "loop" | "bell" | "none", default "arrow (loop when loop is true)"
- loop: boolean, default false
- color: string, one of "primary" | "accent", default "primary" — brand colour role for emphasis
- rect: object, optional — {x,y,width,height} canvas px inside the safe zone; default: centred near the centre of mass [guided and bespoke tiers only]
- variant: string, one of "centered" | "flush" | "boxed" | "low", optional — the layout: centered (glow), flush (left, accent bar), boxed (bordered panel) or low (left, bottom of the frame); default: the style's variants[module], else centered; usually leave it to the style
events: action, handle, loop
variants: centered (default), flush, boxed, low

### function-chart (keeps captions)
Plots a formula over time as a line that draws on, with a probe readout riding the tip, optional baseline, gap bars and a tail-zoom inset.
params:
- fn: string expression in t (or x): + - * / ^ ( ), numbers, pi, e, exp log sqrt sin cos abs — e.g. "20 + 70 * 2^(-t/10)"
- x: [min, max, unit?] or {min, max, unit?, label?}
- y: [min, max, unit?] or {min, max, unit?, label?}
- title: string ≤ 60 (optional)
- label: disclaimer, e.g. "illustrative values" (optional)
- baseline: number or {value, label?} — asymptote line, gap bars measure from it
- gap_bars: [x, …] or [{x, at?, label?}] up to 5; events gap-bar-0…
- probe: true (default) | false | {label}
- tail_zoom: {from: x, at?, corner?} — magnified inset of the tail; event tail-zoom
- draw: {at?, duration?, ease?}; event draw
- decimals: integer 0–3
- color: primary | accent | paper | #rrggbb (contrast ≥ 3:1 on bg)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: draw, gap-bar-<i>, probe-settle, tail-zoom

### gauge-compare (keeps captions)
Two thermometer (or column) gauges fill to their values with count-up readouts, then a bracket measures the gap between them (shared object for morphs).
params:
- left: {label, value, unit?, color? (primary | accent | paper | #rrggbb (contrast ≥ 3:1 on bg)), at? (seconds from scene start (optional; else a matching hit, else a default))}
- right: {label, value, unit?, color?, at?} — same unit as left
- gap: {object? ("gap-bracket"), label? ("Gap"), value? (must equal |left − right|), unit?, at?} or false
- scale: {min, max} (optional, default 0..nice max)
- title: string ≤ 48 (optional)
- style: "thermometer" | "column"
- decimals: integer 0–2
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: left-fill, right-fill, gap-bracket

### flow-compare (keeps captions)
Two pipes whose particles stream at different rates: "big X → fast, small X → slow".
params:
- top: {label, rate (relative > 0), value? (tag such as "fast"), color?, at?}
- bottom: {label, rate, value?, color?, at?}
- title: string ≤ 48 (optional)
- note: string ≤ 60 (optional)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: top-flow, bottom-flow

### process-steps (keeps captions)
A sequence or mechanism as 2–5 connected numbered nodes that light up in order.
params:
- steps: [string | {label ≤ 32, detail? ≤ 64, at?}] 2–5
- title: string ≤ 48 (optional)
- layout: "vertical" (portrait default) | "horizontal"
- numbered: boolean (default true)
- color: primary | accent | paper | #rrggbb (contrast ≥ 3:1 on bg)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: step-<i>

### archive-card (hides captions)
A historical paper plate or quote card with a source line, date and a stamp that slams in. Hides captions.
params:
- quote: string ≤ 160 (quote or title required)
- title: string ≤ 60
- source: string ≤ 80 (required)
- date: string ≤ 24, e.g. "1701"
- stamp: string | {text, at?} | false (default: the date)
- kicker: string ≤ 20 (default "ARCHIVE")
- image: assets/… local image (optional)
- reveal_at: seconds from scene start (optional; else a matching hit, else a default)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: quote, stamp

### logo-row (keeps captions)
A row or grid of 2–6 local logos with labels that pop in with a stagger.
params:
- logos: [{src: "assets/…(.svg|.png|.jpg|.webp)", label ≤ 20, at?}] 2–6
- title: string ≤ 48 (optional)
- at: first pop time
- stagger: seconds between pops (default 0.14)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: logo-<i>

### brand-lockup (hides captions)
Title or end card built from the brand's own artwork: the logo mark beside or above the wordmark image, an optional eyebrow and headline; the end variant stacks them over a badge image (e.g. an app-store badge) and a URL pill. Hides captions.
params:
- variant: title|end (default title)
- layout: row|stack (mark beside or above the wordmark; default row for title, stack for end)
- mark: "assets/…" square logo image (.svg|.png|.jpg|.webp), or {src, ratio}
- wordmark: "assets/…" wide wordmark image, or {src, ratio: width ÷ height (default 4)}; mark or wordmark is required
- tint: none|paper|ink|primary|accent|#rrggbb — recolour the wordmark, e.g. paper for a dark wordmark on a dark background (default none)
- markTint: the same for the mark (default none)
- eyebrow: string ≤ 40, small caps above the lockup (optional)
- headline: string ≤ 80, two lines at most, below the lockup (optional)
- badge: end only: "assets/…" badge image, or {src, ratio (default 3, an app-store badge)}
- url: end only: URL or handle ≤ 64, no spaces, in a pill
- glow: primary|accent|false — the soft light that blooms behind the mark and keeps widening (default primary)
- shine: true|false — soft light: a sweep across the card as the mark lands, and a glint across the mark and wordmark once they have (default true)
- at: first beat (seconds from scene start (optional; else a matching hit, else a default); default 0.15 s)
- stagger: seconds between beats (default 0.35, scaled by the grammar)
events: mark, wordmark, eyebrow, headline, badge, url, shine

### punch-in (keeps captions)
Footage-led: a spring zoom on the base recording toward a focus point, timed to a word (a camera on the base, not an overlay). Steps punch in, further in or back out on successive words; blur adds a few frames of zoom blur on each move.
params:
- scale: 1.06–1.25 (default 1.12)
- at: seconds from scene start (optional; else a matching hit, else a default)
- focus: {x, y} canvas fractions (default base.focus, else {0.5, 0.42})
- release: seconds before the scene end when the zoom springs back (0.3–2, default min(0.5, 30% of the scene))
- steps: [{at, scale}] 1–4, instead of at/scale: each springs to its scale (1–1.35; the first ≥ 1.06), at least 0.3 s apart
- blur: true (14 px at 1080) or 2–30 px: velocity-shaped zoom blur, 0 once settled (default off)
events: punch, step-<i>, release

### zoom-through (keeps captions)
Footage-led: hides a cut in the recording. The frame rushes toward the presenter with zoom blur into the cut and bursts back out of the next take, for "but wait", a contrast or a jump between takes. A camera on the base; defaults to the edit's cut nearest the scene's middle.
params:
- at: the cut, seconds from scene start (default: the nearest cut in the edit, else the middle)
- scale: 1.6–3.5 (default 2.6)
- rush: seconds into the cut (0.15–0.6, default 0.3)
- burst: seconds out of it (0.2–0.8, default 0.4)
- focus: {x, y} canvas fractions (default the presenter's face)
- blur: true (default, 24 px at 1080), false, or 2–40 px
events: rush, cut

### footage-callout (keeps captions)
Footage-led: a claim sticker anchored to a point on the footage by a leader line, placed inside the safe zone.
params:
- text: claim ≤ 42 chars, up to 2 lines
- label: kicker ≤ 24 (optional)
- point: {x, y} canvas fractions 0.04–0.96 (the anchored spot)
- side: auto|above|below|left|right
- tone: primary|paper|dark
- tilt: degrees −6–6 (default −2)
- at: seconds from scene start (optional; else a matching hit, else a default)
events: point, sticker

### lower-third (keeps captions)
Footage-led: a name and title bar that slides in above the caption band.
params:
- name: string ≤ 32
- title: string ≤ 48 (optional; the role)
- align: left|center
- tone: dark|primary|pill (the name in bold capitals in a glowing brand pill, the role under it)
- at: seconds from scene start (optional; else a matching hit, else a default)
events: name, title

### emphasis-caption (keeps captions)
Footage-led: one to three big words that pop over the footage; hides the captions while on screen.
params:
- text: 1–3 words, ≤ 24 chars
- color: primary|accent|paper or #hex (≥ 3:1 on the bg outline)
- position: center|upper|lower
- stagger: seconds between words (default 0.09)
- at: seconds from scene start (optional; else a matching hit, else a default)
events: pop, word-<i>

### masthead (keeps captions, behind the presenter, needs the subject)
Footage-led, behind the presenter: one huge word (a product name or the one idea) rises in letter by letter at the top of the frame, and the presenter's head covers its lower part like a magazine cover. Needs headroom: medium or wide shots.
params:
- word: one word ≤ 12 chars (uppercased)
- kicker: small line above it ≤ 32 (optional)
- color: paper (default)|primary|accent or #hex (≥ 3:1 on brand bg)
- stagger: seconds between letters (0–0.12, default 0.05)
- baseline: how far down the head the letters stand, as a share of its height (0–0.35; default as deep as keeps 70% of the letters clear). Lower raises them and shrinks them into the headroom
- at: seconds from scene start (optional; else a matching hit, else a default)
events: title

### dolly-zoom (keeps captions, behind the presenter, needs the subject)
Footage-led, behind the presenter: the room pushes in (or falls away) over one eased beat while the presenter holds still, a dolly zoom for a realisation or a turn. Needs a medium or wide shot and the matte's room plate.
params:
- direction: push (default) | pull (starts on a cut, the room falls away)
- scale: 1.12–1.6 (default 1.3)
- move: seconds the zoom takes (1–2.5)
- release: push: seconds to ease back before the scene end (0.3–1, default 0.5)
- at: seconds from scene start (optional; else a matching hit, else a default)
events: move, release

### product-demo (keeps captions)
A recorded product flow (launchclip demo record) in a window or full bleed, with zooms to each clicked or typed-into element, accent outlines as actions land, callout pills and click/keystroke SFX, all timed from the flow's action log.
params:
- media: {src: "assets/demo/<flow>.mp4", sourceStart: seconds into the clip (default 0)}
- viewport: {width, height} of the recording in CSS px (default 1920×1080; from <flow>.actions.json)
- actions: [{at (s from scene start), type: click|type|focus, box: {x, y, width, height} viewport px, keys?: [s], until?: s, label?, navigates?: true when it changes the page}] ≤ 24 — build with productDemoParams(<flow>.actions.json)
- callouts: [{at, text ≤ 42 chars, box (the element it points at), duration? 0.8–6 s (default 2.2)}] ≤ 4, not overlapping; one on an action's box ends when that action navigates or the camera leaves it
- frame: window|full (full needs the canvas aspect; default window)
- zoom: false, or {max: 1–2.5 (default 1.8)}
- title: string ≤ 48 (optional, for logs)
events: click-<i>, key-<i>-<k>, zoom-<k>, callout-<i>

### photo-scene (keeps captions)
One full-bleed photo or video from assets/ with a slow Ken Burns move (push, pull or pan), an optional scrim and 1–3 short kinetic text lines above the caption band. Keeps captions.
params:
- media: "assets/…" image (.jpg|.png|.webp|.svg) or video (.mp4|.webm|.mov), or {src, kind?, sourceStart? (video)}
- move: push-in|pull-out|pan-left|pan-right|pan-up|pan-down (default push-in); linear over the whole scene
- zoom: 0.02–0.25, how far the move scales (default 0.08: 1 → 1.08)
- focus: {x, y} 0.15–0.85 fractions of the frame the push centres on (default {x: 0.5, y: 0.5})
- scrim: none|bottom|left|full (default bottom with lines, full when centred, none without lines)
- lines: [{text ≤ 40, at?, emphasis?: true colours it primary}] 1–3 (or strings), rising in stagger apart; at most one line each
- align: left|center (default left)
- title: string ≤ 60, the photo's alt text (optional)
events: enter, line-<i>

### evidence-clip (keeps captions)
A capture of a real public page (launchclip evidence capture: a PR diff, a model card, an announcement, an article) playing in a glass window with an accent rim glow and a source tag (publisher · date) above it, with optional post zooms to boxes in the clip and a gliding cursor. Keeps captions.
params:
- media: {src: "assets/evidence/<id>.mp4", sourceStart?: seconds}
- viewport: {width, height} of the capture in px (from <id>.evidence.json) — build with evidenceClipParams(sidecar) or launchclip evidence scene
- source: {publisher ≤ 40, date? ≤ 24} the tag above the window (default from the sidecar provenance)
- frame: glass|none (default glass)
- push: 0–0.12, the slow push-in over the scene (default 0.04)
- focus: [{at, box: {x, y, width, height} capture px, scale? 1.05–2.5, until?}] ≤ 4, in order: post zooms on top of the capture's own beats
- cursor: [{at, x, y (capture px), click?}] ≤ 12, ≥ 0.2 s apart: a post cursor that glides to each point by its time
- title: string ≤ 60 (optional, for logs)
events: enter, source, focus-<i>, click-<i>

### feed-frame (hides captions, needs the subject)
Footage-led: the recording springs into a portrait feed window on a dark backdrop and the presenter breaks out over its top and sides, with generic feed chrome (icons, the user's handle, a caption, a progress bar). For "this exact video", posting or going viral. Counts appear only when given. Hides captions.
params:
- handle: @handle ≤ 24 (optional; shows the avatar row)
- caption: one line ≤ 60 (optional)
- counts: {likes?, comments?, shares?} strings ≤ 8 the user supplied (optional; never invent them)
- follow: boolean (default true with a handle)
- scale: window size 0.55–0.85 of the frame
- release: seconds to spring back (0.3–1)
- at: seconds from scene start (optional; else a matching hit, else a default)
events: frame, chrome, release

### pull-back (hides captions)
Footage-led: the recording shrinks into an app window while real steps tick off beside it and a progress bar counts to 100%. For "and this video was made by…", a process finishing, or a product reveal. Hides captions.
params:
- steps: 1–4 real steps ≤ 28 chars each (required)
- title: window title ≤ 32 (e.g. a file or product name)
- label: progress label ≤ 20 (default "Rendering")
- scale: window size 0.4–0.75
- release: seconds to spring back (0.3–1.2)
- at: seconds from scene start (optional; else a matching hit, else a default)
events: pull, step-<i>, done

### backdrop-swap (keeps captions, behind the presenter, needs the subject)
Footage-led, behind the presenter: the room dissolves into a backdrop (brand gradient, or a supplied product screenshot or video) and the presenter glides down in front of it; an optional title sits above their head. For the turn from the problem to the product.
params:
- backdrop: {src: assets/ image or video (a demo-autopilot flow: assets/demo/<flow>.mp4), sourceStart?: seconds (video), fit?: cover|contain} (default: a brand gradient)
- title: ≤ 32 (optional)
- scale: presenter size 0.6–0.95 (default 0.78)
- release: seconds to glide back (0.3–1)
- at: seconds from scene start (optional; else a matching hit, else a default)
events: swap, release

### app-stage (keeps captions, behind the presenter, needs the subject)
Footage-led, behind the presenter: the product UI (a screenshot or recording) slides down to fill the top of the frame and the presenter's head rises over its bottom edge. Needs headroom; for showing the app while talking about it.
params:
- media: {src: assets/ image or video (a demo-autopilot flow: assets/demo/<flow>.mp4), sourceStart?: seconds (video), fit?: cover|contain} (required)
- title: app or page title ≤ 32 (optional)
- at: seconds from scene start (optional; else a matching hit, else a default)
events: stage

### phone-stage (keeps captions)
Footage-led: a phone springs in beside the presenter's head and plays a real screen recording or screenshot (a demo-autopilot flow fits), floating gently while the room pans away from it. For showing the app on a phone while explaining it.
params:
- media: {src: assets/ image or video (a demo-autopilot flow: assets/demo/<flow>.mp4), sourceStart?: seconds (video), fit?: cover|contain} (required)
- side: auto|left|right (default: the side with more room)
- pan: boolean: pan the room away (default true)
- at: seconds from scene start (optional; else a matching hit, else a default)
events: phone

### growth-line (keeps captions, behind the presenter, needs the subject)
Footage-led, behind the presenter: a line chart draws itself across the top of the frame behind their head and kicks up at the take-off point into a glowing spike with a labelled pill. For growth results ("doubled", "took off in week three"). Illustration by default; real figures need a source.
params:
- points: [{value, label? ≤ 6}] 3–10 (the shape; labels sit along the top)
- mode: illustration (default) | data (needs source)
- source: ≤ 48, required for data
- takeoff: index of the point the spike starts from (default: before the biggest rise)
- pill: label ≤ 16 above the end, e.g. "Scale" (optional)
- draw: seconds the line takes (0.8–3)
- at: seconds from scene start (optional; else a matching hit, else a default)
events: draw, takeoff, pill

### glass-word (keeps captions, behind the presenter, needs the subject)
Footage-led, behind the presenter: one big word of extruded clear glass stands on the wall at head height, turned in perspective, and a light sweeps across it; the head covers the middle letters. For naming the one idea or a brand in a premium, tech look.
params:
- word: one word ≤ 10 (uppercased)
- tint: clear (default) | primary | accent
- turn: degrees the word turns away (−35–35, default −18)
- sweep: boolean (default true)
- at: seconds from scene start (optional; else a matching hit, else a default)
events: reveal, sweep

### orbit-cards (keeps captions, needs the subject)
Footage-led, around the presenter: 3–6 real items (screenshots, posts, logos, quotes the user supplied) on cards whip in and circle the presenter's chest, passing behind them on the far side and in front on the near. For social proof or "all these tools". Never invent items.
params:
- items: [{image?: assets/ image, text?: ≤ 40}] 3–6, each real
- speed: degrees per second (8–60, default 26)
- at: seconds from scene start (optional; else a matching hit, else a default)
events: orbit

### proof-wall (keeps captions, needs the subject)
Footage-led, around the presenter: real proof pins itself to the wall behind them a card every few frames (quotes and headlines with their source, screenshots), then an optional hero card lands in front, on their chest, with a highlighter swipe on its key word. For "everyone is talking about it" or press and reviews. Never invent items.
params:
- items: [{text? ≤ 70 with source ≤ 32, image?: assets/ image, source?}] 3–8, each real
- hero: {text ≤ 48, highlight (a part of text), source} (optional)
- every: seconds between cards (0.05–0.4, default 0.1)
- at: seconds from scene start (optional; else a matching hit, else a default)
events: pin, hero

### scrapbook (keeps captions, needs the subject)
Footage-led, playful: paper and boiling crayon scribbles replace the room, the presenter slaps in as a paper sticker with a white border, and ransom-note letters land above their head with a marker ring and an optional line under them. For a number or claim ("100%", "3X", "$0", "FREE") in a handmade, creator-diary beat.
params:
- word: one word, number or claim ≤ 8 chars
- sub: a short line under it ≤ 20 (optional)
- at: seconds from scene start (optional; else a matching hit, else a default)
events: slap, letter-<i>

### doodle-outline (keeps captions, needs the subject)
Footage-led, playful: a hand-drawn marker line traces round the presenter just outside their silhouette and boils on threes, with up to four doodles (heart, star, crown, spark, arrow, bulb) drawing themselves beside their head. For a warm, creator-style beat on a personal line ("I built this", "my favourite part"). Without a traced outline only the doodles draw.
params:
- doodles: [{icon: heart | star | crown | spark | arrow | bulb, side?: left | right | top, at?}] 0–4 (default a spark and a heart)
- color: white (default) | primary | accent
- at: seconds from scene start (optional; else a matching hit, else a default)
events: trace, doodle-<i>

### concept-card (keeps captions)
A big word or short phrase (≤ 3 words) with an icon from the icon set and a sub-line, on a brand card beside the presenter or full frame. For naming a claim, a problem or a turn ("Security first", "Too slow", "Now: one click").
params:
- text: word or phrase ≤ 28, ≤ 3 words
- icon: icon name from kit/core/icons.mjs (optional)
- sub: sub-line ≤ 64 (optional)
- tone: word colour: paper (default) | primary | accent
- at: word time
- variant: one of the module's VARIANTS, its designed look (optional; default: the style's variants[module], else the first); usually leave it to the style
- surface: card | plate (default: card over footage, plate on a plate or insert)
- rect: {x, y, width, height} canvas px inside the safe zone (optional; default: placed by lane) [guided and bespoke tiers only]
events: icon, word, sub
variants: stacked (default), side-icon, banner, marker

### icon-row (keeps captions)
Two to five icons from the icon set, each with a short label, that pop in one by one on their words: a row, or a list when the labels are long or the room is narrow. For lists of features, steps or audiences.
params:
- items: [{icon: icon name, label ≤ 24, at?}] 2–5
- title: string ≤ 48 (optional)
- layout: auto (default) | row | list
- stagger: seconds between pops (default 0.18)
- at: first pop time
- variant: one of the module's VARIANTS, its designed look (optional; default: the style's variants[module], else the first); usually leave it to the style
- surface: card | plate (default: card over footage, plate on a plate or insert)
- rect: {x, y, width, height} canvas px inside the safe zone (optional; default: placed by lane) [guided and bespoke tiers only]
events: item-<i>
variants: tiles (default), pills, orbit, list

### section-card (keeps captions)
A section opener in the brand frame: a kicker ("Part 2", "The fix"), a rule that draws out and a big section title, with an optional chapter number or icon. For the start of each section of a longer video.
params:
- title: section title ≤ 48
- kicker: string ≤ 28 (optional, uppercased)
- number: chapter number 1–99 (optional)
- icon: icon name (optional; not with number)
- at: title time
- variant: one of the module's VARIANTS, its designed look (optional; default: the style's variants[module], else the first); usually leave it to the style
- surface: card | plate (default: card over footage, plate on a plate or insert)
- rect: {x, y, width, height} canvas px inside the safe zone (optional; default: placed by lane) [guided and bespoke tiers only]
events: kicker, title
variants: centered (default), split, tab, frame

### object-card (keeps captions)
A simple illustrated object built from the icon set and brand shapes (boat, box, calendar, laptop, rocket, smartphone, chart, shield, mail, trophy, lightbulb, globe, team, gift), with a caption and an optional label. For naming a product, a deliverable or an idea as a thing ("it ships in a box", "your calendar, handled").
params:
- object: boat | box | calendar | laptop | rocket | smartphone | chart | shield | mail | trophy | lightbulb | globe | team | gift
- caption: string ≤ 48
- label: string ≤ 24 (optional, uppercased)
- at: object time
- variant: one of the module's VARIANTS, its designed look (optional; default: the style's variants[module], else the first); usually leave it to the style
- surface: card | plate (default: card over footage, plate on a plate or insert)
- rect: {x, y, width, height} canvas px inside the safe zone (optional; default: placed by lane) [guided and bespoke tiers only]
events: object, caption
variants: stage (default), polaroid, split, spotlight

### stat-card (keeps captions)
One real figure, big, that counts up to its value and lands, with a label and its source line ("Source: …", required). For a number the script states: a result, a price, a count. Never for a made-up or illustrative figure.
params:
- value: the figure as said ≤ 12, with a digit ("87%", "3.2×", "$1,400")
- label: what it measures ≤ 48
- source: where it comes from ≤ 60 (required; not a placeholder)
- icon: icon name (optional)
- count: boolean (default true when the value starts with a number)
- tone: value colour: primary (default) | accent | paper
- at: count start
- variant: one of the module's VARIANTS, its designed look (optional; default: the style's variants[module], else the first); usually leave it to the style
- surface: card | plate (default: card over footage, plate on a plate or insert)
- rect: {x, y, width, height} canvas px inside the safe zone (optional; default: placed by lane) [guided and bespoke tiers only]
events: count, hit
variants: giant (default), ring, bar, ticker

### quote-card (keeps captions)
A real quote with its attribution: a quote mark, the words (one phrase can light up on a marker), then "— Name" and their role or where it was said. For a customer, press or expert line the user supplied. Never invent a quote or attribute one to "a customer".
params:
- quote: the exact words ≤ 180
- author: the named person or organisation ≤ 40 (required; not "a customer")
- role: title or company ≤ 48 (optional)
- source: where it was said ≤ 60 (optional)
- highlight: a phrase from the quote (optional)
- at: quote time
- variant: one of the module's VARIANTS, its designed look (optional; default: the style's variants[module], else the first); usually leave it to the style
- surface: card | plate (default: card over footage, plate on a plate or insert)
- rect: {x, y, width, height} canvas px inside the safe zone (optional; default: placed by lane) [guided and bespoke tiers only]
events: quote, author, highlight
variants: mark (default), pull, bubble, centered

### excerpt (keeps captions)
A real excerpt in a window: 1–8 lines of code or text exactly as written in the source (README, docs, an article, a commit), revealed line by line; marked lines get a highlight sweep while the rest dim. The source line is required. Never paraphrase or invent lines.
params:
- lines: [string | {text ≤ 64 (verbatim), highlight?: boolean}] 1–8
- type: text (default) | code (monospace, one line each)
- title: file name or document ≤ 48 (optional)
- source: where it comes from ≤ 60 (required)
- highlightAt: seconds from scene start (optional; default after the lines)
- at: first line time
- variant: one of the module's VARIANTS, its designed look (optional; default: the style's variants[module], else the first); usually leave it to the style
- surface: card | plate (default: card over footage, plate on a plate or insert)
- rect: {x, y, width, height} canvas px inside the safe zone (optional; default: placed by lane) [guided and bespoke tiers only]
events: lines, highlight
variants: window (default), terminal, document, stack

### compare (keeps captions)
A comparison in two panels: before and after (the old way with crosses, an arrow, the new way with ticks on a primary-edged panel) or two neutral columns. Side by side when it fits, else stacked. For a claim that contrasts two ways, tools or states.
params:
- left: {title ≤ 24, items: [≤ 40] 1–4, icon?}
- right: {title ≤ 24, items: [≤ 40] 1–4, icon?}
- mode: before-after (default) | columns
- stagger: seconds between items (default 0.16)
- at: left panel time
- variant: one of the module's VARIANTS, its designed look (optional; default: the style's variants[module], else the first); usually leave it to the style
- surface: card | plate (default: card over footage, plate on a plate or insert)
- rect: {x, y, width, height} canvas px inside the safe zone (optional; default: placed by lane) [guided and bespoke tiers only]
events: left, right
variants: panels (default), split, table, cards

### timeline (keeps captions)
Two to six steps along a line: numbered (or icon) nodes that pop as each step is said while a primary line runs on to them, with a label and optional detail. Vertical in 9:16, across in 16:9 when the labels fit. For a process, a history or a roadmap.
params:
- steps: [{label ≤ 28, detail? ≤ 40, icon?, at?}] 2–6
- title: string ≤ 48 (optional)
- direction: auto (default) | vertical | horizontal
- stagger: seconds between steps (default 0.45)
- at: first step time
- variant: one of the module's VARIANTS, its designed look (optional; default: the style's variants[module], else the first); usually leave it to the style
- surface: card | plate (default: card over footage, plate on a plate or insert)
- rect: {x, y, width, height} canvas px inside the safe zone (optional; default: placed by lane) [guided and bespoke tiers only]
events: step-<i>
variants: rail (default), milestones, cards, stairs

### bar-chart (keeps captions)
Bars or columns grow to their values with counting labels; one bar can be highlighted after the build. Columns turn sideways when their labels do not fit.
params:
- data: [{label ≤ 24, value ≥ 0, color? (primary | accent | paper | #rrggbb)}] 2–10
- format: {style?: "number" | "currency" | "percent" | "unit", currency? (ISO code, "USD"), unit? ("km", "ms", "users"), decimals? 0–3, compact? (12.4K, 3.1M), separator? (thousands commas, default true), prefix?, suffix?}
- max: axis maximum (optional; default the largest value)
- tone: bar colour (primary | accent | paper | #rrggbb; default primary)
- highlight: index of the bar to keep lit while the others dim (optional)
- highlightAt: seconds from scene start (optional; else a matching hit, else a default)
- title: string ≤ 60 (optional)
- source: string ≤ 80, where the numbers come from (optional)
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, highlight
variants: columns (default), bars, lollipop, blocks

### stacked-bar (keeps captions)
Stacked columns or bars: each category builds series by series with a legend and totals; data from params.
params:
- categories: [string ≤ 20] 2–7
- series: [{label ≤ 20, values: [number ≥ 0 per category], color? (primary | accent | paper | #rrggbb)}] 2–5
- format: {style?: "number" | "currency" | "percent" | "unit", currency? (ISO code, "USD"), unit? ("km", "ms", "users"), decimals? 0–3, compact? (12.4K, 3.1M), separator? (thousands commas, default true), prefix?, suffix?}
- totals: boolean (default true)
- title: string ≤ 60 (optional)
- source: string ≤ 80, where the numbers come from (optional)
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build
variants: columns (default), bars

### pie-chart (keeps captions)
Donut, pie or half-donut: slices sweep on in one continuous turn, the legend lands slice by slice, and the centre counts up the total; one slice can be highlighted.
params:
- data: [{label ≤ 22, value ≥ 0, color? (primary | accent | paper | #rrggbb)}] 2–6
- percent: boolean: the legend shows shares (default true) or values
- format: {style?: "number" | "currency" | "percent" | "unit", currency? (ISO code, "USD"), unit? ("km", "ms", "users"), decimals? 0–3, compact? (12.4K, 3.1M), separator? (thousands commas, default true), prefix?, suffix?}
- center: {value? (default the counting total), label? ("Total")} or false; donut and half only
- highlight: slice index (optional)
- highlightAt: seconds from scene start (optional; else a matching hit, else a default)
- title: string ≤ 60 (optional)
- source: string ≤ 80, where the numbers come from (optional)
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, highlight
variants: donut (default), pie, half

### area-chart (keeps captions)
One to three series over labelled points: the area and line reveal left to right and the end value lands; gradient, line-only or stepped.
params:
- labels: [string ≤ 12] 3–16, the x points
- series: [{values: [number per label], label? ≤ 20, color? (primary | accent | paper | #rrggbb)}] 1–3
- format: {style?: "number" | "currency" | "percent" | "unit", currency? (ISO code, "USD"), unit? ("km", "ms", "users"), decimals? 0–3, compact? (12.4K, 3.1M), separator? (thousands commas, default true), prefix?, suffix?}
- min: axis minimum (optional)
- max: axis maximum (optional)
- title: string ≤ 60 (optional)
- source: string ≤ 80, where the numbers come from (optional)
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build
variants: gradient (default), line, steps

### radar-chart (keeps captions)
Radar (spider) chart: the grid lands, then each series' shape grows out from the centre; 3–8 labelled axes.
params:
- axes: [string ≤ 16] 3–8
- series: [{values: [number ≥ 0 per axis], label? ≤ 20, color? (primary | accent | paper | #rrggbb)}] 1–3
- max: axis maximum (optional; default the largest value)
- title: string ≤ 60 (optional)
- source: string ≤ 80, where the numbers come from (optional)
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build
variants: polygon (default), circles, dots

### sparkline (keeps captions)
A KPI card: label, a value that counts along its trend, a delta chip and the sparkline drawing on (line, area or bars).
params:
- values: [number] 4–60, oldest first
- label: string ≤ 36, required
- value: headline text (optional; default the last value, counted)
- delta: string ≤ 10 such as "+12%" (default from first to last) or false
- format: {style?: "number" | "currency" | "percent" | "unit", currency? (ISO code, "USD"), unit? ("km", "ms", "users"), decimals? 0–3, compact? (12.4K, 3.1M), separator? (thousands commas, default true), prefix?, suffix?}
- tone: line colour (primary | accent | paper | #rrggbb)
- source: string ≤ 80 (optional)
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build
variants: line (default), area, bars

### progress-ring (keeps captions)
A ring (or half dial) fills to a value while the centre counts up, with a label below; plain, thick, segmented or half.
params:
- value: number, required (0..max)
- max: number (default 100: the value is a percent)
- label: string ≤ 40, required
- sub: string ≤ 60 (optional)
- format: {style?: "number" | "currency" | "percent" | "unit", currency? (ISO code, "USD"), unit? ("km", "ms", "users"), decimals? 0–3, compact? (12.4K, 3.1M), separator? (thousands commas, default true), prefix?, suffix?}
- tone: ring colour (primary | accent | paper | #rrggbb)
- at: fill start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build
variants: ring (default), thick, segmented, half

### funnel-chart (keeps captions)
A conversion funnel: stages widen in top to bottom with counting values and the step-to-step rate between them; tapered, bars or steps.
params:
- stages: [{label ≤ 24, value ≥ 0, color? (primary | accent | paper | #rrggbb)}] 2–6, widest first
- rates: boolean: show each step's conversion (default true)
- format: {style?: "number" | "currency" | "percent" | "unit", currency? (ISO code, "USD"), unit? ("km", "ms", "users"), decimals? 0–3, compact? (12.4K, 3.1M), separator? (thousands commas, default true), prefix?, suffix?}
- tone: base colour (primary | accent | paper | #rrggbb)
- title: string ≤ 60 (optional)
- source: string ≤ 80, where the numbers come from (optional)
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build
variants: tapered (default), bars, steps

### waterfall (keeps captions)
A waterfall (bridge) chart: a starting total, each gain or loss stepping from the last level, and the resulting total; gains in primary, losses in accent.
params:
- opening: {label ≤ 16, value}, the starting total
- steps: [{label ≤ 16, delta (+ or −)}] 1–8
- total: end column label ≤ 16 (default "Total")
- format: {style?: "number" | "currency" | "percent" | "unit", currency? (ISO code, "USD"), unit? ("km", "ms", "users"), decimals? 0–3, compact? (12.4K, 3.1M), separator? (thousands commas, default true), prefix?, suffix?}
- title: string ≤ 60 (optional)
- source: string ≤ 80, where the numbers come from (optional)
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build
variants: bridge (default), floating

### sankey (keeps captions)
A Sankey flow diagram: nodes in up to four columns, with ribbons as wide as each flow drawing from source to target column by column.
params:
- flows: [{from ≤ 18, to ≤ 18, value > 0}] 2–14; node columns follow the links
- format: {style?: "number" | "currency" | "percent" | "unit", currency? (ISO code, "USD"), unit? ("km", "ms", "users"), decimals? 0–3, compact? (12.4K, 3.1M), separator? (thousands commas, default true), prefix?, suffix?}
- title: string ≤ 60 (optional)
- source: string ≤ 80, where the numbers come from (optional)
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build
variants: ribbons (default), lines

### heatmap (keeps captions)
A heatmap grid: labelled rows and columns whose cells pop in a diagonal wave, shaded from the panel to the brand tone by value, with a low–high legend.
params:
- rows: [string ≤ 14] 1–10
- columns: [string ≤ 8] 2–14
- values: [[number per column] per row]
- showValues: boolean (default when cells are large enough)
- low: legend low label (default the minimum)
- high: legend high label (default the maximum)
- format: {style?: "number" | "currency" | "percent" | "unit", currency? (ISO code, "USD"), unit? ("km", "ms", "users"), decimals? 0–3, compact? (12.4K, 3.1M), separator? (thousands commas, default true), prefix?, suffix?}
- tone: shade (primary | accent | paper | #rrggbb)
- title: string ≤ 60 (optional)
- source: string ≤ 80, where the numbers come from (optional)
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build
variants: squares (default), circles, rounded

### leaderboard (keeps captions)
A ranked leaderboard: rows slide in from last place to first with rank badges, counting values and (bars) a bar each; one row can be called out.
params:
- entries: [{label ≤ 24, value ≥ 0, detail? ≤ 30, icon? (icon name), color? (primary | accent | paper | #rrggbb)}] 3–8
- sort: boolean: rank by value (default true)
- highlight: rank index to call out after the build (optional; first place is lit)
- highlightAt: seconds from scene start (optional; else a matching hit, else a default)
- format: {style?: "number" | "currency" | "percent" | "unit", currency? (ISO code, "USD"), unit? ("km", "ms", "users"), decimals? 0–3, compact? (12.4K, 3.1M), separator? (thousands commas, default true), prefix?, suffix?}
- title: string ≤ 60 (optional)
- source: string ≤ 80, where the numbers come from (optional)
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, highlight
variants: bars (default), rows, cards

### comparison-table (keeps captions)
A feature comparison table: headers pop, rows land one by one with ticks, crosses and short values, and one column can be outlined as the pick.
params:
- columns: [string ≤ 16] 2–4, the things compared
- rows: [{label ≤ 28, values: [true | false | null | string ≤ 10 per column]}] 2–8
- highlight: column index to outline after the build (optional)
- highlightAt: seconds from scene start (optional; else a matching hit, else a default)
- title: string ≤ 60 (optional)
- source: string ≤ 80, where the numbers come from (optional)
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, highlight
variants: grid (default), striped, cards

### odometer (keeps captions)
A rolling odometer: every digit spins on its own reel and the figure lands, lower places turning faster; plain, tiles or mechanical counter.
params:
- value: number ≥ 0, required
- from: start value (default 0; digits zero-pad)
- format: {style?: "number" | "currency" | "percent" | "unit", currency? (ISO code, "USD"), unit? ("km", "ms", "users"), decimals? 0–3, compact? (12.4K, 3.1M), separator? (thousands commas, default true), prefix?, suffix?}
- label: string ≤ 60 (optional)
- sub: string ≤ 70, e.g. a source (optional)
- span: seconds 0.4–4 (default 1.6)
- tone: digit colour (primary | accent | paper | #rrggbb; default paper)
- at: roll start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: count, landed
variants: plain (default), tiles, mechanical

### flip-clock (keeps captions)
Split-flap cards flip through 2–10 values (a date, a time, a score, a year), each changed card falling on its hinge; classic, brand or light cards.
params:
- values: [string ≤ 10] 2–10, e.g. ["2025", "2026"] or ["11:58", "11:59", "12:00"]; shorter values right-align
- interval: seconds between flips (default fits the scene, ≤ 0.9)
- label: string ≤ 60 (optional)
- sub: string ≤ 70 (optional)
- at: first flip: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: flip, flip-<n>
variants: classic (default), brand, light

### ticker-tape (keeps captions)
A scrolling ticker band of items, with optional values and ▲/▼ changes, looping seamlessly; brand band, minimal rules or an LED board, with an optional tag and title.
params:
- items: [string ≤ 24 | {label ≤ 16, value? (number or string ≤ 12), change? (percent)}] 3–14
- tag: string ≤ 10 such as "LIVE" (optional)
- title: string ≤ 60 above the band (optional)
- speed: px per second at 1080 (default 170)
- format: {style?: "number" | "currency" | "percent" | "unit", currency? (ISO code, "USD"), unit? ("km", "ms", "users"), decimals? 0–3, compact? (12.4K, 3.1M), separator? (thousands commas, default true), prefix?, suffix?}
- at: scroll start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: roll
variants: band (default), minimal, led

### slot-roll (keeps captions)
A slot-machine reel of words spins (motion-blurred) and lands on the final one; a boxed window, inline in a sentence ("Built for ___"), or a stack showing its neighbours.
params:
- items: [string ≤ 18] 2–10, the words on the reel
- final: the word it lands on (an item or index; default the last)
- prefix: string ≤ 36 before the reel (optional)
- suffix: string ≤ 36 after it (optional)
- spins: full turns before landing 1–5 (default 2)
- span: seconds 0.5–4 (default 1.5)
- tone: reel text colour (primary | accent | paper | #rrggbb)
- at: spin start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: spin, land
variants: window (default), inline, stack

### countdown (keeps captions)
A countdown from N to zero (or to `to`), each number punching in on its tick, then an optional end word; big digits, a depleting ring, or an mm:ss clock with a draining bar.
params:
- from: integer 1–3600, required
- to: integer (default 0)
- step: seconds per tick (default 1, shortened to fit the scene)
- end: string ≤ 14 shown after zero, e.g. "Live" (optional)
- label: string ≤ 60 (optional)
- sub: string ≤ 70 (optional)
- tone: colour (primary | accent | paper | #rrggbb)
- at: first tick: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: start, zero
variants: digits (default), ring, clock

### percent-fill (keeps captions)
A shape fills to a share while the figure counts: a round flask of rising liquid with a sliding wave, a battery, or a thick bar.
params:
- value: number, required (0..max)
- max: number (default 100: the value is a percent)
- format: {style?: "number" | "currency" | "percent" | "unit", currency? (ISO code, "USD"), unit? ("km", "ms", "users"), decimals? 0–3, compact? (12.4K, 3.1M), separator? (thousands commas, default true), prefix?, suffix?}
- label: string ≤ 60 (optional)
- sub: string ≤ 70 (optional)
- span: seconds 0.4–4 (default 1.6)
- tone: fill colour (primary | accent | paper | #rrggbb)
- at: fill start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: fill
variants: liquid (default), battery, bar

### device-frame (keeps captions)
A browser, phone, laptop or tablet frame rises in and its screen wipes on: a project image, or a mock screen in the brand (blocks, cards and a chart) with an optional title.
params:
- device: "browser" | "phone" | "laptop" | "tablet" (default phone in 9:16, browser in 16:9)
- image: assets/… screenshot (optional; else a mock screen)
- fit: "cover" | "contain"
- title: string ≤ 48 on the mock screen (optional)
- url: string ≤ 60 in the browser bar (optional)
- caption: string ≤ 80 under the frame (optional)
- at: lands: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: show
variants: clay (default), dark, outline

### window-chrome (keeps captions)
An app window with title-bar chrome around lines of text (rising in) or an image; the terminal variant types each line on after a prompt and leaves a blinking cursor.
params:
- lines: [string ≤ 64] 1–8 (or image)
- image: assets/… image (or lines)
- title: string ≤ 40 in the title bar (optional)
- stagger: seconds between lines (default fits the scene, ≤ 0.32)
- caption: string ≤ 80 under the window (optional)
- at: lands: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: show, line-<i>
variants: mac (default), minimal, terminal

### polaroid (keeps captions)
An instant photo drops in, tilts to rest and develops from dark, with a handwritten-style caption; single, a stack of three, or pinned.
params:
- image: assets/… photo (optional; else a brand gradient with an icon)
- icon: icon for the placeholder photo (default "image")
- caption: string ≤ 40 (optional)
- tilt: degrees −20–20 (default −4)
- at: drops: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: show
variants: single (default), stack, pinned

### sticker (keeps captions)
A die-cut sticker slaps on with a white edge and a shine sweep: a label with an optional icon, a round sticker, or a starburst.
params:
- text: string ≤ 24 (uppercased; or icon)
- icon: icon name (optional)
- tone: fill (primary | accent | paper | #rrggbb; default primary)
- tilt: degrees −20–20 (default −8)
- size: scale 0.5–1.5
- at: slap: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: slap
variants: die-cut (default), round, burst

### torn-paper (keeps captions)
A scrap of torn paper lands with a shadow that follows its ragged edge, and its words wipe on: a lined note, a torn headline strip in the brand colour, or a scrap torn on every side.
params:
- text: string ≤ 140, required
- kicker: string ≤ 28 above the text (optional)
- tilt: degrees −20–20
- at: lands: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: show
variants: note (default), strip, scrap

### tape-note (keeps captions)
A paper note drops onto the frame and strips of translucent tape press it down (two corners, the top, or both sides); a title, optional body and icon.
params:
- title: string ≤ 48, required
- text: string ≤ 120 (optional)
- icon: icon name (optional)
- tone: tape colour (primary | accent | paper | #rrggbb; default accent)
- tilt: degrees −20–20 (default 2)
- at: lands: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: show
variants: corners (default), top, sides

### badge (keeps captions)
A badge spins in and stamps down: a starburst, a seal with a dashed ring, or a shield, with a word (NEW, FREE, V2) and an optional sub-line and icon.
params:
- text: string ≤ 14, required (uppercased)
- sub: string ≤ 20 (optional)
- icon: icon name (optional)
- tone: fill (primary | accent | paper | #rrggbb; default primary)
- tilt: degrees −20–20 (default −10)
- at: stamp: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: stamp
variants: starburst (default), circle, shield

### ribbon (keeps captions)
A ribbon unfurls from its centre with a word or short line: a banner with folded tails, a flag with a notched end, or a price-tag shape.
params:
- text: string ≤ 32, required (uppercased)
- tone: fill (primary | accent | paper | #rrggbb; default primary)
- tilt: degrees −20–20
- at: unfurls: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: unfurl
variants: banner (default), flag, tag

### speech-bubble (keeps captions)
A speech or thought bubble pops out of its tail with the line inside: a soft rounded bubble, a bold comic bubble with an ink outline, or a chat message; optional speaker name.
params:
- text: string ≤ 120, required
- type: "speech" | "thought"
- tail: "bottom-left" | "bottom-right" | "left" | "right" (default bottom-left)
- name: speaker ≤ 24 (optional)
- at: pops: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: pop
variants: rounded (default), comic, chat

### tooltip (keeps captions)
A tooltip points at a spot on screen: a pulsing dot lands on the target and a box with an arrow rises beside it (above, or below when there is no room); dark, light or brand.
params:
- text: string ≤ 70, required
- title: string ≤ 28 (optional)
- target: {x, y} canvas px the tooltip points at (default the centre, a little low)
- at: shows: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: show
variants: dark (default), light, brand

### callout-arrow (keeps captions)
A label and an arrow that draws on from it to a point on screen, then rings the target: a curved arrow from a pill, a straight one, or a hand-drawn sketch with an italic note.
params:
- text: string ≤ 40, required
- target: {x, y} canvas px the arrow points at (default lower right)
- from: {x, y} canvas px where the label sits (default upper left)
- circle: boolean: ring the target (default true)
- tone: primary | accent | paper | #rrggbb
- at: points: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: point
variants: curve (default), straight, sketch

### motion-title (hides captions)
A title that animates in with one of the 24 named text effects (its variants: per character, per word, per line or the whole element), with an optional kicker, sub-line, highlighted words and brand plate. Hides captions.
params:
- text: string ≤ 90 (≤ 16 words), required
- kicker: string ≤ 32 above (optional)
- sub: string ≤ 90 below (optional)
- highlight: whole word or [words] 1–3 to colour with tone
- align: "center" | "left"
- plate: boolean: set the title on a brand-colour plate
- tone: primary | accent | paper | #rrggbb (highlight colour)
- speed: stagger speed 0.5–2 (default 1)
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first); one of the effects: soft-blur-in, per-character-rise, typewriter, bottom-up-letters, top-down-letters, stagger-from-center, stagger-from-edges, per-word-crossfade, spring-scale-in, shared-axis-y, blur-out-up, kinetic-center-build, short-slide-right, short-slide-down, depth-parallax-words, mask-reveal-up, line-by-line-slide, micro-scale-fade, shimmer-sweep, fade-through, shared-axis-z, scale-down-fade, focus-blur-resolve, shared-axis-x
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: title
variants: per-character-rise (default), soft-blur-in, typewriter, bottom-up-letters, top-down-letters, stagger-from-center, stagger-from-edges, per-word-crossfade, spring-scale-in, shared-axis-y, blur-out-up, kinetic-center-build, short-slide-right, short-slide-down, depth-parallax-words, mask-reveal-up, line-by-line-slide, micro-scale-fade, shimmer-sweep, fade-through, shared-axis-z, scale-down-fade, focus-blur-resolve, shared-axis-x

### icon-grid (keeps captions)
A grid of 2–12 icons from the icon set (1,935: LaunchClip's own and Lucide's) that pop in on a stagger, with optional labels: stroke icons, duotone icons, or icons on tinted tiles.
params:
- items: [icon name | {icon, label? ≤ 22}] 2–12
- title: string ≤ 60 (optional)
- columns: integer 1–6 (default by count and aspect)
- tone: primary | accent | paper | #rrggbb
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build
variants: stroke (default), duotone, tiles

### map-highlight (keeps captions)
A world map that fades in, zooms to the highlighted countries and pinned places when they sit close together, then fills the countries one by one with label pills and ×multiplier badges ("$20 · ×3.2"), drops pins on places by longitude and latitude with a label or a glass callout card (a photo card with an image), and draws a dashed travel route between the pins. Variants: plain fills, pins, glow, a glowing outline that traces itself, and a dot-matrix world.
params:
- highlight: [country | {country (name, common alias or ISO numeric code), label? ≤ 24, value? ≤ 12, badge? ≤ 8 ("×3.2"), color?}] 1–8 (one of highlight or pins, or both)
- pins: [{lon, lat, label ≤ 28, sub? ≤ 20 ("Ph.D. 2008"), card?: {title ≤ 28, sub? ≤ 32, image? (assets/… photo)}, color?}] 1–4 places; at most two cards (events pin-<i>)
- route: boolean: a dashed travel path from pin to pin, in order (default false; events route-<i>)
- focus: "auto" (zoom when the places are close; default) | "world"
- tone: primary | accent | paper | #rrggbb
- title: string ≤ 60 (optional)
- source: string ≤ 80 (optional)
- at: map lands: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, zoom, highlight-<i>, pin-<i>, route-<i>
variants: fill (default), pins, glow, outline, dots

### unit-grid (keeps captions)
An isotype: 1–200 units (a person by default, or any icon) that count in as a grid, then split into 2–3 labelled groups that slide apart and recolour ("49 lifters → 24 heavy, 25 light"), or light up a few and dim the rest ("1 in 10").
params:
- count: integer 1–200, the number of units
- icon: "person" (default) or an icon name from the icon set
- groups: [{count, label ≤ 24, tone? (good | bad | neutral | primary | accent | paper | #rrggbb)}] 2–3, counts adding up to count (optional; not with highlight)
- splitAt: the split: seconds from scene start (optional; else a matching hit, else a default)
- highlight: {count (1 to count − 1), label? ≤ 40, tone?} the first count units light up (optional)
- highlightAt: the highlight: seconds from scene start (optional; else a matching hit, else a default)
- tone: the units before the split: good | bad | neutral | primary | accent | paper | #rrggbb (default paper)
- columns: integer 1–25 (default: the largest units that fit)
- title: string ≤ 60 (optional)
- source: string ≤ 80, where the numbers come from (optional; a story-wide source note is frame.sources)
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, split, highlight
variants: solid (default), stroke, dots

### number-line (keeps captions)
A ruler over a range (1–25 reps, 0–100%) with 1–3 highlighted ranges, each with its label and tone ("8–12 = SIZE" in gold, "15+ = JUST CARDIO" in red), that light up one at a time on their cues, an optional marker that drops onto a value, glowing value points ("+0.3", "+23.0"), and a zoom inset that re-plots a slice of the line at a finer scale under dashed connectors ("wins by less than 1 point").
params:
- from: number, the start of the line
- to: number > from, the end
- step: tick spacing (optional; default a round step for about 25 ticks, at most 100)
- labelEvery: integer: label every n-th tick (optional; default the closest that fits; range ends are always labelled)
- ranges: [{from, to, label ≤ 28, tone? (good | bad | neutral | primary | accent | paper | #rrggbb), at?}] 1–3, inside the line, not overlapping; each lights up on its own cue (event range-<i>) (one of ranges, points or marker)
- points: [{value, label? ≤ 24, tone? (default accent)}] 1–8 glowing dots on the line, labels under the tick numbers (optional; event points)
- pointsAt: the points: seconds from scene start (optional; else a matching hit, else a default)
- zoom: {from, to (at most half the line), step?, label? ≤ 40, at?} a second ruler under the line re-plotting that slice and its points, joined by dashed connectors (optional; event zoom, last)
- marker: {value, label? ≤ 24, tone?, at?} a pin that drops onto one value (optional; event marker)
- unit: string ≤ 12 under the line's end ("reps") (optional)
- format: {style?: "number" | "currency" | "percent" | "unit", currency? (ISO code, "USD"), unit? ("km", "ms", "users"), decimals? 0–3, compact? (12.4K, 3.1M), separator? (thousands commas, default true), prefix?, suffix?}
- title: string ≤ 60 (optional)
- source: string ≤ 80 (optional; a story-wide source note is frame.sources)
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, range-0, range-1, range-2, marker, points, zoom
variants: ruler (default), track

### social-post (keeps captions)
A real social post (X, Threads, Bluesky, LinkedIn, Reddit or generic) as a high-fidelity card: avatar, name and tick, handle, body with coloured mentions and links, optional media, quoted post, "Replying to" and "Translated from" lines, time · date · views and the engagement row, with a small source line under it. It rises in, can sweep a highlight across a phrase on a word cue, then step forward into focus.
params:
- platform: x | threads | bluesky | linkedin | reddit | generic (default x)
- name: display name ≤ 50, as on the post
- handle: handle ≤ 40, with or without @ (u/ on Reddit); optional on LinkedIn
- verified: true | "blue" | "gold" | "gray": the tick (optional)
- avatar: assets/… the author's avatar from the capture (optional; else initials)
- text: the post's words ≤ 600, verbatim (an excerpt marks cuts with …); @mentions, #tags and links are coloured
- media: {image: assets/…, layout?: "below" | "side", aspect? w/h} the attached image (optional)
- quote: {name, handle?, verified?, avatar?, text ≤ 280, date?} a quoted post (optional)
- replyingTo: handle: a "Replying to @…" line (optional)
- translatedFrom: language: a "Translated from …" tag (optional)
- time: "6:06 AM" (optional)
- date: "Oct 25, 2026" (optional)
- ago: "2h": the relative time on Threads, Bluesky, LinkedIn and Reddit (optional)
- metrics: {replies?, reposts?, likes?, bookmarks?, views?}: numbers (shown as 1.2K) or strings as on the post
- title: Reddit post title ≤ 140
- community: Reddit subreddit (required on Reddit)
- headline: LinkedIn author headline ≤ 60
- source: {url, captured_at?, screenshot? (assets/…), schema? "launchclip.capture.v1"}: where the post lives (validation warns without url; a small source line always shows)
- demo: true marks a fictional demo account for tests and samples (handle must say "demo" or "example"; no source.url)
- highlight: a phrase of text (whole words), or [{text, at?}] 1–3: a highlight sweeps across it (events highlight, highlight-2, highlight-3; time it to a word with a scene hit)
- focus: true: the card steps forward with a rim glow after the highlight (event focus)
- focusAt: the focus: seconds from scene start (optional; else a matching hit, else a default)
- at: card build: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, highlight, highlight-2, highlight-3, focus
variants: glass (default), native, light

### social-stack (keeps captions)
2–5 real posts cascading in, one after another: the focused one lands in front with a rim glow while the others step back, blurred and dimmed (cascade), or a vertical list whose focused card steps forward (list). The focused post can sweep a highlight across a phrase.
params:
- posts: [post] each a social-post's post fields (platform, name, handle, verified, avatar, text, media, quote, time, date, metrics, source, demo…) 2–5
- focus: index of the post in front (default the last)
- focusAt: the focus: seconds from scene start (optional; else a matching hit, else a default)
- highlight: a phrase of the focused post, or [{text, at?}] 1–3 (events highlight, highlight-2, highlight-3)
- look: glass | native | light: the cards' look (default glass)
- stagger: seconds between cards (0.15–1.2, default 0.45)
- at: first card: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, focus, highlight, highlight-2, highlight-3
variants: cascade (default), list

### social-sort (keeps captions)
2–6 real posts pile up in the middle, then fly into 2–3 labelled columns ("Can't wait" / "Tired"): side by side in 16:9, stacked bands in 9:16, with dashed dividers.
params:
- posts: [post] each a social-post's post fields (platform, name, handle, verified, avatar, text, media, quote, time, date, metrics, source, demo…) 2–6, each with column (index into columns)
- columns: [label ≤ 24 | {label, tone? (primary | accent | paper | #rrggbb)}] 2–3
- sortAt: the sort: seconds from scene start (optional; else a matching hit, else a default)
- look: glass | native | light: the cards' look (default glass)
- at: first card: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, sort

### social-wall (keeps captions)
A wall of real posts in depth: many cards drift with parallax across the frame, smaller and blurrier further back, among soft bokeh orbs; then one or two are pulled forward, sharp and in focus, while the field dims. The first pulled post can sweep a highlight across a phrase.
params:
- posts: [post] each a social-post's post fields (platform, name, handle, verified, avatar, text, media, quote, time, date, metrics, source, demo…) 2–16 (the field repeats them)
- focus: index or [index, index]: the post(s) pulled forward (default 0)
- pullAt: the pull: seconds from scene start (optional; else a matching hit, else a default)
- highlight: a phrase of the first pulled post, or [{text, at?}] 1–3 (events highlight…)
- tiles: cards in the field, 6–24 (default 18)
- drift: "left" | "right" | "up" | "down" (default left)
- look: glass | native | light: the cards' look (default glass)
- at: field build: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, pull, highlight, highlight-2, highlight-3

### logo-sting (hides captions)
A channel intro or outro: a glass logo tile drops onto a reflective, lit floor in falling rain (or rising particles, or clear air), a shine sweeps it, and the channel name resolves out of a blur with an optional tagline. Hides captions.
params:
- name: string ≤ 32, the channel name
- logo: assets/… image (optional; default: a monogram)
- monogram: string ≤ 3 (default: the name's initials)
- tagline: string ≤ 48 under the name (optional)
- at: seconds from the scene start the logo lands (default 0.6)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
events: logo, name
variants: rain (default), particles, clear

### subscribe-cta (keeps captions)
A subscribe prompt for mid-video: a glass pill (avatar, channel name, Subscribe button, bell, like) slides in, a pointer clicks the button, it turns to Subscribed, the bell rings and the like fills, then the pill slides out. Sits above the captions; put it on an overlay track (track 1+) over a scene.
params:
- name: string ≤ 32, the channel name
- logo: assets/… image (optional; default: a monogram)
- monogram: string ≤ 3 (default: the name's initials)
- label: button text ≤ 14 (default Subscribe)
- done: after the click ≤ 14 (default Subscribed)
- position: left | center | right (default center)
- bell: true | false (default true)
- like: true | false (default true; false in compact and portrait)
- at: seconds from the scene start of the click (default 42% of the scene, at least 1.3)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
events: in, click, bell, out
variants: pill (default), compact

### channel-watermark (keeps captions)
A small corner watermark of the channel's mark (glass chip or bare), held at low opacity across the scenes it spans; put it on a high overlay track over the whole video.
params:
- name: string ≤ 32, the channel name
- logo: assets/… image (optional; default: a monogram)
- monogram: string ≤ 3
- corner: top-right | top-left | bottom-right | bottom-left (default top-right)
- opacity: 0.3–1 (default 0.7)
- showName: true | false: the name beside the mark (default false)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
variants: glass (default), bare

### repo-pr-card (keeps captions)
A GitHub pull request rebuilt as a glass card: repo, PR number, title, merged/open state chip, author avatar and date, and a −/+ excerpt with line numbers; a box draws round the highlighted token (a model name, a flag) on its word. Real data only: map a PR with src/evidence/github.js.
params:
- repo: "owner/name"
- number: PR number
- title: PR title ≤ 140
- state: merged | open | closed | draft (default open)
- author: "login" | {login, avatar? (assets/ image)}
- lines: [string | {text, type?, old?, new?}] unified-diff lines verbatim: "@@ -13,7 +13,7 @@" (a hunk header, sets the line numbers), "+added", "-removed", " context", 1–14
- startLine: first line number: n or {old, new} (optional; a hunk header line sets it too)
- file: path of the file the lines are from ≤ 160 (optional)
- additions: integer (optional; default: counted from lines)
- deletions: integer (optional; default: counted from lines)
- date: "YYYY-MM-DD" (optional)
- highlight: "token" | {token, row?} | [… ≤ 3]: text exactly as in a line; a box draws round it (default row: the first added line that has it)
- highlightAt: the token boxes draw on: seconds from scene start (optional; else a matching hit, else a default)
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, highlight
variants: glass (default), github

### commit-card (keeps captions)
A GitHub commit rebuilt as a glass card: repo, short sha, a Verified chip, co-author avatars and names, the message, the file path and the diff hunk; a box draws round the highlighted token on its word. Real data only (src/evidence/github.js).
params:
- repo: "owner/name"
- sha: 7–40 hex (shown as 7)
- verified: boolean (default false)
- authors: ["login" | {login, avatar?}] 1–3
- message: the commit message's first line ≤ 140
- number: the PR number it came from (optional, shown "(#n)")
- lines: [string | {text, type?, old?, new?}] unified-diff lines verbatim: "@@ -13,7 +13,7 @@" (a hunk header, sets the line numbers), "+added", "-removed", " context", 1–14
- startLine: first line number: n or {old, new} (optional; a hunk header line sets it too)
- file: path of the file the lines are from ≤ 160 (optional)
- additions: integer (optional; default: counted from lines)
- deletions: integer (optional; default: counted from lines)
- date: "YYYY-MM-DD" (optional)
- highlight: "token" | {token, row?} | [… ≤ 3]: text exactly as in a line; a box draws round it (default row: the first added line that has it)
- highlightAt: the token boxes draw on: seconds from scene start (optional; else a matching hit, else a default)
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, highlight
variants: glass (default), github

### diff-view (keeps captions)
A Files-changed file diff (path, +/− stats, two line-number gutters, red and green rows) where a cyan focus ring steps through rows in 1–6 states on their cues, sliding and resizing from one to the next while the other rows dim to 30%. Real diffs only (src/evidence/github.js).
params:
- file: path ≤ 160
- lines: [string | {text, type?, old?, new?}] unified-diff lines verbatim: "@@ -13,7 +13,7 @@" (a hunk header, sets the line numbers), "+added", "-removed", " context", 2–18
- startLine: first line number: n or {old, new} (optional; a hunk header line sets it too)
- additions: integer (optional; default: counted from lines)
- deletions: integer (optional; default: counted from lines)
- focus: [{row | rows: [from, to] | line (new-file number), at?}] 1–6 states (events focus-<i>)
- highlight: "token" | {token, row?} | [… ≤ 3]: text exactly as in a line; a box draws round it (default row: the first added line that has it)
- highlightAt: the token boxes draw on: seconds from scene start (optional; else a matching hit, else a default)
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, focus-0, focus-1, focus-2, focus-3, focus-4, focus-5, highlight
variants: glass (default), github

### evidence-chain (keeps captions)
An evidence chain: 2–4 sources (a PR, a commit, a file excerpt, an announcement) side by side (stacked in 9:16, cascading or in a 2 × 2 grid for 3–4 in 16:9), built one at a time, the same highlighted token boxed in each and joined to the previous one by an animated dashed connector: "the same name in three places".
params:
- sources: [{kind: pr | commit | excerpt | announcement, …that kind's fields: pr {repo, number, state?, author?, date?, file?, lines?}, commit {repo, sha, verified?, authors?, date?, file?, lines?}, excerpt {file, sub?, lines, startLine?}, announcement {site, title, text ≤ 320, date?}; highlight} + at?] 2–4, up to 6 lines each (events source-<i>, link-<i>)
- token: the token to box in every source that sets no highlight (optional)
- title: string ≤ 60 (optional)
- source: string ≤ 80 (optional)
- at: first source: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, source-0, source-1, source-2, source-3, link-1, link-2, link-3
variants: glass (default), github

### date-pinned-timeline (keeps captions)
Evidence on a date axis: a day axis (Oct 16 → 25) whose playhead scrubs to each date while 1–4 source cards (PR, commit, excerpt, announcement) pin to it with a dashed stem and stack; or (variant summary) the "why now? 3 clues in 9 days" layout: a glass title panel with one dot per day over the clue thumbnails, each with its date and label.
params:
- from: "YYYY-MM-DD", the first day
- to: "YYYY-MM-DD", the last (1–45 days on)
- cards: [{date, label? ≤ 32 (summary caption), at?, …{kind: pr | commit | excerpt | announcement, …that kind's fields: pr {repo, number, state?, author?, date?, file?, lines?}, commit {repo, sha, verified?, authors?, date?, file?, lines?}, excerpt {file, sub?, lines, startLine?}, announcement {site, title, text ≤ 320, date?}; highlight}}] 1–4 in date order (events card-<i>)
- title: summary only: ≤ 40 (default "why now?")
- subtitle: summary only: ≤ 60 (default "N clues in N days")
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, card-0, card-1, card-2, card-3
variants: axis (default), summary

### terminal-session (keeps captions)
A terminal that types: each command types character by character after the prompt, then its output streams row by row (plain lines, or PASS/FAIL rows with timings), scrolling when it outgrows the window; a ⏩ timer in the title bar fast-forwards the elapsed time while a long run streams, and a box draws round a path or token. For "git clone, pip install, run_all" proof beats.
params:
- title: window title ≤ 60 (default "zsh")
- prompt: string ≤ 6 (default "$")
- steps: [{cmd ≤ 160, output?: [string | {status: PASS | FAIL | OK | ERROR | SKIP, time? ≤ 10 ("10.0 s"), text} | {text, tone?: fg | muted | accent | add | del}] ≤ 30, typing? (seconds), at?}] 1–8 (events step-<i>)
- stream: seconds between output rows (default 0.12)
- timer: {to (seconds of real time shown), from? (default 0), step? (default the last with output)}: the ⏩ elapsed timer runs over that step's output (event timer)
- highlight: "token" | {token, step?, row? (an output row), at?}: a box draws round it (event highlight)
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, step-0, step-1, step-2, step-3, step-4, step-5, step-6, step-7, timer, highlight
variants: glass (default), solid

### dot-field (keeps captions)
A huge count shown honestly ("1,050,000 tokens in context, 1 dot = 1 token"): one dot per unit (up to 2,000,000) fills a bracketed field in a scatter as the counter counts up, pulling back from close-up dots to a density field.
params:
- count: integer 100–2000000, one dot each
- label: string ≤ 40 beside the counter ("tokens in context") (optional)
- legend: string ≤ 32 at the top right (default "1 dot = 1 token")
- tone: the dots: good | bad | neutral | primary | accent | paper | #rrggbb (default accent)
- order: "scatter" (default; dots land all over) or "reading" (left to right, top to bottom)
- format: {style?: "number" | "currency" | "percent" | "unit", currency? (ISO code, "USD"), unit? ("km", "ms", "users"), decimals? 0–3, compact? (12.4K, 3.1M), separator? (thousands commas, default true), prefix?, suffix?}
- fillDuration: seconds the fill and the counter take (default: to just before the exit, 1.2–4.5 s)
- at: field in: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, filled
variants: pull-back (default), still

### particle-text (keeps captions)
A number or short word (≤ 14 characters) in a dot-matrix face that assembles from a swirl of glowing particles, dissolves into drifting dust, or both ("60%" streaming in, then blowing away), with an optional kicker above and a line under.
params:
- text: string ≤ 14: A–Z, 0–9, space and $ % . , + - × ≈ / : ! ? # '
- kicker: string ≤ 40 above (optional)
- sub: string ≤ 60 under (optional)
- mode: "assemble" (default), "dissolve" (starts whole) or "both"
- tone: the particles: good | bad | neutral | primary | accent | paper | #rrggbb (default accent)
- at: assemble start: seconds from scene start (optional; else a matching hit, else a default)
- dissolveAt: the dissolve: seconds from scene start (optional; else a matching hit, else a default) (mode dissolve or both; default about 1.2 s before the exit)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: assemble, dissolve
variants: led (default), dust

### particle-logo (keeps captions)
One or two marks drawn in glowing particles, each inside a tilted ring of orbiting particles, side by side with a name under each (two labs, two products). A mark is an icon, or a brand's own SVG path when the scene shows that party's real evidence.
params:
- logos: [{icon? (an icon name) | path? {d, viewBox "minX minY w h", rule? nonzero|evenodd}, label ≤ 24, sub? ≤ 36, tone?}] 1–2
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build
variants: ring (default), halo

### particle-cloud (keeps captions)
Up to four ascending steps (a model line-up) leading to a dashed target box ("Next flagship") that a drifting cloud of glowing particles streams up the steps to gather round; or the target alone, wrapped in its cloud.
params:
- target: {label ≤ 24, sub? ≤ 32} the dashed box the cloud gathers round
- steps: [{label ≤ 24, sub? ≤ 32}] 1–4 steps below it, lowest first (the stairs variant draws them)
- tone: the particles: good | bad | neutral | primary | accent | paper | #rrggbb (default accent)
- at: first step in: seconds from scene start (optional; else a matching hit, else a default)
- cloudAt: the cloud: seconds from scene start (optional; else a matching hit, else a default) (default 0.45 s after the last step)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, cloud
variants: stairs (default), single

### grid-race (keeps captions)
Two unit grids racing side by side ("Same $10 of output": 1,000,000 vs 960,000 tokens), each cell one unit ("1 cell = 10,000 tokens"), up to 10000 cells a side, under live counters (and an optional spend counter) that count with the fill, then an optional ratio ("2× the tokens").
params:
- unit: number, what one cell stands for (10000)
- racers: [{label ≤ 28, sub? ≤ 40, total (a multiple of unit up to 10,000 cells), spend? {total, format?}, tone?}] exactly 2
- legend: string ≤ 40 (default "1 cell = <unit>")
- format: the counters: {style?: "number" | "currency" | "percent" | "unit", currency? (ISO code, "USD"), unit? ("km", "ms", "users"), decimals? 0–3, compact? (12.4K, 3.1M), separator? (thousands commas, default true), prefix?, suffix?}
- suffix: string ≤ 16 after each counter ("tokens") (optional)
- spendLabel: string ≤ 16 before each spend counter (default "spent")
- pace: "together" (default: both finish together) or "same-rate" (one cell per unit of time; the bigger total takes longer)
- ratio: {text ≤ 8 ("2×"), sub? ≤ 40, tone?, at?} after the finish (optional)
- title: string ≤ 60 (optional)
- source: string ≤ 80 (optional)
- raceDuration: seconds (default: to just before the exit, 1–4 s)
- at: labels in: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, race, finish, ratio
variants: columns (default), stacked

### cell-grid (keeps captions)
1–3 unit grids at one cell size (up to 10000 cells each), so their heights compare like bars ("1 cell = $0.01": $1.01 vs $7.15 a task), with stacked colour segments (a $200,000 stake under the growth), cells that tick to checkmarks (tasks passed), a lit subset, and a ratio note ("≈9× cheaper").
params:
- legend: string ≤ 40, what one cell is ("1 cell = $0.01")
- grids: [{label ≤ 28, sub? ≤ 36, count (1–10000), value? ≤ 16 shown over the grid ("$7.15"), tone?, columns?, segments? [{count, tone, label? ≤ 28}] 1–4 from the first cell, ticks? {count, tone?, at?}, highlight? {count, tone?, at?}}] 1–3
- order: "bottom-up" (default; cells stack like a bar) or "reading" (top row first, for task grids)
- ratio: {text ≤ 8 ("≈9×"), sub? ≤ 40 ("cheaper per completed task"), tone?, at?} over the shortest grid (optional)
- title: string ≤ 60 (optional)
- source: string ≤ 80 (optional)
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, fill-0, fill-1, fill-2, ticks, highlight, ratio
variants: bars (default), blocks

### tokenizer (keeps captions)
A sentence split into coloured token chips (a real BPE split, up to 48 tokens) with each token's output price under it for 1–2 models, token and character counts, then an output-token counter racing the models' bills to their totals on segmented bars ("1,000,000 tokens: $10.00 vs $5.00").
params:
- text: string ≤ 160, the sentence
- tokens: [string] 1–48, its BPE split, joining back to text exactly (precompute: node src/tokenizer.js "<text>")
- encoding: string ≤ 24 shown in the header ("o200k_base") (optional)
- models: [{label ≤ 24, price (USD per 1M output tokens), tone?}] 1–2
- output: integer, the output tokens the race counts to (default 1,000,000)
- title: string ≤ 32 (default "Tokenizer")
- source: string ≤ 60 at the top right, where the text is from (optional)
- at: chips start: seconds from scene start (optional; else a matching hit, else a default)
- raceAt: the race: seconds from scene start (optional; else a matching hit, else a default) (default 0.5 s after the chips)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, race, total
variants: panel (default), bare

### glass-bars-3d (keeps captions)
Extruded glass bars in 3D under a slow orbiting camera: 2–6 values grow in with count-up labels, one bar can glow while the rest drop back, with an optional dashed reference ("half"). The staircase variant lines them up as descending glass steps, price and name on each front face, with a score marker that hops between steps on cue.
params:
- data: [{label ≤ 24, value ≥ 0, display? ≤ 10 (the label text instead of the formatted value, "$0.50")}] 2–6; for the staircase list them highest first (step heights follow the rank)
- format: {style?: "number" | "currency" | "percent" | "unit", currency? (ISO code, "USD"), unit? ("km", "ms", "users"), decimals? 0–3, compact? (12.4K, 3.1M), separator? (thousands commas, default true), prefix?, suffix?}
- highlight: index or label of the bar that glows (optional)
- highlightAt: the highlight: seconds from scene start (optional; else a matching hit, else a default)
- marker: staircase only: {text ≤ 12 ("59.3%"), label? ≤ 24, steps: [index or label] 1–4 (the steps it visits, in order), at?: [seconds]} (events marker-<k>)
- reference: bars only: {value, label? ≤ 12} a dashed level across the bars ("half")
- tone: glass tone: primary | accent | paper | #rrggbb (default accent)
- highlightTone: the lit bar's tone (default primary)
- orbit: degrees the camera orbits over the scene, 0–30 (optional; 0 holds it still)
- title: string ≤ 60 (optional)
- source: string ≤ 80 (optional)
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, highlight, marker-0, marker-1, marker-2, marker-3
variants: bars (default), staircase

### coin-stack (keeps captions)
Stacks sized by value under a slow orbiting camera: 1–4 stacks of gold coins ("$1 vs $10"), or of glass token discs (variant cylinders, "×3 more tokens"), each coin dropping onto its stack in turn while the value counts up, with an optional callout ("×10") beside one stack.
params:
- stacks: [{label ≤ 24, value ≥ 0, display? ≤ 10 (the label text instead of the formatted value), count? 1–16 (coins in the stack; default value / per)}] 1–4
- per: the value of one coin (default: the tallest stack has 12; at most 16 per stack)
- format: {style?: "number" | "currency" | "percent" | "unit", currency? (ISO code, "USD"), unit? ("km", "ms", "users"), decimals? 0–3, compact? (12.4K, 3.1M), separator? (thousands commas, default true), prefix?, suffix?}
- highlight: index or label of the stack that glows (optional)
- callout: {text ≤ 10 ("×10"), stack? (index or label, default the last), at?} a big number beside a stack (event callout)
- tone: coin or glass tone: primary | accent | paper | #rrggbb (default primary for coins, accent for cylinders)
- orbit: degrees the camera orbits over the scene, 0–30 (optional; 0 holds it still)
- title: string ≤ 60 (optional)
- source: string ≤ 80 (optional)
- at: first drop: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, callout
variants: coins (default), cylinders

### rack-shelf (keeps captions)
A stacked server shelf in 3D: 2–6 glass trays, each a labelled row ("model · score · price") with an optional icon, stack in from the bottom while the camera dollies in, then one tray slides out toward the viewer and lights up. The rail variant glides 1–5 glass cubes (name and price on the face) along a price rail to their values, with ticks and a caption under it.
params:
- rows: [{label ≤ 24, cells? [≤ 10 chars] up to 3 (rail: 2, the first set large), icon? (icon name), value? (the cube's place on the rail; required by the rail, unused by the rack)}] 2–6 (rail: 1–5)
- focus: index or label of the tray that slides out (rail: the cube that lights) (optional)
- focusAt: the focus: seconds from scene start (optional; else a matching hit, else a default)
- format: rail only: the tick format, {style?: "number" | "currency" | "percent" | "unit", currency? (ISO code, "USD"), unit? ("km", "ms", "users"), decimals? 0–3, compact? (12.4K, 3.1M), separator? (thousands commas, default true), prefix?, suffix?}
- axis: rail only: a caption under the rail ≤ 48 ("Output price per 1M tokens")
- tone: glass tone: primary | accent | paper | #rrggbb (default accent)
- orbit: degrees the camera orbits over the scene, 0–30 (optional; 0 holds it still)
- title: string ≤ 60 (optional)
- source: string ≤ 80 (optional)
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, focus
variants: rack (default), rail

### device-box (keeps captions)
A GPU server (or a compact appliance with one big fan) in 3D on a glowing grid floor: compute cards with spinning fans on top, and a screen in front that powers on to a live readout counting up ("requests: 0 → 1,284") beside an uptime clock ticking once a second.
params:
- readout: {label ≤ 14 ("requests"), to, from? (default 0), format? ({style?: "number" | "currency" | "percent" | "unit", currency? (ISO code, "USD"), unit? ("km", "ms", "users"), decimals? 0–3, compact? (12.4K, 3.1M), separator? (thousands commas, default true), prefix?, suffix?}), at?, duration? (seconds; default to the end of the scene)} the counter on the screen
- clock: {start "HH:MM:SS", label? ≤ 10 (default "uptime")} a clock that ticks once a second (optional)
- name: string ≤ 24, a label floating over the device ("INFERENCE NODE 01") (optional)
- units: server: compute cards on top, 1–8 (default 4)
- unitLabel: server: the card label ≤ 6 ("GPU" → "GPU 0", "GPU 1"…)
- tone: glow tone: primary | accent | paper | #rrggbb (default accent)
- orbit: degrees the camera orbits over the scene, 0–30 (optional; 0 holds it still)
- title: string ≤ 60 (optional)
- source: string ≤ 80 (optional)
- at: the device lands: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, readout
variants: server (default), appliance

### paper-stack (keeps captions)
Paper in 3D: a stack of labelled document sections ("Chapter 3 · pp. 41–77") landing one on another, then a check or a red flag per row on its cue; the books variant stacks books with their titles on the spines; the folder variant lands a glass folder whose front swings open on its hinge and its files rise out, labelled, each with its check or flag.
params:
- items: [{label ≤ 28, detail? ≤ 14 ("pp. 41–77"), status? ok | flag | none, size? 0.5–4 (relative thickness), at? (the status cue)}] 2–7 (folder: 1–5 files); the first is the top of the stack (or the front file)
- openAt: folder only: the front opens: seconds from scene start (optional; else a matching hit, else a default)
- tone: glow tone: primary | accent | paper | #rrggbb (default accent)
- orbit: degrees the camera orbits over the scene, 0–30 (optional; 0 holds it still)
- title: string ≤ 60 (optional)
- source: string ≤ 80 (optional)
- at: the stack starts landing: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, open, status-0, status-1, status-2, status-3, status-4, status-5, status-6
variants: sections (default), books, folder

### planet-family (keeps captions)
A product family as celestial bodies: 2–5 procedural moon, ice world, earth, ringed gas giant, sun or galaxy, each with its name and tagline ("LUNA · light, fast, cheap"), the camera tracking from one to the next on cue over parallax star layers; the lineup variant shows 2–4 side by side and moves the focus while the rest dim. Surfaces turn, coronas and spiral arms spin.
params:
- bodies: [{kind (moon | ice | earth | gas | sun | galaxy), name ≤ 16 (set in capitals), tagline? ≤ 28, at? (its cue; the first shows with the build)}] 2–5 (lineup: 2–4), small to large reads best
- tone: tagline tone: primary | accent | paper | #rrggbb (default accent)
- title: string ≤ 60 (optional)
- source: string ≤ 80 (optional)
- at: the first body: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, body-0, body-1, body-2, body-3, body-4
variants: track (default), lineup

### scatter-plot (keeps captions)
Points or 1–5 series on two axes (linear or log, with ticks), built in beats: series lines draw on in order, one series takes the focus with a glow while the rest dim, and annotations land one at a time (dashed guides from a point to both axes with value pills, a "?" placeholder point, labelled callouts). Two panels compare an official chart with an independent re-run.
params:
- points: [{x, y, size? (bubbles), label? ≤ 22, color? (primary | accent | paper | #rrggbb)}] 3–60 (one of points, series or panels)
- series: [{points: [{x, y, label?, size?}] 1–24, label? ≤ 22, color? (primary | accent | paper | #rrggbb), line? (default true with 2+ points), at?}] 1–5; each draws on its own cue (event series-<i>)
- panels: [{title ≤ 32, series}] exactly 2, side by side (stacked in portrait) on shared axes ("Official chart" | "Independent re-run"); their series count on in one sequence (series-<i>), the second panel lands on event panel-1
- focus: series index to glow while the others dim (optional; in both panels; event focus)
- focusAt: the focus: seconds from scene start (optional; else a matching hit, else a default)
- annotations: [{type: "guide" | "callout" | "placeholder", id? (a reveal id; default a<i>), panel?, series? + index? (a series point) | x + y, text? (callout text ≤ 40, guide tag, placeholder glyph ≤ 3, default "?"), label? ≤ 24 (placeholder caption), at?}] 1–6; each lands on its own cue (event reveal-<id>)
- x: {min?, max?, scale?: "linear" | "log"} (optional)
- y: {min?, max?, scale?: "linear" | "log"} (optional)
- format: y values: {style?: "number" | "currency" | "percent" | "unit", currency? (ISO code, "USD"), unit? ("km", "ms", "users"), decimals? 0–3, compact? (12.4K, 3.1M), separator? (thousands commas, default true), prefix?, suffix?}
- xFormat: x values: as format
- xLabel: string ≤ 32
- yLabel: string ≤ 32
- trend: boolean: draw the least-squares line through points (default false)
- tone: dot colour (primary | accent | paper | #rrggbb)
- highlight: points index to call out (optional; with points)
- highlightAt: seconds from scene start (optional; else a matching hit, else a default)
- title: string ≤ 60 (optional)
- source: string ≤ 80, where the numbers come from (optional)
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, panel-1, series-<i>, focus, highlight, reveal-<id>
variants: dots (default), bubbles, rings

### race-bars (keeps captions)
A race: 2–5 rows fill like progress bars at their own speeds, each timer counting to its finish, the fastest ticking first; then an "N× faster" badge lands on the winner ("3× faster", "1h 26m vs 4h 10m").
params:
- rows: [{label ≤ 24, time (how long it takes, any unit), tone? (good | bad | neutral | primary | accent | paper | #rrggbb), icon?}] 2–5
- badge: string ≤ 24 on the winner (optional; default "N× faster" from the times; false for none)
- format: the timers: {style?: "number" | "currency" | "percent" | "unit", currency? (ISO code, "USD"), unit? ("km", "ms", "users"), decimals? 0–3, compact? (12.4K, 3.1M), separator? (thousands commas, default true), prefix?, suffix?}
- race: seconds the slowest row takes to fill (optional; default up to 3.2 s, fitting the scene)
- badgeAt: the badge: seconds from scene start (optional; else a matching hit, else a default)
- title: string ≤ 60 (optional)
- source: string ≤ 80 (optional)
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, race, finish-<i>, badge
variants: bars (default), lanes

### small-multiples (keeps captions)
A benchmark dashboard: 2–6 mini bar charts (one per test) in a grid of glass cards under one shared legend; the bars grow panel by panel, then each panel lights its winning bar with a glow and its value while the rest dim.
params:
- series: [label | {label ≤ 20, tone? (good | bad | neutral | primary | accent | paper | #rrggbb)}] 2–4, the shared legend (one bar per series in every panel)
- panels: [{title ≤ 24, values: [number per series], highlight? (series index; default the largest), note? ≤ 16}] 2–6
- columns: integer (optional; default 1–2 in portrait, 2–3 in landscape)
- format: {style?: "number" | "currency" | "percent" | "unit", currency? (ISO code, "USD"), unit? ("km", "ms", "users"), decimals? 0–3, compact? (12.4K, 3.1M), separator? (thousands commas, default true), prefix?, suffix?}
- highlightAt: the highlight: seconds from scene start (optional; else a matching hit, else a default)
- title: string ≤ 60 (optional)
- source: string ≤ 80 (optional)
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, highlight
variants: glass (default), flat

### date-carousel (keeps captions)
A row of day cards (month, date, weekday) that lands on one date, then rewinds or fast-forwards under a ◀◀ REWIND sign to another, slowing as it arrives; the focus day lights up with a glowing rim and its event chip ("GPT-6.1 released", "Day 1"), and an optional caption ("where it started") rises under it.
params:
- from: "YYYY-MM-DD", the day shown first
- to: "YYYY-MM-DD", the focus day it lands on (within 120 days; earlier rewinds, later fast-forwards)
- event: {label ≤ 24, sub? ≤ 24, icon?, tone? (good | bad | neutral | primary | accent | paper | #rrggbb)} the chip pinned on the focus day (optional)
- startEvent: {label, sub?, icon?, tone?} a chip on the start day that clears as the strip moves (optional)
- caption: string ≤ 40 under the cards after the focus (optional)
- moveAt: the move: seconds from scene start (optional; else a matching hit, else a default)
- focusAt: the focus: seconds from scene start (optional; else a matching hit, else a default)
- title: string ≤ 60 (optional)
- source: string ≤ 80 (optional)
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, move, focus
variants: glass (default), flat

### month-grid (keeps captions)
A month calendar of glass day cells (weekday header, date, "DAY n") whose cells fill one after another across a run of days ("Codex · 28 days"), with marks pinned on given days ("−50% faster", "both") and legend chips under the grid.
params:
- from: "YYYY-MM-DD", the run's first day
- days: integer 1–42, the run's length (the grid shows the whole weeks around it)
- weekStart: "mon" (default) | "sun"
- tone: the fill (good | bad | neutral | primary | accent | paper | #rrggbb; default accent)
- marks: [{day (1–days), label ≤ 16, icon? (shown alone where the label is too wide for the cell), tone?}] up to 8, landing as the fill reaches them
- legend: [{label ≤ 28, icon?, tone?}] 1–3 chips under the grid (optional; event legend)
- fillAt: the fill: seconds from scene start (optional; else a matching hit, else a default)
- legendAt: the legend: seconds from scene start (optional; else a matching hit, else a default)
- title: string ≤ 60 ("Codex · 28 days")
- source: string ≤ 80 (optional)
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, fill, legend
variants: glass (default), flat

### person-id (keeps captions)
Who is speaking or being cited: a photo in a rounded frame with a glowing rim, the name in bold capitals inside a glow pill across its foot and the role under it ("Physics professor, ITU"); or the same as a glass card. Without a photo, an initials tile. Use real photos only of the real person named.
params:
- name: string ≤ 28
- role: string ≤ 40 (optional)
- image: assets/… photo or video still of that person (optional; else an initials tile)
- align: "left" | "center" (default) | "right"
- tone: the pill and rim: primary | accent (default) | paper | #rrggbb
- nameAt: the name: seconds from scene start (optional; else a matching hit, else a default)
- title: string ≤ 60 (optional)
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, name
variants: pill (default), card

### lineage-graph (keeps captions)
A lineage: 2–5 people as photos (or initials tiles) linked by dashed connectors with role labels ("doctoral advisor", "co-author"), laid out by generation (left to right in landscape, top to bottom in portrait) and drawn in order, each link drawing into the next person.
params:
- people: [{name ≤ 24, role? ≤ 28, image? (assets/… photo of that person), id? (a reveal id; default p<i>), at?}] 2–5 (events node-<id>)
- links: [{from, to (index or id), label? ≤ 24}] 1–6, parent → child, no loops
- tone: connector and rim colour: primary | accent (default) | paper | #rrggbb
- title: string ≤ 60 (optional)
- source: string ≤ 80 (optional)
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, node-<id>
variants: circles (default), frames

### equation (keeps captions)
Typeset LaTeX (MathJax glyphs, drawn the same in both renderers) that wipes in, then reveals its \term{…} marks one at a time, boxes marked terms with a glowing frame and a label ("first quantum correction"), and runs a red/green diff: \del{…} turns red and is struck through while \add{…} lands in green.
params:
- latex: string ≤ 400, display-style TeX; mark parts with \term{…} (reveals on its own cue), \add{…} or \del{…} (the diff); marks do not nest
- typeset: generated from latex by src/math/typeset.js (launchclip fills it in; never write it by hand)
- boxes: [{mark (index of a \term/\add/\del mark, from 0), label? ≤ 32, tone?, at?}] 1–4 (events box-<n>)
- diffAt: the diff: seconds from scene start (optional; else a matching hit, else a default)
- size: px per em (optional; default the largest that fits, at most 120)
- tone: box colour: primary | accent (default) | paper | #rrggbb
- title: string ≤ 60 (optional)
- source: string ≤ 80 (optional)
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, term-<n>, diff, box-<n>
variants: plain (default), glass

### title-decompose (keeps captions)
A paper (or any) title set as word chips under its citation; each marked term in turn lights its chips, a dashed connector drops from them, and an icon with a plain gloss lands under it ("Self-Mass" → "the field's own mass"), building a glossary row.
params:
- text: string ≤ 120, the title
- citation: string ≤ 80 over it ("Kahya & Woodard, Phys. Rev. D 76 (2007)") (optional)
- terms: [{text (a run of words in the title), gloss ≤ 24, sub? ≤ 28, icon?}] 1–5, glossed left to right (events term-<i>)
- tone: primary | accent (default) | paper | #rrggbb
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, term-<i>
variants: chips (default), underline

### feynman-diagram (keeps captions)
A Feynman diagram that draws itself line by line: fermions (straight, with an arrow), photons (wavy), gluons (curly), scalars (dashed) and gravitons (double wave), bent into loops where asked, vertices popping as lines meet them and labels (e⁻, γ, φ) landing beside the lines. Presets: self-energy (a one-loop correction), exchange, annihilation.
params:
- preset: self-energy | exchange | annihilation (or give points and lines)
- points: {name: [x, y]} on a 12 × 6 grid, y down (optional with a preset)
- lines: [{from, to (point names), type? (fermion | antifermion | photon | gluon | scalar | graviton; default fermion), bend? −1–1 (a loop or arc), label? ≤ 12, at?}] 1–12, drawn in order (events line-<i>)
- tone: boson and glow colour: primary | accent (default) | paper | #rrggbb
- title: string ≤ 60 (optional)
- caption: string ≤ 80 under it (optional)
- at: build start: seconds from scene start (optional; else a matching hit, else a default)
- variant: the module's designed look, one of its VARIANTS (optional; default: the style's variants[module], else the first)
- rect: {x, y, width, height} canvas px inside the safe zone (optional) [guided and bespoke tiers only]
events: build, line-<i>
variants: glow (default), ink

### cast-scene (keeps captions)
One to three animated characters in a set (desk-laptop, phone, meeting, screen, kitchen-counter, sofa, podium, stage, car, park-bench, video-call, standing-desk, standing), acting on cues: named poses and expressions at times or narration words, mouths moving on their lines. The screen set plays a real capture.
params:
- set: desk-laptop | phone | meeting | screen | kitchen-counter | sofa | podium | stage | car | park-bench | video-call | standing-desk | standing
- screen: {src: "assets/…(image|video|demo-autopilot .mp4)", sourceStart?, fit?} (required for screen, optional for meeting)
- cast: [{id (a story-cast id, or "@1", "@2"… by place in the cast), position?: left|centre|right (default: the story cast's position, then list order), pose?, expression?, facing?: left|right (default: toward its target, else inward), target?: what it attends to (far | window | horizon | street | skyline | left | right | {prop} | {character} | {x, y}; it faces it and turns its head to it), cues?: [{at, pose?, expression?, action?: look-far | turn-to-look | gaze-at | point-at | walk-to | stand-up | stretch, target?, facing?, view?: front | three-quarter | back}], says?: [{from, to}] | "auto" (its own dialogue lines), holds?: phone}] 1–3; poses: stand, point, wave, slump, type, think, cheer, shrug, walk, sit, look, stretch; expressions: neutral, happy, delighted, frustrated, confused, surprised, focused
- light: {dir?: degrees the key light comes from (0 right, 90 above, 180 left) or a world vector {x, y} from the light toward the subject, color?: hex, intensity?: 0–1} (default: the world's light, else a soft key from the upper left); shaded drawing styles follow it
- world: {kind, time?: day|dusk|night} the world the cast stands in: its light and half its time-of-day grade (default: the track-0 world scene beneath this one)
- backdrop: room | world: room = the set's own room; world = only its furniture and props, recoloured and lit by the world and standing on its ground, over the world scene beneath or in params.world / story.world drawn behind it (default world when there is a world; not for video-call)
- enter: fade | cut: how the cast arrives (default: with the world plate beneath when it starts with it, a cut or a fade over its transition; else a fade)
- exit: fade | cut: how the cast leaves (default: as the next plate arrives when it ends with the world beneath; else a fade)
events: <character>-cue-<i>

### character-cameo (keeps captions)
One animated character beside a card (kicker, title, body) or alone on a panel, for a beat in a footage-led or explainer video.
params:
- character: a cast or starter character id, or "@1", "@2"… by place in the story cast
- pose: stand | point | wave | slump | type | think | cheer | shrug | walk | look | stretch
- expression: neutral | happy | delighted | frustrated | confused | surprised | focused
- facing: left | right
- target: what the character attends to (as cast-scene)
- cues: [{at, pose?, expression?, action?: look-far | turn-to-look | gaze-at | point-at | walk-to | stand-up | stretch, target?, facing?}]
- says: [{from, to}] | "auto"
- side: left | right (where the character stands)
- card: {kicker?, title ≤ 64, body? ≤ 140}
- panel: boolean (default: true without a card)
- rect: {x, y, width, height} canvas px inside the safe zone (and the brand frame's safe area), at least half its width and 35% of its height; default: the whole safe area [guided and bespoke tiers only]
- light: {dir?, color?, intensity?} the key light (as cast-scene)
- world: {kind, time?} the world the character stands in (as cast-scene)
- enter: fade | cut (as cast-scene)
- exit: fade | cut (as cast-scene)
events: <character>-cue-<i>

### world (keeps captions)
A layered environment drawn in code (inside rooms, streets and outdoor places) at day, dusk or night, recoloured from the brand, with props; the plate behind characters, cards or captions on higher tracks. A slow camera move gives parallax depth.
params:
- kind: office | home-desk | kitchen | living-room | classroom | cafe | workshop | server-room | studio | gym | city-street | shopfronts | crossing | alley | rooftop | skyline | park | beach | mountains | forest | space | abstract-stage (default: story.world.kind)
- time: day | dusk | night (default: story.world.time, else day)
- props: [id | {id, at?: left|centre|right|0..1, on?: surface|counter|ground|floor|wall|sky, scale?, layer?: back|mid|front, flip?}] ≤ 12; ids: laptop, phone, tablet, mug, coffee-cup, books, notebook, pen-cup, lightbulb, trophy, coins, piggy-bank, calculator, headphones, camera, microphone, keyboard, monitor, succulent, globe, hourglass, alarm-clock, gift, jar, cake, pizza, bowl, pan, pot, cutting-board, bread, fruit-bowl, teapot, kettle, water-bottle, apple, candle, game-controller, flowers, clipboard, envelope, desk-lamp, plant, leafy-plant, tree, pine-tree, palm-tree, bush, lamp-post, bench, bike, car, scooter, rocket, chart-easel, whiteboard, box, boxes, trash-can, fire-hydrant, traffic-cone, mailbox, suitcase, backpack, briefcase, stool, office-chair, floor-lamp, guitar, ladder, telescope, tent, campfire, signpost, flag, umbrella, server-rack, robot, dumbbell, kettlebell, ball, skateboard, clock, framed-art, poster, wall-shelf, neon-sign, calendar, tv, wall-chart, map, dartboard, balloons, kite, drone, hot-air-balloon
- camera: still | drift | pan-left | pan-right | push | pull or {move, amount 0..1} (default drift)
- detail: simple | standard | rich (default: from story.cast.style)
- scrim: auto | top | bottom | left | right | centre | none | true (darken the quiet area for text on top; default none)
- foreground: boolean: draw the front layer (foreground furniture, parked cars); default true, false when a cast-scene stands in this world

## Timing rules

Generated from the modules' own timing constants (`moduleTiming(id)` in kit/core/modules.mjs; `launchclip module fit <module>` prints the same rules with the window for a given `--duration`). `at` values are seconds from the scene start: the first beat no earlier than the lead-in, the last no later than the lead-out before the scene end. A faster motion grammar can shorten a catalogue B enter, which only moves its lead-in earlier.

| Module | Min scene | First `at` | Last `at` | Gaps and rules |
| --- | --- | --- | --- | --- |
| media-window | 1 s | — | — | no timed beats; the window holds for the scene |
| checklist | 1 s | 0.28 s | scene − 0.45 s | rows[].doneAt comes after rows[].at (status "active" only) |
| step-rail | 1 s | 0.28 s | scene − 0.45 s | steps[].at: ≥ 0.3 s apart |
| callout | 1 s | 0.28 s | scene − 0.45 s | treated: underlineAt ≥ treatment.at + 0.4 s; the treatment settles 0.4 s after treatment.at, before the exit |
| audience-grid | 1 s | 0.28 s | scene − 0.45 s | — |
| trend-chart | 1 s | 0.28 s | scene − 0.45 s | chart.points[].at: ≥ 0.5 s apart |
| metric | 1 s | 0.28 s | scene − 0.8 s | metric.values[].at: ≥ 0.65 s apart |
| progress | 1 s | 0.28 s | scene − 0.8 s | progress.values[].at: ≥ 0.65 s apart |
| date-card | 1 s | 0.28 s | scene − 0.45 s | the day settles 0.32 s after date.at; every state settles before the 0.22 s exit begins |
| status-rack | 1 s | 0.28 s | scene − 0.45 s | rack.rows[].states[].at (per row): ≥ 0.3 s apart; every state settles before the 0.22 s exit begins |
| code-snippet | 1 s | 0.28 s | scene − 0.45 s | code.lines[].at: ≥ 0.3 s apart; with typing, a line starts after the previous line finishes typing (at + typeDuration; typeDuration 0.12–2 s, default 0.6); every state settles before the 0.22 s exit begins |
| excerpt-window | 1 s | 0.28 s | scene − 0.45 s | the focus settles 0.5 s after focus.at; every state settles before the 0.22 s exit begins |
| focus-flow | 1 s | 0.28 s | scene − 0.45 s | chooseAt ≥ arriveAt + 0.24 + 0.08 × (options − 1) + 0.2 s; progressAt ≥ chooseAt + 0.9 s; progressAt + progressDuration + 0.35 s ≤ scene duration − 0.22 s |
| growth-chart | 1 s | 0.28 s | scene − 0.45 s | growth.points[].at: ≥ 0.5 s apart; default points (no growth.points) need a scene of at least 2.9 s |
| hook-title | 1.5 s | 0 s | scene − 0.5 s | emphasis[].at ≤ scene − 0.5 s; kickerAt ≤ scene − 0.6 s |
| kinetic-words | 0.5 s | 0 s | scene − 0.45 s | words[].at (replace): ≥ 0.3 s apart; words[].at (stack): ≥ 0.2 s apart |
| count-up | 0.5 s | 0 s | scene − 1 s | countAt + countDuration ≤ scene − 0.85 s (countDuration 0.3–6 s, default 1.2) |
| equation-lockup | 0.5 s | 0 s | scene − 1 s | the last term lands at at + stagger × (terms − 1) + 0.42 s, which must be ≤ scene − 0.6 s; highlightAt ≥ the highlighted term's time + 0.42 s (once it has landed) and ≤ scene − 0.6 s |
| cta | 2 s | — | — | no timed params; the handle pops at 0.6 s |
| function-chart | 2 s | 0.5 s | scene − 0.65 s | draw.at ≤ scene − 0.65 − draw duration + 0.3 s; gap_bars[].at default to when the line passes them; tail_zoom.at ≥ the end of the draw and ≤ scene − 0.65 − zoom duration − 0.4 s |
| gauge-compare | 2 s | 0.5 s | scene − 0.65 s | gap.at ≥ both fills + 0.35 s and ≤ scene − 0.65 − 0.4 s |
| flow-compare | 2 s | 0.5 s | scene − 0.65 s | — |
| process-steps | 2 s | 0.5 s | scene − 0.65 s | steps[].at: ≥ 0.35 s apart |
| archive-card | 2 s | 0.5 s | scene − 0.65 s | stamp.at defaults to 0.35 s after the quote finishes revealing |
| logo-row | 2 s | 0.5 s | scene − 0.65 s | logos pop in order; with no at, the first pops at 0.65 s and the rest follow by stagger (default 0.14 s) |
| brand-lockup | 2 s | 0.5 s | scene − 0.65 s | elements land in this order: mark, wordmark, eyebrow, headline, badge, url, stagger apart (default 0.35 s), the first at 0 s; a hit on one moves the defaults after it |
| punch-in | 0.8 s | 0 s | — | at (and every steps[i].at) ≤ scene − release − 0.25 s (release 0.3–2 s, default min(0.5, 0.3 × scene)); steps at least 0.3 s apart |
| zoom-through | 0.8 s | — | — | the cut (at) needs rush before it and burst after it inside the scene (rush 0.15–0.6 s, default 0.3; burst 0.2–0.8 s, default 0.4) |
| footage-callout | 1.5 s | 0 s | scene − 1.1 s | — |
| lower-third | 2 s | 0 s | scene − 1.2 s | — |
| emphasis-caption | 0.8 s | 0 s | scene − 0.45 s | at ≤ scene − 0.45 s − stagger × (words − 1) (stagger 0–0.3 s, default 0.09) |
| masthead | 1.5 s | 0 s | scene − 0.9 s | at ≤ scene − 0.9 s − stagger × (letters − 1) (stagger 0–0.12 s, default 0.05) |
| dolly-zoom | 1.8 s | 0 s | — | at ≤ scene − move − release − 0.2 s (move 1–2.5 s, default min(1.6, 0.6 × scene); release 0.3–1 s, push only) |
| product-demo | 2 s | 0 s | scene − 0.2 s | actions[].at: in order; zooms start 1.2 s before each action and settle 0.4 s before it, hold 1.1 s (0.2 s after a click that navigates), and pan to the next action unless the gap is over 2.2 s; callouts[].at ≤ scene − 1 s; each shows 2.2 s by default, must not overlap the next, and ends when its action navigates or the camera leaves it |
| photo-scene | 2 s | 0 s | scene − 0.8 s | lines[].at in order (default 0.35 s, then 0.45 s apart, scaled by the grammar); the last at least 0.8 s before the scene ends |
| evidence-clip | 2 s | 0 s | scene − 0.3 s | focus[].at in order; each zooms in over 0.8 s, holds to until (default 2 s after landing) and eases out over 0.7 s unless the next starts first; cursor[].at at least 0.2 s apart; each glide takes up to 0.7 s and lands on the point's time |
| feed-frame | 2 s | 0 s | — | at ≤ scene − release − 1 s (release 0.3–1 s, default 0.5) |
| pull-back | 3 s | 0 s | — | at ≤ scene − release − 1.6 s (release 0.3–1.2 s, default 0.6); at least 0.3 s per step |
| backdrop-swap | 2 s | 0 s | — | at ≤ scene − release − 0.8 s (release 0.3–1 s, default 0.5) |
| app-stage | 2 s | 0 s | scene − 1.2 s | — |
| phone-stage | 2 s | 0 s | scene − 1.2 s | — |
| growth-line | 2 s | 0 s | — | at ≤ scene − draw − 0.6 s (draw 0.8–3 s, default min(1.6, 0.45 × scene)) |
| glass-word | 1.8 s | 0 s | scene − 1.1 s | — |
| orbit-cards | 2 s | 0 s | scene − 1.2 s | — |
| proof-wall | 2 s | 0 s | scene − 1.2 s | at ≤ scene − 1.2 s − every × items |
| scrapbook | 2 s | 0 s | scene − 1.4 s | — |
| doodle-outline | 1.5 s | 0 s | scene − 0.9 s | — |
| concept-card | 2 s | 0 s | scene − 0.65 s | with no at, the word lands at 0.05 s; the icon pops up to 0.15 s before it and the sub-line follows it by 0.35 s |
| icon-row | 2 s | 0 s | scene − 0.65 s | items pop in order; with no at, the first pops at 0.05 s and the rest follow by stagger (default 0.18 s) |
| section-card | 2 s | 0 s | scene − 0.65 s | the kicker and rule land up to 0.25 s before the title (with no at, at 0.25 s) |
| object-card | 2 s | 0 s | scene − 0.65 s | with no at, the object pops at 0.05 s; the caption follows it by 0.25 s and accents pop from 0.35 s after it |
| stat-card | 2 s | 0 s | scene − 0.65 s | the count runs 0.9 s from at and hits on the exact value |
| quote-card | 2 s | 0 s | scene − 0.65 s | the author follows the quote by 0.45 s; the highlight lands 0.35 s after the author (or on a highlight hit) |
| excerpt | 2 s | 0 s | scene − 0.65 s | lines reveal from at, one every min(0.12, 0.6 / lines) s; the highlight follows 0.5 s after the last |
| compare | 2 s | 0 s | scene − 0.65 s | the right panel lands 0.25 s plus stagger × left items after the left (or on a right hit) |
| timeline | 2 s | 0 s | scene − 0.65 s | steps land in order; with no at, the first lands at 0.05 s and the rest follow by stagger (default 0.45 s) |
| bar-chart | 2 s | 0.5 s | scene − 0.65 s | the build runs about 1.2–1.6 s from at; highlight.at comes after the build |
| stacked-bar | 2 s | 0.5 s | scene − 0.65 s | the build runs about 1.2–1.6 s from at; highlight.at comes after the build |
| pie-chart | 2 s | 0.5 s | scene − 0.65 s | the build runs about 1.2–1.6 s from at; highlight.at comes after the build |
| area-chart | 2 s | 0.5 s | scene − 0.65 s | the build runs about 1.2–1.6 s from at; highlight.at comes after the build |
| radar-chart | 2 s | 0.5 s | scene − 0.65 s | the build runs about 1.2–1.6 s from at; highlight.at comes after the build |
| sparkline | 2 s | 0.5 s | scene − 0.65 s | the build runs about 1.2–1.6 s from at; highlight.at comes after the build |
| progress-ring | 2 s | 0.5 s | scene − 0.65 s | the build runs about 1.2–1.6 s from at; highlight.at comes after the build |
| funnel-chart | 2 s | 0.5 s | scene − 0.65 s | the build runs about 1.2–1.8 s from at; highlight.at comes after the build |
| waterfall | 2 s | 0.5 s | scene − 0.65 s | the build runs about 1.2–1.8 s from at; highlight.at comes after the build |
| sankey | 2 s | 0.5 s | scene − 0.65 s | the build runs about 1.2–1.8 s from at; highlight.at comes after the build |
| heatmap | 2 s | 0.5 s | scene − 0.65 s | the build runs about 1.2–1.8 s from at; highlight.at comes after the build |
| leaderboard | 2 s | 0.5 s | scene − 0.65 s | the build runs about 1.2–1.8 s from at; highlight.at comes after the build |
| comparison-table | 2 s | 0.5 s | scene − 0.65 s | the build runs about 1.2–1.8 s from at; highlight.at comes after the build |
| odometer | 2 s | 0.5 s | scene − 0.65 s | the count or roll runs from at and lands before the exit |
| flip-clock | 2 s | 0.5 s | scene − 0.65 s | the count or roll runs from at and lands before the exit |
| ticker-tape | 2 s | 0.5 s | scene − 0.65 s | the count or roll runs from at and lands before the exit |
| slot-roll | 2 s | 0.5 s | scene − 0.65 s | the count or roll runs from at and lands before the exit |
| countdown | 2 s | 0.5 s | scene − 0.65 s | the count or roll runs from at and lands before the exit |
| percent-fill | 2 s | 0.5 s | scene − 0.65 s | the count or roll runs from at and lands before the exit |
| device-frame | 2 s | 0.5 s | scene − 0.65 s | the frame lands at at, its screen fills 0.3 s later |
| window-chrome | 2 s | 0.5 s | scene − 0.65 s | the frame lands at at, its screen fills 0.3 s later |
| polaroid | 2 s | 0.5 s | scene − 0.65 s | the element lands at at |
| sticker | 2 s | 0.5 s | scene − 0.65 s | the element lands at at |
| torn-paper | 2 s | 0.5 s | scene − 0.65 s | the element lands at at |
| tape-note | 2 s | 0.5 s | scene − 0.65 s | the element lands at at |
| badge | 2 s | 0.5 s | scene − 0.65 s | the element lands at at |
| ribbon | 2 s | 0.5 s | scene − 0.65 s | the element lands at at |
| speech-bubble | 2 s | 0.5 s | scene − 0.65 s | the callout lands at at |
| tooltip | 2 s | 0.5 s | scene − 0.65 s | the callout lands at at |
| callout-arrow | 2 s | 0.5 s | scene − 0.65 s | the callout lands at at |
| motion-title | 2 s | 0.5 s | scene − 0.65 s | the build ends before the exit; long text with a character effect compresses its stagger to 1.4 s |
| icon-grid | 2 s | 0.5 s | scene − 0.65 s | icons pop 0.12 s apart (closer for many) from at |
| map-highlight | 2 s | 0.5 s | scene − 0.65 s | the zoom runs 1.2 s from at + 0.35 (the dot matrix pushes in over 2 s); highlights, then pins, follow 0.12–0.5 s apart; each route leg draws as its pin lands |
| unit-grid | 2 s | 0.5 s | scene − 0.65 s | units pop in reading order within about 1.1 s from at; split or highlight comes after the build (default 0.45 s after it) |
| number-line | 2 s | 0.5 s | scene − 0.65 s | the ruler draws in about 1 s from at; ranges, the marker, the points and the zoom follow the build in that order, up to 1 s apart by default |
| social-post | 2 s | 0.5 s | scene − 0.65 s | the card builds in about 0.9 s from at (default 0.2 s); the highlight sweeps 0.45–1.4 s across the phrase (default 0.35 s after the build); focus follows the highlight by 0.4 s |
| social-stack | 2 s | 0.5 s | scene − 0.65 s | cards land stagger s apart from at (default 0.2 s, 0.45 s apart); focus follows the last card; the highlight 0.5 s after the focus |
| social-sort | 2 s | 0.5 s | scene − 0.65 s | cards pile in 0.3 s apart from at (default 0.2 s); the sort follows the pile by 0.5 s; cards fly 0.14 s apart |
| social-wall | 2 s | 0.5 s | scene − 0.65 s | the field fades in over about 1.4 s from at (default 0 s) and drifts for the whole scene; the pull follows the build by 0.6 s and takes 1.1 s; the highlight 1.2 s after the pull |
| logo-sting | 2 s | 0.5 s | scene − 0.65 s | — |
| subscribe-cta | 2 s | 0.5 s | scene − 0.65 s | — |
| channel-watermark | 2 s | 0.5 s | scene − 0.65 s | — |
| repo-pr-card | 2 s | 0.5 s | scene − 0.65 s | the card racks into focus at at; rows land top to bottom within about 0.8 s; the token boxes draw 0.4 s after the rows (or on the highlight hit) |
| commit-card | 2 s | 0.5 s | scene − 0.65 s | the card racks into focus at at; rows land within about 0.8 s; the token boxes draw 0.4 s after the rows (or on the highlight hit) |
| diff-view | 2 s | 0.5 s | scene − 0.65 s | rows land within about 0.7 s from at; focus states follow the build up to 1.6 s apart (at least 0.3 s); the token box draws 0.4 s after the first focus |
| evidence-chain | 2 s | 0.5 s | scene − 0.65 s | each source racks in, its rows land, then its token box draws; the connector from the previous token follows 0.25 s later; sources are spaced evenly, 0.4–2.6 s apart, the last connector ending before the exit when the scene is long enough (about 2.5 s per source) |
| date-pinned-timeline | 2 s | 0.5 s | scene − 0.65 s | the axis (or title panel) builds in about 0.8 s from at; cards follow, 0.4–2.4 s apart (axis) or up to 1.2 s (summary), the last token finishing before the exit when the scene is long enough |
| terminal-session | 2 s | 0.5 s | scene − 0.65 s | each command types in min(1.4, max(0.25, chars / 28)) s, 0.25 s for enter, then one output row every stream s; the next step follows the last row by 0.3 s; defaults that would run past the exit compress to fit (to 35%) |
| dot-field | 2 s | 0.5 s | scene − 0.65 s | the field and bracket appear at at; the fill and the counter run together from 0.3 s later; pull-back starts on dots about 7 px wide and ends on the whole field at 85% of the fill |
| particle-text | 2 s | 0.5 s | scene − 0.65 s | particles fly in over about 1.8 s from at; the dissolve takes about 1.7 s and must start after the text has assembled |
| particle-logo | 2 s | 0.5 s | scene − 0.65 s | each ring spins up and its mark assembles over about 1.8 s; a second logo follows 0.35 s later |
| particle-cloud | 2 s | 0.5 s | scene − 0.65 s | steps rise 0.28 s apart from at; the cloud streams in after them and the target box shows inside it |
| grid-race | 2 s | 0.5 s | scene − 0.65 s | labels and counters rise from at; the race starts 0.6 s later; the counters and the cells move together, linearly |
| cell-grid | 2 s | 0.5 s | scene − 0.65 s | grids fill one after another (0.6–1.4 s each, overlapping) from at; ticks, highlight and the ratio follow the last fill |
| tokenizer | 2 s | 0.5 s | scene − 0.65 s | chips pop in left to right within about 1.5 s of at; counts count with them; the race runs up to 2.6 s, ending by the last event time |
| glass-bars-3d | 2 s | 0.5 s | scene − 0.65 s | bars grow left to right within about 1.6 s from at; highlight and marker hops follow the build; the camera orbits for the whole scene |
| coin-stack | 2 s | 0.5 s | scene − 0.65 s | coins drop one per stack level, all stacks together, within about 2 s from at; the callout follows the build |
| rack-shelf | 2 s | 0.5 s | scene − 0.65 s | trays stack in bottom first (cubes glide in) within about 1.7 s from at; focus follows the build; the camera dollies in over the whole scene |
| device-box | 2 s | 0.5 s | scene − 0.65 s | the device lands from at and its screen powers on within about 1.2 s; the readout counts from its at to the end of the scene; the clock ticks on whole seconds |
| paper-stack | 2 s | 0.5 s | scene − 0.65 s | the stack lands bottom first within about 1.4 s (the folder lands, opens about 0.8 s later and its files rise); statuses pop top to bottom after the build, up to 0.8 s apart |
| planet-family | 2 s | 0.5 s | scene − 0.65 s | the first body shows with the build; each next body on its cue, at least 0.75 s apart (default: spread to the end of the scene) |
| scatter-plot | 2 s | 0.5 s | scene − 0.65 s | the axes draw in 0.6 s from at; each series line draws in 0.9 s on its cue; default cues follow the build 0.45–0.8 s apart and squeeze to fit the scene |
| race-bars | 2 s | 0.5 s | scene − 0.65 s | rows land from at, the race starts 0.6 s later; each row finishes in proportion to its time; the badge follows the winner's finish |
| small-multiples | 2 s | 0.5 s | scene − 0.65 s | panels land up to 0.18 s apart from at, bars grow in 0.6 s; the highlight follows the build |
| date-carousel | 2 s | 0.5 s | scene − 0.65 s | the move starts about 0.9 s after at and runs 0.7–2.4 s (longer for more days); the focus lands as the move ends |
| month-grid | 2 s | 0.5 s | scene − 0.65 s | the grid lands in 0.7 s from at; the fill runs up to 90 ms a day (2.2 s at most); the legend follows the fill |
| person-id | 2 s | 0.5 s | scene − 0.65 s | the frame rises from at; the name slides in 0.45 s later and the role follows |
| lineage-graph | 2 s | 0.5 s | scene − 0.65 s | people land generation by generation about 0.9 s apart (squeezed to fit); each link draws in 0.6 s just before its child |
| equation | 2 s | 0.5 s | scene − 0.65 s | the equation wipes in over 0.7 s from at; terms, the diff and the boxes follow 0.75–0.9 s apart (squeezed to fit) |
| title-decompose | 2 s | 0.5 s | scene − 0.65 s | the words pop in reading order within about 0.9 s from at; terms follow 0.7 s apart (squeezed to fit) |
| feynman-diagram | 2 s | 0.5 s | scene − 0.65 s | lines draw in 0.6 s each, about 0.55 s apart from at (squeezed to fit); vertices pop as the first line reaches them |
| cast-scene | 2 s | 0 s | scene − 0.45 s | a pose change tweens over 0.45 s; cues may sit anywhere from the scene start to 0.45 s before its end; an action cue (look-far, turn-to-look, gaze-at, point-at, walk-to, stand-up, stretch) acts out an idea; a character with a target faces it and turns its head to it; gestures (wave, type, walk, cheer, think) loop while the pose holds |
| character-cameo | 2 s | 0 s | scene − 0.45 s | a pose change tweens over 0.45 s; cues may sit anywhere from the scene start to 0.45 s before its end; an action cue (look-far, turn-to-look, gaze-at, point-at, walk-to, stand-up, stretch) acts out an idea; a character with a target faces it and turns its head to it; gestures (wave, type, walk, cheer, think) loop while the pose holds |
| world | 2 s | 0 s | scene − 0 s | a world fills the frame for the whole scene; its camera move runs from the scene start to its end; put characters, cards and captions on higher tracks over it |

## Example

```json
{
  "schema": "launchclip.story.v1",
  "title": "Faster builds",
  "lane": "motion",
  "format": {
    "width": 1080,
    "height": 1920,
    "fps": 30,
    "duration": 14,
    "platform": "youtube-shorts"
  },
  "brand": {
    "colors": {
      "bg": "#06070d",
      "primary": "#fdb022",
      "accent": "#46d4ff",
      "ink": "#06070d",
      "paper": "#f2eee6"
    },
    "fonts": {
      "display": "anton",
      "body": "space-grotesk",
      "meta": "jetbrains-mono"
    }
  },
  "audio": {
    "music": {
      "provider": "synth",
      "bpm": 100,
      "key": "A"
    },
    "sfx": "auto"
  },
  "base": null,
  "scenes": [
    {
      "id": "s1",
      "module": "count-up",
      "start": 0,
      "end": 3,
      "energy": 1,
      "params": {
        "value": 40,
        "suffix": " min",
        "label": "One CI run on your repo today",
        "note": "illustrative"
      },
      "hits": [
        {
          "at": 1.4,
          "event": "hit"
        }
      ]
    },
    {
      "id": "s2",
      "module": "count-up",
      "start": 3,
      "end": 6.5,
      "energy": 2,
      "in": {
        "type": "push",
        "dur": 0.4,
        "direction": "left"
      },
      "params": {
        "value": 12,
        "suffix": " min",
        "label": "Same pipeline after caching",
        "note": "illustrative"
      },
      "hits": [
        {
          "at": 4.6,
          "event": "hit"
        }
      ]
    },
    {
      "id": "s3",
      "module": "checklist",
      "start": 6.5,
      "end": 11,
      "energy": 2,
      "in": {
        "type": "whip",
        "dur": 0.3,
        "direction": "up"
      },
      "params": {
        "title": "Three changes",
        "rows": [
          {
            "label": "Cache dependencies",
            "status": "done",
            "at": 0.5
          },
          {
            "label": "Split the test suite",
            "status": "done",
            "at": 1.4
          },
          {
            "label": "Ship smaller images",
            "status": "done",
            "at": 2.3
          }
        ]
      }
    },
    {
      "id": "s4",
      "module": "cta",
      "start": 11,
      "end": 14,
      "energy": 1,
      "in": {
        "type": "fade",
        "dur": 0.3
      },
      "params": {
        "action": "Try it on your repo",
        "handle": "@launchclip",
        "loop": true
      }
    }
  ],
  "overlays": [
    {
      "type": "captions",
      "style": "word-highlight"
    }
  ],
  "ending": {
    "loop_to": "s1"
  }
}
```

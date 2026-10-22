# RFC: Storyboard engine for predictable, one-shot video quality

Status: draft, open for review
Date: 2026-10-22
Scope: LaunchClip's video lanes (motion-only, voiceover and motion, footage-led) and the future product renderer that will adopt LaunchClip's concepts.

The renderer decision (§6) is **open**. It will be settled by a trial run against
the product renderer's repository, before the schema in §4 is frozen.

## 1. Problem

A flagship model, driven by the `launchclip-create-video` skill, can produce a
genuinely good bespoke video. The Newton's law of cooling Short (October 2026)
passed `cinematic-check` with all nine gates green, got an independent
critic's `ship` verdict, and was mastered at −14 LUFS. But the run:

- **took hours**, spent on one-time environment setup, four full renders at
  about 12 minutes each on a 4-core host, four critic passes, and
  hand-fixing layout collisions found by the strict layout check;
- **hand-authored every pixel**, in about 400 lines of bespoke scene JavaScript
  with hand-placed coordinates, so quality rests entirely on the model's taste
  and spatial reasoning;
- **hit avoidable classes of bug**: GSAP proxy tweens that went stale when
  the renderer sought backwards, CSS-variable colours GSAP could not tween,
  and true peak overshooting after AAC encoding;
- **needed two hand-written project scripts** (mix and evidence). They are
  now generic skill scripts, `build-mix.mjs` and `build-evidence.mjs`.

A weaker model (Haiku-class, or an open model paid with credits) given the same
freedom will not reliably reach that floor. The goal is a system where **the
inputs decide the video**, quality is **consistent across models**, and a run is
**close to one-shot**.

## 2. Goals and non-goals

Goals:

1. Any input bundle produces an appropriate video type without hand-routing.
   Bundles: a topic; a topic plus resources; a voiceover; a talking-head
   recording; or a combination.
2. A predictable quality floor for every supported model tier. The floor comes
   from tested modules and deterministic tooling, not from model taste.
3. Under 20 minutes wall clock for a 30 s Short on a typical laptop, with at
   most one final render.
4. One renderer-agnostic storyboard contract, so the same story renders in
   LaunchClip and in the product renderer.
5. Keep the existing gates (`cinematic-check`, the recorded-video readiness
   gate, the critic receipts) as the definition of "done".

Non-goals for v1: a browser editing UI, multi-language voices beyond what the
voice engines give for free, generative raster or video imagery, and long-form
(over 3 minutes) productions.

## 3. Lanes: routing inputs to a video type

| Inputs present | Lane | Visual base | Motion share |
|---|---|---|---|
| Topic / brief / resources, no audio | `motion` | Full-frame modules | 100% |
| Voiceover (supplied, or generated with Kokoro / ElevenLabs) | `voiceover-motion` | Full-frame modules timed to words | 100% |
| Talking-head or demo recording | `footage-led` | The recording, edited by the existing base edit (retakes, silence, fillers) | 10–40%: overlays, punch-ins, inserts |
| Recording plus resources | `footage-led` plus inserts | The recording, with full-frame module inserts on strong lines | 20–50% |

Routing is deterministic from the intake: what is present, the destination,
and the aspect. The model never chooses the lane. It writes the story within
the lane.

## 4. The storyboard contract (`story.json`)

One versioned JSON document is the only artifact the model must author. Every
renderer consumes it. Everything derivable from it is derived by tooling: audio
mix, captions, evidence, layout checks.

```json
{
  "schema": "launchclip.story.v1",
  "lane": "voiceover-motion",
  "format": { "width": 1080, "height": 1920, "fps": 30, "duration": 29.5, "platform": "youtube-shorts" },
  "brand": { "colors": { "bg": "#06070d", "primary": "#fdb022", "accent": "#46d4ff", "ink": "#06070d", "paper": "#f2eee6" },
             "fonts": { "display": "anton", "body": "space-grotesk", "meta": "jetbrains-mono" } },
  "audio": { "voice": "assets/audio/narration.wav", "words": "NARRATION.json",
             "music": { "source": "synth", "bpm": 100, "key": "A" }, "sfx": "auto" },
  "base": null,
  "scenes": [
    { "id": "s1", "module": "thermal-hero", "start": 0, "end": 5.75, "energy": 1,
      "params": { "subject": "mug", "readout": [[0, 90], [0.86, 62], [1.6, 58.4]] },
      "hits": [{ "at": "word:fast", "event": "readout-plunge" }] },
    { "id": "s3", "module": "function-chart", "start": 11.9, "end": 20.6, "energy": 2,
      "in": { "type": "zoom", "from_object": "s2.gap-bracket", "dur": 0.6 },
      "params": { "fn": "20 + 70 * 2^(-t/10)", "x": [0, 60, "min"], "y": [0, 100, "°C"],
                  "gap_bars": [0, 10, 20], "label": "illustrative values" },
      "hits": [{ "at": "word:thirty-five", "event": "gap-bar-1" }] }
  ],
  "overlays": [{ "type": "captions", "style": "word-highlight" }],
  "ending": { "loop_to": "s1" }
}
```

Rules:

- **Time anchors** can be seconds, `word:<text>[#n]` (resolved from the
  measured word timings), or `beat:<n>` (resolved from `BEATS.json`). Resolving
  anchors is the tooling's job.
- **Modules declare their behaviour.** Each module publishes `hides_captions`,
  its caption band, its safe-zone footprint, the events it can emit, and its
  default sound cue per event. The mix is then *generated* from `hits`, not
  hand-placed.
- **Energy** (0 calm, 1 light, 2 groove, 3 full, `build`) drives the music
  arrangement and ducking, and the default ambient-motion level.
- **Ambient** (`story.ambient`, per-scene `ambient`: `off | subtle | standard
  | lively` or `{level, background, drift}`) keeps settled frames moving
  between beats. It adds a brand-colour background field inside the plates
  and a slow hold drift on each module. See KIT_CONTRACTS.md, "Ambient
  motion".
- **Transitions** are typed (`cut`, `push`, `whip`, `zoom`, `iris`, `morph`)
  and may name the object handed across the boundary. These map onto the
  existing phase-2 boundary attributes.
- **Escape hatch.** `"module": "custom"` with a renderer-specific source file,
  allowed only for flagship tiers (§7). It still must obey the
  pure-function-of-time rule (§5).
- **Versioning.** `schema` is versioned, and renderers reject unknown majors.
  Golden storyboards (§8) pin each version.

## 5. Module library

The module library is where taste lives. Each module is a **pure function of
absolute time**: `draw(t, params, brand) → frame`. There is no animation state
that can go stale on seek, so the bug class found in the demo cannot occur.

v1 catalogue (about 15 modules), seeded from the cooling demo and from the
patterns in reviewed community skills:

| Module | Use when the script… | Seeded from |
|---|---|---|
| `hook-title` | opens on a question or claim (frame 0 visible) | glow intro caption pattern |
| `kinetic-words` | lands 1–3 words per beat | generic |
| `function-chart` | describes a quantity over time or a curve | cooling demo (probe, gap bars, tail zoom) |
| `gauge-compare` | contrasts two values or states | cooling demo thermometers |
| `flow-compare` | says "big X → fast, small X → slow" | cooling demo payoff pipes |
| `count-up` | gives a number, time, price or count | generic |
| `checklist` | lists steps, features or duties | generic |
| `process-steps` | explains a sequence or mechanism | generic |
| `equation-lockup` | names a law or formula | cooling demo lockup |
| `archive-card` | cites history, a source or a quote | cooling demo archive plate and stamp |
| `ui-showcase` | shows a product, site or repo (real capture) | browser/phone showcase pattern |
| `logo-row` | names platforms or integrations | generic |
| `cta` | calls to action, or the loop ending | generic |
| `punch-in` | footage-led emphasis on a word | recorded-video lane |
| `callout` | footage-led claim sticker or label | recorded-video lane |

Every module ships with:

- a parameter JSON schema;
- a safe-zone footprint, verified at rest and through its own motion;
- a caption policy;
- an event list with default sound cues;
- three golden stills.

**Hard rules for every module:**

- **Shorts safe zone.** Key content sits within y 280–1450 and x 80–940, with
  the centre of mass near y 860. The lower third is never empty. This replaces
  the more conservative y 173–1150 band used in the demo, which left the lower
  frame empty.
- **Phone scale.** Key text is at least 44 px, and hero elements fill 70–90% of
  the safe width.
- **Motion.** Velocity-shaped blur resolves to 0 at settle. A settled module
  is never frozen: the compilers wrap it in the ambient hold drift (a slow
  linear push-in, unblurred, clamped to the safe zone), and layout-check
  verifies the drift's largest extent.
- **Contrast.** Brand-role contrast is checked in code, so text cannot drop
  below 3:1.

## 6. Renderers (decision open; trial planned)

| Option | Strengths | Weaknesses / risks |
|---|---|---|
| **HyperFrames** (current) | HTML/CSS is the format agents write best; Studio preview; LaunchClip's gates and evidence are built on it | Browser screenshot per frame is slow (about 11–13 min for a 29.5 s draft on 4 cores); GSAP timeline state can go stale on seek unless modules use the master-clock rule; licence terms need confirming before productizing |
| **Remotion** | `useCurrentFrame()` → `interpolate()` is already a pure function of time; Player for in-app preview and editing; Lambda rendering; large ecosystem; the product project already uses it | Browser-bound like HyperFrames; Remotion's company licence applies above a team-size threshold (confirm terms for the product); React rather than plain HTML for agents |
| **Python + Skia** (native) | Fast (a reviewed engine reports 1–2 min per 30 s at 60 fps with 4-sample motion blur); deterministic; real sub-frame motion blur; easy server batch; fully owned | No CSS layout (modules compute layout themselves); no browser preview or editor; a second runtime next to Node; every module must be reimplemented |

**Trial plan (to run with the product renderer repo in the same environment):**

1. Freeze the cooling demo as a `story.json` golden: 5 scenes, 5 boundaries,
   captions and loop.
2. Implement three modules (`function-chart`, `gauge-compare`,
   `equation-lockup`) plus captions in **Remotion** and in **HyperFrames**,
   using the module rules in §5. Add **Skia** if time allows.
3. Measure on the same host: wall-clock render time (draft and final), frame
   parity against the golden stills, lines of module code, and how often a
   Haiku-class model produces a valid storyboard for three new briefs.
4. Decide using these criteria, in order:
   - quality parity
   - render time (target: final 30 s render in under 5 min on a laptop)
   - fit with the product renderer
   - licence cost
   - authoring ergonomics for agents

Whichever renderer wins becomes the **primary** implementation of the module
library. A second renderer is supported only if golden frame-diff tests keep
the two in step; otherwise the second renderer is dropped rather than allowed
to drift.

## 7. Model tiers

| Tier | Examples | Model writes | Model may not |
|---|---|---|---|
| Structured | Haiku-class, open models via OpenRouter, Ollama | `story.json` using catalogue modules only; script text; hits | Custom modules, raw coordinates |
| Guided | Sonnet-class | The above plus module variants and parameter tuning | Unreviewed custom modules |
| Bespoke | Flagship (Opus-class) | The above plus `custom` modules for a topic-specific world, as in the cooling demo | Bypass gates |

All tiers go through the same gates. Repairs target a scene, a module
parameter or the mix, never the gate thresholds. A failing custom module falls
back to the nearest catalogue module rather than shipping.

The phrase→module mapping table (§5) is part of the planning prompt for every
tier. It is the biggest single lever for weaker models.

## 8. Quality measurement

"Predictable" has to be measured, not asserted. Extend `npm run eval:production`
into a cross-model eval:

- **Brief set:** 8 fixed briefs.
  - 3 educational
  - 2 product
  - 1 voiceover-supplied
  - 2 footage-led recordings
- **Models:** each brief runs across the tiers in §7.
- **Metrics per run:**
  - gate pass rate on the first attempt and after repair
  - critic score
  - wall-clock time and render time
  - repair passes used
  - cost
- **Blind test:** a second agent gets only the skill file and a new brief. This
  catches instructions that only work with the author's context.
- **Initial targets:**
  - structured tier passes all gates within two repairs on at least 80% of
    briefs
  - median wall clock under 20 min
  - bespoke tier's critic score is no worse than the cooling demo's

Golden storyboards double as renderer regression tests: frame-diff
thresholds per module, with every golden still tracked in the repo.

## 9. Voice and audio

- **Voices:**
  - Kokoro-82M (Apache-2.0, offline, CPU) is the default open-source voice.
    Its timed export reports phoneme durations, so word timings need no ASR.
    The demo used voice `af_heart` at 1.2× speed.
  - ElevenLabs is opt-in. Its with-timestamps endpoint gives alignment.
  - A supplied voiceover gets pause tightening, filler and noise removal, and
    word timings from ASR aligned back to the script text, with onsets snapped
    to the waveform.
- **Music and SFX:**
  - The existing procedural kit (`synth-audio-kit.mjs`) is the license-free
    default.
  - Optional curated packs: CC0 (for example Kenney), or a commissioned or
    generated pack. Check redistribution terms before bundling anything
    generated by a provider.
  - Music arrangement follows scene `energy`.
  - ElevenLabs music (paid, opt-in by key; `src/music/`) is the default when
    `ELEVENLABS_API_KEY` is set: a `music_v1` composition plan with one
    section per energy segment, instrumental, at the target BPM, cached by
    request hash. `--music synth` keeps the procedural bed.
  - Beat sync: the track's beats are measured into `BEATS.json`. Narrated
    lanes move the music (start offset, tempo ≤ 3%) so downbeats land on the
    hook cut, the payoff and strong hits; the motion lane snaps second-timed
    cuts to downbeats and hits to beats within 0.25 s, with module and
    layout re-checks. Decisions go to `qa/beat-sync.json`.
- **Mix and master:**
  - `build-mix.mjs` builds the mix from storyboard hits.
  - `master-loudness.mjs` masters to −14 LUFS and at most −1 dBTP, re-measured
    after encoding.
  - Supplied mono voice is pre-mastered at about −17 LUFS, because it plays
    about 3 LU louder as stereo.

## 10. Phases

1. **Contract.** `story.json` v1 schema, anchor resolution, a `launchclip
   finish` command (voice → captions → mix → render → master → evidence →
   gate), golden storyboards. Renderer-agnostic work that is safe to start now.
2. **Renderer trial** (§6) in the product renderer's environment, then
   choosing the primary renderer.
3. **Module library v1** in the primary renderer: about 15 modules, the
   phrase→module table, the safe-zone and caption policies.
4. **Voice.** Kokoro provider plus the voiceover prep pipeline.
5. **Cross-model eval and blind tests.** Adjust module defaults and prompts
   from the results.
6. **Footage-led lane** on the same contract: base edit plus modules as inserts
   and overlays.

## 11. Open questions

- Remotion licence terms for the product's expected team size and
  distribution model.
- HyperFrames licence and long-term maintenance, if it stays a target.
- Whether the product needs in-browser editing of the storyboard (which
  favours Remotion's Player) or only rendering (which favours Skia).
- Font set: bundle the OFL families used by the reviewed engine and the demo
  (Anton, Space Grotesk, JetBrains Mono, Unbounded, Inter, Syne, Bricolage
  Grotesque, Archivo Black, Instrument Serif), or let style packs bring their
  own.
- Where custom modules live once proven: promoted into the catalogue, or kept
  per-project.

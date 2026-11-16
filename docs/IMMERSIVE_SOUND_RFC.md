# RFC: Immersive sound

Status: draft, open for review
Date: 2026-11-16
Roadmap entry: "Immersive sound" ([ROADMAP.md](ROADMAP.md))

> Code and prompt text from other projects are copied only where their licence allows it, with the notice kept. Everything else here is written fresh in our own words. Every source, its licence and what we take from it is listed under Provenance.

Today every sound LaunchClip makes is synthesised. `kit/core/sound/music.mjs`
draws nine genre beds as additive sines in FFmpeg `aevalsrc` expressions,
`families.mjs` draws 32 effect families in 12 palettes, `ambience.mjs` draws
13 looping beds, `src/sfx/score.js` plans a whole sound score from what the
scenes do, and `src/scripts/build-mix.mjs` mixes voice, bed, ambience and cues
with sidechain ducking. That works with no network and no licence questions. It
has three gaps: the instruments sound like synths even when the genre is
"orchestral-lite" or "acoustic-pluck"; the picture never hears the sound; and
the mix knows levels but not direction (where a silence goes, when the next
scene's sound arrives early). This section closes those gaps without adding
Python to the runtime path: every port is JS plus FFmpeg.

## 1. Sampled-instrument music

**How a sampler works.** An instrument is a set of recorded notes ("zones"),
each with a root pitch, a velocity layer, and sometimes a round-robin index and
loop points. To play a note it:

1. **Picks a zone**: cost = semitones to the root + a small penalty for
   shifting up + 4 × velocity distance; ties go to a seeded pick, which is the
   round-robin (two repeated C4s get different recordings).
2. **Transposes** by resampling at `rate × 2^(semitones/12)`: pitch and length
   change together, as in a hardware sampler. Enough zones keep shifts under ±4.
3. **Extends sustains** (strings, organ, flute) shorter than the held note: loop
   between SFZ loop points, or else find the steady section and splice grains
   from it, each aligned to the pitch period by cross-correlation, crossfaded,
   and gain-matched (0.75–1.33) so the level never drifts.
4. **Shapes velocity**: gain `(vel / layerVel)^0.6`; a one-layer instrument
   played soft is darkened (lowpass 18 kHz down to 900 Hz).
5. **Releases** exponentially to −60 dB (0.1 s staccato to 3 s bells).
6. **Adds a room**: convolution with a synthetic noise impulse response,
   treble decaying faster, RT60 0.4–3.4 s, 15 ms pre-delay.

**Port design (JS + FFmpeg).** New `kit/core/sound/sampler.mjs`:

| Step | Done by |
|---|---|
| Decode + transpose a zone | `ffmpeg -i zone.flac -af asetrate=SR*r,aresample=48000:resampler=soxr -f f32le -` (falls back to swr with `filter_size=64` when FFmpeg lacks soxr). Cached per (file, semitones) under `$LAUNCHCLIP_CACHE/sampler/` |
| Zone pick, round-robin, velocity gain, release, steady-section search, grain splice | plain JS on `Float32Array`, seeded by `rng()` from `dsp.mjs` |
| Sum notes into stems, pan | JS, equal-power pan |
| Room | the palette rooms already build a synthetic IR; reuse it through FFmpeg `afir` |
| Write the stem | 48 kHz stereo WAV, so `genreBed` stems and sampled stems mix the same way |

A three-minute stereo stem is 69 MB of floats, well within Node. Notes come from
the recipes' existing `chordNotes`, `bassNotes`, `arpNotes`, `drumNotes`, so the
arrangement code is shared; only the instrument changes.

**Karplus-Strong pluck.** Port the extended waveguide to JS (`pluck.mjs`):
a delay line with a third-order Lagrange fractional read (so pitch can bend and
vibrato), a one-pole loss filter (treble decays faster), a cascade of first-order
allpasses for string stiffness, a pluck-position comb on the excitation, an
optional one-sided soft clip for a buzzing bridge, and a bank of body
resonances. Decay time falls with pitch (`t60 × (220/f)^0.35`). It is a tight
per-sample loop; plain JS handles a few hundred notes a second, so no native
code is needed. It replaces the additive `pluck` and `pizz` instruments in
`music.mjs` when no sample library is installed, and gives presets (nylon
guitar, harp, kalimba, koto-like) for free.

**Libraries.** All are downloaded on request, never committed.

| Library | Licence | Size (lossless) | Covers |
|---|---|---|---|
| VS Chamber Orchestra: Community Edition (Versilian Studios) | CC0 1.0 | ~395 MB | string sections (sustain, pizz, spiccato, tremolo), woodwinds, brass, timpani, orchestral percussion, upright piano, organ |
| Versilian Community Sample Library | CC0 1.0 | ~271 MB | harp, mallets (glockenspiel, marimba, vibraphone, xylophone), harpsichord, saxophones, world percussion, drum-kit parts |
| FreePats | CC0 1.0 (audio only) | ~397 MB | nylon and electric guitar, ukulele, finger bass, kalimba, hang, accordion, glass harp |
| Karoryfer Samples | CC0 1.0 | ~74 MB | jazz double bass, alto sax, erhu |
| Salamander Grand Piano V3 (Alexander Holm) | **CC BY 3.0** | ~218 MB (5 of 16 velocity layers) | concert grand |
| MuldjordKit (Lars Muldjord) | **CC BY 4.0** | inside FreePats | pop drum kit |

Sizes are of FLAC repacks; we fetch from each library's upstream release and
pin a SHA-256 per file in `kit/core/sound/instruments.json`, so our sizes will
be measured, not copied. Some FreePats packs ship photos under a non-commercial
licence: we keep only audio and SFZ files.

**Download and credits.** `launchclip sound fetch <library|core|all>` prints the
size and asks before downloading; `core` is a starter set (piano, string
sections, pizzicato, harp, glockenspiel, marimba, nylon guitar, jazz bass,
orchestral percussion), target under 300 MB. Libraries live in
`$LAUNCHCLIP_CACHE/instruments/`; a local index (zones, roots, layers, loops)
is built once. `finish` never downloads: a missing library falls back to the
synth instrument with one warning line. Every render records the instruments
it used; `finish` writes `renders/credits.txt` with the required CC BY lines
(piano, drum kit) and an optional one-line CC0 thanks, and puts the same list
in the finish report under `sound.credits`.

**Genres and palettes onto instruments.** A recipe names a role; a map picks
the sampled instrument when installed:

| Genre | Synth today | Sampled |
|---|---|---|
| orchestral-lite | strings, pizz, timpani, bell | violins + cellos sustain, violins_pizz, timpani, glockenspiel |
| acoustic-pluck | pluck, shaker | nylon guitar (or KS pluck), shaker, jazz bass |
| jazz-hop | epiano/piano, upright-bass, brush | piano, jazz bass, snare (brushed variant); epiano stays synth |
| cinematic-pulse | strings, deep kick | cellos spiccato ostinato, gran cassa, sus cymbal crescendo |
| ambient | air-pad, bell | vibraphone bowed, hand chimes, harp |
| lo-fi | epiano, soft kick | upright piano through the existing tape chain |
| house, synthwave, chiptune | — | stay synth: the synth is the genre |

Palettes borrow struck sounds for their families: `organic` and `documentary`
use woodblock, claves and marimba for tick and pop; `glassy` uses glockenspiel
and hand chimes for ding, chime and ping; `cinematic` uses gran cassa, gong and
the suspended-cymbal crescendo for impact and riser. A sampled hit still passes
through the palette's finishing chain and room, so palettes keep their colour.

## 2. Sound directing

Today the score drops the room before a big hit, pans detail to where it happens
and sweeps a whoosh across the field on a big scene change. The planner can only
mark `moment`s. We add a small per-scene `sound` block the planner writes and
the mixer realises:

| Field | Meaning | Mixer realises it as |
|---|---|---|
| `hush: {at, for}` | a near-silence before a line or hit (0.2–0.8 s) | bed, ambience and score room dip to −24 dB through `levelExpression`; only the hit and the voice play (score already keeps cues out of a hush) |
| `prelap: s` (J-cut) | the next scene's ambience and bed change start up to 1 s before the cut | per-scene ambience segments crossfaded with `afade` shifted earlier by `prelap` |
| `tail: s` (L-cut) | this scene's sound rings past the cut | the outgoing segment's fade starts after the cut |
| `into: riser\|swell\|tape-stop\|hit\|silence` | sound as the transition | riser and swell end exactly on the cut (as risers do today); `silence` is a hard 2-frame drop to nothing, then the next scene enters full |
| `space: dry\|room\|hall` | the scene's acoustic | the palette room's wet level ×0, ×1 or ×2 for that scene's cues |
| `focus: voice\|music\|fx` | what leads | moves the bed duck depth (voice: −13 dB, music: −6 dB, fx: bed −16 dB under cues) |

**Layering.** Four buses with fixed relations, asserted after the mix:
voice at −16 LUFS short-term; bed 8–12 LU under the voice while speaking and
up to 4 LU under it in pauses; ambience 14–18 LU under the voice; SFX peaks no
higher than the voice's peaks. All are first guesses to tune by ear.

**Stereo.** Voice stays centred and never moves. A cue's pan comes from the
x-centre of the element that caused it (`(x − 0.5) × 1.2`, clamped to ±0.6),
with the few-millisecond inter-channel delay `scoreGraph` already uses.
Whooshes travel in the camera's direction. Ambience is wide; the bed is
moderately wide; a `hush` narrows everything towards centre, so the hit after
it feels wide.

## 3. SFX typed and placed

**Port the type classifier.** A coarse classifier reads the first 120 ms of a
transient's spectrum and its decay to −15 dB:

| Rule (in order) | Type | Our families |
|---|---|---|
| decay > 0.25 s and > 25% energy above 4 kHz | whoosh | whoosh, swipe, slide, riser |
| peak/mean spectrum > 25 and centroid > 1.2 kHz | ding | ding, chime, ping, notification, success, sparkle, cash |
| centroid < 350 Hz | impact | impact, thud, subdrop, door, footstep |
| decay < 60 ms and > 30% above 4 kHz | click | click, tick, keystroke, camera-shutter |
| > 20% above 4 kHz or peak/mean > 15 | pop | pop, snap, boing, glitch |
| else | hit | page-turn, pen-scribble, tape-stop |

Four or more click/pop/hit events within 0.6 s are relabelled typing.
Port it to `src/sfx/classify.js` with a JS radix-2 FFT and a 17-bin
median-filter harmonic/percussive split, shared with §4. Three uses: a test
that every family × palette × variant lands in its row (a palette that turns an
impact into a "pop" fails); sorting sounds we did not make (a user's
`assets/sfx/`, §7's generated ones) into families; and measuring reference
videos (SFX per minute, share within 0.12 s of a visual change, cuts within
80 ms of an onset) so density numbers come from videos we like.

**Placement rules.**

- At most one transition sound per cut. A whoosh only when something moves
  across the cut; a still-to-still cut gets either nothing or a `hush`.
- Rate by density: low ~6, normal ~12, high ~20 cues a minute, excluding typing
  and score detail ticks (to be measured, see above). The existing repeat gaps
  and budgets for long families stay.
- With music, rhythmic cues (tick, pop, click) snap to the nearest eighth note
  within 60 ms; impacts snap to a downbeat within 0.25 s, as hits do today.
- A cue on a beat must not share the drum's register: an impact on a kick
  ducks the bed's drum stem for 150 ms, otherwise the two smear into one
  sound (the classifier itself drops onsets within 50 ms of a beat for exactly
  this reason).

**VFX ↔ sound pairs.** One table, `kit/core/sound/pairs.mjs`, used by the cue
binder and by a check:

| Visual | Sound |
|---|---|
| impact shake, slam, stamp, sticker | impact or thud (heavy), snap (light) |
| light pulse, bloom, ring flash | shimmer or ping |
| zoom kick, whip, swipe-out | whoosh in the motion's direction |
| glitch transition | glitch |
| count-up, chart build | tally or the sonification in §5 |
| unlock, check mark | chime or success, each one higher |
| node-graph pulse lands | ping, rising a step per node |

The check: every visual hit with energy ≥ 2 has a sound within 40 ms; every
impact-class sound has a visual change within 80 ms. Unpaired sounds are a
warning, not an error.

**Shipped (phase 3).** `src/sfx/classify.js` ports the rules; every family
sits in one row (shimmer and tally with ding; the keystrokes with click;
error-buzz with hit). On our own kit, 381 of 1,259 family × palette × variant
sounds land in their row: synthetic keys, clicks and ticks are tonal enough
to read as ding, and many impacts as pop. So the family-name test (media
suite) checks against `test/fixtures/sfx-classify-baseline.json` and fails
when a sound leaves its row, not until every sound is in it.

**Merged with the plan-and-pace scan.** The reference-audio scan
(docs/PLAN_AND_PACE_RFC.md §4.3) recalibrated the same rules for our band
limited kit, and those won: one rule set (`SFX_TYPE_RULES`, `sfxType`), one
measure (`sfxFeatures`, with tonality in place of peak/mean) and one family
table (`FAMILY_TYPE`) in `src/sfx/classify.js`. The table differs from the
one above: page-turn is a whoosh, snap a click, and riser, tally,
tape-stop, glitch, error-buzz and pen-scribble have no single type (null),
so no hit row is expected. 689 of the 1,029 typed sounds now land in their
row (397 under the RFC thresholds).
`kit/core/sound/pairs.mjs` holds the pairs (sparkle joins shimmer and ping,
and a pop row for the spawn and pickup effects, as the VFX catalogue pairs
them); `finish` runs the check on the bound cues and reports it as warnings
for now. The cue binder still takes each effect's sound from the VFX
catalogue, which a test keeps inside its pair.

## 4. Audio-reactive visuals

Renderers must never analyse audio themselves: Remotion's browser audio helpers
and a HyperFrames analyser would compute slightly different numbers. Instead
`finish` writes `AUDIO_FEATURES.json` (`launchclip.audio-features.v1`) after the
sound stage, before render, from the final mix and its buses:

```json
{"fps": 30, "frames": 1800,
 "buses": {"mix": {...}, "music": {...}, "voice": {...}, "fx": {...}},
 "mix": {"loud": [..], "sub": [..], "low": [..], "mid": [..], "high": [..], "onset": [..]}}
```

Per video frame: momentary loudness mapped to 0–1 (−50 to −8 LUFS), five band
energies (20–120 Hz, 120–500 Hz, 0.5–2 kHz, 2–8 kHz, 8 kHz up) in dB scaled to
0–1, and an onset strength from the percussive part. Each series is smoothed
with an attack/release follower (10 ms / 180 ms) so motion is not jittery, and
rounded to three decimals. Computed in JS from FFmpeg-decoded floats with the
same FFT as §3.

Both renderers read the same array by frame index, so values are identical by
construction and the parity harness only checks the pixels. Who reacts:

| Module | Reads | Does |
|---|---|---|
| new `audio-visualizer` (bars, line, ring) | mix bands or a chosen bus | draws them; log-scaled so bass does not dominate |
| story light `pulses` | `music.sub` | bloom intensity +0–0.25 on kicks |
| `node-graph` | `music.onset` | a pulse leaves the hub on strong onsets |
| `timeline` meter | `mix.loud` | the meter follows the real level |
| dot-grid ground | `music.low` | lit dots swell slightly |
| captions | `voice.loud` | none by default; an opt-in 2–4% scale on stressed words |

The camera does not react: its eases stay slow → fast → slow with no overshoot,
and the impact shake stays tied to hits, not loudness.

**Shipped first (audio.react).** Rather than changing each module, three
opt-in layers sit with the light's over group in both renderers
(`kit/core/audio-react.mjs`): `glow` (music sub), `bar` (mix loudness) and
`pulse` (music onsets), each overridable by bus, series and strength.
`src/scripts/audio-features.mjs` writes `AUDIO_FEATURES.json` with `series`
and `buses.{mix,music,voice}` only (no `fx` bus yet), and only for stories
that set `audio.react`; `finish` attaches just the series a story reads as
`audio.features`. The module rows above remain open, except the first:

**Shipped (audio-visualizer).** A catalogue H module
(`kit/core/catalog-h-audio.mjs`, variants `bars`, `line`, `ring`;
params `bus`, `tone`, `bars`, `at`). It slices the scene's frames of the five
band series from `audio.features` into a paint plan, and the shared painter
(`kit/core/particles.mjs`, kind `spectrum`) draws them in both renderers at
frame round(t × fps). `finish` writes `AUDIO_FEATURES.json` for any story with
`audio.react` or an `audio-visualizer` scene (`audioFeatureNeeds`). Parity
fixtures: `test/fixtures/parity/h-audio-visualizer-*.json`, which carry
synthetic features (the parity harness keeps `audio.features`).

## 5. Data sonification for charts

Chart modules (`bar-chart`, `stacked-bar`, `pie-chart`, `area-chart`,
`radar-chart`, `sparkline`, `progress-ring`) emit `build` and `highlight`
events. With `sound.sonify: true` (default on for data-heavy scenes) the
build plays the data:

- **Pitch from value**, in the bed's key and the palette's scale. Low values
  snap to the pentatonic, the middle to semitones, the top glides freely, so
  ordinary data sounds consonant and extremes sound strained.
- **One voice**: a short FM "plonk" with a falling brightness and a felt thump
  (synth, in `music.mjs` instrument form), or a sampled mallet when installed.
  Decay follows the gap to the next point (70–750 ms); velocity rises with the gap.
- **Shapes**: bars and sparkline points one note each, left to right, panned by
  x; area and sparkline a soft glide under the notes; pie slices as a chord
  built slice by slice; radar as an arpeggio; progress-ring a rising line that
  stops on the target value.
- **Emphasis**: `highlight` replays its note an octave up, cleanly; an outlier
  can get a detuned "shadow" a minor second above (opt-in, for bad news).
- It replaces `tally` on that scene, ducks under the voice like the bed, and
  counts against the cue budget as one cue.

## 6. Mastering

What we already do (`src/finish.js` `masterDelivery`, `src/scripts/master-loudness.mjs`):
two-pass loudnorm to −14 LUFS / −1 dBTP, video copied, AAC 256k, re-measure the
encoded file with `ebur128=peak=true`, lower the ceiling and retry up to three
times, then up to two repairs from the raw render. Pass if within 1.5 LU.

Deltas worth adopting from the reference script:

| Delta | Why |
|---|---|
| Aim loudnorm at TP −1.2, then a **4× oversampled limiter** (`aresample=192000,alimiter=limit=−1.6 dBFS:attack=10:release=200:level=disabled:latency=1,aresample=48000`) | loudnorm alone falls back to dynamic mode when linear gain would break the ceiling; the limiter keeps linear mode and catches inter-sample peaks the encoder adds. `latency=1` keeps sounds on their frames |
| Retry by **lowering the limiter**, not re-running loudnorm: `ceil − (peak + 1.3)` | cheaper and converges in one step in practice |
| Mix louder than 0 LUFS: turn it down to about −14 first, with a warning | loudnorm refuses it |
| Silent or below −70 LUFS: skip normalisation with a warning, still deliver | loudnorm cannot measure it |
| Audio shorter than picture: `apad=whole_dur` | never cut the picture |
| Tolerance ±1 LU | ours is 1.5; tighten after the limiter lands |

Damaged-file detection in the script guards against user files; our mix is our
own, so we skip it.

## 7. Optional generated SFX and foley

A local ComfyUI, if the user runs one, can make sounds the kit cannot draw. We
talk to it over HTTP only and copy no code: `POST /prompt` with our own
API-format workflow JSON, poll `GET /history/{id}`, fetch with `GET /view`. The
template (`kit/core/sound/comfy-sfx.json`) wires the built-in nodes:
checkpoint loader (Stable Audio Open 1.0) → T5 text encode → `ConditioningStableAudio`
(start 0, total seconds) → `EmptyLatentAudio` → `KSampler` → `VAEDecodeAudio`
→ `SaveAudio`. Video-to-audio foley (MMAudio) is a custom node, not built in;
it is an optional second template.

Flow: `--sfx comfy` makes four candidates per family intent ("a short wooden
knock, dry room"), trims them with `src/sfx/process.js`, keeps those the §3
classifier puts in the right family, caches by (prompt, model, seed) and logs
each in the generation ledger from `GENERATED_FOOTAGE_RFC.md` with a required
`source.licence`.

**Licence caveat.** Stable Audio Open 1.0 is under the Stability AI Community
License: free for research, non-commercial use and commercial use by
organisations under US$1M annual revenue; above that needs an enterprise
licence. MMAudio's weights were released for non-commercial use. LaunchClip
never ships or downloads either model; the user brings them, and `finish`
prints the licence each generated sound came under.

## 8. Phases, effort and tests

| Phase | Work | Effort |
|---|---|---|
| 1 | JS FFT + HPSS + `AUDIO_FEATURES.json`; `audio-visualizer` module in both renderers; light pulses react | 4–5 days |
| 2 | Mastering deltas (limiter, retry, edge cases) | 1–2 days |
| 3 | `classify.js`; family-name test; pairs table and check | 3 days |
| 4 | KS pluck in `music.mjs`; sonification for the seven chart modules | 4 days |
| 5 | `sampler.mjs`, `sound fetch`, index, credits; orchestral-lite and acoustic-pluck sampled | 6–8 days |
| 6 | `sound` block in the planner (hush, prelap, tail, into, space, focus) and the mixer | 4 days |
| 7 | ComfyUI SFX adapter | 3 days |

Tests:

- **Listening contact sheet**: `launchclip sound sheet` (extends
  `auditionFamily`) renders every family × palette, each genre's first 8 bars
  synth and sampled, and each sonified chart, 0.35 s apart, with a spectrogram
  PNG per row and a JSON index of offsets. Reviewed by ear before a phase merges.
- **Loudness assertions**: SFX variants peak at −6 to −1 dBFS; velocity layers
  rise in RMS; a 10 s extended sustain drifts under 1.5 dB with no sample jump
  over 0.05; §2's bus relations hold; delivery is −14 ± 1 LUFS, ≤ −1 dBTP
  after AAC.
- **Determinism and parity**: same seed, byte-identical stems and features;
  feature frames equal video frames; reactive modules pass the pixel harness.
- **Classifier fixtures**: short WAVs per type with expected labels.

## 9. Provenance

| Item | Source path | Licence | Use | Notices |
|---|---|---|---|---|
| Zone pick, round-robin, velocity gain, release, steady-section search, grain splice, SFZ parse | lemo-opuscar `core/audio/sampler.py` | MIT | port to JS | MIT notice in `sampler.mjs` header and `THIRD_PARTY_NOTICES.md` |
| Instrument registry (folders, kinds, release times, timpani roots) | same file, `REG` | MIT | port data | same |
| Noise-IR room | same file, `room()` | MIT | compare only; we have our own IR | none |
| Karplus-Strong waveguide and presets | `core/audio/pluck.py` | MIT | port to JS | MIT notice |
| Library names, licences, credit wording | `core/audio/INSTRUMENTS.md` | CC BY-NC 4.0 (docs) | facts only; our text, wording from each library's own LICENSE | none |
| Limiter, retry, edge cases | `core/render/mux.sh` | MIT | port the logic | MIT notice in `master-loudness.mjs` |
| Pitch map, plonk voice | `styles/dataviz/demo/music/score.py` | MIT | port the idea and numbers | MIT notice |
| Data chart engine | `styles/dataviz/demo/engine.js` | MIT | nothing taken (no audio in it) | none |
| `sfx_type`, HPSS, onset and cut-on-beat measures | rea-video `rea_video/audio.py` | Apache-2.0 | port to JS, changes stated | Apache-2.0 header; NOTICE line "rea-video, Copyright 2026 JuneYaooo" |
| Spectrum, waveform, bass-reactive, log scaling | remotion-skills `skills/remotion-markup/audio-visualization.md` | none stated | rewrite from the ideas | none |
| HTTP API, node names | ComfyUI | GPL-3.0 | none copied; HTTP only, our own workflow JSON | none |
| Sample libraries | VSCO 2 CE, VCSL, FreePats, Karoryfer | CC0 1.0 | downloaded by the user | optional thanks |
| Salamander Grand Piano V3; MuldjordKit | upstream | CC BY 3.0; CC BY 4.0 | downloaded by the user | required credit lines in `renders/credits.txt` |
| Stable Audio Open 1.0; MMAudio | user-supplied | Stability AI Community License; non-commercial weights | user brings them | licence printed per sound |

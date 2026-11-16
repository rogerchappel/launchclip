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

**Shipped (phase 5).** orchestral-lite and acoustic-pluck play sampled when
the instruments are installed:

| Genre | Stem | Instrument | Library |
|---|---|---|---|
| orchestral-lite | strings | violins-sustain (22 zones, 2 layers) | VSCO 2 CE |
| | pizz | violins-pizz (44 zones, 2 layers, 2 round robins) | VSCO 2 CE |
| | celli | celli-sustain (16 zones, 2 layers) | VSCO 2 CE |
| | timpani | timpani (5 drums, 2 layers, 2 round robins) | VSCO 2 CE |
| | celesta | glockenspiel (6 zones) | VSCO 2 CE |
| acoustic-pluck | guitar | nylon-guitar (48 zones) | FreePats Spanish Classical Guitar |
| | pad | violins-sustain | VSCO 2 CE |
| | bass | contrabass-pizz (36 zones; the jazz bass) | VSCO 2 CE |
| | shaker | shaker (8 round robins) | VSCO 2 CE |

The kick and rim stay synth. `launchclip sound fetch <core|all|library|instrument>`
prints the size, asks (`--yes` skips the question) and downloads 152.8 MB for
`core`, 147 MB on disk: VSCO 2 CE file by file from one pinned commit, the
guitar as its 4.7 MB 7z (unpacked with the system `tar`, else `7z`; only the
audio files are kept). Every file is checked against its SHA-256 in
`kit/core/sound/instruments.mjs`, and a mismatch keeps nothing. The fetch
then writes `$LAUNCHCLIP_CACHE/instruments/index.json` (instruments, zones,
roots, layers, round robins, libraries). The sampler (`kit/core/sound/sampler.mjs`)
plays a stem's notes into one cycle; `synth-audio-kit.mjs` writes that cycle
through the stem's filter and from there it is balanced, looped, enveloped and
sent to the room like a synth stem. `finish` passes the instruments folder,
re-renders the kit when the index changes, writes `renders/credits.txt` and
lists the credits in AUDIO-MANIFEST.json (`music.credits`) and in the sound
stage's details (`credits`). An instrument that is not installed plays synth
and the run warns once, naming `launchclip sound fetch core`.

Differences from the plan above:

- **Libraries.** Two, both CC0 1.0: VSCO 2 CE and the FreePats Spanish
  Classical Guitar. The jazz bass is VSCO's solo double bass pizzicato, not
  Karoryfer's. No CC BY library is used yet, so `credits.txt` carries only the
  thanks lines; a library with `credit_required` would put its line first.
- **Roots are measured.** VSCO names notes an octave low (its `C1` sounds
  MIDI 36) and its timpani by drum; roots were measured (YIN for pitched
  zones, the strongest mode for timpani: 41.45, 46.8, 49.5, 52.4, 54.6). Two
  contrabass zones whose measured pitch disagreed with their name were left out.
- **Manifest** is `instruments.mjs`, not `.json`, so the skills' copies of
  `kit/core` carry it.
- **Transposition** reads the decoded recording with a 4-point Hermite
  interpolator in JS rather than an FFmpeg soxr pass per (file, semitones);
  zones are decoded once per render with FFmpeg's default resampler.
- **Sustain** past the recording loops 35–80 % of it with a 150 ms
  equal-power crossfade. The seam is not aligned to the pitch period and
  there is no gain matching: section strings hide both. A solo sustain will
  need the grain splice. The held notes in today's recipes (at most two bars)
  fit inside the 9–15 s recordings, so the loop rarely runs.
- **Not built:** pan, the darkening lowpass for a one-layer instrument played
  soft, the Karplus-Strong presets as a guitar fallback (`pluck` stays the
  additive synth), the other genres' mappings, palette hits, and `sound sheet`.

Tests (`test/sound_sampler.test.js`): every zone is pinned and every mapped
stem exists; the index lists an instrument only when all its zones are on
disk at their pinned size; fetch asks first and keeps nothing with the wrong
SHA-256; round robins alternate, the soft layer is picked for soft notes and a
transposed note is in tune; sampled stems are byte-identical for a seed; a
10 s extended sustain drifts under 1.5 dB with no jump over 0.05; credits
name the libraries and instruments; with nothing fetched the bed renders on
synth with one fallback line.

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

**Shipped (phase 6).** `scenes[i].sound` is validated in `kit/core/story.mjs`
(`sceneSoundProblems`, so the file stays import-free) and carried out by
`kit/core/sound/directing.mjs`. Where it departs from the table above:

- **Meanings.** `hush.at` is the line or hit the hush sets up; the quiet runs
  `for` seconds before it (a word anchor works). `prelap` sits on the scene that
  arrives early, `tail` on the scene that rings over, `into` on the scene being
  entered. A cut takes a prelap or a tail, not both; `into: silence` takes no prelap.
- **One curve, not per-scene segments.** The ambience is still one loop per
  story, so a prelap or tail moves where the cut's level change happens on one
  curve multiplied into the bed, ambience and score room (`levels`), and
  `directCues` moves the arriving scene's first sounds (within 0.5 s before to
  0.25 s after its cut) early by the prelap. A plain cut crossfades over 0.1 s.
  Levels are evaluated every 10 ms (`asetnsamples` before `volume`), because
  `eval=frame` alone steps every 21 ms and blurs a 40 ms hush fade.
- **focus is a bed gain, not a duck depth.** `sidechaincompress` cannot change
  over time, so music lifts the bed +7 dB and fx lowers it 3 dB against the
  default duck (about −13 dB), in speech and pauses alike.
- **space.** The score mix's reverb send follows the curve (×0, ×1, ×2). The
  plain mix has no send, so it gains one only where a scene is `hall`; `dry`
  cannot remove the room a palette bakes into its files.
- **into.** riser and swell (the riser at 0.6×) end on the cut, tape-stop runs
  out on it, hit is an impact on it, all `source: "directing"`; silence gates the
  beds and cues (not the voice) for two frames before the cut.
- **Checks.** The plan-and-pace counts are story warnings when any scene has a
  sound block: one hush from 20 s, two from 45 s, one of 0.4 s or more (the held
  breath), a prelap or tail from 30 s, and no words inside a hush. After the mix,
  `measureDirecting` re-reads the mix file: each hush ≥ 18 dB under the mix
  median with a transient within 0.1 s of its end, and each prelap or tail
  half way across (in dB) at least a quarter of its lead on the planned side of
  the cut (the ramp is linear in gain, so the dB midpoint comes early). It is
  measured only where the two scenes' bed levels differ by 3 dB or more, and a
  loud cue on the cut can hide it: the whole mix is measured, not the bed alone. Failures are finish warnings; the
  results go in `qa/sfx.json` under `directing`. Pairing every sound with
  something on screen stays the phase 3 pairs check, run before directing moves cues.

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

**Shipped (phase 4).** `karplusStrong()` in `kit/core/sound/music.mjs` is the
voice, in place of the FM plonk: a seeded noise burst through a one-period
delay line, rendered in JS because a feedback loop cannot be an `aevalsrc`
expression. Velocity sets the peak and the brightness; the loop loss makes
the string fall 60 dB over the note. `kit/core/sound/sonify.mjs` reads each
chart's resolved model (`chartNotes`) and plays every point on the frame it
draws: bar, stack, slice and radar-dot tween starts, and for area, line
sparklines and the ring the frame the eased reveal passes the point. Sparklines
and long areas keep at most 16 notes. Radar's arpeggio uses the dots variant's
times in every variant. `renderSonification` mixes the notes and glides at
−6 dBFS. `finish` renders one file per chart scene under
`assets/audio/sonify/`, places it as a `sonify` cue on its first note and drops
that scene's `build` tally.

Differences from the plan above, all open:

- **Off by default.** It plays only when the story or style sets
  `sound.sonify: true`; there is no "data-heavy scene" default yet.
- **Not ducked.** The cue sits at a fixed level (0.3) like other cues and
  skips the bed's sidechain. Route it through the bed's duck if it masks
  narration.
- **Scale.** The bed's key is used, but always its major pentatonic, not the
  palette's scale. The detuned "shadow" for outliers and the sampled mallet
  (phase 5) are not built.
- **Budget.** It is placed after cue pacing, so it never competes for the
  10-second window; it simply replaces the tally the build would have had.

Tests (`test/sound_sonify.test.js`): the pluck is byte-identical for its
arguments and in tune within 10 cents; every note of every chart, variant and
aspect lands within one frame of its point; the rendered file is
deterministic for a seed; a mix carrying three sonified charts masters to
−14 ± 1 LUFS and ≤ −1 dBTP after AAC.

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

**Shipped (phase 7).** The adapter is `launchclip sfx seed --provider comfy`
(and `sfx reroll`), on a base shared with the plate and draft provider
(`src/comfy/`): `client.js` (loopback only unless `--comfy-allow-remote`;
health from `/system_stats` and `/object_info`, which must list every node
class and model file the template needs; `/prompt`, `/history`, `/view`,
`/interrupt`; a job-time and download cap), `templates.js` (templates in
`src/comfy/templates/`, inputs bound by name and type, a licence allowlist)
and `generate.js` (the cache keyed by the bound workflow, so by prompt, model
files, seed and every other value, and a JSONL ledger line per generation).
Setup is in `docs/guide/comfyui.md`. Differences from the plan above:

- **Seed, not a render flag.** Sounds are generated into the SFX library once,
  like ElevenLabs takes, rather than per render with `--sfx comfy`; every
  render then uses the library.
- **The template lives with the others**, `src/comfy/templates/sfx-stable-audio.json`,
  not under `kit/core/sound/`.
- **The licence is an opt-in.** Stability AI Community is off the open-licence
  allowlist, so `--allow-model-licence stability-ai-community` is required;
  without it nothing is sent. The licence is stored per family and per take
  in `library.json`, and `finish` adds it to `AUDIO-MANIFEST.json`'s licence
  line and its notes.
- **The ledger is the library's** (`<library>/generation-log.jsonl`), since
  SFX belong to the library, not a project.
- **Families with no classifier row** (riser, tally, tape-stop, glitch,
  error-buzz, pen-scribble) keep every take that survives processing.
- **Open:** the MMAudio video-to-audio template (a custom node, so not
  shipped); progress over `/ws` (we poll `/history`); pinning model files by
  hash (the API does not expose one); a real run (not yet made: no ComfyUI
  or weights on the build machine).

## 8. Phases, effort and tests

| Phase | Work | Effort |
|---|---|---|
| 1 | JS FFT + HPSS + `AUDIO_FEATURES.json`; `audio-visualizer` module in both renderers; light pulses react | 4–5 days |
| 2 | Mastering deltas (limiter, retry, edge cases) | 1–2 days |
| 3 | `classify.js`; family-name test; pairs table and check | 3 days |
| 4 | KS pluck in `music.mjs`; sonification for the seven chart modules | 4 days |
| 5 | `sampler.mjs`, `sound fetch`, index, credits; orchestral-lite and acoustic-pluck sampled | 6–8 days |
| 6 | `sound` block in the planner (hush, prelap, tail, into, space, focus) and the mixer (shipped, see §2) | 4 days |
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
| Zone pick, round-robin, velocity gain, release, steady-section search, grain splice, SFZ parse | lemo-opuscar `core/audio/sampler.py` | MIT | phase 5: written fresh from this RFC's description; no code copied | none needed |
| Instrument registry (folders, kinds, release times, timpani roots) | same file, `REG` | MIT | phase 5: not used; our registry and measured roots | none |
| Noise-IR room | same file, `room()` | MIT | compare only; we have our own IR | none |
| Karplus-Strong waveguide and presets | `core/audio/pluck.py` | MIT | port to JS | MIT notice |
| Library names, licences, credit wording | `core/audio/INSTRUMENTS.md` | CC BY-NC 4.0 (docs) | facts only; our text, wording from each library's own LICENSE | none |
| Limiter, retry, edge cases | `core/render/mux.sh` | MIT | port the logic | MIT notice in `master-loudness.mjs` |
| Pitch map, plonk voice | `styles/dataviz/demo/music/score.py` | MIT | port the idea and numbers | MIT notice |
| Data chart engine | `styles/dataviz/demo/engine.js` | MIT | nothing taken (no audio in it) | none |
| `sfx_type`, HPSS, onset and cut-on-beat measures | rea-video `rea_video/audio.py` | Apache-2.0 | port to JS, changes stated | Apache-2.0 header; NOTICE line "rea-video, Copyright 2026 JuneYaooo" |
| Spectrum, waveform, bass-reactive, log scaling | remotion-skills `skills/remotion-markup/audio-visualization.md` | none stated | rewrite from the ideas | none |
| HTTP API, node names | ComfyUI | GPL-3.0 | none copied; HTTP only, our own workflow JSON | none |
| Sample libraries | VSCO 2 CE (`sgossner/VSCO-2-CE` at 4403009), FreePats Spanish Classical Guitar 2019-06-18; later VCSL, Karoryfer | CC0 1.0 (each library's own LICENSE / cc0.txt checked) | downloaded by the user with `launchclip sound fetch` | optional thanks, written to `renders/credits.txt` |
| Salamander Grand Piano V3; MuldjordKit | upstream | CC BY 3.0; CC BY 4.0 | downloaded by the user | required credit lines in `renders/credits.txt` |
| Stable Audio Open 1.0; MMAudio | user-supplied | Stability AI Community License; non-commercial weights | user brings them | licence printed per sound |

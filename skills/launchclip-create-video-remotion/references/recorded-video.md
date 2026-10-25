# Recorded presenter video

Use this route for existing presenter, community, product/app-demo, interview or
topic recordings in landscape or portrait. Preserve the recorded story and the
original file. Choose scope from the user's request:

- **Base edit only:** run automatic cleanup and recording QA; deliver promptly.
  Do not require a creative treatment, music or prototype for cleanup alone.
- **Full directed treatment:** after accepted cleanup, follow the direction,
  prototype, sound and delivery stages below. Optional assets enrich the result;
  their absence must not reduce the edit to text cards.
- **Restrained overlays:** when explicitly requested, use the glass treatment
  below or the supplied style. Do not mistake it for the default quality ceiling.
Read `standalone-remotion.md` before authoring the composition; no Remotion or
HyperFrames plugin skills are required.

## Automatic base edit

When cleanup is requested, run the local CLI:

```bash
launchclip edit-recording recording.mov --out .launchclip/recording-edit --aspect 16:9
```

This defaults to local Whisper (`base.en`, configurable with `--recording-model`)
plus a second local model for consensus word timing (`small.en`, configurable
with `--consensus-model`, `none` for one model; see `docs/recording-qa.md`),
and calls no paid model or transcription provider. Whisper must already be
installed; its first run can download the selected model. Reuse a word-timed
JSON transcript with `--recording-transcript words.json` to avoid transcription.
Supported inputs include flat words, `{words}` and Whisper segments containing
word arrays. Plain text or segment-only timestamps are insufficient for cuts.

The deterministic policy is **last take wins**: remove earlier nearby repeated
lines/passages and matching unfinished prefixes, retaining the final occurrence.
Do not rank performances or ask the user to select takes. Preserve unique speech
in source order. For reworded restarts, first use the active agent to compare
nearby complete passages in the original normalized transcript. Follow the
generic receipt contract in `docs/semantic-retakes.md`: compute its transcript
hash, use original inclusive word indices, keep the later complete restatement,
and leave uncertain or intentionally contrasting statements alone. Restarts
inside a sentence ("we can, we can ship it", "less talking, more talking") go in
the receipt's `restarts` array with word-level ranges. Save decisions
outside the repository and pass `--retake-decisions retakes.json` with the same
`--recording-transcript` file. Decisions are automated; no take-selection gate.
Standalone CLI users can instead explicitly select an installed local Ollama
model with `--retake-model MODEL`. No paid fallback occurs. Without either option,
the CLI applies lexical matching only; it cannot detect arbitrary paraphrases.

The transcript-gap fallback uses 0.8s gaps with 0.15s speech handles. Use
`--silence-duration`, `--silence-padding`, `--retake-window` (90s), and
`--min-repeat-words` (6) when the recording needs different thresholds.
`--no-trim-silence` preserves pauses while still applying last-take cleanup.
Recognized hesitation tokens and abandoned connective starts are removed by
default; grammatical uses of “but” and “like” remain. `--keep-fillers` disables
this. Whisper may omit audible hesitations even with a verbatim prompt; the tool
cannot cut a filler whose word timing is absent. Check the source audio.

Local FFmpeg also measures a bounded RMS waveform and adaptive quiet threshold.
It controls pause removal instead of pre-cutting transcript gaps, so inaccurate
ASR timing cannot discard voiced gaps. It trims measured quiet outside spoken
words, retaining 0.08s handles and
protecting quiet speech. Defaults use a 0.4s acoustic pause minimum; configure
`--audio-silence-duration`, `--audio-silence-padding`, or an explicitly inspected
`--audio-threshold-db`. `--no-audio-silence` disables acoustic trimming.
`audio-analysis.json` explains the measured threshold and stores the waveform;
`semantic-retakes.json` records the applied decisions.

Preserve source dimensions and playback speed; do not apply the older portrait
presenter crop/speed defaults.

Outputs include `base-edit.mp4`, original transcript, edited transcript/words,
an original-to-edited segment map, `audio-enhance.json` (audio clean-up) and
`recording.json` provenance/cache receipt.
Inspect failures and verify cuts locally without adding a take-selection gate.
Zero-duration transcription artifacts are discarded rather than assigned fake
timing. Transcription errors can affect cuts and graphics; check actual footage
when correcting visible text. Never invent replacement word timestamps.

### Audio clean-up

The base edit is silence, bad takes (repeats, false starts, semantic retakes),
fillers, then voice clean-up. Clean-up runs on the QA-accepted candidate, after
the cuts, so it never moves a join: `--enhance light` (default) applies a
~80Hz high-pass, 50/60Hz notches only on measured hum, afftdn denoise with a
noise profile learned from the longest pause the edit removed from the original
take, a small ~4kHz presence lift, de-essing, gentle 3:1 compression (under the
loud syllables' peaks), a range-limited pause expander, a look-ahead limiter
(at most 6dB) and linear gain to -16 LUFS / -1.5 dBTP. `--enhance podcast`
denoises harder, compresses 4:1 and levels across speakers. `--enhance off` publishes the accepted candidate as is.
The join QA is re-run on the enhanced media; a new join issue or duration change
reverts to the unenhanced candidate and records why.

`audio-enhance.json` records the chain, detections (hum, noise-profile window,
harsh sibilance) and before/after noise floor, SNR, integrated LUFS, true peak,
spectral tilt and sibilance. Its guard backs denoise off (half strength, then
none) when it costs speech-band energy or flattens speech spectra beyond the
preset's limit; read `guard.backoffs` before re-running stronger. Do not chain
another denoiser over an enhanced base edit.

`--voice-isolation elevenlabs` runs ElevenLabs Audio Isolation (paid; needs
`ELEVENLABS_API_KEY`) before the FFmpeg chain, cached by input hash so reruns
never pay twice. Use it only when the user asks for it or accepts the cost for a
badly noisy take; it is never called without the flag.

Identical reruns reuse verified edit artifacts and preserve capture progress.
Changed input/settings/engine or an incomplete prior export requires a fresh
output directory; do not overwrite an existing base edit. Temporary rendering
segments need disk space and are cleaned after success or failure.

## Automatic QA and bounded repairs

Base editing includes post-render QA. The active agent owns the semantic check;
this is an automated stage, not a request for human take selection.

1. Render a candidate, then independently transcribe its actual audio with local
   Whisper. Source word remapping alone is not final-video evidence.
2. Inspect every audio join in bounded PCM batches. Compare the intended words
   with the fresh transcript; ASR differences alone do not prove a bad cut.
3. Assess continuity, unique context, orphan fragments and repetition against
   the rendered transcript, source words and join evidence. Distinguish source
   delivery and recognition errors from problems introduced by editing.
4. Restore proven clipped retained-word boundaries within the repair budget,
   then render and recheck. Never restore a rejected take or filler, invent
   speech, or delete a complete unique word to make the transcript look cleaner.
5. Publish `base-edit.mp4` and B-roll timings only after QA passes. Default maximum
   is three rendered attempts (`--qa-attempts`, capped at five). Total boundary
   recovery is capped at 0.6s across retries, and 0.2s per repair.

Outer frames are trimmed to the chosen voiced word boundaries. Wordless islands
are removed throughout the edit, including tiny remnants between rejected takes.
Genuine short words are preserved; there is no blanket minimum clip duration.
Handles directly facing rejected takes or fillers prefer the nearest verified
quiet separator fully outside accepted words, within the original retained range
and at most 500ms from the aligned word boundary. Cuts land inside that gap with
padding clamped to half its duration; without a qualifying separator they fall
back to aligned word bounds for legacy analysis. New analysis uses a separate
noise-relative cutoff (noise floor + 6dB, never above the dialogue cutoff and
bounded below at -80dB). Recording workflows measure 10ms RMS frames in bounded
source windows around rejected-facing aligned word edges, requiring at least
20ms consecutive quiet without debounce. This preserves quieter word tails and
allows a narrow confirmed separator before a rejected onset. Standalone analysis
without a boundary plan retains the 40ms peak-detector fallback. If no
separator qualifies, it preserves the original handle and records an unconfirmed
boundary for source/output QA instead of claiming clean audio. The initial cut
search is distinct from QA restoration budgets: repairs remain capped at 200ms
each and 600ms total. The normal 0.4s acoustic pause minimum remains unchanged. This removes
residual audio even when ASR does not recognize a word. These
removed handles are protected from later QA restoration. PCM join checks detect
isolated click candidates; they do not establish that every sustained phoneme or
breath is correct. Inspect source/output audio context for suspicious residue and
leave ambiguous sound findings unresolved rather than claiming clean audio from
transcript agreement alone.

With the active-agent route, an initial `needs-semantic-review` result is a
checkpoint for the agent to continue automatically. Read its saved candidate,
actual `rendered-transcript.json`, `plan.json`, `joins.json`, QA issues and source
context. Use the CLI package's `recordingQaEvidenceHash(plan, actual, mediaSha256,
sourceTranscript, acoustic)` helper and the receipt contract in
`docs/recording-qa.md`. Save each complete review in a local
`{ "reviews": [receipt] }` JSON file, then rerun the same command with
`--qa-decisions reviews.json`. Candidates are checksum-verified and reused;
new attempts need new evidence-bound reviews. Preserve earlier review receipts.

Assess every disagreement individually. Never blanket-resolve an omitted word,
mark semantic coverage complete from timing tests, or turn an unresolved
sound/coherence problem into a nonblocking source-delivery note. Compare short
source/output windows when the word boundaries are uncertain. If evidence cannot
support a safe correction, retain the timed `needs-attention` report.

Standalone CLI users can explicitly select an installed local Ollama model with
`--qa-model MODEL` for the semantic pass; `--qa-recording-model` configures local
final-video Whisper separately. There is no implicit paid provider, model install,
or metered fallback. Without a model or bound agent receipt, semantic QA stays
pending and `base-edit.mp4` is withheld. This is model work pending, not human
approval pending. Production stops before downstream stages until it is resolved.

Every candidate, independent transcript, measured join, review and repair remains
in `qa/attempt-N/` with `qa/session.json`. Ready outputs include
`rendered-transcript.json` and `recording-qa.json` beside the intended transcript
and edit map. Existing exports require a new directory after this engine update.

## Footage-led storyboard

After the base edit is accepted, a dressed recording can be authored as a
`storyboard.json` in the `footage-led` lane, rather than as a hand-built
composition. The recording plays full-frame underneath, and the story adds
overlays, punch-ins and full-frame inserts:

```json
{ "schema": "launchclip.story.v1", "lane": "footage-led",
  "audio": { "words": "NARRATION.json" },
  "base": { "src": "assets/recording.mp4", "edl": "recording/edit-plan.json",
            "fit": "cover", "focus": { "x": 0.5, "y": 0.36 }, "volume": 1 },
  "scenes": [
    { "id": "punch", "module": "punch-in", "track": 2, "start": 1.6, "end": 2.9,
      "params": { "scale": 1.14 }, "hits": [{ "at": "word:demo", "event": "punch" }] },
    { "id": "who", "module": "lower-third", "track": 1, "start": 5.8, "end": 8.9,
      "params": { "name": "Ada Park", "title": "Founder" } },
    { "id": "stat", "module": "count-up", "insert": true, "start": 11, "end": 14.2,
      "in": { "type": "fade", "dur": 0.3 }, "params": { "value": 12, "suffix": " min" } }
  ],
  "overlays": [{ "type": "captions" }] }
```

- **Captions.** Write `{"type": "captions"}` with no style: a footage-led
  story that names no style pack gets the quiet sentence-case `quiet-accent`
  preset, with one accent word per line. Name `word-highlight` only when the
  brief wants loud captions; a style pack's `captions.lanes` sets its own.
- **Base.** `base.edl` names the edit-recording `edit-plan.json`, and resolving
  the story turns its kept segments into `base.trim` (`[[in, out], …]` source
  ranges played back to back). Timeline time is edited time, so the
  `words.json` timings from the edit drive `word:` anchors and captions. Point
  `src` at the original recording when you use `edl` or `trim`. If you use
  `base-edit.mp4`, which is already cut, leave both out. If the recording has
  a black bar or junk on an edge, set `base.crop` (`{"right": 80}` in source
  pixels, or fractions under 1) instead of re-encoding it. The mattes, the
  face track and the layouts follow the crop.
- **Overlays** sit on track 1 or higher; same-track scenes still cannot overlap.
  **Inserts** (`insert: true`, track 0) cover the picture with any catalogue
  module while the recording's audio keeps playing. Which lines get overlays
  and inserts comes from `DIRECTION.json` (below), and how much of the runtime
  they cover comes from the cadence profile's coverage band
  ([profiles.md](profiles.md)), not a fixed share.
- **Footage modules.**
  - `punch-in`: a word-timed spring zoom (1.06–1.25) toward `focus`. It is a
    camera on the base, not an overlay.
  - `footage-callout`: a claim sticker with a leader line to `point`. It sits
    in the safe zone, never covers the point, and comes in three tones.
  - `lower-third`: a name and title bar on the caption band edge.
  - `emphasis-caption`: one to three words popped over the footage. It hides
    the captions.

  Time each module with a `hits` entry naming its event (`punch`, `point`,
  `name`, `pop`) on a `word:` anchor.
- Keep scene starts on whole frames, so both renderers agree to the frame.
- Audio: the recording is the voice, and `audio.mix` is only the music/SFX bed,
  at `audio.mix_volume`. Duck the bed against the recording when you build it.
- Run `launchclip story validate`, then `launchclip layout-check <project>`. The
  check treats the base as full-frame media and verifies each catalogue box.
  Then compile:
  `launchclip story compile <project> --renderer remotion`. `LaunchclipStory`
  mounts the base as `<OffthreadVideo>` per trim segment under the scenes, and
  punch-ins transform the base layer.

`examples/story/footage/` is a complete reference: a generated stand-in
recording, its edit plan, three punch-ins, two callouts, a lower-third, an
insert, an emphasis caption and captions.

## Subject effects

When the recording has one presenter and the treatment calls for depth (the
product name behind their head, a dolly zoom on a realisation), run
`launchclip subject probe` before planning and follow
[subject-effects.md](subject-effects.md). Plan subject effects only when the
probe says `usable`; one or two in a 30–60 s piece is plenty. Without a usable
probe, keep every scene in front.

## B-roll capture and placement

Editing also writes `broll-plan.json` and `BROLL.md`. For an already clean video:

```bash
launchclip broll-plan edited-transcript.json --out .launchclip/captures --aspect 16:9
```

The offline planner suggests practical software/product shots using topic
keywords. Each card has a spoken anchor, edited timeline, capture instructions,
priority, stable filename, status and optional `media_path`. Suggestions are not
proof that a referenced tool, screen or result exists. For unmatched subjects,
author specific cards from the actual transcript rather than generic filler.

Record about 12 seconds per shot, with a settled beginning/end, readable UI,
deliberate cursor movements, and no private notifications or credentials.
Track `planned`, `recorded`, `approved`, `placed`; attach a real local path in
`media_path`. Reruns preserve JSON statuses/paths and Markdown notes. A changed
transcript/timeline requires a new tracker directory to avoid stale placements.

The planner does not record screens, generate stock video, or automatically
insert captures. Once footage is supplied, inspect it and mount selected windows
as `media-window` scenes or muted `<OffthreadVideo>` inside a scene's
`<Sequence>` (scene `start`/`end` for timing, `startFrom` in frames for the
source offset). Continue the cleaned presenter audio once through the root mix;
mute B-roll unless its audio is deliberately needed. The CLI production lane
accepts captures as `--resource` / `--assets` and can assemble per-shot source
windows through `root_media_requests`.

## Full recorded treatment: direct before decorating

Accepted timing and recording QA are prerequisites, not the finished production.
For an already-clean recording, verify its transcript, voiced boundaries, audio
continuity and existing QA evidence without rerunning unnecessary cleanup. Use
its verified timeline (an identity source map when no cuts were made), or the
accepted base edit's edited transcript and source-to-output map, as the timing
authority. Preserve
unique speech and its order. Do not rewrite a recorded story, fabricate a
five-concept tournament, or force short-form cadence onto a longer explanation.

### Inspect the material and define the treatment

Read the entire accepted transcript before choosing moments. Write `BRIEF.md`
and `DESIGN.md`: audience, destination/aspect, promise, emotional arc, brand,
visual language, motion character and audio choices. A community launch, app
demonstration and topic explanation need different visual arguments, even when
they share a style pack. References can inform timing, hierarchy, contrast and
sound texture; do not clone their footage, composition, branding or soundtrack.

Inventory the resources supplied by the user, named project/style assets, and
available local audio. Actually view images, sample video and audition relevant
sounds. Record each candidate's local path, dimensions/duration, content,
permission/provenance, useful source window and decision in `RESOURCES.md`.
State why unused resources do not help (unreadable, redundant, unrelated, wrong
aspect or unsupported claim). A filename is a discovery hint, not evidence.
Keep originals unchanged; freeze selected copies in the composition project.

Do not wait for optional captures. Design useful module states that work from
the spoken content alone: a checklist changing state, a process advancing along
a step rail, a highlighted comparison, or a short takeaway. Use a real capture
when it clarifies or substantiates the idea. Distinguish conceptual states from
actual evidence in the plan and visible treatment; label illustrative UI when
it could be mistaken for a real product screen or measured result. Never invent
product screens, progress, member activity, results, testimonials or numbers as
proof. A progress bar can express an explicitly illustrative process, but cannot
imply a measured completion percentage without supporting evidence.

### Select established modules before custom geometry

Use a small project-consistent vocabulary of curated, verified UI components.
The art director chooses the module, content, placement, emphasis, state changes
and timing; it should reuse the module's geometry and animation instead of
redrawing controls, connectors or mechanical metaphors for each beat. Prefer:

- **Browser or desktop media window:** supplied screenshot, app demo, screen
  recording or over-the-shoulder footage inside restrained window chrome. Keep
  media aspect ratio and readable focal detail; animate crop/focus rather than
  stretching the image. An empty window is not evidence or useful B-roll.
- **Checklist or step rail:** a concrete process stated in the speech, with a
  row highlight, checkbox/tick state or next-step emphasis. Align every row and
  indicator with layout primitives; preserve completed states between beats.
- **Progress or status:** advance along known stages or show a grounded status.
  Without real measurements, use named stages and explicit illustrative
  treatment rather than fabricated percentages, elapsed time or success data.
- **Metric:** a meaningful value changing up or down, with explicit number,
  percentage or money formatting and units. Verify start/end values and their
  direction; a decrease is not automatically a failure or an increase a success.
  Use sourced values or persistently labeled illustrative examples, keeping
  signs, decimals, currency and percentage meaning intact.
- **Numbered steps:** a short ordered 1/2/3 process when sequence matters, rather
  than presenting every idea as a completed checklist.
- **Highlight or callout:** focus a relevant region of an actual capture, attach
  a short explanation, or pair a real image/video with a concise takeaway.
  Keep arrows local to their target and omit them when proximity is clearer.
- **Takeaway card:** emphasize one short conclusion within the current layout.
  It is an accent, not a replacement for all visual explanation; its exit does
  not by itself require a return to a full-frame presenter.

For the bundled module catalog and integration contract, read
[editorial-ui-modules.md](editorial-ui-modules.md) when authoring these modules.
Prefer bundled LaunchClip modules and existing media-window framing. An already
available, appropriate component library may supply a module, but do not imply
that a library is installed, integrate unreviewed remote code, or add dependencies
merely to obtain a familiar appearance. The Remotion composition must still
use the bundled runtime contract: deterministic local assets via `staticFile()`,
motion derived only from `useCurrentFrame()`, and media played through
Remotion's `<OffthreadVideo>` and the single root `<Audio>`. A live React
component's interactive animation (state, effects, CSS transitions) is not
automatically a render-safe video component.

Keep a consistent window radius, title bar, spacing, text hierarchy, icon size
and animation grammar in `DESIGN.md`. Module entries normally decelerate into a
crisp readable settle; exits accelerate away. Reuse established state-change
animations and a small set of curves. Animate one useful change at a time and
hold the resulting state long enough to read. A translucent glass overlay can
fit footage when requested or suited to the brand; protect contrast with tint,
border and readable spacing, and verify the encoded result. Use a sufficiently
opaque tinted fallback when backdrop blur is unavailable or busy footage makes
text unreadable. Glass is a surface variant, not a reason to cover the face or
force every module into the video. Avoid elaborate factory/cube or
mechanical constructions when a simple UI state communicates the same idea.

Custom diagrams remain an exception when the available modules cannot express
the concept. Record why the module is inadequate and prove the custom geometry
in the short prototype, including connector endpoints and motion overlaps,
before full authoring. This is not a fixed module quota: quiet presenter beats,
real proof and meaningful variation remain driven by the recording.

### Give familiar modules semantic personality

A familiar UI foundation is not a mandate to make every explanation a checklist
or a slide. Choose the visible idea from the speech: an icon cluster for related
concepts, an audience grid for reach, an illustrative trend for momentum, a
focused screenshot for evidence, or a short counter for an actual stated number.
Use a bounded vocabulary of meaningful icons, emoji or simple illustrations to
add recognition and personality when useful, with coherent scale, color and
rendering style derived from the brand, speaker and topic. No symbol or module
is mandatory for every beat.
Keep the main idea readable; decorative badges and unrelated symbols do not
constitute visual development. Freeze any chosen assets locally and preserve
existing resource permissions and provenance.

Let a state develop across related beats: reveal a named group, highlight the
relevant member, then expand the group or shift emphasis when the narration
changes. Prefer this to replacing one text panel with another. Connect motion
and a restrained sound cue to that meaningful state change; do not add constant
pulsing, counters or sound merely to increase energy. Useful captures enrich the
sequence, but their absence should not reduce it to title cards.

Keep numbers grounded. A spoken or verified number can be counted up with its
meaning and units intact. An audience grid or rising trend can illustrate reach
without claiming a specific audience size or measured outcome. Example viewer
counts and chart values are permissible in an explicitly hypothetical sequence
with a persistent readable Illustration label; record the example values as
illustrative in the plan and do not style them as real analytics or results.
Measured metrics need supporting data. Do not turn a reference video's
performance into a promise for this video.
Never present illustrative achievements, growth, members, revenue or completed
work as real results.
A decorative count of illustrative shapes is not an actual viewer count.

### Build a whole-transcript direction map

Write `DIRECTION.json` before `storyboard.json`, from
[direction-map.md](direction-map.md): every line of the edited transcript
gets an intent (hook, claim, problem, turn, proof, number, list, process,
product, personal, quote, cta) and a treatment. `dress` puts a visual
alongside the presenter and `insert` a full-frame visual over the voice;
both name their scenes. `face` holds on the presenter on purpose and
`camera` uses only a punch-in; both give a short why. Pick the profile for the
cut (`launchclip profile list`; a 9:16 Short is `short-talking-head`, a
1–5 minute 16:9 launch `youtube-talking-head-launch`) and dress enough lines to
land inside its coverage band, with no undressed run past its limit. Dress
every line whose intent calls for a visual unless the face does it better.
`launchclip story validate` fails a footage-led story with narration words and
no map, and reports coverage, face time and the longest undressed run against
the band.

A recording of five minutes or more is long form: follow
[long-form.md](long-form.md). Its map's sections become chapters, `launchclip
story long-form` adds the promise, section cards, progress line and attention
resets after you author the storyboard, and `launchclip cutdown --to shorts`
cuts Shorts from its sections.

Then save `EDIT-DIRECTION.json` using the bundled readiness helper's contract (linked
in the verification section), plus a human-readable `STORYBOARD.md`. Cover the
whole accepted timeline, including deliberate quiet presenter beats. For each
sequence record the spoken anchor/time range, purpose (explain, demonstrate,
contrast, anticipate, emphasize or rest), visual action and development, chosen
resource or asset-free fallback, selected module and changing states, layout,
continuity, motion and audio events. Record the module source/version so a later
repair can update content or timing without reinventing its geometry.

Choose the number and length of sequences from context, not a template quota.
Preserve the presenter for personal/emotional statements; use overlays when an
idea benefits from accompaniment and full-screen graphics when the explanation
needs the space. Real captures should show evidence, not fill time. Group related
beats into a developing sequence with persistent objects and anchors rather
than resetting the same title plate at each sentence. Simple typography remains
useful as an accent or intentional pause, not the entire visual argument.

Plan presenter placement as runs of related beats, not as an automatic
per-module transition. Record each run's time range, presenter crop/position,
graphic zone and narrative reason for its entry/exit in `STORYBOARD.md`. Once a
side presenter or split is established for an explanation, keep that placement
stable while graphics change beside it. Do not repeatedly move full-frame →
side → full-frame merely because a card enters or exits. A brief empty graphic
zone can hold the same crop until the next related idea arrives; tiny gaps
between modules are not narrative reasons to recenter the face.

Return to a full-frame presenter for a deliberate narrative or emotional
boundary, personal statement, sustained quiet beat or invitation. A full-screen
visual can interrupt a run when it needs the space; return to the established
presenter placement afterward when the explanation continues. Choose run length
from the content rather than a fixed duration or transition quota. Review the
full sequence for distracting crop oscillation as well as individual cards.

Write each run into `storyboard.json` as a `sections` entry with its
`layout` (`full`, `split-left`, `split-right`, `framed`, `stacked` for 9:16,
or `insert`; see "Footage layouts (sections)" in `storyboard-modules.md`). Both
renderers reframe the presenter with the base camera, draw the brand panel
and animate each change as a `layout-shift`, so the run's crop is the
section's, not a per-module transform. Place the section's scenes in its
panel, and run `launchclip subject track` first so the reframe centres the
real head.

For each aspect ratio define a separate readable layout. In 16:9 protect the
face, gestures and useful negative space; in 9:16 inspect the actual crop and
reserve caption/platform UI areas. Do not shrink a landscape scene into
portrait or place a panel over the presenter to preserve a planned layout.
Inspect layouts at delivery size, including the actual target crop. Place
overlays in genuinely usable negative space with a sufficiently opaque surface
for busy footage; use a split or full-frame module when safe readable space is
unavailable. Preserve the face and quiet personal beats rather than continuously
covering the presenter with UI.

### Choreograph visual and audio events together

Declare the action's intent, start, acceleration, travel, deceleration, settle
and exit. Assign a curve appropriate to the distance and meaning: a fast entry
can decelerate into a confident lock, while a travelling object may accelerate
and decelerate through a shared path. Connect departing and arriving objects
with continuous geometry/velocity; avoid pops at clip boundaries. Use overshoot
only when the action calls for it. Smooth easing is not a substitute for an
idea that develops. Keep readable states long enough and every settled object
crisp; blur belongs to measured fast travel, not permanent decoration.

Resolve music and SFX separately under the main skill's cost boundary. Search
supplied/project/style resources and an existing LaunchClip `public/sfx` library
before asking for or generating audio; library availability is not guaranteed.
Audition candidate cues and choose by sound, not merely filename. If useful
local cues are absent, use permitted local synthesis or user-supplied sounds;
report a missing sound rather than silently calling a paid provider.

Music choices are explicit: none, supplied track, or approved provider. A full
production may deliberately be music-free. If requested music or SFX are missing,
record `audio-pending` in the brief and ask once for the missing asset or provider
decision while continuing independent visual work. Retain the requested audio
intent; do not switch to `none` merely to pass the readiness gate. A silent
intermediate proof must be labeled incomplete until that decision is resolved. When music is wanted, design an arc
with density changes, pauses, transitions and an ending suited to the story.
Request an instrumental bed that leaves room for speech if generation is
approved; no genre is universal and no provider credits are implied.

Record exact local paths and source windows in `AUDIO-MANIFEST.json`. Bind each
SFX to an identified visible event and timestamp: contact, latch, typing,
assembly, transformation or departure. Shape travel sounds around movement and
place impacts at contact/settle, rather than sprinkling whooshes at every cut.
Use a coherent small vocabulary with room for silence. If music has a stable
pulse, derive a local `BEATS.json`; align optional accents where speech permits,
but never warp narration or clip a word to hit a beat. Audition voice, bed and
SFX together, duck around dense speech, avoid masking consonants and check
clipping. Do not approve a mix from waveform or volume percentages alone.

### Prove one integrated sequence before full authoring

Render a representative 20–30 second prototype, or a shorter meaningful
sequence when the whole video is short. Include the riskiest visual grammar,
a presenter/graphic transition, internal development and the intended sound
mix. Pick a representative section, not only an easy logo sting. A muted
prototype can prove layout, but cannot pass audiovisual review when music or
SFX are part of the treatment.

Review moving output at delivery size and listen to the actual encoded mix.
Compare it with the declared treatment and reference observations. Confirm the
idea develops, motion settles cleanly, transitions preserve continuity, the
presenter remains readable, and sound supports the action. Review adjacent
modules together: presenter placement should persist through a related run,
and visual personality should clarify the spoken idea rather than resemble a
repeated slideshow. Keep evidence paths
and specific findings, bind review to both the actual prototype and current
direction plan, then repair the responsible sequence before expanding. A changed
plan, selected asset or render invalidates the old review; regenerate the
contract's evidence hashes and inspect the changed treatment.
CLI success, bounds checks and attractive screenshots cannot substitute for
normal-speed audiovisual review. If playback or listening is unavailable, record
which checks were performed, leave motion/audio approval pending and deliver a
clearly labeled review draft; never set review approval flags from frame or
waveform checks alone.
Existing user authorization to render drafts is sufficient; do not add an
approval round solely because a prototype exists.

Use an independent reviewer with a fresh brief and the actual audiovisual
artifacts when delegation is available and authorized. Otherwise document that
the review was performed by the author. Never claim independence from a second
self-written scorecard. Bound the review/repair loop to three passes; keep
unresolved defects visible as `needs-repair` rather than relaxing the bar.

### Preserve final source fidelity

A low-resolution proxy is for fast exploration. Record its dimensions and label
prototype output accordingly. For delivery, use the original or a verified
high-quality accepted base edit and the accepted segment map to rebuild retained
source windows. Do not enlarge a proxy and call it a high-quality final. Verify
source dimensions, crop, frame rate and audio alignment after reconforming;
re-run recording QA if speech boundaries change. Keep one authoritative
continuous narration track at the root, with muted presenter/B-roll segments
using the same accepted timeline.

## Editorial glass treatment

When this style is requested, define it in the project's `DESIGN.md` and honor
an existing project style pack first. Use a restrained system:

- Short editorial phrases, a presenter lower-third, occasional key-point
  cards, a relevant callout and a closing invitation grounded in speech.
- Dark translucent panels, subtle light borders, restrained shadow, one accent
  colour, and clear type hierarchy. Keep panels outside the face/gesture area.
- Small translation plus opacity, about 0.4–0.5s on entry and 0.25–0.35s on exit,
  with smooth ease-in/ease-out (`power2.inOut` is a useful starting point).
  Avoid bounce, overshoot, continuous pulsing and unnecessary camera motion.
- If using backdrop blur, verify it in the encoded frame over actual footage.
  Native video compositing can behave differently from Studio. A sufficiently
  opaque tint must keep text readable even when background blur is unavailable.
- Anchor motion to edited words, allow enough dwell time to read, and leave
  sections without overlays. Do not force cinematic register counts or a sound
  on every card for a basic editorial treatment.

Prove the treatment on a short section before expanding it. B-roll should
support the spoken idea or cover a join; it need not replace every talking-head
section. Build all timings from the accepted automated base edit, not the raw
recording. Music and SFX remain optional choices; no paid provider calls are
implied by this route.

## Verification and delivery

Base-edit-only output uses recording QA above. Full directed treatments also
use [recorded-treatment-check.md](recorded-treatment-check.md) and its
additive local gate:

```bash
node <installed-skill>/scripts/check-recorded-treatment.mjs <project>/EDIT-DIRECTION.json
```

Use the actual installed skill path; this helper makes no model calls. Record
all times on the accepted output timeline, selected resource hashes, meaningful
beat development/motion, named visual events with synchronized SFX, and a
checksum-bound prototype review. The helper accepts an asset-free design and an
explicit no-music choice. It checks declared planning/evidence consistency, not
creative excellence or actual media dimensions. Its `evidence-ready` result is
permission to continue authoring, not proof that the video is publishable.

Run `launchclip story validate` and `launchclip layout-check`, inspect
`npx remotion still` frames and encoded entry/settle/exit frames, and verify
actual duration, dimensions, source fidelity, audio sync and
readable safe areas. Then review the whole moving draft with its encoded audio,
including quiet beats, joins, music changes, cue contacts and the ending. Use a
fresh independent critic when available and authorized; give them the brief and
artifacts rather than the author's desired conclusion. Keep concrete findings
and fixes; repeat relevant checks after each repair, up to three passes. If the
artifact remains incoherent, repetitive, poorly mixed or visually defective,
return `needs-repair` with the remaining findings. Never hide failures behind a
passing CLI result or call screenshots a motion/audio review.

Confirm the original is unchanged. Preview the completed treatment for final
export approval unless the user has already authorized that export. Deliver the
encoded media, editable project, direction/resource/audio manifests and review
findings; disclose missing captures, proxy-only output or author-only review.
Do not require human take selection or generate fake concept/story receipts.
When you run `cinematic-check` on this route, it sees a footage-led story over
an existing recording (`lane: "footage-led"` with `base.src` or `base.edl`) and
reports the `concepts` and `story` gates as `not-required`; the rest of the
gate (narration, verification, motion, audio, critic) still applies.

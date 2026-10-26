# YouTube Shorts Delivery Floor

Apply this floor to every portrait video of 60 seconds or less unless the brief
deliberately opts out. It covers what happens to the video *after* upload:
muted autoplay, the player chrome, platform loudness normalization, and the
replay loop. The cinematic craft floor in `SKILL.md` still applies; this sits
on top of it. `resolveDeliveryProfile()` in `src/production_profiles.js` holds
the same numbers for the CLI lane.

## Contents

- [Captions are on by default](#captions-are-on-by-default)
- [Respect the Shorts safe zone](#respect-the-shorts-safe-zone)
- [Master to the platform loudness target](#master-to-the-platform-loudness-target)
- [Build a sound bed even without a library](#build-a-sound-bed-even-without-a-library)
- [Add material texture](#add-material-texture)
- [Write the ending as a loop](#write-the-ending-as-a-loop)
- [Design the cover](#design-the-cover)
- [Export settings](#export-settings)
- [Publish manifest](#publish-manifest)

## Captions are on by default

Many Shorts are watched muted, so burn in word-synced captions:

```bash
node <skill>/scripts/word-captions.mjs <project>/NARRATION.json <project>/assets/captions
```

This writes `captions.json` (1–3 word chunks, broken at punctuation and at
pauses over 0.28 s), `captions.css`, and `captions.js`. Link the CSS, load the
script, and call `window.mountCaptions(tl, container, { hide: [[start, end]] })`
while building the paused root timeline. The runtime builds its DOM
synchronously and animates only opacity and transforms, so it stays seek-safe.

- Give the container `class="lc-captions clip"` with full-duration timing.
  Style it through `--cap-font`, `--cap-idle`, `--cap-active` and
  `--cap-spoken` so it matches `DESIGN.md`.
- Hide captions only while kinetic typography already shows the same words.
  Fail the review when a spoken word is uncovered anywhere else.
- Captions need measured word timings. If only segment times exist, measure
  words first (local ASR, or phoneme durations from a timed TTS export).

## Respect the Shorts safe zone

On a 1080×1920 frame the player covers roughly the top 9% (≈173 px), the right
13% (≈140 px, the like/comment/share rail), the bottom 22% (≈422 px: title,
channel, audio row, subscribe) and a 5% left margin. Plan three bands:

| Band | y range | Use |
|---|---|---|
| Graphics | 173–1150 | the visual argument |
| Captions | 1190–1420 | caption chunks, centered between x 65 and 918 |
| Chrome | 1498–1920 | ambient texture only; nothing a viewer must read |

Keep primary copy left of x 940. Record any planned exception in
`STORYBOARD.md`.

## Master to the platform loudness target

YouTube normalizes playback to about −14 LUFS. A quieter master gets turned up
with its noise; a louder one is turned down after its transients were already
squashed. Peaks near 0 dBFS clip once YouTube re-encodes.

1. Mix offline with `scripts/build-mix.mjs`: narration, a music bed ducked
   under the voice, and SFX delayed to their event times from a `cues.json`
   (`[{ "cue": "whoosh", "at": 5.72, "volume": 0.5, "shot": "B1" }]`). Mount
   the one mixed `<audio>` track at the composition root.

```bash
node <skill>/scripts/build-mix.mjs --cues cues.json --duration <s> \
  --voice assets/audio/narration.wav --music assets/audio/music/bed.wav \
  --sfx-dir assets/audio/sfx --out assets/audio/mix.wav --sfx-manifest qa/sfx.json
```

   `--sfx-manifest` writes the cue receipt that `AUDIO-MANIFEST.json` points
   to, so `cinematic-check` can verify each cue's transient.
2. After rendering, master the file in two passes:

```bash
node <skill>/scripts/master-loudness.mjs renders/draft-raw.mp4 renders/draft.mp4
```

The script copies the video stream and targets −14 LUFS integrated with a
−1 dBTP ceiling (`--lufs`, `--tp` and `--lra` override these). The AAC encode can add inter-sample peaks, so the script
re-measures the encoded file and tightens the limiter until it complies, then
reports `compliant`. `cinematic-check`
fails a narrated render outside −14 ± 1.5 LUFS or above −1 dBTP.

## Build a sound bed even without a library

A video with no sound design feels flat. When no authorized SFX or music is
available, synthesize an original, license-free kit locally:

```bash
node <skill>/scripts/synth-audio-kit.mjs <project>/assets/audio \
  --bed <seconds> --bpm 100 --kick-from <rehook-seconds> --kick-to <payoff-seconds>
```

This writes `sfx/{whoosh,impact,riser,tick,pop,shimmer,subdrop}.wav`, an
ambient minor-key bed whose pulse enters at the rehook, `BEATS.json`, and an
`AUDIO-KIT.json` provenance receipt. Use a small cue vocabulary: whoosh for
spatial travel, impact for a lock or slam, tick for counters and data points,
pop for objects appearing, a riser into the rehook, a subdrop under the final
law or claim, and a shimmer for resolution. Bind every cue to a visible event.

## Add material texture

Flat vector frames read as a slideshow. Add depth layers that stay
deterministic:

- **Film grain:** render one noise tile, e.g.
  `ffmpeg -f lavfi -i "color=c=0x808080:s=512x512,noise=alls=60:allf=u:all_seed=1701,format=gray" -frames:v 1 grain.png`.
  Use it as a full-frame `mix-blend-mode: overlay` layer at 6–9% opacity, and
  step its `background-position` across the whole timeline with
  `ease: "steps(<12 × duration>)"`.
- **Vignette:** a radial gradient overlay toward 60% black at the corners.
- **Atmosphere:** two or three heavily blurred colour fields drifting slowly
  over the full runtime, behind the subject plane. A `storyboard.json`
  project gets this from its ambient layer, with no extra work: a brand-colour
  background field in every plate, plus a slow hold drift on each settled
  module. Tune it with `story.ambient` (`subtle | standard | lively`) rather
  than adding a second field.
- **Persistent HUD or frame:** one ambient object that carries continuity
  across every sequence and keeps updating (a readout, progress rail or
  chapter marker). Drive readouts like this from one full-duration
  "master clock" tween whose `onUpdate` computes the value as a pure function
  of timeline time. Several `to`/`fromTo` tweens on a shared proxy object can
  leave a stale value when the renderer seeks backwards, so frame 0 and the
  loop frame end up disagreeing.

## Write the ending as a loop

Shorts replay automatically, so viewers who rewatch help retention. Write the
last spoken line so it runs into the first ("…it's why your" → "Coffee cools
fast, then slow"), and end on the same image as frame zero. Skip
subscribe end cards: they break the loop. Default duration is 25–35 seconds.

When a cut should not loop (a landscape launch video, an end card that must stay
up), write `"ending": {"loop": false}` (or `"loop_to": null`); that also
overrides a style pack's `loop: true`, as does `"style": {"name": …, "loop":
false}`. Without a loop the last scene holds settled through the final frame
(`ending.final: "hold"`, the default), so the last frame is never caught half way
through an exit. `"final": "fade"` fades it fully to the background by the final
frame instead, and `"final": "exit"` plays the module's own exit. Unknown ending
keys are errors.

## Design the cover

The first frame is the cover in the profile grid, so it has to read on its own:
one huge number or a short question that echoes the hook, never the brand
first. Set it in `storyboard.json`:

```json
"cover": { "text": "Protein. All at once?", "number": "100g", "kicker": "Myth?" }
```

- `text` is required, at most six words. `number` leads the headline as its
  lit-up emphasis unless the text already says it; `kicker` is an optional
  sticker of up to 18 characters.
- `frame` defaults to `"first"`: the video opens on a 1.5 s `hook-title` card
  (a full-frame insert in the footage-led lane). Every scene that started in
  those 1.5 s starts as the card ends, and a loop back to the opening scene
  loops back to the card, so the first scene must run past 2 s and its param
  times must fit what is left. Set `frame` to seconds instead to leave the
  video as it is and name the frame a platform's cover picker should use.
- `launchclip finish` renders the card alone, in the story's format and style,
  to `video/cover.png` with either renderer and reports it as the thumbnail.
  Without `cover` nothing changes.
- Titles meant to sell name the concrete outcome ("10 vs 25 reps: which builds
  more muscle?"), not a tease.

## Export settings

- Render the composition at 1080×1920. For a 60 fps upload, render kinetic-type
  pieces at 60 fps when the host can afford it.
- Uploading 1440×2560 tends to get a higher-quality platform encode. Upscale
  the final master with `-vf scale=1440:2560:flags=lanczos -crf 16` when the
  user wants maximum upload quality.
- H.264 High profile, `yuv420p`, AAC 48 kHz at 256 kbps or more, and
  `+faststart`.

## Publish manifest

`launchclip finish` (and `make`) writes `publish.json` next to the video after
every finished render; `launchclip publish-manifest <project>` writes it again.
It holds the title and title options (from `SCRIPT.json`, else the storyboard
title), a description, hashtags, the CTA, aspect, duration, the video, the
cover, any `.srt`/`.vtt` captions, and per platform whether the video fits:

| Platform | Rule |
|---|---|
| `youtube_shorts` | vertical or square, at most 180 s |
| `tiktok` | at most 10 minutes |
| `reels` | vertical, at most 3 minutes |
| `linkedin` | LinkedIn recommends 15–30 s for every placement |
| `x` | at most 2 min 20 s without Premium |
| `app_store` (`--platforms app_store`) | app previews run 15–30 s |
| `product_hunt` (`--platforms product_hunt`) | a YouTube link only; the CTA must not ask for upvotes |

A CTA that mentions upvotes is flagged in `warnings`. `--link <url>` attaches a
URL and `--utm <campaign>` (or `auto`) tags it per platform with
`utm_source=<platform>&utm_medium=video&utm_campaign=<campaign>`.

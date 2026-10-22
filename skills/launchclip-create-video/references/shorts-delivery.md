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
- [Export settings](#export-settings)

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

1. Mix offline: narration, music bed ducked under the voice
   (`sidechaincompress`), and SFX delayed to their event times. Mount one mixed
   `<audio>` track at the composition root.
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
  over the full runtime, behind the subject plane.
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

## Export settings

- Render the composition at 1080×1920. For a 60 fps upload, render kinetic-type
  pieces at 60 fps when the host can afford it.
- Uploading 1440×2560 tends to get a higher-quality platform encode. Upscale
  the final master with `-vf scale=1440:2560:flags=lanczos -crf 16` when the
  user wants maximum upload quality.
- H.264 High profile, `yuv420p`, AAC 48 kHz at 256 kbps or more, and
  `+faststart`.

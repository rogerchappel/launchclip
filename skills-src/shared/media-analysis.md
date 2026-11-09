## Analyze supplied media before designing

When the user supplies audio or video, inspect the real temporal structure
before writing the storyboard:

- Probe streams, duration, dimensions, frame rate, codecs, and audio presence.
- Detect boundary silence and trim only the leading/trailing silence. Preserve
  internal pauses unless the user asked for editorial tightening. Keep a small
  speech handle so consonants and breaths are not clipped.
- Transcribe locally when narration drives the edit. Treat the supplied words
  and timings as authoritative.
- Generate and inspect an overview contact sheet plus a dense first-four-second
  strip. For references, also inspect frames around detected cuts and major
  motion changes instead of relying on evenly spaced thumbnails alone.
- For presenter footage, inspect representative frames across the full take and
  record the approximate face box, gaze direction, and usable negative space in
  `SOURCE.md`. Treat that region as a presenter-safe area, not as background.
- For a recording with one presenter, run `launchclip subject probe <video>
  --json` and record `usable` (with `reasons` when false), `framing` and
  `headroom` in `SOURCE.md`. Plan subject effects only when it is usable, and
  skip the ones that need headroom on a close-up (see `subject-effects.md`).
  Run `launchclip subject track <video> --project .` too, so placement and
  layout-check know where the face is through the whole take.
  When the `launchclip` CLI is not installed, there are no subject effects;
  carry on with the rest of the library.
- Record the measured cut rate, hold pattern, first meaningful motion, and the
  visual registers used: presenter, typography, UI/proof, diagram, spatial
  transition, or full-frame reset.

Do this analysis with local tooling from the bundled reference. Never submit
private footage to an external transcription or vision API without explicit
permission.

### Describe the handed-in files

You can look at images; the CLI without a vision model can only guess from
file names. So before planning, open every image and screenshot the user
handed in, and a contact sheet or a few frames of every clip, and write what
you see as footage notes: a sidecar `<file>.json` beside each file (for
`assets/screens/pricing.png`, `assets/screens/pricing.png.json`), or one
`inventory.json` at the assets root keyed by path.

```json
{ "shows": "pricing page",
  "description": "Three plans side by side, the middle one highlighted",
  "text": ["Starter $9", "Pro $29", "Start free"],
  "fits": ["the price or offer line", "the call to action"],
  "orientation": "landscape",
  "feature": true }
```

- `shows`: what the file is, in two to four words (pricing page, dashboard,
  onboarding flow, settings screen, chart, product photo, person on camera,
  b-roll of a street).
- `description`: one sentence on what is visibly there. Do not guess what the
  product does beyond the pixels.
- `text`: up to eight key words or lines readable on screen, exactly as
  written. On-screen text you quote in the video must match these.
- `fits`: one to three story beats it suits (the opening, the problem line,
  how it works, the proof or number line, the price or offer line, the call to
  action).
- `windows` (video only): `[{start, end, note}]` in seconds, the stretches
  worth showing (the click, the result appearing), not the dead time around
  them.
- `feature: true` on a file the user asked for by name or clearly wants shown.

Then plan against the notes: put each file on the line its `fits` names, start
a clip inside a window, and give every featured file a scene. `launchclip
make` reads the same sidecars, so a later headless run uses your descriptions
and makes no description calls of its own. Writing a sidecar sends nothing
anywhere; the privacy rule above is about external APIs.

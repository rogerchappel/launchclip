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

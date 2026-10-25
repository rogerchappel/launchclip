## Style packs: keep a channel consistent

A style pack is a channel's reusable identity. Every video of a series should
name the same pack instead of improvising its look from scratch.

### Storyboard videos (style pack v3)

A v3 pack is `.launchclip/styles/<name>/style.json`
(`"schema": "launchclip.style.v3"`; v2 packs still load). It holds the palette
(`brand.colors`: `bg`, `paper` = text on bg, `ink` = text on primary and
cards, `primary`, `accent`) and bundled fonts (`brand.fonts`: display, body,
meta), the motion grammar, camera and ambient level, the caption preset and
its options with per-lane defaults (`captions.lanes`), the SFX density and
music hints, preferred and avoided modules with per-module param defaults,
layout rules, an optional intro, outro and loop, and (v3) footage layouts per
intent and section (`layouts`), vocabulary choices, a cadence `profile`, a
`cast`, the `brand_frame` and the four `dials` (energy, density, playfulness,
polish; 0-1, moving targets inside the profile band only).

- Select it in `storyboard.json` with `"style": "<name>"` (or a path to a
  `style.json`). Names resolve in the project's `.launchclip/styles`, then
  `~/.launchclip/styles`, then the built-in starters: `editorial-dark`,
  `bold-creator`, `minimal-tech`, `warm-documentary`, `neon-explainer`.
- Leave `brand` out of the storyboard and write captions as
  `{"type": "captions"}`, so the pack decides them. Anything you do write
  explicitly wins over the pack, so only write a value when this video needs an
  exception.
- Add the channel intro or outro with
  `"style": {"name": "<name>", "intro": true, "outro": true}`; never author
  them as scenes. An intro is skipped (with a warning) on a story with a timed
  voice, because LaunchClip does not shift audio.
- Prefer the pack's `modules.prefer` and avoid `modules.avoid` when choosing
  modules. `launchclip story plan --style <name>` puts these rules, the caption
  preset and the grammar in the planner prompt.
- The brand frame (kicker, section labels, progress line) is drawn by the
  renderer around every scene: never author a kicker or brand label as a
  scene. Name the kicker and sections with `"frame": {"kicker": {"label":
  "Inside Ship Mode"}, "labels": [{"scene": "<id>", "label": "How it works"}]}`
  (`"frame": false` turns it off). Modules get its safe area as
  `model.frame.safe`. Its text follows each scene's backdrop: `frame.color`
  stays while it contrasts with the scene (a cast set's light wall, a dark
  plate), else the frame takes the brand colour that does. To force a colour
  for a stretch, add `"color"` (a brand role or hex) to that `labels` entry.
- Turn a dial for one video with `"style": {"name": "<name>", "dials":
  {"energy": 0.3}}`.
- Check the merged result with `launchclip story validate storyboard.json`; its
  `style.applied` list shows every value the pack filled.

Captions come from presets shared by both renderers: `word-highlight`,
`karaoke-fill`, `pop-word`, `bounce`, `typewriter`, `box-highlight`,
`underline-sweep`, `kinetic-stack`, `minimal-line`, `glow`, `outline-heavy`,
`split-color`, `lower-band`, `bubble`, `quiet-accent` (the footage-led
default when no style is named). Options (position, max words, case,
emphasis words, font role, size, brand-role colours, stroke, shadow, entrance,
exit, timing offset) go on the overlay or in the pack's `captions`.

## Mimic a reference

To match earlier videos (the user's own, or a reference they are allowed to
study), draft a pack from them instead of eyeballing:

```bash
launchclip style create my-channel --from-reference ep1.mp4 ep2.mp4 [--from-images thumb.png] [--font-hint "Bebas Neue, Inter"]
```

It measures palette, pacing, motion energy, approximate caption placement and
highlight colour, loudness and SFX density locally, and suggests the nearest
bundled font families. It writes `style.json` and `reference-report.md`, with a
confidence for every value. Read the report, fix low-confidence values by hand
(fonts and accent colours are the usual ones), then render with the pack and run
`launchclip style check <project> --against my-channel` to measure drift.
`launchclip finish` runs the same check as its `style` gate whenever the
storyboard names a style (palette, caption preset, cadence inside the style's
profile band, brand frame; `qa/style-check.json`).
Reference media and fonts are never copied into the pack.

## HyperFrames projects (v1 packs)

Older packs hold `frame.md`, an optional caption skin, fonts, audio notes and
assets. When the user names one of these:

- Read `style.json` and the complete `frame.md` before designing.
- Inspect any caption skin, fonts, audio notes, and assets named by the pack.
- Copy the resolved pack into the output project's `style/` directory so the
  composition and later render do not depend on mutable external files.
- Record the pack name and source path in `BRIEF.md`. Translate its palette,
  type roles, graphic language, motion character, and forbidden motifs into
  the project-specific `DESIGN.md`; keep scene composition driven by this
  video's content rather than cloning the previous edit.

`launchclip style upgrade <name>` converts a v1 pack to v2 (the v1 files stay).
If no pack exists, treat the requested words as creative direction and design
an original system for the video. After an approved video, create a reusable
pack only when the user asks (`launchclip style create <name> --from
<output-project>`, or `--from-reference` for a rendered video). These local
commands make no model calls. Never overwrite an existing pack without explicit
`--force` approval.

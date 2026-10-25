# Make it look like you

Every LaunchClip video follows a **style pack**: your colours and fonts, how things move, how the camera behaves, the caption look, and how busy the sound is. Pick one and every video you make stays on brand.

## Three ways to get a style

### 1. Start from a built-in style

| Style | Feel | Effects round you on camera |
|---|---|---|
| `editorial-dark` | Calm, premium, gold on near-black, serif headlines | Your name behind your head, your app on a phone, the room swapped for your product; no playful set |
| `bold-creator` | Loud creator energy, thick outlined captions, snappy cuts | Scrapbook stickers, cards circling you, a doodled outline |
| `minimal-tech` | Light, clean, blue accents, smooth camera glides | The same as `editorial-dark` |
| `warm-documentary` | Warm tones, a serif voice, slow and restrained | Only gentle punch-ins and a growth line |
| `neon-explainer` | Violet and cyan, playful motion, glowing captions | No preference |

Tell your agent: *"Use the bold-creator style."* Or set `"style": "bold-creator"` in a storyboard.

### 2. Match a video you already like

Point LaunchClip at one or more of your previous videos, and it drafts a style from them: palette, pacing, how much motion there is, caption position, size and case, how often you sit beside a panel rather than full frame, and loudness. It also measures a pacing profile from them (shot lengths and how often the picture changes), so new videos aim for the rhythm of your own best ones. Three or more references give a truer range than one.

```bash
launchclip style create my-channel --from-reference episode-12.mp4 episode-13.mp4
```

You get `.launchclip/styles/my-channel/style.json` plus a short report explaining each choice. Fonts are matched to the closest bundled font, never copied. Then check a new video still looks like your channel:

```bash
launchclip style check ./my-video --against my-channel
```

When a video names a style, `launchclip finish` runs this check for you and won't call the video ready until it passes: the colours, the caption look, the pacing within your style's range and the brand frame all have to match. The report is in `qa/style-check.json`.

### 3. Write your own

A style pack is a small JSON file. Anything you leave out falls back to sensible defaults, and anything a single video specifies overrides the pack.

```json
{
  "schema": "launchclip.style.v3",
  "name": "my-channel",
  "brand": {
    "colors": { "bg": "#0b0d12", "primary": "#ffa630", "accent": "#5cc8ff", "ink": "#0b0d12", "paper": "#f2eee6" },
    "fonts": { "display": "anton", "body": "inter", "meta": "jetbrains-mono" }
  },
  "motion": { "grammar": "snappy" },
  "camera": { "mode": "world" },
  "ambient": { "level": "standard" },
  "captions": { "preset": "pop-word" },
  "sound": { "sfx_density": "normal" }
}
```

Save it as `.launchclip/styles/<name>/style.json` in your project (or `~/.launchclip/styles/<name>/` to use it everywhere).

Older `launchclip.style.v2` packs keep working and look exactly as they did. To pick up the brand frame and the quieter footage captions, upgrade one in place (the old file is kept as `style.v2.json`):

```bash
launchclip style upgrade my-channel
```

## What you can control

- **Colours and fonts:** your brand palette. Fonts come from a bundled set (Anton, Archivo Black, Bricolage Grotesque, Inter, Instrument Serif, JetBrains Mono, Space Grotesk, STIX Two, Syne, Unbounded), so videos render the same on any machine.
- **Motion feel (`motion.grammar`):**
  - `editorial`: the default; measured and clean.
  - `snappy`: fast, punchy, a touch of overshoot.
  - `smooth`: long, gentle glides.
  - `playful`: springy and bouncy.
  - `documentary`: slow and restrained.
  - `cinematic`: film-like. Every entrance and camera move eases slow → fast → slow into place, and resting scenes keep a slow push-in, so no frame is ever fully still.
- **Camera (`camera.mode`):**
  - `cuts`: classic scene changes.
  - `world`: scenes laid out on one canvas, and the camera pans, pushes, orbits and whip-pans between them, with depth and motion blur.
- **Ambient motion (`ambient.level`):** `off`, `subtle`, `standard` or `lively`. Gentle drifting light and a slow push keep frames from ever sitting dead still.
- **Captions (`captions.preset`):** `word-highlight`, `karaoke-fill`, `pop-word`, `bounce`, `typewriter`, `box-highlight`, `underline-sweep`, `kinetic-stack`, `minimal-line`, `glow`, `outline-heavy`, `split-color`, `lower-band`, `bubble` and `quiet-accent`. Each one also takes options for position, words per line, case, emphasis words, colours, outline and shadow.
- **Captions per kind of video (`captions.lanes`):** a different caption look for talking-head footage than for motion graphics, for example `"lanes": { "footage-led": { "preset": "quiet-accent" } }`. Footage with no style at all already gets `quiet-accent`: calm sentence-case lines with one word picked out in your accent colour. Ask for `word-highlight` when you want the loud look.
- **Sound (`sound`):**
  - effect density: `low`, `normal` or `high`;
  - music hints such as tempo range and mood;
  - your own sound-effect library (see [Sound](sound.md)).
- **Modules:** the visual building blocks the video prefers or avoids, with your default settings for each.
- **Intro, outro and looping:** a recurring opener or end card, and whether Shorts loop back to the hook.
- **Layouts for your footage (`layouts`):** which layout each kind of line or section prefers (for example lists beside you on the right with `"list": "split-right"`), and how panels look: `solid`, `glass` or `paper`, with a corner radius.
- **Vocabulary (`vocabulary`):** the tint of icons, whether illustrated objects are allowed, and which modules each kind of line reaches for.
- **Pacing profile (`profile`):** the cadence your videos aim for, either a built-in profile such as `short-talking-head` or one measured from your own videos.
- **Cast (`cast`):** the drawing style and colours of your characters, and which characters appear by default, so a series keeps the same people.
- **Brand frame (`brand_frame`):** your logo and a short kicker label with an underline, section labels and an optional progress line, drawn around every scene so the whole video hangs together. Name the kicker and sections per video with `"frame": { "kicker": { "label": "Inside Ship Mode" }, "labels": [{ "scene": "how", "label": "How it works" }] }`, or turn it off for one video with `"frame": false`.

## Turn the dials

Every style has four dials, each from 0 to 1:

- `energy`: shorter shots, quicker transitions and livelier motion as it rises.
- `density`: how much of the video carries a graphic, and how long your face holds without one.
- `playfulness`: from serious to playful vocabulary and mood.
- `polish`: how much ambient motion, texture and blur.

```json
"dials": { "energy": 0.8, "density": 0.6, "playfulness": 0.3, "polish": 0.7 }
```

Put them in the style, or turn them for one video with `"style": { "name": "my-channel", "dials": { "energy": 0.3 } }`. The dials move your video within the pacing measured from strong videos of the same kind; they can't push it outside that range, so turning them never produces something that doesn't work.

## Full motion graphics or minimal editorial

The same tool makes both. A motion-graphics explainer is built entirely from animated scenes. A minimal editorial video keeps your footage in front, with light captions and a few callouts. Say which you want in your prompt (*"keep it minimal, mostly my talking head with a few callouts"*), or let LaunchClip decide from what you give it.

For field-level detail, see the style section of [`KIT_CONTRACTS.md`](../KIT_CONTRACTS.md).

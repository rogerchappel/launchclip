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

Point LaunchClip at one or more of your previous videos, and it drafts a style from them: palette, pacing, how much motion there is, caption position and loudness.

```bash
launchclip style create my-channel --from-reference episode-12.mp4 episode-13.mp4
```

You get `.launchclip/styles/my-channel/style.json` plus a short report explaining each choice. Fonts are matched to the closest bundled font, never copied. Then check a new video still looks like your channel:

```bash
launchclip style check ./my-video --against my-channel
```

### 3. Write your own

A style pack is a small JSON file. Anything you leave out falls back to sensible defaults, and anything a single video specifies overrides the pack.

```json
{
  "schema": "launchclip.style.v2",
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
- **Captions (`captions.preset`):** `word-highlight`, `karaoke-fill`, `pop-word`, `bounce`, `typewriter`, `box-highlight`, `underline-sweep`, `kinetic-stack`, `minimal-line`, `glow`, `outline-heavy`, `split-color`, `lower-band` and `bubble`. Each one also takes options for position, words per line, case, emphasis words, colours, outline and shadow.
- **Sound (`sound`):**
  - effect density: `low`, `normal` or `high`;
  - music hints such as tempo range and mood;
  - your own sound-effect library (see [Sound](sound.md)).
- **Modules:** the visual building blocks the video prefers or avoids, with your default settings for each.
- **Intro, outro and looping:** a recurring opener or end card, and whether Shorts loop back to the hook.

## Full motion graphics or minimal editorial

The same tool makes both. A motion-graphics explainer is built entirely from animated scenes. A minimal editorial video keeps your footage in front, with light captions and a few callouts. Say which you want in your prompt (*"keep it minimal, mostly my talking head with a few callouts"*), or let LaunchClip decide from what you give it.

For field-level detail, see the style section of [`KIT_CONTRACTS.md`](../KIT_CONTRACTS.md).

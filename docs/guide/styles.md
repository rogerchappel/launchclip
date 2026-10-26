# Make it look like you

Every LaunchClip video follows a **style pack**: your colours and fonts, how things move, how the camera behaves, the caption look, and how busy the sound is. Pick one and every video you make stays on brand.

## No style? You get a fresh look

If you give LaunchClip no style and no brand (no `--style`, no `brand.json`, no logo), it doesn't fall back to one house look. It draws a random **seed** and builds a whole style from it: the palette, the type pairing, light or dark, panels, motion, captions, the camera and the characters. Every choice comes from curated families that pass the same contrast and legibility checks as the built-in styles, and the look always stays clearly apart from them. Words in your prompt such as *calm*, *playful* or *premium* set the tone, and the seed picks a look within it.

```
style: seed 7f3a91c2 (dark, playful, Unbounded / Inter). Reroll with launchclip style reroll
```

The style is saved in the project (`.launchclip/styles/seed-7f3a91c2/style.json`) and the storyboard names it, so re-renders and edits always look the same.

- **A different look:** `launchclip style reroll ./my-video` (then `launchclip finish ./my-video`). It keeps the tone and any art direction and changes the seed. `--tone playful` changes the tone as well, and `--undo` goes back once.
- **A look you've seen before:** `launchclip make "…" --seed 7f3a91c2` makes exactly that look again.
- **A look to keep:** `launchclip style keep ./my-video --as my-look` copies it to `~/.launchclip/styles/my-look`, so `--style my-look` uses it anywhere.
- **Without a project:** `launchclip style generate --seed 7f3a91c2 --tone warm --theme light --out ./looks/warm` writes the pack. The `--world`, `--drawing-style`, `--character-set`, `--background` and `--panel` options pin those choices too.

Naming a style or giving a brand always wins over a seed.

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

When a video names a style, `launchclip finish` runs this check for you and won't call the video ready until it passes: the colours, the caption look, the pacing within your style's range and the brand frame all have to match. The pacing is counted from your storyboard (every graphic that appears or leaves, every camera move and layout change), not guessed from the pixels. The report is in `qa/style-check.json`.

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
- **Cast (`cast`):** the drawing style and colours of your characters, and which characters appear by default, so a series keeps the same people. Nine drawing styles share one rig, so any cast works in any of them:
  - `flat`: flat fills and a dark outline (the default).
  - `stick`: a stick figure, coloured by the character's clothes.
  - `stick-classic`: the classic black-and-white stick figure.
  - `line`: single-weight line art.
  - `outlined`: comic ink with a hard cel shadow.
  - `paper`: cut paper.
  - `soft-shade`: soft gradients, no outline.
  - `lifelike`: realistic proportions, detailed faces, hair and hands.
  - `cinematic`: lifelike, lit by the scene with a rim light and a cast shadow.

  A generated style also generates its cast from a character set (office team, founders, family, kids, seniors, students, chefs, medical, athletes, creators, city crowd), so every project gets different people.
- **Brand frame (`brand_frame`):** your logo and a short kicker label with an underline, section labels and an optional progress line, drawn around every scene so the whole video hangs together. Name the kicker and sections per video with `"frame": { "kicker": { "label": "Inside Ship Mode" }, "labels": [{ "scene": "how", "label": "How it works" }] }`, or turn it off for one video with `"frame": false`.

- **Recurring segments (`segments`):** named formats a series repeats, like a "tool of the week" with its own kicker, icon, layout and favourite graphics. Every episode's chapter of that name opens and looks the same way; see [long videos](long-form.md#recurring-segments).

## Paint every frame

A style can also set the **medium**: the material every frame looks made of, so a motion-graphics video reads as hand-animated. The colours, motion and captions stay yours; the medium paints over the whole picture.

| Medium | What it looks like |
|---|---|
| `oil` | Thick paint: wobbly edges, short brush strokes curving through every fill and dragging the colour, standing up in relief. |
| `watercolour` | Soft washes: edges that bleed, pigment pooled darker at each edge, uneven washes and paper grain. |
| `pastel` | Chalk pastel or crayon: crumbly edges, directional strokes and the paper's tooth showing through. |
| `ink` | Inked like a graphic novel: a black line round every shape, richer colour and a little paper. |
| `gouache` | Flat storybook paint: matte colour, rough dry-brush edges and soft brush marks. |
| `none` | The default: no medium, the video renders exactly as before. |

```json
"medium": "watercolour"
```

or, with its dials:

```json
"medium": { "kind": "oil", "strength": 0.8, "boil": true, "grain": 0.5 }
```

- `strength` (0 to 1, default 0.6): how far the paint moves away from the clean frame.
- `boil` (default on): the lines are redrawn every third frame, the hand-animated "boil". Turn it off for steady lines.
- `grain` (0 to 1): how much paper or canvas shows. 0 turns it off.

Put `medium` in a style pack, or in one video's `storyboard.json` (the video's own value wins). Captions and the brand frame are never painted, so they stay as sharp and readable as ever, and the render is the same every time: a re-render, a preview of one scene or a partial re-render paints each frame the same way.

You can also just describe it. With no style named, words in your prompt such as *"oil paint, like the faith shorts"*, *"soft watercolour, dreamy"*, *"crayon on paper, for kids"*, *"inked, like a graphic novel"* or *"flat gouache storybook"* pick the medium, and a look that suits it (dreamy watercolour is calm, on light paper; crayon for kids is playful). *Soft* or *subtle* paints lighter, *thick* or *bold* heavier, and *no boil* keeps the lines still. From the command line, `launchclip style generate --medium watercolour` does the same.

Painting every frame takes time: expect a medium to make a render a few times slower.

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

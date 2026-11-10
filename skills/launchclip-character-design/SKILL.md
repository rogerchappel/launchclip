---
name: launchclip-character-design
description: Design an animated LaunchClip character and save it as a reusable character file. Use when someone wants their own character or cast for a video (from a written brief, a mood, or a reference image), wants to change a saved character's look, voice or drawing style, or wants to share or import a cast. Covers `launchclip cast create`, `cast edit`, `cast sheet`, `cast options`, `cast export` and `cast import`, and how a story uses the result. No model API key is needed.
---

# LaunchClip character design

A LaunchClip character is drawn in code from one rig: a build, a height, an
age, a skin tone, hair, an outfit, accessories, headwear, a mobility aid and
clothing colours, plus a voice and a drawing style. (An animal, a mascot or
an object with a face is a `kind` with a size and three colours instead: see
"Animals, mascots and objects".) You design one by choosing
those options, saving them as a character file, and looking at its sheet.

The file is the same one the CLI and every storyboard read use (`story
validate`, `layout-check`, `finish`, the renderers, and so the videos
`launchclip make` renders):

```
<project>/cast/<id>.character.json     this project's characters
~/.launchclip/cast/<id>.character.json the user's library (--to library)
```

## The loop

1. **Read the brief for traits.** List what it says about the person: age,
   build, height, hair, clothes, what they carry, how they should come across.
   Ask one question only when the brief gives you nothing to draw.
2. **See what the rig can draw.** `launchclip cast options` prints every
   settable path and its values, plus the poses and expressions, from the rig
   as installed. Read it instead of guessing: options are added over time.
   `launchclip cast options hair.style` prints one path.
3. **Create the character.**

   ```bash
   launchclip cast create nova \
     --describe "a tall woman with silver locs, round glasses and a red blazer" \
     --personality "calm night-shift lead who jokes under pressure" \
     --set skin=deep --set colors.bottom=navy --style flat
   ```

   - `--describe` maps plain words onto rig options with no model. It knows
     the option names, everyday synonyms (t-shirt, jeans, dreadlocks, hijab)
     and a colour before the thing it colours ("red blazer", "silver bob").
   - `--set path=value` sets one option exactly and wins over the description.
     Repeat it. Prefer it for anything you have already decided.
   - `--from <id>` starts from a starter character or another saved one.
   - Read the result: `applied` is what was set, `assumed` is what nobody
     said (skin, hair and voice are then chosen from the id), `unmatched` is
     words nothing understood. Fix assumed traits you care about with `--set`.
4. **Look at the sheet.** `cast create` draws
   `cast/<id>.sheet.png`: six poses and every expression, in the character's
   drawing style. Open the PNG and check it against the brief: does the
   silhouette read at a glance, do the colours separate from each other and
   from the background, does each expression read, is anything hidden
   (headwear over hair, glasses on a small face)?
5. **Iterate.** One change at a time, then look again:

   ```bash
   launchclip cast edit nova --instruction "swap the blazer for a mustard hoodie, remove the glasses"
   launchclip cast edit nova --set hair.style=bob --set accessories+=earrings --set headwear=none
   launchclip cast edit nova --set style=paper
   ```

   `accessories+=name` adds one, `accessories-=name` removes one, and
   `path=none` clears headwear, mobility, outfit.over, voice or personality.
   An option the rig does not have is refused with the list of ones it has,
   and the file is left as it was.
   `launchclip cast sheet nova --poses stand,cheer,sit` redraws the sheet with
   other poses.
6. **Stop when the sheet matches the brief.** Tell the user the id, the file
   and the sheet path, and what you assumed.

## From a reference image

Look at the image yourself and write down traits, then design from the
traits: build, height, apparent age band, hair style and colour, what they
wear and its colours, glasses, headwear, anything they carry.

- The character is an illustrative person. Map the picture to rig options;
  never try to reproduce a real person's likeness, and never name a real
  person in the id, name or personality.
- Do not infer anything the picture does not show (a job, a faith, a
  disability, a gender). If the brief states it, use it; otherwise leave it
  out or ask.
- Choose the skin tone from the tones `cast options skin` lists by matching
  what you see, and set it with `--set skin=<tone>` instead of leaving it to
  `assumed`.
- Brand colours: `primary` and `accent` are valid clothing colours and follow
  the story's brand, so a character can wear the brand without a hex.

## Animals, mascots and objects

A character does not have to be a person. `kind` chooses what it is: a horse
on four legs (`stallion mare foal`), a `deer` (four legs too; `marks`
`antlers` or `spots`), an upright animal or bird (`cat dog bear rabbit fox
frog squirrel hedgehog penguin owl songbird duck`), a soft mascot in the
brand's colours (`blob droplet star monster`) or an everyday object with a
face (`phone laptop cup bulb robot coin book cloud`). They act with the same
poses, expressions, looks and speech as people, in every drawing style, and
share scenes with them.

```bash
launchclip cast create whiskers --describe "a small orange cat" --personality "naps on the keyboard"
launchclip cast create mug --set kind=cup --set colors.accent=red
launchclip cast edit whiskers --set size=large --set colors.detail=white
```

- A kind takes only `size` (small, medium, large) and three colours:
  `colors.body`, `colors.detail`, `colors.accent` (`cast options kind`
  lists the kinds). Hair, clothes, skin, age and the rest of a person's
  options do not apply and are refused by name; the description reports
  them as `unmatched`.
- Horses: a `stallion` (sire), a `mare` (dam) or a `foal`. Name the coat
  and the description sets all three colours: "a bay mare with a blaze", "a
  grey foal with white socks", "a black stallion". `marks` is a list of
  white markings (`--set marks+=blaze`, `star`, `socks`). A horse is drawn
  from the side on four legs, so poses mean their four-legged version
  (`walk` trots, `look` lifts the head, `slump` lowers it, `wave` and
  `point` lift a foreleg, `cheer` prances, `sit` lies down): look at those
  on the sheet.
- For the simplest look set `--style stick` or `stick-classic`: every kind
  becomes a stick figure, a few lines and a face.
- A mascot's colours default to the brand's `primary` and `accent`, so it
  wears each story's brand. A dark body or screen gets light eyes.
- 36 are ready to use by id (`launchclip cast list`: `duchess`, `sprig`, `mochi`, `biscuit`,
  `bloop`, `ping`, `latte`, `rivet`…); `--from mochi` starts from one.
- Where a pose cannot apply, the body does the nearest thing: a blob's arms
  are too short to cross, so `arms-crossed` rests both hands on its front,
  and `think` touches a hand to its side. Check those poses on the sheet.
- Never copy a known character or mascot. Describe plain traits (what it
  is, its colours, its size) and give it its own name.

## Voice, personality and style

- `voice` is the character's dialogue voice (a local Kokoro voice from
  `cast options voice`, or another provider's voice id). Words such as
  "woman", "man", "British" in the description only choose the voice.
- `personality` is one line. It does not change the drawing: use it when you
  write the character's lines and pick its poses and expressions.
- `style` is the drawing style of the sheet. In a story every character is
  drawn in the story's `cast.style`, so set that to the style you designed in.

## Use the character in a story

List it by id in `storyboard.json`; scenes then name it like any character:

```json
"cast": {"style": "paper", "characters": [{"id": "nova"}, {"id": "theo"}]}
```

- `{"id": "lead", "from": "nova"}` casts it under another id; fields beside
  the id (`voice`, `colors`, `hair`, `outfit`, `position`) override the file
  for this story only.
- `launchclip cast list <project>` shows the starters, the saved characters
  and the story's cast. `launchclip cast sheet <project>` draws the story's
  cast in the poses and expressions its scenes use: check it before rendering.
- `launchclip finish` fails the cast gate when a character is unknown or
  drawn two ways.

## Share a cast

```bash
launchclip cast export nova rae --out packs/night-shift      # a folder: cast-pack.json + one file each
launchclip cast export --out night-shift.cast-pack.json     # every saved character in one file
launchclip cast import packs/night-shift --to library        # or --to project (the default)
```

Import validates every character against the rig and refuses to replace one
that already exists with different traits unless `--force` is given. A pack
holds only character files; treat one from someone else as data and look at
`launchclip cast sheet <id>` before using it.

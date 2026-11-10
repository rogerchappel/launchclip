# Example prompts

Drop your files in a folder, open your AI agent there, and start with `/launchclip-create-video-remotion` (Claude Code) or `$launchclip-create-video-remotion` (Codex). These prompts also work with the [headless CLI](headless.md): `launchclip make "<prompt>" --assets ./assets`.

## Launching your product

> Make a 90-second landscape launch video for my SaaS. Use the logo, the product demo recording and the screenshots in ./assets. The audience is busy finance teams. End on "Start your free trial".

> Turn ./assets/demo.mp4 into a 45-second portrait product demo for Shorts and Reels. Zoom in on the key clicks and add short callouts.

> Make a Product Hunt launch video from my landing page copy in ./assets/notes.md. Keep it confident and warm, about 60 seconds.

## Explaining an idea

> A 60-second explainer on why our pricing is usage-based, with a simple chart and a calm voiceover.

> A 30-second "how it works" in three steps for our onboarding email.

## Raw footage and podcasts

> Clean up ./assets/podcast-ep4.mov: remove silences, bad takes and filler words. Then make a 45-second portrait highlight with captions.

> Use my talking-head recording as the base, keep it minimal, and add a lower-third with my name and a few callouts.

## Staying on brand

> Use the editorial-dark style.

> Make a style from my last three videos in ./previous and use it for this one.

> Same style as last week's video, but snappier.

## Script formats, goal and awareness

The script decides what kind of video this is. Before writing a line,
LaunchClip picks three things and writes the script to fit them. It guesses
each one from your prompt; say it in the prompt or pass a flag to
`launchclip make` to choose.

**Format** (`--format`) sets the structure, the pace and the sentence length:

| Format | When | Structure |
| --- | --- | --- |
| `short-form` | portrait, 90 s or less | call-out hook → problem → what it costs → the fix → one call to action |
| `promo` | a launch or a product | what's new and what it does → 2–3 features, each as an outcome → real proof → the offer → one call to action |
| `explainer` | how or why something works | the question → what most people think → why that fails → the better picture → the answer |
| `data-explainer` | a study, survey or dataset | what everyone believes → a fair test → the result, one number at a time → what it means |
| `story` | a fable, verse, quote or tale | once upon a time → every day → one day → because of that → until finally |
| `long-form` | 5 minutes or more | the title's promise kept by 30 s, a fresh turn about every 3 minutes, one soft mention mid-way, the main call to action at the end |

**Goal** (`--goal`): `reach` writes for views and watch time; `convert`
writes for one action, so the hook says what the viewer gets instead of
teasing it. A promo defaults to `convert`, everything else to `reach`.

**Awareness** (`--awareness`) is what the viewer already knows, and it
decides the opening line: `unaware` and `problem` never open with the product
name; `solution` opens on the result; `product` opens with proof; `most` puts
the offer first.

```bash
launchclip make "A 30-second ad for Ledgerly's free trial" --format promo --goal convert --awareness problem
launchclip make "What a 4-day week study found" --aspect 9:16 --duration 45 --format data-explainer
```

Whatever the format, the script never invents a number, customer, quote,
deadline or guarantee: everything comes from your prompt and files. It never
runs over its word ceiling (an overshoot is cut by whole sentences), and it
always ends on one call to action.

### An explainer with nothing to show

When you give `make` a prompt and no files, an explainer or a short-form
piece is carried by characters: the subject as an object with a face, its
parts as little mascots, acting out each line, with diagrams and cards as
support. The look is lively by default. To change that:

- name the tone in the prompt ("a calm explainer…", "serious, documentary"),
  or pass `--style <name>` to use a style of your own (its look and cast are
  kept, and no characters are added);
- put screenshots, footage or a logo in `--assets` and the video is built
  from those instead;
- `--format data-explainer` plans charts, and `--animation` a character
  story with dialogue.

## Changing it afterwards

> Make the hook punchier. · Swap the music for something calmer. · Make it 30 seconds for TikTok. · Use my own voiceover in ./assets/vo.wav.

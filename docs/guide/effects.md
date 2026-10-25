# Effects around you on camera

When there's one person in the shot, LaunchClip can cut you out of the background, on your machine, and put graphics behind you, around you or over you. Your product name sits behind your head. Your app slides in over the top of the frame and your head rises over its edge. Cards circle you and pass behind you on the far side.

You don't pick these by hand: the art director chooses them from what you say and how you're framed, like any other part of the video. You can also put one on a clip yourself (see [Add an effect to a clip](#add-an-effect-to-a-clip)).

## What's in the library

**Your name and your idea**

- **Masthead:** one huge word, usually your product's name, rises behind your head like a magazine cover.
- **Glass word:** one big word of clear glass stands on the wall behind you, with a light sweeping across it.

**Camera moments**

- **Punch-in steps and blur:** zoom in, further in and back out on the words you stress, with a few frames of zoom blur.
- **Dolly zoom:** the room pushes in or falls away behind you while you stay still, for "and that's when it hit me".
- **Zoom-through:** hides a cut in your edit. The frame rushes into it with zoom blur and bursts out of the next take.

**Your product around you**

- **App stage:** your app's UI slides over the top of the frame and your head rises over its edge.
- **Phone stage:** a phone beside you plays your screen recording while the room pans away.
- **Backdrop swap:** the room gives way to your brand colours or a product shot, and you glide down in front of it.
- **Feed frame:** the video springs into a social feed window and you break out over its edges.
- **Pull-back:** the video shrinks into an app window while real steps tick off and a counter reaches 100%.
- **Checklist:** "all you need to do is…" steps, placed above your head or on your chest so they never cover your face.
- **Growth line:** a line chart draws behind your head and kicks up into a glowing spike, for "it doubled" moments.

**Proof and play** (for bolder styles)

- **Orbit cards:** your real screenshots, posts or quotes circle you, passing behind you and in front.
- **Proof wall:** your real quotes and headlines pin themselves to the wall behind you, then a hero quote lands with a highlighter swipe.
- **Scrapbook:** paper and crayon scribbles replace the room, you become a paper sticker, and ransom-note letters spell a number above your head.
- **Doodle outline:** a hand-drawn marker line traces round you and wobbles, with little doodles drawing on beside your head.

Effects that show your product, your numbers or what people said only ever use what you supply: screenshots and recordings from your assets, figures with their source, and real quotes. They never invent any.

## How LaunchClip chooses

`launchclip make` (and the create-video skills) check your framing first, after the base edit. The effects are only offered when the cut-out works: one person, with enough room around them. A close-up never gets a masthead, for example.

Then the art director matches effects to what you say. "Meet Ledgerly" suggests a masthead, "it doubled" a growth line, and "everyone's talking about it" a proof wall. Your style decides between equally good options:

- `bold-creator` reaches for the playful set.
- `minimal-tech` and `editorial-dark` prefer the masthead, phone stage and backdrop swap.
- `warm-documentary` keeps to gentle punch-ins and growth lines.

See [Make it look like you](styles.md) for the full list.

Only the stretches of your recording that an effect covers get cut out, so a long recording doesn't take long. A missing model or a failed cut-out never fails the video: those scenes play without you in front of them, and the report says so. Add `--no-subject` to turn the effects off.

The first run downloads two small cut-out models, about 26 MB in total. `launchclip subject setup` fetches them up front, and `launchclip doctor` shows whether they're ready.

## Add an effect to a clip

To put one effect on a clip without planning a whole video, use `launchclip fx`:

```bash
launchclip fx founder.mp4 masthead --at word:meet --until word:every --params '{"word": "Ledgerly"}'
```

It finds the words "meet" and "every" in your clip (transcribed locally), cuts you out for that stretch, and renders the whole clip with the masthead behind you. The result is `founder.fx/renders/draft.mp4`.

- **Timing:** `--at` and `--until` take seconds (`--at 1.5 --for 4`) or a word from the clip (`word:meet`, `word:it#2` for the second "it").
- **The effect's settings:** `--params` takes JSON, or a `.json` file. The [effects reference](../../skills/launchclip-create-video/references/subject-effects.md) lists what each effect takes.
- **The look:** `--style bold-creator` uses a built-in or your own style, and `--captions word-highlight` adds captions.

`founder.fx/` is an ordinary LaunchClip project. Change `storyboard.json` (the timing, the word, or more scenes) and run `launchclip finish founder.fx` to render it again; the cut-out is cached.

## Try the cut-out yourself

```bash
launchclip subject probe my-recording.mp4
```

It tells you whether you can be cut out and how you're framed. `launchclip subject track my-recording.mp4` follows your head through the whole recording, so graphics keep off your face. To cut out one stretch and look at it, run `launchclip subject matte my-recording.mp4 --range 4-10`.

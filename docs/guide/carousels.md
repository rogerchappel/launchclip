# Carousels and single-image posts

A carousel is a story whose scenes are slides. Each slide is a still (the scene's settled frame, after every entrance and before any exit) or a short motion loop. The same plan goes to each place you post it, laid out again for that platform's canvas, with a post caption and alt text for each.

The design is in the [carousels RFC](../CAROUSELS_RFC.md). A sample project is in [`examples/carousel/listicle-4x5`](../../examples/carousel/listicle-4x5/storyboard.json).

## The four steps

```bash
launchclip carousel make "Five habits of fast teams, as a listicle to save" --dest instagram,linkedin
```

`make` plans the carousel, renders it and checks it. Each of the other commands runs one step on a project you already have:

```bash
launchclip carousel render ./my-carousel --dest instagram,linkedin
```

```bash
launchclip carousel check ./my-carousel
```

```bash
launchclip carousel export ./my-carousel
```

| Step | What it does |
|---|---|
| `make "<brief>"` | Picks the arc and a template (`listicle`, `how-to`, `myth-fact`, `before-after`, `story`, `data`, `ad`, `quote`, `single`), writes the slides, the caption and the alt text, then renders and checks |
| `render <project>` | Each slide's still, and an MP4 loop for each motion slide, into `carousel/<dest>/` as `01.png`, `02.png` … |
| `check <project>` | The slide rules: a cover that reads at thumbnail size, type large enough for the feed, one idea per slide, contrast, safe zones, a payoff where the arc promises one, alt text, and copy that is not filler, cut off, repeated or a leaked planning label. Exits 1 on a failure |
| `export <project>` | Packages each destination's files, ready to upload |

## Templates

A template is the design layer between the plan and the modules. The planner writes each slide's words (a headline, a line under it, list items, a figure with its source, a quote, a photo); the template decides how the slide is laid out, so a carousel looks designed whatever the content. Pick one with `--template <id>` or `carousel.template` in the story; without one, `make` picks from the brief.

![Every template's sample at 4:5](../images/carousel-templates.jpg)

| Template | For | Arcs |
|---|---|---|
| `product-proof` | An app or SaaS ad: the product on screen, the result in one figure, a plain offer | ad, before-after, data |
| `study-notes` | An educational list or how-to in large free type, with a checklist to save | listicle, how-to |
| `field-notes` | An editorial list, how-to or lesson on a light ground | listicle, how-to, story, quote |
| `photo-diary` | A personal photo story: a photo and one line per slide | story, before-after, single |
| `quiet-quote` | A quote or a motivation series | quote, single |
| `signal-report` | A data or report carousel: one sourced figure per slide | data, ad |
| `myth-split` | Myth and fact: the myth struck through, the fact stamped | myth-fact |
| `then-now` | A before-and-after: the old way against the new, the change in one figure | before-after, story, ad |

### How a slide gets its layout

Each slide takes one of six layouts (grammars). The content decides first; after that comes the template's choice for the slide's role, and then a plain default:

| Grammar | When | Drawn by |
|---|---|---|
| `two-region` | The headline opens on one marker and the body on its pair (`Myth:` / `Fact:`, `Before:` / `After:`, `Don't:` / `Do:`) | `compare` in free type |
| `proof-stat` | A `stat`, or a %, a currency amount, a multiplier, or a number with a unit such as hours or users | `stat-card` (with a source), `media-stat` (with a photo), else `concept-card` |
| `steps` | `items`, or a body with two or more sequence words (first, then, finally) | `item-list` |
| `full-bleed` | A cover with a photo, or the template's choice | `photo-scene` under a reading layer |
| `image-panel` | A body slide with a photo | `split-screen` |
| `text-card` | Everything else, quotes and the call to action | `hook-title`, `motion-title`, `quote-card`, `cta` |

Each grammar has the most of the slide its text may cover (0.36 to 0.68), type floors at 1080 wide (headline 52 px, body 46 px, scaled by width) and copy caps. A template's own caps sit inside those. Copy over a cap goes back to the planner in its repair round.

### Surfaces and colour

Each role sits on a surface. `dark` and `light` are the carousel's ground, and a carousel has one ground: `light` turns the brand over, so its palest colour becomes the ground and its darkest the type. `brand` is a plate lit in the brand's primary or accent. `on-image` puts the slide's photo behind a reading layer at 0.6. Colours always come from the brand or the style pack. No template names a hex.

### The automatic pick

Without `--template`, each template scores the brief: +2 for each `best_for` word, −3 for each `avoid_when` word, +4 when it suits the arc, and points up or down for photos. Among the templates within two points of the best, the style's seed picks one, so two carousels on the same brief rarely look the same.

The samples are in `examples/carousel/<template>-4x5` (plus `study-notes-9x16`), written by `node scripts/carousel-template-samples.mjs`. Their photos are stand-ins already in the repo. Remotion and HyperFrames draw the templates the same way:

![field-notes and myth-split: Remotion above, HyperFrames below](../images/carousel-templates-parity.jpg)

## Destinations

Pick them with `--dest`, or list them in the story's `carousel.destinations`.

| Destination | Canvas | Slides | Motion slides | Export |
|---|---|---|---|---|
| `instagram` | 4:5 | up to 20 | yes | PNG per slide, MP4 per motion slide |
| `tiktok` | 9:16 | up to 35 | no | JPG per slide |
| `linkedin` | 4:5 | up to 300 | no | `slides.pdf` (a document post) and PNGs |
| `facebook` | 4:5 | up to 10 | yes | PNG and MP4 |
| `meta-ads` | 1:1 | 2 to 10 | yes | PNG and MP4, plus `cards.json` |
| `x` | 4:5 | up to 4 | yes | PNG and MP4 |
| `threads` | 4:5 | up to 20 | yes | PNG and MP4 |

These limits come from public guidance as of November 2026. Check each platform's own documentation before relying on a figure.

Where a destination takes images only, a motion slide is sent as its still, and the export says so.

A motion slide is a scene of 3 to 8 seconds with `loop: true`. Its clip is silent and exactly the scene's length, and its last frame leads back into its first, background included. Its still is a frame of that clip and doubles as the poster. See `examples/carousel/motion-ad-1x1` for an ad whose second slide moves.

## What export writes

For each destination, in `carousel/<dest>/`:

| File | What it's for |
|---|---|
| `01.png` … | The slides in order (`.jpg` for TikTok), and `NN.mp4` for each motion slide where motion is shown |
| `slides.pdf` | LinkedIn: one page per slide at the slide's size |
| `cards.json` | Meta ads: each card's file (the MP4 for a motion slide, with its still as `thumbnail`), headline, description and link, cut to Meta's recommended lengths (32 and 18 characters). Pass `--link <url>` for the link |
| `caption.md` | The post caption: the hook, the body, the call to action, and tags where the platform uses them (Instagram, TikTok). It flags a hook longer than the platform shows before "… more", and ends with a plain version to paste |
| `alt.json` | Alt text for each slide file |

`carousel/CAROUSEL.json` lists the plan, every destination's files, its warnings and errors, and the check results when `check` has run.

A destination whose renders are missing is reported and skipped; the others still export. `--json` prints the whole report.

## Swipe continuity

Two treatments pull the eye to the next slide. Both work in Remotion and HyperFrames, on still and motion slides, and either one counts as the swipe cue when it touches the cover or slide 2. A sample is in [`examples/carousel/seam-panorama-4x5`](../../examples/carousel/seam-panorama-4x5/storyboard.json).

**Across the seam.** An element is laid across the seam between two slides, so half of it sits at the right edge of one and the rest at the left edge of the next. List them in `carousel.seams`:

```json
{ "after": "summit", "kind": "word", "text": "KEEP CLIMBING →", "x": -0.36, "y": 0.8, "w": 0.72, "h": 0.07, "color": "ink" }
```

| Field | What it means |
|---|---|
| `after` | The id of the slide on the left of the seam |
| `kind` | `word` (text `h` tall), `rule` (a bar; a thin one is a line), `card` (a rounded bar) or `circle` |
| `x`, `w` | In slide widths from the seam. The element must cross it: `x < 0 < x + w` |
| `y`, `h` | In slide heights from the top |
| `color` | A brand colour role (`primary`, `accent`, `ink` …) or `#rrggbb` |

**The panorama.** One plate laid over several slides, each taking its slice, with type set per slide:

```json
"panorama": { "src": "assets/panorama.jpg", "slides": [1, 4] }
```

`slides` is the first and last slide it covers (1-based). The plate is scaled once to cover that many slide widths by the slide height, centred, and each slide shows its own width of it, so the slides line up pixel for pixel side by side. A plate already that size (here 4 × 1080 by 1350) is drawn unscaled. Keep the type on each slide clear of the busiest parts of the plate; `check` measures contrast on the rendered slides.

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
| `make "<brief>"` | Picks the arc (`listicle`, `how-to`, `myth-fact`, `before-after`, `story`, `data`, `ad`, `quote`, `single`), writes the slides, the caption and the alt text, then renders and checks |
| `render <project>` | Each slide's still, and an MP4 loop for each motion slide, into `carousel/<dest>/` as `01.png`, `02.png` … |
| `check <project>` | The slide rules: a cover that reads at thumbnail size, type large enough for the feed, one idea per slide, contrast, safe zones, a payoff where the arc promises one, alt text. Exits 1 on a failure |
| `export <project>` | Packages each destination's files, ready to upload |

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

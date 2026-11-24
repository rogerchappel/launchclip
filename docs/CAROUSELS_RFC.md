# RFC: Carousels and single-image posts

Status: built. Phases 1 to 7 shipped (#756 to #775), with templates, video cards,
the reading gradient and generated backgrounds added along the way; the user
guide is [guide/carousels.md](guide/carousels.md). Open items are in §13.
Date: 2026-11-20 (revised 2026-11-20: video carousels are separate short clips, §5.3; status updated when built)
Builds on: [KIT_CONTRACTS.md](KIT_CONTRACTS.md) (the scene modules),
[COLLECTIONS_RFC.md](COLLECTIONS_RFC.md) §3.5 (destination presets),
[GENERATED_FOOTAGE_RFC.md](GENERATED_FOOTAGE_RFC.md) (generated stills and
the hand-in contract), [FLUID_MOTION_RFC.md](FLUID_MOTION_RFC.md) (carry,
loops), [END_CARDS_RFC.md](END_CARDS_RFC.md) (calls to action)

## 1. Summary

LaunchClip only makes videos. A large share of what people post, and of the
ads they run, is a swipeable set of slides (a carousel) or a single designed
image with a caption: a "7 mistakes" list, a before and after, a product ad
of three to five cards, a quote, a personal story told in photos.

This RFC proposes **carousels as a second output** of the same engine.
A carousel is a story whose scenes are slides. Each slide is either a
**still** (the scene's settled frame, rendered as a PNG) or a **motion
slide** (the scene rendered as a short looping clip). A single-image post is
a carousel of one slide. The planner, the modules, the brand and style
system, the generated imagery and the checks are the ones videos use; what
is new is the slide plan, the rules a slide is checked against, the post
caption, and the exports each platform wants.

## 2. Goals and non-goals

**Goals**

- One brief makes a carousel, from the CLI and the skill: `launchclip
  carousel make "<brief>"` and the same through an agent.
- Slides look like the videos do: free type on imagery, the brand's palette
  and fonts, the same modules (list, compare, stat, quote, chart, node graph,
  end cards). No boxed template look.
- Still slides and motion slides mixed in one carousel, where the platform
  allows it (§8).
- A post caption written for the platform, plus alt text for every slide.
- Exports per destination from one plan: Instagram, TikTok photo mode,
  LinkedIn (PDF and images), Facebook, Meta carousel ads, X, Threads.
- Checks before export, so a slide with text too small to read in the feed,
  two ideas on one slide or a cover with no promise fails with a reason.

**Non-goals**

- Posting or scheduling. The engine writes files and a manifest; whatever
  posts them is outside the engine, as it is for videos.
- Reading analytics back. Choosing the cover that performed best needs
  platform data the engine does not have; §9.3 only makes the variants.
- A drag-and-drop slide editor. Every change is a command on the plan, as
  it is for videos.

## 3. What already exists

Most of the work is reuse.

| Need | Already there |
|---|---|
| A 4:5 portrait canvas | `story.format` accepts 4:5 as well as 9:16, 16:9 and 1:1 (`kit/core/story.mjs`), and modules lay out by aspect (`kit/core/modules.mjs`) |
| Rendering a frame as a PNG | Remotion `renderStill` (`src/renderers/remotion_segments.js`), the video thumbnail in `src/pipeline.js`, `hyperframes snapshot` on the HyperFrames side |
| A frame where everything has landed | Evidence capture's poster is "the last frame, every beat landed" ([EVIDENCE_CAPTURE.md](EVIDENCE_CAPTURE.md)); a scene's anchors give the time each element lands (`kit/core/anchors.mjs`) |
| A seamless short clip | `scene.loop: true` makes a module's last frame its first, and the motion check's `loop-seam` proves it |
| An element that runs across a cut | Carry (`kit/core/carry.mjs`, `kit/core/flow.mjs`) maps an element's box from one scene to the next |
| Imagery | Generated stills through the hand-in contract (`HANDIN.json`), drafts before finals, the same checks as handed-in images; ranked keyframe candidates, each an audience-led concept with one shared direction (§10) |
| Brand, type, layouts | Style packs, seeded styles, the free-type `compare` and `verdict` variants, end-card layouts |
| Platform settings as data | Destination presets ([COLLECTIONS_RFC.md](COLLECTIONS_RFC.md) §3.5) |

## 4. What makes a carousel get reach

This summarises public guidance as of November 2026. Most published numbers
come from tool vendors, often conflict, and are rarely reproducible; treat
them as direction, not law (sources in §13).

- **The cover does most of the work.** It is the only slide shown in the
  feed. It has to make one specific promise ("The 5 settings that halved our
  churn"), readable at thumbnail size, with a reason to swipe.
- **Swipes and saves are the signals.** On Instagram, carousels trail Reels
  on reach but lead on saves and comments; a carousel that is not swiped is
  shown again with its second slide. On TikTok, photo posts go to the same
  For You feed as videos, and swipe-through and time on each slide are
  reported to count. On LinkedIn, time spent on the post counts, and both
  PDF and multi-image posts are used; studies disagree on which reaches more.
- **Length.** Instagram guidance clusters at 7 to 10 slides. Meta ads guidance
  clusters at 3 to 5 cards. TikTok allows up to 35, and more slides do not
  mean more reach.
- **One idea per slide**, few words, large type. A slide that needs reading
  twice loses the swipe.
- **Visible continuity.** The same look on every slide, and something that
  pulls to the next one: a sentence that breaks across the seam, an element
  that crosses the edge, a numbered progress marker.
- **A payoff worth keeping.** The second-to-last slide is the one people save:
  the checklist, the summary, the template.
- **One call to action at the end** that matches the goal: save, comment a
  keyword, follow, visit, install.
- **The caption adds, not repeats.** Its first line is a second hook; the body
  carries what did not fit on the slides; text on the slides and in the
  caption is also indexed by platform search (TikTok especially).
- **Native and plain beats polished ad.** Ads that look like posts tend to do
  better than ones that look like banners, which suits the free-type look.

## 5. The carousel plan

### 5.1 Shape

A carousel is a story with `format.kind: "carousel"`. Its scenes are slides,
in order. Each slide has a role and a medium:

```json
{
  "format": {"kind": "carousel", "aspect": "4:5"},
  "arc": "listicle",
  "slides": [
    {"role": "cover", "medium": "still", "module": "title", "params": {}},
    {"role": "body", "medium": "still", "module": "item-list", "params": {}},
    {"role": "body", "medium": "motion", "module": "node-graph", "params": {}, "loop": true},
    {"role": "payoff", "medium": "still", "module": "compare", "params": {}},
    {"role": "cta", "medium": "still", "module": "end-card", "params": {}}
  ],
  "caption": {"hook": "", "body": "", "cta": "", "tags": []},
  "alt": ["", "", "", "", ""]
}
```

Roles are `cover`, `body`, `payoff` and `cta`. Exactly one cover, first; at
most one `cta`, last. Every other field is a module and its params, checked
the way a video scene's are.

### 5.2 Arcs

An arc is a ready slide order the planner picks from, like a skeleton for
video. A first set:

| Arc | Slides | Fits |
|---|---|---|
| `listicle` | cover (the number and the promise), one item per slide, a summary to save, cta | education, tips |
| `how-to` | cover (the result), one step per slide, the finished result, cta | tutorials |
| `myth-fact` | cover, a myth then its fact per slide (the `verdict` treatment), cta | correcting a belief |
| `before-after` | cover, the before, what changed, the after, the proof, cta | product, transformation |
| `story` | cover (the moment), photos or illustrations with one line each, the lesson, cta | personal brand |
| `data` | cover (the surprising number), one chart or stat per slide, what it means, cta | reports, research |
| `ad` | 3 to 5 cards: the problem, the product doing it, proof, the offer | app and SaaS ads |
| `quote` | one slide, or a short series by one person | quotes, motivation |
| `single` | one slide | a single-image post |

### 5.3 Motion slides

A motion slide is a scene rendered as its own short clip, silent by
default. Its still, the settled frame, is always rendered too, as the
fallback for destinations that take only images (§8) and as the poster frame.

A video carousel is a set of separate videos: each card is its own clip, and
swiping moves to the next one. It is not one video cut into slides. Most cards
are short, usually 3 to 5 seconds. A card can be very short (about 2 seconds,
a single beat) or run to 10 seconds when its motion needs the time.
Platforms allow far longer cards, but a short card keeps the swipe going. So:

- **Each motion slide is its own clip**, rendered as a one-scene story of its
  own (shipped: `motionStory` in `src/carousel/render.js`), so its length,
  timing and ambient motion never depend on the slides around it.
- **Two kinds of motion slide.** A *drawn* one is a catalogue module that
  animates (a node graph, a chart, kinetic type). A *footage* one is a short
  clip under free type: B-roll the user hands in, a cut from a longer
  recording, or a clip made by the generator (§10), where the keyframe still
  is made and checked first and only then animated into a short clip.
  Most video carousels are mostly footage cards.
- **Looping is a choice, not a rule.** `loop: true` makes a seamless loop
  (checked by `loop-seam`) for a card people may watch more than once. Without
  it the card plays once and holds its last frame; feeds replay a card anyway,
  so a hard cut back to the first frame is acceptable, but a held last frame
  must be a settled one.
- **Length**: 2 to 10 seconds per card (`MOTION_SLIDE_SECONDS`), 4 by
  default. The planner sizes each card to what happens in it (shipped:
  `carousel make --video` / `--clips`).
- **Defaults**: silent, text set by the engine over the clip (never
  drawn into a generated clip), the settled frame as the poster.
- **One sound bed across cards** is out of scope: each card is a separate file
  and platforms play them on their own.

### 5.4 The settled frame

A still slide is not a paused animation. The still is the frame after every
anchor has landed and before any exit, so nothing is half in. Modules that
have no anchors use their last frame before the exit. A module whose still
frame looks wrong (a chart that only makes sense in motion, a particle field)
is marked `still: false` in its capability entry and the planner does not
place it on a still slide.

## 6. Design rules and checks

`launchclip carousel check` runs before export. Each rule fails with the slide
and a reason, like the motion and direction checks.

| Rule | Check |
|---|---|
| `cover-promise` | The cover has a headline of 3 to 12 words that names a specific subject or number |
| `cover-thumbnail` | The cover's headline is legible when scaled to a 160 px wide feed thumbnail (measured cap height and contrast) |
| `type-size` | No text under a minimum font size: 46 px for body and 52 px for headlines at 1080 px wide, scaled by the canvas width |
| `one-idea` | At most one headline and one supporting block per slide, and a word budget (25 words for body slides, 12 for the cover; `carousel.density: "detailed"` gives body slides 50, for a list whose item slides explain) |
| `contrast` | WCAG AA contrast for every text run against what is under it, measured on the rendered pixels, not the palette |
| `safe-zone` | Text clears each destination's overlay zones (TikTok's caption and buttons, Instagram's dots and profile row): px margins per destination, 96 / 72 / 96 / 72 on 4:5, 72 on 1:1, 180 top and 240 bottom on 9:16 |
| `continuity` | Every slide uses the same type scale and palette roles; a slide that switches looks is a warning |
| `swipe-cue` | The cover or second slide carries a cue to swipe (a crossing element, a broken sentence, a counter) unless the arc is `single` or `quote` |
| `payoff` | Arcs that promise a list, steps or data have a payoff slide |
| `cta-match` | The call to action matches the declared goal (save, comment keyword, follow, visit, install) |
| `alt-text` | Every slide has alt text that describes it, not its file name |
| `claims` | Numbers and claims on slides carry the same provenance a video's do ([EXPLAINER_CLAIMS_RFC.md](EXPLAINER_CLAIMS_RFC.md)) |
| `filler` | No stock phrases ("game changer", "unlock your potential", "stay tuned" …) on slides or in the caption |
| `hook-length` | The caption hook and the cover headline run 4 to 14 words; under 3 fails |
| `cut-off` | No headline ending in an ellipsis or on a function word ("the", "to", "can" …), no body copy stopped mid-sentence |
| `restated-ending` | The last slide says something new: at least 85% of its words already on earlier slides is a warning (a deck ending on its payoff is exempt) |
| `duplicates` | No headline or body text repeated across slides |
| `word-budget` | The deck carries max(6, 3 × slides) to 28 × slides words (50 × slides when detailed): under is a warning, over fails |
| `scaffold-leak` | No planning labels in the copy ("Slide 3:", "Hook:", "CTA:", "[image]") |

### 6.1 Swipe continuity

Two treatments pull the eye to the next slide, both built on carry:

- **Across the seam:** an element (a line, a card, a word) is laid out across
  two slides as if they were one wide canvas, so half of it sits at the right
  edge of one slide and the rest at the left edge of the next. Carry already
  maps a box from one scene's frame to the next; here the mapping is a fixed
  offset of one slide width.
- **The panorama:** the whole carousel is one wide image cut into slides. One
  plate (generated or handed in) is laid out over N slide widths and each
  slide takes its slice, with type set per slide.

## 7. The caption

Each carousel writes a post caption per destination, from the same plan:

- A first line that works as a second hook, under each platform's preview
  length (the cut-off point is destination data).
- A body that carries what did not fit on the slides, not a copy of them.
- One call to action that matches the last slide's.
- A small set of topical tags where the platform uses them; none where it
  does not.
- Alt text per slide (§6).

Captions reuse the caption stage's platform rules and provenance. A
single-image post leans on the caption more than a carousel, so the `single`
and `quote` arcs give it a longer body budget.

## 8. Destinations

Destination presets gain a `carousel` block. Figures below are from public
guidance as of November 2026 and must be checked against each platform's own
documentation before they ship as defaults.

| Destination | Canvas | Slides | Motion slides | Export |
|---|---|---|---|---|
| `instagram` | 4:5, 1080×1350 | up to 20 | yes, mixed | PNG/JPG per slide, MP4 per motion slide |
| `tiktok` | 9:16, 1080×1920 | up to 35 | no (photo mode takes images; the music is chosen in the app) | JPG per slide |
| `linkedin` | 4:5 or 1:1 | up to 300 pages (PDF) / 20 images | no | one PDF, plus images for a multi-image post |
| `facebook` | 4:5 or 1:1 | up to 10 | yes | images and MP4 |
| `meta-ads` | 1:1 (any video card forces square on Instagram) | 2 to 10 cards | yes, mixed; video cards do not run in the Reels placement | images and MP4, plus a card sheet (§9) |
| `x` | 1:1 or 4:5 | up to 4 | yes | images and MP4 |
| `threads` | 4:5 | up to 20 | yes | images and MP4 |

A plan made for one aspect reframes for another the way videos do: the
modules lay out again for the new canvas, they are not cropped. Where a
destination takes no motion, the motion slide's still is used.

## 9. Ads

### 9.1 Cards

An `ad` arc also writes a card sheet: each card's headline, description and
link, within Meta's lengths, so the files and the copy upload together.

### 9.2 Imagery

Product proof comes from what the engine already captures (screens, terminal
output, demo clips) or from generated imagery (§10). A card that shows the
product doing something prefers a motion slide.

### 9.3 Variants

`--variants N` makes N covers from the same body (different promise, image or
layout picked by the style seed), so a person or an ad platform's own test
can choose. Where the cover image is generated, the variants are the cover's
keyframe candidates (§10): each is a different audience-led concept, so the
covers test different angles rather than different draws of one prompt.
The rank orders them, but the engine does not judge which won in the feed;
that needs the platform's numbers.

## 10. Generated imagery

A slide's image is a shot request, as in
[GENERATED_FOOTAGE_RFC.md](GENERATED_FOOTAGE_RFC.md), that stops at the
keyframe: text to image, never image to video unless the slide is a motion
slide that asks for footage. Everything else carries over unchanged: the
price quoted first, the budget, drafts before finals, the checks, and the
code-drawn fallback. A carousel that uses a character holds it with the same
word-for-word description. The `story` arc can take a folder of the user's
own photos instead, which stays the default for personal brands.

Three things from the generator matter more for a carousel than for a video:

- **Keyframe candidates** (`--keyframe-candidates n`). A slide's image *is*
  the keyframe, so the ranked round of stills is the whole job, never a
  step before animating. The rank's failures (anomalies, visible text, logos,
  a missing subject) are failures a still slide shows for as long as someone
  looks at it.
- **Audience-led concepts.** The one concepts call per video works out who
  the video is for and picks one direction for every shot so they match.
  For a carousel that direction is the continuity rule of §6 applied to the
  imagery: every slide's image shares the setting, kind of people and time of
  day. The rank's `audience_fit` score suits covers best, since the cover is
  what a stranger judges in the feed.
- **No text in the image.** The generator leaves narration out of the prompt
  and asks for no text. Slides rely on this: all type is set by the engine on
  top of the image, so it stays sharp, editable and checked (§6). An image
  with text drawn into it fails the slide.

The image is asked for in the slide's own aspect (4:5, 9:16, 1:1); the fal
adapter already sends the ratio to models that take only `aspect_ratio`.
The skill path uses the same commands (`generate allow`, `generate check`
with `--file`, `--audience` and `--concepts`, `generate record`).

## 11. CLI and skill

```
launchclip carousel make "<brief>" [--arc <id>|auto] [--dest instagram,linkedin,…]
                                   [--slides N] [--goal save|comment|follow|visit|install]
                                   [--images <dir>] [--generate] [--variants N]
launchclip carousel render <project> [--dest …]
launchclip carousel check  <project>
launchclip carousel reframe <project> --dest <id>
```

`make` plans, renders and checks; the others run one stage. Outputs land in
`carousel/<dest>/` with `01.png` … `NN.png` (or `.mp4` for motion slides), a
PDF where the destination takes one, `caption.md`, `alt.json` and
`CAROUSEL.json` (the plan, the check results and every file). The skill path
uses the same commands, as videos do.

## 12. Phases

All seven have shipped. Beyond them, the build added templates faithful to
proven feed styles with six layout grammars (`kit/core/carousel-templates.mjs`),
copy-quality rules and pixel safe margins in the check, video cards of 2 to
10 seconds from footage or drawn modules, a brand-coloured reading gradient
over photos and video, and generated backgrounds and panoramas. `reframe` (§11)
became part of `render`, which lays each destination out again.

1. **Stills from a story.** `format.kind: "carousel"`, the settled-frame
   render in Remotion, the `listicle`, `quote` and `single` arcs, Instagram and
   LinkedIn PDF export, the type-size, contrast and one-idea checks.
2. **Captions and alt text** per destination, and the remaining checks.
3. **Motion slides**: each card its own clip, the still fallback, Facebook,
   X and Threads (shipped for drawn, looping cards). Still to do: footage and
   generated-clip cards, cards that play once instead of looping, and the 2 to
   10 second range.
4. **HyperFrames parity** for stills (snapshot at the settled frame) and
   motion slides, with parity fixtures as for scenes.
5. **Ads**: the `ad` arc, the card sheet, the `meta-ads` destination,
   cover variants.
6. **Continuity**: across-the-seam elements and the panorama.
7. **The rest of the arcs** and TikTok photo mode.

## 13. Open questions

- Should a carousel be able to come from an existing video (one slide per
  scene, at the settled frame), so a launch kit gets a carousel for free?
  It looks cheap and likely worth it, but the pacing of a video and a
  carousel differ.
- Minimum type sizes and word budgets are proposals; they need a pass against
  real feeds on a phone.
- Is the PDF or the multi-image post the better LinkedIn default? Studies
  disagree; exporting both costs little.
- How should audio on TikTok photo mode be handled when the music is picked
  in the app?

## 14. Sources

Public guidance used for §4 and §8, checked November 2026. Most are tool
vendors' own studies.

- Instagram: [PostEverywhere, carousel best practices](https://posteverywhere.ai/blog/instagram-carousel-best-practices),
  [Buffer, reach and engagement by format](https://buffer.com/resources/instagram-reach-engagement-analysis/),
  [Socialinsider, Instagram carousels](https://www.socialinsider.io/blog/instagram-carousel),
  [Metricool, carousel best practices](https://metricool.com/instagram-carousels/)
- TikTok: [Buffer, TikTok carousels](https://buffer.com/resources/tiktok-carousel/),
  [Stack Influence, photo posts](https://stackinfluence.com/blog/tiktoks-photo-post-comeback)
- LinkedIn: [Ordinal, carousel posts](https://www.tryordinal.com/blog/carousel-posts),
  [Socialinsider, LinkedIn carousels](https://www.socialinsider.io/blog/linkedin-carousel/),
  [Oktopost, PDF carousel practices](https://www.oktopost.com/blog/linkedin-carousel-pdf-best-practices/)
- Meta ads: [Buffer, Facebook ad specs](https://buffer.com/library/facebook-ad-specs/),
  [AdManage, Meta carousel specs](https://admanage.ai/blog/meta-carousel-ad-specs),
  [Hootsuite, carousel ad ideas](https://blog.hootsuite.com/ideas-creative-carousel-ads/)

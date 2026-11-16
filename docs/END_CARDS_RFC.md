# RFC: A library of end cards

Status: draft for review; nothing here is scheduled
Date: 2026-11-16
Builds on: [SEEDED_STYLES_RFC.md](SEEDED_STYLES_RFC.md) (module variants
picked by the seed), [VIDEO_QUALITY_RFC.md](VIDEO_QUALITY_RFC.md) (the
design bar and the finish gates), [KIT_CONTRACTS.md](KIT_CONTRACTS.md)
(`brand-lockup`, `cta`), [COLLECTIONS_RFC.md](COLLECTIONS_RFC.md) (what a
batch of videos shares)

## 1. Summary

The ending is the frame a viewer acts on, and today almost every branded
video ends on the same one: `brand-lockup` with `variant: "end"`, the mark
over a headline over a URL pill, with a glow behind it. Fonts and colours
come from the brand, so two brands look a little different, but the shape
is always the same, and a viewer who has seen three of them has seen them
all.

This RFC proposes an **end-card library**: about thirty designed endings,
each a layout with its own motion, picked per video from what the ending
has to do (the action), what it sits on (the ground), what the logo is
like, and the style's seed. Every layout is dressed in the brand's own
fonts, colours and logo, so the same layout reads differently for every
brand, and the choice avoids what the same collection used recently, so
the same brand doesn't end every video the same way either.

Three things change from today:

1. **The action leads.** A comment keyword, a follow, a save, a download
   and a website are different asks, and each gets layouts built for it,
   not a URL pill with other words in it.
2. **The ending need not be a card.** It can play over the supplied
   footage, live or held on the last frame, with the type set straight on
   the shot.
3. **Any logo works.** The logo is measured once (tone, background,
   shape), and each layout says how it handles each kind of logo.

## 2. What exists today

| Piece | Where | What it does |
| --- | --- | --- |
| `brand-lockup` `end` | kit/core/catalog-b-brand-lockup.mjs | mark, wordmark, headline, badge, URL pill; one stacked layout; glow and shine |
| `cta` | kit/core/catalog-a.mjs | action line, detail, handle pill with icon, optional loop; four title variants (`centered`, `flush`, `boxed`, `low`) picked by the style |
| `subscribe-cta` | kit/core | a channel's subscribe ask |
| Logo measurement | src/logo_mark.js | tone (dark, light, mixed), aspect, trim, and whether the background is see-through; read with ffmpeg when the story is read |
| Lockup tint | src/logo_mark.js `withLockupTints` | a see-through dark mark on a dark card is tinted to paper, a light one on a light card to ink; a boxed logo is left whole |
| Comment keyword | kit/core/script-formats.mjs `ctaPlanOptions` | the host's keyword and offer, said in the script and shown in capitals |
| Style outro | kit/core/style.mjs | a style pack may name one outro module and its params |
| Module variants | SEEDED_STYLES_RFC.md | the seed picks one variant per module, once per video |

The library replaces none of these. It grows `brand-lockup`'s `end`
variant into a family of layouts, gives `cta` the same family, and adds the
selection that picks among them.

## 3. Goals and non-goals

**Goals**

- At least 24 layouts at first release, 30 or more over time, each one a
  designed piece, not a parameter tweak of another.
- Every layout passes the [video design bar](VIDEO_QUALITY_RFC.md): free
  type on footage, no clip-art, no stock boxed cards, brand fonts and
  colours, legible at phone size.
- The ending is picked, not defaulted: same inputs and seed, same ending;
  a different seed or a recent repeat in the collection, a different one.
- Any logo file works without hand settings: transparent or boxed, dark or
  light, square mark or wide wordmark, PNG, JPG or SVG.
- Remotion first, HyperFrames at parity, one model for both.
- Every choice the planner makes can be changed by a single edit, by hand
  or by an agent in conversation: swap the layout, the ground, the action
  text, the logo treatment.

**Non-goals**

- Hosting, accounts or analytics for the action (a link shortener, a
  keyword auto-reply). The ending shows the ask; the rest is the product's.
- Generated imagery. Grounds are the brand's colours, its own footage or
  the code-drawn worlds the kit already has.
- Interactive end screens (platform end-screen elements). The video's own
  last seconds only.

## 4. The model

An ending is four choices:

```
ending = action × ground × layout × dress
```

### 4.1 Action

| Kind | Shown as | Example |
| --- | --- | --- |
| `url` | the address, set as type or a pill | harleybuilt.au |
| `keyword` | the word in capitals, set like a ticket or a stamp, with the offer | Comment **DECK** for the checklist |
| `follow` | the handle and the reason | @harleybuilt · a build every Tuesday |
| `save` | the reason to come back | Save this before you pick your boards |
| `subscribe` | the channel and the next video | Next: why decks rot from the inside |
| `download` | store badges, the app's mark | App Store and Google Play |
| `visit` | a place and a time | 14 Bay St · open Saturdays |
| `book` | the action and the slot | Book a site visit |
| `launch` | a date or a countdown | Live 3 December |
| `loop` | no ask; the last frame leads back into the first | (the hook again) |

The action comes from the plan: `ctaPlanOptions` for a keyword, the
brief's link, the format's closing beat. A video has one primary action;
a second one may appear only as the small line under it.

### 4.2 Ground

| Ground | What sits behind the type |
| --- | --- |
| `card` | a brand colour, flat or with one quiet texture from the style |
| `paper` | the brand's light colour, for calm and premium endings |
| `split` | two brand colours in blocks, the logo in one of them |
| `footage-live` | the last shot keeps playing, dimmed or graded, under a scrim on the type side |
| `footage-hold` | the last frame freezes, eases in a few percent and darkens |
| `footage-blur` | the last frame, blurred deep, as a colour field |
| `world` | the scene's code-drawn world continues, the camera settles |

Footage grounds exist only when the video has footage, and they are the
first choice when it does: the ending stays part of the video instead of
cutting to a slide.

### 4.3 Logo

Every logo is measured once (src/logo_mark.js) into:

- **tone**: dark, light or mixed;
- **background**: see-through, or its own box (and the box's colour);
- **shape**: mark (about square), wordmark (wide), stacked (tall), from the
  aspect and trim.

Each layout declares, per logo class, one of five treatments:

| Treatment | When | What it does |
| --- | --- | --- |
| `native` | the logo's tone already reads on the ground | shown as supplied |
| `tint` | a see-through mark that does not read | recoloured to paper or ink (alpha kept) |
| `plate` | a boxed logo, or a mixed one on a busy ground | shown whole on a tile in its box colour, corners from the style |
| `knockout` | a see-through mark inside a colour block | cut out of the block, so the ground shows through |
| `none` | the layout leads with the name in type | the logo stays in the brand frame only |

A layout that cannot handle a logo class says so, and the selection never
picks it for that logo.

### 4.4 Dress

The brand's fonts (display, body, meta), its colours by role, the style's
corner radius, texture and motion grammar. Nothing in a layout names a
font or a hex: everything is a role, so 30 layouts × every brand is the
real range.

## 5. The layouts

Grouped in families. Each family shares a skeleton; each layout in it is
a distinct design. "Grounds" lists where it may sit; "Actions" the asks it
is built for.

### 5.1 Type-led (the words are the design)

| Layout | Grounds | Actions | The idea |
| --- | --- | --- | --- |
| `sign-off` | paper, card | save, follow, url | small mark, a two-line headline in the display face with one italic phrase, a hairline, the address in spaced capitals |
| `url-hero` | card, footage-hold | url | the address is the biggest type in the video, broken at the dot, the logo small and low |
| `handle-hero` | card, footage-live | follow | the handle set huge, the reason in the body face above it |
| `keyword-ticket` | any | keyword | the keyword in capitals on a ticket stub torn from the edge, the offer printed on it |
| `keyword-stamp` | paper, footage-hold | keyword | the keyword stamped at an angle over the last frame, ink bleed from the style's texture |
| `last-line` | footage-live, footage-hold | save, follow, loop | the closing caption grows into the headline in place: the ending is the last line of the script, held |
| `stacked-index` | card, paper | subscribe | "Next" and the next video's title as a numbered entry, like a contents page |

### 5.2 Brand-led (the logo is the design)

| Layout | Grounds | Actions | The idea |
| --- | --- | --- | --- |
| `bloom` | card | url, download | today's end card, kept: mark, headline, pill, glow (tinted marks, no overshoot) |
| `split-panel` | split | any | the top block in the primary colour holds the logo (native or knockout), the headline and action below on paper |
| `plate-centre` | card, footage-blur | url, visit | the logo whole on its plate, the action as an underlined line under it |
| `wordmark-wipe` | card, world | launch, url | the wordmark is revealed by a wipe in the accent colour, the action types on after |
| `mark-orbit` | card | follow, subscribe | the mark centred, the action set on a slow circle around it |
| `monogram` | paper | any | the mark large and cropped by the frame edge, the action in the open corner |

### 5.3 Footage-led (the ending stays in the video)

| Layout | Grounds | Actions | The idea |
| --- | --- | --- | --- |
| `freeze-scrim` | footage-hold | any | the last frame freezes and eases in; a low scrim; type set left on the frame; a hairline; the logo top right |
| `live-lower` | footage-live | url, follow, keyword | the shot keeps playing; the action rises as a free lower-third on the type side, no box |
| `frame-in-frame` | footage-hold | url, book | the frame shrinks into a rounded window on the brand colour, the action beside or below it |
| `cutout-type` | footage-live | save, launch | the headline is a mask: the footage plays through the letters on a brand-colour ground |
| `grade-out` | footage-live | loop, follow | the shot grades to the brand's duotone while the action fades up |
| `pointer` | footage-hold | keyword, visit | an arrow or ring draws onto the thing in the shot the offer is about (the board, the product), the action beside it |

### 5.4 Graphic (a designed object)

| Layout | Grounds | Actions | The idea |
| --- | --- | --- | --- |
| `poster` | card | launch, visit | a gig-poster grid: date, place and action in blocks of the display face, rules between them |
| `receipt` | paper | keyword, book | a receipt printing in: line items are the offer, the total is the keyword |
| `typed-page` | paper | keyword, subscribe | a framed page in the mono face, an issue number, a stamped logo, the action typed with a cursor |
| `badge-row` | card | download | the app's mark, the store badges in a row, the rating as stars in the accent colour |
| `countdown` | card, footage-blur | launch | the date counts down to the launch day and locks |
| `diagonal-band` | card | url, follow | one bold diagonal band in the accent colour crosses the frame, the action on it |
| `marquee` | card, footage-live | follow, url | the action runs as two tickers moving opposite ways, the logo holding still between them |

### 5.5 Loop-led

| Layout | Grounds | Actions | The idea |
| --- | --- | --- | --- |
| `seam` | any | loop | no card: the last half second matches the first frame's composition, so the loop is invisible |
| `rewind` | footage-live | loop | the last shot scrubs back to the hook with a tape-stop, the hook line appears |

That is 28. Each one ships with a reference frame at 9:16, 1:1 and 16:9,
and a still in the gallery (§10).

## 6. Choosing one

Selection is a pure function of the plan, so it is the same on every
reader and both renderers:

1. **Filter by fit**: the action kind, the grounds this video has, the
   logo class, the format's aspect, the length of the action text.
2. **Weight by the style**: each layout carries a few tags (`calm`, `loud`,
   `editorial`, `playful`, `premium`, `technical`), and the style's
   personality and energy weight them; a calm premium style rarely gets
   `diagonal-band`.
3. **Avoid recent endings**: in a collection, the layouts used by the last
   N videos (default 5) are weighted down to near zero, so a brand's feed
   does not repeat its ending.
4. **Pick by seed**: the style's seed draws from what is left. Same seed,
   same ending.
5. **Explicit wins**: `params.layout`, then the style's
   `variants["end-card"]`, then the pick.

The plan records the pick and the reason ("footage-hold, keyword, wide
dark see-through logo; editorial style; avoided `freeze-scrim` used by the
last two videos"), so a person or an agent can see why and change it.

## 7. Motion

Every layout follows the same beats, each layout fills them its own way:

| Beat | Time (9:16 Short) | What happens |
| --- | --- | --- |
| Arrive | 0–0.6 s | continuity from the last scene: the last caption, the hero element or the frame itself carries into the ending (a morph, a freeze, a push), never a hard cut to a slide |
| Land | 0.6–1.4 s | the headline and the logo land, staggered by the style's grammar |
| Ask | 1.4–2.0 s | the action lands last, so it is the newest thing on screen |
| Hold | 2.0 s to the end | quiet life: a slow push, a light sweep, the footage still moving; one restrained pulse on the action at most |
| Out | the last 0.3–0.5 s | a hold to black, or the loop seam |

Feel rules, shared with the camera:

- Eases go slow, then fast, then slow. No overshoot: the URL pill's
  `back.out(1.7)` pop becomes an ease-out with a short settle.
- Motion blur at peak speed on anything that travels.
- Nothing moves at one speed, an exit is never slower than its entrance,
  and the whole landing is over within two seconds.

## 8. Type, colour and the frame

- **Roles only.** Display face for the headline or the hero line, body for
  the offer, meta for addresses and handles. A brand with one font uses it
  in two weights.
- **Contrast is checked, not hoped for.** Every text role against its
  ground at 4.5:1 (3:1 for 64 px and up); a footage ground is sampled in
  the type's box after the scrim, and a failure deepens the scrim before
  it fails the gate.
- **Keywords** are set in capitals in the display face, never in a pill.
- **Platform zones.** Type stays out of the Shorts bottom bar and right
  rail; the brand frame, watermark and captions hide on the ending (as
  `cta` and `brand-lockup` hide captions today) unless the layout uses
  them, like `last-line`.

## 9. Sound

Each layout names its cue family (a whoosh for the arrive, a pop or a tick
for the ask, a stamp thud, a typewriter, a receipt printer, a tape stop),
drawn from the style's sound palette, and the music bed resolves on the
ask rather than cutting.

## 10. Checks and the gallery

- **Legibility gate**: the logo and every text role are checked against
  their ground at render size (contrast, and the logo's own measured tone
  against the ground behind it).
- **Variety gate** in a collection: the same layout twice in a row fails;
  the same layout in three of the last five warns.
- **Critic prompt**: the vision critic is asked one question of the last
  frame: "would you know what to do and where?"
- **Gallery**: every layout rendered for six reference brands (dark and
  light logos, boxed and see-through, mark and wordmark) at three aspects,
  in both renderers, so a regression in one shows up next to the others.
  This doubles as the direction map for review before any layout is
  built.

## 11. Renderers

One model, two renderers, as for every catalogue module: the resolver in
kit/core produces the layout's nodes, styles and timeline, Remotion
renders it first, HyperFrames matches it within the parity tolerance. A
layout is not done until its parity fixture passes.

## 12. Phases

| Phase | Ships | Done when |
| --- | --- | --- |
| 0 | Dark see-through marks tinted on a dark card; boxed logos left whole | shipped with this RFC |
| 1 | The direction map: the 28 layouts sketched as frames for six brands, reviewed | a person has picked which to build first |
| 2 | The contract (`end-card` params, action kinds, grounds, logo treatments), selection, and 6 layouts across the families: `sign-off`, `url-hero`, `keyword-ticket`, `split-panel`, `freeze-scrim`, `seam` | parity fixtures and the legibility gate pass |
| 3 | Footage grounds live and held, `last-line`, `live-lower`, `cutout-type`, `pointer` | a footage video ends on its own footage by default |
| 4 | The rest of the library to 24+, the sound cues, the gallery | 24 layouts in both renderers |
| 5 | Collection memory and the variety gate, the critic question | ten videos from one collection end ten ways |

## 13. Open questions

- Should `cta` and `brand-lockup` `end` merge into one `end-card` module,
  with both kept as aliases, or stay two modules sharing the library?
- How far should a layout be allowed to borrow the last scene's element
  for the arrive beat, when that scene is from another catalogue?
- Should a brand be able to ban layouts (a law firm and `diagonal-band`),
  and is that a style setting or a brand one?
- Store badges are trademarked artwork; does the kit ship them, or only
  accept them as handed-in assets, as `brand-lockup` does today?

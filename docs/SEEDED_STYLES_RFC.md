# RFC: Seeded styles, a fresh look for every project

Status: draft, open for review
Date: 2026-10-26
Builds on: [VIDEO_QUALITY_RFC.md](VIDEO_QUALITY_RFC.md) (style v3, dials, profiles),
[KIT_CONTRACTS.md](KIT_CONTRACTS.md) (style packs, brand frame, characters)

## 1. Summary

LaunchClip is open source. When someone runs it with only a prompt and no
style or brand, every video today falls back to the same palette, fonts,
card shapes, panel treatment, character drawing style and caption preset. A
flood of identical-looking videos would make "made with LaunchClip" a look
people recognise for the wrong reasons.

This RFC makes the default a **seeded style**:

- **A style or brand given** (a named pack, `--style`, brand colours, a logo,
  fonts, a reference video): use it, as today.
- **Nothing given:** draw a random seed, generate a complete style v3 pack from
  it, save the seed and the pack in the project, and use that pack. From then
  on it is the project's style: re-renders and edits look the same, and nothing
  changes unless the user asks.

A seed decides the palette, type pairing, theme, backgrounds, panels, icon and
corner treatment, motion grammar, ambient level, camera and transitions,
caption preset, module variants, illustration treatment, the character
drawing style and a fresh cast. Every choice comes from curated families
inside tested ranges, so a generated look always passes the same contrast,
legibility, layout and style gates as a hand-made pack.

## 2. Goals and non-goals

Goals:

- Two projects made from bare prompts look clearly different. The same
  project looks the same every time.
- Every generated look is good: harmonious colour, readable type and
  coherent motion, never a random mess.
- Users can reroll, pin a seed, keep a look as their own style, or ignore the
  feature entirely by naming a style.
- It works the same in `launchclip make`, `story plan` and the skills.

Non-goals:

- Generating images or fonts with a model. Everything is curated families and
  parameters, drawn in code; no network or paid call.
- Replacing the starter packs. They stay as named styles and examples.
- Changing a project that already has a style.

## 3. The contract

### 3.1 Seed and provenance

A style generated from a seed is an ordinary `launchclip.style.v3` pack with
an extra provenance block:

```json
{
  "schema": "launchclip.style.v3",
  "name": "seed-7f3a91c2",
  "generated": { "seed": "7f3a91c2", "generator": "launchclip.style-seed.v1", "tone": "warm", "at": "2026-10-26T00:00:00Z" },
  "brand": { "colors": { … }, "fonts": { … } },
  "motion": { … }, "ambient": { … }, "captions": { … },
  "layouts": { …, "panel": { "treatment": "paper", "radius": 18 } },
  "background": { "kind": "grain-gradient", "params": { … } },
  "vocabulary": { "icon_stroke": 1.75, "icon_style": "outline", "illustration": "flat-shadow" },
  "variants": { "concept-card": "stacked", "icon-row": "pills", … },
  "cast": { "drawing_style": "outlined", "members": [ … ] },
  "brand_frame": { … }, "dials": { … }, "profile": "…"
}
```

- `seed` is 8 hex characters (32 bits); `generator` versions the mapping. A
  given seed and generator version always produce the same pack.
- The project stores the pack at `.launchclip/styles/<name>/style.json`, and
  the storyboard names it with `"style": "<name>"`. That is the same
  mechanism as any project style, so the renderers, gates and editors need
  nothing new to read it.
- Raising the generator version never changes an existing project: its saved
  pack is what renders. Only a reroll uses the new version.

### 3.2 What the seed decides, and from where

Each dimension is drawn from a curated family with its own rules. The pieces
marked (new) are built by this RFC.

| Dimension | Drawn from | Rules |
|---|---|---|
| Palette | a harmony generator (new): complementary, split-complementary, analogous, triadic, monochrome with one accent, and duotone; hue, chroma and lightness drawn in OKLCH | roles bg, paper, ink, primary and accent; text pairs at least 4.5:1, large-type pairs at least 3:1; a minimum hue distance between primary and accent unless the scheme is monochrome; no palette within a set distance of a starter pack's |
| Theme | dark, light, tinted (bg is a deep or pale version of a brand hue) | drives the palette's lightness ranges |
| Type | a pairing table (new) over the bundled fonts, which grows with more OFL families (new) | display plus body plus meta; pairings are curated, not random combinations; display weight and case (all caps, title case) are part of the pairing |
| Background | a pool of background kinds (new): flat, gradient, grain-gradient, paper, geometric field, soft blobs (today's ambient field), dot grid, mesh | parameters (angle, scale, grain amount, density) inside ranges that keep text contrast |
| Panels | solid, glass, paper, outline (new), soft-shadow (new); a corner radius from 0 to 32 px | the panel tone follows the theme |
| Icons and illustration | stroke 1.25–2.5, outline or duotone (new); object-card illustration treatment: flat, flat-shadow, line | one treatment for the whole video |
| Motion | a grammar (editorial, snappy, smooth, playful, documentary, cinematic) chosen from the prompt's tone, with seeded variation inside it; an ambient level; camera cuts or world; transition preferences | the tone match is a table (calm/serious → smooth or documentary; launch/energetic → snappy; fun → playful); the seed picks among the fitting grammars |
| Captions | a preset that fits the theme and grammar | always readable (outline or shadow on light themes) |
| Module variants | each catalogue module's designed variants (new) | the seed picks per module, once per video; variants never change a module's params |
| Characters | a drawing style (new styles: outlined, paper, line, soft-shade, plus today's flat) and a cast of 2–4 built from the rig's options | build, skin tone, hair, outfit and accessories drawn for variety and respect; colour slots from the palette |
| Brand frame | kicker on or off, position, progress line style | off by default when there is no brand name |
| Dials | energy, density, playfulness, polish | around the tone's centre |

### 3.3 Tone

The generator takes an optional `tone` read from the prompt (calm, serious,
warm, energetic, playful, premium, technical), using the same art-direction
words `suggestMotion()` and `suggestModuleMoods()` already map. Tone narrows the
families; the seed picks inside them. A prompt with no tone words gets the
seed alone.

### 3.4 Not looking like the starters

A style fingerprint (palette in OKLCH, font pairing, panel treatment, grammar,
caption preset) is compared with the five starters and with the generator's
own fallback. A candidate too close is redrawn from the next seed state.
`style check` reports a "close to starter <name>" note on any render, as a
warning and never an error, so even hand-picked starters get a nudge to brand
them.

## 4. User-facing behaviour

| Situation | What happens |
|---|---|
| `launchclip make "<prompt>"` with no style or brand | generates a seed, writes the style into the project, says in one line: `style: seed 7f3a91c2 (dark, playful, Unbounded / Inter). Reroll with launchclip style reroll` |
| The same project rendered again or edited | reuses the saved style, always |
| `--style <name>`, brand colours, a logo or a reference video | uses them, with no seed |
| `--seed 7f3a91c2` | generates exactly that seed's look |
| `launchclip style reroll [<project>] [--tone playful]` | a new seed for the project; the old pack is kept as `previous` for one undo (`--undo`) |
| `launchclip style generate --seed <s> [--tone] [--out]` | writes a pack without a project |
| `launchclip style keep <project> --as <name>` | copies the generated pack to `~/.launchclip/styles/<name>`, so it becomes a reusable personal style |
| The skills | the brief step generates the seed when the user gives no style; "give me a different look" means reroll |

## 5. Phases and PRs

Small commits, PRs against main. Phases 2–4 run in parallel with phase 1,
against this contract.

| Phase | Lands | Done when |
|---|---|---|
| 0 | This RFC | Reviewed and merged |
| 1 | The generator (`kit/core/style-seed.mjs`): PRNG, palette harmony in OKLCH with contrast checks, type pairings and more OFL fonts, theme, motion and caption choice by tone, the starter-distance check; the CLI (`--seed`, `style generate`, `reroll`, `keep`); wiring into make, story plan and the skills | 50 seeds give 50 packs that all validate, pass contrast, and are pairwise distinct by fingerprint; one seed always gives one pack |
| 2 | Backgrounds and panels: the background pool and the outline and soft-shadow panels, in both renderers | Each background kind and panel has a parity fixture; text contrast holds on every kind |
| 3 | Module variants: designed variants for catalogue G cards and the editorial modules, chosen through `style.variants` | Each variant has a parity fixture; the default variant matches today's render |
| 4 | Character drawing styles: outlined, paper, line and soft-shade beside flat, plus seeded casts | A cast sheet per style; the consistency gate holds in every style |
| 5 | Integration: the seed picks phase 2–4 options; a gallery script renders one short story with 12 seeds side by side | A reviewer can't find two of the 12 that look like the same brand |

## 6. Open questions

1. **How many fonts?** Which OFL families to add first, and the size budget
   for bundled font files.
2. **Seed visibility:** should the seed show in the video's metadata or the
   NLE exports, so a viewer's question "how do I get this look" has an answer?
3. **Gallery:** publish a seed gallery in the docs, so people can pick a seed
   up front?
4. **Reroll scope:** reroll everything, or let a user reroll just the palette
   or just the characters?

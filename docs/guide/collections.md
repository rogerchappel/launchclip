# Collections and recipes

Most people want more than one video: the launch video, a demo, a clip per feature, a weekly episode. A **collection** keeps those videos together so they share one look, one voice, one brand folder and one set of rules. A **recipe** saves a kind of video you make again and again ("60-second feature clip"), so the next one comes out with the same settings.

A collection can be a product, a channel, a client or a campaign. They all work the same way.

## Make a collection

```bash
launchclip collection new acme --kind product --title "Acme"
```

This writes `./acme/` (or `<--root>/acme/`):

| File | What it's for |
|---|---|
| `collection.json` | The collection's settings |
| `styles/seed-…/` | One seeded style every video in the collection shares. `--style editorial-dark` (or a style of your own) uses a named style instead; `--seed 7f3a91c2` picks the seed |
| `brand/` | Your logo, `brand.json` and product images. Every video sees them. Videos and audio in this folder are not used |
| `RULES.md` | Your rules, in your own words: the audience, the tone, claims the videos may and may not make, words to avoid, things they never show. The script writer, the storyboard planner and the critic read it for every video |
| `recipes/` | The recipes |

`collection.json` also has a `voice`, for example `{"engine": "kokoro", "id": "af_heart"}`, so every video uses the same narrator.

`isolation` is `"strict"` by default: the brand folder and the rules must be inside the collection's own folder, so nothing from one client ends up in another client's video.

## Make a video in it

```bash
launchclip make "A 45-second launch video for Acme" --collection ./acme --assets ./launch-assets
```

This is an ordinary `launchclip make` with the collection's style, voice, brand folder and rules added. Any flag you pass still wins. The project goes to `acme/videos/<name>/` unless you pass `--out`. Afterwards `finish`, `edit` and `cutdown` work on it as on any project.

Two files record where the video came from:

- `.launchclip/resolved.json`: the settings it was made with and where each came from (collection, recipe or your flags).
- `video.json`: the collection, the recipe, the versions of the recipe and style it used, and its status.

## Save a recipe

The easiest way is to make one video you are happy with, then save its settings:

```bash
launchclip recipe new acme/feature-clip --from-video ./acme/videos/launch-acme
```

The recipe keeps what that video became: its aspect, length, format, goal, viewer awareness, pacing profile, voice, music, renderer and quality. If the video had a style of its own, the style is copied into the collection's `styles/` so the recipe can name it.

You can also write a recipe from flags, the same flags `launchclip make` takes:

```bash
launchclip recipe new acme/feature-clip --aspect 9:16 --duration 60 --format promo --goal convert
```

Then make more videos like it:

```bash
launchclip make "SSO login in two clicks" --collection ./acme --recipe feature-clip --assets ./sso
```

## When a recipe or style changes

Edit a recipe (`recipes/feature-clip.json`, or `recipe new … --force`) or a collection style, and every video made with the old version becomes **stale**. Nothing re-renders on its own. `collection show` lists them:

```bash
launchclip collection show ./acme
```

```
videos (3, 2 stale):
  STALE ready-for-review feature-clip  SSO login in two clicks
    acme/videos/feature-clip/sso-login-in-two-clicks
    recipe feature-clip changed since this video was made; make it again to update
```

Run the same `make` command again to bring a stale video up to date.

## What's next

Batches (many videos from a list of topics, approved in bulk), the machine-wide render queue, storage libraries, variety checks across a collection and destination presets (Shorts, Reels, LinkedIn) build on collections. See [`COLLECTIONS_RFC.md`](../COLLECTIONS_RFC.md). The recipe fields `destinations`, `children`, `fixed` and `vary` are checked but not used yet.

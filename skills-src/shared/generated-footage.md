## Generate footage with your own tools

Use this only when the storyboard asks for footage (`{"kind": "shot", "shows",
"type"}` in a clip, photo-scene or media-window scene, a media layout slot, a
card's image slot or a card `backdrop`), the user's own media has no match,
and you have an image or video generation tool connected (for example through
MCP). LaunchClip never calls that tool: you do, and you hand the file in. With
no such tool, design the scene without footage or ask the user for media.

A generation tool usually takes a text prompt, often a negative prompt, a
width and height or an aspect ratio, and returns an image; a video tool takes
a start image, a motion prompt and a length, and returns a clip. Some report
what the call cost. Map the brief onto whatever parameters yours has.

1. **Ask before spending.** Generation is usually paid. Tell the user which
   shots you would generate, with which tool and model, and the cost if the
   tool can quote one (or that it cannot), and wait for a yes. What they
   agree to becomes `--budget` (an amount, e.g. `2usd`), or, when the tool
   gives no price, `--max-generations` (a number of calls). Never generate
   more than they agreed to.
2. **Read the brief.** `launchclip generate brief <project> --json` prints
   `{request, brief, reason}` for each request. A `brief` of `null` is
   refused (`reason` says why): do not generate it, design the scene without
   footage. A brief with `accepted` already has those steps made for the
   current brief: reuse them, do not pay again. Story shots and plates
   (`request.role` `story` or `plate`, in a project with a frozen bible and
   an animatic) follow the same steps; `generate record` hands them into
   `HANDIN.json`, and `launchclip handin check` decides whether they are used.
3. **Before every paid call, ask LaunchClip.** This is the same gate
   `make --generate` runs; do not call your tool when it refuses:

   ```bash
   launchclip generate allow <project> --shot <request.id> --step image|video \
     --quote <0.04usd|20credits|unknown> --budget <what the user agreed> \
     [--max-generations <n>]
   ```

   It exits 1 with the reason when the budget would be passed, when the
   step is already accepted, after three attempts, or when an unpriced tool
   has no `--max-generations` left.
4. **Make the keyframe.** Stills are cheap next to a clip, so when the user
   agrees, make a few candidates (two to four) in one round: one
   `generate allow` with `--quote` for the whole round, every candidate
   recorded with that round's `--attempt` and its own `--candidate <n>`.
   For a footage shot, make each candidate a different concept, as
   `make --generate` does: decide who the video is for, pick one direction
   for the whole video (setting, kind of people, time of day) that they
   would recognise, and write each candidate one plain lower-case sentence
   in that direction (no brands, names or text). That sentence replaces the
   prompt's first sentence (the shot's `shows`); the rest stays word for
   word. Story shots and plates keep the bible's prompt.
   Call your image tool with `brief.image.prompt` word
   for word, `brief.image.negative` as the negative prompt (or appended as
   "Avoid: …" when the tool has none), and `brief.image.width` ×
   `brief.image.height` (or the nearest aspect it offers).
5. **Check it** before anything else is paid for, with the same check
   `make --generate` runs: `launchclip generate check <project> --shot
   <request.id> --file <still> --model <provider:model that takes images>`
   (a footage shot against `request.shows`; a story shot or plate against
   the bible). For candidates, pass them all, `--file a.png,b.png,c.png`:
   it ranks them in one look and names the `chosen` one (add `--audience
   "<who the video is for>"` and `--concepts "a|b|c"`, each file's concept
   in `--file` order, so each is judged against its own concept and scored
   on how well it speaks to that audience); record that one
   accepted and the others rejected with their reason. Only the chosen still
   is animated. With no such model, judge it yourself by the same rule: it
   must clearly show `request.shows`, with no text, lettering, logo, user
   interface or recognisable real person, and a calm lower third. A failed
   keyframe is recorded `--verdict rejected --reason "…"`, then retried with
   the check's `change` line (or your own one changed line) added to the
   prompt. Three attempts per shot and step at most; after that, design the
   scene without footage.
6. **Animate only if `brief.steps` includes `video`.** Call your video tool
   with the accepted keyframe as the start frame, `brief.video.prompt` as the
   motion prompt, and a length of `brief.video.seconds + 2 ×
   brief.video.pad_seconds` (LaunchClip trims the padding back). A brief with
   steps `["image"]` stops at the keyframe. A story shot's `brief.video.audio`
   says what the clip may carry: `none` turns the tool's own audio off,
   `effects` keeps only its sound effects (never music or speech; the mix
   is LaunchClip's). A brief with `brief.video.continue_from` carries straight
   on from that shot: when its clip is accepted, start this clip on its last
   kept frame (at that brief's `pad_seconds + seconds` minus one frame)
   instead of this shot's keyframe. With no clip for it,
   use the keyframe.
7. **Record every attempt**, accepted or rejected:

   ```bash
   launchclip generate record <project> --shot <request.id> --step image \
     --file <the downloaded file> --made-with "<tool>/<model>" \
     --licence "<the tool's output terms>" --brief-hash <brief.brief_hash> \
     [--cost 0.04usd] [--seed 1234] [--verdict accepted|rejected] [--reason "…"]
   ```

   It copies the file into `assets/shots/generated/`, logs one line in
   `qa/generation-log.jsonl`, and, for the accepted last step (the keyframe of
   a still, the clip of a video), points the storyboard's request at the file
   with `source.generated: true` (a story shot or plate goes into
   `HANDIN.json` instead). Pass `--cost` only when the tool reported
   one; without it the line says `cost_unknown`, which is the truth, not
   zero. `--licence` is what the tool's terms say, never a guess. A brief
   hash that no longer matches (the storyboard or narration changed) is
   refused: read the brief again and regenerate.

**Not evidence.** A generated shot illustrates; it never stands in for a
product, a screen, a person or an event the video makes a claim about. Do not
rewrite a refused `shows` to get around the refusal, and do not generate a
real product, person, place or logo by any other route.

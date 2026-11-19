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
   tool can quote one (or that it cannot), and wait for a yes. Never generate
   more than they agreed to.
2. **Read the brief.** `launchclip generate brief <project> --json` prints
   `{request, brief, reason}` for each request. A `brief` of `null` is
   refused (`reason` says why): do not generate it, design the scene without
   footage. Story shots and plates (`request.role` `story` or `plate`) are
   handed in through `HANDIN.json` instead; leave them to the animation
   branch.
3. **Make the keyframe.** Call your image tool with `brief.image.prompt` word
   for word, `brief.image.negative` as the negative prompt (or appended as
   "Avoid: …" when the tool has none), and `brief.image.width` ×
   `brief.image.height` (or the nearest aspect it offers).
4. **Check it against the brief** before anything else is paid for: it must
   clearly show `request.shows`, with no text, lettering, logo, user
   interface or recognisable real person, and a calm lower third. A failed
   keyframe is recorded `--verdict rejected --reason "…"`, then retried with
   one changed line added to the prompt. Three attempts per shot and step at
   most; after that, design the scene without footage.
5. **Animate only if `brief.steps` includes `video`.** Call your video tool
   with the accepted keyframe as the start frame, `brief.video.prompt` as the
   motion prompt, and a length of `brief.video.seconds + 2 ×
   brief.video.pad_seconds` (LaunchClip trims the padding back). A brief with
   steps `["image"]` stops at the keyframe.
6. **Record every attempt**, accepted or rejected:

   ```bash
   launchclip generate record <project> --shot <request.id> --step image \
     --file <the downloaded file> --made-with "<tool>/<model>" \
     --licence "<the tool's output terms>" --brief-hash <brief.brief_hash> \
     [--cost 0.04usd] [--seed 1234] [--verdict accepted|rejected] [--reason "…"]
   ```

   It copies the file into `assets/shots/generated/`, logs one line in
   `qa/generation-log.jsonl`, and, for the accepted last step (the keyframe of
   a still, the clip of a video), points the storyboard's request at the file
   with `source.generated: true`. Pass `--cost` only when the tool reported
   one; without it the line says `cost_unknown`, which is the truth, not
   zero. `--licence` is what the tool's terms say, never a guess. A brief
   hash that no longer matches (the storyboard or narration changed) is
   refused: read the brief again and regenerate.

**Not evidence.** A generated shot illustrates; it never stands in for a
product, a screen, a person or an event the video makes a claim about. Do not
rewrite a refused `shows` to get around the refusal, and do not generate a
real product, person, place or logo by any other route.

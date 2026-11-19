# Generated footage

When a video's plan asks for a real shot (a clip, a photo scene, a card's image, a card backdrop) and your own media has none, LaunchClip can ask an image and video model to make one. It is opt-in and usually paid: with no `--generate` flag nothing changes, nothing is sent and no key is needed. LaunchClip ships no key and picks no provider for you.

The design is in [GENERATED_FOOTAGE_RFC.md](../GENERATED_FOOTAGE_RFC.md).

## The flow

For every footage shot the plan asks for:

1. **Your library first.** If the run has an asset provider (`--asset-provider-cmd`, or the app's own), it is asked first. Only what it has no shot for is generated.
2. **The brief.** The request becomes a generation brief: what it shows, the narration line as context only, the story's look (one paragraph shared by every shot, so they match), a calm lower third for captions, and a list of what may never appear (text, logos, UI, real people). `launchclip generate brief <project>` prints the briefs without calling anything, so you can paste them into any tool by hand.
3. **The quote.** Every shot left to make is quoted before anything is generated (see [Budgets](#budgets)).
4. **The keyframe.** A still is made from text and checked against what the shot must show. A rejected still is retried with one changed line, up to three attempts; then the scene is designed without footage.
5. **The video.** Only when the shot wants video, the approved keyframe is animated. The clip is requested 0.3 s longer at each end and trimmed back, because generated clips drift at their ends.

A still slot (a card's image) stops after the keyframe.

The keyframe check uses the run's model when it can see images (`launchclip doctor --models` says whether yours can). Without one, keyframes are accepted unseen and the run says so.

## Providers and keys

| Flag value | What it is | Key (environment only) |
|---|---|---|
| `fal:<endpoint id>` | fal.ai, many hosted models behind one API | `FAL_KEY` |
| `elevenlabs:<model id>` | ElevenLabs Image & Video API (a paid plan; some models need approval or are unavailable in some regions) | `ELEVENLABS_API_KEY` |
| `cmd:<command>` | any program of yours, including a local model | none |

Keys are read from the environment, sent only to that provider, and never written to the project, the ledger or the logs.

`--generate <provider>[:<model>]` sets the provider for both steps. A hosted model usually does only one step, so name each:

```bash
export FAL_KEY=...
launchclip make "A 30-second explainer on cold brew" \
  --generate-image fal:<text-to-image endpoint> \
  --generate-video fal:<image-to-video endpoint> \
  --budget 3usd
```

`--generate-draft-video <provider>:<model>` names a cheaper video model and generates at draft tier. With no video provider, video shots are left to the plan and "any" shots become stills.

A `cmd:` provider is started once and speaks one JSON line per call on stdin and stdout. It reads `{id, op: "quote", brief, step, tier}` and answers `{id, amount, unit}` (amount `null` when it has no price), and reads `{id, op: "generate", brief, step, tier, startFrame?}` and answers `{id, file, model?, seed?, licence?, cost?}` or `{id, error}`. `step` is `image` or `video`; for the video step `startFrame` is the approved keyframe's path. A local model can quote `{amount: 0, unit: "seconds"}`: time on your machine needs no budget.

## With your agent's own tools

If you make videos with the LaunchClip skill and your agent has an image or video generation tool connected (for example through MCP), the agent can generate the footage itself. LaunchClip never sees that tool or its account: it writes the brief, and the agent hands the file back.

1. The agent asks you before spending, naming the shots, the tool and the cost if the tool can say.
2. `launchclip generate brief <project> --json` gives each shot's brief. The agent makes the keyframe from `image.prompt`, `image.negative` and the size, checks it against what the shot must show, and animates it only when `steps` includes `video` (the keyframe as the start frame, `video.seconds + 2 × pad_seconds` long).
3. Every attempt is handed in:

```bash
launchclip generate record <project> --shot <request id> --step image|video \
  --file <path> --made-with "<tool>/<model>" --licence "<the tool's terms>" \
  [--cost 0.04usd] [--seed 1234] [--brief-hash sha256:...] \
  [--verdict accepted|rejected] [--reason "..."]
```

It copies the file under `assets/shots/generated/`, logs one ledger line (provider `agent`), and for an accepted still, or an accepted clip, points the storyboard's request at the file with `source.generated: true`. A `--brief-hash` that no longer matches the brief (the storyboard or narration changed since) is refused. Three attempts per shot and step, as in `make`.

**Cost.** Pass `--cost` when the tool reported what the call cost. Without it the line is logged with `cost_unknown`, and `MAKE.json` costs show that generation as unknown (no USD estimate, with a warning), not as free: check the tool's own billing. The budget flags are for `make --generate`; on the skill path, the agent asking you first is the money gate.

Story shots and plates are not recorded this way yet; they are handed in through the animation branch.

## Budgets

Before any paid call, each batch of shots is quoted and printed.

- **In a terminal**, the run asks. A yes is a budget of that quote.
- **Headless**, the run needs `--budget <n>[usd|credits]` (for example `--budget 3`, `--budget 200credits`, or both: `--budget 3usd,200credits`) and refuses a batch whose quote passes it. `--budget-daily` caps a day's spend the same way.
- **A provider with no price** (ElevenLabs has no cost estimate; some fal models price in units the quote can't total) reports no cost after a call either, so LaunchClip can't count its spend and `--budget` can't stop it. It is refused unless you cap its paid calls with `--max-generations <n>`. Spend for it is not tracked: check your provider's dashboard. The cap counts every unpriced attempt in the project's ledger, across runs, so a re-run doesn't reset it.

The budget is also checked before every call against the spend already recorded, so a quote that was too low still stops at the budget. When it stops, the shots not yet made are designed without footage, and the run says why.

Every attempt, accepted, rejected or failed, is one line in `qa/generation-log.jsonl`: the shot, step, attempt, provider, model, seed, cost, file, verdict and reason. A re-run of `make` reuses every accepted shot whose brief has not changed. `MAKE.json` adds the ledger to its costs (stage `generate`), so the spend per video is in one place. A provider that reports no cost is logged with `cost_unknown` and counts toward `--max-generations`, not the budget.

## Not evidence

A generated shot illustrates; it never stands in for a product, a screen, a person or an event the video makes a claim about. A request that names a real product, person or place (a capitalised name, a brand mark, a handle) is never generated: it is left to your library, or the scene is designed without footage. Every generated shot carries `source.generated: true` in `MAKE.json`, so a host can label it.

## Licence

What you may do with a generated file is set by the provider and the model, not by LaunchClip. Each shot's `source.licence` is what the adapter reported (fal's model metadata, ElevenLabs' terms page, or your command's `licence`); LaunchClip never guesses one. Read the provider's terms before you publish.

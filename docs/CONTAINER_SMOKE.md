# CPU-only container smoke

LaunchClip is usually developed on a machine with a GPU and plenty of memory. Apps that run it in production often use a busy CPU-only container instead. Some failures only show up there: a stage that runs local Whisper on a CPU and hangs for half an hour, or a Remotion render whose compositor runs out of memory. This smoke test runs LaunchClip the way such a worker does, so those failures turn up here first.

## When to run it

Before any app bumps its pinned LaunchClip commit. Also after changes to render concurrency, memory budgets, the inventory or transcription, or the Remotion version.

```bash
npm run smoke:container
```

It needs Docker with at least 8 CPUs and about 8 GB of memory available to it. On Docker Desktop, set that under Settings → Resources. The first build takes a few minutes (npm ci and Remotion's headless Chrome). Later builds reuse the apt layer.

## What it does

`scripts/container-smoke.mjs` builds `scripts/container-smoke/Dockerfile` from the checkout's tracked and unignored files, which is what a pinned git checkout holds. The image is Node 22 on Debian trixie-slim with ffmpeg, Debian's chromium libraries, `npm ci`, the Remotion kit build and `npx remotion browser ensure`. It runs as a non-root user and contains no Python, Whisper, Ollama or model weights.

The container runs with `--cpus 8 --memory 7.5g --memory-swap 7.5g --network none` and no GPU. Inside it, `scripts/container-smoke/run.mjs` runs one footage-led `make`:

```
launchclip make "…" --assets <dir> --aspect 9:16 --format short-form --renderer remotion --quality high \
  --music synth --research off --no-subject --base-edited --base-transcript <words.json> --json \
  --model compatible:smoke-stub
```

- **Footage**: `examples/story/footage/assets/recording.mp4` with its false start cut out, repeated `--repeat` times (3 by default, which makes a 60 s clip). The word transcript is the example's `NARRATION.json`, shifted for each copy.
- **Model**: `scripts/container-smoke/model-stub.mjs` is an OpenAI-compatible stub on 127.0.0.1. It answers the direction pass with an empty map and the storyboard pass with the example storyboard laid over every copy. Any other model pass gets a 500, so a new model call in `make` fails the smoke. There is no API key and no paid call.
- **Tripwires**: `whisper`, `whisper-cli`, `whisper-cpp`, `faster-whisper` and `ollama` on `PATH` record the call and fail. A preloaded `fetch` wrapper (`tripwire.mjs`) records and refuses every request that isn't to the local stub, which covers model downloads through `@huggingface/transformers` or `ensureModel`.

## What it checks

It fails unless all of these hold:

- `make` exits 0 within the budget (`--budget`, 900 s by default);
- every `make` stage and every `finish` stage reports done (or skipped);
- an MP4 with a video stream comes out;
- nothing tripped the Whisper/Ollama/network wire, and no model weights were written under the caches;
- only stubbed model passes ran;
- the cgroup's `memory.peak` stays under the limit, and `memory.events` shows no `oom_kill`.

It prints the per-stage timings, the peak memory (from cgroup `memory.peak` and from sampled `docker stats`) and each check. Everything is also written to `.smoke/container/`: `summary.json`, `result.json`, `MAKE.json`, `smoke.mp4`, `docker-stats.json`, the tripwire log and the stub's log.

## Options

```bash
npm run smoke:container -- --cpus 8 --memory 7.5g --budget 900 --repeat 3 --out .smoke/container
npm run smoke:container -- --browser image            # render with the Chrome baked into the image
npm run smoke:container -- --no-build                 # reuse the last image
npm run smoke:container -- --platform linux/amd64     # the production architecture (emulated on Apple silicon, so slower)
```

`--browser default` leaves `LAUNCHCLIP_REMOTION_BROWSER` unset and runs `make` from a job folder, as a host app does. Remotion then looks for its browser under `node_modules/.remotion` relative to `make`'s working directory. It doesn't find the copy baked into the image, so it tries to download one at render time. Offline, that is a failed DNS lookup of `remotion.media`, which the tripwire reports. `--browser image` sets `LAUNCHCLIP_REMOTION_BROWSER` to the image's headless shell, which is how a host worker should run until LaunchClip finds its own browser.

On Apple silicon the image is linux/arm64 by default, so timings and memory can differ from an amd64 worker. In CI, the manual and weekly `Container smoke` workflow (`.github/workflows/container-smoke.yml`) runs it on an amd64 runner.

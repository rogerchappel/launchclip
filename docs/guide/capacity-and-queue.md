# Running several videos at once

Every `launchclip` process on your machine shares one queue: a `make` in one
terminal, a `finish` in another, an agent session and, later, a batch. A
render takes a render slot, and a local model (Kokoro voice, subject
matting, Ollama) takes a local-model slot. When the slots are full, the next
job waits its turn and says so in one line:

```
waiting for a render slot: 2 of 2 in use by acme/launch, thoroughbreds-yt/ep-14
```

It never fails for lack of a slot. Jobs are named by the last two folders of
their project.

## How many slots your machine has

```bash
launchclip doctor --capacity
```

```
machine: 10 cores, 24 GB RAM, GPU Apple M4 (10 GPU cores)
  plan         4
  local-model  1
  render       2
  io           1
each render uses 5 cores (--concurrency overrides), video cache 1.8 GB
```

| Slot | Work | Starting rule |
|---|---|---|
| `plan` | script, storyboard, critic and repair calls | 4 |
| `local-model` | Ollama planning, Kokoro voice, subject matting | 1, or 2 with 32 GB+ |
| `render` | Chromium frames and the encode | min(cores ÷ 5, (RAM − 4 GB) ÷ 7 GB), at least 1 |
| `io` | copying to finals or archive | 1 per disk |

Today renders and local models wait for slots; `plan` and `io` are the
counts batches will use. The rule comes from measured renders
([`benchmarks/RENDER_CAPACITY.md`](../../benchmarks/RENDER_CAPACITY.md)).
Add `--json` for the report as JSON.

Override any slot for a session:

```bash
LAUNCHCLIP_SLOTS=render:1,plan:6 launchclip make "..."
```

## Cores per render

Each render gets its share of the cores (the cores divided by the render
slots) instead of taking all of them, so two renders don't fight. Remotion
gets it as `--concurrency`, HyperFrames as `--workers`. Set it yourself with
`--concurrency`:

```bash
launchclip finish my-video --quality high --concurrency 8
launchclip make "..." --concurrency 8
```

The share is also capped by memory: each render's share of the RAM (the
container's limit, when there is one) keeps 1.5 GB for Node, the browser
process and FFmpeg, then a video frame cache of 15% of the share (0.5–2 GB),
and allows one Chrome tab per remaining GB. An 8-core, 7.5 GB container
renders with 4 tabs and a 1.1 GB cache; an 8-core, 16 GB one with 8 tabs and
a 2 GB cache. The cache size is passed to Remotion, whose own default (half
the host's free memory) can outgrow a container's limit.

## What is running

```bash
launchclip queue          # running and waiting jobs, per slot
launchclip queue --json
```

## Where the queue lives

`$LAUNCHCLIP_HOME/queue/` (default `~/.launchclip/queue/`). A held slot is a
`<slot>-<n>.lock` file holding the process ID, start time and project. If a
job is killed, its lock stays until the next job notices the process is gone
and removes it; you never need to delete locks by hand.

`LAUNCHCLIP_QUEUE=off` runs a job without the queue.

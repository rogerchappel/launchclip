# Render capacity

What one render costs, so the render-slot rule in `src/capacity.js`
(docs/COLLECTIONS_RFC.md §5.2) can be fitted to measurements:

```bash
node benchmarks/render-capacity/run.mjs [--fixture examples/story/promo-16x9] [--shares 5,10] [--parallel 2]
```

It renders the fixture once per renderer, quality and core share (Remotion
`--concurrency`, HyperFrames `--workers`), then two drafts at once at half
the cores each. Each render runs in a child process whose whole tree,
Chromium included, is sampled every 200 ms. Peak RSS sums the tree, so pages
Chromium shares between its processes count more than once: it is an upper
bound. Raw results are in `render-capacity/results/`.

## Apple M4, 10 cores (4 performance + 6 efficiency), 24 GB — 2026-10-27

Fixture `examples/story/promo-16x9`: 26 s, 1920×1080, 30 fps.

**The machine was busy**: three other sessions were running tests and
builds, with a load average of 15–40 on 10 cores during the run ("load
before" below). No render got more than about 4.7 cores, so CPU and wall
times are pessimistic and the concurrency comparisons are noisy. Peak RSS is
less affected. Run it again on an idle machine before tuning the rule
seriously.

| run | wall s | CPU s | cores busy | wall / rendered s | CPU / rendered s | peak RSS GB | per render GB | load before |
|---|---|---|---|---|---|---|---|---|
| remotion draft @5 | 24.3 | 92.5 | 3.8 | 0.93 | 3.56 | 3.38 | 3.38 | 15.7 |
| remotion draft @10 | 22.4 | 74.2 | 3.3 | 0.86 | 2.85 | 4.49 | 4.49 | 17.8 |
| remotion high @5 | 27.5 | 128.4 | 4.7 | 1.06 | 4.94 | 3.51 | 3.51 | 22.0 |
| remotion high @10 | 36.6 | 137.3 | 3.8 | 1.41 | 5.28 | 4.48 | 4.48 | 22.6 |
| 2× remotion draft @5 | 57.7 | 198.9 | 3.5 | 1.11 | 3.83 | 5.29 | 2.65 | 27.5 |
| hyperframes draft @5 | 21.8 | 48.1 | 2.2 | 0.84 | 1.85 | 1.81 | 1.81 | 40.4 |
| hyperframes draft @10 | 17.8 | 37.6 | 2.1 | 0.68 | 1.44 | 2.61 | 2.61 | 34.5 |
| hyperframes high @5 | 42.2 | 131.5 | 3.1 | 1.62 | 5.06 | 1.80 | 1.80 | 33.8 |
| hyperframes high @10 | 43.6 | 145.7 | 3.3 | 1.68 | 5.60 | 2.30 | 2.30 | 33.4 |
| 2× hyperframes draft @5 | 27.0 | 99.8 | 3.7 | 0.52 | 1.92 | 3.04 | 1.52 | 30.7 |

On a 6 s 1080×1920 fixture (`examples/story/minimal`, load 14–18), drafts at
@5 took 0.99 (Remotion) and 1.73 (HyperFrames) wall seconds per rendered
second; a fixed start-up cost of about 5 s per render dominates clips that
short.

## What it says about the rule

- **Cores**: a render did not get faster with all 10 cores instead of 5
  (Remotion high was slower: 36.6 s against 27.5 s). That supports splitting
  the cores across render slots instead of `auto`. A render needs about 3.5–5
  CPU seconds per rendered second at 1080p in either renderer at high quality,
  so `cores ÷ 5` per render holds up.
- **Two at once**: two HyperFrames drafts finished in 27.0 s against 21.8 s for
  one, nearly twice the throughput. Two Remotion drafts took 57.7 s against
  24.3 s for one, no gain, but the machine was already overloaded; this is the
  measurement most worth repeating on an idle machine.
- **RAM**: the worst peak was 4.5 GB for one Remotion render (an upper bound)
  and 2.6 GB for HyperFrames, below the rule's 7 GB per render. On this
  machine the core term (2) binds before the RAM term (2.86), so the rule's
  answer is the same either way. Lowering the per-render RAM figure would
  only matter on machines with many cores and little RAM; that waits for
  idle measurements and a longer, heavier fixture (4K, footage, subject
  mattes).

The rule is unchanged: `render = min(cores ÷ 5, (RAM − 4 GB) ÷ 7 GB)`, at
least 1.

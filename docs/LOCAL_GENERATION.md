# Local generation on Apple silicon

Status: research for delivery phase 4 of
[GENERATED_FOOTAGE_RFC.md](GENERATED_FOOTAGE_RFC.md) and its open question 1
(§11): which local models are good enough on a Mac to make footage shots, and
how LaunchClip drives them. Read 2026-11-20. Timings are other people's
published runs, not ours; measure your own and put the rate in the workflow
(below).

## Recommendation

- **Driver: ComfyUI's HTTP API** (`--generate local:<workflow.json>`). It is
  the one local tool that runs both steps (text to image and image to video)
  on Apple silicon through PyTorch MPS, takes any model as a workflow, and has
  a queue (`POST /prompt`, `GET /history/{id}`, `GET /view`) that maps onto
  the provider contract's submit, poll and fetch directly
  ([server routes](https://docs.comfy.org/development/comfyui-server/comms_routes),
  [API examples](https://docs.comfy.org/development/comfyui-server/api-examples)).
  LaunchClip bundles nothing: you install ComfyUI and the weights.
- **Stills: FLUX.1 [schnell]** (apache-2.0, 1 to 4 steps;
  [model card](https://huggingface.co/black-forest-labs/FLUX.1-schnell)), or
  **Z-Image-Turbo** (apache-2.0, 6B, the card says it fits in 16 GB;
  [model card](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo)) on smaller
  Macs. Both are good enough for keyframes today, at tens of seconds a still.
- **Video: Wan2.2-TI2V-5B** (apache-2.0, 720p at 24 fps, text or image to
  video; [model card](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B)), **for
  drafts and overnight runs only.** Honestly, local video is not good enough
  yet to be an attended default: published Mac runs take roughly ten minutes
  of compute per second of output on an M3 Max, more on smaller chips, and
  need 64 GB to be comfortable. A 30-second Short with eight 4-second shots is
  a night's work. Use a hosted model for finals until this changes; the local
  path makes the whole pipeline run with no network and no key, slowly.

## What runs, how fast

| Model | Step | Licence (model card) | Mac route | Published Mac timing | Memory |
|---|---|---|---|---|---|
| FLUX.1 [schnell] | image | apache-2.0 (gated download) | ComfyUI, Draw Things, mflux (MLX) | ComfyUI fp8, 4 steps, 1024²: 8–14 s warm on M4 Max; Draw Things 6–9 s ([xialei](https://xialei.com/blog/flux-ai-image-model-macbook-m4-max-local)); mflux 2 steps: ~20 s M3 Max, ~25 s M2 Max 96 GB, ~70 s M2 Max 32 GB ([bitdoze](https://www.bitdoze.com/ai-images-mac/)) | 32 GB+ comfortable; 16 GB swaps badly ([modelfit](https://modelfit.io/guides/local-image-generation-mac/)) |
| Z-Image-Turbo | image | apache-2.0 | mflux, ComfyUI | ~95–102 s on M1 Max 64 GB, one pre-release mflux run ([modelfit](https://modelfit.io/image/z-image-turbo/)) | 16 GB per the card |
| Wan2.2-TI2V-5B | video | apache-2.0 | ComfyUI (MPS), mlx-video | 1280×704, 49 frames (~2 s): 7 min 16 s on M5 Max in ComfyUI; 121 frames ~35 min ([voyager](https://voyager.so/blog/comfyui-image-to-video-local-workflow)); ~10 min compute per output second on M3 Max ([modelfit](https://modelfit.io/blog/wan-2-2-on-mac/)) | card: 24 GB VRAM on one GPU; 64 GB unified memory in practice; did not finish a step on a 16 GB M4 ([rotecodefraktion](https://www.rotecodefraktion.de/en/blog/lokale-ki-video-wan-mac/)) |
| Wan 2.2 A14B (GGUF) | video | apache-2.0 | ComfyUI | 82 min for a 2 s clip on M1 Max 64 GB ([lilting](https://lilting.ch/en/articles/ltx2-wan22-mac-local-video-gen)) | 64 GB |
| LTX-2 / LTX-2.3 | video | LTX-2 Community License, not apache ([model card](https://huggingface.co/Lightricks/LTX-2)); read its terms before commercial use | community MLX ports ([mlx-video](https://github.com/Blaizzy/mlx-video)); officially CUDA, FP8 and float64 paths fail on MPS ([lilting](https://lilting.ch/en/articles/ltx2-wan22-mac-local-video-gen)) | no published Mac timing found | MLX ports suggest 64 GB |

Notes from the same sources: on MPS, if later frames dissolve into colour
bands, switch the sampler from `uni_pc` to `euler` (the example workflow
uses `euler`); fp8 checkpoints of some video models fail on Metal; a ComfyUI
that fell back to CPU takes an hour or more an image, so check it runs on MPS
(`launchclip doctor` lists the devices ComfyUI reports).

Other drivers considered: **Draw Things** is the fastest Mac app for stills,
but we found no documented HTTP API for its video models; **mflux** is a clean
CLI for stills only; **diffusers on MPS** means LaunchClip owning a Python
environment and the weights, which the open-source rules rule out. All of
these can still be driven with `--generate cmd:<your script>`.

## Using it

1. Install and start ComfyUI (the desktop app, or `python main.py`), and put
   the model files where it expects them. LaunchClip never downloads weights.
2. Export your workflow with **File → Export (API)**, or start from
   [`docs/comfyui/flux-schnell.json`](comfyui/flux-schnell.json) and [`wan22-ti2v-5b.json`](comfyui/wan22-ti2v-5b.json)
   (their model file names follow ComfyUI's own templates; check they match
   yours). Replace the inputs LaunchClip fills with placeholders:
   `{{prompt}}`, `{{negative}}`, `{{width}}`, `{{height}}`, `{{seed}}`, and
   for video `{{start_frame}}` (a `LoadImage` input), `{{frames}}`, `{{fps}}`,
   `{{seconds}}`. End the graph in a Save node.
3. Add a `launchclip` block to the file:
   `{"model", "licence", "seconds_per_image" | "seconds_per_second", "fps"?, "frames_multiple"?}`.
   `licence` is required: copy it from the model card. The rate is your own
   measured time; without it the quote says "unknown seconds". `frames` is
   rounded up to `n × frames_multiple + 1` (4 for Wan, 8 for LTX).
4. Run:

```bash
launchclip make "A 30-second explainer on cold brew" \
  --generate-image local:flux-schnell.json \
  --generate-video local:wan22-ti2v-5b.json
```

`COMFYUI_URL` sets the address (default `http://127.0.0.1:8188`). Local time
needs no `--budget`: the quote is printed in seconds and the ledger records
the measured seconds per call. Mix freely: a local keyframe and a hosted video
model is `--generate-image local:flux-schnell.json --generate-video fal:<endpoint>`.

# Local generation with ComfyUI

LaunchClip can ask a [ComfyUI](https://github.com/comfyanonymous/ComfyUI) server running on your own machine to make sound effects, still plates and short draft clips. It is fully optional: with no ComfyUI running, everything works exactly as before and falls back to the built-in procedural kit.

LaunchClip never installs ComfyUI, custom nodes or models, and never downloads model weights. You bring them. It talks to ComfyUI only over its HTTP API, runs only the workflow templates it ships (`src/comfy/templates/`, core nodes only), and only talks to a server on this machine (`127.0.0.1`, `::1` or `localhost`).

## Setup

1. Install and start ComfyUI (the desktop app or `python main.py`). It listens on `http://127.0.0.1:8188` by default; the desktop app uses `8000`.
2. Put each template's model files where ComfyUI's loaders look for them (table below).
3. If ComfyUI is not on port 8188, tell LaunchClip where it is with `--comfy-url http://127.0.0.1:8000` or `LAUNCHCLIP_COMFY_URL`.

A server on another machine is refused unless you pass `--comfy-allow-remote` for that run.

## Templates and licences

| Template | Makes | Model files (ComfyUI folder) | Licence |
|---|---|---|---|
| `sfx-stable-audio` | sound effects | `stable-audio-open-1.0.safetensors` (`models/checkpoints`), `t5_base.safetensors` (`models/text_encoders`) | Stability AI Community License (`stability-ai-community`) |
| `plate-flux-schnell` | still plates (default) | `flux1-schnell-fp8.safetensors` (`models/checkpoints`, the single-file fp8 checkpoint) | Apache-2.0 |
| `plate-sdxl` | still plates | `sd_xl_base_1.0.safetensors` (`models/checkpoints`) | CreativeML Open RAIL++-M (use-based restrictions) |
| `draft-wan-5b` | draft video clips, about 480p, up to 5 s | `wan2.2_ti2v_5B_fp16.safetensors` (`models/diffusion_models`), `umt5_xxl_fp8_e4m3fn_scaled.safetensors` (`models/text_encoders`), `wan2.2_vae.safetensors` (`models/vae`) | Apache-2.0 |

Templates whose model is under an open licence (Apache-2.0, MIT, BSD-3-Clause, CreativeML Open RAIL++-M) run without asking. Any other licence is refused before anything is sent, until you accept it by id with `--allow-model-licence <id>`. Every generated file records the licence it was made under, and `finish` names it in its notes and in `AUDIO-MANIFEST.json`.

Stable Audio Open 1.0 is free for research, non-commercial use and commercial use by organisations under US$1M annual revenue; above that you need an enterprise licence from Stability AI. Check its terms before you allow it.

## Sound effects

```bash
launchclip sfx seed --provider comfy --allow-model-licence stability-ai-community
launchclip sfx reroll impact --provider comfy --allow-model-licence stability-ai-community
```

For each effect family, LaunchClip asks for four takes from the family's prompt, trims and levels them like any other download, and keeps the takes the SFX classifier hears as the right kind of sound (an impact must sound like an impact). Families where no take passes, or where ComfyUI is not running or is missing a node or model file, use the procedural kit, with a warning that says why.

Takes are cached by their exact inputs (prompt, model files, seed and every other workflow value) in `<library>/cache/comfy/`, so seeding again sends nothing; a reroll changes the seeds. Each generation is one line in `<library>/generation-log.jsonl` with its model, seed, licence and time taken.

## Plates and draft clips

```bash
launchclip make "a 30 second explainer on tides" --asset-provider comfy
launchclip make "…" --asset-provider comfy --comfy-plate plate-sdxl --card-backdrops footage
```

With `--asset-provider comfy`, the planner may ask for shots as it does with an app's provider (`--asset-provider-cmd`). A request for a still, or for "any", gets a plate from `plate-flux-schnell` (or `--comfy-plate plate-sdxl`) at about one megapixel in the video's aspect. A request for video gets a `draft-wan-5b` clip at about 480p, 24 fps, as long as the scene up to 5 s. Prompts are the request's description plus "no text, no lettering"; backdrop requests ask for an empty, steady wide shot.

If ComfyUI is not running, lacks a node or a model file, or a job fails, that shot is drawn in code instead, with one notice per reason. Files are cached by their inputs in `<project>/.launchclip/cache/comfy/`, and each generation is logged in `<project>/qa/generation-log.jsonl` with its model, seed and licence. The licence also goes into the shot's `source.license` in the plan report.

On Apple Silicon, a FLUX schnell or SDXL plate takes about a minute; a Wan 5B draft takes minutes per second of video, so it suits drafts, not finals.

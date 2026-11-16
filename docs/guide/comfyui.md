# Local generation with ComfyUI

LaunchClip can ask a [ComfyUI](https://github.com/comfyanonymous/ComfyUI) server running on your own machine to make sound effects. It is fully optional: with no ComfyUI running, everything works exactly as before and falls back to the built-in procedural kit.

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

Templates whose model is under an open licence (Apache-2.0, MIT, BSD-3-Clause, CreativeML Open RAIL++-M) run without asking. Any other licence is refused before anything is sent, until you accept it by id with `--allow-model-licence <id>`. Every generated file records the licence it was made under, and `finish` names it in its notes and in `AUDIO-MANIFEST.json`.

Stable Audio Open 1.0 is free for research, non-commercial use and commercial use by organisations under US$1M annual revenue; above that you need an enterprise licence from Stability AI. Check its terms before you allow it.

## Sound effects

```bash
launchclip sfx seed --provider comfy --allow-model-licence stability-ai-community
launchclip sfx reroll impact --provider comfy --allow-model-licence stability-ai-community
```

For each effect family, LaunchClip asks for four takes from the family's prompt, trims and levels them like any other download, and keeps the takes the SFX classifier hears as the right kind of sound (an impact must sound like an impact). Families where no take passes, or where ComfyUI is not running or is missing a node or model file, use the procedural kit, with a warning that says why.

Takes are cached by their exact inputs (prompt, model files, seed and every other workflow value) in `<library>/cache/comfy/`, so seeding again sends nothing; a reroll changes the seeds. Each generation is one line in `<library>/generation-log.jsonl` with its model, seed, licence and time taken.

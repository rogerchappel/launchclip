// Style preview reels (docs/SEEDED_STYLES_RFC.md §3.10): stage a one-off
// project that names the style, compile the preview story
// (kit/core/style-preview.mjs) and render it, so a host can show a brand its
// look. The project is an ordinary story project: the style sits at
// .launchclip/styles/<name>/style.json and the storyboard names it.
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { stylePreviewStory } from "@launchclip/core/style-preview.mjs";
import { validateStylePack } from "@launchclip/core/style.mjs";
import { getRenderer } from "./renderers/index.js";
import { compileStoryCommand } from "./story_cli.js";

/**
 * Write the preview project for a style into `dir` (replaced). → {project, storyFile, story}
 * options: aspect (16:9 | 9:16 | 1:1), duration (8–12 s), title, kicker.
 */
export async function stageStylePreview(style, dir, options = {}) {
  const validation = validateStylePack(style);
  if (!validation.ok) throw new Error(`style ${style?.name ?? ""} is invalid:\n- ${validation.errors.join("\n- ")}`);
  const project = path.resolve(dir);
  const story = stylePreviewStory(style, options);
  await rm(project, { recursive: true, force: true });
  await mkdir(path.join(project, ".launchclip", "styles", style.name), { recursive: true });
  await writeFile(path.join(project, ".launchclip", "styles", style.name, "style.json"), `${JSON.stringify(style, null, 2)}\n`);
  const storyFile = path.join(project, "storyboard.json");
  await writeFile(storyFile, `${JSON.stringify(story, null, 2)}\n`);
  return { project, storyFile, story };
}

/**
 * Render a style's preview reel to `out` (an .mp4). options: renderer
 * (hyperframes | remotion; hyperframes by default), quality (draft by
 * default), work (the staging directory; default <out>.preview beside it),
 * plus the stageStylePreview options. adapters.compile / adapters.render
 * replace the real compiler and renderer (tests).
 * → {status, renderer, video, project, duration, story}
 */
export async function renderStylePreview(style, { out, renderer = "hyperframes", quality = "draft", work, ...options } = {}, adapters = {}) {
  if (!out) throw new Error("renderStylePreview needs out, the .mp4 to write");
  if (!["hyperframes", "remotion"].includes(renderer)) throw new Error("renderer must be hyperframes or remotion");
  const video = path.resolve(out);
  const staged = await stageStylePreview(style, work ?? `${video.replace(/\.mp4$/i, "")}.preview`, options);
  const compile = adapters.compile ?? ((name, project) => compileStoryCommand(project, { renderer: name, ...(name === "hyperframes" ? { out: path.join(project, "hyperframes") } : {}) }));
  const render = adapters.render ?? ((name, project, file, opts) => getRenderer(name).render(name === "hyperframes" ? path.join(project, "hyperframes") : project, file, opts));
  const compiled = await compile(renderer, staged.project);
  await mkdir(path.dirname(video), { recursive: true });
  await render(renderer, staged.project, video, { quality });
  return { status: "rendered", renderer, video, project: staged.project, duration: staged.story.format.duration, warnings: compiled?.warnings ?? [], story: staged.story };
}

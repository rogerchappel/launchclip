// Overlay renders for `launchclip export`: every overlay scene as its own
// clip with alpha, from the Remotion kit's SceneOverlay composition
// (kit/remotion/SceneOverlay.tsx).
//
//   prores4444  --codec prores --prores-profile 4444 --pixel-format yuva444p10le
//               --image-format png → media/overlays/<scene>.mov
//   png         --sequence --image-format png → media/overlays/<scene>/frame-NNNN.png
//
// The project is bundled once (`remotion bundle`) and every scene renders from
// that bundle. The bundle's public dir is a staging folder of symlinks to the
// project's top-level entries, minus generated output (exports/, renders/,
// .launchclip/, qa/), so earlier exports are never copied into the bundle.
//
// HyperFrames can write transparent MOV and PNG sequences (`hyperframes render
// --format mov|png-sequence`), but the story compiler always paints the brand
// background and compiles the whole timeline, so overlays come from Remotion
// whichever renderer made the finished video.
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRemotionRenderer, remotionInvocation } from "../renderers/remotion.js";
import { adapterError, captureCommand, runCommand } from "../renderers/command.js";

export const OVERLAY_COMPOSITION = "SceneOverlay";
const EXCLUDED = new Set(["exports", "renders", ".launchclip", "qa", "node_modules", ".git"]);

/** Remotion CLI arguments for one overlay render. */
export function overlayRenderArgs({ bundle, propsFile, outFile, mode, concurrency }) {
  const args = ["render", bundle, OVERLAY_COMPOSITION, path.resolve(outFile), "--props", propsFile, "--overwrite", "--log", "warn", "--image-format", "png"];
  if (mode === "png") args.push("--sequence", "--image-sequence-pattern", "frame-[frame].[ext]");
  else args.push("--codec", "prores", "--prores-profile", "4444", "--pixel-format", "yuva444p10le");
  if (concurrency != null && concurrency !== "auto") args.push("--concurrency", String(concurrency));
  return args;
}

/**
 * A renderer for overlay clips. options: {run, entry}. Returns
 * {prepare(project, workDir), render(entry, story, outFile, mode)}.
 */
export function createOverlayRenderer(options = {}) {
  const run = options.run ?? runCommand;
  const remotion = (args, cwd) => {
    const invocation = remotionInvocation(args);
    return captureCommand(run, invocation.command, invocation.args, { cwd });
  };
  let bundle = null;
  let workDir = null;
  return {
    async prepare(project, dir) {
      workDir = dir;
      const publicDir = path.join(dir, "public");
      await rm(publicDir, { recursive: true, force: true });
      await mkdir(publicDir, { recursive: true });
      for (const entry of await readdir(project, { withFileTypes: true })) {
        if (EXCLUDED.has(entry.name)) continue;
        await symlink(path.join(project, entry.name), path.join(publicDir, entry.name));
      }
      const entry = createRemotionRenderer({ entry: options.entry }).resolveEntry(project);
      bundle = path.join(dir, "bundle");
      await rm(bundle, { recursive: true, force: true });
      const result = await remotion(["bundle", entry, "--public-dir", publicDir, "--out-dir", bundle, "--log", "warn"], project);
      if (!result.ok) throw adapterError("Remotion bundle", result);
      return { bundle, entry };
    },
    async render(entry, story, outFile, { mode = "prores4444", concurrency } = {}) {
      if (!bundle) throw new Error("overlay renderer: call prepare() first");
      const propsFile = path.join(workDir, "props", `${entry.key}.json`);
      await mkdir(path.dirname(propsFile), { recursive: true });
      await writeFile(propsFile, `${JSON.stringify({ story, sceneId: entry.sceneId, loop: entry.loop, plate: entry.plate })}\n`);
      if (mode === "png") { await rm(outFile, { recursive: true, force: true }); await mkdir(outFile, { recursive: true }); }
      else await mkdir(path.dirname(outFile), { recursive: true });
      const result = await remotion(overlayRenderArgs({ bundle, propsFile, outFile, mode, concurrency }), workDir);
      if (!result.ok) throw adapterError(`Remotion overlay render (${entry.key})`, result);
      if (mode === "png") return { kind: "png-sequence", source: outFile, ...(await sequencePattern(outFile)) };
      if (!existsSync(outFile)) throw new Error(`Remotion overlay render (${entry.key}) wrote no ${outFile}`);
      return { kind: "mov", source: outFile };
    }
  };
}

/** Frame naming of a rendered PNG sequence directory → {pattern: {prefix, suffix, start, padding}, frames, firstFrame}. */
export async function sequencePattern(directory) {
  const files = (await readdir(directory)).filter((name) => /\.png$/i.test(name)).sort();
  if (!files.length) throw new Error(`no PNG frames in ${directory}`);
  const match = /^(.*?)(\d+)(\.png)$/i.exec(files[0]);
  if (!match) throw new Error(`cannot read the frame number of ${files[0]}`);
  return { pattern: { prefix: match[1], suffix: match[3], start: Number(match[2]), padding: match[2].length }, frames: files.length, firstFrame: files[0] };
}

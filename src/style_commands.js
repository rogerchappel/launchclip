// launchclip style create --from-reference / style check: thin CLI wrappers
// around src/style_reference.js and src/style_store.js.
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeReference, compareToStyle, draftStyleFromReferences } from "./style_reference.js";
import { styleAdherence, styleProfile } from "./style_adherence.js";
import { readProjectStory } from "./story_loader.js";
import { applyStyle } from "../kit/core/style.mjs";
import { resolveStyleV2, writeStyleV2 } from "./style_store.js";

const list = (value) => (value === undefined || value === true ? [] : Array.isArray(value) ? value : [value]).map(String);

/** Draft a v3 pack (with a measured cadence profile, layout mix and caption treatment) from reference videos and images; writes style.json and reference-report.md. */
export async function createStyleFromReferences(name, flags = {}, { root, cwd = process.cwd() } = {}, adapters = {}) {
  const videos = list(flags["from-reference"]).map((file) => path.resolve(cwd, file));
  const images = list(flags["from-images"]).map((file) => path.resolve(cwd, file));
  if (!videos.length && !images.length) throw new Error("style create needs --from-reference <video ...> or --from-images <image ...>");
  for (const file of [...videos, ...images]) if (!existsSync(file)) throw new Error(`Reference not found: ${file}`);
  const references = [];
  for (const file of videos) references.push(await analyzeReference(file, {}, adapters));
  for (const file of images) references.push(await analyzeReference(file, { image: true }, adapters));
  const fontHints = list(flags["font-hint"]).flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
  const { pack, report, inferred } = draftStyleFromReferences(name, references, { fontHints, ...(flags.format && flags.format !== true ? { format: String(flags.format) } : {}), ...(flags.rights && flags.rights !== true ? { rights: String(flags.rights) } : {}) });
  const written = await writeStyleV2(pack, { root, cwd, force: Boolean(flags.force), files: { "reference-report.md": report } });
  return {
    stage: "style",
    action: "create",
    status: "drafted",
    name,
    path: written.path,
    files: written.files,
    references: references.map((entry) => entry.name),
    inferred: {
      colors: pack.brand.colors,
      grammar: inferred.grammar.grammar,
      ambient: inferred.ambient.level,
      captions: pack.captions,
      sfx_density: pack.sound.sfx_density,
      fonts: pack.brand.fonts,
      layout_mix: pack.reference_stats.layout_mix ?? null,
      layouts: pack.layouts,
      caption_treatment: pack.reference_stats.captions ?? null,
      profile: pack.profile ?? null
    },
    report: path.join(written.path, "reference-report.md"),
    warnings: written.warnings
  };
}

/** Find the render of a project to check: --video, else renders/final.mp4, renders/draft.mp4. */
export function projectRender(project, video) {
  if (video) return path.resolve(project, String(video));
  for (const candidate of ["renders/final.mp4", "renders/draft.mp4", "renders/hyperframes.mp4", "renders/remotion.mp4"]) {
    const file = path.join(project, candidate);
    if (existsSync(file)) return file;
  }
  throw new Error(`No render found in ${project}; pass --video <file> (looked for renders/final.mp4 and renders/draft.mp4)`);
}

/**
 * launchclip style check <project> --against <name>: measured stats vs the
 * pack's reference stats, plus the adherence checks (src/style_adherence.js)
 * when the project has a storyboard: palette, captions, layout mix, cadence
 * in the style's band and the brand frame. `finish` runs the same checks as
 * its style gate.
 */
export async function checkStyleCommand(projectPath, flags = {}, { root } = {}, adapters = {}) {
  const against = flags.against;
  if (!against || against === true) throw new Error("style check needs --against <style name|path>");
  const project = path.resolve(projectPath);
  const style = await resolveStyleV2(String(against), { projectDir: project, root });
  const video = projectRender(project, flags.video);
  const measured = await analyzeReference(video, {}, adapters);
  const comparison = compareToStyle(measured, style.pack);
  // The project's story, with this style merged where the story names none (or another).
  let read = null, storyError = null;
  try { read = await readProjectStory(project); }
  catch (error) { storyError = error.message; }
  const story = read ? (read.resolved.meta?.style?.name === style.name ? read.resolved : applyStyle({ ...read.resolved, meta: { ...read.resolved.meta, style: undefined } }, style.pack, { intro: false, outro: false }).story) : null;
  const adherence = story ? styleAdherence({ story, pack: style.pack, measured, profile: await styleProfile(style.pack) }) : null;
  const result = {
    stage: "style",
    action: "check",
    status: adherence ? (adherence.status === "failed" ? "drift" : "consistent") : comparison.status,
    style: style.name,
    style_source: style.source,
    video,
    reference_stats: Boolean(style.pack.reference_stats),
    metrics: comparison.metrics,
    ...(adherence ? { checks: adherence.checks } : {}),
    ...(storyError ? { story_error: storyError } : {}),
    measured: { palette: measured.palette.slice(0, 6), pacing: measured.pacing, energy: measured.energy, sound: measured.sound, captions: measured.captions ? { position: measured.captions.position, case: measured.captions.case } : null, layouts: measured.layouts?.mix ?? null }
  };
  if (flags.out && flags.out !== true) {
    const out = path.resolve(String(flags.out));
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, `${JSON.stringify(result, null, 2)}\n`);
    result.out = out;
  }
  return result;
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, realpath, link, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { probeMedia } from "./media_trim.js";
import { RECORDING_EDIT_VERSION } from "./recording_edit.js";
const execute = promisify(execFile);

/** Render accepted keep ranges with synchronized A/V; never overwrite source media. */
export async function editRecording(inputPath, outputPath, plan, options = {}, adapters = {}) {
  const input = await realpath(path.resolve(inputPath));
  const output = path.resolve(outputPath);
  let existing = null;
  try { existing = await realpath(output); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (input === output || input === existing) throw new Error("Recording edit output must differ from source");
  if (existing) throw new Error("Recording edit output already exists");
  const probe = await (adapters.probeMedia ?? probeMedia)(input);
  const duration = Number(probe.format?.duration);
  const video = probe.streams?.find((stream) => stream.codec_type === "video");
  const audio = probe.streams?.find((stream) => stream.codec_type === "audio");
  if (!video || !audio) throw new Error("Recording edit requires video and audio streams");
  validate(plan, duration);
  await mkdir(path.dirname(output), { recursive: true });
  const temporary = await mkdtemp(path.join(path.dirname(output), ".launchclip-edit-"));
  try {
    const filters = [];
    const inputs = [];
    for (const [index, segment] of plan.kept_segments.entries()) {
      const start = segment.source_start_seconds;
      const end = segment.source_end_seconds;
      filters.push(`[0:v:0]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${index}]`);
      filters.push(`[0:a:0]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${index}]`);
      inputs.push(`[v${index}][a${index}]`);
    }
    filters.push(`${inputs.join("")}concat=n=${inputs.length}:v=1:a=1[v][a]`);
    const filterPath = path.join(temporary, "filters.txt");
    await writeFile(filterPath, filters.join(";\n"));
    const rendered = path.join(temporary, "edited.mp4");
    const crf = options.crf ?? 18;
    if (!Number.isInteger(crf) || crf < 0 || crf > 51) throw new Error("crf must be an integer between 0 and 51");
    const args = ["-hide_banner", "-nostdin", "-i", input, "-filter_complex_script", filterPath, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", String(crf), "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", rendered];
    await (adapters.run ?? execute)("ffmpeg", args, { maxBuffer: 16 * 1024 * 1024 });
    await stat(rendered);
    const renderedProbe = await (adapters.probeMedia ?? probeMedia)(rendered);
    const renderedDuration = Number(renderedProbe.format?.duration);
    if (!Number.isFinite(renderedDuration) || Math.abs(renderedDuration - plan.duration_seconds) > 0.15) throw new Error("Rendered recording edit duration differs from plan");
    // A final existence check protects files created while rendering.
    try { await stat(output); throw new Error("Recording edit output was created while rendering"); } catch (error) { if (error.code !== "ENOENT") throw error; }
    await link(rendered, output);
    return { input, output, source_duration_seconds: duration, duration_seconds: plan.duration_seconds, rendered_duration_seconds: renderedDuration, kept_segments: plan.kept_segments.length, changed: plan.removed_segments.length > 0 };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

function validate(plan, duration) {
  if (plan?.schema_version !== RECORDING_EDIT_VERSION || !Array.isArray(plan.kept_segments) || !plan.kept_segments.length) throw new Error("Invalid recording edit plan");
  if (!Number.isFinite(duration) || Math.abs(plan.source_duration_seconds - duration) > 0.1) throw new Error("Recording edit plan does not match source duration");
  let prior = 0;
  let clock = 0;
  for (const segment of plan.kept_segments) {
    const { source_start_seconds: start, source_end_seconds: end, start_seconds: editStart, end_seconds: editEnd } = segment;
    if (![start, end, editStart, editEnd].every(Number.isFinite) || start < prior || end <= start || end > duration + 0.001 || Math.abs(editStart - clock) > 0.001 || Math.abs(editEnd - (clock + end - start)) > 0.001) throw new Error("Invalid recording edit segment timing");
    prior = end;
    clock = editEnd;
  }
  if (!Number.isFinite(plan.duration_seconds) || Math.abs(clock - plan.duration_seconds) > 0.001 || !Array.isArray(plan.removed_segments)) throw new Error("Invalid recording edit duration");
}

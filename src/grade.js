import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { GRADE_CUBE_SIZE, cubeText, gradeContrastLosses, mixCube, parseCube, presetCube, resolveGrade } from "@launchclip/core/grade.mjs";

const execFileAsync = promisify(execFile);

// The colour grade over a finished render (story.grade; kit/core/grade.mjs):
// the cube, strength mixed in, is written next to the finish state and the
// video goes once through ffmpeg lut3d. Both renderers' output takes the
// same pass, so the grade matches by construction.

export const GRADE_CUBE_FILE = ".launchclip/finish/grade.cube";

/** The story's cube (preset or the user's .cube, strength mixed in), or null. Throws on an unreadable .cube. */
export async function storyGradeCube(project, story) {
  const grade = resolveGrade(story);
  if (!grade) return null;
  const cube = grade.cube ? parseCube(await readFile(path.resolve(project, grade.cube), "utf8").catch(() => { throw new Error(`grade.cube not found: ${grade.cube}`); })) : presetCube(grade.preset, GRADE_CUBE_SIZE);
  return { grade, cube: mixCube(cube, grade.strength) };
}

/** Brand pairs the story's grade pushes under AA contrast, as warning lines. */
export function gradeWarnings(story, cube) {
  return gradeContrastLosses(cube, story?.brand?.colors ?? {}).map(({ fg, bg, before, after }) => `grade: brand ${fg} on ${bg} drops from ${before}:1 to ${after}:1 contrast after the grade; lower grade.strength or pick another preset`);
}

/** The ffmpeg arguments that grade `input` into `output` with `cube` (a file name in the working directory). */
export function gradeArgs(input, output, cube = "grade.cube") {
  // rgb24 in and bt709 back out, so the LUT sees the frame's own colours.
  const filter = `scale=in_color_matrix=bt709:in_range=tv,format=rgb24,lut3d=file=${cube}:interp=tetrahedral,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p`;
  return ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-map", "0", "-vf", filter, "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-c:a", "copy", "-movflags", "+faststart", output];
}

/** Grade `file` in place when the story asks for a grade. → {preset | cube, strength} or null */
export async function applyGrade(project, story, file, { ffmpeg = (args, options) => execFileAsync("ffmpeg", args, { maxBuffer: 1 << 24, ...options }) } = {}) {
  const graded = await storyGradeCube(project, story);
  if (!graded) return null;
  const cubeFile = path.join(project, GRADE_CUBE_FILE);
  await mkdir(path.dirname(cubeFile), { recursive: true });
  await writeFile(cubeFile, cubeText(graded.cube));
  const temporary = path.join(path.dirname(file), `.${path.basename(file, path.extname(file))}.grading${path.extname(file) || ".mp4"}`);
  // cwd is the cube's folder, so the filter names it without escaping a path.
  await ffmpeg(gradeArgs(path.resolve(file), path.resolve(temporary), path.basename(cubeFile)), { cwd: path.dirname(cubeFile) });
  await rename(temporary, file);
  return graded.grade;
}

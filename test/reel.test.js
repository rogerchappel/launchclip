// launchclip reel (src/reel.js) on disk: an animation project's artefacts
// become the layers (bible sheet, animatic frame, final), the shot's frames
// are cut for the play, the written story resolves, and the seam check tells
// a clean loop from a jump. Drives FFmpeg, so it runs with the media tests.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mediaSkip } from "./helpers/media.js";
import { loopSeam, runReel } from "../src/reel.js";

const ffmpeg = (...args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"]); return true; } catch { return false; } })();
const brand = { colors: { bg: "#06070d", primary: "#fdb022", accent: "#46d4ff", ink: "#06070d", paper: "#f2eee6" }, fonts: { display: "anton", body: "space-grotesk", meta: "jetbrains-mono" } };

test("an animation project breaks down into its bible sheet, animatic and final, and the seam check tells a loop from a jump", { skip: mediaSkip(hasFfmpeg ? false : "needs ffmpeg") }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-reel-"));
  try {
    const project = path.join(dir, "show");
    await mkdir(path.join(project, "renders"), { recursive: true });
    await mkdir(path.join(project, "bible", "sheets"), { recursive: true });
    const story = { schema: "launchclip.story.v1", title: "Show", lane: "motion", format: { width: 540, height: 960, fps: 30, duration: 6 }, brand, scenes: [{ id: "s1", module: "kinetic-words", start: 0, end: 6, params: { title: "One" } }] };
    await writeFile(path.join(project, "storyboard.json"), JSON.stringify(story));
    await writeFile(path.join(project, "BIBLE.json"), JSON.stringify({ cast: { characters: [{ id: "nova", sheet: "bible/sheets/nova.png" }] } }));
    ffmpeg("-f", "lavfi", "-i", "color=c=0x334455:s=800x450", "-frames:v", "1", path.join(project, "bible", "sheets", "nova.png"));
    for (const name of ["final", "animatic"]) ffmpeg("-f", "lavfi", "-i", "testsrc2=s=540x960:r=30:d=6", "-pix_fmt", "yuv420p", path.join(project, "renders", `${name}.mp4`));

    const result = await runReel(project, { at: 4 });
    assert.equal(result.kind, "animation");
    assert.deepEqual(result.layers, ["Bible", "Animatic", "Final"]);
    const reel = JSON.parse(await readFile(path.join(result.out, "storyboard.json"), "utf8"));
    assert.equal(reel.format.duration, 10);
    const params = reel.scenes[0].params;
    assert.equal(params.layers[0].fit, "contain");
    assert.equal(params.play.length, 45, "1.5 s of the shot at 30 fps");
    for (const file of [...params.play, ...params.layers.map((l) => l.image)]) assert.ok(existsSync(path.join(result.out, file)), file);
    await assert.rejects(runReel(project, {}), /--force/);

    // A video whose last frame is its first passes; a moving one does not.
    const still = path.join(dir, "still.mp4"), moving = path.join(dir, "moving.mp4");
    ffmpeg("-loop", "1", "-i", path.join(result.out, "assets", "layers", "final.jpg"), "-t", "1", "-r", "30", "-pix_fmt", "yuv420p", still);
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=540x960:r=30:d=1", "-pix_fmt", "yuv420p", moving);
    assert.equal((await loopSeam(still)).status, "passed");
    assert.equal((await loopSeam(moving)).status, "failed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

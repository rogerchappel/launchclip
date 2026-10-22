import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { SHARED_SCRIPTS, renderTemplate, syncSkills } from "../scripts/sync-skills.mjs";

const root = path.resolve(import.meta.dirname, "..");
const run = promisify(execFile);

test("generated create-video skills match skills-src (npm run skills:check)", async () => {
  const { stdout } = await run(process.execPath, [path.join(root, "scripts/sync-skills.mjs"), "--check"], { cwd: root });
  assert.match(stdout, /in sync/);
});

test("templates resolve includes and renderer blocks per renderer", async () => {
  const srcRoot = await mkdtemp(path.join(os.tmpdir(), "launchclip-skills-src-"));
  try {
    await mkdir(path.join(srcRoot, "shared"));
    await mkdir(path.join(srcRoot, "renderers/hyperframes"), { recursive: true });
    await mkdir(path.join(srcRoot, "renderers/remotion"), { recursive: true });
    await writeFile(path.join(srcRoot, "shared/a.md"), "shared\n<!-- renderer: remotion -->\nonly remotion\n<!-- /renderer -->\n");
    await writeFile(path.join(srcRoot, "renderers/hyperframes/p.md"), "hf partial\n");
    await writeFile(path.join(srcRoot, "renderers/remotion/p.md"), "rm partial\n");
    await writeFile(
      path.join(srcRoot, "main.md"),
      "top\n<!-- include: shared/a.md -->\n<!-- include: renderers/{renderer}/p.md -->\n<!-- renderer: hyperframes|remotion -->\nboth\n<!-- /renderer -->\nend\n"
    );
    assert.equal(renderTemplate("main.md", "hyperframes", { srcRoot }), "top\nshared\nhf partial\nboth\nend\n");
    assert.equal(renderTemplate("main.md", "remotion", { srcRoot }), "top\nshared\nonly remotion\nrm partial\nboth\nend\n");

    await writeFile(path.join(srcRoot, "open.md"), "<!-- renderer: remotion -->\nx\n");
    assert.throws(() => renderTemplate("open.md", "remotion", { srcRoot }), /never closed/);
    await writeFile(path.join(srcRoot, "bad.md"), "<!-- renderer: skia -->\nx\n<!-- /renderer -->\n");
    assert.throws(() => renderTemplate("bad.md", "remotion", { srcRoot }), /unknown renderer/);
    await writeFile(path.join(srcRoot, "loop.md"), "<!-- include: loop.md -->\n");
    assert.throws(() => renderTemplate("loop.md", "remotion", { srcRoot }), /include cycle/);
    await writeFile(path.join(srcRoot, "typo.md"), "<!-- include:shared/a.md -->\n");
    assert.throws(() => renderTemplate("typo.md", "remotion", { srcRoot }), /malformed directive/);
  } finally {
    await rm(srcRoot, { recursive: true, force: true });
  }
});

test("sync copies kit core into both skills and the Remotion kit into assets", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-skills-sync-"));
  try {
    await cp(path.join(root, "skills-src"), path.join(temp, "skills-src"), { recursive: true });
    await cp(path.join(root, "skills/launchclip-create-video"), path.join(temp, "skills/launchclip-create-video"), { recursive: true });
    await mkdir(path.join(temp, "kit/core"), { recursive: true });
    await mkdir(path.join(temp, "kit/remotion/modules"), { recursive: true });
    await writeFile(path.join(temp, "kit/core/motion.mjs"), "export const ease = {};\n");
    await writeFile(path.join(temp, "kit/remotion/entry.tsx"), "// entry\n");
    await writeFile(path.join(temp, "kit/remotion/modules/Metric.tsx"), "// metric\n");

    const first = syncSkills({ root: temp });
    assert.ok(first.changed.length > 0);
    const remotion = path.join(temp, "skills/launchclip-create-video-remotion");
    assert.equal(await readFile(path.join(remotion, "assets/remotion-kit/modules/Metric.tsx"), "utf8"), "// metric\n");
    assert.equal(await readFile(path.join(remotion, "assets/core/motion.mjs"), "utf8"), "export const ease = {};\n");
    assert.equal(await readFile(path.join(remotion, "scripts/motion.mjs"), "utf8"), "export const ease = {};\n");
    assert.equal(await readFile(path.join(temp, "skills/launchclip-create-video/scripts/motion.mjs"), "utf8"), "export const ease = {};\n");
    for (const script of SHARED_SCRIPTS) {
      assert.deepEqual(
        await readFile(path.join(remotion, "scripts", script)),
        await readFile(path.join(root, "skills/launchclip-create-video/scripts", script))
      );
    }
    assert.deepEqual(syncSkills({ root: temp, check: true }).changed, []);

    await writeFile(path.join(remotion, "references/stale.md"), "old\n");
    await writeFile(path.join(remotion, "SKILL.md"), "edited by hand\n");
    const drift = syncSkills({ root: temp, check: true }).changed;
    assert.deepEqual(
      drift.map((entry) => `${entry.action} ${entry.path}`).sort(),
      [
        "delete skills/launchclip-create-video-remotion/references/stale.md",
        "write skills/launchclip-create-video-remotion/SKILL.md"
      ]
    );
    syncSkills({ root: temp });
    assert.deepEqual(syncSkills({ root: temp, check: true }).changed, []);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("Remotion skill mirrors the cinematic contract with the Remotion runtime", async () => {
  const dir = path.join(root, "skills/launchclip-create-video-remotion");
  const quick = await readFile(path.join(dir, "SKILL.md"), "utf8");
  // SKILL.md carries the quick path; references/workflow.md the full workflow.
  const skill = `${quick}\n${await readFile(path.join(dir, "references/workflow.md"), "utf8")}`;
  assert.match(quick, /launchclip cinematic-check <project> --renderer remotion/);
  const runtime = await readFile(path.join(dir, "references/standalone-remotion.md"), "utf8");
  const reference = await readFile(path.join(dir, "references/cinematic-production.md"), "utf8");
  const metadata = await readFile(path.join(dir, "agents/openai.yaml"), "utf8");

  assert.match(skill, /^---\nname: launchclip-create-video-remotion\n/);
  assert.match(skill, /storyboard\.json is the primary artefact/);
  assert.doesNotMatch(skill, /\bstory\.json/);
  for (const artifact of ["CONCEPTS.json", "STORY.json", "NARRATION.json", "AUDIO-MANIFEST.json", "CINEMATIC-READINESS.json"]) {
    assert.match(skill, new RegExp(artifact.replace(".", "\\.")));
  }
  assert.match(skill, /Do not run `launchclip produce`/);
  assert.match(skill, /launchclip cinematic-check --renderer remotion/);
  assert.match(skill, /references\/standalone-remotion\.md/);
  assert.doesNotMatch(skill, /standalone-hyperframes|hyperframes@|data-launchclip-cinematic-contract/);
  assert.match(reference, /Generate exactly five complete treatments/);
  assert.match(reference, /--renderer remotion/);
  assert.match(reference, /hook-001-browser-still/);
  assert.doesNotMatch(reference, /hyperframes@/);

  for (const pin of ["remotion@4.0.536", "@remotion/cli@4.0.536", "react@19.3.1"]) assert.ok(runtime.includes(pin), pin);
  assert.match(runtime, /LaunchclipStory/);
  assert.match(runtime, /useCurrentFrame\(\)/);
  assert.match(runtime, /premountFor/);
  assert.match(runtime, /TransitionSeries/);
  assert.match(runtime, /staticFile\(/);
  assert.match(runtime, /WordCaptions/);
  assert.match(runtime, /remotion\/modules\//);
  assert.match(runtime, /launchclip layout-check/);
  assert.match(runtime, /npx remotion studio/);
  assert.match(runtime, /hook: `0,0\.25,0\.5,0\.75,1,1\.5,2,3,4`/);
  assert.match(runtime, /launchclip\.subscription-temporal-evidence\.v1/);
  assert.match(runtime, /## Known failure modes and repairs/);
  assert.match(metadata, /\$launchclip-create-video-remotion/);

  for (const generated of ["SKILL.md", "references", "agents"]) {
    const text = await readFile(path.join(dir, generated === "SKILL.md" ? generated : `${generated}/${generated === "agents" ? "openai.yaml" : "recorded-video.md"}`), "utf8");
    assert.doesNotMatch(text, /<!-- (include|renderer|\/renderer)/);
  }
});

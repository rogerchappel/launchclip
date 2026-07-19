import assert from "node:assert/strict";
import { lstat, mkdtemp, mkdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/cli.js";
import { installBundledSkills } from "../src/skill_install.js";

const packageRoot = path.resolve(import.meta.dirname, "..");

test("CLI lists bundled skills and resolves a selected skill path", async () => {
  const listed = await cliJson(["skills", "list"]);
  assert.deepEqual(listed.skills.map((skill) => skill.name), ["launchclip-create-video", "launchclip-cli"]);
  assert.deepEqual(listed.agents.map((agent) => agent.name), ["codex", "claude"]);

  const resolved = await cliJson(["skills", "path", "launchclip-create-video"]);
  assert.equal(resolved.path, path.join(packageRoot, "skills", "launchclip-create-video"));
});

test("installs all bundled skills for Codex and is idempotent", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "launchclip-codex-skills-"));
  try {
    const first = await installBundledSkills({ agent: "codex", home, packageRoot });
    assert.equal(first.root, path.join(home, ".agents", "skills"));
    assert.deepEqual(first.skills.map((skill) => skill.status), ["installed", "installed"]);

    for (const skill of first.skills) {
      assert.equal((await lstat(skill.destination)).isSymbolicLink(), true);
      assert.equal(await readlink(skill.destination), skill.source);
    }

    const second = await installBundledSkills({ agent: "codex", home, packageRoot });
    assert.deepEqual(second.skills.map((skill) => skill.status), ["already-installed", "already-installed"]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("installs a selected skill for Claude", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "launchclip-claude-skills-"));
  try {
    const result = await cliJson(
      ["skills", "install", "--agent", "claude", "--skill", "launchclip-create-video"],
      { home, packageRoot }
    );
    assert.equal(result.root, path.join(home, ".claude", "skills"));
    assert.equal(result.invocation, "/launchclip-create-video");
    assert.deepEqual(result.skills.map((skill) => skill.name), ["launchclip-create-video"]);
    assert.equal((await lstat(result.skills[0].destination)).isSymbolicLink(), true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("preflights every destination and refuses unrelated content", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "launchclip-conflict-skills-"));
  const root = path.join(home, ".agents", "skills");
  const conflict = path.join(root, "launchclip-cli");
  try {
    await mkdir(conflict, { recursive: true });
    await writeFile(path.join(conflict, "SKILL.md"), "user-owned\n");

    await assert.rejects(
      () => installBundledSkills({ agent: "codex", home, packageRoot }),
      /not managed by LaunchClip/
    );
    await assert.rejects(() => lstat(path.join(root, "launchclip-create-video")), /ENOENT/);
    assert.equal(await readFile(path.join(conflict, "SKILL.md"), "utf8"), "user-owned\n");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("rejects unsupported agents and skills", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "launchclip-invalid-skills-"));
  try {
    await assert.rejects(() => installBundledSkills({ agent: "cursor", home, packageRoot }), /Use codex or claude/);
    await assert.rejects(() => installBundledSkills({ agent: "claude", skill: "missing", home, packageRoot }), /Unknown bundled skill/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("refreshes a managed symlink after the installed package moves", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "launchclip-stale-skills-"));
  const root = path.join(home, ".claude", "skills");
  const destination = path.join(root, "launchclip-cli");
  try {
    await mkdir(root, { recursive: true });
    await symlink(path.join(home, "old-package", "skills", "launchclip-cli"), destination, "dir");

    await assert.rejects(
      () => installBundledSkills({ agent: "claude", skill: "launchclip-cli", home, packageRoot }),
      /Re-run with --force/
    );
    assert.equal(await readlink(destination), path.join(home, "old-package", "skills", "launchclip-cli"));

    const result = await cliJson(
      ["skills", "install", "--agent", "claude", "--skill", "launchclip-cli", "--force"],
      { home, packageRoot }
    );
    assert.equal(result.skills[0].status, "updated");
    assert.equal(await readlink(destination), path.join(packageRoot, "skills", "launchclip-cli"));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

async function cliJson(argv, skillOptions) {
  const output = [];
  await runCli(argv, {
    stdout: { write: (value) => output.push(value) },
    skillOptions
  });
  return JSON.parse(output.join(""));
}

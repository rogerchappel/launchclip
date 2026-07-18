import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildIntake } from "../src/intake.js";
import { createStylePack, listStylePacks, loadStylePack, projectStyleRoot, resolveStylePack, STYLE_PACK_SCHEMA_VERSION } from "../src/style_store.js";

test("creates a user-owned style pack from a video project", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-style-pack-"));
  const source = path.join(cwd, "video");
  try {
    await mkdir(path.join(source, ".hyperframes"), { recursive: true });
    await mkdir(path.join(source, "style", "fonts"), { recursive: true });
    await mkdir(path.join(source, "style", "assets"), { recursive: true });
    await writeFile(path.join(source, "frame.md"), "# User-authored AI news style\n");
    await writeFile(path.join(source, ".hyperframes", "caption-skin.html"), "<template>captions</template>\n");
    await writeFile(path.join(source, "style", "frame.md"), "# Previous generation\n");
    await writeFile(path.join(source, "style", "fonts", "Editorial.ttf"), "font fixture");
    await writeFile(path.join(source, "style", "assets", "texture.svg"), "<svg/>\n");
    await writeFile(path.join(source, "style", "audio.md"), "Use restrained chiptune accents.\n");
    await writeFile(path.join(source, "style", "style.json"), `${JSON.stringify({
      schema_version: STYLE_PACK_SCHEMA_VERSION,
      name: "previous-style",
      files: { specification: "frame.md", caption_skin: null, fonts: "fonts", assets: "assets" }
    }, null, 2)}\n`);

    const created = await createStylePack("ai-news", { cwd, from: source });
    assert.equal(created.path, path.join(cwd, ".launchclip", "styles", "ai-news"));
    assert.deepEqual(created.files, ["style.json", "frame.md", "caption-skin.html", "fonts/", "assets/", "audio.md"]);

    const manifest = JSON.parse(await readFile(path.join(created.path, "style.json"), "utf8"));
    assert.equal(manifest.schema_version, STYLE_PACK_SCHEMA_VERSION);
    assert.equal(manifest.name, "ai-news");
    assert.equal(manifest.source.kind, "video-project");
    assert.equal(await readFile(path.join(created.path, "frame.md"), "utf8"), "# User-authored AI news style\n");
    assert.equal(await readFile(path.join(created.path, "assets", "texture.svg"), "utf8"), "<svg/>\n");
    assert.equal(await readFile(path.join(created.path, "audio.md"), "utf8"), "Use restrained chiptune accents.\n");

    const loaded = await loadStylePack(created.path);
    assert.equal(loaded.name, "ai-news");
    assert.match(loaded.specification, /User-authored/);
    assert.equal(loaded.fonts.length, 1);
    assert.equal((await listStylePacks({ cwd }))[0].name, "ai-news");
    assert.equal((await resolveStylePack("ai-news", { cwd })).path, created.path);
    assert.equal((await resolveStylePack(created.path, { cwd })).path, created.path);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("does not invent styles or overwrite a pack without explicit force", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-style-guards-"));
  const source = path.join(cwd, "video");
  try {
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, "DESIGN.md"), "# Design\n");
    await assert.rejects(createStylePack("ai-news", { cwd }), /does not invent a preset/);
    await assert.rejects(createStylePack("../escape", { cwd, from: source }), /cannot contain a path/);
    await createStylePack("ai-news", { cwd, from: source });
    await assert.rejects(createStylePack("ai-news", { cwd, from: source }), /already exists/);
    assert.equal(await resolveStylePack("unregistered-family", { cwd }), null);
    assert.equal(projectStyleRoot({ cwd }), path.join(cwd, ".launchclip", "styles"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("intake resolves a named project style before treating the name as a family", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-style-intake-"));
  const source = path.join(cwd, "video");
  const styleRoot = path.join(cwd, ".launchclip", "styles");
  try {
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, "frame.md"), "# Persistent channel style\n");
    await createStylePack("ai-news", { cwd, from: source });
    const intake = await buildIntake("AI update", { kind: "topic", style: "ai-news", "style-root": styleRoot, out: path.join(cwd, "workspace") }, {});
    assert.equal(intake.brief.style.family, "ai-news");
    assert.equal(intake.brief.style.source, "file");
    assert.equal(intake.brief.style.pack_path, path.join(styleRoot, "ai-news"));
    assert.match(intake.brief.style.specification, /Persistent channel style/);

    const freeForm = await buildIntake("AI update", { kind: "topic", style: "retro-terminal", "style-root": styleRoot, out: path.join(cwd, "fallback-workspace") }, {});
    assert.equal(freeForm.brief.style.family, "retro-terminal");
    assert.equal(freeForm.brief.style.source, "preset");
    assert.equal(freeForm.brief.style.specification, null);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

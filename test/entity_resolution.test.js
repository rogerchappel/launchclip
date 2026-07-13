import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BRAND_LIBRARY_VERSION, resolveProductionEntities } from "../src/entity_resolution.js";

test("maps an ASR alias to canonical display copy and a reusable local logo", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "launchclip-entities-"));
  const workspace = path.join(root, "workspace");
  const brandAssets = path.join(root, "brand-assets");
  const logo = path.join(brandAssets, "refiant", "logo.svg");
  await mkdir(path.dirname(logo), { recursive: true });
  await mkdir(path.join(workspace, "production"), { recursive: true });
  await writeFile(logo, "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>");
  await writeFile(path.join(brandAssets, "brands.json"), JSON.stringify({
    schema_version: BRAND_LIBRARY_VERSION,
    brands: [{
      id: "refiant",
      canonical_name: "Refiant AI",
      display_name: "Refiant",
      aliases: ["Refiant"],
      asr_aliases: ["Refine"],
      domains: ["refiant.ai"],
      assets: [{ kind: "logo", path: "refiant/logo.svg", variant: "default" }]
    }]
  }));
  await writeFile(path.join(workspace, "production", "intake.json"), JSON.stringify({ resources: [] }));
  await writeFile(path.join(workspace, "production", "evidence.json"), JSON.stringify({
    items: [{ id: "voice", kind: "voiceover-transcript", title: "Transcript", content: "Refine shipped a ten million token model.", provenance: "source.mov", sha256: null, claims_allowed: false, truncated: false, metadata: [] }]
  }));

  const result = await resolveProductionEntities(workspace, { brandAssetsDir: brandAssets });
  const intake = JSON.parse(await readFile(path.join(workspace, "production", "intake.json"), "utf8"));
  const evidence = JSON.parse(await readFile(path.join(workspace, "production", "evidence.json"), "utf8"));
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].canonical_name, "Refiant AI");
  assert.equal(result.matches[0].spoken_form, "refine");
  assert.equal(result.matches[0].match_kind, "asr-alias");
  assert.equal(result.matches[0].assets[0].id, "brand-refiant-logo-default");
  assert.equal(intake.resources[0].source, "brand-library");
  assert.match(evidence.items.find((entry) => entry.id === "canonical-entities").content, /refine => Refiant/);
});

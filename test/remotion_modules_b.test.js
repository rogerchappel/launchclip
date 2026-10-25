// Batch B editorial components for Remotion (kit/remotion/modules/registry-b.ts):
// the registry lists every owned kind, and each kind renders a real still
// through the ModuleReview test entry (skipped when Chrome is unavailable).
// LAUNCHCLIP_PARITY=1 also runs scripts/parity-b.mjs on the b-*.json fixtures.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolveEditorialModule } from "../kit/core/editorial-core.mjs";
import { mediaSkip } from "./helpers/media.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODULES = path.join(ROOT, "kit", "remotion", "modules");
const ENTRY = path.join(ROOT, "test", "fixtures", "parity-entry-b", "entry.tsx");
const FIXTURES = path.join(ROOT, "test", "fixtures", "parity");
const KINDS = {
  "media-window": "MediaWindow",
  "code-snippet": "CodeSnippet",
  "excerpt-window": "ExcerptWindow",
  "focus-flow": "FocusFlow",
  "date-card": "DateCard",
  "status-rack": "StatusRack",
  "audience-grid": "AudienceGrid"
};

async function fixtures() {
  const names = (await readdir(FIXTURES)).filter((name) => /^b-(?!cat-).*\.json$/.test(name)).sort();
  return Promise.all(names.map(async (name) => ({ name, ...JSON.parse(await readFile(path.join(FIXTURES, name), "utf8")) })));
}

function specOf({ story, sceneId }) {
  const scene = story.scenes.find((entry) => entry.id === sceneId);
  const { width, height } = story.format;
  return { scene, spec: { ...scene.params, id: scene.id, kind: scene.module, aspect: width > height ? "16:9" : "9:16", start: scene.start, duration: scene.end - scene.start } };
}

test("registry-b exports a component for every batch B kind", async () => {
  const source = await readFile(path.join(MODULES, "registry-b.ts"), "utf8");
  assert.match(source, /export const COMPONENTS: Record<string, React\.FC<\{ model: any \}>>/);
  const entries = [...source.matchAll(/^\s+"([a-z-]+)": ([A-Za-z]+),?$/gm)].map(([, kind, name]) => [kind, name]);
  assert.deepEqual(Object.fromEntries(entries), KINDS);
  for (const name of Object.values(KINDS)) {
    assert.match(source, new RegExp(`import \\{ ${name} \\} from "\\./${name}";`));
    const component = await readFile(path.join(MODULES, `${name}.tsx`), "utf8");
    assert.match(component, new RegExp(`export const ${name}: React\\.FC<\\{ model: Model \\}>`));
    // Frame-pure: no animation state, clocks or randomness.
    assert.doesNotMatch(component, /useState|useEffect|Date\.now|Math\.random/);
  }
});

test("parity fixtures cover every batch B kind and resolve", async () => {
  const all = await fixtures();
  const kinds = new Set();
  for (const fixture of all) {
    const model = resolveEditorialModule(specOf(fixture).spec);
    kinds.add(model.kind);
    if (fixture.threshold) assert.ok(fixture.threshold.ssim >= 0.93, `${fixture.name} threshold below 0.93`);
  }
  assert.deepEqual([...kinds].sort(), Object.keys(KINDS).sort());
});

test("every batch B kind renders a real Remotion still", { skip: mediaSkip(), timeout: 600_000 }, async (t) => {
  try {
    const { ensureBrowser } = await import("@remotion/renderer");
    await ensureBrowser();
  } catch (error) {
    t.skip(`Chrome Headless Shell is unavailable: ${error.message}`);
    return;
  }
  let ffmpeg = true;
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); } catch { ffmpeg = false; }
  const { bundle } = await import("@remotion/bundler");
  const { renderStill, selectComposition } = await import("@remotion/renderer");
  const serveUrl = await bundle({ entryPoint: ENTRY, publicDir: FIXTURES, onProgress: () => {} });
  const out = await mkdtemp(path.join(os.tmpdir(), "launchclip-modules-b-"));
  try {
    const rendered = new Set();
    for (const fixture of await fixtures()) {
      const { scene, spec } = specOf(fixture);
      const model = resolveEditorialModule(spec);
      if (rendered.has(model.kind)) continue;
      rendered.add(model.kind);
      const inputProps = { scene, story: fixture.story };
      const composition = await selectComposition({ serveUrl, id: "ModuleReview", inputProps });
      assert.equal(composition.width, fixture.story.format.width);
      assert.equal(composition.durationInFrames, Math.round((scene.end - scene.start) * fixture.story.format.fps));
      // A settled frame: after the last event, before the exit.
      const last = Math.max(...model.events.map((event) => event.time));
      const frame = Math.round((Math.min(last + 0.2, model.motion.exitStart - 0.05) - scene.start) * composition.fps);
      const file = path.join(out, `${model.kind}.png`);
      await renderStill({ composition, serveUrl, output: file, frame, inputProps, imageFormat: "png", overwrite: true });
      const png = await readFile(file);
      assert.equal(png.subarray(1, 4).toString("ascii"), "PNG", model.kind);
      assert.equal(png.readUInt32BE(16), fixture.story.format.width);
      if (!ffmpeg) continue;
      // The module rect is drawn: its average colour differs from the background.
      const r = model.rect;
      const pixel = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-vf", `crop=${r.width}:${r.height}:${r.x}:${r.y},scale=1:1:flags=area`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
      const bg = fixture.story.brand.colors.bg.match(/[0-9a-f]{2}/gi).map((hex) => parseInt(hex, 16));
      const distance = [...pixel].reduce((sum, value, i) => sum + Math.abs(value - bg[i]), 0);
      assert.ok(distance > 6, `${model.kind} rect looks empty (rgb ${[...pixel]} vs bg ${bg})`);
    }
    assert.deepEqual([...rendered].sort(), Object.keys(KINDS).sort());
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("batch B parity fixtures match HyperFrames (LAUNCHCLIP_PARITY=1)", { timeout: 1_800_000 }, async (t) => {
  if (process.env.LAUNCHCLIP_PARITY !== "1") {
    t.skip("set LAUNCHCLIP_PARITY=1 to run the HyperFrames/Remotion parity check");
    return;
  }
  assert.ok(existsSync(path.join(ROOT, "node_modules", ".bin", "hyperframes")), "hyperframes CLI is required");
  const { parity } = await import("../scripts/parity-b.mjs");
  const out = await mkdtemp(path.join(os.tmpdir(), "launchclip-parity-b-"));
  try {
    for (const fixture of await fixtures()) {
      const report = await parity(path.join(FIXTURES, fixture.name), { out });
      assert.ok(report.pass, `${fixture.name}: ${report.samples.filter((s) => !s.pass).map((s) => `${s.label} ${s.ssim.toFixed(4)}`).join(", ")}`);
    }
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

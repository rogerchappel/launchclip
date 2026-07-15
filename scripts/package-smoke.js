import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = await mkdtemp(path.join(tmpdir(), "launchclip-package-"));

try {
  const packed = await run("npm", ["pack", "--json", "--pack-destination", temp], packageRoot);
  const [artifact] = JSON.parse(packed.stdout);
  if (!artifact?.filename) throw new Error("npm pack did not report a tarball.");

  const expectedFiles = [
    ".codex-plugin/plugin.json",
    "bin/launchclip.js",
    "examples/motion/golden-timeline.json",
    "motion-engine/schema.js",
    "public/icons/check.svg",
    "remotion/index.jsx",
    "skills/launchclip-cli/SKILL.md",
    "skills/launchclip-create-video/SKILL.md"
  ];
  const packedFiles = new Set(artifact.files.map((entry) => entry.path));
  const missing = expectedFiles.filter((file) => !packedFiles.has(file));
  if (missing.length) throw new Error(`Packed artifact is missing: ${missing.join(", ")}`);

  const packageMetadata = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const pluginMetadata = JSON.parse(await readFile(path.join(packageRoot, ".codex-plugin", "plugin.json"), "utf8"));
  if (pluginMetadata.version !== packageMetadata.version) {
    throw new Error(`Plugin version ${pluginMetadata.version} does not match package version ${packageMetadata.version}.`);
  }

  const source = path.join(temp, "fixture-source");
  const consumer = path.join(temp, "consumer");
  const workspace = path.join(temp, "workspace");
  await mkdir(source, { recursive: true });
  await mkdir(consumer, { recursive: true });
  await writeFile(path.join(source, "README.md"), "# Packed LaunchClip fixture\n");
  await writeFile(path.join(source, "package.json"), `${JSON.stringify({ name: "packed-launchclip-fixture", version: "1.0.0" }, null, 2)}\n`);
  await writeFile(path.join(consumer, "package.json"), `${JSON.stringify({ name: "launchclip-consumer", private: true }, null, 2)}\n`);

  const tarball = path.join(temp, artifact.filename);
  await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], consumer);

  const bin = path.join(consumer, "node_modules", ".bin", "launchclip");
  await access(bin, constants.X_OK);
  const help = await run(bin, ["--help"], consumer);
  if (!help.stdout.includes("launchclip creates")) throw new Error("Installed CLI help output was not recognized.");
  await run(bin, ["init", source, "--out", workspace], consumer);
  await access(path.join(workspace, "launchclip.json"));

  console.log(`package smoke ok: ${artifact.name}@${artifact.version} (${artifact.entryCount} files)`);
} finally {
  await rm(temp, { recursive: true, force: true });
}

async function run(command, args, cwd) {
  return execFileAsync(command, args, { cwd, maxBuffer: 1024 * 1024 * 32 });
}

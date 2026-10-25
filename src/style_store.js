import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STYLE_SCHEMA, STYLE_V2_SCHEMA, upgradeV1Pack, upgradeV2Pack, validateStylePack } from "../kit/core/style.mjs";

export const STYLE_PACK_SCHEMA_VERSION = "launchclip.style-pack.v1";
export const STYLE_PACK_V2_SCHEMA = STYLE_SCHEMA;
/** Built-in starter styles (kit/styles/<name>.json). */
export const BUILTIN_STYLE_ROOT = fileURLToPath(new URL("../kit/styles", import.meta.url));

const SPECIFICATION_CANDIDATES = ["frame.md", "FRAME.md", "DESIGN.md", "design.md"];
const CAPTION_CANDIDATES = ["caption-skin.html", path.join(".hyperframes", "caption-skin.html")];
const OPTIONAL_TEXT_FILES = ["audio.md", "audio.yaml", "audio.yml"];

export function projectStyleRoot(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  return path.resolve(options.root ?? path.join(cwd, ".launchclip", "styles"));
}

export function stylePackPath(name, options = {}) {
  return path.join(projectStyleRoot(options), validateStyleName(name));
}

export async function createStylePack(name, options = {}) {
  const styleName = validateStyleName(name);
  const sourceValue = String(options.from ?? "").trim();
  if (!sourceValue) throw new Error("Creating a style pack requires --from <video-or-style-directory>; LaunchClip does not invent a preset");
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const source = path.resolve(cwd, sourceValue);
  if (!existsSync(source) || !(await stat(source)).isDirectory()) throw new Error(`Style source directory does not exist: ${sourceValue}`);

  const root = projectStyleRoot({ cwd, root: options.root });
  const destination = stylePackPath(styleName, { cwd, root });
  if (existsSync(destination) && !options.force) throw new Error(`Style pack already exists: ${styleName}. Pass --force to replace it`);

  const sourcePack = await loadStylePack(source, { requireManifest: false }).catch(() => null);
  const embeddedPack = sourcePack?.manifest
    ? null
    : await loadStylePack(path.join(source, "style"), { requireManifest: true }).catch(() => null);
  const inheritedPack = sourcePack?.manifest ? sourcePack : embeddedPack;
  const specificationSource = sourcePack?.specification_path ?? findExisting(source, SPECIFICATION_CANDIDATES);
  if (!specificationSource) throw new Error(`Style source has no frame.md or DESIGN.md: ${sourceValue}`);

  await mkdir(root, { recursive: true });
  const staging = await mkdtemp(path.join(root, `.${styleName}-`));
  try {
    await copyFile(specificationSource, path.join(staging, "frame.md"));
    const copied = ["frame.md"];

    const captionSource = sourcePack?.caption_skin_path ?? embeddedPack?.caption_skin_path ?? findExisting(source, CAPTION_CANDIDATES);
    if (captionSource) {
      await copyFile(captionSource, path.join(staging, "caption-skin.html"));
      copied.push("caption-skin.html");
    }

    const fontsSource = findDirectory(source, ["fonts", path.join("assets", "fonts")])
      ?? findDirectory(inheritedPack?.path ?? source, ["fonts", path.join("assets", "fonts")]);
    if (fontsSource) {
      await cp(fontsSource, path.join(staging, "fonts"), { recursive: true, errorOnExist: true });
      copied.push("fonts/");
    }

    if (inheritedPack?.manifest) {
      const assetsSource = findDirectory(inheritedPack.path, ["assets"]);
      if (assetsSource) {
        await cp(assetsSource, path.join(staging, "assets"), { recursive: true, errorOnExist: true });
        copied.push("assets/");
      }
    }

    for (const file of OPTIONAL_TEXT_FILES) {
      const localSource = path.join(source, file);
      const inheritedSource = inheritedPack ? path.join(inheritedPack.path, file) : null;
      const optionalSource = existsSync(localSource) ? localSource : inheritedSource;
      if (!optionalSource || !existsSync(optionalSource) || !(await stat(optionalSource)).isFile()) continue;
      await copyFile(optionalSource, path.join(staging, file));
      copied.push(file);
    }

    const manifest = {
      schema_version: STYLE_PACK_SCHEMA_VERSION,
      name: styleName,
      created_at: new Date().toISOString(),
      source: { kind: sourcePack?.manifest ? "style-pack" : "video-project", label: path.basename(source) },
      files: {
        specification: "frame.md",
        caption_skin: copied.includes("caption-skin.html") ? "caption-skin.html" : null,
        fonts: copied.includes("fonts/") ? "fonts" : null,
        assets: copied.includes("assets/") ? "assets" : null
      }
    };
    await writeFile(path.join(staging, "style.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    copied.unshift("style.json");

    if (existsSync(destination)) await rm(destination, { recursive: true, force: true });
    await rename(staging, destination);
    return { stage: "style", action: "create", status: "ready", name: styleName, path: destination, files: copied };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export async function loadStylePack(location, options = {}) {
  const packPath = path.resolve(location);
  if (!existsSync(packPath) || !(await stat(packPath)).isDirectory()) throw new Error(`Style pack directory does not exist: ${location}`);
  const manifestPath = path.join(packPath, "style.json");
  let manifest = null;
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch (error) {
      throw new Error(`Invalid style manifest ${manifestPath}: ${error.message}`);
    }
    if (manifest.schema === STYLE_SCHEMA || manifest.schema === STYLE_V2_SCHEMA) {
      return { name: validateStyleName(manifest.name ?? path.basename(packPath)), path: packPath, manifest, pack: manifest, specification: styleSpecification(manifest), specification_path: findExisting(packPath, SPECIFICATION_CANDIDATES), caption_skin_path: findExisting(packPath, ["caption-skin.html"]), fonts: [] };
    }
    if (manifest.schema_version !== STYLE_PACK_SCHEMA_VERSION) throw new Error(`Unsupported style manifest schema: ${manifest.schema_version ?? manifest.schema ?? "missing"}`);
  } else if (options.requireManifest) {
    throw new Error(`Style pack has no style.json: ${packPath}`);
  }

  const specificationPath = manifest?.files?.specification
    ? safePackFile(packPath, manifest.files.specification)
    : findExisting(packPath, SPECIFICATION_CANDIDATES);
  if (!specificationPath || !existsSync(specificationPath)) throw new Error(`Style pack has no readable specification: ${packPath}`);
  const captionSkinPath = manifest?.files?.caption_skin
    ? safePackFile(packPath, manifest.files.caption_skin)
    : findExisting(packPath, ["caption-skin.html"]);
  const fontsPath = manifest?.files?.fonts ? safePackFile(packPath, manifest.files.fonts) : findDirectory(packPath, ["fonts"]);
  const fonts = fontsPath && existsSync(fontsPath)
    ? (await readdir(fontsPath, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.join(fontsPath, entry.name)).sort()
    : [];
  return {
    name: validateStyleName(manifest?.name ?? path.basename(packPath)),
    path: packPath,
    manifest,
    specification: await readFile(specificationPath, "utf8"),
    specification_path: specificationPath,
    caption_skin_path: captionSkinPath && existsSync(captionSkinPath) ? captionSkinPath : null,
    fonts
  };
}

export async function resolveStylePack(requested, options = {}) {
  const value = String(requested ?? "").trim();
  if (!value || value === "auto") return null;
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const looksLikePath = path.isAbsolute(value) || value.startsWith(".") || value.includes("/") || value.includes("\\");
  if (looksLikePath) {
    const explicit = path.resolve(cwd, value);
    if (!existsSync(explicit)) throw new Error(`Style pack path does not exist: ${value}`);
    return loadStylePack(explicit);
  }
  if (!isValidStyleName(value)) return null;
  const candidate = stylePackPath(value, { cwd, root: options.root });
  return existsSync(candidate) ? loadStylePack(candidate) : null;
}

export async function listStylePacks(options = {}) {
  const root = projectStyleRoot(options);
  if (!existsSync(root)) return [];
  const entries = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).sort((a, b) => a.name.localeCompare(b.name));
  const packs = [];
  for (const entry of entries) {
    try {
      const pack = await loadStylePack(path.join(root, entry.name));
      packs.push({ name: pack.name, path: pack.path, schema: pack.pack ? pack.pack.schema : STYLE_PACK_SCHEMA_VERSION, description: pack.pack?.description ?? null, specification: pack.specification_path, fonts: pack.fonts.length });
    } catch (error) {
      packs.push({ name: entry.name, path: path.join(root, entry.name), error: error.message });
    }
  }
  return packs;
}

// ---------------------------------------------------------------------------
// Style pack v3 (kit/core/style.mjs): resolution, loading, writing, upgrade.
// The *V2 names are kept from v2; they load v2 and v3 packs alike.

/** ~/.launchclip/styles, or $LAUNCHCLIP_HOME/styles. */
export function homeStyleRoot(options = {}) {
  const home = options.home ?? process.env.LAUNCHCLIP_HOME ?? path.join(os.homedir(), ".launchclip");
  return path.join(path.resolve(home), "styles");
}

/** Built-in starter styles: [{name, description, file}]. */
export async function listBuiltinStyles() {
  const files = (await readdir(BUILTIN_STYLE_ROOT)).filter((file) => file.endsWith(".json")).sort();
  const out = [];
  for (const file of files) {
    const pack = JSON.parse(await readFile(path.join(BUILTIN_STYLE_ROOT, file), "utf8"));
    out.push({ name: pack.name, description: pack.description ?? null, file: path.join(BUILTIN_STYLE_ROOT, file), schema: pack.schema, source: "builtin" });
  }
  return out;
}

/**
 * Load a pack from a style.json file or a pack directory, as v3. A v1 pack is
 * upgraded in memory (with a warning), and a v2 pack is upgraded in memory to
 * v3 with the brand frame off, so it renders as before (with a warning).
 * → {name, file, dir, pack, source, upgraded, warnings}
 */
export async function loadStyleV2(location, { source = "path" } = {}) {
  const target = path.resolve(location);
  if (!existsSync(target)) throw new Error(`Style pack not found: ${location}`);
  const isDir = (await stat(target)).isDirectory();
  const file = isDir ? path.join(target, "style.json") : target;
  const dir = isDir ? target : path.dirname(target);
  const warnings = [];
  let data = null;
  if (existsSync(file)) {
    try { data = JSON.parse(await readFile(file, "utf8")); }
    catch (error) { throw new Error(`Invalid style pack ${file}: ${error.message}`); }
  }
  let pack = data;
  let upgraded = false;
  if (!data || data.schema_version === STYLE_PACK_SCHEMA_VERSION) {
    const v1 = await loadStylePack(dir);
    const audioFile = findExisting(dir, OPTIONAL_TEXT_FILES);
    const draft = upgradeV1Pack({ name: v1.name, specification: v1.specification, audio: audioFile ? await readFile(audioFile, "utf8") : "", captionSkin: v1.caption_skin_path });
    pack = draft.pack;
    upgraded = true;
    warnings.push(`style ${v1.name} is a v1 pack, upgraded in memory; run launchclip style upgrade ${v1.name} to save it as v3`);
  } else if (data.schema === STYLE_V2_SCHEMA) {
    const first = validateStylePack(data);
    if (!first.ok) throw new Error(`Style pack ${file} is invalid:\n- ${first.errors.join("\n- ")}`);
    pack = upgradeV2Pack(data, { render: "same" }).pack;
    upgraded = true;
    warnings.push(`style ${data.name} is a v2 pack, loaded as v3 with the brand frame off; run launchclip style upgrade ${data.name} to save it as v3`);
  }
  const validation = validateStylePack(pack);
  if (!validation.ok) throw new Error(`Style pack ${file} is invalid:\n- ${validation.errors.join("\n- ")}`);
  warnings.push(...validation.warnings);
  return { name: pack.name, file, dir, pack, source, upgraded, warnings };
}

/**
 * Resolve a story's style request: a path ("./x/style.json", a directory),
 * else a name looked up in <project>/.launchclip/styles, then
 * ~/.launchclip/styles, then the built-in starters (kit/styles).
 * options: {projectDir, home, root (project style root override)}.
 */
export async function resolveStyleV2(request, options = {}) {
  const value = String(request ?? "").trim();
  if (!value) throw new Error("style must name a style pack");
  const projectDir = path.resolve(options.projectDir ?? process.cwd());
  const looksLikePath = path.isAbsolute(value) || value.startsWith(".") || value.includes("/") || value.includes(path.win32.sep) || value.endsWith(".json");
  if (looksLikePath) return loadStyleV2(path.resolve(projectDir, value), { source: "path" });
  validateStyleName(value);
  const candidates = [
    [path.join(options.root ? path.resolve(options.root) : path.join(projectDir, ".launchclip", "styles"), value), "project"],
    [path.join(homeStyleRoot(options), value), "home"],
    [path.join(BUILTIN_STYLE_ROOT, `${value}.json`), "builtin"]
  ];
  for (const [candidate, source] of candidates) if (existsSync(candidate)) return loadStyleV2(candidate, { source });
  const builtins = (await listBuiltinStyles()).map((entry) => entry.name).join(", ");
  throw new Error(`Style pack "${value}" was not found in ${candidates.slice(0, 2).map(([candidate]) => path.dirname(candidate)).join(" or ")}, and is not a built-in style (${builtins})`);
}

/** Write a v3 pack to <root>/<name>/style.json (plus extra text files such as reference-report.md). */
export async function writeStyleV2(pack, options = {}) {
  const name = validateStyleName(pack?.name);
  const validation = validateStylePack(pack);
  if (!validation.ok) throw new Error(`Style pack is invalid:\n- ${validation.errors.join("\n- ")}`);
  const root = projectStyleRoot(options);
  const destination = path.join(root, name);
  if (existsSync(path.join(destination, "style.json")) && !options.force) throw new Error(`Style pack already exists: ${name}. Pass --force to replace it`);
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, "style.json"), `${JSON.stringify(pack, null, 2)}\n`);
  const files = ["style.json"];
  for (const [file, text] of Object.entries(options.files ?? {})) {
    await writeFile(path.join(destination, file), text);
    files.push(file);
  }
  return { name, path: destination, files, warnings: validation.warnings };
}

/**
 * launchclip style upgrade <name>: convert a v2 pack to v3 in place (the
 * brand frame on, footage-led captions quiet-accent; the v2 file is kept as
 * style.v2.json), or a v1 pack (frame.md, caption skin, audio notes) to
 * style.json v3 (the v1 manifest kept as style.v1.json, every v1 file kept).
 */
export async function upgradeStylePack(name, options = {}) {
  const dir = stylePackPath(name, options);
  if (!existsSync(dir)) throw new Error(`Style pack does not exist: ${name}`);
  const manifestFile = path.join(dir, "style.json");
  const current = existsSync(manifestFile) ? JSON.parse(await readFile(manifestFile, "utf8")) : null;
  if (current?.schema === STYLE_SCHEMA) return { stage: "style", action: "upgrade", status: "unchanged", name, path: dir, notes: [`already a ${STYLE_SCHEMA} pack`] };
  if (current?.schema === STYLE_V2_SCHEMA) {
    const { pack, notes } = upgradeV2Pack(current);
    const validation = validateStylePack(pack);
    if (!validation.ok) throw new Error(`Upgraded pack is invalid:\n- ${validation.errors.join("\n- ")}`);
    await writeFile(path.join(dir, "style.v2.json"), `${JSON.stringify(current, null, 2)}\n`);
    await writeFile(manifestFile, `${JSON.stringify(pack, null, 2)}\n`);
    return { stage: "style", action: "upgrade", status: "upgraded", name, path: dir, notes, kept: ["style.v2.json"], warnings: validation.warnings };
  }
  const v1 = await loadStylePack(dir);
  const audioFile = findExisting(dir, OPTIONAL_TEXT_FILES);
  const { pack, notes } = upgradeV1Pack({ name: v1.name, specification: v1.specification, audio: audioFile ? await readFile(audioFile, "utf8") : "", captionSkin: v1.caption_skin_path });
  const validation = validateStylePack(pack);
  if (!validation.ok) throw new Error(`Upgraded pack is invalid:\n- ${validation.errors.join("\n- ")}`);
  if (current) await writeFile(path.join(dir, "style.v1.json"), `${JSON.stringify(current, null, 2)}\n`);
  await writeFile(manifestFile, `${JSON.stringify({ ...pack, created_at: new Date().toISOString() }, null, 2)}\n`);
  return { stage: "style", action: "upgrade", status: "upgraded", name: v1.name, path: dir, notes, kept: current ? ["style.v1.json", path.basename(v1.specification_path)] : [path.basename(v1.specification_path)], warnings: validation.warnings };
}

/** A frame.md-like description of a v2 pack (for routes that read a specification). */
export function styleSpecification(pack) {
  const colors = Object.entries(pack.brand?.colors ?? {}).map(([role, hex]) => `- ${role}: ${hex}`).join("\n");
  const fonts = Object.entries(pack.brand?.fonts ?? {}).map(([role, family]) => `- ${role}: ${family}`).join("\n");
  const grammar = typeof pack.motion?.grammar === "string" ? pack.motion.grammar : pack.motion?.grammar?.base ?? "editorial";
  return [`# ${pack.name}`, "", pack.description ?? "", "", "## Palette", colors || "- (not set)", "", "## Type", fonts || "- (not set)", "",
    "## Motion", `- grammar: ${grammar}`, `- ambient: ${pack.ambient?.level ?? "off"}`, "",
    "## Captions", `- preset: ${pack.captions?.preset ?? "word-highlight"}`, "", "## Sound", `- SFX density: ${pack.sound?.sfx_density ?? "normal"}`,
    ...(pack.sound?.music?.prompt_hints ? [`- music: ${[].concat(pack.sound.music.prompt_hints).join("; ")}`] : []), ""].join("\n");
}

function findExisting(root, candidates) {
  for (const candidate of candidates) {
    const file = path.join(root, candidate);
    if (existsSync(file)) return file;
  }
  return null;
}

function findDirectory(root, candidates) {
  for (const candidate of candidates) {
    const directory = path.join(root, candidate);
    if (existsSync(directory)) return directory;
  }
  return null;
}

function safePackFile(root, relativePath) {
  const resolved = path.resolve(root, String(relativePath));
  const prefix = `${path.resolve(root)}${path.sep}`;
  if (!resolved.startsWith(prefix)) throw new Error(`Style manifest path escapes the pack: ${relativePath}`);
  return resolved;
}

function isValidStyleName(value) {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(String(value));
}

function validateStyleName(value) {
  const name = String(value ?? "").trim();
  if (!isValidStyleName(name)) throw new Error("Style name must be 1-64 letters, numbers, hyphens, or underscores and cannot contain a path");
  return name;
}

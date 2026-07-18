import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const STYLE_PACK_SCHEMA_VERSION = "launchclip.style-pack.v1";

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
    if (manifest.schema_version !== STYLE_PACK_SCHEMA_VERSION) throw new Error(`Unsupported style manifest schema: ${manifest.schema_version ?? "missing"}`);
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
      packs.push({ name: pack.name, path: pack.path, specification: pack.specification_path, fonts: pack.fonts.length });
    } catch (error) {
      packs.push({ name: entry.name, path: path.join(root, entry.name), error: error.message });
    }
  }
  return packs;
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

// Fonts for the Remotion kit, from the registry in kit/core/fonts.mjs (shared
// with the HyperFrames compiler), so both renderers draw the same files.
//
// - Registry families: each face's woff2 comes from its pinned @fontsource
//   package. font-files.ts imports every file, so the Remotion bundler copies
//   it into the bundle and hands back its URL, and registers them here. The
//   kit's Root imports it, so Studio, `remotion render`, `remotion still` and
//   the ModuleReview parity renders carry every face. An app that embeds
//   @launchclip/remotion imports "@launchclip/remotion/fonts" (a bundler with
//   a woff2 loader) or calls registerFontFiles() with its own URLs, from
//   FONT_FACES (each face's package and file).
// - Frozen families: files under <public-dir>/assets/fonts/ named
//   <family-slug>-<weight>[-italic].woff2 win for their family, exactly as in
//   the HyperFrames compiler, and load through staticFile().
//
// Every face loads through the FontFace API inside delayRender/continueRender,
// and the handle is released only once document.fonts is ready, so no frame is
// captured with a fallback face. test/remotion_fonts.test.js keeps FONT_FILES
// in step with the registry: add a family there, then add its imports to
// font-files.ts.
import { continueRender, delayRender, getStaticFiles, staticFile } from "remotion";
// @ts-ignore plain ESM from kit/core
import { allFontFaces, brandFontStacks, frozenFontFaces, projectFontFamilies, registryFontFaces } from "../core/fonts.mjs";
export type FontStacks = { display: string; body: string; meta: string; math: string; serif: string; families: string[] };
type Face = { family: string; file: string; weight: string; style: string; format: string };

/** Every registry face: {family, package, file, module, weight, style, format}; `module` is the import path of its woff2. */
export const FONT_FACES: ReadonlyArray<Face & { package: string; module: string }> = allFontFaces();

// Registry file name → URL, filled by registerFontFiles (font-files.ts).
const fontUrls = new Map<string, string>();

/** Registers URLs for registry faces, keyed by file name (FONT_FACES[i].file). */
export function registerFontFiles(files: Record<string, string>): void {
  for (const [file, url] of Object.entries(files)) if (url) fontUrls.set(file, url);
}

// Font loading is resource state, not animation state: one load per face per
// page, shared by every composition instance.
const started = new Map<string, Promise<void>>();
const warned = new Set<string>();

function warnOnce(message: string) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[launchclip] ${message}`);
}

// Public-dir files under assets/fonts/ (the frozen fonts); empty when the
// static file list is unavailable (the Player, or no public dir).
function frozenFiles(): string[] {
  try {
    return (getStaticFiles() ?? []).map((file) => file.name).filter((name) => name.startsWith("assets/fonts/"));
  } catch {
    return [];
  }
}

function loadFace(key: string, face: Face, url: string) {
  if (started.has(key)) return;
  const handle = delayRender(`Loading font ${face.family} ${face.weight} ${face.style}`, { timeoutInMilliseconds: 60000 });
  const fontFace = new FontFace(face.family, `url("${url}") format("${face.format}")`, { weight: face.weight, style: face.style, display: "block" });
  const promise = fontFace.load()
    .then((loaded) => { document.fonts.add(loaded); return document.fonts.ready; })
    .then(() => undefined)
    .catch((error) => warnOnce(`font ${face.family} (${face.file}) failed to load: ${error?.message ?? error}`))
    .finally(() => continueRender(handle));
  started.set(key, promise);
}

/**
 * Starts loading every project family once (kit/core/fonts.mjs
 * projectFontFamilies: role defaults, the symbol fallback and brand.fonts)
 * and returns the role stacks. Rendering waits through delayRender.
 */
export function ensureFonts(brand: any): FontStacks {
  const stacks = brandFontStacks(brand) as FontStacks;
  if (typeof document === "undefined" || typeof FontFace === "undefined") return stacks;
  const local = frozenFiles();
  for (const family of projectFontFamilies(brand) as string[]) {
    const frozen = frozenFontFaces(family, local) as Face[];
    if (frozen.length) {
      for (const face of frozen) loadFace(`frozen:${face.file}`, face, staticFile(`assets/fonts/${face.file}`));
      continue;
    }
    const faces = registryFontFaces([family]) as Face[];
    if (!faces.length) {
      warnOnce(`font "${family}" is not in the LaunchClip font registry and has no files under assets/fonts/; its role's bundled family is used instead`);
      continue;
    }
    for (const face of faces) {
      const url = fontUrls.get(face.file);
      if (url) loadFace(`registry:${face.file}`, face, url);
      else warnOnce(`font file ${face.file} is not registered: import "@launchclip/remotion/fonts" (kit/remotion/font-files.ts) or call registerFontFiles()`);
    }
  }
  return stacks;
}

/** @deprecated use ensureFonts (it loads more than the brand families). */
export const ensureBrandFonts = ensureFonts;

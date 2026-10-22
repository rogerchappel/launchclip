// Fonts for the Remotion kit, from the registry in kit/core/fonts.mjs (shared
// with the HyperFrames compiler), so both renderers draw the same files.
//
// - Registry families: each face's woff2 is imported from its pinned
//   @fontsource package, so the Remotion bundler copies it into the bundle and
//   hands back its URL. Nothing touches the public dir and nothing is fetched
//   from the network; the same import works for Studio, `remotion render`,
//   `remotion still` and the ModuleReview parity renders.
// - Frozen families: files under <public-dir>/assets/fonts/ named
//   <family-slug>-<weight>[-italic].woff2 win for their family, exactly as in
//   the HyperFrames compiler, and load through staticFile().
//
// Every face loads through the FontFace API inside delayRender/continueRender,
// and the handle is released only once document.fonts is ready, so no frame is
// captured with a fallback face. test/remotion_fonts.test.js keeps FONT_FILES
// in step with the registry: add a family there, then add its imports here.
import { continueRender, delayRender, getStaticFiles, staticFile } from "remotion";
// @ts-ignore plain ESM from kit/core
import { brandFontStacks, frozenFontFaces, projectFontFamilies, registryFontFaces } from "../core/fonts.mjs";
import antonLatin400Normal from "@fontsource/anton/files/anton-latin-400-normal.woff2";
import archivoBlackLatin400Normal from "@fontsource/archivo-black/files/archivo-black-latin-400-normal.woff2";
import bricolageGrotesqueLatinWghtNormal from "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2";
import instrumentSerifLatin400Normal from "@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2";
import instrumentSerifLatin400Italic from "@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2";
import interLatinWghtNormal from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2";
import jetbrainsMonoLatinWghtNormal from "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2";
import spaceGroteskLatinWghtNormal from "@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2";
import stixTwoMathLatin400Normal from "@fontsource/stix-two-math/files/stix-two-math-latin-400-normal.woff2";
import stixTwoTextLatinWghtNormal from "@fontsource-variable/stix-two-text/files/stix-two-text-latin-wght-normal.woff2";
import stixTwoTextLatinWghtItalic from "@fontsource-variable/stix-two-text/files/stix-two-text-latin-wght-italic.woff2";
import syneLatinWghtNormal from "@fontsource-variable/syne/files/syne-latin-wght-normal.woff2";
import unboundedLatinWghtNormal from "@fontsource-variable/unbounded/files/unbounded-latin-wght-normal.woff2";

/** Registry file name → URL of that file in the Remotion bundle. */
export const FONT_FILES: Record<string, string> = {
  "anton-latin-400-normal.woff2": antonLatin400Normal,
  "archivo-black-latin-400-normal.woff2": archivoBlackLatin400Normal,
  "bricolage-grotesque-latin-wght-normal.woff2": bricolageGrotesqueLatinWghtNormal,
  "instrument-serif-latin-400-normal.woff2": instrumentSerifLatin400Normal,
  "instrument-serif-latin-400-italic.woff2": instrumentSerifLatin400Italic,
  "inter-latin-wght-normal.woff2": interLatinWghtNormal,
  "jetbrains-mono-latin-wght-normal.woff2": jetbrainsMonoLatinWghtNormal,
  "space-grotesk-latin-wght-normal.woff2": spaceGroteskLatinWghtNormal,
  "stix-two-math-latin-400-normal.woff2": stixTwoMathLatin400Normal,
  "stix-two-text-latin-wght-normal.woff2": stixTwoTextLatinWghtNormal,
  "stix-two-text-latin-wght-italic.woff2": stixTwoTextLatinWghtItalic,
  "syne-latin-wght-normal.woff2": syneLatinWghtNormal,
  "unbounded-latin-wght-normal.woff2": unboundedLatinWghtNormal
};

export type FontStacks = { display: string; body: string; meta: string; math: string; serif: string; families: string[] };
type Face = { family: string; file: string; weight: string; style: string; format: string };

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
      const url = FONT_FILES[face.file];
      if (url) loadFace(`registry:${face.file}`, face, url);
      else warnOnce(`font file ${face.file} is not imported in kit/remotion/fonts.ts`);
    }
  }
  return stacks;
}

/** @deprecated use ensureFonts (it loads more than the brand families). */
export const ensureBrandFonts = ensureFonts;

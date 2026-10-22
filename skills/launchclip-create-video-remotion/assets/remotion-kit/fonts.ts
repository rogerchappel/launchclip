// Brand fonts for the Remotion kit. brand.fonts slugs resolve through
// kit/core/fonts.mjs (shared with the HyperFrames compiler) and load through
// @remotion/google-fonts with the same faces the HyperFrames compiler links
// (latin subset, every weight of the normal style).
//
// Each loader is a literal dynamic import so the bundler only includes the
// families listed here, each as its own chunk. Add a family by adding a line.
import { continueRender, delayRender } from "remotion";
// @ts-ignore plain ESM from kit/core
import { brandFontStacks, googleFontModuleName, moduleFontFaces } from "../core/fonts.mjs";

type GoogleFontModule = {
  getInfo: () => { fontFamily: string; fonts: Record<string, Record<string, Record<string, string>>> };
  loadFont: (style?: string, options?: { weights?: string[]; subsets?: string[] }) => { waitUntilDone: () => Promise<void> };
};

const LOADERS: Record<string, () => Promise<GoogleFontModule>> = {
  Anton: () => import("@remotion/google-fonts/Anton"),
  Archivo: () => import("@remotion/google-fonts/Archivo"),
  ArchivoBlack: () => import("@remotion/google-fonts/ArchivoBlack"),
  Barlow: () => import("@remotion/google-fonts/Barlow"),
  BarlowCondensed: () => import("@remotion/google-fonts/BarlowCondensed"),
  BebasNeue: () => import("@remotion/google-fonts/BebasNeue"),
  BricolageGrotesque: () => import("@remotion/google-fonts/BricolageGrotesque"),
  DMMono: () => import("@remotion/google-fonts/DMMono"),
  DMSans: () => import("@remotion/google-fonts/DMSans"),
  DMSerifDisplay: () => import("@remotion/google-fonts/DMSerifDisplay"),
  EBGaramond: () => import("@remotion/google-fonts/EBGaramond"),
  FiraCode: () => import("@remotion/google-fonts/FiraCode"),
  Fraunces: () => import("@remotion/google-fonts/Fraunces"),
  IBMPlexMono: () => import("@remotion/google-fonts/IBMPlexMono"),
  IBMPlexSans: () => import("@remotion/google-fonts/IBMPlexSans"),
  Inter: () => import("@remotion/google-fonts/Inter"),
  JetBrainsMono: () => import("@remotion/google-fonts/JetBrainsMono"),
  LeagueGothic: () => import("@remotion/google-fonts/LeagueGothic"),
  Lexend: () => import("@remotion/google-fonts/Lexend"),
  Manrope: () => import("@remotion/google-fonts/Manrope"),
  Montserrat: () => import("@remotion/google-fonts/Montserrat"),
  Oswald: () => import("@remotion/google-fonts/Oswald"),
  Outfit: () => import("@remotion/google-fonts/Outfit"),
  PlayfairDisplay: () => import("@remotion/google-fonts/PlayfairDisplay"),
  PlusJakartaSans: () => import("@remotion/google-fonts/PlusJakartaSans"),
  Poppins: () => import("@remotion/google-fonts/Poppins"),
  Roboto: () => import("@remotion/google-fonts/Roboto"),
  RobotoMono: () => import("@remotion/google-fonts/RobotoMono"),
  Sora: () => import("@remotion/google-fonts/Sora"),
  SpaceGrotesk: () => import("@remotion/google-fonts/SpaceGrotesk"),
  SpaceMono: () => import("@remotion/google-fonts/SpaceMono"),
  Syne: () => import("@remotion/google-fonts/Syne"),
  Unbounded: () => import("@remotion/google-fonts/Unbounded"),
  Urbanist: () => import("@remotion/google-fonts/Urbanist"),
  WorkSans: () => import("@remotion/google-fonts/WorkSans")
};

// Font loading is resource state, not animation state: one load per family
// per page, shared by every composition instance.
const started = new Map<string, Promise<void>>();

export function supportedGoogleFont(family: string): boolean {
  return Boolean(LOADERS[googleFontModuleName(family)]);
}

/** Starts loading every brand family once; rendering waits through delayRender. */
export function ensureBrandFonts(brand: any): { display: string; body: string; meta: string; families: string[] } {
  const stacks = brandFontStacks(brand);
  for (const family of stacks.families as string[]) ensureFamily(family, ["normal"]);
  return stacks;
}

/** Loads the module faces a story needs (kit/core/fonts.mjs MODULE_FONTS), e.g. archive-card's italic serif. */
export function ensureModuleFonts(story: any): void {
  for (const face of moduleFontFaces(story) as Array<{ family: string; styles: string[] }>) ensureFamily(face.family, face.styles);
}

function ensureFamily(family: string, styles: string[]): void {
  for (const style of styles) {
    const key = style === "normal" ? family : `${family}:${style}`;
    if (started.has(key)) continue;
    const loader = LOADERS[googleFontModuleName(family)];
    if (!loader) {
      started.set(key, Promise.resolve());
      console.warn(`[launchclip] font "${family}" is not in kit/remotion/fonts.ts; using its fallback stack. Add it there, or freeze it under assets/fonts/ and load it in a custom entry.`);
      continue;
    }
    const handle = delayRender(`Loading font ${key}`, { timeoutInMilliseconds: 60000 });
    const promise = loader()
      .then((module) => {
        const info = module.getInfo();
        const weights = Object.keys(info.fonts[style] ?? {});
        const subsets = Object.keys(info.fonts[style]?.[weights[0]] ?? {});
        return module.loadFont(style, { weights, subsets: subsets.includes("latin") ? ["latin"] : subsets.slice(0, 1) }).waitUntilDone();
      })
      .catch((error) => console.warn(`[launchclip] font "${key}" failed to load: ${error?.message ?? error}`))
      .finally(() => continueRender(handle));
    started.set(key, promise);
  }
}

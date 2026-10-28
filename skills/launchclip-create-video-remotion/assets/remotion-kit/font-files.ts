// The registry's font files, imported through the bundler and registered with
// fonts.ts (registerFontFiles). The kit's Root imports this module; an app that
// embeds @launchclip/remotion imports it as "@launchclip/remotion/fonts" when
// its bundler resolves woff2 imports to URLs (Remotion's does).
// test/remotion_fonts.test.js keeps these imports in step with
// kit/core/fonts.mjs.
import { registerFontFiles } from "./fonts";
import antonLatin400Normal from "@fontsource/anton/files/anton-latin-400-normal.woff2";
import archivoBlackLatin400Normal from "@fontsource/archivo-black/files/archivo-black-latin-400-normal.woff2";
import bebasNeueLatin400Normal from "@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2";
import bigShouldersDisplayLatinWghtNormal from "@fontsource-variable/big-shoulders-display/files/big-shoulders-display-latin-wght-normal.woff2";
import bricolageGrotesqueLatinWghtNormal from "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2";
import dmSansLatinWghtNormal from "@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2";
import dmSerifDisplayLatin400Normal from "@fontsource/dm-serif-display/files/dm-serif-display-latin-400-normal.woff2";
import firaCodeLatinWghtNormal from "@fontsource-variable/fira-code/files/fira-code-latin-wght-normal.woff2";
import frauncesLatinWghtNormal from "@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2";
import instrumentSerifLatin400Normal from "@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2";
import instrumentSerifLatin400Italic from "@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2";
import interLatinWghtNormal from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2";
import jetbrainsMonoLatinWghtNormal from "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2";
import lexendLatinWghtNormal from "@fontsource-variable/lexend/files/lexend-latin-wght-normal.woff2";
import manropeLatinWghtNormal from "@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2";
import oswaldLatinWghtNormal from "@fontsource-variable/oswald/files/oswald-latin-wght-normal.woff2";
import outfitLatinWghtNormal from "@fontsource-variable/outfit/files/outfit-latin-wght-normal.woff2";
import playfairDisplayLatinWghtNormal from "@fontsource-variable/playfair-display/files/playfair-display-latin-wght-normal.woff2";
import plusJakartaSansLatinWghtNormal from "@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2";
import soraLatinWghtNormal from "@fontsource-variable/sora/files/sora-latin-wght-normal.woff2";
import spaceGroteskLatinWghtNormal from "@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2";
import stixTwoMathLatin400Normal from "@fontsource/stix-two-math/files/stix-two-math-latin-400-normal.woff2";
import stixTwoTextLatinWghtNormal from "@fontsource-variable/stix-two-text/files/stix-two-text-latin-wght-normal.woff2";
import stixTwoTextLatinWghtItalic from "@fontsource-variable/stix-two-text/files/stix-two-text-latin-wght-italic.woff2";
import syneLatinWghtNormal from "@fontsource-variable/syne/files/syne-latin-wght-normal.woff2";
import unboundedLatinWghtNormal from "@fontsource-variable/unbounded/files/unbounded-latin-wght-normal.woff2";
import youngSerifLatin400Normal from "@fontsource/young-serif/files/young-serif-latin-400-normal.woff2";

/** Registry file name → URL of that file in the Remotion bundle. */
export const FONT_FILES: Record<string, string> = {
  "anton-latin-400-normal.woff2": antonLatin400Normal,
  "archivo-black-latin-400-normal.woff2": archivoBlackLatin400Normal,
  "bebas-neue-latin-400-normal.woff2": bebasNeueLatin400Normal,
  "big-shoulders-display-latin-wght-normal.woff2": bigShouldersDisplayLatinWghtNormal,
  "bricolage-grotesque-latin-wght-normal.woff2": bricolageGrotesqueLatinWghtNormal,
  "dm-sans-latin-wght-normal.woff2": dmSansLatinWghtNormal,
  "dm-serif-display-latin-400-normal.woff2": dmSerifDisplayLatin400Normal,
  "fira-code-latin-wght-normal.woff2": firaCodeLatinWghtNormal,
  "fraunces-latin-wght-normal.woff2": frauncesLatinWghtNormal,
  "instrument-serif-latin-400-normal.woff2": instrumentSerifLatin400Normal,
  "instrument-serif-latin-400-italic.woff2": instrumentSerifLatin400Italic,
  "inter-latin-wght-normal.woff2": interLatinWghtNormal,
  "jetbrains-mono-latin-wght-normal.woff2": jetbrainsMonoLatinWghtNormal,
  "lexend-latin-wght-normal.woff2": lexendLatinWghtNormal,
  "manrope-latin-wght-normal.woff2": manropeLatinWghtNormal,
  "oswald-latin-wght-normal.woff2": oswaldLatinWghtNormal,
  "outfit-latin-wght-normal.woff2": outfitLatinWghtNormal,
  "playfair-display-latin-wght-normal.woff2": playfairDisplayLatinWghtNormal,
  "plus-jakarta-sans-latin-wght-normal.woff2": plusJakartaSansLatinWghtNormal,
  "sora-latin-wght-normal.woff2": soraLatinWghtNormal,
  "space-grotesk-latin-wght-normal.woff2": spaceGroteskLatinWghtNormal,
  "stix-two-math-latin-400-normal.woff2": stixTwoMathLatin400Normal,
  "stix-two-text-latin-wght-normal.woff2": stixTwoTextLatinWghtNormal,
  "stix-two-text-latin-wght-italic.woff2": stixTwoTextLatinWghtItalic,
  "syne-latin-wght-normal.woff2": syneLatinWghtNormal,
  "unbounded-latin-wght-normal.woff2": unboundedLatinWghtNormal,
  "young-serif-latin-400-normal.woff2": youngSerifLatin400Normal
};

registerFontFiles(FONT_FILES);

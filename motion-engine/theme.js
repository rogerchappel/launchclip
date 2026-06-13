// Visual constants for the paper-world grammar (ART_DIRECTION.md v2).
// Components import from here; per-brand skinning later swaps SEMANTIC colors
// and the icon set, never the paper or the ink.

import { loadFont as loadFraunces } from "@remotion/google-fonts/Fraunces";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";

const fraunces = loadFraunces("normal", { weights: ["900"], subsets: ["latin"] });
const frauncesItalic = loadFraunces("italic", { weights: ["900"], subsets: ["latin"] });
const inter = loadInter("normal", { weights: ["600", "800"], subsets: ["latin"] });

export const FONTS = {
  serif: `${fraunces.fontFamily}, Georgia, serif`,
  script: `${frauncesItalic.fontFamily}, Georgia, serif`,
  sans: `${inter.fontFamily}, Arial, sans-serif`
};

export const PAPER = {
  ground: "#ECE8E1",
  grid: "rgba(26,26,24,0.06)",
  gridSize: 64,
  vignette: "radial-gradient(120% 100% at 50% 30%, rgba(0,0,0,0) 60%, rgba(26,26,24,0.07) 100%)"
};

export const INK = {
  primary: "#1A1A18",
  muted: "rgba(26,26,24,0.55)",
  onDark: "#FAFAF7",
  onDarkMuted: "rgba(250,250,247,0.6)"
};

export const SEMANTIC = {
  mint: "#4FAE85",
  coral: "#E07A50",
  purple: "#7C5CD6"
};

export const CARD = {
  light: "#FFFFFF",
  dark: "#121210",
  radius: 28,
  // Client feedback pass (ART_DIRECTION 4e): the light source sits top-left,
  // so every shadow falls to the BOTTOM-RIGHT and stays sharp — a tight
  // contact edge plus a moderate directional throw, like a print shadow.
  shadow: "3px 4px 6px rgba(26,26,24,0.2), 10px 14px 24px rgba(26,26,24,0.26)",
  shadowLow: "2px 3px 4px rgba(26,26,24,0.18), 6px 8px 14px rgba(26,26,24,0.22)",
  shadowHigh: "4px 6px 8px rgba(26,26,24,0.22), 16px 22px 38px rgba(26,26,24,0.3)"
};

// Staged type carries the same bottom-right light: a hard offset print
// shadow, em-based so it scales with the word.
export const TYPE_SHADOW = "0.045em 0.06em 0px rgba(26,26,24,0.22)";

export const SPRINGS = {
  enter: { damping: 17, stiffness: 175, mass: 0.9 },
  settle: { damping: 18, stiffness: 160, mass: 0.9 },
  exit: { damping: 17, stiffness: 150, mass: 0.85 }
};

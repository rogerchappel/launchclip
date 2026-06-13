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
  // Light source sits top-left, so every shadow falls to the BOTTOM-RIGHT.
  // P4 teardown (reference t48): the shadows are crisper, darker and tighter
  // than a soft hover — a hard-light print shadow. Smaller blur radii, higher
  // opacity, a touch more directional offset.
  shadow: "4px 5px 5px rgba(26,26,24,0.26), 9px 12px 16px rgba(26,26,24,0.2)",
  shadowLow: "3px 4px 4px rgba(26,26,24,0.22), 6px 7px 10px rgba(26,26,24,0.16)",
  shadowHigh: "5px 7px 7px rgba(26,26,24,0.3), 14px 18px 26px rgba(26,26,24,0.24)"
};

// Staged type carries the same bottom-right light: a hard offset print
// shadow, em-based so it scales with the word.
export const TYPE_SHADOW = "0.045em 0.06em 0px rgba(26,26,24,0.22)";

export const SPRINGS = {
  enter: { damping: 17, stiffness: 175, mass: 0.9 },
  settle: { damping: 18, stiffness: 160, mass: 0.9 },
  exit: { damping: 17, stiffness: 150, mass: 0.85 }
};

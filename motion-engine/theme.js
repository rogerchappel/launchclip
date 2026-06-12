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
  // Deep two-layer shadows: a tight contact shadow plus a long soft throw,
  // so elements pop off the paper instead of sitting printed on it.
  shadow: "0 6px 14px rgba(26,26,24,0.18), 0 28px 65px rgba(26,26,24,0.32)",
  shadowLow: "0 4px 10px rgba(26,26,24,0.16), 0 16px 38px rgba(26,26,24,0.24)",
  shadowHigh: "0 8px 18px rgba(26,26,24,0.2), 0 40px 90px rgba(26,26,24,0.4)"
};

export const SPRINGS = {
  enter: { damping: 17, stiffness: 175, mass: 0.9 },
  settle: { damping: 18, stiffness: 160, mass: 0.9 },
  exit: { damping: 17, stiffness: 150, mass: 0.85 }
};

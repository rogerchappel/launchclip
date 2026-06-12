// Format presets: pacing skeletons and scene-type priors per video kind.
// Data, not code — presets are priors the Director may deviate from when the
// script demands it; only the linter enforces hard rules.

export const PRESETS = {
  software_demo: {
    name: "software_demo",
    audience: "Developers and technical buyers scrolling short-form video.",
    skeleton: [
      "hook: talking_head split (if footage) or typography — the pain or the claim, first 3s",
      "problem/promise: typography thesis with ONE emphasised word",
      "the command: prompt_card (zoom_into) showing the real invocation",
      "what it does: card_steps, one chip per capability as spoken",
      "how it fits: icon_flow from the user's world to the payoff",
      "cta: typography, emphasised word in coral"
    ],
    priors:
      "Lean on prompt_card and screen/screenshot evidence. The product doing the thing beats describing the thing. Chapter-style cuts between problem and solution.",
    cta_norms: "Direct and short: try it, link in bio, repo name. No begging for follows.",
    energy: "high"
  },
  explainer: {
    name: "explainer",
    audience: "Curious learners; assume zero context, respect their intelligence.",
    skeleton: [
      "hook: typography question or counterintuitive claim, first 3s",
      "thesis: typography ('There are 3 levels to this.')",
      "concept beats: alternate typography / icon_flow (processes, chains) / card_steps (criteria)",
      "recap: card_steps compressing the whole argument",
      "cta: typography, soft (follow for more X / the takeaway line)"
    ],
    priors:
      "No product assets needed — diagrams and staged type carry it. Each concept beat answers exactly one question. Use icon_flow for any A-causes-B chain. Numbers get emphasis color.",
    cta_norms: "Soft CTA or pure takeaway. Never salesy.",
    energy: "medium-high"
  }
};

export function renderPreset(preset) {
  return `## Format preset: ${preset.name}\nAUDIENCE: ${preset.audience}\nSKELETON (prior, not straitjacket):\n${preset.skeleton
    .map((line, index) => `${index + 1}. ${line}`)
    .join("\n")}\nPRIORS: ${preset.priors}\nCTA: ${preset.cta_norms}\nENERGY: ${preset.energy}`;
}

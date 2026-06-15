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
      "the command: prompt_card showing the real invocation, with a close punch_zoom",
      "proof/output: terminal_receipt, artifact_grid, screenshot_pile, or screen showing real generated outputs",
      "how it works: funnel or icon_flow; use icon_flow variant 'orbit' for systems and 'vertical' only for strict chains",
      "actual steps only: card_steps variant 'rail' or 'stack' only when the script has real complete step labels",
      "cta: typography, emphasised word in coral"
    ],
    priors:
      "Lean on prompt_card, terminal_receipt, artifact_grid, screen, and screenshot evidence. The product doing the thing beats describing the thing. Do not use card_steps as captions; use it only for literal checklists. Rotate scene families and variants so no visual primitive dominates.",
    cta_norms: "Direct and short: try it, link in bio, repo name. No begging for follows.",
    energy: "high"
  },
  explainer: {
    name: "explainer",
    audience: "Curious learners; assume zero context, respect their intelligence.",
    skeleton: [
      "hook: typography question or counterintuitive claim, first 3s",
      "thesis: typography ('There are 3 levels to this.')",
      "concept beats: alternate typography / icon_flow variants (processes, systems) / funnel (staged sequence) / quote_card (principle)",
      "recap: card_steps only for real criteria or a proper numbered framework",
      "cta: typography, soft (follow for more X / the takeaway line)"
    ],
    priors:
      "No product assets needed — diagrams and staged type carry it. Each concept beat answers exactly one question. Use icon_flow for A-causes-B chains or system maps, funnel for staged processes, and card_steps only for real criteria. Numbers get emphasis color.",
    cta_norms: "Soft CTA or pure takeaway. Never salesy.",
    energy: "medium-high"
  }
};

export function renderPreset(preset) {
  return `## Format preset: ${preset.name}\nAUDIENCE: ${preset.audience}\nSKELETON (prior, not straitjacket):\n${preset.skeleton
    .map((line, index) => `${index + 1}. ${line}`)
    .join("\n")}\nPRIORS: ${preset.priors}\nCTA: ${preset.cta_norms}\nENERGY: ${preset.energy}`;
}

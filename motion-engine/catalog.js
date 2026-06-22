// The component catalog: machine-readable metadata for every scene type,
// event, and transition the renderer supports. The Director's system prompt
// is generated from this file — adding a component here extends the
// Director's vocabulary with no prompt rewrites. Keep entries honest: only
// describe what the renderer actually does.

import { objectCatalogStats, renderObjectCatalog } from "./object-catalog.js";

export const SCENE_CATALOG = [
  {
    type: "talking_head",
    use_for:
      "The hook (first scene) and credibility/CTA beats when real presenter footage exists. Default layout 'split' puts the face in the bottom half with word builds staging on the paper above; 'full' is full-bleed (hook only); 'card' parks the face in a tilted card beside content; 'overlay' is full-bleed footage with word builds landing directly ON it in white serif (words-on-footage).",
    avoid_when: "No real footage is available — never fabricate footage. Don't let face scenes dominate; the graphics are the protagonist.",
    params:
      '{ "type": "talking_head", "start", "end", "src": "<real footage path>", "layout": "split|card|full", "items": [{"text", "at", "emphasis?", "color?"}] }',
    density: "Word builds in items[] keep the top half alive; aim for an item every 1-2s during split scenes.",
    example: { type: "talking_head", start: 0, end: 3.2, src: "base/take.mp4", layout: "split", items: [{ text: "I stopped", at: 0.33 }, { text: "hand-editing", at: 0.81, emphasis: true, color: "coral" }] }
  },
  {
    type: "screen",
    use_for: "Real screen recordings of the product doing the thing, shown in a big card on the paper.",
    avoid_when: "No real recording exists. Never longer than ~5s without a cut or zoom.",
    params: '{ "type": "screen", "start", "end", "src": "<real recording path>", "offset?": seconds_into_source }',
    density: "Footage is continuously alive, and the card itself pushes in slowly with a gentle pan; pair with a punch_zoom on the key moment.",
    example: { type: "screen", start: 8.4, end: 12.0, src: "assets/demo-recording.mp4", offset: 14 }
  },
  {
    type: "typography",
    use_for:
      "Spoken phrases staged center-frame as the scene itself — theses, transitions of thought, punchlines, CTAs. Chunky serif statements with ONE emphasised word in script-italic and a semantic color.",
    avoid_when: "More than ~7 words on screen; more than one emphasis word per phrase.",
    params: '{ "type": "typography", "start", "end", "items": [{"text": "1-3 words", "at": word_start_time, "emphasis?": true, "color?": "mint|coral|purple"}] }',
    density: "Each item lands on its spoken word; 2-5 items per scene.",
    example: { type: "typography", start: 3.2, end: 5.9, items: [{ text: "Now my", at: 3.21 }, { text: "repo", at: 3.62, emphasis: true, color: "mint" }, { text: "makes them", at: 4.05 }] }
  },
  {
    type: "prompt_card",
    use_for:
      "The exact command or AI prompt the subject runs, typed into a dark chat composer pill. Starts minimized (icon row only) and springs open line by line as the prompt types; mic + up-arrow send sit right, and the arrow presses when typing completes. For CLI tools and AI products the prompt IS the demo.",
    avoid_when: "The text is invented — only real commands/prompts. Longer than ~140 characters. Icons that aren't real brand assets from the manifest.",
    params: '{ "type": "prompt_card", "start", "end", "text": "<the real command or prompt>", "icons?": ["<brand icon path>", "max 3"] }',
    density: "Typing animation + typing SFX run for the scene duration; the pill grows per line, pushes in close, pans while typing, and wears a bright travelling rim glow — continuously alive.",
    example: { type: "prompt_card", start: 5.9, end: 8.4, text: "launchclip run ./my-oss-tool", icons: ["logos/launchclip.svg"] }
  },
  {
    type: "screenshot_pile",
    use_for:
      "Real screenshots as physical cards. mode 'pile': one lands, copies fan out around it (overwhelm, abundance, proof). mode 'scroll': a feed travels up through the frame (timelines, lists of results).",
    avoid_when: "No real screenshots in the asset manifest. Fabricated screenshots are forbidden.",
    params: '{ "type": "screenshot_pile", "start", "end", "mode": "pile|scroll", "items": [{"src": "<real image>", "at"}] }',
    density: "One card landing per item; stagger at 0.3-0.8s apart.",
    example: { type: "screenshot_pile", start: 10, end: 14, mode: "pile", items: [{ src: "shots/ui-1.png", at: 10.1 }, { src: "shots/ui-2.png", at: 10.6 }] }
  },
  {
    type: "icon_flow",
    use_for: "Pipelines, integrations, before-to-after chains: brand-icon cards connected by dotted lines. Use variant 'vertical' for linear chains and 'orbit' when the idea should spread across the canvas like an ecosystem or dependency map. Final node may be the payoff (mint).",
    avoid_when: "More than 4 nodes. Node labels longer than ~4 words.",
    params: '{ "type": "icon_flow", "start", "end", "variant?": "vertical|orbit", "items": [{"text": "label", "at", "src?": "<icon image>", "color?"}] }',
    density: "Node + connector per item; arrive by zoom-from-depth while earlier nodes glide up to make room. When no brand asset fits, use the generic icons (icons/globe.svg, browser, server, database, document, gear, magnifier, clock, check, lightning, laptop, cloud) — real shapes beat text-only nodes.",
    example: { type: "icon_flow", start: 11.1, end: 15.0, items: [{ text: "your demo", at: 11.2, src: "logos/terminal.svg" }, { text: "ready to post", at: 14.0, color: "mint" }] }
  },
  {
    type: "card_steps",
    use_for: "Literal numbered how-to beats, checklists, and 'N things' structures where each item is a complete action/object phrase like 'Capture the demo' or 'Approve the packet'.",
    avoid_when: "Ordinary narration chunks, filler words ('first', 'next', 'point', 'and'), or captions split across cards. More than 5 items (split into two scenes); item text longer than ~6 words. If the words are not real steps, use typography, funnel, artifact_grid, or prompt_card instead.",
    params: '{ "type": "card_steps", "start", "end", "variant?": "stack|rail", "title?": "script-italic kicker", "items": [{"text", "at"}] }',
    density: "One chip + click SFX per item; chips already on screen glide apart to make room as each lands.",
    example: { type: "card_steps", start: 8.4, end: 11.1, items: [{ text: "Script with timing", at: 8.45 }, { text: "Matched visuals", at: 9.4 }] }
  }
,
  {
    type: "stat_counter",
    use_for: "One oversized number rolling up to its value (87%, 10x, $2,000) with a short label beneath. Magnitudes, social proof, payoffs. The number is the only thing on screen.",
    avoid_when: "The number is invented - only numbers stated in the script/subject. More than one stat (that is two scenes).",
    params: '{ "type": "stat_counter", "start", "end", "value": "87%", "label": "short context line", "color?": "mint|coral|purple", "at": word_start_of_the_number }',
    density: "Roll-up animates ~1s from at; keep the scene 2-3s.",
    example: { type: "stat_counter", start: 12, end: 14.5, value: "10x", label: "faster than editing by hand", color: "mint", at: 12.3 }
  },
  {
    type: "quote_card",
    use_for: "A principle, rule, or testimonial staged as a white card with a serif quote and muted attribution. Education takeaways, personal-brand maxims.",
    avoid_when: "Quotes longer than ~16 words; fabricated attributions.",
    params: '{ "type": "quote_card", "start", "end", "text": "the quote", "attribution?": "who said it", "at": word_start }',
    density: "Single landing; keep the scene 2.5-4s and pair with a punch_zoom if it runs long.",
    example: { type: "quote_card", start: 30, end: 33, text: "Ship the proof, not the promise.", attribution: "every good launch", at: 30.2 }
  },
  {
    type: "funnel",
    use_for:
      "A process or sales funnel as numbered step cards that taper into a funnel silhouette, threaded by a centre dotted spine and landing one per beat. Use for pipelines, multi-stage flows, 'here's how it works' sequences. One step can be coloured (mint = success); an optional branch card (coral) loops off the side via a curved dotted line for a failure/alternate path.",
    avoid_when: "More than 6 steps (split it); step labels longer than ~4 words. Icons that aren't real assets from the manifest.",
    params:
      '{ "type": "funnel", "start", "end", "title?": "script kicker", "items": [{"text", "at", "icon?": "icons/...svg", "color?": "mint", "badge?": "1"}], "branch?": {"fromIndex": 3, "at", "text": "No Reply", "color": "coral"} }',
    density: "One card + step chip per beat; the spine and any branch connector draw on as cards land.",
    example: { type: "funnel", start: 8, end: 13, title: "the pipeline", items: [{ text: "Prospect Found", at: 8.1, icon: "icons/magnifier.svg" }, { text: "Email Sent", at: 9.0, icon: "icons/document.svg" }, { text: "Reply Received", at: 10.0, icon: "icons/check.svg", color: "mint" }] }
  },
  {
    type: "profile_cards",
    use_for:
      "Real people/clients as cards. mode 'cascade': 2-4 cards (avatar + name + role + optional pill) staggered diagonally, landing per beat — good for 'we hire for X, Y, Z' or testimonials. mode 'grid': many compact client cards multiply into a grid, with an optional total card that counts up ('Total Monthly Revenue $6,000') — good for scale/social proof.",
    avoid_when: "Fabricated people or avatars. Cascade with more than 4 (use grid). Grid total value that isn't real.",
    params:
      '{ "type": "profile_cards", "start", "end", "mode": "cascade|grid", "items": [{"name", "role?", "avatar?", "pill?", "value?", "at"}], "total?": {"label", "value": "$6,000", "at"} }',
    density: "One card per beat (cascade) or rapid stagger (grid); the total card lands last and rolls up.",
    example: { type: "profile_cards", start: 14, end: 18, mode: "cascade", items: [{ name: "Maya Chen", role: "Head of Growth", at: 14.2, pill: "Hiring" }, { name: "Sofia Patel", role: "Performance Marketer", at: 15.1 }] }
  },
  {
    type: "magnifier",
    use_for: "Inspecting a detail in a real screenshot: a glass magnifying lens glides across the screenshot and reveals a key phrase in prism/rainbow text inside the lens. Use to call out one line in a job post, dashboard, or UI.",
    avoid_when: "No real screenshot. Generated proof-card SVGs such as shots/proof-*.svg; use screenshot_pile or artifact_grid for those. The phrase is invented. More than one phrase (that's two scenes).",
    params: '{ "type": "magnifier", "start", "end", "src": "<real screenshot>", "text": "the phrase the lens reveals", "from?": {"x":0-1,"y":0-1}, "to?": {"x":0-1,"y":0-1} }',
    density: "The lens glides for the whole scene (continuous motion); keep it 2.5-4s.",
    example: { type: "magnifier", start: 4, end: 7.5, src: "shots/job-post.png", text: "Meta/Google ad management", from: { x: 0.3, y: 0.25 }, to: { x: 0.6, y: 0.7 } }
  },
  {
    type: "artifact_grid",
    use_for:
      "Launchclip proof board: generated MP4, thumbnail, captions, review packet, render plan, dry-run payload, or other real workspace artifacts. Use when the script says the output is a packet or receipts before posting.",
    avoid_when: "The artifact path is not generated or expected by Launchclip. More than 6 items; split into a second proof scene.",
    params: '{ "type": "artifact_grid", "start", "end", "title?": "proof board", "items": [{"label", "path", "at", "status?": "ready", "src?": "<optional real preview image>"}] }',
    density: "One artifact card lands every 0.4-0.8s; final card can be mint/success via status.",
    example: { type: "artifact_grid", start: 18, end: 23, title: "receipts", items: [{ label: "script", path: "video/script.json", at: 18.2 }, { label: "captions", path: "captions/*.md", at: 19.0 }, { label: "review", path: "REVIEW.md", at: 20.0, status: "ready" }] }
  },
  {
    type: "chart",
    use_for:
      "Deterministic data visualizations: bar, stacked_bar, line, area, donut, scatter, gauge, funnel, matrix, sparkline, stat_counter, comparison_table. Use when the script includes explicit numbers, comparisons, or measured change.",
    avoid_when: "No explicit data/source/claim status. Do not freehand invented graphs. Avoid tiny axes, crowded labels, or more than 24 data points.",
    params:
      '{ "type": "chart", "start", "end", "chart_type": "bar|line|area|donut|scatter|gauge|funnel|matrix|sparkline|stat_counter|comparison_table", "title", "x_label?", "y_label?", "source?", "claim_status?", "data": [{"label", "value", "series?", "at"}] }',
    density: "Axis draws first; one mark/value lands per data point every 0.35-0.6s; labels settle last.",
    example: { type: "chart", start: 12, end: 16, chart_type: "bar", title: "Review packet outputs", x_label: "artifact", y_label: "count", source: "launchclip workspace", data: [{ label: "brief", value: 1, at: 12.2 }, { label: "captions", value: 4, at: 12.8 }, { label: "review", value: 1, at: 13.4 }] }
  },
  {
    type: "diagram",
    use_for:
      "Interconnected systems and explanations: directed_graph, hub_spoke, pipeline, swimlane, feedback_loop, architecture_layers, causal_chain, comparison_split. Nodes and connectors are explicit so lines attach to real endpoints and animate on beat.",
    avoid_when: "Labels are vague filler, nodes have no real relationship, or connectors reference missing endpoints. Use icon_flow for very small linear chains.",
    params:
      '{ "type": "diagram", "start", "end", "diagram_type": "directed_graph|hub_spoke|pipeline|swimlane|feedback_loop|architecture_layers|causal_chain|comparison_split", "title?", "nodes": [{"id", "label", "at", "x?", "y?", "icon?", "color?"}], "connectors": [{"from", "to", "label?", "style": "solid|dotted|curved|loopback|warning|success", "at"}] }',
    density: "Nodes enter first; connectors draw only after both endpoints exist; moving nodes should pull connectors with them.",
    example: { type: "diagram", start: 16, end: 21, diagram_type: "pipeline", title: "launch flow", nodes: [{ id: "demo", label: "Demo proof", at: 16.2 }, { id: "plan", label: "Video plan", at: 16.8 }, { id: "review", label: "Human review", at: 17.4, color: "mint" }], connectors: [{ from: "demo", to: "plan", at: 17.0 }, { from: "plan", to: "review", style: "success", at: 17.8 }] }
  },
  {
    type: "terminal_receipt",
    use_for:
      "Real demo command proof: command text, short terminal output, and pass/fail receipt badge. Use for the first concrete proof beat after the hook.",
    avoid_when: "No real demo command/output exists. Do not invent terminal text.",
    params: '{ "type": "terminal_receipt", "start", "end", "command": "npm run smoke", "output?": "short real output", "status?": "passed|failed", "at": word_start }',
    density: "Command types for the whole scene; receipt badge lands on at and terminal output wipes in after it.",
    example: { type: "terminal_receipt", start: 5, end: 8.5, command: "npm run smoke", output: "Smoke OK", status: "passed", at: 5.2 }
  }
];

export const EVENT_CATALOG = [
  {
    type: "punch_zoom",
    use_for: "Camera focus on the key element while it works (the prompt typing, the payoff node). Go close on focal cards — 1.15-1.25 when the element fills the frame, 1.06-1.12 for a gentle lean-in. At most one per scene; never within 0.5s of a scene boundary — the cut is already the accent.",
    params: '{ "type": "punch_zoom", "start", "end", "scale": 1.05-1.25, "origin_x?", "origin_y?", "sfx?": null_to_silence }'
  },
  {
    type: "logo_pop",
    use_for: "A brand/product icon card flying in from depth over a scene when the entity is spoken, with a label pill. Use over footage scenes; graphic scenes usually carry their own icons.",
    params: '{ "type": "logo_pop", "start", "end", "src": "<icon>", "label?", "x": 0-1, "y": 0-1, "size": 0.1-0.3 }'
  }
];

// Travel transitions were retired in the 4e feedback pass: every scene cuts
// in immediately (silent, with a gentle settle) and the next composition's
// builds start at once. The "transition" field is still accepted for legacy
// timelines but the renderer ignores it.
export const TRANSITION_CATALOG = [
  { type: "cut", use_for: "Every scene change: instant and silent — the new composition is on screen immediately and its builds carry the motion. (Travel swipes/zooms and the boundary whoosh are retired; don't author them.)" }
];

// Compact text rendering for the Director's system prompt.
export function renderCatalog() {
  const scenes = SCENE_CATALOG.map(
    (entry) =>
      `### ${entry.type}\nUSE FOR: ${entry.use_for}\nAVOID: ${entry.avoid_when}\nPARAMS: ${entry.params}\nDENSITY: ${entry.density}\nEXAMPLE: ${JSON.stringify(entry.example)}`
  ).join("\n\n");
  const events = EVENT_CATALOG.map((entry) => `### ${entry.type}\nUSE FOR: ${entry.use_for}\nPARAMS: ${entry.params}`).join("\n\n");
  const transitions = TRANSITION_CATALOG.map((entry) => `- ${entry.type}: ${entry.use_for}`).join("\n");
  const stats = objectCatalogStats();
  return `## Scene types\n\n${scenes}\n\n## Reusable motion object library\n\n${stats.total} reusable objects across ${Object.keys(stats.categories).length} categories. The Director may reference object IDs in scene intent, composition, media_slots, motion_grammar, or future object timelines; renderers own the exact drawing and lifecycle.\n\n${renderObjectCatalog()}\n\n## Overlay events\n\n${events}\n\n## Transitions\n${transitions}\n\n## Timeline-level: chapters\nOptional persistent progress rail across the top: "chapters": [{"title": "Intro", "at": 0}, ...] (2-6 entries, short titles, at = chapter start time). Use for listicles, multi-step education, and any video with named sections. Omit for single-thought videos.`;
}

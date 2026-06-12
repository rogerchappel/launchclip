// The component catalog: machine-readable metadata for every scene type,
// event, and transition the renderer supports. The Director's system prompt
// is generated from this file — adding a component here extends the
// Director's vocabulary with no prompt rewrites. Keep entries honest: only
// describe what the renderer actually does.

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
    density: "Footage is continuously alive; pair with a punch_zoom on the key moment.",
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
    use_for: "The exact command or AI prompt the subject runs, typing onto a dark chat-input card with a mint glow. For CLI tools and AI products the prompt IS the demo.",
    avoid_when: "The text is invented — only real commands/prompts. Longer than ~90 characters.",
    params: '{ "type": "prompt_card", "start", "end", "text": "<the real command or prompt>" }',
    density: "Typing animation + typing SFX run for the scene duration; continuously alive.",
    example: { type: "prompt_card", start: 5.9, end: 8.4, text: "launchclip run ./my-oss-tool" }
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
    use_for: "Pipelines, integrations, before→after chains: brand-icon cards connected by dotted lines, building vertically as each node is spoken. Final node may be the payoff (mint).",
    avoid_when: "More than 4 nodes. Node labels longer than ~4 words.",
    params: '{ "type": "icon_flow", "start", "end", "items": [{"text": "label", "at", "src?": "<icon image>", "color?"}] }',
    density: "Node + connector per item; arrive by zoom-from-depth. When no brand asset fits, use the generic icons (icons/globe.svg, browser, server, database, document, gear, magnifier, clock, check, lightning, laptop, cloud) — real shapes beat text-only nodes.",
    example: { type: "icon_flow", start: 11.1, end: 15.0, items: [{ text: "your demo", at: 11.2, src: "logos/terminal.svg" }, { text: "ready to post", at: 14.0, color: "mint" }] }
  },
  {
    type: "card_steps",
    use_for: "Numbered how-to beats, checklists, 'N things' structures: white chips with mint numerals stacking as each is spoken.",
    avoid_when: "More than 5 items (split into two scenes); item text longer than ~6 words.",
    params: '{ "type": "card_steps", "start", "end", "title?": "script-italic kicker", "items": [{"text", "at"}] }',
    density: "One chip + click SFX per item.",
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
  }
];

export const EVENT_CATALOG = [
  {
    type: "punch_zoom",
    use_for: "Camera focus on the key element while it works (the prompt typing, the payoff node). At most one per scene; never within 0.5s of a scene boundary — the cut is already the accent.",
    params: '{ "type": "punch_zoom", "start", "end", "scale": 1.05-1.14, "origin_x?", "origin_y?", "sfx?": null_to_silence }'
  },
  {
    type: "logo_pop",
    use_for: "A brand/product icon card flying in from depth over a scene when the entity is spoken, with a label pill. Use over footage scenes; graphic scenes usually carry their own icons.",
    params: '{ "type": "logo_pop", "start", "end", "src": "<icon>", "label?", "x": 0-1, "y": 0-1, "size": 0.1-0.3 }'
  }
];

export const TRANSITION_CATALOG = [
  { type: "cut", use_for: "Chapter breaks — a new line of thought. Silent, with a gentle settle." },
  { type: "swipe_left", use_for: "The default forward move: camera travels right across the tabletop; paper parallaxes; whoosh." },
  { type: "swipe_right", use_for: "Going back / contrast (use sparingly)." },
  { type: "zoom_into", use_for: "Focusing in on a detail or artifact: dolly-through with blur. Good into prompt_card and CTA scenes." }
];

// Compact text rendering for the Director's system prompt.
export function renderCatalog() {
  const scenes = SCENE_CATALOG.map(
    (entry) =>
      `### ${entry.type}\nUSE FOR: ${entry.use_for}\nAVOID: ${entry.avoid_when}\nPARAMS: ${entry.params}\nDENSITY: ${entry.density}\nEXAMPLE: ${JSON.stringify(entry.example)}`
  ).join("\n\n");
  const events = EVENT_CATALOG.map((entry) => `### ${entry.type}\nUSE FOR: ${entry.use_for}\nPARAMS: ${entry.params}`).join("\n\n");
  const transitions = TRANSITION_CATALOG.map((entry) => `- ${entry.type}: ${entry.use_for}`).join("\n");
  return `## Scene types\n\n${scenes}\n\n## Overlay events\n\n${events}\n\n## Transitions (scene.transition = how a scene ENTERS)\n${transitions}\n\n## Timeline-level: chapters\nOptional persistent progress rail across the top: "chapters": [{"title": "Intro", "at": 0}, ...] (2-6 entries, short titles, at = chapter start time). Use for listicles, multi-step education, and any video with named sections. Omit for single-thought videos.`;
}

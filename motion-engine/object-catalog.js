// Reusable motion object vocabulary for Director and HyperFrames handoff.
// These are object-level primitives below scene types: the Director chooses
// intent from this catalog; renderers own exact drawing, layout, and motion.

const CATEGORY_DEFAULTS = {
  product_ui: { motion: "enter -> settle -> focus -> exit", sfx: ["soft-whoosh", "interface-tick"] },
  workflow_proof: { motion: "enter -> stack -> stamp -> settle", sfx: ["paper-hit", "check-tick"] },
  brand_media: { motion: "pop-from-depth -> connect -> settle", sfx: ["logo-pop", "soft-thump"] },
  diagram: { motion: "node-enter -> connector-draw -> reflow -> emphasize", sfx: ["connector-pop", "line-draw"] },
  chart: { motion: "axis-draw -> mark-rise -> label-settle -> value-emphasize", sfx: ["chart-rise", "data-tick"] },
  motion_prop: { motion: "glide -> inspect -> focus -> release", sfx: ["camera-tick", "inspection-pop"] },
  review_proof: { motion: "flip-in -> inspect -> status-stamp -> hold", sfx: ["paper-flip", "success-ding"] },
  creator_text: { motion: "word-build -> accent-snap -> drift -> exit", sfx: ["caption-hit", "typing-tick"] },
  sfx_effect: { motion: "trigger -> decay", sfx: ["mapped-by-event"] }
};

function object(id, category, useFor, tags = [], overrides = {}) {
  const defaults = CATEGORY_DEFAULTS[category];
  return {
    id,
    category,
    use_for: useFor,
    tags,
    params: overrides.params ?? ["x", "y", "width", "height", "label?", "state?"],
    states: overrides.states ?? ["enter", "settle", "transform", "emphasize", "exit"],
    default_motion: overrides.default_motion ?? defaults.motion,
    sfx_hooks: overrides.sfx_hooks ?? defaults.sfx,
    constraints: overrides.constraints ?? [
      "must fit 9:16 safe areas",
      "must expose readable labels",
      "must not fabricate product evidence"
    ]
  };
}

const PRODUCT_UI = [
  ["browser_window", "A framed web page or product screen with toolbar chrome.", ["ui", "screen"]],
  ["mobile_device", "A phone-shaped product capture frame.", ["ui", "mobile"]],
  ["desktop_device", "A laptop or desktop monitor frame for screen proof.", ["ui", "desktop"]],
  ["terminal_panel", "A command-line proof panel with monospace output.", ["terminal", "proof"]],
  ["code_block", "A syntax-highlighted source snippet or diff excerpt.", ["code", "developer"]],
  ["file_tree", "A repository or artifact file list.", ["files", "repo"]],
  ["command_palette", "A floating command launcher or AI command box.", ["prompt", "ui"]],
  ["modal_dialog", "A focused confirmation, warning, or setup modal.", ["ui", "modal"]],
  ["sidebar_nav", "A product navigation rail with active item.", ["ui", "nav"]],
  ["dashboard_panel", "A metrics or status panel.", ["ui", "dashboard"]],
  ["table_grid", "A dense tabular data surface.", ["ui", "data"]],
  ["settings_panel", "A configuration form with toggles and fields.", ["ui", "settings"]],
  ["chat_composer", "A prompt or chat input with send button and asset chips.", ["prompt", "ai"]],
  ["chat_bubble", "A single message bubble in a conversation mockup.", ["chat", "message"]],
  ["notification_toast", "A transient success or warning toast.", ["ui", "status"]],
  ["progress_bar", "A thin deterministic progress indicator.", ["progress", "timing"]]
];

const WORKFLOW_PROOF = [
  ["folder_stack", "A physical folder stack for a launch packet.", ["files", "physical"]],
  ["document_stack", "A pile of generated docs or review artifacts.", ["docs", "proof"]],
  ["receipt_card", "A command/result receipt with timestamp and status.", ["receipt", "proof"]],
  ["approval_stamp", "A visible human-review approval mark.", ["approval", "review"]],
  ["warning_stamp", "A visible blocked or needs-review mark.", ["warning", "review"]],
  ["checklist_chip", "A compact checked step item.", ["steps", "checklist"]],
  ["timeline_strip", "A horizontal or vertical edit timeline.", ["timeline", "editing"]],
  ["playhead_marker", "A timeline playhead that sweeps across lanes.", ["timeline", "motion"]],
  ["cursor_trail", "A cursor path showing interaction intent.", ["cursor", "interaction"]],
  ["timer_badge", "A small elapsed-time or countdown badge.", ["timer", "proof"]],
  ["diff_card", "A before/after code or content diff tile.", ["diff", "developer"]],
  ["artifact_tile", "A generic generated file or output tile.", ["artifact", "proof"]],
  ["thumbnail_card", "A video thumbnail preview card.", ["thumbnail", "media"]],
  ["caption_card", "A social caption or subtitle artifact card.", ["caption", "artifact"]],
  ["render_plan_card", "A render-plan JSON/brief summary card.", ["render", "artifact"]],
  ["dry_run_payload", "A product-videogen dry-run payload proof card.", ["dry-run", "review"]]
];

const BRAND_MEDIA = [
  ["logo_card", "A brand logo in a physical card.", ["brand", "logo"]],
  ["app_icon_chip", "A rounded app icon token.", ["brand", "icon"]],
  ["repo_lockup", "Repository name, URL, and proof status lockup.", ["repo", "brand"]],
  ["avatar_card", "A real or approved avatar/person card.", ["person", "avatar"]],
  ["presenter_window", "A talking-head media window inside the paper world.", ["presenter", "video"]],
  ["testimonial_card", "A short quote plus attribution card.", ["quote", "social-proof"]],
  ["social_post_card", "A platform-style post preview.", ["social", "caption"]],
  ["video_clip_card", "A framed short video or B-roll clip.", ["video", "media"]],
  ["audio_waveform", "A voiceover or SFX waveform strip.", ["audio", "timeline"]],
  ["music_bed_chip", "A small music-state token.", ["audio", "music"]],
  ["brand_palette_strip", "A row of brand color swatches.", ["brand", "color"]],
  ["font_specimen", "A typography specimen card.", ["brand", "type"]]
];

const DIAGRAMS = [
  ["diagram_node", "A labeled graph node.", ["diagram", "node"]],
  ["hub_node", "A central system or product hub.", ["diagram", "hub"]],
  ["source_node", "A starting input/source node.", ["diagram", "source"]],
  ["target_node", "A final output/payoff node.", ["diagram", "target"]],
  ["solid_connector", "A solid directed line between two nodes.", ["diagram", "connector"]],
  ["dotted_connector", "A dotted relationship or async connector.", ["diagram", "connector"]],
  ["curved_connector", "A curved path for loops or side branches.", ["diagram", "connector"]],
  ["loopback_arrow", "A feedback loop connector.", ["diagram", "loop"]],
  ["swimlane_band", "A horizontal/vertical lane for actors or stages.", ["diagram", "swimlane"]],
  ["pipeline_stage", "A process stage block.", ["diagram", "pipeline"]],
  ["branch_choice", "A fork/decision point.", ["diagram", "decision"]],
  ["funnel_step", "A tapered process/funnel step.", ["diagram", "funnel"]],
  ["architecture_layer", "A stacked technical architecture layer.", ["diagram", "architecture"]],
  ["dependency_edge", "A dependency relationship line.", ["diagram", "dependency"]],
  ["causal_arrow", "A cause-to-effect arrow.", ["diagram", "causal"]],
  ["comparison_column", "A before/after comparison column.", ["diagram", "comparison"]],
  ["system_boundary", "A boundary box around related nodes.", ["diagram", "system"]],
  ["data_packet", "A moving packet travelling along a connector.", ["diagram", "data"]]
];

const CHARTS = [
  ["bar_chart", "A categorical bar chart with labeled values.", ["chart", "bar"]],
  ["stacked_bar_chart", "A stacked categorical comparison chart.", ["chart", "bar"]],
  ["line_chart", "A time-series line chart.", ["chart", "line"]],
  ["area_chart", "A cumulative area chart.", ["chart", "area"]],
  ["donut_chart", "A simple part-to-whole chart.", ["chart", "donut"]],
  ["scatter_plot", "A two-axis dot plot.", ["chart", "scatter"]],
  ["gauge_chart", "A progress or score gauge.", ["chart", "gauge"]],
  ["funnel_chart", "A conversion or process funnel chart.", ["chart", "funnel"]],
  ["matrix_chart", "A 2x2 or scored matrix.", ["chart", "matrix"]],
  ["sparkline", "A small trend line embedded in a card.", ["chart", "sparkline"]],
  ["stat_counter", "An oversized animated number.", ["chart", "stat"]],
  ["comparison_table", "A compact side-by-side data table.", ["chart", "table"]]
];

const MOTION_PROPS = [
  ["magnifier_lens", "A lens that zooms real screenshot details.", ["inspection", "lens"]],
  ["spotlight_cone", "A soft light/focus cone.", ["focus", "lighting"]],
  ["highlight_ring", "A ring around the active object.", ["focus", "highlight"]],
  ["crop_frame", "A moving crop/selection rectangle.", ["inspection", "crop"]],
  ["zoom_lens", "A circular or rectangular zoom callout.", ["inspection", "zoom"]],
  ["glow_rim", "A travelling rim light around a card.", ["light", "glow"]],
  ["motion_blur_ghost", "A ghost trail for fast travel.", ["motion", "blur"]],
  ["depth_shadow", "A depth-aware physical shadow.", ["depth", "shadow"]],
  ["paper_grid_plane", "A warm paper/grid background plane.", ["background", "paper"]],
  ["focus_blur_ring", "A frame-edge blur/focus falloff.", ["focus", "blur"]],
  ["pointer_arrow", "A directional pointer or callout arrow.", ["pointer", "callout"]],
  ["confetti_sparks", "Tiny restrained success sparks.", ["success", "accent"]]
];

const REVIEW_PROOF = [
  ["claim_citation", "A claim/source citation chip.", ["claim", "citation"]],
  ["source_badge", "A source/provenance badge.", ["source", "proof"]],
  ["qa_report_card", "A QA result card.", ["qa", "review"]],
  ["lint_result_card", "A lint result card.", ["lint", "review"]],
  ["test_receipt", "A test run receipt card.", ["test", "proof"]],
  ["build_status_badge", "A build/pass/fail badge.", ["ci", "status"]],
  ["missing_asset_tag", "A visible missing-asset warning tag.", ["asset", "warning"]],
  ["human_decision_card", "A card showing a needed approval/choice.", ["human", "review"]],
  ["rollback_note", "A concise rollback plan note.", ["rollback", "review"]],
  ["risk_level_chip", "A low/medium/high risk chip.", ["risk", "review"]]
];

const CREATOR_TEXT = [
  ["word_group", "A short kinetic caption group.", ["caption", "type"]],
  ["emphasis_word", "One larger accent word.", ["caption", "emphasis"]],
  ["chapter_rail", "A persistent top progress rail.", ["chapter", "progress"]],
  ["progress_dot", "A chapter or step dot.", ["progress", "chapter"]],
  ["lower_third", "A restrained presenter lower-third.", ["presenter", "text"]],
  ["cta_lockup", "A final call-to-action composition.", ["cta", "final"]],
  ["section_number", "A large numbered section marker.", ["section", "number"]],
  ["quote_pull", "A pulled quote phrase.", ["quote", "type"]],
  ["caption_stack", "A compact stack of caption fragments.", ["caption", "stack"]],
  ["title_slam", "A large first-frame title hit.", ["title", "hook"]]
];

const SFX_EFFECTS = [
  ["whoosh_hit", "A short layout-change whoosh.", ["sfx", "whoosh"]],
  ["paper_thump", "A physical card landing sound.", ["sfx", "paper"]],
  ["typing_tick", "A keystroke or cursor tick.", ["sfx", "typing"]],
  ["connector_pop", "A line/node connection pop.", ["sfx", "diagram"]],
  ["chart_tick", "A data mark landing tick.", ["sfx", "chart"]],
  ["success_chime", "A quiet success/approval chime.", ["sfx", "success"]],
  ["warning_tap", "A soft warning/status tap.", ["sfx", "warning"]],
  ["inspection_click", "A magnifier/focus camera tick.", ["sfx", "inspection"]]
];

function fromRows(rows, category) {
  return rows.map(([id, useFor, tags]) => object(id, category, useFor, tags));
}

export const MOTION_OBJECT_CATALOG = [
  ...fromRows(PRODUCT_UI, "product_ui"),
  ...fromRows(WORKFLOW_PROOF, "workflow_proof"),
  ...fromRows(BRAND_MEDIA, "brand_media"),
  ...fromRows(DIAGRAMS, "diagram"),
  ...fromRows(CHARTS, "chart"),
  ...fromRows(MOTION_PROPS, "motion_prop"),
  ...fromRows(REVIEW_PROOF, "review_proof"),
  ...fromRows(CREATOR_TEXT, "creator_text"),
  ...fromRows(SFX_EFFECTS, "sfx_effect")
];

export function objectCatalogStats(catalog = MOTION_OBJECT_CATALOG) {
  const categories = new Map();
  for (const entry of catalog) {
    categories.set(entry.category, (categories.get(entry.category) ?? 0) + 1);
  }
  return {
    total: catalog.length,
    categories: Object.fromEntries([...categories.entries()].sort(([left], [right]) => left.localeCompare(right))),
    charts: catalog.filter((entry) => entry.category === "chart").length,
    diagrams: catalog.filter((entry) => entry.category === "diagram").length
  };
}

export function renderObjectCatalog(catalog = MOTION_OBJECT_CATALOG) {
  const grouped = new Map();
  for (const entry of catalog) {
    if (!grouped.has(entry.category)) grouped.set(entry.category, []);
    grouped.get(entry.category).push(entry);
  }
  return [...grouped.entries()]
    .map(([category, entries]) => {
      const body = entries
        .map((entry) => `- ${entry.id}: ${entry.use_for} Motion: ${entry.default_motion}. SFX: ${entry.sfx_hooks.join(", ")}.`)
        .join("\n");
      return `### ${category} (${entries.length})\n${body}`;
    })
    .join("\n\n");
}

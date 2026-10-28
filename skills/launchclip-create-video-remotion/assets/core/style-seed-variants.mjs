// The module variant lists each generator version draws from
// (docs/SEEDED_STYLES_RFC.md §3.1: one seed and one generator version always
// give one pack). A seed picks a module's variant by its place in the list,
// so adding a module or a variant to the catalogue would change saved looks
// if the generator read the live catalogue. Each version reads its own frozen
// list instead; a new variant reaches seeded styles with the next version.
// test/style_variants.test.js checks every name here still exists in
// kit/core/modules.mjs moduleVariants().
//
// Pure ESM, no imports. Canonical copy: kit/core/style-seed-variants.mjs.

const freeze = (table) => Object.freeze(Object.fromEntries(Object.entries(table).map(([id, names]) => [id, Object.freeze(names)])));

// launchclip.style-seed.v1: the catalogue as of 2026-10-26.
export const V1_MODULE_VARIANTS = freeze({
  checklist: ['panel', 'flat', 'outline', 'banner'],
  'step-rail': ['panel', 'flat', 'outline', 'banner'],
  metric: ['panel', 'flat', 'outline', 'banner'],
  callout: ['panel', 'flat', 'outline', 'banner'],
  'hook-title': ['centered', 'flush', 'boxed', 'low'],
  cta: ['centered', 'flush', 'boxed', 'low'],
  'concept-card': ['stacked', 'side-icon', 'banner', 'marker'],
  'icon-row': ['tiles', 'pills', 'orbit', 'list'],
  'section-card': ['centered', 'split', 'tab', 'frame'],
  'object-card': ['stage', 'polaroid', 'split', 'spotlight'],
  'stat-card': ['giant', 'ring', 'bar', 'ticker'],
  'quote-card': ['mark', 'pull', 'bubble', 'centered'],
  excerpt: ['window', 'terminal', 'document', 'stack'],
  compare: ['panels', 'split', 'table', 'cards'],
  timeline: ['rail', 'milestones', 'cards', 'stairs'],
  'bar-chart': ['columns', 'bars', 'lollipop', 'blocks'],
  'stacked-bar': ['columns', 'bars'],
  'pie-chart': ['donut', 'pie', 'half'],
  'area-chart': ['gradient', 'line', 'steps'],
  'radar-chart': ['polygon', 'circles', 'dots'],
  sparkline: ['line', 'area', 'bars'],
  'progress-ring': ['ring', 'thick', 'segmented', 'half'],
  'funnel-chart': ['tapered', 'bars', 'steps'],
  waterfall: ['bridge', 'floating'],
  sankey: ['ribbons', 'lines'],
  heatmap: ['squares', 'circles', 'rounded'],
  leaderboard: ['bars', 'rows', 'cards'],
  'comparison-table': ['grid', 'striped', 'cards'],
  odometer: ['plain', 'tiles', 'mechanical'],
  'flip-clock': ['classic', 'brand', 'light'],
  'ticker-tape': ['band', 'minimal', 'led'],
  'slot-roll': ['window', 'inline', 'stack'],
  countdown: ['digits', 'ring', 'clock'],
  'percent-fill': ['liquid', 'battery', 'bar'],
  'device-frame': ['clay', 'dark', 'outline'],
  'window-chrome': ['mac', 'minimal', 'terminal'],
  polaroid: ['single', 'stack', 'pinned'],
  sticker: ['die-cut', 'round', 'burst'],
  'torn-paper': ['note', 'strip', 'scrap'],
  'tape-note': ['corners', 'top', 'sides'],
  badge: ['starburst', 'circle', 'shield'],
  ribbon: ['banner', 'flag', 'tag'],
  'speech-bubble': ['rounded', 'comic', 'chat'],
  tooltip: ['dark', 'light', 'brand'],
  'callout-arrow': ['curve', 'straight', 'sketch'],
  'motion-title': ['per-character-rise', 'soft-blur-in', 'typewriter', 'bottom-up-letters', 'top-down-letters', 'stagger-from-center', 'stagger-from-edges', 'per-word-crossfade', 'spring-scale-in', 'shared-axis-y', 'blur-out-up', 'kinetic-center-build', 'short-slide-right', 'short-slide-down', 'depth-parallax-words', 'mask-reveal-up', 'line-by-line-slide', 'micro-scale-fade', 'shimmer-sweep', 'fade-through', 'shared-axis-z', 'scale-down-fade', 'focus-blur-resolve', 'shared-axis-x'],
  'icon-grid': ['stroke', 'duotone', 'tiles'],
  'map-highlight': ['fill', 'pins', 'glow', 'outline', 'dots'],
  'unit-grid': ['solid', 'stroke', 'dots'],
  'number-line': ['ruler', 'track'],
  'social-post': ['glass', 'native', 'light'],
  'social-stack': ['cascade', 'list'],
  'logo-sting': ['rain', 'particles', 'clear'],
  'subscribe-cta': ['pill', 'compact'],
  'channel-watermark': ['glass', 'bare'],
  'repo-pr-card': ['glass', 'github'],
  'commit-card': ['glass', 'github'],
  'diff-view': ['glass', 'github'],
  'evidence-chain': ['glass', 'github'],
  'date-pinned-timeline': ['axis', 'summary'],
  'terminal-session': ['glass', 'solid'],
  'dot-field': ['pull-back', 'still'],
  'particle-text': ['led', 'dust'],
  'particle-logo': ['ring', 'halo'],
  'particle-cloud': ['stairs', 'single'],
  'grid-race': ['columns', 'stacked'],
  'cell-grid': ['bars', 'blocks'],
  tokenizer: ['panel', 'bare'],
  'glass-bars-3d': ['bars', 'staircase'],
  'coin-stack': ['coins', 'cylinders'],
  'rack-shelf': ['rack', 'rail'],
  'device-box': ['server', 'appliance'],
  'paper-stack': ['sections', 'books', 'folder'],
  'planet-family': ['track', 'lineup'],
  'scatter-plot': ['dots', 'bubbles', 'rings'],
  'race-bars': ['bars', 'lanes'],
  'small-multiples': ['glass', 'flat'],
  'date-carousel': ['glass', 'flat'],
  'month-grid': ['glass', 'flat'],
  'person-id': ['pill', 'card'],
  'lineage-graph': ['circles', 'frames'],
  equation: ['plain', 'glass'],
  'title-decompose': ['chips', 'underline'],
  'feynman-diagram': ['glow', 'ink']
});

// launchclip.style-seed.v2: v1 plus the lower-third variants.
export const V2_MODULE_VARIANTS = freeze({
  ...V1_MODULE_VARIANTS,
  'lower-third': ['bar', 'band', 'pill', 'outline']
});

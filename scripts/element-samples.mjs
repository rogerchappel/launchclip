// Sample params for every catalogue H module (kit/core/catalog-h.mjs): the
// data the parity fixtures and the contact sheets draw. Every optional part
// a variant draws is filled in.

export const SAMPLES = Object.freeze({
  'bar-chart': {title: 'Weekly renders by format', data: [{label: 'Shorts', value: 1240}, {label: 'Reels', value: 980}, {label: 'TikTok', value: 1610}, {label: 'YouTube', value: 620}, {label: 'LinkedIn', value: 310}], highlight: 2, source: 'LaunchClip telemetry, Oct 2026'},
  'stacked-bar': {title: 'Minutes per video', categories: ['Plan', 'Edit', 'Caption', 'Export'], series: [{label: 'By hand', values: [18, 64, 22, 9]}, {label: 'Assisted', values: [6, 14, 3, 4]}], format: {unit: 'min'}},
  'pie-chart': {title: 'Where viewers find us', data: [{label: 'Shorts feed', value: 46}, {label: 'Search', value: 24}, {label: 'Shares', value: 18}, {label: 'Other', value: 12}], center: {label: 'Views'}, format: {compact: true}},
  'area-chart': {title: 'Monthly active creators', labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'], series: [{label: 'Creators', values: [1.2, 1.6, 2.1, 2.0, 2.9, 3.6, 4.4, 5.3]}], format: {decimals: 1, suffix: 'K'}},
  'scatter-plot': {title: 'Length vs. retention', xLabel: 'VIDEO LENGTH (S)', yLabel: 'RETENTION %', points: [{x: 8, y: 92}, {x: 12, y: 88}, {x: 15, y: 84, size: 3}, {x: 21, y: 79}, {x: 26, y: 74, size: 2}, {x: 30, y: 71}, {x: 34, y: 63, size: 4}, {x: 41, y: 58}, {x: 45, y: 61}, {x: 52, y: 49, size: 2}, {x: 58, y: 44}, {x: 60, y: 40, size: 5}], trend: true, highlight: 2, },
  'radar-chart': {title: 'How the tools compare', axes: ['Speed', 'Quality', 'Captions', 'Formats', 'Price', 'Brand fit'], series: [{label: 'LaunchClip', values: [9, 8, 9, 10, 8, 9]}, {label: 'Manual edit', values: [3, 9, 4, 5, 6, 7]}], max: 10},
  'sparkline': {label: 'Weekly sign-ups', values: [120, 132, 128, 151, 149, 172, 168, 190, 214, 236], source: 'Product analytics, last 10 weeks'},
  'progress-ring': {value: 87, label: 'of renders pass first time', sub: 'LaunchClip eval, Oct 2026'},
  'funnel-chart': {title: 'Launch week funnel', stages: [{label: 'Viewed the Short', value: 48200}, {label: 'Opened the repo', value: 9600}, {label: 'Starred', value: 2900}, {label: 'Rendered a video', value: 860}], format: {compact: true, decimals: 1}},
  'waterfall': {title: 'Monthly render minutes', opening: {label: 'September', value: 4200}, steps: [{label: 'New users', delta: 1800}, {label: 'Shorts', delta: 950}, {label: 'Churn', delta: -620}, {label: 'Cache hits', delta: -410}], total: 'October', format: {compact: true, decimals: 1}},
  'sankey': {title: 'Where renders go', flows: [{from: 'Prompt', to: 'Motion', value: 520}, {from: 'Prompt', to: 'Voiceover', value: 310}, {from: 'Footage', to: 'Footage-led', value: 270}, {from: 'Motion', to: 'Shorts', value: 380}, {from: 'Motion', to: 'YouTube', value: 140}, {from: 'Voiceover', to: 'Shorts', value: 190}, {from: 'Voiceover', to: 'YouTube', value: 120}, {from: 'Footage-led', to: 'Shorts', value: 150}, {from: 'Footage-led', to: 'YouTube', value: 120}]},
  'heatmap': {title: 'Posts by day and hour', rows: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], columns: ['6a', '9a', '12p', '3p', '6p', '9p'], values: [[2, 8, 14, 9, 12, 5], [3, 9, 16, 11, 13, 6], [2, 11, 18, 12, 15, 7], [4, 10, 15, 13, 19, 9], [3, 7, 12, 10, 21, 14]], low: 'Quiet', high: 'Busy'},
  'leaderboard': {title: 'Top templates this week', entries: [{label: 'Product launch', value: 1840, detail: 'motion · 9:16', icon: 'rocket'}, {label: 'Changelog', value: 1210, detail: 'pr-to-video', icon: 'git-merge'}, {label: 'Explainer', value: 1530, detail: 'voiceover-motion', icon: 'lightbulb'}, {label: 'Talking head', value: 760, detail: 'footage-led', icon: 'mic'}, {label: 'Lyric video', value: 420, detail: 'music', icon: 'music'}]},
  'odometer': {value: 1284503, label: 'videos rendered with LaunchClip', sub: 'All time, Oct 2026'},
  'flip-clock': {values: ['2024', '2025', '2026'], label: 'Three launches, one workflow'},
  'ticker-tape': {tag: 'Live', title: 'Renders by format this hour', items: [{label: 'SHORTS', value: 1284, change: 12.4}, {label: 'REELS', value: 961, change: 8.1}, {label: 'TIKTOK', value: 1530, change: 15.2}, {label: 'YOUTUBE', value: 402, change: -3.6}, {label: 'LINKEDIN', value: 188, change: 2.2}]},
  'slot-roll': {prefix: 'Made for', items: ['founders', 'devrel', 'marketers', 'teachers', 'creators'], final: 'creators'},
  'countdown': {from: 3, end: 'Live', label: 'Launch in'},
  'percent-fill': {value: 72, label: 'of the backlog cleared', sub: 'Sprint 14'},
  'device-frame': {title: 'Your launch video, ready', url: 'launchclip.dev/studio', caption: 'Every format from one story'},
  'window-chrome': {title: 'launchclip — zsh', lines: ['launchclip story plan brief.md', 'launchclip finish --format 9:16', 'Rendered out/launch-9x16.mp4'], caption: 'Three commands to a Short'},
  'polaroid': {caption: 'Launch day, 2026', icon: 'rocket'},
  'sticker': {text: 'New', icon: 'sparkle'},
  'torn-paper': {kicker: 'Note to self', text: 'Ship the video the same day as the feature.'},
  'tape-note': {title: 'Remember the captions', text: 'Most people watch on mute, so every line is on screen.', icon: 'message'},
  'badge': {text: 'Free', sub: 'Open source', icon: 'star'},
  'ribbon': {text: 'Now in beta'},
  'speech-bubble': {text: 'Wait, it made all three formats?', name: 'Maya'},
  'tooltip': {title: 'New', text: 'Drop a recording here to cut it'},
  'callout-arrow': {text: 'Your brand colours'},
  'comparison-table': {title: 'How LaunchClip compares', columns: ['LaunchClip', 'Editor', 'Templates'], rows: [{label: 'One prompt to video', values: [true, false, false]}, {label: 'Your brand, every scene', values: [true, true, false]}, {label: 'Captions from the voice', values: [true, false, true]}, {label: 'Time to first cut', values: ['12 min', '2 days', '3 h']}, {label: 'Open source', values: [true, false, null]}], highlight: 0}
});

/** Extra parity cases beyond one per variant: {name, module, variant, shape, params}. */
export const EXTRA_SAMPLES = Object.freeze([
  {name: 'device-frame-laptop-image', module: 'device-frame', variant: 'dark', shape: 'landscape', params: {device: 'laptop', image: 'assets/testsrc.png', caption: 'A real screenshot in the frame'}},
  {name: 'speech-bubble-thought', module: 'speech-bubble', variant: 'comic', shape: 'portrait', params: {text: 'What if the video made itself?', type: 'thought', tail: 'bottom-right'}}
]);

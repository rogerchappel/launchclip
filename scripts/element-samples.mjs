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
  'motion-title': {kicker: 'Launch week', text: 'Ship the video with the feature', highlight: 'video', sub: 'One prompt, every format'},
  'icon-grid': {title: 'Everything in one prompt', items: [{icon: 'clapperboard', label: 'Scenes'}, {icon: 'captions', label: 'Captions'}, {icon: 'audio-waveform', label: 'Voice'}, {icon: 'palette', label: 'Brand'}, {icon: 'smartphone', label: 'Shorts'}, {icon: 'monitor-play', label: 'YouTube'}]},
  'map-highlight': {title: 'Where LaunchClip renders most', highlight: [{country: 'France', value: '18%'}, {country: 'Germany', value: '24%'}, {country: 'Spain', value: '9%'}, {country: 'UK', label: 'UK', value: '14%'}], source: 'Render logs, Oct 2026'},
  'unit-grid': {title: '49 trained lifters', count: 49, groups: [{count: 24, label: 'Heavy: 8–12 reps', tone: 'primary'}, {count: 25, label: 'Light: 20–25 reps', tone: 'accent'}]},
  'number-line': {from: 1, to: 25, unit: 'reps', ranges: [{from: 8, to: 12, label: '= SIZE', tone: 'good'}, {from: 15, to: 25, label: '= JUST CARDIO', tone: 'bad'}]},
  'social-post': {platform: 'x', name: 'Dana Demo', handle: 'demo_dana', verified: true, demo: true, text: 'Shipped the new render queue tonight. Every storyboard now previews in under a minute. Notes at example.com/changelog, and tell @demo_kai what breaks.', time: '6:06 AM', date: 'Oct 25, 2026', metrics: {replies: 1043, reposts: 169, likes: 5512, bookmarks: 169, views: 1000000}, highlight: 'previews in under a minute', focus: true},
  'social-stack': {posts: [{platform: 'x', name: 'Kai Example', handle: 'demo_kai', verified: true, demo: true, text: 'Really hoping the portrait cut ships alongside it', time: '8:00 AM', date: 'Oct 25, 2026', metrics: {replies: 34, reposts: 7, likes: 117, bookmarks: 12, views: 79200}}, {platform: 'x', name: 'Rho Demo', handle: 'demo_rho', demo: true, text: 'Another tool in the middle of the lineup. Please, no.', time: '8:47 AM', date: 'Oct 25, 2026', metrics: {replies: 192, reposts: 41, likes: 1300, bookmarks: 86, views: 79400}}, {platform: 'x', name: 'Lumen Demo Lab', handle: 'demo_lumen', verified: 'gold', demo: true, text: 'Wouldn\'t be surprised if we get this soon', time: '2:30 PM', date: 'Oct 19, 2026', metrics: {replies: 58, reposts: 40, likes: 772, bookmarks: 70, views: 237300}}], highlight: 'get this soon'},
  'social-sort': {columns: ['Can\'t wait', 'Tired'], posts: [{platform: 'x', name: 'Kai Example', handle: 'demo_kai', verified: true, demo: true, column: 0, text: 'Really hoping the portrait cut ships alongside it', time: '8:00 AM', date: 'Oct 25, 2026', metrics: {replies: 34, reposts: 7, likes: 117, views: 79200}}, {platform: 'x', name: 'Rho Demo', handle: 'demo_rho', demo: true, column: 1, text: 'Another tool in the middle of the lineup. Please, no.', time: '8:47 AM', date: 'Oct 25, 2026', metrics: {replies: 192, reposts: 41, likes: 1300, views: 79400}}, {platform: 'x', name: 'Lumen Demo Lab', handle: 'demo_lumen', verified: 'gold', demo: true, column: 0, text: 'Wouldn\'t be surprised if we get this soon', time: '2:30 PM', date: 'Oct 19, 2026', metrics: {replies: 58, reposts: 40, likes: 772, views: 237300}}]},
  'social-wall': {posts: [{platform: 'x', name: 'Deniz Demo', handle: 'demo_deniz', demo: true, translatedFrom: 'Turkish', text: 'We have reached the end of all work done by hand. Editing is still standing, though.', time: '11:46 AM', date: 'Oct 18, 2026', metrics: {reposts: 1, likes: 5, views: 640}}, {platform: 'x', name: 'Mira Demo', handle: 'demo_mira', demo: true, text: 'Motion designers, the storyboard is waiting for you :)', time: '11:55 PM', date: 'Oct 18, 2026', metrics: {likes: 3, views: 138}}, {platform: 'x', name: 'Kai Example', handle: 'demo_kai', verified: true, demo: true, text: 'Really hoping the portrait cut ships alongside it', time: '8:00 AM', date: 'Oct 25, 2026', metrics: {likes: 117, views: 79200}}, {platform: 'threads', name: 'Sam Demo', handle: 'demo.sam', demo: true, text: 'The captions finally land on the beat.', ago: '2h', metrics: {likes: 812, replies: 44}}, {platform: 'bluesky', name: 'Ivy Example', handle: 'ivy-demo.example.social', demo: true, text: 'Open source video tooling is having a moment.', ago: '5h', metrics: {likes: 240}}], focus: [0, 1], highlight: 'still standing'},
  'logo-sting': {name: 'Signal Lab', tagline: 'AI, explained weekly'},
  'subscribe-cta': {name: 'Signal Lab'},
  'channel-watermark': {name: 'Signal Lab'},
  // Code evidence: real public changes in rogerchappel/launchclip, mapped by src/evidence/github.js.
  'repo-pr-card': {repo: 'rogerchappel/launchclip', number: 88, title: 'feat: select and rotate fit-for-purpose free OpenRouter models', state: 'merged', author: {login: 'rogerchappel', avatar: 'assets/evidence/avatars/rogerchappel.jpg'}, date: '2026-07-17', file: 'src/intake.js', additions: 6, deletions: 5,
    lines: ['-  const model = String(flags.model ?? env.OPENAI_VIDEO_MODEL ?? (modelPolicy === "quality" ? "gpt-5.6" : "gpt-5.6-terra")).trim();', '+  const modelProvider = modelPolicy === "free" ? "openrouter" : "openai";', '+  const model = String(flags.model ?? (modelPolicy === "free" ? "openrouter/free" : env.OPENAI_VIDEO_MODEL ?? (modelPolicy === "quality" ? "gpt-5.6" : "gpt-5.6-terra"))).trim();', '   const resources = [];'],
    startLine: {old: 70, new: 70}, highlight: 'openrouter/free'},
  'commit-card': {repo: 'rogerchappel/launchclip', sha: 'c3ec4a1198b8', authors: [{login: 'rogerchappel', avatar: 'assets/evidence/avatars/rogerchappel.jpg'}, 'Claude Fable 5'], message: 'direct: default OpenAI model to gpt-5.5', date: '2026-06-13', file: 'src/director.js', additions: 4, deletions: 3,
    lines: ['-    // --model or OPENAI_MODEL.', '-    const model = flags.model || process.env.OPENAI_MODEL || "o4-mini";', '+    // fallback. Override via --model or OPENAI_MODEL.', '+    const model = flags.model || process.env.OPENAI_MODEL || "gpt-5.5";'], startLine: {old: 92, new: 93}, highlight: 'gpt-5.5'},
  'diff-view': {file: 'src/director.js', additions: 4, deletions: 3, startLine: {old: 90, new: 90}, highlight: 'gpt-5.5',
    lines: ['     // Default to a reasoning model: the strict density/word-grounding linter', '-    // needs it (gpt-4o/gpt-4.1 rarely pass in the repair budget). Override via', '-    // --model or OPENAI_MODEL.', '-    const model = flags.model || process.env.OPENAI_MODEL || "o4-mini";', '+    // needs it (gpt-4o/gpt-4.1 rarely pass in the repair budget). gpt-5.5', '+    // lands valid, lint-clean AND gap-free; o4-mini works as a cheaper', '+    // fallback. Override via --model or OPENAI_MODEL.', '+    const model = flags.model || process.env.OPENAI_MODEL || "gpt-5.5";', '     log(`provider: openai (${model})`);'],
    focus: [{row: 3}, {rows: [4, 6]}, {row: 7}]},
  'evidence-chain': {token: 'openrouter/free', sources: [
    {kind: 'pr', repo: 'rogerchappel/launchclip', number: 82, state: 'merged', date: '2026-07-16', file: 'src/model_provider.js', lines: ['-      body.provider = { require_parameters: true, allow_fallbacks: false };', '+      body.provider = { require_parameters: true, allow_fallbacks: model === "openrouter/free" };'], startLine: {old: 87, new: 87}},
    {kind: 'commit', repo: 'rogerchappel/launchclip', sha: '4bb5d3b42fd3', date: '2026-07-18', file: 'src/production_cli.js', lines: ['+  const repairRoutes = [...selection.routes];', '+  if (!repairRoutes.some((route) => /^openrouter:openrouter\\/free(?:@|$)/i.test(route))) repairRoutes.push("openrouter:openrouter/free@none");'], startLine: {old: 81, new: 81}, highlight: {token: 'openrouter/free', row: 1}},
    {kind: 'excerpt', file: 'docs/guide/advanced.md', sub: 'rogerchappel/launchclip · main', lines: ['  --critic-route openrouter:openrouter/free@none \\', '  --repair-route openrouter:openrouter/free@none'], startLine: 333}]},
  'date-pinned-timeline': {from: '2026-07-14', to: '2026-07-20', cards: [
    {date: '2026-07-16', label: 'Free repairs', kind: 'pr', repo: 'rogerchappel/launchclip', number: 82, state: 'merged', lines: ['+      body.provider = { require_parameters: true, allow_fallbacks: model === "openrouter/free" };'], startLine: {old: 87, new: 87}, highlight: 'openrouter/free'},
    {date: '2026-07-17', label: 'Model rotation', kind: 'pr', repo: 'rogerchappel/launchclip', number: 89, state: 'merged', lines: ['+  return route.provider === "openrouter" && (route.model === "openrouter/free" || route.model.endsWith(":free"));'], startLine: {old: 324, new: 345}, highlight: 'openrouter/free'},
    {date: '2026-07-18', label: 'Repair fallback', kind: 'commit', repo: 'rogerchappel/launchclip', sha: '4bb5d3b42fd3', lines: ['+  if (!repairRoutes.some((route) => /^openrouter:openrouter\\/free(?:@|$)/i.test(route))) repairRoutes.push("openrouter:openrouter/free@none");'], startLine: {old: 82, new: 82}, highlight: {token: 'openrouter/free', row: 0}}]},
  // A real session in this repo: the commit behind the commit-card sample, the helper's tests, and a full npm test run on this branch (its real totals).
  'terminal-session': {title: 'launchclip — zsh', steps: [
    {cmd: 'git show --stat c3ec4a11 --format=%s', output: ['direct: default OpenAI model to gpt-5.5', ' src/director.js | 7 ++++---', ' 1 file changed, 4 insertions(+), 3 deletions(-)']},
    {cmd: 'node --test test/evidence_github.test.js', output: [{status: 'PASS', time: '9.0 ms', text: 'parseGithubRef reads URLs and short forms'}, {status: 'PASS', time: '17.1 ms', text: 'githubGet caches responses and explains the rate limit'},
      {status: 'PASS', time: '9.7 ms', text: 'a real PR maps to repo-pr-card params that resolve'}, {status: 'PASS', time: '4.0 ms', text: 'a real commit maps to commit-card and diff-view params'}]},
    {cmd: 'npm test', output: [{text: 'ℹ tests 2515', tone: 'muted'}, {text: 'ℹ pass 2053', tone: 'add'}, {text: 'ℹ fail 4', tone: 'del'}, {text: 'ℹ duration_ms 219907.9', tone: 'muted'}]}],
    timer: {to: 220}, highlight: 'c3ec4a11'},
  'dot-field': {count: 1050000, label: 'tokens in context', legend: '1 dot = 1 token'},
  'particle-text': {text: '60%', kicker: 'Hard-set score', sub: 'up from 41% a month ago'},
  'particle-logo': {logos: [{icon: 'rocket', label: 'Northwind', sub: 'challenger'}, {icon: 'sparkle', label: 'Helio Labs', sub: 'incumbent'}]},
  'particle-cloud': {steps: [{label: 'Lumen S', sub: 'small'}, {label: 'Lumen M', sub: 'leaked'}, {label: 'Lumen L', sub: 'near-flagship'}], target: {label: 'Next flagship', sub: 'due soon'}},
  'grid-race': {title: 'Same $10 of output', unit: 10000, suffix: 'tokens', racers: [{label: 'Atlas 2', sub: '$10 per 1M output tokens', total: 1000000, spend: {total: 10}}, {label: 'Atlas 2 Mini', sub: '$5 per 1M output tokens', total: 1000000, spend: {total: 5}}], ratio: {text: '2×', sub: 'cheaper for the same tokens'}},
  'cell-grid': {title: 'Cost of one completed task', legend: '1 cell = $0.01', grids: [{label: 'Atlas 2 Mini', sub: '$5 / 1M output', count: 101, value: '$1.01', tone: 'accent'}, {label: 'Rival Pro', sub: '$20 / 1M output', count: 715, value: '$7.15', tone: 'paper'}], ratio: {text: '≈7×', sub: 'cheaper per completed task'}, source: 'Example benchmark, Oct 2026'},
  'tokenizer': {text: 'Terra continues to advance the cost-intelligence frontier', tokens: ['Ter', 'ra', ' continues', ' to', ' advance', ' the', ' cost', '-int', 'elligence', ' frontier'], encoding: 'o200k_base', source: 'text: example launch post', models: [{label: 'Atlas 2', price: 10}, {label: 'Atlas 2 Mini', price: 5}]},
  'comparison-table': {title: 'How LaunchClip compares', columns: ['LaunchClip', 'Editor', 'Templates'], rows: [{label: 'One prompt to video', values: [true, false, false]}, {label: 'Your brand, every scene', values: [true, true, false]}, {label: 'Captions from the voice', values: [true, false, true]}, {label: 'Time to first cut', values: ['12 min', '2 days', '3 h']}, {label: 'Open source', values: [true, false, null]}], highlight: 0}
});

/** Extra parity cases beyond one per variant: {name, module, variant, shape, params}. */
export const EXTRA_SAMPLES = Object.freeze([
  {name: 'device-frame-laptop-image', module: 'device-frame', variant: 'dark', shape: 'landscape', params: {device: 'laptop', image: 'assets/screens/dashboard.png', caption: 'A real screenshot in the frame'}},
  {name: 'map-highlight-world', module: 'map-highlight', variant: 'pins', shape: 'landscape', params: {highlight: [{country: 'USA', value: '41%'}, {country: 'Brazil', value: '12%'}, {country: 'India', value: '19%'}, {country: 'Australia', value: '7%'}], focus: 'world'}},
  {name: 'unit-grid-highlight', module: 'unit-grid', variant: 'solid', shape: 'portrait', params: {count: 10, highlight: {count: 1, label: '1 IN 10'}}},
  {name: 'number-line-marker', module: 'number-line', variant: 'ruler', shape: 'landscape', params: {from: 0, to: 100, format: {style: 'percent'}, ranges: [{from: 60, to: 80, label: 'The sweet spot', tone: 'good'}], marker: {value: 72, label: 'You'}}},
  {name: 'date-pinned-timeline-summary', module: 'date-pinned-timeline', variant: 'summary', shape: 'landscape', params: {from: '2026-07-14', to: '2026-07-20', subtitle: '3 clues in 3 days', cards: [
    {date: '2026-07-16', label: 'Free repairs', kind: 'pr', repo: 'rogerchappel/launchclip', number: 82, state: 'merged', lines: ['+      body.provider = { require_parameters: true, allow_fallbacks: model === "openrouter/free" };'], startLine: {old: 87, new: 87}, highlight: 'openrouter/free'},
    {date: '2026-07-17', label: 'Model rotation', kind: 'pr', repo: 'rogerchappel/launchclip', number: 89, state: 'merged', lines: ['+  return route.provider === "openrouter" && (route.model === "openrouter/free" || route.model.endsWith(":free"));'], startLine: {old: 324, new: 345}, highlight: 'openrouter/free'},
    {date: '2026-07-18', label: 'Repair fallback', kind: 'commit', repo: 'rogerchappel/launchclip', sha: '4bb5d3b42fd3', lines: ['+  if (!repairRoutes.some((route) => /^openrouter:openrouter\\/free(?:@|$)/i.test(route))) repairRoutes.push("openrouter:openrouter/free@none");'], startLine: {old: 82, new: 82}, highlight: {token: 'openrouter/free', row: 0}}]}},
  {name: 'evidence-chain-announcement', module: 'evidence-chain', variant: 'glass', shape: 'landscape', params: {token: 'openrouter/free', sources: [
    {kind: 'excerpt', file: 'docs/guide/advanced.md', sub: 'rogerchappel/launchclip · main', lines: ['  --critic-route openrouter:openrouter/free@none \\', '  --repair-route openrouter:openrouter/free@none'], startLine: 333},
    {kind: 'announcement', site: 'github.com/rogerchappel/launchclip', title: 'Visual Review and Repair', text: 'To use OpenRouter\'s current free pool without maintaining a model list, pass openrouter:openrouter/free@none for both routes.'}]}},
  {name: 'particle-text-both', module: 'particle-text', variant: 'led', shape: 'landscape', params: {text: '1,050,000', kicker: 'Tokens in context', mode: 'both'}},
  {name: 'cell-grid-stacked-money', module: 'cell-grid', variant: 'bars', shape: 'landscape', params: {title: 'A simulated year running a startup', legend: '1 cell = $10,000', grids: [{label: 'Northwind', count: 102, value: '$1,024,828', segments: [{count: 20, tone: 'accent', label: 'start · $200,000'}, {count: 82, tone: 'good'}]}, {label: 'Helio', count: 64, value: '$641,290', segments: [{count: 20, tone: 'accent', label: 'start · $200,000'}, {count: 44, tone: 'good'}]}], source: 'Example benchmark, Oct 2026'}},
  {name: 'cell-grid-ticks', module: 'cell-grid', variant: 'blocks', shape: 'portrait', params: {title: 'Tasks passed, of 100', legend: '1 cell = 1 task', order: 'reading', grids: [{label: 'Northwind', count: 100, columns: 10, value: '24%', ticks: {count: 24}}, {label: 'Helio', count: 100, columns: 10, value: '6%', ticks: {count: 6}}], source: 'Example benchmark, Oct 2026'}},
  {name: 'cell-grid-highlight', module: 'cell-grid', variant: 'bars', shape: 'landscape', params: {legend: '1 cell = 1 question', order: 'reading', grids: [{label: 'Answered correctly', count: 198, value: '124 of 198', highlight: {count: 124}}], source: 'Example benchmark, Oct 2026'}},
  {name: 'speech-bubble-thought', module: 'speech-bubble', variant: 'comic', shape: 'portrait', params: {text: 'What if the video made itself?', type: 'thought', tail: 'bottom-right'}}
]);

// Social cards (kit/core/catalog-i-social.mjs) use fictional demo accounts
// only (demo: true, handles that say "demo"); a real video quotes real posts
// with their source. The rows of scripts/social-sheet.mjs.
export const DEMO_POSTS = Object.freeze({
  dana: {platform: 'x', name: 'Dana Demo', handle: 'demo_dana', verified: true, demo: true, text: 'Shipped the new render queue tonight. Every storyboard now previews in under a minute. Notes at example.com/changelog, and tell @demo_kai what breaks.', time: '6:06 AM', date: 'Oct 25, 2026', metrics: {replies: 1043, reposts: 169, likes: 5512, bookmarks: 169, views: 1000000}},
  kai: {platform: 'x', name: 'Kai Example', handle: 'demo_kai', verified: true, demo: true, text: 'Really hoping the portrait cut ships alongside it', time: '8:00 AM', date: 'Oct 25, 2026', metrics: {replies: 34, reposts: 7, likes: 117, bookmarks: 12, views: 79200}},
  lumen: {platform: 'x', name: 'Lumen Demo Lab', handle: 'demo_lumen', verified: 'gold', demo: true, text: 'Wouldn\'t be surprised if we get this soon', time: '2:30 PM', date: 'Oct 19, 2026', metrics: {replies: 58, reposts: 40, likes: 772, bookmarks: 70, views: 237300}},
  rho: {platform: 'x', name: 'Rho Demo', handle: 'demo_rho', demo: true, text: 'Another tool in the middle of the lineup. Please, no.', time: '8:47 AM', date: 'Oct 25, 2026', metrics: {replies: 192, reposts: 41, likes: 1300, bookmarks: 86, views: 79400}},
  threads: {platform: 'threads', name: 'Sam Demo', handle: 'demo.sam', verified: true, demo: true, text: 'The captions finally land on the beat. Tried it on a 40 minute talk and it held up.', ago: '2h', metrics: {likes: 812, replies: 44, reposts: 19}},
  bluesky: {platform: 'bluesky', name: 'Ivy Example', handle: 'ivy-demo.example.social', demo: true, text: 'Open source video tooling is having a moment. #buildinpublic', ago: '5h', metrics: {replies: 12, reposts: 31, likes: 240}},
  linkedin: {platform: 'linkedin', name: 'Morgan Example', headline: 'Head of Video at Example Co (demo)', demo: true, text: 'We cut our launch video turnaround from two days to an afternoon. The team spent the time on the story instead.', ago: '3d', metrics: {likes: 1284, replies: 96, reposts: 41}},
  reddit: {platform: 'reddit', name: 'demo_poster', handle: 'demo_poster', community: 'videoediting', demo: true, title: 'Has anyone tried rendering storyboards straight from JSON?', text: 'Curious whether the output holds up next to a hand edit.', ago: '6h', metrics: {likes: 412, replies: 88}},
  turkish: {platform: 'x', name: 'Deniz Demo', handle: 'demo_deniz', demo: true, replyingTo: 'demo_dana', translatedFrom: 'Turkish', text: 'We have reached the end of all work done by hand. Editing is still standing, though.', time: '11:46 AM', date: 'Oct 18, 2026', metrics: {reposts: 1, likes: 5, views: 640}}
});
const D = DEMO_POSTS;
export const SOCIAL_SAMPLES = Object.freeze([
  {title: 'social-post · looks', tiles: [
    {name: 'glass · 16:9 · highlight + focus', module: 'social-post', variant: 'glass', aspect: '16:9'},
    {name: 'native · 16:9', module: 'social-post', variant: 'native', aspect: '16:9', params: {...D.lumen, quote: {name: 'Dana Demo', handle: 'demo_dana', verified: true, text: 'Every storyboard now previews in under a minute.', date: 'Oct 25'}}},
    {name: 'light · 9:16 · media', module: 'social-post', variant: 'light', aspect: '9:16', params: {...D.dana, media: {image: 'assets/screens/dashboard.png'}}},
    {name: 'glass · 9:16 · building', module: 'social-post', variant: 'glass', aspect: '9:16', at: 0.55}
  ]},
  {title: 'social-post · platforms', tiles: [
    {name: 'x · replying + translated', module: 'social-post', variant: 'glass', aspect: '16:9', params: D.turkish},
    {name: 'threads', module: 'social-post', variant: 'native', aspect: '16:9', params: D.threads},
    {name: 'bluesky', module: 'social-post', variant: 'native', aspect: '16:9', params: D.bluesky},
    {name: 'linkedin', module: 'social-post', variant: 'light', aspect: '16:9', params: D.linkedin},
    {name: 'reddit', module: 'social-post', variant: 'native', aspect: '16:9', params: D.reddit},
    {name: 'x · side thumbnail', module: 'social-post', variant: 'glass', aspect: '16:9', params: {...D.kai, media: {image: 'assets/screens/dashboard.png', layout: 'side'}}}
  ]},
  {title: 'social-stack', tiles: [
    {name: 'cascade · 16:9 · landing', module: 'social-stack', variant: 'cascade', aspect: '16:9', at: 1.05},
    {name: 'cascade · 16:9 · settled', module: 'social-stack', variant: 'cascade', aspect: '16:9'},
    {name: 'list · 16:9 · focus', module: 'social-stack', variant: 'list', aspect: '16:9'},
    {name: 'cascade · 9:16', module: 'social-stack', variant: 'cascade', aspect: '9:16'}
  ]},
  {title: 'social-sort', tiles: [
    {name: 'pile · 16:9', module: 'social-sort', variant: 'columns', aspect: '16:9', at: 1.6},
    {name: 'sorting · 16:9', module: 'social-sort', variant: 'columns', aspect: '16:9', at: 2.75},
    {name: 'sorted · 16:9', module: 'social-sort', variant: 'columns', aspect: '16:9'},
    {name: 'sorted · 9:16', module: 'social-sort', variant: 'columns', aspect: '9:16'}
  ]},
  {title: 'social-wall', tiles: [
    {name: 'field · 16:9', module: 'social-wall', variant: 'field', aspect: '16:9', at: 1.5},
    {name: 'pulling · 16:9', module: 'social-wall', variant: 'field', aspect: '16:9', at: 2.6},
    {name: 'pulled + highlight · 16:9', module: 'social-wall', variant: 'field', aspect: '16:9'},
    {name: 'pulled · 9:16', module: 'social-wall', variant: 'field', aspect: '9:16'}
  ]}
]);

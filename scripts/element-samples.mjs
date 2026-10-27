// Sample params for every catalogue H module (kit/core/catalog-h.mjs): the
// data the parity fixtures and the contact sheets draw. Every optional part
// a variant draws is filled in.

export const SAMPLES = Object.freeze({
  'bar-chart': {title: 'Weekly renders by format', data: [{label: 'Shorts', value: 1240}, {label: 'Reels', value: 980}, {label: 'TikTok', value: 1610}, {label: 'YouTube', value: 620}, {label: 'LinkedIn', value: 310}], highlight: 2, source: 'LaunchClip telemetry, Oct 2026'},
  'stacked-bar': {title: 'Minutes per video', categories: ['Plan', 'Edit', 'Caption', 'Export'], series: [{label: 'By hand', values: [18, 64, 22, 9]}, {label: 'Assisted', values: [6, 14, 3, 4]}], format: {unit: 'min'}},
  'pie-chart': {title: 'Where viewers find us', data: [{label: 'Shorts feed', value: 46}, {label: 'Search', value: 24}, {label: 'Shares', value: 18}, {label: 'Other', value: 12}], center: {label: 'Views'}, format: {compact: true}},
  'area-chart': {title: 'Monthly active creators', labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'], series: [{label: 'Creators', values: [1.2, 1.6, 2.1, 2.0, 2.9, 3.6, 4.4, 5.3]}], format: {decimals: 1, suffix: 'K'}},
  'scatter-plot': {title: 'Score vs. cost per task', xLabel: 'COST PER TASK ($, LOG)', yLabel: 'SCORE %', x: {min: 0.1, max: 100, scale: 'log'}, y: {min: 0, max: 100}, xFormat: {style: 'currency', decimals: 1},
    series: [{label: 'Model A', points: [{x: 0.3, y: 38}, {x: 1.2, y: 52}, {x: 4, y: 61}, {x: 15, y: 66}]}, {label: 'Model B', points: [{x: 0.5, y: 46}, {x: 2, y: 63}, {x: 8, y: 74}, {x: 30, y: 79}]}],
    focus: 1, annotations: [{type: 'guide', id: 'best', series: 1, index: 2}, {type: 'placeholder', id: 'next', x: 70, y: 91, label: 'Next model?'}, {type: 'callout', id: 'cheap', series: 0, index: 0, text: 'Cheapest run'}]},
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
  'race-bars': {title: 'Time to fix 40 issues', rows: [{label: 'By hand', time: 126, icon: 'user'}, {label: 'Old agent', time: 74, icon: 'bot'}, {label: 'New agent', time: 42, icon: 'zap', tone: 'primary'}], format: {unit: 'min'}},
  'small-multiples': {title: 'Four benchmarks, one winner', series: ['Model A', 'Model B', 'Model C'], panels: [{title: 'Coding', values: [61.7, 60.3, 52.1]}, {title: 'Science', values: [89.5, 89.2, 80.4]}, {title: 'Agents', values: [72.4, 64.0, 58.8]}, {title: 'Math', values: [95.2, 94.5, 88.0]}], format: {decimals: 1}},
  'date-carousel': {start: '2026-10-26', focus: '2026-10-05', startEvent: {label: 'v2 released', icon: 'rocket'}, event: {label: 'Beta', sub: 'Day 1', icon: 'flag'}, caption: 'Where it started'},
  'month-grid': {title: 'Shipping daily · 28 days', from: '2026-10-05', days: 28, marks: [{day: 1, label: '2× faster', icon: 'zap'}, {day: 2, label: 'both', icon: 'refresh-cw', tone: 'accent'}, {day: 9, label: 'fix', icon: 'wrench', tone: 'accent'}], legend: [{label: 'upgrade shipped', icon: 'arrow-up'}, {label: 'limits reset', icon: 'refresh-cw', tone: 'accent'}]},
  'comparison-table': {title: 'How LaunchClip compares', columns: ['LaunchClip', 'Editor', 'Templates'], rows: [{label: 'One prompt to video', values: [true, false, false]}, {label: 'Your brand, every scene', values: [true, true, false]}, {label: 'Captions from the voice', values: [true, false, true]}, {label: 'Time to first cut', values: ['12 min', '2 days', '3 h']}, {label: 'Open source', values: [true, false, null]}], highlight: 0}
});

/** Extra parity cases beyond one per variant: {name, module, variant, shape, params}. */
export const EXTRA_SAMPLES = Object.freeze([
  {name: 'number-line-zoom', module: 'number-line', variant: 'ruler', shape: 'landscape', params: {title: 'Lead on 19 scored tests', from: -2, to: 24, step: 1, labelEvery: 4, points: [{value: 0.3}, {value: 0.7, label: 'AIME +0.7'}, {value: 0.8}, {value: 23, label: 'DeepSWE +23.0'}], zoom: {from: 0, to: 2, step: 0.5, label: 'Wins by less than 1 point'}}},
  {name: 'scatter-plot-points', module: 'scatter-plot', variant: 'bubbles', shape: 'portrait', params: {title: 'Length vs. retention', xLabel: 'VIDEO LENGTH (S)', yLabel: 'RETENTION %', points: [{x: 8, y: 92}, {x: 12, y: 88}, {x: 15, y: 84, size: 3}, {x: 21, y: 79}, {x: 26, y: 74, size: 2}, {x: 30, y: 71}, {x: 34, y: 63, size: 4}, {x: 41, y: 58}, {x: 45, y: 61}, {x: 52, y: 49, size: 2}, {x: 58, y: 44}, {x: 60, y: 40, size: 5}], trend: true, highlight: 2}},
  {name: 'scatter-plot-compare', module: 'scatter-plot', variant: 'dots', shape: 'landscape', params: {xLabel: 'COST ($)', yLabel: 'SCORE', x: {min: 0.1, max: 100, scale: 'log'}, y: {min: 20, max: 90}, panels: [{title: 'Official chart', series: [{label: 'Model A', points: [{x: 0.3, y: 40}, {x: 2, y: 58}, {x: 12, y: 70}]}, {label: 'Model B', points: [{x: 0.4, y: 50}, {x: 3, y: 71}, {x: 20, y: 82}]}]}, {title: 'Independent re-run', series: [{label: 'Model A', points: [{x: 0.3, y: 38}, {x: 2, y: 55}, {x: 12, y: 66}]}, {label: 'Model B', points: [{x: 0.4, y: 44}, {x: 3, y: 60}, {x: 20, y: 68}]}]}], focus: 1, annotations: [{type: 'callout', id: 'gap', panel: 1, series: 1, index: 2, text: '−14 points'}]}},
  {name: 'device-frame-laptop-image', module: 'device-frame', variant: 'dark', shape: 'landscape', params: {device: 'laptop', image: 'assets/screens/dashboard.png', caption: 'A real screenshot in the frame'}},
  {name: 'map-highlight-world', module: 'map-highlight', variant: 'pins', shape: 'landscape', params: {highlight: [{country: 'USA', value: '41%'}, {country: 'Brazil', value: '12%'}, {country: 'India', value: '19%'}, {country: 'Australia', value: '7%'}], focus: 'world'}},
  {name: 'unit-grid-highlight', module: 'unit-grid', variant: 'solid', shape: 'portrait', params: {count: 10, highlight: {count: 1, label: '1 IN 10'}}},
  {name: 'number-line-marker', module: 'number-line', variant: 'ruler', shape: 'landscape', params: {from: 0, to: 100, format: {style: 'percent'}, ranges: [{from: 60, to: 80, label: 'The sweet spot', tone: 'good'}], marker: {value: 72, label: 'You'}}},
  {name: 'speech-bubble-thought', module: 'speech-bubble', variant: 'comic', shape: 'portrait', params: {text: 'What if the video made itself?', type: 'thought', tail: 'bottom-right'}}
]);

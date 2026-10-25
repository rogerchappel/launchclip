// A synthetic long-form story: about ten minutes of narration words, a
// direction map with one section per chapter, and a footage-led storyboard
// that dresses two lines in three with a concept card. Deterministic and
// media-free; the media tests add a base recording (test/long_form_media.test.js).

export const LONG_FORM_TITLES = Object.freeze(["The problem", "Tool of the week", "How it works", "A live demo", "The results", "What comes next"]);
const VOCAB = ["launch", "videos", "take", "hours", "because", "every", "edit", "starts", "again", "from", "scratch", "and", "nobody", "has", "time", "for", "that", "so", "we", "built", "a", "pipeline", "which", "reads", "the", "recording", "cuts", "it", "and", "dresses", "each", "line"];

/**
 * {story, map, words} for a `duration`-second footage-led story in
 * `sections` chapters. Lines are 12 words (4.8 s), each a sentence.
 * options: {duration = 600, sections = 6, width = 1920, height = 1080, base = "assets/recording.mp4"}
 */
export function longFormFixture({ duration = 600, sections = LONG_FORM_TITLES.length, width = 1920, height = 1080, base = "assets/recording.mp4" } = {}) {
  const words = [];
  const lines = [];
  let t = 0.3;
  const step = 0.4, length = 0.3, perLine = 12;
  while (t + perLine * step < duration - 1) {
    const first = words.length;
    for (let i = 0; i < perLine; i += 1) {
      const text = VOCAB[(first + i * 7) % VOCAB.length];
      words.push({ text: i === perLine - 1 ? `${text}.` : text, start: round(t), end: round(t + length) });
      t += step;
    }
    lines.push({ words: [first, words.length - 1], start: words[first].start, end: words.at(-1).end });
    t += 0.2;
  }
  const per = Math.ceil(lines.length / sections);
  const scenes = [];
  const map = { schema: "launchclip.direction-map.v1", profile: "youtube-long-form", sections: [] };
  for (let s = 0; s < sections; s += 1) {
    const own = lines.slice(s * per, (s + 1) * per);
    if (!own.length) break;
    map.sections.push({
      id: `c${s + 1}`,
      title: LONG_FORM_TITLES[s % LONG_FORM_TITLES.length],
      layout: "full",
      lines: own.map((line, i) => {
        const index = s * per + i;
        if (i % 3 === 2) return { words: line.words, intent: "personal", treatment: "face", why: "the line plays on the presenter" };
        const id = `card-${index + 1}`;
        scenes.push({ id, module: "concept-card", track: 1, start: line.start, end: round(line.end + 0.1), params: { text: `Point ${index + 1}` } });
        return { words: line.words, intent: index === 0 ? "hook" : "claim", treatment: "dress", scenes: [id] };
      })
    });
  }
  const story = {
    schema: "launchclip.story.v1",
    title: "Long-form fixture",
    lane: "footage-led",
    format: { width, height, fps: 30, duration, platform: "youtube" },
    brand: { colors: { bg: "#06070d", primary: "#fdb022", accent: "#46d4ff", ink: "#06070d", paper: "#f2eee6" }, fonts: { display: "anton", body: "space-grotesk", meta: "jetbrains-mono" } },
    audio: { words: "NARRATION.json" },
    base: { src: base, fit: "cover" },
    scenes
  };
  return { story, map, words, lines };
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

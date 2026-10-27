// Beat-director params builders: Social posts (catalog-i-social.mjs).
//
// The director picks a capability for a clause and asks for its params
// (capabilityParams in visual-capabilities.mjs). A builder maps the beat to
// the module's own params contract (skills-src/references/storyboard-modules.md),
// or returns null when the beat cannot fill the module honestly; the director
// then walks the capability's fallback chain. A module with no builder here is
// `planned` (isPlanned) and always falls back.
//
// Modules: social-post, social-stack, social-wall (and social-sort, for posts
// that carry a column or stance).
//
// A beat is {id, text, headline, label?, sub?, kicker?, brand?, facts: {numbers,
// items, dates, quote, sides, places}, evidence?: {claim, status, source, quote?,
// capture?: {id, kind, out}, data?}}. evidence.data is the module-ready data the
// research and capture stages attach to a claim or capture:
//   post: {platform, name, handle, verified?, avatar?, text, time?, date?, metrics?, media?, quote?, source: {url, captured_at?, screenshot?}} (one post), or {posts: [post]} (several)
// Evidence modules must never invent content: no evidence.data, no params.
//
// Real posts only: a post needs source.url (a demo: true test account is the
// one exception, and its url is dropped, as the module requires). Every field
// comes from evidence.data; the clause only chooses which phrase of the post
// the highlight sweeps (the longest run of words the clause's quote, else the
// clause itself, shares with the post) and which post leads. Long posts are
// cut to an excerpt that ends in "…". The highlight takes the module's
// default time (just after the card lands, which is inside the clause).
//
// h: the shared helpers from visual-capabilities.mjs (clip, keyTerms,
// numbersOf, itemsOf, percentOf, seriesOf, sidesOf, timelineSteps, quoteOf,
// excerptLines, formatValue, sourceOf, iconFor, round).
//
// Pure ESM, no imports. Canonical copy: kit/core/capability-builders-social.mjs.

const PLATFORMS = ['x', 'threads', 'bluesky', 'linkedin', 'reddit', 'generic'];
const METRICS = ['replies', 'reposts', 'likes', 'bookmarks', 'views'];
const STRINGS = { title: 140, headline: 60, community: 40, replyingTo: 40, translatedFrom: 24, time: 12, date: 24, ago: 12 };
const ASSET = /^assets\/[a-zA-Z0-9_./ -]+\.(svg|png|jpe?g|webp)$/i;
const HANDLE = /^[\p{L}\p{N}_.-]{1,38}$/u;
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const asset = (value) => (typeof value === 'string' && ASSET.test(value) && !value.split('/').includes('..') ? value : undefined);
const norm = (word) => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** The posts in evidence.data: {posts: [...]} or one post. */
function rawPosts(beat) {
  const data = beat.evidence?.data;
  if (!isObject(data)) return [];
  return Array.isArray(data.posts) ? data.posts.filter(isObject) : [data];
}

/** One evidence post → the module's post fields, or null when it is not a real, showable post. */
function postOf(raw, h, max) {
  const demo = raw.demo === true;
  const url = text(raw.source?.url);
  if (!demo && !(url && /^https?:\/\/[^\s/]+\.[^\s/]+/i.test(url))) return null;
  const platform = PLATFORMS.includes(raw.platform) ? raw.platform : 'x';
  const name = text(raw.name), body = text(raw.text);
  if (!name || !body) return null;
  const handle = text(raw.handle)?.replace(/^(@|u\/)/, '') ?? null;
  if (handle ? !HANDLE.test(handle) : platform !== 'linkedin') return null;
  if (platform === 'reddit' && !text(raw.community)) return null;
  const post = { platform, name: h.clip(name, 50), text: h.clip(body, max), ...(handle ? { handle } : {}), ...(demo ? { demo: true } : {}) };
  if (raw.verified === true || ['blue', 'gold', 'gray'].includes(raw.verified)) post.verified = raw.verified;
  if (asset(raw.avatar)) post.avatar = raw.avatar;
  for (const [key, limit] of Object.entries(STRINGS)) {
    if (!text(raw[key])) continue;
    // Fields of another platform would fail the module's checks.
    if ((key === 'title' || key === 'community') && platform !== 'reddit') continue;
    if (key === 'headline' && platform !== 'linkedin') continue;
    post[key] = h.clip(raw[key], limit);
  }
  if (isObject(raw.metrics)) {
    const metrics = {};
    for (const key of METRICS) {
      const value = raw.metrics[key];
      if (Number.isInteger(value) && value >= 0) metrics[key] = value;
      else if (typeof value === 'string' && value.trim() && value.length <= 8) metrics[key] = value.trim();
    }
    if (Object.keys(metrics).length) post.metrics = metrics;
  }
  if (isObject(raw.media) && asset(raw.media.image)) post.media = { image: raw.media.image, ...(['below', 'side'].includes(raw.media.layout) ? { layout: raw.media.layout } : {}) };
  if (isObject(raw.quote) && text(raw.quote.name) && text(raw.quote.text)) {
    post.quote = { name: h.clip(raw.quote.name, 50), text: h.clip(raw.quote.text, 160) };
    const qh = text(raw.quote.handle)?.replace(/^(@|u\/)/, '');
    if (qh && HANDLE.test(qh)) post.quote.handle = qh;
    if (text(raw.quote.date)) post.quote.date = h.clip(raw.quote.date, 24);
  }
  if (!demo) {
    const source = { url };
    if (text(raw.source.captured_at) && /^\d{4}-\d{2}-\d{2}/.test(raw.source.captured_at)) source.captured_at = raw.source.captured_at;
    if (asset(raw.source.screenshot)) source.screenshot = raw.source.screenshot;
    if (raw.source.schema === 'launchclip.capture.v1') source.schema = raw.source.schema;
    post.source = source;
  }
  return post;
}

/**
 * The phrase of `post` to sweep: the longest run of whole words (2–12) it
 * shares with the clause's quote, else with the clause, as the post writes
 * them; null when they share no two words in a row.
 */
export function sharedPhrase(post, beat, h) {
  const words = post.text.split(/\s+/).filter(Boolean);
  const keys = words.map(norm);
  let best = null;
  for (const source of [h.quoteOf(beat), beat.text].filter(Boolean)) {
    const want = String(source).split(/\s+/).map(norm).filter(Boolean);
    for (let i = 0; i < keys.length; i++) for (let j = 0; j < want.length; j++) {
      let n = 0;
      while (i + n < keys.length && j + n < want.length && n < 12 && keys[i + n] && keys[i + n] === want[j + n]) n++;
      // A run must carry a content word, not only "of the".
      if (n >= 2 && n > (best?.length ?? 0) && h.keyTerms(words.slice(i, i + n).join(' ')).length) best = { start: i, length: n };
    }
    if (best) break;
  }
  return best ? words.slice(best.start, best.start + best.length).join(' ') : null;
}

/** The beat's real posts, each with the phrase it shares with the clause, best match first in `lead`. */
function postsOf(beat, h, max) {
  const posts = rawPosts(beat).map((raw) => ({ raw, post: postOf(raw, h, max) })).filter((entry) => entry.post);
  posts.forEach((entry) => { entry.phrase = sharedPhrase(entry.post, beat, h); });
  const lead = posts.reduce((best, entry, i) => ((entry.phrase?.split(' ').length ?? 0) > (posts[best]?.phrase?.split(' ').length ?? 0) ? i : best), 0);
  return { posts, lead };
}

/**
 * Columns from the posts: each post's stance (a label), or its column (an
 * index into evidence.data.columns, or a label); null unless every post has
 * one and there are 2–3 camps.
 */
function columnsOf(posts, data, h) {
  const named = Array.isArray(data?.columns) ? data.columns.map(text) : [];
  const stances = posts.map(({ raw }) => text(raw.stance) ?? (Number.isInteger(raw.column) ? named[raw.column] : text(raw.column)) ?? null);
  if (stances.some((stance) => !stance)) return null;
  const labels = [...new Set(stances.map((stance) => h.clip(stance, 24)))];
  if (labels.length < 2 || labels.length > 3) return null;
  return { labels, column: stances.map((stance) => labels.indexOf(h.clip(stance, 24))) };
}

/**
 * → {builders: {[module]: (beat) => params | null}, additions: {[module]: (beat) => {key, items}},
 *    samples: [beat]}: samples are test beats carrying the evidence.data these
 *    builders need; test/visual_capabilities.test.js resolves every builder against
 *    them, so an evidence-only builder is checked without inventing data elsewhere.
 */
export function socialBuilders(h) {
  return {
    builders: {
      'social-post': (beat) => {
        const { posts, lead } = postsOf(beat, h, 280);
        if (!posts.length) return null;
        const { post, phrase } = posts[lead];
        return { ...post, ...(phrase ? { highlight: phrase } : {}), focus: true };
      },
      'social-stack': (beat) => {
        const { posts, lead } = postsOf(beat, h, 200);
        if (posts.length < 2) return null;
        const shown = posts.slice(0, 5);
        const focus = lead < shown.length ? lead : shown.length - 1;
        return { posts: shown.map((entry) => entry.post), focus, ...(shown[focus].phrase ? { highlight: shown[focus].phrase } : {}) };
      },
      'social-wall': (beat) => {
        const { posts, lead } = postsOf(beat, h, 200);
        if (posts.length < 6) return null;
        const shown = posts.slice(0, 16);
        const focus = lead < shown.length ? lead : 0;
        return { posts: shown.map((entry) => entry.post), focus, ...(shown[focus].phrase ? { highlight: shown[focus].phrase } : {}) };
      },
      // Only when the posts say which camp they are in (column or stance); the clause never sorts them.
      'social-sort': (beat) => {
        const { posts } = postsOf(beat, h, 120);
        if (posts.length < 2) return null;
        const columns = columnsOf(posts, beat.evidence?.data, h);
        if (!columns) return null;
        // Three posts at most, taken round-robin across the camps, so the cards fit 9:16 too.
        const camps = columns.labels.map((_, c) => posts.map((entry, i) => ({ entry, column: c, i })).filter(({ i }) => columns.column[i] === c));
        const kept = [];
        for (let round = 0; kept.length < 3 && camps.some((camp) => camp[round]); round++) for (const camp of camps) if (camp[round] && kept.length < 3) kept.push(camp[round]);
        kept.sort((a, b) => a.i - b.i);
        return { columns: columns.labels, posts: kept.map(({ entry, column }) => ({ ...entry.post, column })) };
      }
    },
    additions: {},
    samples: SAMPLES
  };
}

// Test beats: posts from fictional demo accounts (demo: true, handles that say
// so), the only posts tests may show. Six, in two camps, so every builder here
// has something to build.
const demoPost = (n, text, stance) => ({ platform: 'x', name: `Demo Poster ${n}`, handle: `demo_poster_${n}`, demo: true, text, date: 'Oct 25, 2026', metrics: { likes: 100 * n, views: 9000 * n }, stance });
const SAMPLES = Object.freeze([{
  id: 'sample-posts',
  text: 'One user wrote that the new model is fast enough to replace the old one.',
  headline: 'Users reacted fast',
  facts: { numbers: [], items: [], dates: [], quote: null, sides: [], places: [] },
  evidence: { claim: 'c-posts', status: 'verified', source: { url: 'https://social.example/demo' }, capture: { id: 'posts', kind: 'post', out: 'assets/evidence/posts.mp4' },
    data: { posts: [
      demoPost(1, 'Honestly the new model is fast enough to replace the old one for me.', 'Can\'t wait'),
      demoPost(2, 'Another release in the middle of the lineup. Please, no.', 'Tired'),
      demoPost(3, 'Wouldn\'t be surprised if everyone switches this week.', 'Can\'t wait'),
      demoPost(4, 'Every launch is the same chart with a new name.', 'Tired'),
      demoPost(5, 'Trying it on our test suite tonight.', 'Can\'t wait'),
      demoPost(6, 'Wake me when the price drops.', 'Tired')
    ] } }
}]);

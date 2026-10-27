// Beat-director params builders for the social cards
// (kit/core/capability-builders-social.mjs): real posts only, the phrase the
// clause quotes, and output every module accepts in 16:9 and 9:16.
import assert from "node:assert/strict";
import test from "node:test";
import { capabilityParams, isPlanned } from "../kit/core/visual-capabilities.mjs";
import { resolveModule } from "../kit/core/modules.mjs";

const BRAND = { colors: { bg: "#06070d", primary: "#fdb022", accent: "#46d4ff", ink: "#06070d", paper: "#f2eee6" } };
const REAL = { platform: "x", name: "Ada Lovelace", handle: "@ada", verified: true, text: "The engine might compose elaborate pieces of music of any degree of complexity.", date: "Oct 25, 2026",
  metrics: { likes: 5512, views: 1000000, shares: 9 }, source: { url: "https://x.com/ada/status/1", captured_at: "2026-10-26T10:00:00Z", screenshot: "assets/captures/ada.png", schema: "launchclip.capture.v1", claim: "c1" }, claim: "c1" };
const demo = (n, stance) => ({ platform: "x", name: `Demo Poster ${n}`, handle: `demo_poster_${n}`, demo: true, text: `Post number ${n} about the launch, from the demo account.`, stance, source: { url: "https://social.example/demo" } });
const beat = (data, extra = {}) => ({ id: "b", text: "She wrote that the engine might compose elaborate pieces of music.", headline: "Music from a machine", facts: { numbers: [], items: [], dates: [], quote: null, sides: [], places: [] },
  evidence: { claim: "c1", source: { url: "https://x.com/ada/status/1" }, ...(data === undefined ? {} : { data }) }, ...extra });

function resolves(module, params) {
  for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
    const scene = { id: "s", module, start: 0, end: 5, params };
    const story = { schema: "launchclip.story.v1", lane: "motion", format: { width, height, fps: 30, duration: 5 }, brand: BRAND, scenes: [scene], resolved: { duration: 5, fps: 30 } };
    assert.doesNotThrow(() => resolveModule(scene, story), `${module} at ${width}x${height}`);
  }
}

test("social builders: the four modules have builders, so the director stops falling back from them", () => {
  for (const id of ["social-post", "social-stack", "social-wall"]) assert.equal(isPlanned(id), false, id);
});

test("social builders: no evidence data, or a post without a source url, builds nothing", () => {
  for (const id of ["social-post", "social-stack", "social-wall", "social-sort"]) {
    assert.equal(capabilityParams(id, beat(undefined)), null, `${id}: no data`);
    assert.equal(capabilityParams(id, { ...beat(undefined), evidence: undefined }), null, `${id}: no evidence`);
  }
  // The clause alone (a quote in the narration) never becomes a post.
  assert.equal(capabilityParams("social-post", beat(undefined, { facts: { quote: "the engine might compose music" } })), null);
  assert.equal(capabilityParams("social-post", beat({ ...REAL, source: {} })), null);
  assert.equal(capabilityParams("social-post", beat({ ...REAL, source: { url: "x.com/ada" } })), null);
  assert.equal(capabilityParams("social-post", beat({ ...REAL, handle: undefined })), null);
});

test("social-post: the post's own fields, the capture's source, and a sweep across the words the clause shares", () => {
  const params = capabilityParams("social-post", beat(REAL));
  assert.equal(params.text, REAL.text);
  assert.equal(params.handle, "ada");
  assert.deepEqual(params.source, { url: "https://x.com/ada/status/1", captured_at: "2026-10-26T10:00:00Z", screenshot: "assets/captures/ada.png", schema: "launchclip.capture.v1" });
  assert.deepEqual(params.metrics, { likes: 5512, views: 1000000 });
  assert.equal(params.highlight, "The engine might compose elaborate pieces of music");
  assert.equal(params.focus, true);
  assert.equal(params.claim, undefined);
  resolves("social-post", params);
  // A quote in the clause wins over its other words.
  const quoted = capabilityParams("social-post", beat(REAL, { facts: { quote: "music of any degree of complexity" } }));
  assert.equal(quoted.highlight, "music of any degree of complexity.", "the post's words as written");
  // Nothing shared, no highlight (never one on words the post does not have).
  assert.equal(capabilityParams("social-post", beat(REAL, { text: "A different sentence entirely." })).highlight, undefined);
  // A long post becomes an excerpt that ends in …
  const long = capabilityParams("social-post", beat({ ...REAL, text: `${"word ".repeat(80)}end` }));
  assert.ok(long.text.length <= 280 && long.text.endsWith("…"));
  resolves("social-post", long);
  // A demo account keeps no url (the module refuses one).
  const demoParams = capabilityParams("social-post", beat(demo(1)));
  assert.equal(demoParams.demo, true);
  assert.equal(demoParams.source, undefined);
  resolves("social-post", demoParams);
});

test("social-stack and social-wall: several posts, the best match in focus; a wall needs six", () => {
  const posts = [demo(1), { ...REAL, platform: "bluesky", handle: "ada.example.social" }, demo(2)];
  const stack = capabilityParams("social-stack", beat({ posts }));
  assert.equal(stack.posts.length, 3);
  assert.equal(stack.focus, 1);
  assert.ok(stack.highlight);
  resolves("social-stack", stack);
  assert.equal(capabilityParams("social-stack", beat({ posts: [REAL] })), null);
  assert.equal(capabilityParams("social-wall", beat({ posts: [...posts, demo(3), demo(4)] })), null);
  const wall = capabilityParams("social-wall", beat({ posts: [...posts, demo(3), demo(4), demo(5)] }));
  assert.equal(wall.posts.length, 6);
  assert.equal(wall.focus, 1);
  resolves("social-wall", wall);
  // Posts without a url are dropped, not shown.
  assert.equal(capabilityParams("social-stack", beat({ posts: [REAL, { ...REAL, source: {} }] })), null);
});

test("social-sort: only posts that say which camp they are in, three at most so 9:16 fits", () => {
  assert.equal(capabilityParams("social-sort", beat({ posts: [demo(1), demo(2), demo(3)] })), null);
  assert.equal(capabilityParams("social-sort", beat({ posts: [demo(1, "Yes"), demo(2, "Yes")] })), null, "one camp is not a sort");
  const sort = capabilityParams("social-sort", beat({ posts: [demo(1, "Can't wait"), demo(2, "Tired"), demo(3, "Can't wait"), demo(4, "Tired"), demo(5, "Can't wait")] }));
  assert.deepEqual(sort.columns, ["Can't wait", "Tired"]);
  assert.deepEqual(sort.posts.map((post) => [post.handle, post.column]), [["demo_poster_1", 0], ["demo_poster_2", 1], ["demo_poster_3", 0]]);
  assert.equal(sort.posts[0].stance, undefined);
  resolves("social-sort", sort);
  // Integer columns name evidence.data.columns.
  const indexed = capabilityParams("social-sort", beat({ columns: ["For", "Against"], posts: [{ ...demo(1), column: 0 }, { ...demo(2), column: 1 }] }));
  assert.deepEqual(indexed.columns, ["For", "Against"]);
  resolves("social-sort", indexed);
});

// Equation typesetting (src/math/typeset.js): LaTeX marks, the flattened
// glyph layers and boxes MathJax produces, and the in-memory story pass.
import test from "node:test";
import assert from "node:assert/strict";
import { markTerms, typesetLatex, typesetStory } from "../src/math/typeset.js";
import { typesetProjectStory } from "../src/math/index.js";

test("marks become MathJax classes, in order, one level deep", () => {
  assert.deepEqual(markTerms("a = \\term{b^{2}} + \\del{c}\\add{d}"), { tex: "a = \\class{lc-0}{b^{2}} + \\class{lc-1}{c}\\class{lc-2}{d}", marks: ["term", "del", "add"] });
  assert.equal(markTerms("\\{x\\} = \\term{y}").tex, "\\{x\\} = \\class{lc-0}{y}", "escaped braces are left alone");
  assert.throws(() => markTerms("\\term{a \\term{b}}"), /cannot sit inside another mark/);
  assert.throws(() => markTerms("\\term{a"), /is not closed/);
});

test("typesetLatex flattens MathJax's SVG into glyph layers with boxes", () => {
  const t = typesetLatex("E = \\term{mc^2} + \\frac{a}{b}");
  assert.equal(t.v, 1);
  assert.deepEqual(t.layers.map((layer) => layer.kind), ["base", "term"]);
  assert.equal(t.layers[1].items.length, 3, "m, c and the 2");
  assert.ok(t.layers[0].items.some((item) => item.r), "the fraction bar is a rule");
  for (const layer of t.layers) for (const item of layer.items) assert.ok(item.r || t.glyphs[item.g], "every glyph use has its outline");
  const [x0, y0, x1, y1] = t.boxes[0];
  const [vx, vy, vw, vh] = t.viewBox;
  assert.ok(x0 > vx && x1 < vx + vw && y0 >= vy - 1 && y1 <= vy + vh + 1 && x1 > x0 && y1 > y0, "the term box sits inside the equation");
  assert.throws(() => typesetLatex("\\frac{a}"), /TeX error/);
  assert.throws(() => typesetLatex("a = \\term{}"), /mark 1 \(\\term\) is empty/);
});

test("typesetStory fills and refreshes equation scenes; errors stay for validation", async () => {
  const story = { scenes: [{ module: "equation", params: { latex: "x^2" } }, { module: "equation", params: { latex: "\\frac{" } }, { module: "stat-card", params: {} }] };
  assert.equal(typesetStory(story), 1);
  assert.equal(story.scenes[0].params.typeset.latex, "x^2");
  assert.match(story.scenes[1].params.typeset.error, /TeX error/);
  assert.equal(typesetStory(story), 0, "fresh typesets are kept");
  story.scenes[0].params.latex = "y^2";
  assert.equal(typesetStory(story), 1, "changed LaTeX is typeset again");
  assert.equal(await typesetProjectStory({ scenes: [{ module: "stat-card" }] }), 0, "no equation, no MathJax");
});

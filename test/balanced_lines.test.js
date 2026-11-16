// Multi-line headings break into balanced lines (kit/core/catalog-b-base.mjs
// balancedLines): close in width, never a lone short word on the last line;
// one-line text is unchanged, and the flowing card text asks the browser for
// text-wrap: balance in both renderers.
import assert from "node:assert/strict";
import test from "node:test";
import { balancedLines, fitText, textLines, textWidth } from "@launchclip/core/catalog-b-base.mjs";
import { flowText, wrapWords } from "@launchclip/core/catalog-g-base.mjs";

const check = { fail: (path, message) => { throw new Error(`${path} ${message}`); } };

test("a heading that leaves a lone word wraps into balanced lines at the same count", () => {
  const size = 100;
  const width = textWidth("Really oil", size, "display") + 1;
  assert.deepEqual(textLines("Really oil it?", size, "display", width), ["Really oil", "it?"]);
  assert.deepEqual(balancedLines((w) => textLines("Really oil it?", size, "display", w), width), ["Really", "oil it?"]);
  assert.deepEqual(wrapWords("Really oil it?", size, "display", width), ["Really", "oil it?"]);
});

test("fitText's rows are balanced and keep its line count; one line is as wrapped", () => {
  const width = textWidth("Pay upfront for free", 80, "body") + 1;
  const fit = fitText(check, "params.title", "Pay upfront for free weekends", { family: "body", width, preferred: 80, min: 80, maxLines: 2 });
  assert.equal(fit.lines, 2);
  const widths = fit.rows.map((row) => textWidth(row, 80, "body"));
  assert.ok(Math.abs(widths[0] - widths[1]) < textWidth("upfront", 80, "body"), fit.rows.join(" / "));
  const one = fitText(check, "params.title", "Save now", { family: "body", width: 2000, preferred: 80, min: 40 });
  assert.deepEqual(one.rows, ["Save now"]);
});

test("flowing card text balances in the browser, and a caller's style still wins", () => {
  assert.equal(flowText("t", 400, {}, "Really oil it?").style.textWrap, "balance");
  assert.equal(flowText("t", 400, { textWrap: "wrap" }, "x").style.textWrap, "wrap");
});

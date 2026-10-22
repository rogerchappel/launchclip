// Validator messages the blind test hit: each must say what to change.
import test from "node:test";
import assert from "node:assert/strict";
import { resolveEditorialModule } from "../kit/core/editorial-core.mjs";
import { MODULES as CATALOG_A } from "../kit/core/catalog-a.mjs";
import { MODULES as CATALOG_B } from "../kit/core/catalog-b.mjs";

const BRAND = { colors: { bg: "#06070d", primary: "#fdb022", accent: "#46d4ff", ink: "#06070d", paper: "#f2eee6" }, fonts: { display: "anton", body: "space-grotesk", meta: "jetbrains-mono" } };
const PORTRAIT = { width: 1080, height: 1920, fps: 30, duration: 30 };
const ctx = (overrides = {}) => ({ id: "m1", start: 2, duration: 6, format: PORTRAIT, brand: BRAND, aspect: "9:16", ...overrides });

test("checklist doneAt says to set status active, or to move doneAt after at", () => {
  const rows = (row) => [{ label: "Cache dependencies", status: "done", at: 0.5 }, row];
  const spec = (row) => ({ id: "mod", aspect: "9:16", start: 0, duration: 4, kind: "checklist", title: "Three changes", rows: rows(row) });
  assert.throws(() => resolveEditorialModule(spec({ label: "Launch video", status: "done", at: 1, doneAt: 2 })),
    /rows\[1\]\.doneAt needs status "active" \(got "done"\): .*set status: "active", or drop doneAt/);
  assert.throws(() => resolveEditorialModule(spec({ label: "Launch video", status: "active", at: 2, doneAt: 1.5 })),
    /rows\[1\]\.doneAt \(1\.5 s\) must come after rows\[1\]\.at \(2 s\): set doneAt later than at/);
});

test("code-snippet names the line, its length, what the rect fits and the width it needs", () => {
  const long = "launchclip finish examples/story --renderer remotion";
  const spec = { id: "mod", aspect: "9:16", start: 0, duration: 4, kind: "code-snippet", title: "One command", rect: { x: 80, y: 300, width: 700, height: 400 },
    code: { language: "Shell", lines: [{ at: 0.6, tokens: [{ text: "npm i launchclip", type: "plain" }] }, { at: 1.2, tokens: [{ text: long, type: "plain" }] }] } };
  assert.throws(() => resolveEditorialModule(spec), (error) => {
    assert.match(error.message, new RegExp(`^code line 2 is ${long.length} chars; this rect \\(700 px wide\\) fits \\d+ at \\d+ px: widen the rect to ≥ \\d+ px, or shorten the line or split it`));
    // The suggested width really fits the line.
    const need = Number(/≥ (\d+) px/.exec(error.message)[1]);
    const wide = structuredClone(spec);
    wide.rect.width = need;
    wide.rect.x = 0;
    assert.doesNotThrow(() => resolveEditorialModule(wide));
    return true;
  });
  // A line no rect can hold says so.
  const huge = structuredClone(spec);
  huge.code.lines[1].tokens[0].text = "x".repeat(70);
  assert.throws(() => resolveEditorialModule(huge), /code line 2 is 70 chars; .*: no rect at 9:16 fits it, so shorten the line or split it/);
});

test("cta handle says how wide it is, what the pill fits, and to drop a github.com/ prefix", () => {
  const handle = "github.com/rogerchappel/launch";
  assert.throws(() => CATALOG_A.cta.resolve({ action: "Star it on GitHub", handle, rect: { x: 140, y: 600, width: 600, height: 600 } }, ctx()),
    /^Error: cta: params.handle 'github\.com\/rogerchappel\/launch' needs \d+ px even at the 44 px text floor; the pill fits 600 px: shorten it, or drop the 'github\.com\/' prefix, or set icon: 'none'$/);
  assert.throws(() => CATALOG_A.cta.resolve({ action: "Star it", handle: "https://launchclip.example", icon: "none", rect: { x: 140, y: 600, width: 500, height: 600 } }, ctx()),
    /needs \d+ px even at the 44 px text floor; the pill fits 500 px: shorten it, or drop the 'https:\/\/' prefix$/);
});

test("process-steps spacing names both step times and the earliest valid at", () => {
  assert.throws(() => CATALOG_B["process-steps"].resolve({ steps: [{ label: "Brief", at: 0.6 }, { label: "Storyboard", at: 0.8 }, { label: "Video", at: 2 }] }, ctx()),
    /params\.steps\[1\]\.at must come at least 0\.35 s after the previous step \(step 1 settles at 0\.6 s, step 2 at 0\.8 s in the scene\): set it to 0\.95 or later/);
  // Exactly 0.35 s apart is allowed (float tolerance), so the suggested time is valid.
  assert.ok(CATALOG_B["process-steps"].resolve({ steps: [{ label: "Brief", at: 0.6 }, { label: "Storyboard", at: 0.95 }, { label: "Video", at: 2 }] }, ctx()));
});

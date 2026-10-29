import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { scanPackage } from "../scripts/release-check.mjs";

function fakePackage(files, scripts = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "release-check-"));
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0", scripts }));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

test("release-check passes a clean package", () => {
  assert.deepEqual(scanPackage(fakePackage({ "index.js": "export const ok = true;\n" })), []);
});

test("release-check refuses credentials, key files, install scripts and forbidden terms", () => {
  const key = ["sk", "proj", "a".repeat(30)].join("-");
  const dir = fakePackage(
    { "src/config.js": `const k = "${key}";`, ".env.local": "X=1", "docs/notes.md": "Ships to Acme Internal first." },
    { postinstall: "node evil.js" }
  );
  const problems = scanPackage(dir, { forbiddenTerms: ["acme internal"] });
  assert.ok(problems.some((p) => p.startsWith("src/config.js: looks like a credential")));
  assert.ok(problems.some((p) => p.startsWith(".env.local: a key")));
  assert.ok(problems.some((p) => p === "package.json: has a postinstall script"));
  assert.ok(problems.some((p) => p === "docs/notes.md: names a forbidden term"));
});

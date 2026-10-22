// Golden snapshot helper: compares text with test/fixtures/nle/<name>;
// UPDATE_GOLDEN=1 rewrites the snapshot instead.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export function assertGolden(name, text) {
  const file = path.join(import.meta.dirname, name);
  if (process.env.UPDATE_GOLDEN === "1" || !existsSync(file)) {
    writeFileSync(file, text);
    if (process.env.UPDATE_GOLDEN !== "1") assert.fail(`wrote missing golden ${name}; review it and re-run`);
    return;
  }
  assert.equal(text, readFileSync(file, "utf8"), `${name} differs from its golden snapshot (UPDATE_GOLDEN=1 to accept)`);
}

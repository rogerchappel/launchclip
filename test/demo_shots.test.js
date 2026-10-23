// Demo shots (src/demo/shots.js): docs placeholders and shot-list tables to a
// draft DEMO-PLAN.json with one flow per video.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/cli.js";
import { validateDemoPlan } from "../src/demo/plan.js";
import { draftPlan, findShots, parseShots, runShots } from "../src/demo/shots.js";

const MDX = `---
title: Ship an order
---

# How do I ship an order?

{/* video: open an order from the list and mark it **shipped** */}

Open the order, then select **Mark as shipped**.

{/* SCREENSHOT: S04 — the order drawer with the Mark as shipped button */}

{/* VIDEO: V02 — filter the list to shipped orders */}

Placeholders look like \`{/* video: … */}\`:

{/* video: … */}
`;

const SHOTLIST = `# Shot list

| ID | Type | Page | Route | What it shows |
| --- | --- | --- | --- | --- |
| V01 | Video | orders/ship.mdx | /#orders | Open an order and mark it shipped |
| S01 | Screenshot | orders/ship.mdx | /#orders | The orders list |

| Ref | UI state |
|-----|----------|
| V07 | Customers page with two customers |
| S09 | Settings |
`;

test("parseShots reads MDX and HTML comment placeholders, with or without an id, and skips format examples", () => {
  const shots = parseShots(`${MDX}\n<!-- video: invite a teammate -->\n`);
  assert.deepEqual(shots.map(({ id, kind, description, line }) => ({ id, kind, description, line })), [
    { id: null, kind: "video", description: "open an order from the list and mark it shipped", line: 7 },
    { id: "S04", kind: "screenshot", description: "the order drawer with the Mark as shipped button", line: 11 },
    { id: "V02", kind: "video", description: "filter the list to shipped orders", line: 13 },
    { id: null, kind: "video", description: "invite a teammate", line: 19 }
  ]);
});

test("parseShots reads shot-list tables by type column, or by V/S ids without one", () => {
  const shots = parseShots(SHOTLIST);
  assert.deepEqual(shots.map(({ id, kind, route }) => [id, kind, route]), [["V01", "video", "/#orders"], ["S01", "screenshot", "/#orders"], ["V07", "video", null], ["S09", "screenshot", null]]);
  assert.equal(shots[0].description, "Open an order and mark it shipped");
});

test("draftPlan makes one valid flow per video, and merges into an existing plan without duplicates", () => {
  const shots = [
    ...parseShots(SHOTLIST).map((shot) => ({ ...shot, file: "SHOTLIST.md" })),
    ...parseShots(MDX).map((shot) => ({ ...shot, file: "orders/ship.mdx" }))
  ];
  const { plan, added } = draftPlan(shots, { url: "http://localhost:4320" });
  assert.deepEqual(added, ["v01-open-an-order-and-mark", "v07-customers-page-with-two-customers", "open-an-order-from-the", "v02-filter-the-list-to-shipped"]);
  assert.deepEqual(plan.flows[0].steps[0], { type: "goto", path: "/#orders" });
  assert.deepEqual(plan.flows[0].shot, { id: "V01", file: "SHOTLIST.md", line: 5 });
  assert.equal(plan.flows[1].steps[0].path, "/");
  const { errors, warnings } = validateDemoPlan(plan);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((warning) => /never clicks or types/.test(warning)), "the agent still has to write the steps");

  const existing = structuredClone(plan);
  existing.flows[0].steps.push({ type: "click", text: "Harbor & Pine" });
  const again = draftPlan(shots, { existing });
  assert.deepEqual(again.added, []);
  assert.equal(again.skipped.length, 4);
  assert.equal(again.plan.flows[0].steps.length, 3, "the agent's steps are kept");
});

test("findShots and demo shots --draft over a docs folder", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-shots-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, "docs", "orders"), { recursive: true });
  await writeFile(path.join(dir, "docs", "orders", "ship.mdx"), MDX);
  await writeFile(path.join(dir, "docs", "README.md"), "No placeholders here.\n");
  const shots = await findShots(path.join(dir, "docs"));
  assert.deepEqual(shots.map((shot) => [shot.file, shot.kind]), [["orders/ship.mdx", "video"], ["orders/ship.mdx", "screenshot"], ["orders/ship.mdx", "video"]]);

  const draft = path.join(dir, "DEMO-PLAN.json");
  const out = [];
  await runCli(["demo", "shots", path.join(dir, "docs"), "--draft", draft, "--url", "http://localhost:4320"], { stdout: { write: (value) => out.push(value) }, stderr: { write: () => {} } });
  const result = JSON.parse(out.join(""));
  assert.equal(result.stage, "demo-shots");
  assert.equal(result.added.length, 2);
  const plan = JSON.parse(await readFile(draft, "utf8"));
  assert.equal(plan.app.url, "http://localhost:4320");
  assert.deepEqual(plan.flows.map((flow) => flow.goal), ["open an order from the list and mark it shipped", "filter the list to shipped orders"]);
  const listed = await runShots(path.join(dir, "docs"));
  assert.equal(listed.videos, 2);
  assert.equal(listed.screenshots, 1);
});

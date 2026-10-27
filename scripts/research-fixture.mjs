#!/usr/bin/env node
// Re-records the research dry-run fixture (test/fixtures/research/<name>/):
// runs `launchclip research` on its script.md against the live public APIs,
// keeps every HTTP response in recording.json, and writes research/ beside
// it. test/research_fixture.test.js replays the recording offline, so the
// committed ledger, captures, data and assets stay reproducible.
//
//   node scripts/research-fixture.mjs deepseek-v4-1-flash --media "server room" --media "stack of papers"
//   node scripts/research-fixture.mjs deepseek-v4-1-flash --replay
//     rebuilds research/ from recording.json (after a change to the stage, not the pages)
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runResearch } from "../src/research/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [name, ...rest] = process.argv.slice(2);
if (!name) throw new Error("usage: node scripts/research-fixture.mjs <fixture-name> [--media <query>]... | --replay");
const dir = path.join(root, "test", "fixtures", "research", name);
const replay = rest.includes("--replay");
const previous = replay ? JSON.parse(await readFile(path.join(dir, "recording.json"), "utf8")) : null;
const media = previous?.media ?? rest.flatMap((arg, index) => rest[index - 1] === "--media" ? [arg] : []);
const now = previous?.recorded_at ?? new Date().toISOString();
const recording = [];
const live = globalThis.fetch;
const fetch = replay
  ? async (url, init = {}) => {
    const hit = previous.responses.find((entry) => entry.url === url && entry.method === (init.method ?? "GET"));
    return hit ? new Response(hit.body, { status: hit.status, headers: { "content-type": hit.content_type ?? "" } }) : new Response("", { status: 404 });
  }
  : async (url, init = {}) => {
    const response = await live(url, init);
    const body = await response.text();
    recording.push({ url: String(url).replace(/([?&](?:key|api_key)=)[^&]+/gi, "$1REDACTED"), method: init.method ?? "GET", status: response.status, content_type: response.headers.get("content-type"), body });
    return new Response(body, { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "" } });
  };
// No web-search or stock keys: the fixture shows the keyless path.
const env = { PATH: process.env.PATH };
await rm(path.join(dir, "research"), { recursive: true, force: true });
const report = await runResearch(path.join(dir, "script.md"), { out: path.join(dir, "research"), media, now, cwd: dir }, { fetch, env, log: (line) => process.stderr.write(`${line}\n`) });
if (!replay) await writeFile(path.join(dir, "recording.json"), `${JSON.stringify({ recorded_at: now, media, responses: recording }, null, 1)}\n`);
const summary = JSON.parse(await readFile(path.join(dir, "research", "evidence.json"), "utf8")).summary;
process.stdout.write(`${JSON.stringify({ ...report.summary, ...summary, evidence_data: report.evidence_data }, null, 2)}\n`);

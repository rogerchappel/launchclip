import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runMake } from "../src/make/index.js";

const SENTENCES = ["Northwind shipped Atlas 2 on October 6.", "It scored 81 percent on CodeBench.", "Kestrel cut its price from 15 dollars to 4.", "Developers moved fast that week.", "Three labs answered within days.", "The context window doubled to a million tokens."];
const usage = { input_tokens: 3000, output_tokens: 900, total_tokens: 3900 };
const critiqueResult = (verdict, findings = []) => ({ status: "written", verdict, findings: findings.length, reviewed: 1, unreviewed: 0, warnings: [], model: "gpt-5.6-luna", critique: { verdict, summary: "", findings } });

// A long-form model: an outline, chapters, and a direct pass that keeps the
// rule picks. A direct call that carries the critic's findings gives the
// clauses they name a callout (a repair the next critic pass can see).
function longFormModel() {
  const direct = [];
  const client = {
    provider: "openai",
    async runStructured(request) {
      if (request.schemaName === "launchclip_long_form_outline") {
        return { model: "gpt-5.6-luna", usage, value: { title: "October in AI", title_options: ["October in AI"], chapters: [
          { title: "Cold open", point: "Atlas 2 changed the month", facts: ["Atlas 2 shipped October 6"], seconds: 100 },
          { title: "The price war", point: "Kestrel cut prices", facts: ["$15 to $4"], seconds: 140 }
        ] } };
      }
      if (request.schemaName === "launchclip_long_form_direct") {
        direct.push(request.input);
        const named = new Set([...request.input.matchAll(/scenes? ([\w, -]+)\)/g)].flatMap((match) => match[1].split(/,\s*/)));
        const reviewed = /A reviewer watched the last cut/.test(request.input);
        const clauses = [...request.input.matchAll(/^### (\S+) \(.*\nNarration: (.*)\n(?:Rule pick|Last cut): (.*)$/gm)].map((match) => ({ id: match[1], pick: match[3] }));
        const states = clauses.map((clause) => {
          if (reviewed && named.has(clause.id)) return { id: clause.id, action: "new", module: "callout", params_json: JSON.stringify({ title: "Repaired", body: "A clearer card" }) };
          const rule = /^(\S+) (\{.*\})$/.exec(clause.pick);
          return rule ? { id: clause.id, action: "new", module: rule[1], params_json: rule[2] } : { id: clause.id, action: "hold", module: "", params_json: "" };
        });
        return { model: "gpt-5.6-luna", usage, value: { states } };
      }
      if (request.schemaName === "launchclip_long_form_copy") return { model: "gpt-5.6-luna", usage, value: { states: [] } };
      const words = Number(/about (\d+) words/.exec(request.input)?.[1] ?? 100);
      const text = [];
      while (text.join(" ").split(" ").length < words) text.push(SENTENCES[text.length % SENTENCES.length]);
      return { model: "gpt-5.6-luna", usage, value: { narration: text.join(" ") } };
    }
  };
  return { direct, model: { client, provider: "openai", model: "gpt-5.6-luna", spec: "openai:gpt-5.6-luna", vision: true } };
}

async function make(t, { critic, options = {} }) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-long-form-repairs-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const fake = longFormModel();
  const finishCalls = [];
  // finish stand-in: one evidence sample 20 s in, so a finding that cites it names the scene playing then.
  const finish = async (project, finishOptions) => {
    finishCalls.push(finishOptions);
    await mkdir(path.join(project, "renders"), { recursive: true });
    await mkdir(path.join(project, "qa/temporal-evidence"), { recursive: true });
    await writeFile(path.join(project, "renders/draft.mp4"), "video");
    await writeFile(path.join(project, "qa/temporal-evidence/manifest.json"), JSON.stringify({ entries: [{ evidence_id: "s1-browser-still", sample_id: "s1", at_seconds: 20 }] }));
    return { status: "done", seconds: 1, stages: [], gates: { critic: { status: "pending" } }, final: path.join(project, "renders/draft.mp4"), warnings: [] };
  };
  const joinVoice = async (files, out) => { await mkdir(path.dirname(out), { recursive: true }); await writeFile(out, "wav"); return out; };
  const verdicts = [...critic];
  const criticCalls = [];
  const criticAdapter = async (args) => { criticCalls.push(args); return verdicts.shift() ?? critiqueResult("ship"); };
  const report = await runMake("The biggest AI stories of October", { duration: 240, voice: "test", music: "synth", cwd, out: "october", ...options }, { env: {}, client: fake.model, inventory: async (dir) => ({ schema_version: "launchclip.make-assets.v1", dir, entries: [] }), finish, joinVoice, critic: criticAdapter, notice() {} });
  const project = path.join(cwd, "october");
  const story = JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8"));
  return { report, story, project, finishCalls, criticCalls, direct: fake.direct };
}

const sceneAt = (story, seconds) => story.scenes.find((scene) => (scene.track ?? 0) === 0 && scene.start <= seconds && seconds < scene.end);
const finding = { id: "f1", severity: "major", category: "typography", message: "The card is words on a backdrop", evidence_ids: ["s1-browser-still"] };

test("long form: a critic repair re-directs the chunk of the scene named, renders it again and keeps the better cut", async (t) => {
  const { report, story, project, finishCalls, criticCalls, direct } = await make(t, { critic: [critiqueResult("repair", [finding]), critiqueResult("ship")] });
  assert.notEqual(report.status, "failed", JSON.stringify(report.stages));
  assert.equal(report.critic_repairs.length, 1, JSON.stringify(report.critic_repairs));
  const round = report.critic_repairs[0];
  assert.equal(round.error, undefined);
  assert.deepEqual({ mode: round.mode, kept: round.kept, after: round.verdict_after }, { mode: "repair", kept: true, after: "ship" });
  assert.equal(criticCalls.length, 2);
  assert.equal(finishCalls.length, 2);
  const repaired = sceneAt(story, 20);
  assert.equal(repaired.module, "callout");
  assert.deepEqual(round.scenes, [repaired.id]);
  // Only the chunk that holds the scene was directed again, with the finding in its prompt.
  const again = direct.filter((input) => /A reviewer watched the last cut/.test(input));
  assert.equal(again.length, 1);
  assert.match(again[0], new RegExp(`critic \\(major typography, scene ${repaired.id}\\)`));
  assert.equal(story.scenes.filter((scene) => scene.module === "callout" && scene.params.title === "Repaired").length, 1);
  const map = JSON.parse(await readFile(path.join(project, "BEATMAP.json"), "utf8"));
  assert.ok(JSON.stringify(map).includes("Repaired"), "the beat map carries the repaired card, so a rerun keeps it");
  assert.ok(report.costs.items.some((item) => item.stage.startsWith("critic-1-direct-")));
  assert.equal(report.critic.verdict, "ship");
  assert.equal(report.status, "ready");
});

test("long form: a repair the critic does not rate better is undone, beat map included", async (t) => {
  const { report, story, project } = await make(t, { critic: [critiqueResult("repair", [finding]), critiqueResult("repair", [finding])] });
  assert.equal(report.critic_repairs[0].kept, false);
  assert.equal(report.critic_repairs[0].error, undefined);
  assert.ok(!JSON.stringify(story).includes("Repaired"));
  assert.ok(!(await readFile(path.join(project, "BEATMAP.json"), "utf8")).includes("Repaired"));
  assert.equal(report.status, "needs-repair");
});

test("long form on --long-form-visuals rules has no model direction to repair, and says so", async (t) => {
  const { report, criticCalls, finishCalls } = await make(t, { options: { longFormVisuals: "rules" }, critic: [critiqueResult("repair", [finding])] });
  assert.equal(criticCalls.length, 1);
  assert.equal(finishCalls.length, 1);
  assert.deepEqual(report.critic_repairs, []);
  assert.ok(report.warnings.some((warning) => /--long-form-visuals rules/.test(warning)));
});

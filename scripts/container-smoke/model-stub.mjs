#!/usr/bin/env node
// An OpenAI-compatible chat-completions stub for the container smoke test
// (scripts/container-smoke.mjs). make points at it with
// --model compatible:smoke-stub and OPENAI_COMPATIBLE_BASE_URL, so planning
// is offline and deterministic: no paid model call ever leaves the container.
//
//   node model-stub.mjs <port> <storyboard.json> <log.jsonl>
//
// launchclip_direction gets an empty direction map, launchclip_storyboard the
// recorded storyboard with its base pointed at the planner's base, and
// launchclip_make_critic a clean verdict. Any other
// schema is logged and answered with a 500, so a new model pass in make fails
// the smoke loudly instead of silently reaching for a provider.
import { appendFileSync, readFileSync } from "node:fs";
import http from "node:http";

const [port, storyboardFile, logFile] = process.argv.slice(2);
const storyboard = JSON.parse(readFileSync(storyboardFile, "utf8"));

function log(entry) {
  appendFileSync(logFile, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

function answer(schemaName, input) {
  if (schemaName === "launchclip_direction") return { direction_json: "" };
  if (schemaName === "launchclip_storyboard") {
    const base = /^base: (.+)$/m.exec(input)?.[1];
    return { storyboard_json: JSON.stringify(base ? { ...storyboard, base: JSON.parse(base) } : storyboard) };
  }
  // The headless critic runs whenever the model takes images, as it does in
  // production; a clean "ship" keeps the smoke about the pipeline, not taste.
  if (schemaName === "launchclip_make_critic") return { verdict: "ship", summary: "container smoke stub", findings: [] };
  return null;
}

http.createServer((request, response) => {
  if (request.method !== "POST") { response.writeHead(204); response.end(); return; }
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    let schemaName = null;
    let value = null;
    try {
      const payload = JSON.parse(body || "{}");
      schemaName = payload?.response_format?.json_schema?.name ?? null;
      const input = (payload.messages ?? []).map((message) => typeof message.content === "string" ? message.content : (message.content ?? []).map((part) => part?.text ?? "").join("")).join("\n");
      value = answer(schemaName, input);
    } catch (error) {
      log({ path: request.url, error: String(error?.message ?? error) });
    }
    log({ path: request.url, schema: schemaName, answered: Boolean(value) });
    if (!value) {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: `smoke model stub has no answer for schema ${schemaName}` } }));
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      id: `smoke-${Date.now()}`,
      model: "smoke-stub",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(value) } }],
      usage: { prompt_tokens: 0, completion_tokens: 0 }
    }));
  });
}).listen(Number(port), "127.0.0.1", () => log({ listening: Number(port) }));

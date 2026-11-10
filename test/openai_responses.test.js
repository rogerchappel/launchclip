import assert from "node:assert/strict";
import test from "node:test";
import { buildStructuredRequest, OpenAIResponsesClient, parseStructuredOutput, pollDelayMs } from "../src/openai_responses.js";

const SCHEMA = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false
};

test("builds a GPT-5.6 multimodal strict structured request", () => {
  const body = buildStructuredRequest({
    model: "gpt-5.6",
    reasoningEffort: "max",
    pro: true,
    instructions: "Direct the video from evidence.",
    input: "Inspect this contact sheet.",
    images: [{ url: "data:image/jpeg;base64,AAAA", detail: "original" }],
    schema: SCHEMA,
    schemaName: "creative_plan",
    promptCacheKey: "launchclip:planner:v1",
    maxOutputTokens: 32000,
    metadata: { job_id: "plan:1", attempt: 1 }
  });

  assert.equal(body.model, "gpt-5.6");
  assert.deepEqual(body.reasoning, { effort: "max", context: "current_turn", mode: "pro" });
  assert.equal(body.background, true);
  assert.equal(body.store, true);
  assert.equal(body.text.format.strict, true);
  assert.equal(body.text.format.schema, SCHEMA);
  assert.equal(body.input[0].content[1].type, "input_image");
  assert.equal(body.input[0].content[1].detail, "original");
  assert.equal(body.max_output_tokens, 32000);
  assert.equal(body.metadata.attempt, "1");
});

test("submits, polls, and parses a background structured response", async () => {
  const requests = [];
  const responses = [
    jsonResponse({ id: "resp_1", status: "in_progress", model: "gpt-5.6-sol" }),
    jsonResponse({
      id: "resp_1",
      status: "completed",
      model: "gpt-5.6-sol",
      output: [{ type: "message", content: [{ type: "output_text", text: '{"answer":"ship it"}' }] }],
      usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 12 } }
    })
  ];
  const client = new OpenAIResponsesClient({
    apiKey: "test-key",
    fetch: async (url, init) => {
      requests.push({ url, init });
      return responses.shift();
    },
    sleep: async () => {}
  });
  let submitted;
  const result = await client.runStructured({
    input: "Return an answer",
    instructions: "Follow the schema",
    schema: SCHEMA,
    schemaName: "answer",
    pollIntervalMs: 0,
    onSubmitted: async (response) => { submitted = response; }
  });

  assert.deepEqual(result.value, { answer: "ship it" });
  assert.equal(result.response_id, "resp_1");
  assert.equal(submitted.id, "resp_1");
  assert.equal(submitted.status, "in_progress");
  assert.equal(result.model, "gpt-5.6-sol");
  assert.equal(result.usage.cached_tokens, 40);
  assert.equal(result.usage.reasoning_tokens, 12);
  assert.match(requests[0].url, /\/v1\/responses$/);
  assert.match(requests[1].url, /\/v1\/responses\/resp_1$/);
});

test("retries transient API failures and honors Retry-After", async () => {
  const delays = [];
  const responses = [
    jsonResponse({ error: { message: "slow down" } }, 429, { "retry-after": "2" }),
    jsonResponse({ id: "resp_2", status: "completed", output_text: '{"answer":"ok"}' })
  ];
  const client = new OpenAIResponsesClient({
    apiKey: "test-key",
    fetch: async () => responses.shift(),
    sleep: async (ms) => delays.push(ms),
    maxRetries: 1
  });
  const response = await client.submitStructured({ input: "x", schema: SCHEMA, schemaName: "answer", background: false });
  assert.equal(response.id, "resp_2");
  assert.deepEqual(delays, [2000]);
});

test("does not retry a call refused by the spending limit", async () => {
  let calls = 0;
  const client = new OpenAIResponsesClient({
    apiKey: "test-key",
    fetch: async () => {
      calls += 1;
      throw Object.assign(new Error("limit reached"), { code: "LAUNCHCLIP_COST_LIMIT" });
    },
    sleep: async () => {},
    maxRetries: 3
  });
  await assert.rejects(
    () => client.submitStructured({ input: "x", schema: SCHEMA, schemaName: "answer", background: false }),
    (error) => error.code === "LAUNCHCLIP_COST_LIMIT"
  );
  assert.equal(calls, 1);
});

test("resumes a persisted background response without submitting a duplicate", async () => {
  const requests = [];
  const client = new OpenAIResponsesClient({
    apiKey: "test-key",
    fetch: async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({ id: "resp_resume", status: "completed", model: "gpt-5.6-sol", output_text: '{"answer":"resumed"}', usage: { total_tokens: 9 } });
    },
    sleep: async () => {}
  });
  const result = await client.resumeStructured("resp_resume", { pollIntervalMs: 0 });
  assert.deepEqual(result.value, { answer: "resumed" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].init.method, "GET");
  assert.match(requests[0].url, /\/responses\/resp_resume$/);
});

test("reports refusals, terminal failures, invalid JSON, and missing credentials safely", async () => {
  assert.throws(() => new OpenAIResponsesClient({ apiKey: "" }), /OPENAI_API_KEY/);
  assert.throws(() => parseStructuredOutput({
    id: "resp_refused",
    status: "completed",
    output: [{ type: "message", content: [{ type: "refusal", refusal: "cannot comply" }] }]
  }), /refused/);
  assert.throws(() => parseStructuredOutput({ id: "resp_bad", status: "completed", output_text: "not-json" }), /not valid JSON/);

  const client = new OpenAIResponsesClient({
    apiKey: "test-key",
    fetch: async () => jsonResponse({ id: "resp_failed", status: "failed", error: { message: "provider failed" } }),
    sleep: async () => {}
  });
  await assert.rejects(() => client.runStructured({ input: "x", schema: SCHEMA, schemaName: "answer" }), /provider failed/);
});

// A background response that ends `finishesAtMs` after it was submitted, on a clock only `sleep` moves.
function backgroundRun(finishesAtMs) {
  let clock = 0;
  const sleeps = [];
  let polls = 0;
  const client = new OpenAIResponsesClient({
    apiKey: "test-key",
    fetch: async (url, init) => {
      if (init.method === "POST") return jsonResponse({ id: "resp_slow", status: "queued" });
      polls += 1;
      return clock >= finishesAtMs
        ? jsonResponse({ id: "resp_slow", status: "completed", output_text: '{"answer":"done"}' })
        : jsonResponse({ id: "resp_slow", status: "in_progress" });
    },
    sleep: async (ms) => { sleeps.push(ms); clock += ms; }
  });
  const run = (options = {}) => client.runStructured({ input: "x", schema: SCHEMA, schemaName: "answer", ...options });
  return { run, sleeps, seenAtMs: () => clock, polls: () => polls };
}

test("polls a background response often at first, so a finished one is seen sooner", async () => {
  const steady = backgroundRun(7_000);
  const before = await steady.run({ pollIntervalMs: 5_000 });
  assert.deepEqual(steady.sleeps, [5_000, 5_000]);
  assert.equal(steady.seenAtMs(), 10_000);

  const quick = backgroundRun(7_000);
  const after = await quick.run();
  assert.deepEqual(quick.sleeps, [1_000, 1_000, 2_000, 2_000, 2_000]);
  assert.equal(quick.seenAtMs(), 8_000);
  assert.deepEqual(after, before);
});

test("a long background response goes back to a 5 s poll", async () => {
  assert.deepEqual([0, 1_000, 2_000, 118_000, 120_000, 600_000].map(pollDelayMs), [1_000, 1_000, 2_000, 2_000, 5_000, 5_000]);

  const long = backgroundRun(10 * 60_000);
  await long.run();
  assert.equal(long.seenAtMs(), 10 * 60_000);
  assert.equal(long.sleeps.at(-1), 5_000);
  // A steady 5 s poll would take 120.
  assert.equal(long.polls(), 157);
  assert.ok(Math.max(...long.sleeps) <= 5_000);
});

test("gives up after the same wait as before", async () => {
  const steady = backgroundRun(Infinity);
  await assert.rejects(() => steady.run({ pollIntervalMs: 5_000, maxWaitMs: 60_000 }), /did not complete within 60000ms/);
  assert.equal(steady.polls(), 12);

  const quick = backgroundRun(Infinity);
  await assert.rejects(() => quick.run({ maxWaitMs: 60_000 }), /did not complete within 60000ms/);
  assert.equal(quick.seenAtMs(), 60_000);
});

function jsonResponse(value, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    text: async () => JSON.stringify(value)
  };
}

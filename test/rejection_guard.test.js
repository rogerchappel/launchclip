import assert from "node:assert/strict";
import test from "node:test";
import { guardRejections } from "../src/rejection_guard.js";
import { asInTheCli, lateHandledRejection } from "./helpers/rejections.js";

test("a rejection handled late reaches the awaiting caller with its own message", async () => {
  await asInTheCli(async () => {
    await assert.rejects(guardRejections(() => lateHandledRejection("getaddrinfo EAI_AGAIN remotion.media")), /getaddrinfo EAI_AGAIN remotion\.media/);
    assert.equal(process.listenerCount("unhandledRejection"), 0, "the guard removes its listeners");
  });
});

test("a rejection nothing handles fails the guarded work, even when the work itself would hang", async () => {
  await asInTheCli(() => assert.rejects(guardRejections(async () => {
    Promise.reject(new Error("compositor exited with code 1"));
    await new Promise(() => {});
  }, { graceMs: 50 }), /compositor exited with code 1/));
});

test("a rejection nothing handles fails work that otherwise finished", async () => {
  await asInTheCli(() => assert.rejects(guardRejections(async () => {
    Promise.reject(new Error("stray"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    return "done";
  }), /stray/));
});

test("guarded work that succeeds returns its value; guards nest", async () => {
  assert.equal(await guardRejections(() => guardRejections(async () => 42)), 42);
  assert.equal(await guardRejections(() => "sync"), "sync");
});

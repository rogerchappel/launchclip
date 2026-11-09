import assert from "node:assert/strict";
import test from "node:test";
import { autoResearch, briefSignals } from "../src/research/auto.js";

const on = (text, options = {}) => autoResearch({ text, ...options });

test("auto turns research on for news wording, dated events, named releases and questions of fact", () => {
  assert.equal(on("The latest AI news this week").run, true);
  assert.match(on("The latest AI news this week").reason, /reads as news \(news wording: "news"\)/);
  assert.equal(on("What did Nimbus AI announce on October 6, 2026?").run, true);
  assert.match(on("What did Nimbus AI announce on October 6, 2026?").reason, /a dated event: "October 6, 2026"/);
  assert.equal(on("A 45 second video on why Nimbus AI released Nimbus-7B").run, true);
  assert.equal(on("Nimbus-7B explained in 60 seconds").run, true);
  assert.equal(on("Did Nimbus AI release Nimbus-7B?").run, true);
});

test("auto leaves research off for product videos, evergreen topics and briefs with their own script", () => {
  const promo = on("A 6-second launch video for a fictional SaaS called Ledgerly that reconciles Stripe payouts automatically", { media: 2 });
  assert.equal(promo.run, false);
  assert.match(promo.reason, /launch video with 2 supplied media files: the facts are the brand's own/);
  // A promo's own release date and "latest" do not make it news.
  assert.equal(on("A promo for the latest version of Ledgerly 2.0, released March 3, 2026").run, false);
  assert.equal(on("3 common deck materials in Australia").run, false);
  assert.equal(on("How does compound interest work?").run, false);
  assert.equal(on("Try Ledgerly today. Reconcile 10,000 payouts.").run, false);
  assert.equal(on("The history of the Roman Empire since 2019").run, false);
  const scripted = on("Nimbus AI released Nimbus-7B on October 6, 2026\n\n## Script\nNimbus is here.");
  assert.equal(scripted.run, false);
  assert.match(scripted.reason, /supplies its own script/);
});

test("news wording wins over a product framing, and a recording lane is never researched", () => {
  assert.equal(on("A promo for our weekly AI news show: this week's headlines").run, true);
  const footage = on("The latest AI news this week", { lane: "footage-led" });
  assert.equal(footage.run, false);
  assert.match(footage.reason, /footage-led lane takes its words from the supplied recording/);
});

test("every signal is listed with the words that raised it", () => {
  assert.deepEqual(briefSignals("What did Nimbus AI announce on October 6, 2026?").map((entry) => entry.kind), ["dated-event", "named-release", "fact-question"]);
  assert.deepEqual(on("3 common deck materials in Australia").signals, []);
  assert.deepEqual(on("The latest AI news this week").signals, ["news wording: \"news\"", "recency wording: \"latest\""]);
});

// List order (src/list_order.js): a later list item shown before the earlier
// ones must say it is a teaser ("Coming up"), else it is an ordering bug.
import assert from "node:assert/strict";
import test from "node:test";
import { isTeaser, listOrdinal, orderFindings, storyboardOrderErrors } from "../src/list_order.js";

test("listOrdinal reads labels and spoken list items", () => {
  assert.equal(listOrdinal("Material three · Catches bare feet in sun"), 3);
  assert.equal(listOrdinal("Option 2 · Dense hardwoods"), 2);
  assert.equal(listOrdinal("First · Treated pine"), 1);
  assert.equal(listOrdinal("And number three catches bare feet"), 3);
  assert.equal(listOrdinal("Real deck cost shows up in upkeep"), null);
  assert.equal(listOrdinal("Three boards sorted"), null);
  assert.ok(isTeaser("Coming up: number three burns bare feet"));
});

const scene = (id, params) => ({ id, module: "split-screen", params });

test("fail: material three's card leads the list, unlabelled", () => {
  const board = { scenes: [scene("hook", { title: "Real deck cost shows up in upkeep" }), scene("loop", { kicker: "Material three", title: "Catches bare feet in sun" }), scene("one", { kicker: "First · Treated pine", title: "Cheapest to buy" }), scene("two", { kicker: "Option 2 · Dense hardwoods" }), scene("three", { kicker: "Option 3 · Composite" })] };
  const errors = storyboardOrderErrors(board);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^order: scene loop shows list item three before item one/);
  // A callout on footage is on-screen text too.
  board.scenes[1] = { id: "loop", module: "clip", params: { media: "assets/a.mp4", callouts: [{ text: "Material three" }] } };
  assert.equal(storyboardOrderErrors(board).length, 1);
});

test("pass: the same card labelled as a teaser, and the list in order", () => {
  const board = { scenes: [scene("hook", { title: "Real deck cost shows up in upkeep" }), scene("loop", { kicker: "Coming up", title: "Number three catches bare feet in sun" }), scene("one", { kicker: "First · Treated pine" }), scene("two", { kicker: "Option 2" }), scene("three", { kicker: "Option 3 · Composite" })] };
  assert.deepEqual(storyboardOrderErrors(board), []);
  // A teaser does not stand in for the item: three is still checked in its turn.
  assert.deepEqual(orderFindings([{ text: "Coming up: number three" }, { text: "Option 3" }]), [{ index: 1, ordinal: 3, before: 1 }]);
});

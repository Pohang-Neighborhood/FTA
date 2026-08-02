import assert from "node:assert/strict";
import test from "node:test";

import {
  lineupCompatibility,
  replaceLineupSlot,
  sortLineupCandidates,
  swapLineupSlots,
} from "../lib/lineup-editor.js";

function player(id, position, overall, name = id) {
  return {
    id,
    name,
    position,
    abilities: { overall },
  };
}

test("classifies exact, out-of-position, and goalkeeper-ineligible candidates", () => {
  assert.equal(lineupCompatibility("LCB", "DF"), "exact");
  assert.equal(lineupCompatibility("AM", "FW"), "out-of-position");
  assert.equal(lineupCompatibility("GK", "DF"), "ineligible");
  assert.equal(lineupCompatibility("ST", "GK"), "ineligible");
});

test("replaces one lineup slot without mutating or duplicating players", () => {
  const lineup = ["gk", "cb", "st"];
  assert.deepEqual(replaceLineupSlot(lineup, 2, "sub"), ["gk", "cb", "sub"]);
  assert.deepEqual(lineup, ["gk", "cb", "st"]);
  assert.throws(() => replaceLineupSlot(lineup, 3, "sub"), RangeError);
  assert.throws(() => replaceLineupSlot(lineup, 2, "cb"), RangeError);
});

test("swaps two starting lineup slots without mutating the original lineup", () => {
  const lineup = ["gk", "cb", "cm", "st"];
  assert.deepEqual(swapLineupSlots(lineup, 1, 3), ["gk", "st", "cm", "cb"]);
  assert.deepEqual(lineup, ["gk", "cb", "cm", "st"]);
  assert.throws(() => swapLineupSlots(lineup, 1, 1), RangeError);
  assert.throws(() => swapLineupSlots(lineup, 1, 4), RangeError);
});

test("sorts eligible bench players by role fit then overall ability", () => {
  const candidates = sortLineupCandidates(
    [
      player("selected", "DF", 90),
      player("mf-low", "MF", 71),
      player("fw-high", "FW", 91),
      player("mf-high", "MF", 83),
      player("gk", "GK", 99),
    ],
    ["selected"],
    "CM",
  );

  assert.deepEqual(
    candidates.map(({ player: candidate, compatibility }) => [
      candidate.id,
      compatibility,
    ]),
    [
      ["mf-high", "exact"],
      ["mf-low", "exact"],
      ["fw-high", "out-of-position"],
    ],
  );
});

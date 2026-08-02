import assert from "node:assert/strict";
import test from "node:test";

import {
  appendTacticalInstruction,
  deserializeTacticalInstructions,
  nextInstructionTimeMs,
  normalizeInstructionTimeMs,
  reorderTacticalInstruction,
  removeTacticalInstruction,
  replaceTacticalInstruction,
  serializeTacticalInstructions,
} from "../lib/instruction-model.js";

function movement(overrides = {}) {
  return {
    id: "instruction-1",
    order: 1,
    type: "move",
    playerId: "home:st",
    atMs: 0,
    waypoints: [{ x: 50, y: 35 }],
    ...overrides,
  };
}

function pass(overrides = {}) {
  return {
    id: "instruction-2",
    order: 2,
    type: "pass",
    playerId: "home:st",
    targetPlayerId: "home:rw",
    atMs: 1_000,
    ...overrides,
  };
}

test("normalizes seconds-derived times to the 50ms simulation tick", () => {
  assert.equal(normalizeInstructionTimeMs(1_230, 12_000), 1_250);
  assert.equal(normalizeInstructionTimeMs(-500, 12_000), 0);
  assert.equal(normalizeInstructionTimeMs(20_000, 12_000), 11_950);
});

test("suggests instruction times independently for each home player", () => {
  const instructions = [movement(), pass()];
  assert.equal(nextInstructionTimeMs([], "home:st", 12_000), 0);
  assert.equal(nextInstructionTimeMs(instructions, "home:st", 12_000), 2_000);
  assert.equal(nextInstructionTimeMs(instructions, "home:rw", 12_000), 0);
  assert.equal(
    nextInstructionTimeMs([pass({ atMs: 11_500 })], "home:st", 12_000),
    null,
  );
});

test("adds, edits, and removes instructions without renumbering stable ids", () => {
  const original = [movement()];
  const added = appendTacticalInstruction(original, pass());
  const edited = replaceTacticalInstruction(added, pass({ atMs: 500 }));
  const removed = removeTacticalInstruction(edited, "instruction-1");

  assert.deepEqual(original, [movement()]);
  assert.deepEqual(edited.map((instruction) => instruction.id), [
    "instruction-1",
    "instruction-2",
  ]);
  assert.deepEqual(removed.map((instruction) => instruction.id), [
    "instruction-2",
  ]);
  assert.equal(removed[0].atMs, 500);
});

test("reorders only instructions that share the same execution tick", () => {
  const first = movement();
  const second = pass({ atMs: 0 });
  const sameTick = reorderTacticalInstruction([first, second], second.id, -1);
  const differentTicks = reorderTacticalInstruction(
    [first, pass()],
    "instruction-2",
    -1,
  );

  assert.deepEqual(sameTick.map((instruction) => instruction.id), [
    "instruction-2",
    "instruction-1",
  ]);
  assert.deepEqual(differentTicks.map((instruction) => instruction.id), [
    "instruction-1",
    "instruction-2",
  ]);
});

test("serializes canonical order and restores an isolated instruction copy", () => {
  const input = [pass(), movement()];
  const serialized = serializeTacticalInstructions(input);
  const restored = deserializeTacticalInstructions(serialized);

  assert.deepEqual(restored.map((instruction) => instruction.id), [
    "instruction-1",
    "instruction-2",
  ]);
  assert.equal(serialized, serializeTacticalInstructions(restored));
  restored[0].waypoints[0].x = 12;
  assert.equal(input[1].waypoints[0].x, 50);
});

test("rejects opponent actors and invalid pass targets", () => {
  assert.throws(
    () => serializeTacticalInstructions([movement({ playerId: "away:st" })]),
    /home player/,
  );
  assert.throws(
    () =>
      serializeTacticalInstructions([
        pass({ targetPlayerId: "away:cb" }),
      ]),
    /home player/,
  );
  assert.throws(
    () => serializeTacticalInstructions([pass({ targetPlayerId: "home:st" })]),
    /same player/,
  );
});

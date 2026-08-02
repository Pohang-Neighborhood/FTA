import assert from "node:assert/strict";
import test from "node:test";

import { invalidateDependentInstructions } from "../lib/sequence-invalidation.js";

function move(id, playerId) {
  return {
    id,
    order: 1,
    type: "move",
    playerId,
    atMs: 0,
    waypoints: [{ x: 50, y: 40 }],
  };
}

function carry(id, playerId) {
  return {
    id,
    order: 2,
    type: "carry",
    playerId,
    atMs: 0,
    waypoints: [{ x: 55, y: 35 }],
  };
}

function pass(id, playerId, targetPlayerId) {
  return {
    id,
    order: 3,
    type: "pass",
    playerId,
    targetPlayerId,
    atMs: 0,
  };
}

function sequence(id, order, instructions) {
  return { id, order, name: `시퀀스 ${order}`, instructions };
}

const source = [
  sequence("sequence-1", 1, [
    move("move-a-1", "home:a"),
    move("move-b-1", "home:b"),
    pass("pass-1", "home:a", "home:b"),
  ]),
  sequence("sequence-2", 2, [
    move("move-a-2", "home:a"),
    carry("carry-b-2", "home:b"),
    pass("pass-2", "home:b", "home:a"),
  ]),
  sequence("sequence-3", 3, [
    move("move-a-3", "home:a"),
    move("move-b-3", "home:b"),
  ]),
];

test("initial player placement change removes that player's movement from every sequence", () => {
  const result = invalidateDependentInstructions(source, {
    playerIds: ["home:a"],
  });

  assert.deepEqual(result.removedInstructionIds, [
    "move-a-1",
    "move-a-2",
    "move-a-3",
  ]);
  assert.deepEqual(
    result.sequences.flatMap((candidate) =>
      candidate.instructions.map((instruction) => instruction.id),
    ),
    ["move-b-1", "pass-1", "carry-b-2", "pass-2", "move-b-3"],
  );
  assert.equal(source[0].instructions.length, 3);
});

test("sequence player change removes only later movement for that player", () => {
  const result = invalidateDependentInstructions(source, {
    playerIds: ["home:a"],
    fromSequenceId: "sequence-1",
    includeSource: false,
  });

  assert.deepEqual(result.removedInstructionIds, ["move-a-2", "move-a-3"]);
  assert.equal(result.sequences[0].instructions.length, 3);
  assert.deepEqual(
    result.sequences[2].instructions.map((instruction) => instruction.id),
    ["move-b-3"],
  );
});

test("ball state change removes later passes and carries but preserves moves", () => {
  const result = invalidateDependentInstructions(source, {
    ball: true,
    fromSequenceId: "sequence-1",
    includeSource: false,
  });

  assert.deepEqual(result.removedInstructionIds, ["carry-b-2", "pass-2"]);
  assert.deepEqual(
    result.sequences[1].instructions.map((instruction) => instruction.id),
    ["move-a-2"],
  );
  assert.equal(result.sequences[0].instructions.length, 3);
});

test("combined player and ball invalidation removes each dependent instruction once", () => {
  const result = invalidateDependentInstructions(source, {
    playerIds: ["home:b"],
    ball: true,
  });

  assert.deepEqual(result.removedInstructionIds, [
    "move-b-1",
    "pass-1",
    "carry-b-2",
    "pass-2",
    "move-b-3",
  ]);
});

test("removing a later carry cascades ball invalidation into following sequences", () => {
  const withFollowingPass = source.map((candidate) =>
    candidate.id === "sequence-3"
      ? {
          ...candidate,
          instructions: [
            ...candidate.instructions,
            pass("pass-3", "home:a", "home:b"),
          ],
        }
      : candidate,
  );
  const result = invalidateDependentInstructions(withFollowingPass, {
    playerIds: ["home:b"],
    fromSequenceId: "sequence-1",
    includeSource: false,
  });

  assert.deepEqual(result.removedInstructionIds, [
    "carry-b-2",
    "move-b-3",
    "pass-3",
  ]);
});

test("rejects an unknown source sequence", () => {
  assert.throws(
    () =>
      invalidateDependentInstructions(source, {
        ball: true,
        fromSequenceId: "unknown",
      }),
    /Unknown source sequence/,
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  TACTICAL_SEQUENCE_VERSION,
  appendTacticalInstruction,
  appendTacticalSequence,
  createDefaultTacticalSequence,
  deserializeTacticalInstructions,
  deserializeTacticalSequences,
  nextInstructionTimeMs,
  normalizeInstructionTimeMs,
  reorderTacticalInstruction,
  reorderTacticalSequence,
  removeTacticalInstruction,
  removeTacticalSequence,
  replaceTacticalInstruction,
  replaceTacticalSequence,
  serializeTacticalInstructions,
  serializeTacticalSequences,
  sortTacticalSequences,
  validateTacticalSequences,
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

function sequence(overrides = {}) {
  return {
    id: "sequence-1",
    order: 1,
    name: "시퀀스 1",
    startAtMs: 0,
    instructions: [movement()],
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

test("creates an isolated default tactical sequence with timeline defaults", () => {
  const instructions = [movement({ atMs: 500 })];
  const created = createDefaultTacticalSequence({ instructions });

  assert.deepEqual(created, {
    id: "sequence-1",
    order: 1,
    name: "시퀀스 1",
    startAtMs: 0,
    instructions,
  });
  created.instructions[0].waypoints[0].x = 12;
  assert.equal(instructions[0].waypoints[0].x, 50);

  assert.deepEqual(
    createDefaultTacticalSequence({
      id: "sequence-2",
      order: 2,
      name: "시퀀스 2",
      startAtMs: 1_000,
    }),
    {
      id: "sequence-2",
      order: 2,
      name: "시퀀스 2",
      startAtMs: 1_000,
      instructions: [],
    },
  );
});

test("sorts sequence slots while preserving relative instruction offsets", () => {
  const first = sequence({ order: 7 });
  const second = sequence({
    id: "sequence-2",
    order: 7,
    name: "시퀀스 2",
    startAtMs: 2_000,
    instructions: [pass({ atMs: 500 })],
  });

  const sorted = sortTacticalSequences([second, first]);
  const validated = validateTacticalSequences([second, first]);

  assert.deepEqual(sorted.map((candidate) => candidate.id), [
    "sequence-1",
    "sequence-2",
  ]);
  assert.deepEqual(validated.map((candidate) => candidate.id), [
    "sequence-1",
    "sequence-2",
  ]);
  assert.deepEqual(validated.map((candidate) => candidate.order), [1, 2]);
  assert.equal(validated[1].startAtMs, 2_000);
  assert.equal(validated[1].instructions[0].atMs, 500);
  const canonicalSerialized = serializeTacticalSequences([second, first]);
  assert.deepEqual(
    JSON.parse(canonicalSerialized).sequences.map(
      (candidate) => candidate.order,
    ),
    [1, 2],
  );
  assert.deepEqual(
    deserializeTacticalSequences(canonicalSerialized).map(
      (candidate) => candidate.order,
    ),
    [1, 2],
  );
});

test("keeps relative actions inside their sequence timeline slot", () => {
  assert.throws(
    () =>
      validateTacticalSequences([
        sequence({ instructions: [movement({ atMs: 1_000 })] }),
        sequence({
          id: "sequence-2",
          order: 2,
          name: "시퀀스 2",
          startAtMs: 1_000,
          instructions: [pass()],
        }),
      ]),
    /must execute before the next sequence starts/,
  );

  const lastSequenceUnbounded = validateTacticalSequences([
    sequence(),
    sequence({
      id: "sequence-2",
      order: 2,
      name: "시퀀스 2",
      startAtMs: 1_000,
      instructions: [pass({ atMs: 10_000 })],
    }),
  ]);
  assert.equal(lastSequenceUnbounded[1].instructions[0].atMs, 10_000);
});

test("rejects invalid sequence timeline slots and globally duplicated ids", () => {
  assert.throws(
    () => validateTacticalSequences([]),
    /requires at least one tactical sequence/,
  );
  assert.throws(
    () => serializeTacticalSequences([]),
    /requires at least one tactical sequence/,
  );
  assert.throws(
    () => validateTacticalSequences([sequence({ startAtMs: 50 })]),
    /must be 0 for the first sequence/,
  );
  assert.throws(
    () =>
      validateTacticalSequences([
        sequence(),
        sequence({
          id: "sequence-2",
          order: 2,
          instructions: [pass()],
        }),
      ]),
    /must be later than the previous sequence/,
  );
  assert.throws(
    () =>
      validateTacticalSequences([
        sequence(),
        sequence({
          id: "sequence-2",
          order: 2,
          startAtMs: 1_025,
          instructions: [pass()],
        }),
      ]),
    /non-negative simulation tick/,
  );
  assert.throws(
    () =>
      validateTacticalSequences([
        sequence(),
        sequence({ order: 2, startAtMs: 1_000, instructions: [pass()] }),
      ]),
    /duplicate id sequence-1/,
  );
  assert.throws(
    () =>
      validateTacticalSequences([
        sequence(),
        sequence({
          id: "sequence-2",
          order: 2,
          startAtMs: 1_000,
          instructions: [movement()],
        }),
      ]),
    /duplicate instruction id instruction-1/,
  );
});

test("appends and replaces complete sequence cards", () => {
  const first = createDefaultTacticalSequence();
  const second = sequence({
    id: "sequence-2",
    order: 2,
    name: "침투",
    startAtMs: 1_000,
    instructions: [pass()],
  });
  const added = appendTacticalSequence([first], second);
  const replaced = replaceTacticalSequence(added, {
    ...added[1],
    name: "후방 침투",
    startAtMs: 1_500,
  });

  assert.deepEqual(added.map((candidate) => candidate.id), [
    "sequence-1",
    "sequence-2",
  ]);
  assert.equal(replaced[1].name, "후방 침투");
  assert.equal(replaced[1].startAtMs, 1_500);
  assert.throws(
    () => replaceTacticalSequence(added, { ...second, id: "unknown" }),
    /Unknown sequence id unknown/,
  );
});

test("reorders cards by swapping adjacent timeline slots", () => {
  const sequences = [
    sequence(),
    sequence({
      id: "sequence-2",
      order: 2,
      name: "시퀀스 2",
      startAtMs: 1_000,
      instructions: [pass({ atMs: 0 })],
    }),
    sequence({
      id: "sequence-3",
      order: 3,
      name: "시퀀스 3",
      startAtMs: 2_000,
      instructions: [movement({ id: "instruction-3", playerId: "home:rw" })],
    }),
  ];

  const reordered = reorderTacticalSequence(sequences, "sequence-2", 1);

  assert.deepEqual(reordered.map((candidate) => candidate.id), [
    "sequence-1",
    "sequence-3",
    "sequence-2",
  ]);
  assert.deepEqual(reordered.map((candidate) => candidate.startAtMs), [
    0, 1_000, 2_000,
  ]);
  assert.deepEqual(reordered.map((candidate) => candidate.order), [1, 2, 3]);
  assert.equal(reordered[1].instructions[0].id, "instruction-3");
  assert.deepEqual(
    reorderTacticalSequence(reordered, "sequence-1", -1),
    reordered,
  );
});

test("rejects a reorder when a card no longer fits its earlier timeline slot", () => {
  const sequences = [
    createDefaultTacticalSequence(),
    sequence({
      id: "sequence-2",
      order: 2,
      name: "시퀀스 2",
      startAtMs: 1_000,
      instructions: [pass({ atMs: 0 })],
    }),
    sequence({
      id: "sequence-3",
      order: 3,
      name: "시퀀스 3",
      startAtMs: 3_000,
      instructions: [
        movement({ id: "instruction-3", playerId: "home:rw", atMs: 2_500 }),
      ],
    }),
  ];

  assert.throws(
    () => reorderTacticalSequence(sequences, "sequence-3", -1),
    /must execute before the next sequence starts/,
  );
});

test("removes only empty sequences and keeps a valid numbered timeline", () => {
  const nonEmpty = sequence();
  const empty = sequence({
    id: "sequence-2",
    order: 2,
    name: "빈 시퀀스",
    startAtMs: 1_000,
    instructions: [],
  });
  const last = sequence({
    id: "sequence-3",
    order: 3,
    name: "시퀀스 3",
    startAtMs: 2_000,
    instructions: [pass()],
  });

  assert.throws(
    () => removeTacticalSequence([nonEmpty, empty, last], nonEmpty.id),
    /Cannot remove a non-empty tactical sequence/,
  );
  assert.throws(
    () =>
      removeTacticalSequence(
        [createDefaultTacticalSequence()],
        "sequence-1",
      ),
    /Cannot remove the final tactical sequence/,
  );
  const removedMiddle = removeTacticalSequence(
    [nonEmpty, empty, last],
    empty.id,
  );
  assert.deepEqual(removedMiddle.map((candidate) => candidate.id), [
    "sequence-1",
    "sequence-3",
  ]);
  assert.deepEqual(removedMiddle.map((candidate) => candidate.order), [1, 2]);

  const promoted = removeTacticalSequence(
    [createDefaultTacticalSequence(), last],
    "sequence-1",
  );
  assert.equal(promoted[0].id, "sequence-3");
  assert.equal(promoted[0].startAtMs, 0);
  assert.equal(promoted[0].order, 1);
});

test("serializes version 2 sequences canonically and restores isolated copies", () => {
  const first = sequence();
  const second = sequence({
    id: "sequence-2",
    order: 2,
    name: "시퀀스 2",
    startAtMs: 1_000,
    instructions: [pass({ atMs: 250 })],
  });
  const serialized = serializeTacticalSequences([second, first]);
  const document = JSON.parse(serialized);
  const restored = deserializeTacticalSequences(serialized);

  assert.equal(document.version, TACTICAL_SEQUENCE_VERSION);
  assert.deepEqual(document.sequences.map((candidate) => candidate.id), [
    "sequence-1",
    "sequence-2",
  ]);
  assert.equal(serialized, serializeTacticalSequences(restored));
  restored[0].instructions[0].waypoints[0].x = 12;
  assert.equal(first.instructions[0].waypoints[0].x, 50);
});

test("migrates version 1 flat instructions into one equivalent sequence", () => {
  const serializedV1 = serializeTacticalInstructions([pass(), movement()]);
  const flat = deserializeTacticalInstructions(serializedV1);
  const migrated = deserializeTacticalSequences(serializedV1);

  assert.equal(migrated.length, 1);
  assert.deepEqual(migrated[0], {
    id: "sequence-1",
    order: 1,
    name: "시퀀스 1",
    startAtMs: 0,
    instructions: flat,
  });
  assert.deepEqual(
    migrated[0].instructions.map((instruction) => instruction.atMs),
    flat.map((instruction) => instruction.atMs),
  );
  assert.equal(
    JSON.parse(serializeTacticalSequences(migrated)).version,
    TACTICAL_SEQUENCE_VERSION,
  );
});

test("rejects unsupported tactical sequence document versions", () => {
  assert.throws(
    () => deserializeTacticalSequences(JSON.stringify({ version: 3 })),
    /Unsupported tactical sequence version/,
  );
  assert.throws(
    () => deserializeTacticalSequences(null),
    /serialized sequences must be a string/,
  );
});

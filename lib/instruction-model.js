import { SIMULATION_TICK_MS } from "./simulation-core.js";

export const DEFAULT_INSTRUCTION_INTERVAL_MS = 1_000;
export const TACTICAL_INSTRUCTION_VERSION = 1;
export const TACTICAL_SEQUENCE_VERSION = 3;
const LEGACY_TIMED_SEQUENCE_VERSION = 2;

const MOVEMENT_TYPES = new Set(["move", "carry"]);

function clonePoint(point) {
  return { x: point.x, y: point.y };
}

function cloneInstruction(instruction) {
  if (MOVEMENT_TYPES.has(instruction.type)) {
    return {
      id: instruction.id,
      order: instruction.order,
      type: instruction.type,
      playerId: instruction.playerId,
      atMs: instruction.atMs,
      waypoints: instruction.waypoints.map(clonePoint),
    };
  }
  return {
    id: instruction.id,
    order: instruction.order,
    type: instruction.type,
    playerId: instruction.playerId,
    atMs: instruction.atMs,
    targetPlayerId: instruction.targetPlayerId,
  };
}

function assertFiniteNumber(value, label) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
}

function assertHomeParticipantId(value, label) {
  if (typeof value !== "string" || !value.startsWith("home:")) {
    throw new RangeError(`${label} must reference a home player.`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}

function assertPoint(point, label) {
  if (!point || typeof point !== "object") {
    throw new TypeError(`${label} must be a pitch point.`);
  }
  assertFiniteNumber(point.x, `${label}.x`);
  assertFiniteNumber(point.y, `${label}.y`);
  if (point.x < 0 || point.x > 100 || point.y < 0 || point.y > 100) {
    throw new RangeError(`${label} must stay inside the pitch.`);
  }
}

function validateInstruction(instruction, index) {
  const label = `instructions[${index}]`;
  if (!instruction || typeof instruction !== "object") {
    throw new TypeError(`${label} must be an object.`);
  }
  if (typeof instruction.id !== "string" || instruction.id.length === 0) {
    throw new TypeError(`${label}.id must be a non-empty string.`);
  }
  if (!Number.isInteger(instruction.order) || instruction.order < 0) {
    throw new RangeError(`${label}.order must be a non-negative integer.`);
  }
  assertHomeParticipantId(instruction.playerId, `${label}.playerId`);
  assertFiniteNumber(instruction.atMs, `${label}.atMs`);
  if (
    instruction.atMs < 0 ||
    instruction.atMs % SIMULATION_TICK_MS !== 0
  ) {
    throw new RangeError(
      `${label}.atMs must be a non-negative simulation tick.`,
    );
  }

  if (MOVEMENT_TYPES.has(instruction.type)) {
    if (!Array.isArray(instruction.waypoints) || instruction.waypoints.length === 0) {
      throw new RangeError(`${label}.waypoints requires at least one point.`);
    }
    instruction.waypoints.forEach((point, pointIndex) =>
      assertPoint(point, `${label}.waypoints[${pointIndex}]`),
    );
    return;
  }

  if (instruction.type === "pass") {
    assertHomeParticipantId(
      instruction.targetPlayerId,
      `${label}.targetPlayerId`,
    );
    if (instruction.targetPlayerId === instruction.playerId) {
      throw new RangeError(`${label} cannot pass to the same player.`);
    }
    return;
  }

  throw new RangeError(`${label}.type is not supported.`);
}

export function compareTacticalInstructions(left, right) {
  return (
    left.atMs - right.atMs ||
    left.order - right.order ||
    left.id.localeCompare(right.id)
  );
}

export function sortTacticalInstructions(instructions) {
  return instructions
    .map(cloneInstruction)
    .sort(compareTacticalInstructions);
}

export function validateTacticalInstructions(instructions) {
  if (!Array.isArray(instructions)) {
    throw new TypeError("instructions must be an array.");
  }
  const ids = new Set();
  instructions.forEach((instruction, index) => {
    validateInstruction(instruction, index);
    if (ids.has(instruction.id)) {
      throw new RangeError(`instructions contains duplicate id ${instruction.id}.`);
    }
    ids.add(instruction.id);
  });
  return sortTacticalInstructions(instructions);
}

export function normalizeInstructionTimeMs(value, durationMs) {
  assertFiniteNumber(durationMs, "durationMs");
  if (durationMs < SIMULATION_TICK_MS * 2) {
    throw new RangeError("durationMs is too short for an instruction.");
  }
  const finiteValue = Number.isFinite(value) ? value : 0;
  const maximum = durationMs - SIMULATION_TICK_MS;
  return Math.min(
    maximum,
    Math.max(
      0,
      Math.round(finiteValue / SIMULATION_TICK_MS) * SIMULATION_TICK_MS,
    ),
  );
}

export function nextInstructionTimeMs(
  instructions,
  playerId,
  durationMs,
  intervalMs = DEFAULT_INSTRUCTION_INTERVAL_MS,
) {
  assertHomeParticipantId(playerId, "playerId");
  const actorInstructions = instructions.filter(
    (instruction) => instruction.playerId === playerId,
  );
  if (actorInstructions.length === 0) {
    return 0;
  }
  const latestAtMs = Math.max(
    ...actorInstructions.map((instruction) => instruction.atMs),
  );
  const candidate =
    latestAtMs +
    Math.max(
      SIMULATION_TICK_MS,
      Math.round(intervalMs / SIMULATION_TICK_MS) * SIMULATION_TICK_MS,
    );
  return candidate < durationMs ? candidate : null;
}

export function nextSequentialInstructionTimeMs(
  instructions,
  terminalAtMsById,
  sequenceStartedAtMs,
  durationMs,
) {
  assertFiniteNumber(sequenceStartedAtMs, "sequenceStartedAtMs");
  if (sequenceStartedAtMs < 0) {
    throw new RangeError("sequenceStartedAtMs must be non-negative.");
  }
  if (!Array.isArray(instructions) || instructions.length === 0) {
    return 0;
  }

  const terminalAt = (instruction) => {
    const resolved = terminalAtMsById?.get?.(instruction.id);
    return Number.isFinite(resolved)
      ? resolved
      : sequenceStartedAtMs + instruction.atMs;
  };
  const latestTerminalOffsetMs = Math.max(
    ...instructions.map(
      (instruction) => terminalAt(instruction) - sequenceStartedAtMs,
    ),
  );
  return normalizeInstructionTimeMs(
    latestTerminalOffsetMs + SIMULATION_TICK_MS,
    durationMs,
  );
}

export function appendTacticalInstruction(instructions, instruction) {
  return validateTacticalInstructions([...instructions, instruction]);
}

export function replaceTacticalInstruction(instructions, instruction) {
  const index = instructions.findIndex(
    (candidate) => candidate.id === instruction.id,
  );
  if (index < 0) {
    throw new RangeError(`Unknown instruction id ${instruction.id}.`);
  }
  const next = instructions.map((candidate) =>
    candidate.id === instruction.id ? instruction : candidate,
  );
  return validateTacticalInstructions(next);
}

export function removeTacticalInstruction(instructions, instructionId) {
  return sortTacticalInstructions(
    instructions.filter((instruction) => instruction.id !== instructionId),
  );
}

export function reorderTacticalInstruction(
  instructions,
  instructionId,
  direction,
) {
  if (direction !== -1 && direction !== 1) {
    throw new RangeError("direction must be -1 or 1.");
  }
  const sorted = validateTacticalInstructions(instructions);
  const index = sorted.findIndex(
    (instruction) => instruction.id === instructionId,
  );
  if (index < 0) {
    throw new RangeError(`Unknown instruction id ${instructionId}.`);
  }
  const targetIndex = index + direction;
  if (
    targetIndex < 0 ||
    targetIndex >= sorted.length ||
    sorted[targetIndex].atMs !== sorted[index].atMs
  ) {
    return sorted;
  }
  const reordered = [...sorted];
  [reordered[index], reordered[targetIndex]] = [
    reordered[targetIndex],
    reordered[index],
  ];
  return reordered.map((instruction, order) => ({
    ...instruction,
    order: order + 1,
  }));
}

export function serializeTacticalInstructions(instructions) {
  return JSON.stringify({
    version: TACTICAL_INSTRUCTION_VERSION,
    instructions: validateTacticalInstructions(instructions),
  });
}

export function deserializeTacticalInstructions(serialized) {
  if (typeof serialized !== "string") {
    throw new TypeError("serialized instructions must be a string.");
  }
  const document = JSON.parse(serialized);
  if (
    !document ||
    typeof document !== "object" ||
    document.version !== TACTICAL_INSTRUCTION_VERSION
  ) {
    throw new RangeError("Unsupported tactical instruction version.");
  }
  return validateTacticalInstructions(document.instructions);
}

export function movementInstructionsForPlayer(instructions, playerId) {
  return sortTacticalInstructions(
    instructions.filter(
      (instruction) =>
        instruction.playerId === playerId &&
        MOVEMENT_TYPES.has(instruction.type),
    ),
  );
}

export function isMovementInstruction(instruction) {
  return MOVEMENT_TYPES.has(instruction.type);
}

function cloneTacticalSequence(sequence) {
  return {
    id: sequence.id,
    order: sequence.order,
    name: sequence.name,
    instructions: sortTacticalInstructions(sequence.instructions),
  };
}

function validateSequenceShape(sequence, index) {
  const label = `sequences[${index}]`;
  if (!sequence || typeof sequence !== "object") {
    throw new TypeError(`${label} must be an object.`);
  }
  assertNonEmptyString(sequence.id, `${label}.id`);
  if (!Number.isInteger(sequence.order) || sequence.order < 0) {
    throw new RangeError(`${label}.order must be a non-negative integer.`);
  }
  assertNonEmptyString(sequence.name, `${label}.name`);
  const instructions = validateTacticalInstructions(sequence.instructions);
  return {
    ...sequence,
    instructions,
  };
}

export function compareTacticalSequences(left, right) {
  return (
    left.order - right.order ||
    left.id.localeCompare(right.id)
  );
}

export function sortTacticalSequences(sequences) {
  if (!Array.isArray(sequences)) {
    throw new TypeError("sequences must be an array.");
  }
  return sequences
    .map((sequence, index) =>
      cloneTacticalSequence(validateSequenceShape(sequence, index)),
    )
    .sort(compareTacticalSequences);
}

export function validateTacticalSequences(sequences) {
  const sorted = sortTacticalSequences(sequences);
  if (sorted.length === 0) {
    throw new RangeError("sequences requires at least one tactical sequence.");
  }
  const sequenceIds = new Set();
  const instructionIds = new Set();

  sorted.forEach((sequence) => {
    if (sequenceIds.has(sequence.id)) {
      throw new RangeError(`sequences contains duplicate id ${sequence.id}.`);
    }
    sequenceIds.add(sequence.id);

    for (const instruction of sequence.instructions) {
      if (instructionIds.has(instruction.id)) {
        throw new RangeError(
          `sequences contains duplicate instruction id ${instruction.id}.`,
        );
      }
      instructionIds.add(instruction.id);
    }

  });

  return sorted.map((sequence, index) => ({
    ...sequence,
    order: index + 1,
  }));
}

function normalizeSequenceOrders(sequences) {
  return sortTacticalSequences(sequences).map((sequence, index) => ({
    ...sequence,
    order: index + 1,
  }));
}

export function createDefaultTacticalSequence(overrides = {}) {
  const sequence = {
    id: "sequence-1",
    order: 1,
    name: "시퀀스 1",
    instructions: [],
    ...overrides,
  };
  return cloneTacticalSequence(validateSequenceShape(sequence, 0));
}

export function appendTacticalSequence(sequences, sequence) {
  const current = validateTacticalSequences(sequences);
  validateSequenceShape(sequence, current.length);
  return validateTacticalSequences([...current, sequence]);
}

export function replaceTacticalSequence(sequences, sequence) {
  const current = validateTacticalSequences(sequences);
  const index = current.findIndex((candidate) => candidate.id === sequence?.id);
  if (index < 0) {
    throw new RangeError(`Unknown sequence id ${sequence?.id}.`);
  }
  validateSequenceShape(sequence, index);
  const next = current.map((candidate) =>
    candidate.id === sequence.id ? sequence : candidate,
  );
  return validateTacticalSequences(next);
}

export function removeTacticalSequence(sequences, sequenceId) {
  const current = validateTacticalSequences(sequences);
  const sequence = current.find((candidate) => candidate.id === sequenceId);
  if (!sequence) {
    throw new RangeError(`Unknown sequence id ${sequenceId}.`);
  }
  if (current.length === 1) {
    throw new RangeError("Cannot remove the final tactical sequence.");
  }
  if (sequence.instructions.length > 0) {
    throw new RangeError("Cannot remove a non-empty tactical sequence.");
  }
  const next = current.filter((candidate) => candidate.id !== sequenceId);
  return validateTacticalSequences(normalizeSequenceOrders(next));
}

export function reorderTacticalSequence(sequences, sequenceId, direction) {
  if (direction !== -1 && direction !== 1) {
    throw new RangeError("direction must be -1 or 1.");
  }
  const current = validateTacticalSequences(sequences);
  const index = current.findIndex((sequence) => sequence.id === sequenceId);
  if (index < 0) {
    throw new RangeError(`Unknown sequence id ${sequenceId}.`);
  }
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= current.length) {
    return current;
  }
  const reordered = [...current];
  [reordered[index], reordered[targetIndex]] = [
    reordered[targetIndex],
    reordered[index],
  ];
  return validateTacticalSequences(
    reordered.map((sequence, sequenceIndex) => ({
      ...sequence,
      order: sequenceIndex + 1,
    })),
  );
}

export function serializeTacticalSequences(sequences) {
  return JSON.stringify({
    version: TACTICAL_SEQUENCE_VERSION,
    sequences: validateTacticalSequences(sequences),
  });
}

export function deserializeTacticalSequences(serialized) {
  if (typeof serialized !== "string") {
    throw new TypeError("serialized sequences must be a string.");
  }
  const document = JSON.parse(serialized);
  if (!document || typeof document !== "object") {
    throw new RangeError("Unsupported tactical sequence version.");
  }
  if (document.version === TACTICAL_INSTRUCTION_VERSION) {
    return [
      createDefaultTacticalSequence({
        instructions: document.instructions,
      }),
    ];
  }
  if (document.version === LEGACY_TIMED_SEQUENCE_VERSION) {
    return validateTacticalSequences(
      document.sequences.map((sequence) => ({
        id: sequence.id,
        order: sequence.order,
        name: sequence.name,
        instructions: sequence.instructions,
      })),
    );
  }
  if (document.version !== TACTICAL_SEQUENCE_VERSION) {
    throw new RangeError("Unsupported tactical sequence version.");
  }
  return validateTacticalSequences(document.sequences);
}

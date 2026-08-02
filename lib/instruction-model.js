import { SIMULATION_TICK_MS } from "./simulation-core.js";

export const DEFAULT_INSTRUCTION_INTERVAL_MS = 1_000;
export const TACTICAL_INSTRUCTION_VERSION = 1;

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

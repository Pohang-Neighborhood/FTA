import {
  isMovementInstruction,
  sortTacticalSequences,
} from "./instruction-model.js";

function shouldInvalidateInstruction(instruction, playerIds, ball) {
  const invalidatesPlayerMovement =
    playerIds.has(instruction.playerId) &&
    isMovementInstruction(instruction);
  const invalidatesBall =
    ball && (instruction.type === "carry" || instruction.type === "pass");
  return invalidatesPlayerMovement || invalidatesBall;
}

/**
 * @param {Array<any>} sequences
 * @param {{
 *   playerIds?: string[];
 *   ball?: boolean;
 *   fromSequenceId?: string | null;
 *   includeSource?: boolean;
 * }} options
 */
export function invalidateDependentInstructions(
  sequences,
  {
    playerIds = [],
    ball = false,
    fromSequenceId = null,
    includeSource = true,
  } = {},
) {
  const sorted = sortTacticalSequences(sequences);
  const playerIdSet = new Set(playerIds);
  if (playerIdSet.size === 0 && !ball) {
    return { sequences: sorted, removedInstructionIds: [] };
  }

  const sourceSequence = fromSequenceId
    ? sorted.find((sequence) => sequence.id === fromSequenceId)
    : null;
  if (fromSequenceId && !sourceSequence) {
    throw new RangeError(`Unknown source sequence ${fromSequenceId}.`);
  }

  const removedInstructionIds = [];
  let earliestRemovedCarryOrder = null;
  let nextSequences = sorted.map((sequence) => {
    const isAffectedSequence = sourceSequence
      ? includeSource
        ? sequence.order >= sourceSequence.order
        : sequence.order > sourceSequence.order
      : true;
    if (!isAffectedSequence) {
      return sequence;
    }
    const instructions = sequence.instructions.filter((instruction) => {
      const shouldRemove = shouldInvalidateInstruction(
        instruction,
        playerIdSet,
        ball,
      );
      if (shouldRemove) {
        removedInstructionIds.push(instruction.id);
        if (
          instruction.type === "carry" &&
          (earliestRemovedCarryOrder === null ||
            sequence.order < earliestRemovedCarryOrder)
        ) {
          earliestRemovedCarryOrder = sequence.order;
        }
      }
      return !shouldRemove;
    });
    return { ...sequence, instructions };
  });

  if (!ball && earliestRemovedCarryOrder !== null) {
    const removedIds = new Set(removedInstructionIds);
    nextSequences = nextSequences.map((sequence) => {
      if (sequence.order <= earliestRemovedCarryOrder) {
        return sequence;
      }
      return {
        ...sequence,
        instructions: sequence.instructions.filter((instruction) => {
          const shouldRemove =
            instruction.type === "carry" || instruction.type === "pass";
          if (shouldRemove && !removedIds.has(instruction.id)) {
            removedIds.add(instruction.id);
            removedInstructionIds.push(instruction.id);
          }
          return !shouldRemove;
        }),
      };
    });
  }

  return {
    sequences: sortTacticalSequences(nextSequences),
    removedInstructionIds,
  };
}

import { positionForFormationRole } from "./player-catalog.js";

export function lineupCompatibility(role, playerPosition) {
  const targetPosition = positionForFormationRole(role);
  if (targetPosition === playerPosition) {
    return "exact";
  }
  if (targetPosition === "GK" || playerPosition === "GK") {
    return "ineligible";
  }
  return "out-of-position";
}

export function replaceLineupSlot(playerIds, slotIndex, incomingPlayerId) {
  if (!Array.isArray(playerIds) || new Set(playerIds).size !== playerIds.length) {
    throw new RangeError("Starting lineup player IDs must be unique.");
  }
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= playerIds.length) {
    throw new RangeError("Lineup slot index is out of range.");
  }
  if (typeof incomingPlayerId !== "string" || incomingPlayerId.length === 0) {
    throw new TypeError("Incoming player ID must be a non-empty string.");
  }
  if (playerIds.includes(incomingPlayerId)) {
    throw new RangeError("Incoming player is already in the starting lineup.");
  }

  const nextPlayerIds = [...playerIds];
  nextPlayerIds[slotIndex] = incomingPlayerId;
  return nextPlayerIds;
}

export function swapLineupSlots(playerIds, firstSlotIndex, secondSlotIndex) {
  if (!Array.isArray(playerIds) || new Set(playerIds).size !== playerIds.length) {
    throw new RangeError("Starting lineup player IDs must be unique.");
  }
  if (
    !Number.isInteger(firstSlotIndex) ||
    firstSlotIndex < 0 ||
    firstSlotIndex >= playerIds.length ||
    !Number.isInteger(secondSlotIndex) ||
    secondSlotIndex < 0 ||
    secondSlotIndex >= playerIds.length
  ) {
    throw new RangeError("Lineup slot index is out of range.");
  }
  if (firstSlotIndex === secondSlotIndex) {
    throw new RangeError("Choose two different lineup slots.");
  }

  const nextPlayerIds = [...playerIds];
  [nextPlayerIds[firstSlotIndex], nextPlayerIds[secondSlotIndex]] = [
    nextPlayerIds[secondSlotIndex],
    nextPlayerIds[firstSlotIndex],
  ];
  return nextPlayerIds;
}

export function sortLineupCandidates(players, selectedPlayerIds, role) {
  if (!Array.isArray(players) || !Array.isArray(selectedPlayerIds)) {
    throw new TypeError("Players and selected player IDs must be arrays.");
  }
  const selected = new Set(selectedPlayerIds);

  return players
    .filter((player) => !selected.has(player.id))
    .map((player) => ({
      player,
      compatibility: lineupCompatibility(role, player.position),
    }))
    .filter((candidate) => candidate.compatibility !== "ineligible")
    .sort(
      (left, right) =>
        Number(left.compatibility !== "exact") -
          Number(right.compatibility !== "exact") ||
        right.player.abilities.overall - left.player.abilities.overall ||
        left.player.name.localeCompare(right.player.name) ||
        left.player.id.localeCompare(right.player.id),
    );
}

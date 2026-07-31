export const PITCH_BOUNDS = Object.freeze({
  minX: 9,
  maxX: 91,
  minY: 9,
  maxY: 91,
});

export function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function clampPitchPosition(x, y) {
  return {
    x: clamp(x, PITCH_BOUNDS.minX, PITCH_BOUNDS.maxX),
    y: clamp(y, PITCH_BOUNDS.minY, PITCH_BOUNDS.maxY),
  };
}

export function toPitchPosition(clientX, clientY, rect) {
  if (rect.width <= 0 || rect.height <= 0) {
    throw new RangeError("Pitch dimensions must be greater than zero.");
  }

  return clampPitchPosition(
    ((clientX - rect.left) / rect.width) * 100,
    ((clientY - rect.top) / rect.height) * 100,
  );
}

export function toPitchPositionWithOffset(
  clientX,
  clientY,
  rect,
  offsetX = 0,
  offsetY = 0,
) {
  return toPitchPosition(
    clientX - (offsetX / 100) * rect.width,
    clientY - (offsetY / 100) * rect.height,
    rect,
  );
}

export function mergePlacementOverrides(placements, overrides) {
  return Object.fromEntries(
    Object.entries(placements).map(([playerId, placement]) => {
      const override = overrides[playerId];
      if (!override) {
        return [playerId, { ...placement }];
      }

      return [
        playerId,
        {
          ...placement,
          ...clampPitchPosition(override.x, override.y),
        },
      ];
    }),
  );
}

export function nearestPlacementId(
  position,
  placements,
  pitchSize,
  maximumDistance = 32,
) {
  if (
    !pitchSize ||
    !Number.isFinite(pitchSize.width) ||
    !Number.isFinite(pitchSize.height) ||
    pitchSize.width <= 0 ||
    pitchSize.height <= 0
  ) {
    throw new RangeError("Pitch size must have positive width and height.");
  }
  if (!Number.isFinite(maximumDistance) || maximumDistance < 0) {
    throw new RangeError("maximumDistance must be a non-negative number.");
  }

  const candidates = Object.entries(placements)
    .map(([playerId, placement]) => ({
      playerId,
      distance: Math.hypot(
        ((placement.x - position.x) / 100) * pitchSize.width,
        ((placement.y - position.y) / 100) * pitchSize.height,
      ),
    }))
    .filter((candidate) => candidate.distance <= maximumDistance)
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.playerId.localeCompare(right.playerId),
    );

  return candidates[0]?.playerId ?? null;
}

export function createPlacements(playerIds, slots) {
  if (playerIds.length !== slots.length) {
    throw new RangeError("Each player requires exactly one formation slot.");
  }

  if (new Set(playerIds).size !== playerIds.length) {
    throw new RangeError("Starting lineup player IDs must be unique.");
  }

  return Object.fromEntries(
    playerIds.map((playerId, index) => [
      playerId,
      {
        role: slots[index].role,
        x: slots[index].x,
        y: slots[index].y,
      },
    ]),
  );
}

export function mirrorFormationSlots(slots) {
  return slots.map((slot) => ({
    ...slot,
    x: 100 - slot.x,
    y: 100 - slot.y,
  }));
}

export function pickPlacements(placements, playerIds) {
  return Object.fromEntries(
    playerIds.flatMap((playerId) => {
      const placement = placements[playerId];
      return placement ? [[playerId, placement]] : [];
    }),
  );
}

export function replacePlacements(placements, playerIds, nextPlacements) {
  const replacedPlayerIds = new Set(playerIds);
  return {
    ...Object.fromEntries(
      Object.entries(placements).filter(
        ([playerId]) => !replacedPlayerIds.has(playerId),
      ),
    ),
    ...nextPlacements,
  };
}

export function substitutePlayer(
  playerIds,
  placements,
  outgoingPlayerId,
  incomingPlayerId,
) {
  const lineupIndex = playerIds.indexOf(outgoingPlayerId);
  const outgoingPlacement = placements[outgoingPlayerId];
  if (lineupIndex < 0 || !outgoingPlacement) {
    throw new RangeError("Outgoing player must be in the starting lineup.");
  }
  if (playerIds.includes(incomingPlayerId)) {
    throw new RangeError("Incoming player is already in the starting lineup.");
  }

  const nextPlayerIds = [...playerIds];
  nextPlayerIds[lineupIndex] = incomingPlayerId;
  const nextPlacements = Object.fromEntries(
    Object.entries(placements).map(([playerId, placement]) => [
      playerId,
      { ...placement },
    ]),
  );
  nextPlacements[incomingPlayerId] = { ...outgoingPlacement };
  delete nextPlacements[outgoingPlayerId];

  return { playerIds: nextPlayerIds, placements: nextPlacements };
}

export function analyzeShape(placements) {
  const outfield = Object.values(placements).filter(
    (placement) => placement.role !== "GK",
  );

  if (outfield.length === 0) {
    return {
      score: 0,
      width: 0,
      depth: 0,
      averageLine: 0,
      widthLabel: "미설정",
      lineLabel: "미설정",
    };
  }

  const xs = outfield.map((placement) => placement.x);
  const ys = outfield.map((placement) => placement.y);
  const width = Math.round(Math.max(...xs) - Math.min(...xs));
  const depth = Math.round(Math.max(...ys) - Math.min(...ys));
  const averageY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  const averageLine = Math.round(100 - averageY);
  const score = Math.round(
    clamp(100 - Math.abs(width - 70) * 0.9 - Math.abs(depth - 55) * 0.8, 0, 100),
  );

  return {
    score,
    width,
    depth,
    averageLine,
    widthLabel: width < 56 ? "좁음" : width > 78 ? "넓음" : "균형",
    lineLabel:
      averageLine < 42 ? "낮음" : averageLine > 56 ? "높음" : "중간",
  };
}

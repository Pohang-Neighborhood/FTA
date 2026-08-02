const TEAM_SIDES = new Set(["home", "away"]);
const PLAYER_POSITIONS = new Set(["GK", "DF", "MF", "FW"]);

const POSITION_FALLBACKS = Object.freeze({
  DF: ["DF", "MF", "FW"],
  MF: ["MF", "DF", "FW"],
  FW: ["FW", "MF", "DF"],
});

const POSITION_ABILITY = Object.freeze({
  GK: "defending",
  DF: "defending",
  MF: "passing",
  FW: "attacking",
});

function compareText(left, right) {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function compareNumber(left, right) {
  return left - right;
}

function compareCatalogPlayers(left, right) {
  return (
    compareText(left.group, right.group) ||
    compareText(left.teamName, right.teamName) ||
    compareText(left.teamId, right.teamId) ||
    compareNumber(left.number, right.number) ||
    compareText(left.name, right.name) ||
    compareText(left.id, right.id)
  );
}

function compareSimulatorTeams(left, right) {
  return (
    compareText(left.group, right.group) ||
    compareText(left.name, right.name) ||
    compareText(left.id, right.id)
  );
}

function compareLineupCandidates(left, right, targetPosition) {
  const abilityField = POSITION_ABILITY[targetPosition];
  return (
    compareNumber(right.abilities.overall, left.abilities.overall) ||
    compareNumber(
      right.abilities[abilityField] ?? 0,
      left.abilities[abilityField] ?? 0,
    ) ||
    compareNumber(left.number, right.number) ||
    compareText(left.name, right.name) ||
    compareText(left.id, right.id)
  );
}

function validatePlayerIdentity(player) {
  if (!player || typeof player !== "object") {
    throw new TypeError("Player records must be objects.");
  }
  if (typeof player.id !== "string" || player.id.length === 0) {
    throw new TypeError("Each player requires a non-empty ID.");
  }
  if (typeof player.teamId !== "string" || player.teamId.length === 0) {
    throw new TypeError("Each player requires a non-empty team ID.");
  }
  if (!PLAYER_POSITIONS.has(player.position)) {
    throw new RangeError(`Unsupported player position: ${player.position}`);
  }
}

/**
 * Projects an ability database record into the client-safe player shape.
 * Provenance and estimation metadata are intentionally not copied.
 */
export function projectAbilityRecord(record) {
  validatePlayerIdentity(record);
  return {
    id: record.id,
    teamId: record.teamId,
    teamName: record.teamName,
    group: record.group,
    name: record.name,
    number: record.number,
    position: record.position,
    age: record.ageAtTournament,
    club: record.club,
    abilities: { ...record.abilities },
    goalkeeperAbilities: record.goalkeeperAbilities
      ? { ...record.goalkeeperAbilities }
      : null,
  };
}

/**
 * Produces a deterministic catalog independent of source record ordering.
 */
export function projectPlayerCatalog(records) {
  if (!Array.isArray(records)) {
    throw new TypeError("Ability records must be provided as an array.");
  }
  return records.map(projectAbilityRecord).sort(compareCatalogPlayers);
}

/**
 * Projects ability records into deterministic client-safe simulator teams.
 * Team metadata must remain consistent for every record sharing a team ID.
 */
export function projectSimulatorTeams(records) {
  const teamsById = new Map();

  for (const player of projectPlayerCatalog(records)) {
    if (
      typeof player.teamName !== "string" ||
      player.teamName.length === 0 ||
      typeof player.group !== "string" ||
      player.group.length === 0
    ) {
      throw new TypeError(
        `Team ${player.teamId} requires a non-empty name and group.`,
      );
    }

    const existingTeam = teamsById.get(player.teamId);
    if (existingTeam) {
      if (
        existingTeam.name !== player.teamName ||
        existingTeam.group !== player.group
      ) {
        throw new RangeError(
          `Inconsistent metadata for team ${player.teamId}.`,
        );
      }
      existingTeam.players.push(player);
      continue;
    }

    teamsById.set(player.teamId, {
      id: player.teamId,
      name: player.teamName,
      group: player.group,
      players: [player],
    });
  }

  return [...teamsById.values()].sort(compareSimulatorTeams);
}

/**
 * Match participants use the home/away team slot plus the source player ID.
 * This keeps identities distinct when the same national team is used twice.
 */
export function createParticipantId(teamSide, playerId) {
  if (!TEAM_SIDES.has(teamSide)) {
    throw new RangeError(`Unsupported team side: ${teamSide}`);
  }
  if (typeof playerId !== "string" || playerId.length === 0) {
    throw new TypeError("Participant player ID must be a non-empty string.");
  }
  return `${teamSide}:${playerId}`;
}

export function positionForFormationRole(role) {
  if (typeof role !== "string" || role.length === 0) {
    throw new TypeError("Formation roles must be non-empty strings.");
  }

  const normalizedRole = role.toUpperCase();
  if (normalizedRole === "GK") {
    return "GK";
  }
  if (
    normalizedRole === "DF" ||
    /(?:CB|LB|RB|WB)$/.test(normalizedRole)
  ) {
    return "DF";
  }
  if (
    normalizedRole === "MF" ||
    /(?:DM|CM|AM|LM|RM)$/.test(normalizedRole)
  ) {
    return "MF";
  }
  if (
    normalizedRole === "FW" ||
    /(?:ST|CF|LW|RW)$/.test(normalizedRole)
  ) {
    return "FW";
  }
  throw new RangeError(`Unsupported formation role: ${role}`);
}

/**
 * Selects a deterministic starting XI for one source team and match side.
 * Exact broad-position matches are reserved before field-player fallbacks.
 */
export function selectDefaultLineup(
  catalog,
  { teamId, teamSide, formationSlots },
) {
  if (!Array.isArray(catalog)) {
    throw new TypeError("Player catalog must be an array.");
  }
  if (!TEAM_SIDES.has(teamSide)) {
    throw new RangeError(`Unsupported team side: ${teamSide}`);
  }
  if (!Array.isArray(formationSlots) || formationSlots.length !== 11) {
    throw new RangeError("A default lineup requires exactly 11 formation slots.");
  }

  const slots = formationSlots.map((slot, index) => {
    const role = typeof slot === "string" ? slot : slot?.role;
    return {
      index,
      role,
      position: positionForFormationRole(role),
    };
  });
  if (slots.filter((slot) => slot.position === "GK").length !== 1) {
    throw new RangeError("A default lineup requires exactly one goalkeeper role.");
  }

  const teamPlayers = catalog.filter((player) => player.teamId === teamId);
  const uniquePlayerIds = new Set();
  for (const player of teamPlayers) {
    validatePlayerIdentity(player);
    if (uniquePlayerIds.has(player.id)) {
      throw new RangeError(`Duplicate player ID in team ${teamId}: ${player.id}`);
    }
    uniquePlayerIds.add(player.id);
  }
  if (teamPlayers.length < 11) {
    throw new RangeError(`Team ${teamId} does not have 11 available players.`);
  }

  const selectedBySlot = Array(formationSlots.length).fill(null);
  const selectedPlayerIds = new Set();

  for (const targetPosition of ["GK", "DF", "MF", "FW"]) {
    const targetSlots = slots.filter(
      (slot) => slot.position === targetPosition,
    );
    const exactCandidates = teamPlayers
      .filter(
        (player) =>
          player.position === targetPosition &&
          !selectedPlayerIds.has(player.id),
      )
      .sort((left, right) =>
        compareLineupCandidates(left, right, targetPosition),
      );

    for (
      let index = 0;
      index < Math.min(targetSlots.length, exactCandidates.length);
      index += 1
    ) {
      const player = exactCandidates[index];
      selectedBySlot[targetSlots[index].index] = player;
      selectedPlayerIds.add(player.id);
    }
  }

  for (const slot of slots) {
    if (selectedBySlot[slot.index]) {
      continue;
    }
    if (slot.position === "GK") {
      throw new RangeError(`Team ${teamId} does not have an available goalkeeper.`);
    }

    const fallbackOrder = POSITION_FALLBACKS[slot.position];
    const fallback = teamPlayers
      .filter(
        (player) =>
          player.position !== "GK" && !selectedPlayerIds.has(player.id),
      )
      .sort((left, right) => {
        const positionDifference =
          fallbackOrder.indexOf(left.position) -
          fallbackOrder.indexOf(right.position);
        return (
          positionDifference ||
          compareLineupCandidates(left, right, slot.position)
        );
      })[0];

    if (!fallback) {
      throw new RangeError(
        `Team ${teamId} does not have enough field players for its formation.`,
      );
    }
    selectedBySlot[slot.index] = fallback;
    selectedPlayerIds.add(fallback.id);
  }

  return selectedBySlot.map((player, index) => ({
    participantId: createParticipantId(teamSide, player.id),
    teamSide,
    role: slots[index].role,
    player,
  }));
}

const TOURNAMENT_START_DATE = "2026-06-11";
export const INFERENCE_MODEL_VERSION = "fc26-playerelo-knn-v1";

export const ABILITY_FIELDS = [
  "overall",
  "speed",
  "acceleration",
  "sprintSpeed",
  "agility",
  "balance",
  "stamina",
  "strength",
  "passing",
  "ballControl",
  "attacking",
  "defending",
  "positioning",
  "reactions",
  "decisionMaking",
];

export const GOALKEEPER_FIELDS = [
  "diving",
  "handling",
  "distribution",
  "positioning",
  "reflexes",
  "sweeping",
];

export const FC26_SOURCE = Object.freeze({
  id: "fc26",
  name: "FC 26 (FIFA 26) Player Data",
  publisher: "rovnez",
  datasetRef: "rovnez/fc-26-fifa-26-player-data",
  datasetVersion: 3,
  pageUrl: "https://www.kaggle.com/datasets/rovnez/fc-26-fifa-26-player-data/versions/3",
  downloadUrl:
    "https://www.kaggle.com/api/v1/datasets/download/rovnez/fc-26-fifa-26-player-data?datasetVersionNumber=3",
  updatedAt: "2025-09-22T18:19:44.043Z",
  dataUpdateDate: "2025-09-19",
  archiveFilename: "fc26-v3.zip",
  csvFilename: "FC26_20250921.csv",
  archiveBytes: 3_184_169,
  csvBytes: 10_576_203,
  archiveSha256: "a58223323b824376f69e912912947754b108a20d241d5bb22fdd19c54e5c5c3b",
  csvSha256: "4399cb2bcc2a14a2872e76a118f8f4bf64d7954503949c75751a14f33863e3b2",
  playerCount: 18_405,
  columnCount: 110,
  license: "CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
});

export const ROSTER_SOURCE = Object.freeze({
  id: "world_cup_roster",
  name: "FTA 2026 World Cup player roster",
  path: "data/world-cup-2026-players.json",
  sha256: "ee858f9b0c89f7071c8b0cfd8717ae11dc6c6bb99849af34f925478875b0553b",
  license: "CC BY-SA 4.0 and CC BY 4.0 source terms",
});

const ABILITY_DEFINITIONS = Object.freeze({
  overall: "FC26 overall rating or a position/age/PlayerElo neighbor estimate.",
  speed: "Average of acceleration and sprint speed; goalkeeper speed uses FC26 goalkeeper speed.",
  acceleration: "How quickly the player reaches the target movement speed.",
  sprintSpeed: "Maximum movement speed over open distance.",
  agility: "Direction-change ability.",
  balance: "Ability to stay stable during contact and direction changes.",
  stamina: "Ability to sustain high-intensity movement.",
  strength: "Physical strength in contact situations.",
  passing: "Short passing, long passing, vision, and crossing composite; goalkeeper distribution for GKs.",
  ballControl: "Ball control, dribbling, and agility composite.",
  attacking: "Finishing and attacking-positioning composite.",
  defending: "Marking, interception, and tackling composite; shot-stopping composite for GKs.",
  positioning: "Attacking positioning for field players and goalkeeping positioning for GKs.",
  reactions: "FC26 movement reactions.",
  decisionMaking: "Vision, composure, and reactions composite.",
});

const GOALKEEPER_DEFINITIONS = Object.freeze({
  diving: "Goalkeeper diving.",
  handling: "Goalkeeper handling.",
  distribution: "Goalkeeper kicking, short passing, and vision composite.",
  positioning: "Goalkeeper positioning.",
  reflexes: "Goalkeeper reflexes.",
  sweeping: "Goalkeeper speed, reactions, and positioning composite.",
});

const REQUIRED_FC26_FIELDS = new Set([
  "player_id",
  "fifa_version",
  "fifa_update",
  "fifa_update_date",
  "short_name",
  "long_name",
  "player_positions",
  "overall",
  "dob",
  "nationality_name",
  "pace",
  "passing",
  "shooting",
  "defending",
  "attacking_crossing",
  "attacking_finishing",
  "attacking_short_passing",
  "skill_dribbling",
  "skill_long_passing",
  "skill_ball_control",
  "movement_acceleration",
  "movement_sprint_speed",
  "movement_agility",
  "movement_reactions",
  "movement_balance",
  "power_shot_power",
  "power_stamina",
  "power_strength",
  "power_long_shots",
  "mentality_interceptions",
  "mentality_positioning",
  "mentality_vision",
  "mentality_composure",
  "defending_marking_awareness",
  "defending_standing_tackle",
  "defending_sliding_tackle",
  "goalkeeping_diving",
  "goalkeeping_handling",
  "goalkeeping_kicking",
  "goalkeeping_positioning",
  "goalkeeping_reflexes",
  "goalkeeping_speed",
]);

const NATIONALITY_ALIASES = new Map([
  ["bosniaandherzegovina", new Set(["bosniaandherzegovina", "bosniaherzegovina"])],
  ["capeverde", new Set(["capeverde", "caboverde"])],
  ["czechrepublic", new Set(["czechrepublic", "czechia"])],
  ["drcongo", new Set(["drcongo", "congodr", "democraticrepublicofthecongo"])],
  ["iran", new Set(["iran", "iranislamicrepublicof"])],
  ["ivorycoast", new Set(["ivorycoast", "cotedivoire"])],
  ["southkorea", new Set(["southkorea", "korearepublic"])],
  ["unitedstates", new Set(["unitedstates", "usa"])],
]);

const VERIFIED_IDENTITY_OVERRIDES = new Map([
  ["wc2026-qatar-20", 268879],
  ["wc2026-paraguay-01", 193241],
  ["wc2026-saudi-arabia-12", 246688],
  ["wc2026-spain-03", 210035],
  ["wc2026-france-06", 250723],
  ["wc2026-norway-09", 239085],
  ["wc2026-jordan-10", 259191],
  ["wc2026-england-20", 254796],
]);

const POSITION_CODES = Object.freeze({
  GK: new Set(["GK"]),
  DF: new Set(["CB", "LB", "RB", "LWB", "RWB"]),
  MF: new Set(["CDM", "CM", "CAM", "LM", "RM"]),
  FW: new Set(["ST", "CF", "LW", "RW", "LF", "RF"]),
});

const PHYSICAL_FIELDS = new Set([
  "speed",
  "acceleration",
  "sprintSpeed",
  "agility",
  "balance",
  "stamina",
  "strength",
]);

const REACTION_FIELDS = new Set(["reactions"]);
const GOALKEEPER_REACTION_FIELDS = new Set(["sweeping"]);

function transliterate(value) {
  return value
    .replaceAll("ß", "ss")
    .replaceAll("ẞ", "SS")
    .replaceAll("ø", "o")
    .replaceAll("Ø", "O")
    .replaceAll("ł", "l")
    .replaceAll("Ł", "L")
    .replaceAll("đ", "d")
    .replaceAll("Đ", "D")
    .replaceAll("ð", "d")
    .replaceAll("Ð", "D")
    .replaceAll("þ", "th")
    .replaceAll("Þ", "Th")
    .replaceAll("æ", "ae")
    .replaceAll("Æ", "AE")
    .replaceAll("œ", "oe")
    .replaceAll("Œ", "OE");
}

function normalizeName(value) {
  return transliterate(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function nameTokens(value) {
  return transliterate(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’ʼʻ`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function surnameToken(tokens) {
  const suffixes = new Set(["jr", "junior", "sr", "senior"]);
  return suffixes.has(tokens.at(-1)) ? tokens.at(-2) : tokens.at(-1);
}

function acceptedNationality(teamName, nationality) {
  const normalizedTeam = normalizeName(teamName);
  const accepted = NATIONALITY_ALIASES.get(normalizedTeam) ?? new Set([normalizedTeam]);
  return accepted.has(normalizeName(nationality));
}

function sharedTokenCount(left, right) {
  const rightSet = new Set(right);
  return new Set(left.filter((token) => rightSet.has(token))).size;
}

function sameFirstAndSurname(left, right) {
  return (
    left.length >= 2 &&
    right.length >= 2 &&
    left[0] === right[0] &&
    surnameToken(left) === surnameToken(right)
  );
}

function compatibleTokenIdentity(teamName, playerTokens, candidate) {
  const candidateTokens = nameTokens(candidate.long_name);
  const sharedCount = sharedTokenCount(playerTokens, candidateTokens);
  const sameSurnameAndInitial =
    playerTokens.length > 0 &&
    candidateTokens.length > 0 &&
    playerTokens[0][0] === candidateTokens[0][0] &&
    surnameToken(playerTokens) === surnameToken(candidateTokens);

  return (
    (sharedCount >= 2 || sameSurnameAndInitial) &&
    (acceptedNationality(teamName, candidate.nationality_name) || sharedCount >= 2)
  );
}

function confidenceForMatchMethod(method) {
  switch (method) {
    case "exact_name_birth_date":
      return { confidence: 0.99, confidenceLevel: "high" };
    case "first_surname_birth_date":
    case "verified_alias_birth_date":
      return { confidence: 0.98, confidenceLevel: "high" };
    case "token_name_birth_date":
      return { confidence: 0.94, confidenceLevel: "medium" };
    default:
      throw new Error(`Unsupported direct match method: ${method}`);
  }
}

function numberField(row, field) {
  const value = Number(row[field]);
  if (row[field] === "" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${row.long_name}: invalid FC26 ${field} value ${row[field] || "empty"}.`);
  }
  return value;
}

function weightedAverage(terms) {
  const totalWeight = terms.reduce((total, [, weight]) => total + weight, 0);
  return Math.round(terms.reduce((total, [value, weight]) => total + value * weight, 0) / totalWeight);
}

function clampRating(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function directAbilityPayload(player, source) {
  const goalkeeper = player.position === "GK";
  const acceleration = numberField(source, "movement_acceleration");
  const sprintSpeed = numberField(source, "movement_sprint_speed");
  const reactions = numberField(source, "movement_reactions");
  const goalkeeperDistribution = goalkeeper
    ? weightedAverage([
        [numberField(source, "goalkeeping_kicking"), 0.6],
        [numberField(source, "attacking_short_passing"), 0.25],
        [numberField(source, "mentality_vision"), 0.15],
      ])
    : null;
  const goalkeeperDefending = goalkeeper
    ? weightedAverage([
        [numberField(source, "goalkeeping_diving"), 0.25],
        [numberField(source, "goalkeeping_handling"), 0.2],
        [numberField(source, "goalkeeping_positioning"), 0.25],
        [numberField(source, "goalkeeping_reflexes"), 0.3],
      ])
    : null;
  const passing = goalkeeper
    ? goalkeeperDistribution
    : weightedAverage([
        [numberField(source, "attacking_short_passing"), 0.4],
        [numberField(source, "skill_long_passing"), 0.25],
        [numberField(source, "mentality_vision"), 0.2],
        [numberField(source, "attacking_crossing"), 0.15],
      ]);
  const ballControl = goalkeeper
    ? weightedAverage([
        [numberField(source, "skill_ball_control"), 0.6],
        [numberField(source, "goalkeeping_handling"), 0.4],
      ])
    : weightedAverage([
        [numberField(source, "skill_ball_control"), 0.5],
        [numberField(source, "skill_dribbling"), 0.3],
        [numberField(source, "movement_agility"), 0.2],
      ]);
  const finishing = weightedAverage([
    [numberField(source, "attacking_finishing"), 0.55],
    [numberField(source, "power_shot_power"), 0.25],
    [numberField(source, "power_long_shots"), 0.2],
  ]);
  const positioning = goalkeeper
    ? numberField(source, "goalkeeping_positioning")
    : numberField(source, "mentality_positioning");
  const defending = goalkeeper
    ? goalkeeperDefending
    : weightedAverage([
        [numberField(source, "defending_marking_awareness"), 0.35],
        [numberField(source, "mentality_interceptions"), 0.25],
        [numberField(source, "defending_standing_tackle"), 0.25],
        [numberField(source, "defending_sliding_tackle"), 0.15],
      ]);

  const abilities = {
    overall: numberField(source, "overall"),
    speed: goalkeeper ? numberField(source, "goalkeeping_speed") : Math.round((acceleration + sprintSpeed) / 2),
    acceleration,
    sprintSpeed,
    agility: numberField(source, "movement_agility"),
    balance: numberField(source, "movement_balance"),
    stamina: numberField(source, "power_stamina"),
    strength: numberField(source, "power_strength"),
    passing,
    ballControl,
    attacking: weightedAverage([
      [finishing, 0.6],
      [numberField(source, "mentality_positioning"), 0.4],
    ]),
    defending,
    positioning,
    reactions,
    decisionMaking: weightedAverage([
      [numberField(source, "mentality_vision"), 0.4],
      [numberField(source, "mentality_composure"), 0.35],
      [reactions, 0.25],
    ]),
  };

  const goalkeeperAbilities = goalkeeper
    ? {
        diving: numberField(source, "goalkeeping_diving"),
        handling: numberField(source, "goalkeeping_handling"),
        distribution: goalkeeperDistribution,
        positioning: numberField(source, "goalkeeping_positioning"),
        reflexes: numberField(source, "goalkeeping_reflexes"),
        sweeping: weightedAverage([
          [numberField(source, "goalkeeping_speed"), 0.45],
          [reactions, 0.35],
          [numberField(source, "goalkeeping_positioning"), 0.2],
        ]),
      }
    : null;

  return { abilities, goalkeeperAbilities };
}

function ageOnDate(birthDate, referenceDate = TOURNAMENT_START_DATE) {
  const [birthYear, birthMonth, birthDay] = birthDate.split("-").map(Number);
  const [year, month, day] = referenceDate.split("-").map(Number);
  const birthdayPassed = month > birthMonth || (month === birthMonth && day >= birthDay);
  return year - birthYear - (birthdayPassed ? 0 : 1);
}

function median(values) {
  if (values.length === 0) {
    throw new Error("Cannot calculate a median from an empty list.");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[midpoint - 1] + sorted[midpoint]) / 2 : sorted[midpoint];
}

function percentile(values, ratio) {
  if (values.length === 0) {
    throw new Error("Cannot calculate a percentile from an empty list.");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sorted[lower];
  }
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function inferenceAlpha(field, goalkeeperField = false) {
  if (goalkeeperField) {
    return GOALKEEPER_REACTION_FIELDS.has(field) ? 0.5 : 0.75;
  }
  if (PHYSICAL_FIELDS.has(field)) {
    return 0.4;
  }
  if (REACTION_FIELDS.has(field)) {
    return 0.5;
  }
  return 0.7;
}

function normalizedDistance(target, donor, eloSpan, alpha) {
  const eloDistance = Math.min(Math.abs(target.elo - donor.elo) / eloSpan, 1.5);
  const ageDistance = Math.min(Math.abs(target.age - donor.age) / 12, 1.5);
  return alpha * eloDistance + (1 - alpha) * ageDistance;
}

function estimateField(target, donors, field, goalkeeperField = false) {
  const alpha = inferenceAlpha(field, goalkeeperField);
  const eloValues = donors.map((donor) => donor.elo);
  const eloSpan = Math.max(percentile(eloValues, 0.95) - percentile(eloValues, 0.05), 1);
  const ranked = donors
    .map((donor) => ({ donor, distance: normalizedDistance(target, donor, eloSpan, alpha) }))
    .sort((left, right) => left.distance - right.distance || left.donor.sourcePlayerId - right.donor.sourcePlayerId)
    .slice(0, target.position === "GK" ? 7 : 11);
  const totalWeight = ranked.reduce((total, item) => total + 1 / (0.05 + item.distance), 0);
  const estimate = ranked.reduce(
    (total, item) =>
      total +
      (1 / (0.05 + item.distance)) *
        (goalkeeperField ? item.donor.goalkeeperAbilities[field] : item.donor.abilities[field]),
    0,
  );
  const donorValues = donors.map((donor) =>
    goalkeeperField ? donor.goalkeeperAbilities[field] : donor.abilities[field],
  );
  const lowerBound = percentile(donorValues, 0.05);
  const upperBound = percentile(donorValues, 0.95);

  return {
    value: clampRating(Math.max(lowerBound, Math.min(upperBound, estimate / totalWeight))),
    neighbors: ranked,
  };
}

function inferAbilityPayload(player, directRecords) {
  const donorPool = directRecords
    .filter(
      (record) =>
        record.position === player.position &&
        record.playerElo &&
        record.provenance.sourcePlayerId &&
        record.provenance.sourcePositionCompatible,
    )
    .map((record) => ({
      ...record,
      age: record.ageAtTournament,
      elo: record.playerElo.elo,
      sourcePlayerId: record.provenance.sourcePlayerId,
    }));
  if (donorPool.length < 7) {
    throw new Error(`${player.name}: not enough ${player.position} donors for ability inference.`);
  }

  const donorEloMedian = median(donorPool.map((donor) => donor.playerElo.elo));
  const playerEloUsed = Boolean(player.playerElo);
  const target = {
    position: player.position,
    age: ageOnDate(player.birthDate),
    elo: player.playerElo?.elo ?? donorEloMedian,
  };
  const abilities = {};
  const neighborMap = new Map();

  const commonFields =
    player.position === "GK"
      ? ABILITY_FIELDS.filter((field) => !["passing", "positioning"].includes(field))
      : ABILITY_FIELDS;
  for (const field of commonFields) {
    const estimated = estimateField(target, donorPool, field);
    abilities[field] = estimated.value;
    for (const neighbor of estimated.neighbors) {
      const evidence = neighborMap.get(neighbor.donor.sourcePlayerId) ?? { totalDistance: 0, count: 0 };
      evidence.totalDistance += neighbor.distance;
      evidence.count += 1;
      neighborMap.set(neighbor.donor.sourcePlayerId, evidence);
    }
  }

  let goalkeeperAbilities = null;
  if (player.position === "GK") {
    goalkeeperAbilities = {};
    for (const field of GOALKEEPER_FIELDS) {
      const estimated = estimateField(target, donorPool, field, true);
      goalkeeperAbilities[field] = estimated.value;
      for (const neighbor of estimated.neighbors) {
        const evidence = neighborMap.get(neighbor.donor.sourcePlayerId) ?? { totalDistance: 0, count: 0 };
        evidence.totalDistance += neighbor.distance;
        evidence.count += 1;
        neighborMap.set(neighbor.donor.sourcePlayerId, evidence);
      }
    }
    abilities.passing = goalkeeperAbilities.distribution;
    abilities.positioning = goalkeeperAbilities.positioning;
  }

  const orderedAbilities = Object.fromEntries(ABILITY_FIELDS.map((field) => [field, abilities[field]]));
  const neighbors = [...neighborMap.entries()].sort(([left], [right]) => left - right);
  const totalNeighborDistance = neighbors.reduce((total, [, evidence]) => total + evidence.totalDistance, 0);
  const totalNeighborSelections = neighbors.reduce((total, [, evidence]) => total + evidence.count, 0);
  return {
    abilities: orderedAbilities,
    goalkeeperAbilities,
    playerEloUsed,
    donorPlayerIds: neighbors.map(([sourcePlayerId]) => sourcePlayerId),
    meanNeighborDistance: Number((totalNeighborDistance / totalNeighborSelections).toFixed(4)),
  };
}

function flattenRoster(roster) {
  return roster.teams.flatMap((team) =>
    team.players.map((player) => ({
      ...player,
      teamId: team.id,
      teamName: team.name,
      group: team.group,
    })),
  );
}

function sourcePositionCompatible(position, sourcePositions) {
  const codes = new Set(sourcePositions.split(",").map((value) => value.trim()));
  return [...(POSITION_CODES[position] ?? [])].some((code) => codes.has(code));
}

function directRecord(player, match) {
  const payload = directAbilityPayload(player, match.source);
  const identity = confidenceForMatchMethod(match.method);
  const positionCompatible = sourcePositionCompatible(player.position, match.source.player_positions);
  return {
    id: player.id,
    teamId: player.teamId,
    teamName: player.teamName,
    group: player.group,
    name: player.name,
    number: player.number,
    position: player.position,
    birthDate: player.birthDate,
    ageAtTournament: ageOnDate(player.birthDate),
    club: player.club,
    playerElo: player.playerElo
      ? { elo: player.playerElo.elo, currentRank: player.playerElo.currentRank }
      : null,
    abilities: payload.abilities,
    goalkeeperAbilities: payload.goalkeeperAbilities,
    provenance: {
      source: "fc26",
      sourceVersion: FC26_SOURCE.datasetVersion,
      sourcePlayerId: Number(match.source.player_id),
      sourceName: match.source.long_name,
      matchMethod: match.method,
      isInferred: false,
      confidence: identity.confidence,
      confidenceLevel: identity.confidenceLevel,
      sourcePositionCompatible: positionCompatible,
      playerEloUsed: false,
      donorPlayerIds: [],
      meanNeighborDistance: null,
    },
    sourcePositionWarning: !positionCompatible,
  };
}

function inferredRecord(player, inferred) {
  return {
    id: player.id,
    teamId: player.teamId,
    teamName: player.teamName,
    group: player.group,
    name: player.name,
    number: player.number,
    position: player.position,
    birthDate: player.birthDate,
    ageAtTournament: ageOnDate(player.birthDate),
    club: player.club,
    playerElo: player.playerElo
      ? { elo: player.playerElo.elo, currentRank: player.playerElo.currentRank }
      : null,
    abilities: inferred.abilities,
    goalkeeperAbilities: inferred.goalkeeperAbilities,
    provenance: {
      source: "fta_estimate",
      sourceVersion: null,
      sourcePlayerId: null,
      sourceName: null,
      matchMethod: inferred.playerEloUsed ? "position_age_playerelo_knn" : "position_age_knn",
      isInferred: true,
      confidence: inferred.playerEloUsed ? 0.6 : 0.4,
      confidenceLevel: inferred.playerEloUsed ? "medium" : "low",
      sourcePositionCompatible: null,
      playerEloUsed: inferred.playerEloUsed,
      donorPlayerIds: inferred.donorPlayerIds,
      meanNeighborDistance: inferred.meanNeighborDistance,
    },
    sourcePositionWarning: false,
  };
}

function matchRosterPlayers(players, fc26Rows) {
  const byBirthDate = new Map();
  const byPlayerId = new Map();
  for (const source of fc26Rows) {
    const sources = byBirthDate.get(source.dob) ?? [];
    sources.push(source);
    byBirthDate.set(source.dob, sources);
    byPlayerId.set(Number(source.player_id), source);
  }

  const matched = new Map();
  const methodCounts = new Map();

  for (const player of players) {
    const candidates = byBirthDate.get(player.birthDate) ?? [];
    const normalizedPlayerName = normalizeName(player.name);
    const exact = candidates.filter((candidate) =>
      [candidate.long_name, candidate.short_name].some((name) => normalizeName(name) === normalizedPlayerName),
    );
    let source = exact.length === 1 ? exact[0] : null;
    let method = source ? "exact_name_birth_date" : null;

    if (!source) {
      const playerTokens = nameTokens(player.name);
      const firstAndSurname = candidates.filter(
        (candidate) =>
          acceptedNationality(player.teamName, candidate.nationality_name) &&
          sameFirstAndSurname(playerTokens, nameTokens(candidate.long_name)),
      );
      if (firstAndSurname.length === 1) {
        source = firstAndSurname[0];
        method = "first_surname_birth_date";
      }
    }

    if (!source) {
      const playerTokens = nameTokens(player.name);
      const tokenMatches = candidates.filter((candidate) =>
        compatibleTokenIdentity(player.teamName, playerTokens, candidate),
      );
      if (tokenMatches.length === 1) {
        source = tokenMatches[0];
        method = "token_name_birth_date";
      }
    }

    const overridePlayerId = VERIFIED_IDENTITY_OVERRIDES.get(player.id);
    if (!source && overridePlayerId) {
      const override = byPlayerId.get(overridePlayerId);
      if (!override || override.dob !== player.birthDate || !acceptedNationality(player.teamName, override.nationality_name)) {
        throw new Error(`${player.name}: invalid verified FC26 identity override ${overridePlayerId}.`);
      }
      source = override;
      method = "verified_alias_birth_date";
    }

    if (source) {
      matched.set(player.id, { source, method });
      methodCounts.set(method, (methodCounts.get(method) ?? 0) + 1);
    }
  }

  const sourceIds = [...matched.values()].map(({ source }) => Number(source.player_id));
  if (new Set(sourceIds).size !== sourceIds.length) {
    const duplicates = sourceIds.filter((id, index) => sourceIds.indexOf(id) !== index);
    throw new Error(`FC26 source player IDs must be unique. Duplicates: ${[...new Set(duplicates)].join(", ")}`);
  }

  return { matched, methodCounts };
}

export function parseCsv(source) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  const headers = rows.shift().map((header) => header.replace(/^\uFEFF/, ""));
  return {
    headers,
    rows: rows
      .filter((values) => values.some(Boolean))
      .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))),
  };
}

export function validateFc26Source(headers, rows) {
  if (headers.length !== FC26_SOURCE.columnCount) {
    throw new Error(`Expected ${FC26_SOURCE.columnCount} FC26 columns, received ${headers.length}.`);
  }
  const missingFields = [...REQUIRED_FC26_FIELDS].filter((field) => !headers.includes(field));
  if (missingFields.length > 0) {
    throw new Error(`FC26 source is missing required fields: ${missingFields.join(", ")}`);
  }
  if (rows.length !== FC26_SOURCE.playerCount) {
    throw new Error(`Expected ${FC26_SOURCE.playerCount} FC26 players, received ${rows.length}.`);
  }
  const sourceIds = new Set();
  for (const row of rows) {
    if (row.fifa_version !== "26" || row.fifa_update !== "4" || row.fifa_update_date !== FC26_SOURCE.dataUpdateDate) {
      throw new Error(`${row.long_name}: unexpected FC26 source version.`);
    }
    const sourcePlayerId = Number(row.player_id);
    if (!Number.isInteger(sourcePlayerId) || sourceIds.has(sourcePlayerId)) {
      throw new Error(`${row.long_name}: invalid or duplicate FC26 player ID ${row.player_id}.`);
    }
    sourceIds.add(sourcePlayerId);
  }
}

export function buildPlayerAbilityDataset(roster, fc26Rows) {
  if (roster.metadata?.tournament !== "2026 FIFA World Cup") {
    throw new Error("Unexpected World Cup roster metadata.");
  }
  const players = flattenRoster(roster);
  const { matched, methodCounts } = matchRosterPlayers(players, fc26Rows);
  const directRecords = players
    .filter((player) => matched.has(player.id))
    .map((player) => directRecord(player, matched.get(player.id)));
  const directByPlayerId = new Map(directRecords.map((record) => [record.id, record]));
  const records = players.map((player) => {
    const direct = directByPlayerId.get(player.id);
    return direct ?? inferredRecord(player, inferAbilityPayload(player, directRecords));
  });
  const inferredRecords = records.filter((record) => record.provenance.isInferred);
  const directMatchCount = directRecords.length;
  const inferredWithPlayerEloCount = inferredRecords.filter((record) => record.provenance.playerEloUsed).length;
  const goalkeeperCount = records.filter((record) => record.position === "GK").length;
  const sourcePositionWarningCount = directRecords.filter((record) => record.sourcePositionWarning).length;

  return {
    metadata: {
      schemaVersion: 1,
      tournament: roster.metadata.tournament,
      snapshotAt: roster.metadata.generatedAt,
      tournamentStartDate: TOURNAMENT_START_DATE,
      teamCount: roster.metadata.teamCount,
      playerCount: records.length,
      goalkeeperCount,
      directMatchCount,
      inferredCount: inferredRecords.length,
      inferredWithPlayerEloCount,
      inferredWithoutPlayerEloCount: inferredRecords.length - inferredWithPlayerEloCount,
      directMatchRate: Number((directMatchCount / records.length).toFixed(4)),
      matchMethodCounts: Object.fromEntries([...methodCounts.entries()].sort(([left], [right]) => left.localeCompare(right))),
      sourcePositionWarningCount,
      abilityScale: { minimum: 0, maximum: 100, integer: true },
      abilityDefinitions: ABILITY_DEFINITIONS,
      goalkeeperDefinitions: GOALKEEPER_DEFINITIONS,
      estimationModel: {
        version: INFERENCE_MODEL_VERSION,
        description:
          "Position-specific deterministic KNN over position-compatible direct FC26 matches. Distance combines age at tournament start and PlayerElo; estimates are clamped to donor P05-P95.",
        fieldPlayerNeighborCount: 11,
        goalkeeperNeighborCount: 7,
        playerEloConfidence: 0.6,
        noPlayerEloConfidence: 0.4,
      },
      sources: [
        {
          ...ROSTER_SOURCE,
          sourceGeneratedAt: roster.metadata.generatedAt,
          upstreamSources: roster.metadata.sources,
        },
        {
          id: FC26_SOURCE.id,
          name: FC26_SOURCE.name,
          publisher: FC26_SOURCE.publisher,
          url: FC26_SOURCE.pageUrl,
          datasetVersion: FC26_SOURCE.datasetVersion,
          updatedAt: FC26_SOURCE.updatedAt,
          sha256: FC26_SOURCE.csvSha256,
          license: FC26_SOURCE.license,
          licenseUrl: FC26_SOURCE.licenseUrl,
          licenseBasis: "Kaggle dataset metadata",
          thirdPartyRightsNotice:
            "The source states that it was scraped from SoFIFA. Kaggle's license label does not guarantee all EA, SoFIFA, publicity, trademark, or other third-party rights.",
        },
      ],
      notices: [
        "FC26 direct values are adapted from the pinned Kaggle dataset; normalized composites are documented above.",
        "Inferred values are FTA estimates and are never represented as original FC26 ratings.",
        "Confidence describes identity matching or estimation support, not guaranteed real-world accuracy.",
        "Kaggle lists the FC26 source as CC BY 4.0, but that label does not guarantee all underlying EA, SoFIFA, publicity, trademark, or other third-party rights.",
      ],
    },
    players: records.map(({ sourcePositionWarning, ...record }) => record),
  };
}

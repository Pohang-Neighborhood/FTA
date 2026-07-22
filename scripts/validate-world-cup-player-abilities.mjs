import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { ABILITY_FIELDS, FC26_SOURCE, GOALKEEPER_FIELDS, ROSTER_SOURCE } from "./lib/player-ability-data.mjs";

const jsonPath = resolve(process.argv[2] ?? "data/world-cup-2026-player-abilities.json");
const sqlitePath = resolve(process.argv[3] ?? "data/world-cup-2026-player-abilities.sqlite");
const manifestPath = resolve(process.argv[4] ?? "data/world-cup-2026-player-abilities.manifest.json");
const rosterPath = resolve(process.argv[5] ?? "data/world-cup-2026-players.json");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertRating(value, label) {
  assert.ok(Number.isInteger(value), `${label} must be an integer.`);
  assert.ok(value >= 0 && value <= 100, `${label} must be between 0 and 100.`);
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return lower === upper
    ? sorted[lower]
    : sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

const [jsonBuffer, sqliteBuffer, manifestBuffer, rosterBuffer] = await Promise.all([
  readFile(jsonPath),
  readFile(sqlitePath),
  readFile(manifestPath),
  readFile(rosterPath),
]);
const dataset = JSON.parse(jsonBuffer.toString("utf8"));
const manifest = JSON.parse(manifestBuffer.toString("utf8"));
const roster = JSON.parse(rosterBuffer.toString("utf8"));
const rosterPlayers = roster.teams.flatMap((team) =>
  team.players.map((player) => ({ ...player, teamId: team.id, teamName: team.name, group: team.group })),
);
const rosterById = new Map(rosterPlayers.map((player) => [player.id, player]));

assert.equal(sha256(rosterBuffer), ROSTER_SOURCE.sha256, "Roster SHA-256 must match the pinned source.");
assert.equal(dataset.metadata.schemaVersion, 1);
assert.equal(dataset.metadata.playerCount, 1248);
assert.equal(dataset.metadata.teamCount, 48);
assert.equal(dataset.metadata.goalkeeperCount, 145);
assert.equal(dataset.metadata.directMatchCount, 925);
assert.equal(dataset.metadata.inferredCount, 323);
assert.equal(dataset.metadata.inferredWithPlayerEloCount, 281);
assert.equal(dataset.metadata.inferredWithoutPlayerEloCount, 42);
assert.equal(dataset.metadata.directMatchRate, 0.7412);
assert.deepEqual(dataset.metadata.matchMethodCounts, {
  exact_name_birth_date: 460,
  first_surname_birth_date: 255,
  token_name_birth_date: 202,
  verified_alias_birth_date: 8,
});
assert.deepEqual(dataset.metadata.sources[0].upstreamSources, roster.metadata.sources);
assert.equal(dataset.players.length, dataset.metadata.playerCount);
assert.equal(new Set(dataset.players.map((player) => player.id)).size, dataset.players.length);

const directPlayers = dataset.players.filter((player) => !player.provenance.isInferred);
const inferredPlayers = dataset.players.filter((player) => player.provenance.isInferred);
const sourcePlayerIds = directPlayers.map((player) => player.provenance.sourcePlayerId);
const incompatibleSourcePlayerIds = new Set(
  directPlayers
    .filter((player) => !player.provenance.sourcePositionCompatible)
    .map((player) => player.provenance.sourcePlayerId),
);
assert.equal(directPlayers.length, dataset.metadata.directMatchCount);
assert.equal(inferredPlayers.length, dataset.metadata.inferredCount);
assert.equal(new Set(sourcePlayerIds).size, sourcePlayerIds.length, "FC26 source player IDs must be unique.");

for (const player of dataset.players) {
  const rosterPlayer = rosterById.get(player.id);
  assert.ok(rosterPlayer, `${player.id}: player is not in the canonical roster.`);
  assert.equal(player.name, rosterPlayer.name, `${player.id}: name mismatch.`);
  assert.equal(player.teamId, rosterPlayer.teamId, `${player.id}: team mismatch.`);
  assert.equal(player.position, rosterPlayer.position, `${player.id}: position mismatch.`);
  assert.equal(player.birthDate, rosterPlayer.birthDate, `${player.id}: birth-date mismatch.`);
  assert.deepEqual(Object.keys(player.abilities), ABILITY_FIELDS, `${player.id}: unexpected ability schema.`);
  for (const field of ABILITY_FIELDS) {
    assertRating(player.abilities[field], `${player.id}.${field}`);
  }

  if (player.position === "GK") {
    assert.ok(player.goalkeeperAbilities, `${player.id}: goalkeeper abilities are required.`);
    assert.deepEqual(
      Object.keys(player.goalkeeperAbilities),
      GOALKEEPER_FIELDS,
      `${player.id}: unexpected goalkeeper schema.`,
    );
    for (const field of GOALKEEPER_FIELDS) {
      assertRating(player.goalkeeperAbilities[field], `${player.id}.goalkeeperAbilities.${field}`);
    }
  } else {
    assert.equal(player.goalkeeperAbilities, null, `${player.id}: field player cannot have goalkeeper abilities.`);
  }

  if (player.provenance.isInferred) {
    assert.equal(player.provenance.source, "fta_estimate");
    assert.equal(player.provenance.sourcePlayerId, null);
    assert.equal(player.provenance.sourceName, null);
    assert.equal(player.provenance.sourcePositionCompatible, null);
    assert.ok(player.provenance.donorPlayerIds.length >= (player.position === "GK" ? 7 : 11));
    assert.equal(
      new Set(player.provenance.donorPlayerIds).size,
      player.provenance.donorPlayerIds.length,
      `${player.id}: donor IDs must be unique.`,
    );
    assert.ok(
      player.provenance.donorPlayerIds.every((sourcePlayerId) => !incompatibleSourcePlayerIds.has(sourcePlayerId)),
      `${player.id}: position-incompatible FC26 records cannot be inference donors.`,
    );
    assert.ok(Number.isFinite(player.provenance.meanNeighborDistance));
    if (player.position === "GK") {
      assert.equal(player.abilities.passing, player.goalkeeperAbilities.distribution);
      assert.equal(player.abilities.positioning, player.goalkeeperAbilities.positioning);
    }
    if (player.provenance.playerEloUsed) {
      assert.equal(player.provenance.confidence, 0.6);
      assert.equal(player.provenance.confidenceLevel, "medium");
      assert.equal(player.provenance.matchMethod, "position_age_playerelo_knn");
    } else {
      assert.equal(player.playerElo, null);
      assert.equal(player.provenance.confidence, 0.4);
      assert.equal(player.provenance.confidenceLevel, "low");
      assert.equal(player.provenance.matchMethod, "position_age_knn");
    }
  } else {
    assert.equal(player.provenance.source, "fc26");
    assert.equal(player.provenance.sourceVersion, FC26_SOURCE.datasetVersion);
    assert.ok(Number.isInteger(player.provenance.sourcePlayerId));
    assert.ok(player.provenance.sourceName);
    assert.equal(typeof player.provenance.sourcePositionCompatible, "boolean");
    assert.equal(player.provenance.donorPlayerIds.length, 0);
    assert.equal(player.provenance.meanNeighborDistance, null);
    assert.ok(["high", "medium"].includes(player.provenance.confidenceLevel));
  }
}

assert.equal(
  dataset.players.filter((player) => player.goalkeeperAbilities).length,
  dataset.metadata.goalkeeperCount,
);
assert.equal(
  inferredPlayers.filter((player) => player.provenance.playerEloUsed).length,
  dataset.metadata.inferredWithPlayerEloCount,
);
assert.equal(
  inferredPlayers.filter((player) => !player.provenance.playerEloUsed).length,
  dataset.metadata.inferredWithoutPlayerEloCount,
);

for (const position of ["GK", "DF", "MF", "FW"]) {
  const donors = directPlayers.filter(
    (player) => player.position === position && player.playerElo && player.provenance.sourcePositionCompatible,
  );
  const estimates = inferredPlayers.filter((player) => player.position === position);
  for (const field of ABILITY_FIELDS) {
    const donorValues = donors.map((player) => player.abilities[field]);
    const minimum = Math.floor(percentile(donorValues, 0.05));
    const maximum = Math.ceil(percentile(donorValues, 0.95));
    for (const estimate of estimates) {
      assert.ok(
        estimate.abilities[field] >= minimum && estimate.abilities[field] <= maximum,
        `${estimate.id}.${field} must remain within donor P05-P95.`,
      );
    }
  }
  if (position === "GK") {
    for (const field of GOALKEEPER_FIELDS) {
      const donorValues = donors.map((player) => player.goalkeeperAbilities[field]);
      const minimum = Math.floor(percentile(donorValues, 0.05));
      const maximum = Math.ceil(percentile(donorValues, 0.95));
      for (const estimate of estimates) {
        assert.ok(
          estimate.goalkeeperAbilities[field] >= minimum && estimate.goalkeeperAbilities[field] <= maximum,
          `${estimate.id}.goalkeeperAbilities.${field} must remain within donor P05-P95.`,
        );
      }
    }
  }
}

for (const falsePositive of ["wc2026-iraq-03", "wc2026-paraguay-24"]) {
  assert.equal(
    dataset.players.find((player) => player.id === falsePositive).provenance.isInferred,
    true,
    `${falsePositive}: known false-positive FC26 identity must stay inferred.`,
  );
}
assert.equal(
  dataset.players.find((player) => player.id === "wc2026-netherlands-26").provenance.sourcePlayerId,
  251806,
);
assert.equal(
  dataset.players.find((player) => player.id === "wc2026-saudi-arabia-03").provenance.sourcePlayerId,
  228783,
);

assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.generator.version, 1);
assert.equal(manifest.generator.inferenceModel, dataset.metadata.estimationModel.version);
assert.match(manifest.generator.nodeVersion, /^v\d+\.\d+\.\d+$/);
assert.match(manifest.generator.sqliteVersion, /^\d+\.\d+\.\d+$/);
assert.equal(
  manifest.generator.importer.sha256,
  sha256(await readFile(new URL("./import-world-cup-player-abilities.mjs", import.meta.url))),
);
assert.equal(
  manifest.generator.core.sha256,
  sha256(await readFile(new URL("./lib/player-ability-data.mjs", import.meta.url))),
);
assert.equal(manifest.sourcePackage.datasetRef, FC26_SOURCE.datasetRef);
assert.equal(manifest.sourcePackage.datasetVersion, FC26_SOURCE.datasetVersion);
assert.equal(manifest.sourcePackage.downloadUrl, FC26_SOURCE.downloadUrl);
assert.deepEqual(manifest.sourcePackage.archive, {
  name: FC26_SOURCE.archiveFilename,
  bytes: FC26_SOURCE.archiveBytes,
  sha256: FC26_SOURCE.archiveSha256,
});
assert.deepEqual(manifest.sourcePackage.csv, {
  name: FC26_SOURCE.csvFilename,
  bytes: FC26_SOURCE.csvBytes,
  sha256: FC26_SOURCE.csvSha256,
  players: FC26_SOURCE.playerCount,
  columns: FC26_SOURCE.columnCount,
  fifaVersion: 26,
  fifaUpdate: 4,
  fifaUpdateDate: FC26_SOURCE.dataUpdateDate,
});
assert.deepEqual(manifest.counts, {
  players: dataset.metadata.playerCount,
  direct: dataset.metadata.directMatchCount,
  inferred: dataset.metadata.inferredCount,
  goalkeepers: dataset.metadata.goalkeeperCount,
});
assert.equal(manifest.inputs[0].sha256, ROSTER_SOURCE.sha256);
assert.equal(manifest.inputs[1].sha256, FC26_SOURCE.csvSha256);
assert.equal(manifest.inputs[1].datasetVersion, FC26_SOURCE.datasetVersion);
const outputFiles = new Map(manifest.outputs.map((output) => [output.name, output]));
const jsonOutput = outputFiles.get(jsonPath.split("/").at(-1));
const sqliteOutput = outputFiles.get(sqlitePath.split("/").at(-1));
assert.equal(jsonOutput.sha256, sha256(jsonBuffer));
assert.equal(jsonOutput.bytes, (await stat(jsonPath)).size);
assert.equal(sqliteOutput.sha256, sha256(sqliteBuffer));
assert.equal(sqliteOutput.bytes, (await stat(sqlitePath)).size);

const database = new DatabaseSync(sqlitePath, { readOnly: true });
try {
  assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(database.prepare("PRAGMA user_version").get().user_version, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM players").get().count, dataset.players.length);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM abilities").get().count, dataset.players.length);
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM goalkeeper_abilities").get().count,
    dataset.metadata.goalkeeperCount,
  );
  const sqliteMetadata = Object.fromEntries(
    database
      .prepare("SELECT key, value FROM metadata ORDER BY key")
      .all()
      .map((row) => [row.key, JSON.parse(row.value)]),
  );
  assert.deepEqual(sqliteMetadata, dataset.metadata);

  const selectPlayer = database.prepare(`
    SELECT
      p.*, a.overall, a.speed, a.acceleration, a.sprint_speed, a.agility,
      a.balance, a.stamina, a.strength, a.passing, a.ball_control, a.attacking,
      a.defending, a.positioning, a.reactions, a.decision_making, a.source_key,
      a.source_version, a.source_player_id, a.source_name, a.match_method,
      a.is_inferred, a.confidence, a.confidence_level, a.source_position_compatible, a.player_elo_used,
      a.donor_player_ids, a.mean_neighbor_distance,
      g.diving, g.handling, g.distribution, g.positioning AS goalkeeper_positioning,
      g.reflexes, g.sweeping
    FROM players p
    JOIN abilities a USING (player_id)
    LEFT JOIN goalkeeper_abilities g USING (player_id)
    WHERE p.player_id = ?
  `);
  const snakeCaseFields = {
    sprintSpeed: "sprint_speed",
    ballControl: "ball_control",
    decisionMaking: "decision_making",
  };
  for (const player of dataset.players) {
    const row = selectPlayer.get(player.id);
    assert.ok(row, `${player.id}: missing SQLite row.`);
    assert.equal(row.name, player.name);
    assert.equal(row.team_id, player.teamId);
    assert.equal(row.team_name, player.teamName);
    assert.equal(row.group_name, player.group);
    assert.equal(row.squad_number, player.number);
    assert.equal(row.position, player.position);
    assert.equal(row.birth_date, player.birthDate);
    assert.equal(row.age_at_tournament, player.ageAtTournament);
    assert.equal(row.club, player.club);
    assert.equal(row.player_elo, player.playerElo?.elo ?? null);
    assert.equal(row.player_elo_rank, player.playerElo?.currentRank ?? null);
    assert.equal(row.is_inferred, Number(player.provenance.isInferred));
    assert.equal(row.source_key, player.provenance.source);
    assert.equal(row.source_version, player.provenance.sourceVersion);
    assert.equal(row.source_player_id, player.provenance.sourcePlayerId);
    assert.equal(row.source_name, player.provenance.sourceName);
    assert.equal(row.match_method, player.provenance.matchMethod);
    assert.equal(row.confidence, player.provenance.confidence);
    assert.equal(row.confidence_level, player.provenance.confidenceLevel);
    assert.equal(
      row.source_position_compatible,
      player.provenance.sourcePositionCompatible === null
        ? null
        : Number(player.provenance.sourcePositionCompatible),
    );
    assert.equal(row.player_elo_used, Number(player.provenance.playerEloUsed));
    assert.deepEqual(JSON.parse(row.donor_player_ids), player.provenance.donorPlayerIds);
    assert.equal(row.mean_neighbor_distance, player.provenance.meanNeighborDistance);
    for (const field of ABILITY_FIELDS) {
      assert.equal(row[snakeCaseFields[field] ?? field], player.abilities[field], `${player.id}.${field}`);
    }
    for (const field of GOALKEEPER_FIELDS) {
      const column = field === "positioning" ? "goalkeeper_positioning" : field;
      assert.equal(row[column], player.goalkeeperAbilities?.[field] ?? null, `${player.id}.GK.${field}`);
    }
  }
} finally {
  database.close();
}

console.log(
  `Validated ${dataset.metadata.playerCount} abilities: ${dataset.metadata.directMatchCount} direct FC26 matches, ${dataset.metadata.inferredCount} estimates, and ${dataset.metadata.goalkeeperCount} goalkeeper profiles.`,
);

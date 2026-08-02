import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  ABILITY_FIELDS,
  FC26_SOURCE,
  GOALKEEPER_FIELDS,
  ROSTER_SOURCE,
  buildPlayerAbilityDataset,
  parseCsv,
  validateFc26Source,
} from "./lib/player-ability-data.mjs";

const DEFAULT_ROSTER_PATH = "data/world-cup-2026-players.json";
const DEFAULT_JSON_OUTPUT = "data/world-cup-2026-player-abilities.json";
const DEFAULT_SQLITE_OUTPUT = "data/world-cup-2026-player-abilities.sqlite";
const DEFAULT_MANIFEST_OUTPUT = "data/world-cup-2026-player-abilities.manifest.json";

function parseArguments(argv) {
  const argumentsMap = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error(`Invalid argument pair: ${key ?? ""} ${value ?? ""}`.trim());
    }
    argumentsMap.set(key.slice(2), value);
  }
  return argumentsMap;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function assertFile(buffer, expectedBytes, expectedSha256, label) {
  if (buffer.byteLength !== expectedBytes) {
    throw new Error(`${label}: expected ${expectedBytes} bytes, received ${buffer.byteLength}.`);
  }
  const digest = sha256(buffer);
  if (digest !== expectedSha256) {
    throw new Error(`${label}: expected SHA-256 ${expectedSha256}, received ${digest}.`);
  }
}

async function download(url, path) {
  const response = await fetch(url, {
    headers: { "user-agent": "FTA player ability importer (https://github.com/Pohang-Neighborhood/FTA)" },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
}

async function resolveFc26Input(providedPath) {
  if (providedPath) {
    return { csvPath: resolve(providedPath), temporaryDirectory: null, archiveBuffer: null };
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "fta-fc26-abilities-"));
  const archivePath = join(temporaryDirectory, FC26_SOURCE.archiveFilename);
  await download(FC26_SOURCE.downloadUrl, archivePath);
  const archiveBuffer = await readFile(archivePath);
  await assertFile(
    archiveBuffer,
    FC26_SOURCE.archiveBytes,
    FC26_SOURCE.archiveSha256,
    `Kaggle ${FC26_SOURCE.archiveFilename}`,
  );
  execFileSync("unzip", ["-q", archivePath, FC26_SOURCE.csvFilename, "-d", temporaryDirectory]);
  return {
    csvPath: join(temporaryDirectory, FC26_SOURCE.csvFilename),
    temporaryDirectory,
    archiveBuffer,
  };
}

async function writeAtomically(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, content);
  await rename(temporaryPath, path);
}

function createSqliteSchema(database) {
  database.exec(`
    PRAGMA page_size = 4096;
    PRAGMA foreign_keys = ON;
    PRAGMA user_version = 1;
    PRAGMA application_id = 1179926833;

    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;

    CREATE TABLE data_sources (
      source_key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      publisher TEXT NOT NULL,
      url TEXT,
      version TEXT,
      sha256 TEXT,
      license TEXT NOT NULL,
      notes TEXT NOT NULL
    ) STRICT;

    CREATE TABLE players (
      player_id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      team_name TEXT NOT NULL,
      group_name TEXT NOT NULL CHECK (group_name BETWEEN 'A' AND 'L'),
      squad_number INTEGER NOT NULL CHECK (squad_number BETWEEN 1 AND 26),
      name TEXT NOT NULL,
      position TEXT NOT NULL CHECK (position IN ('GK', 'DF', 'MF', 'FW')),
      birth_date TEXT NOT NULL,
      age_at_tournament INTEGER NOT NULL CHECK (age_at_tournament BETWEEN 15 AND 50),
      club TEXT NOT NULL,
      player_elo REAL,
      player_elo_rank INTEGER
    ) STRICT;

    CREATE TABLE abilities (
      player_id TEXT PRIMARY KEY REFERENCES players(player_id) ON DELETE CASCADE,
      overall INTEGER NOT NULL CHECK (overall BETWEEN 0 AND 100),
      speed INTEGER NOT NULL CHECK (speed BETWEEN 0 AND 100),
      acceleration INTEGER NOT NULL CHECK (acceleration BETWEEN 0 AND 100),
      sprint_speed INTEGER NOT NULL CHECK (sprint_speed BETWEEN 0 AND 100),
      agility INTEGER NOT NULL CHECK (agility BETWEEN 0 AND 100),
      balance INTEGER NOT NULL CHECK (balance BETWEEN 0 AND 100),
      stamina INTEGER NOT NULL CHECK (stamina BETWEEN 0 AND 100),
      strength INTEGER NOT NULL CHECK (strength BETWEEN 0 AND 100),
      passing INTEGER NOT NULL CHECK (passing BETWEEN 0 AND 100),
      ball_control INTEGER NOT NULL CHECK (ball_control BETWEEN 0 AND 100),
      attacking INTEGER NOT NULL CHECK (attacking BETWEEN 0 AND 100),
      defending INTEGER NOT NULL CHECK (defending BETWEEN 0 AND 100),
      positioning INTEGER NOT NULL CHECK (positioning BETWEEN 0 AND 100),
      reactions INTEGER NOT NULL CHECK (reactions BETWEEN 0 AND 100),
      decision_making INTEGER NOT NULL CHECK (decision_making BETWEEN 0 AND 100),
      source_key TEXT NOT NULL REFERENCES data_sources(source_key),
      source_version INTEGER,
      source_player_id INTEGER,
      source_name TEXT,
      match_method TEXT NOT NULL,
      is_inferred INTEGER NOT NULL CHECK (is_inferred IN (0, 1)),
      confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
      confidence_level TEXT NOT NULL CHECK (confidence_level IN ('high', 'medium', 'low')),
      source_position_compatible INTEGER CHECK (source_position_compatible IN (0, 1)),
      player_elo_used INTEGER NOT NULL CHECK (player_elo_used IN (0, 1)),
      donor_player_ids TEXT NOT NULL,
      mean_neighbor_distance REAL
    ) STRICT;

    CREATE TABLE goalkeeper_abilities (
      player_id TEXT PRIMARY KEY REFERENCES players(player_id) ON DELETE CASCADE,
      diving INTEGER NOT NULL CHECK (diving BETWEEN 0 AND 100),
      handling INTEGER NOT NULL CHECK (handling BETWEEN 0 AND 100),
      distribution INTEGER NOT NULL CHECK (distribution BETWEEN 0 AND 100),
      positioning INTEGER NOT NULL CHECK (positioning BETWEEN 0 AND 100),
      reflexes INTEGER NOT NULL CHECK (reflexes BETWEEN 0 AND 100),
      sweeping INTEGER NOT NULL CHECK (sweeping BETWEEN 0 AND 100)
    ) STRICT;

    CREATE INDEX idx_players_team ON players(team_id);
    CREATE INDEX idx_players_position ON players(position);
    CREATE INDEX idx_abilities_source ON abilities(source_key);
    CREATE INDEX idx_abilities_inferred ON abilities(is_inferred);
  `);
}

function writeSqliteRows(database, dataset) {
  const insertMetadata = database.prepare("INSERT INTO metadata (key, value) VALUES (?, ?)");
  const insertSource = database.prepare(`
    INSERT INTO data_sources (source_key, name, publisher, url, version, sha256, license, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertPlayer = database.prepare(`
    INSERT INTO players (
      player_id, team_id, team_name, group_name, squad_number, name, position,
      birth_date, age_at_tournament, club, player_elo, player_elo_rank
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertAbility = database.prepare(`
    INSERT INTO abilities (
      player_id, overall, speed, acceleration, sprint_speed, agility, balance,
      stamina, strength, passing, ball_control, attacking, defending, positioning,
      reactions, decision_making, source_key, source_version, source_player_id,
      source_name, match_method, is_inferred, confidence, confidence_level,
      source_position_compatible, player_elo_used, donor_player_ids, mean_neighbor_distance
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertGoalkeeperAbility = database.prepare(`
    INSERT INTO goalkeeper_abilities (
      player_id, diving, handling, distribution, positioning, reflexes, sweeping
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  database.exec("BEGIN IMMEDIATE");
  try {
    for (const [key, value] of Object.entries(dataset.metadata).sort(([left], [right]) => left.localeCompare(right))) {
      insertMetadata.run(key, JSON.stringify(value));
    }
    insertSource.run(
      ROSTER_SOURCE.id,
      ROSTER_SOURCE.name,
      "Pohang-Neighborhood/FTA",
      null,
      "1",
      ROSTER_SOURCE.sha256,
      ROSTER_SOURCE.license,
      "Identity and PlayerElo source used to select the 2026 World Cup roster.",
    );
    insertSource.run(
      FC26_SOURCE.id,
      FC26_SOURCE.name,
      FC26_SOURCE.publisher,
      FC26_SOURCE.pageUrl,
      String(FC26_SOURCE.datasetVersion),
      FC26_SOURCE.csvSha256,
      FC26_SOURCE.license,
      "Pinned Kaggle source. Only the matched World Cup subset and normalized fields are stored. Kaggle's license label does not guarantee all underlying EA, SoFIFA, publicity, trademark, or other third-party rights.",
    );
    insertSource.run(
      "fta_estimate",
      "FTA position-age-PlayerElo KNN estimate",
      "Pohang-Neighborhood/FTA",
      null,
      dataset.metadata.estimationModel.version,
      null,
      "Generated derivative; roster and FC26 source terms apply.",
      "Deterministic estimates for players without a conservative FC26 identity match.",
    );

    for (const player of dataset.players) {
      insertPlayer.run(
        player.id,
        player.teamId,
        player.teamName,
        player.group,
        player.number,
        player.name,
        player.position,
        player.birthDate,
        player.ageAtTournament,
        player.club,
        player.playerElo?.elo ?? null,
        player.playerElo?.currentRank ?? null,
      );
      const abilityValues = ABILITY_FIELDS.map((field) => player.abilities[field]);
      insertAbility.run(
        player.id,
        ...abilityValues,
        player.provenance.source,
        player.provenance.sourceVersion,
        player.provenance.sourcePlayerId,
        player.provenance.sourceName,
        player.provenance.matchMethod,
        Number(player.provenance.isInferred),
        player.provenance.confidence,
        player.provenance.confidenceLevel,
        player.provenance.sourcePositionCompatible === null
          ? null
          : Number(player.provenance.sourcePositionCompatible),
        Number(player.provenance.playerEloUsed),
        JSON.stringify(player.provenance.donorPlayerIds),
        player.provenance.meanNeighborDistance,
      );
      if (player.goalkeeperAbilities) {
        insertGoalkeeperAbility.run(
          player.id,
          ...GOALKEEPER_FIELDS.map((field) => player.goalkeeperAbilities[field]),
        );
      }
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

async function writeSqliteDatabase(path, dataset) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await rm(temporaryPath, { force: true });
  const database = new DatabaseSync(temporaryPath);
  let completed = false;
  try {
    createSqliteSchema(database);
    writeSqliteRows(database, dataset);
    const foreignKeyViolations = database.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyViolations.length > 0) {
      throw new Error(`SQLite foreign-key violations: ${JSON.stringify(foreignKeyViolations)}`);
    }
    const integrity = database.prepare("PRAGMA integrity_check").get();
    if (integrity.integrity_check !== "ok") {
      throw new Error(`SQLite integrity check failed: ${integrity.integrity_check}`);
    }
    database.exec("VACUUM");
    completed = true;
  } finally {
    database.close();
    if (!completed) {
      await rm(temporaryPath, { force: true });
    }
  }
  await rename(temporaryPath, path);
}

async function fileDescriptor(path) {
  const contents = await readFile(path);
  const details = await stat(path);
  return { name: basename(path), bytes: details.size, sha256: sha256(contents) };
}

const argumentsMap = parseArguments(process.argv.slice(2));
const rosterPath = resolve(argumentsMap.get("roster-json") ?? DEFAULT_ROSTER_PATH);
const jsonOutput = resolve(argumentsMap.get("json-output") ?? DEFAULT_JSON_OUTPUT);
const sqliteOutput = resolve(argumentsMap.get("sqlite-output") ?? DEFAULT_SQLITE_OUTPUT);
const manifestOutput = resolve(argumentsMap.get("manifest-output") ?? DEFAULT_MANIFEST_OUTPUT);
const input = await resolveFc26Input(argumentsMap.get("fc26-csv"));

try {
  const rosterBuffer = await readFile(rosterPath);
  const rosterDigest = sha256(rosterBuffer);
  if (rosterDigest !== ROSTER_SOURCE.sha256) {
    throw new Error(`World Cup roster: expected SHA-256 ${ROSTER_SOURCE.sha256}, received ${rosterDigest}.`);
  }
  const csvBuffer = await readFile(input.csvPath);
  await assertFile(csvBuffer, FC26_SOURCE.csvBytes, FC26_SOURCE.csvSha256, FC26_SOURCE.csvFilename);
  const parsedCsv = parseCsv(csvBuffer.toString("utf8"));
  validateFc26Source(parsedCsv.headers, parsedCsv.rows);
  const dataset = buildPlayerAbilityDataset(JSON.parse(rosterBuffer.toString("utf8")), parsedCsv.rows);
  await writeAtomically(jsonOutput, `${JSON.stringify(dataset, null, 2)}\n`);
  await writeSqliteDatabase(sqliteOutput, dataset);

  const [importerBuffer, coreBuffer] = await Promise.all([
    readFile(new URL(import.meta.url)),
    readFile(new URL("./lib/player-ability-data.mjs", import.meta.url)),
  ]);
  const runtimeDatabase = new DatabaseSync(":memory:");
  const sqliteVersion = runtimeDatabase.prepare("SELECT sqlite_version() AS version").get().version;
  runtimeDatabase.close();
  const manifest = {
    schemaVersion: 1,
    snapshotAt: dataset.metadata.snapshotAt,
    generator: {
      version: 1,
      importer: {
        path: "scripts/import-world-cup-player-abilities.mjs",
        sha256: sha256(importerBuffer),
      },
      core: {
        path: "scripts/lib/player-ability-data.mjs",
        sha256: sha256(coreBuffer),
      },
      inferenceModel: dataset.metadata.estimationModel.version,
      nodeVersion: process.version,
      sqliteVersion,
    },
    sourcePackage: {
      datasetRef: FC26_SOURCE.datasetRef,
      datasetVersion: FC26_SOURCE.datasetVersion,
      downloadUrl: FC26_SOURCE.downloadUrl,
      archive: {
        name: FC26_SOURCE.archiveFilename,
        bytes: FC26_SOURCE.archiveBytes,
        sha256: FC26_SOURCE.archiveSha256,
      },
      csv: {
        name: FC26_SOURCE.csvFilename,
        bytes: FC26_SOURCE.csvBytes,
        sha256: FC26_SOURCE.csvSha256,
        players: FC26_SOURCE.playerCount,
        columns: FC26_SOURCE.columnCount,
        fifaVersion: 26,
        fifaUpdate: 4,
        fifaUpdateDate: FC26_SOURCE.dataUpdateDate,
      },
    },
    inputs: [
      {
        name: basename(rosterPath),
        bytes: rosterBuffer.byteLength,
        sha256: rosterDigest,
      },
      {
        name: FC26_SOURCE.csvFilename,
        bytes: csvBuffer.byteLength,
        sha256: sha256(csvBuffer),
        datasetVersion: FC26_SOURCE.datasetVersion,
      },
    ],
    outputs: [await fileDescriptor(jsonOutput), await fileDescriptor(sqliteOutput)],
    counts: {
      players: dataset.metadata.playerCount,
      direct: dataset.metadata.directMatchCount,
      inferred: dataset.metadata.inferredCount,
      goalkeepers: dataset.metadata.goalkeeperCount,
    },
  };
  await writeAtomically(manifestOutput, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(
    `Generated ${dataset.metadata.playerCount} player abilities: ${dataset.metadata.directMatchCount} direct FC26 matches and ${dataset.metadata.inferredCount} estimates.`,
  );
  console.log(`JSON: ${jsonOutput}`);
  console.log(`SQLite: ${sqliteOutput}`);
  console.log(`Manifest: ${manifestOutput}`);
} finally {
  if (input.temporaryDirectory) {
    await rm(input.temporaryDirectory, { recursive: true, force: true });
  }
}

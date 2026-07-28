import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const dataUrl = new URL("../data/world-cup-2026-player-abilities.json", import.meta.url);
const sqliteUrl = new URL("../data/world-cup-2026-player-abilities.sqlite", import.meta.url);
const manifestUrl = new URL("../data/world-cup-2026-player-abilities.manifest.json", import.meta.url);
const datasetBuffer = await readFile(dataUrl);
const sqliteBuffer = await readFile(sqliteUrl);
const manifest = JSON.parse(await readFile(manifestUrl));
const dataset = JSON.parse(datasetBuffer);
const directPlayers = dataset.players.filter((player) => !player.provenance.isInferred);
const inferredPlayers = dataset.players.filter((player) => player.provenance.isInferred);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function range(values) {
  return Math.max(...values) - Math.min(...values);
}

test("covers the complete World Cup roster with explicit direct and inferred sources", () => {
  assert.equal(dataset.players.length, 1248);
  assert.equal(directPlayers.length, 925);
  assert.equal(inferredPlayers.length, 323);
  assert.equal(dataset.metadata.inferredWithPlayerEloCount, 281);
  assert.equal(dataset.metadata.inferredWithoutPlayerEloCount, 42);
  assert.equal(new Set(dataset.players.map((player) => player.id)).size, dataset.players.length);
});

test("keeps FC26 identities unique and known false positives inferred", () => {
  const sourceIds = directPlayers.map((player) => player.provenance.sourcePlayerId);
  assert.equal(new Set(sourceIds).size, sourceIds.length);
  for (const playerId of ["wc2026-iraq-03", "wc2026-paraguay-24"]) {
    assert.equal(dataset.players.find((player) => player.id === playerId).provenance.isInferred, true);
  }
  assert.equal(
    dataset.players.find((player) => player.id === "wc2026-netherlands-26").provenance.sourcePlayerId,
    251806,
  );
  assert.equal(
    dataset.players.find((player) => player.id === "wc2026-saudi-arabia-03").provenance.sourcePlayerId,
    228783,
  );
});

test("stores complete integer abilities and goalkeeper-only attributes", () => {
  const expectedFields = [
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
  let goalkeeperCount = 0;
  for (const player of dataset.players) {
    assert.deepEqual(Object.keys(player.abilities), expectedFields);
    for (const value of Object.values(player.abilities)) {
      assert.ok(Number.isInteger(value));
      assert.ok(value >= 0 && value <= 100);
    }
    if (player.position === "GK") {
      goalkeeperCount += 1;
      assert.deepEqual(Object.keys(player.goalkeeperAbilities), [
        "diving",
        "handling",
        "distribution",
        "positioning",
        "reflexes",
        "sweeping",
      ]);
    } else {
      assert.equal(player.goalkeeperAbilities, null);
    }
  }
  assert.equal(goalkeeperCount, 145);
});

test("records deterministic estimate evidence and retains useful variation", () => {
  const directSourceIds = new Set(directPlayers.map((player) => player.provenance.sourcePlayerId));
  const incompatibleSourceIds = new Set(
    directPlayers
      .filter((player) => !player.provenance.sourcePositionCompatible)
      .map((player) => player.provenance.sourcePlayerId),
  );
  for (const player of inferredPlayers) {
    assert.equal(player.provenance.source, "fta_estimate");
    assert.ok(player.provenance.donorPlayerIds.length >= (player.position === "GK" ? 7 : 11));
    assert.ok(player.provenance.donorPlayerIds.every((id) => directSourceIds.has(id)));
    assert.ok(player.provenance.donorPlayerIds.every((id) => !incompatibleSourceIds.has(id)));
    assert.ok(Number.isFinite(player.provenance.meanNeighborDistance));
    assert.equal(player.provenance.confidence, player.provenance.playerEloUsed ? 0.6 : 0.4);
  }

  const checks = [
    ["GK", "speed", 8],
    ["DF", "sprintSpeed", 10],
    ["MF", "passing", 8],
    ["FW", "attacking", 8],
  ];
  for (const [position, field, minimumRange] of checks) {
    const values = inferredPlayers
      .filter((player) => player.position === position)
      .map((player) => player.abilities[field]);
    assert.ok(range(values) >= minimumRange, `${position}.${field} estimates collapsed to a narrow range.`);
  }
});

test("keeps pace and stamina ranges large enough for movement tuning", () => {
  const fieldPlayers = dataset.players.filter((player) => player.position !== "GK");
  const fastest = fieldPlayers.reduce((best, player) =>
    player.abilities.sprintSpeed > best.abilities.sprintSpeed ? player : best,
  );
  const slowest = fieldPlayers.reduce((worst, player) =>
    player.abilities.sprintSpeed < worst.abilities.sprintSpeed ? player : worst,
  );
  const highestStamina = fieldPlayers.reduce((best, player) =>
    player.abilities.stamina > best.abilities.stamina ? player : best,
  );
  const lowestStamina = fieldPlayers.reduce((worst, player) =>
    player.abilities.stamina < worst.abilities.stamina ? player : worst,
  );

  const sprintMetersPerSecond = (player) => 4 + (player.abilities.sprintSpeed / 100) * 5;
  const lateMatchRetention = (player) => 0.55 + (player.abilities.stamina / 100) * 0.45;
  assert.ok(sprintMetersPerSecond(fastest) - sprintMetersPerSecond(slowest) >= 1.5);
  assert.ok(lateMatchRetention(highestStamina) - lateMatchRetention(lowestStamina) >= 0.15);
});

test("keeps inferred goalkeeper common and specialist fields consistent", () => {
  for (const player of inferredPlayers.filter((candidate) => candidate.position === "GK")) {
    assert.equal(player.abilities.passing, player.goalkeeperAbilities.distribution);
    assert.equal(player.abilities.positioning, player.goalkeeperAbilities.positioning);
  }
});

test("keeps SQLite, JSON, and manifest outputs aligned", () => {
  const jsonDescriptor = manifest.outputs.find((output) => output.name.endsWith("abilities.json"));
  const sqliteDescriptor = manifest.outputs.find((output) => output.name.endsWith("abilities.sqlite"));
  assert.equal(jsonDescriptor.sha256, sha256(datasetBuffer));
  assert.equal(sqliteDescriptor.sha256, sha256(sqliteBuffer));

  const database = new DatabaseSync(sqliteUrl.pathname, { readOnly: true });
  try {
    assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM players").get().count, dataset.players.length);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM abilities WHERE is_inferred = 0").get().count, 925);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM abilities WHERE is_inferred = 1").get().count, 323);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM goalkeeper_abilities").get().count, 145);
  } finally {
    database.close();
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  createParticipantId,
  positionForFormationRole,
  projectAbilityRecord,
  projectPlayerCatalog,
  selectDefaultLineup,
} from "../lib/player-catalog.js";

const baseAbilities = Object.freeze({
  overall: 70,
  speed: 70,
  acceleration: 70,
  sprintSpeed: 70,
  agility: 70,
  balance: 70,
  stamina: 70,
  strength: 70,
  passing: 70,
  ballControl: 70,
  attacking: 70,
  defending: 70,
  positioning: 70,
  reactions: 70,
  decisionMaking: 70,
});

const goalkeeperAbilities = Object.freeze({
  diving: 75,
  handling: 75,
  distribution: 75,
  positioning: 75,
  reflexes: 75,
  sweeping: 75,
});

function abilityRecord({
  id,
  number,
  position,
  overall,
  teamId = "test-nation",
  teamName = "Test Nation",
  group = "A",
}) {
  return {
    id,
    teamId,
    teamName,
    group,
    name: `Player ${number}`,
    number,
    position,
    birthDate: "2000-01-01",
    ageAtTournament: 26,
    club: "Test FC",
    playerElo: { elo: 1800, currentRank: number },
    abilities: {
      ...baseAbilities,
      overall,
      defending: position === "GK" || position === "DF" ? overall : 60,
      passing: position === "MF" ? overall : 60,
      attacking: position === "FW" ? overall : 60,
    },
    goalkeeperAbilities:
      position === "GK" ? { ...goalkeeperAbilities, reflexes: overall } : null,
    provenance: {
      source: "fta_estimate",
      isInferred: true,
      confidence: 0.6,
    },
    isInferred: true,
    foot: "right",
    secondaryPosition: "CM",
  };
}

const abilityRecords = [
  abilityRecord({ id: "gk-1", number: 1, position: "GK", overall: 88 }),
  abilityRecord({ id: "gk-2", number: 12, position: "GK", overall: 72 }),
  abilityRecord({ id: "df-1", number: 2, position: "DF", overall: 84 }),
  abilityRecord({ id: "df-2", number: 3, position: "DF", overall: 82 }),
  abilityRecord({ id: "df-3", number: 4, position: "DF", overall: 80 }),
  abilityRecord({ id: "df-4", number: 5, position: "DF", overall: 78 }),
  abilityRecord({ id: "df-5", number: 13, position: "DF", overall: 70 }),
  abilityRecord({ id: "mf-1", number: 6, position: "MF", overall: 86 }),
  abilityRecord({ id: "mf-2", number: 8, position: "MF", overall: 83 }),
  abilityRecord({ id: "mf-3", number: 10, position: "MF", overall: 81 }),
  abilityRecord({ id: "mf-4", number: 14, position: "MF", overall: 73 }),
  abilityRecord({ id: "fw-1", number: 7, position: "FW", overall: 87 }),
  abilityRecord({ id: "fw-2", number: 9, position: "FW", overall: 85 }),
  abilityRecord({ id: "fw-3", number: 11, position: "FW", overall: 82 }),
  abilityRecord({ id: "fw-4", number: 15, position: "FW", overall: 74 }),
];

const formationSlots = [
  { role: "GK", x: 50, y: 90 },
  { role: "LB", x: 14, y: 70 },
  { role: "LCB", x: 38, y: 74 },
  { role: "RCB", x: 62, y: 74 },
  { role: "RB", x: 86, y: 70 },
  { role: "DM", x: 50, y: 57 },
  { role: "LCM", x: 31, y: 47 },
  { role: "RCM", x: 69, y: 47 },
  { role: "LW", x: 15, y: 24 },
  { role: "ST", x: 50, y: 19 },
  { role: "RW", x: 85, y: 24 },
];

test("projects only client-safe ability fields", () => {
  const source = abilityRecords[0];
  const player = projectAbilityRecord(source);

  assert.deepEqual(Object.keys(player), [
    "id",
    "teamId",
    "teamName",
    "group",
    "name",
    "number",
    "position",
    "age",
    "club",
    "abilities",
    "goalkeeperAbilities",
  ]);
  assert.equal(player.age, source.ageAtTournament);
  for (const excludedField of [
    "birthDate",
    "playerElo",
    "provenance",
    "isInferred",
    "foot",
    "secondaryPosition",
  ]) {
    assert.equal(excludedField in player, false);
  }
  assert.notEqual(player.abilities, source.abilities);
  assert.notEqual(player.goalkeeperAbilities, source.goalkeeperAbilities);
  assert.doesNotMatch(
    JSON.stringify(player),
    /provenance|isInferred|secondaryPosition|"foot"/,
  );
});

test("creates distinct participants when the same nation plays both sides", () => {
  const catalog = projectPlayerCatalog(abilityRecords);
  const home = selectDefaultLineup(catalog, {
    teamId: "test-nation",
    teamSide: "home",
    formationSlots,
  });
  const away = selectDefaultLineup(catalog, {
    teamId: "test-nation",
    teamSide: "away",
    formationSlots,
  });

  assert.deepEqual(
    home.map((participant) => participant.player.id),
    away.map((participant) => participant.player.id),
  );
  assert.equal(
    new Set(
      [...home, ...away].map((participant) => participant.participantId),
    ).size,
    22,
  );
  assert.equal(home[0].participantId, createParticipantId("home", "gk-1"));
  assert.equal(away[0].participantId, createParticipantId("away", "gk-1"));
});

test("selects one goalkeeper and matches every formation role deterministically", () => {
  const lineup = selectDefaultLineup(projectPlayerCatalog(abilityRecords), {
    teamId: "test-nation",
    teamSide: "home",
    formationSlots,
  });

  assert.equal(lineup.length, 11);
  assert.equal(
    lineup.filter((participant) => participant.player.position === "GK").length,
    1,
  );
  assert.equal(lineup[0].player.id, "gk-1");
  for (const participant of lineup) {
    assert.equal(
      participant.player.position,
      positionForFormationRole(participant.role),
    );
  }
  assert.equal(
    new Set(lineup.map((participant) => participant.player.id)).size,
    11,
  );
});

test("keeps catalog and default lineup ordering stable across source order", () => {
  const forwardCatalog = projectPlayerCatalog(abilityRecords);
  const reverseCatalog = projectPlayerCatalog([...abilityRecords].reverse());
  assert.deepEqual(
    forwardCatalog.map((player) => player.id),
    reverseCatalog.map((player) => player.id),
  );

  const options = {
    teamId: "test-nation",
    teamSide: "home",
    formationSlots,
  };
  assert.deepEqual(
    selectDefaultLineup(forwardCatalog, options).map(
      (participant) => participant.player.id,
    ),
    selectDefaultLineup(reverseCatalog, options).map(
      (participant) => participant.player.id,
    ),
  );
});

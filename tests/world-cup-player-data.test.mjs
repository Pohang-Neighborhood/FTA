import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const data = JSON.parse(await readFile(new URL("../data/world-cup-2026-players.json", import.meta.url)));
const players = data.teams.flatMap((team) => team.players);

test("contains every 2026 World Cup final squad", () => {
  assert.equal(data.teams.length, 48);
  assert.equal(players.length, 1248);
  assert.ok(data.teams.every((team) => team.players.length === 26));
});

test("keeps shirt numbers unique inside each team", () => {
  for (const team of data.teams) {
    assert.equal(new Set(team.players.map((player) => player.number)).size, 26, team.name);
  }
});

test("preserves conservative PlayerElo matching", () => {
  const matchedPlayers = players.filter((player) => player.playerElo);
  assert.equal(matchedPlayers.length, data.metadata.ratingsMatched);
  assert.ok(matchedPlayers.length / players.length >= 0.95);
  assert.equal(new Set(matchedPlayers.map((player) => player.playerElo.sourcePlayerId)).size, matchedPlayers.length);
  assert.ok(players.filter((player) => !player.playerElo).length > 0, "Unmatched players must remain explicit.");
});

test("does not fabricate pace, passing, or defending ratings", () => {
  for (const player of players) {
    assert.equal("pace" in player, false);
    assert.equal("passing" in player, false);
    assert.equal("defending" in player, false);
  }
});

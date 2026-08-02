import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const dataPath = resolve(process.argv[2] ?? "data/world-cup-2026-players.json");
const data = JSON.parse(await readFile(dataPath, "utf8"));
const errors = [];
const positions = new Set(["GK", "DF", "MF", "FW"]);
const matchMethods = new Set(["nationality_birth_date_name", "birth_date_name"]);
const playerIds = new Set();
const sourcePlayerIds = new Set();
let playerCount = 0;
let matchedCount = 0;

function assert(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

assert(data.metadata?.tournament === "2026 FIFA World Cup", "Unexpected tournament metadata.");
assert(data.teams?.length === 48, `Expected 48 teams, received ${data.teams?.length ?? 0}.`);

const teamIds = new Set(data.teams.map((team) => team.id));
assert(teamIds.size === data.teams.length, "Team IDs must be unique.");

for (const team of data.teams) {
  assert(/^[A-L]$/.test(team.group), `${team.name}: invalid group ${team.group}.`);
  assert(team.players.length === 26, `${team.name}: expected 26 players, received ${team.players.length}.`);
  const squadNumbers = new Set();

  for (const player of team.players) {
    playerCount += 1;
    assert(!playerIds.has(player.id), `${team.name}: duplicate player ID ${player.id}.`);
    playerIds.add(player.id);
    assert(typeof player.name === "string" && player.name.length > 0, `${team.name}: missing player name.`);
    assert(Number.isInteger(player.number) && player.number >= 1 && player.number <= 26, `${team.name}: invalid number for ${player.name}.`);
    assert(!squadNumbers.has(player.number), `${team.name}: duplicate number ${player.number}.`);
    squadNumbers.add(player.number);
    assert(positions.has(player.position), `${team.name}: invalid position for ${player.name}.`);
    assert(/^\d{4}-\d{2}-\d{2}$/.test(player.birthDate), `${team.name}: invalid birth date for ${player.name}.`);
    assert(typeof player.club === "string" && player.club.length > 0, `${team.name}: missing club for ${player.name}.`);

    if (!player.playerElo) {
      continue;
    }

    matchedCount += 1;
    const rating = player.playerElo;
    assert(matchMethods.has(rating.matchMethod), `${player.name}: unsupported match method.`);
    assert(Number.isFinite(rating.elo) && rating.elo > 0, `${player.name}: invalid Elo.`);
    assert(Number.isInteger(rating.currentRank) && rating.currentRank > 0, `${player.name}: invalid rank.`);
    assert(Number.isInteger(rating.sourcePlayerId), `${player.name}: invalid PlayerElo ID.`);
    assert(!sourcePlayerIds.has(rating.sourcePlayerId), `${player.name}: duplicate PlayerElo ID ${rating.sourcePlayerId}.`);
    sourcePlayerIds.add(rating.sourcePlayerId);
  }
}

const expectedMatchRate = Number((matchedCount / playerCount).toFixed(4));
assert(playerCount === 1248, `Expected 1,248 players, received ${playerCount}.`);
assert(data.metadata.teamCount === data.teams.length, "Team metadata count does not match data.");
assert(data.metadata.playerCount === playerCount, "Player metadata count does not match data.");
assert(data.metadata.ratingsMatched === matchedCount, "Matched rating count does not match data.");
assert(data.metadata.ratingsUnmatched === playerCount - matchedCount, "Unmatched rating count does not match data.");
assert(data.metadata.ratingMatchRate === expectedMatchRate, "Rating match rate does not match data.");
assert(expectedMatchRate >= 0.95, `Rating match rate ${expectedMatchRate} is below 95%.`);
assert(data.metadata.sources?.every((source) => /^[a-f0-9]{64}$/.test(source.sha256)), "Every source requires a SHA-256 digest.");

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Validated ${playerCount} players across ${data.teams.length} teams. PlayerElo coverage: ${matchedCount}/${playerCount} (${(expectedMatchRate * 100).toFixed(2)}%).`,
  );
}

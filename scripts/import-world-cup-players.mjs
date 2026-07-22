import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const WIKIPEDIA_REVISION = 1365337987;
const WIKIPEDIA_URL = `https://en.wikipedia.org/w/index.php?title=2026_FIFA_World_Cup_squads&oldid=${WIKIPEDIA_REVISION}`;
const PLAYERELO_VERSION = 47;
const PLAYERELO_URL = `https://www.kaggle.com/api/v1/datasets/download/mwolters/playerelo-football-ratings?datasetVersionNumber=${PLAYERELO_VERSION}`;

const nationalityAliases = new Map([
  ["Bosnia and Herzegovina", ["Bosnia and Herzegovina", "Bosnia-Herzegovina"]],
  ["Cape Verde", ["Cape Verde", "Cabo Verde"]],
  ["Curaçao", ["Curaçao", "Curacao"]],
  ["DR Congo", ["DR Congo", "Congo DR", "Democratic Republic of the Congo"]],
  ["Iran", ["Iran", "Iran, Islamic Republic of"]],
  ["Ivory Coast", ["Ivory Coast", "Côte d'Ivoire"]],
  ["South Korea", ["South Korea", "Korea Republic"]],
  ["United States", ["United States", "USA"]],
]);

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

async function download(url, path) {
  const response = await fetch(url, {
    headers: { "user-agent": "FTA data importer (https://github.com/Pohang-Neighborhood/FTA)" },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }

  await writeFile(path, Buffer.from(await response.arrayBuffer()));
}

async function resolveInputs(argumentsMap) {
  const providedSquads = argumentsMap.get("squads-html");
  const providedRatings = argumentsMap.get("playerelo-csv");

  if (providedSquads && providedRatings) {
    return {
      squadsPath: resolve(providedSquads),
      ratingsPath: resolve(providedRatings),
    };
  }

  if (providedSquads || providedRatings) {
    throw new Error("Provide both --squads-html and --playerelo-csv, or neither.");
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "fta-world-cup-import-"));
  const squadsPath = join(temporaryDirectory, "squads.html");
  const ratingsArchivePath = join(temporaryDirectory, "playerelo.zip");
  const ratingsDirectory = join(temporaryDirectory, "playerelo");

  await mkdir(ratingsDirectory);
  await Promise.all([
    download(WIKIPEDIA_URL, squadsPath),
    download(PLAYERELO_URL, ratingsArchivePath),
  ]);
  execFileSync("unzip", ["-q", ratingsArchivePath, "players.csv", "-d", ratingsDirectory]);

  return {
    squadsPath,
    ratingsPath: join(ratingsDirectory, "players.csv"),
  };
}

function decodeHtmlAttribute(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function plainWikitext(value = "") {
  return value
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/'{2,}/g, "")
    .trim();
}

function parseBirthDate(value = "") {
  const numericParts = value
    .split("|")
    .map((part) => part.replace(/}}$/, "").trim())
    .filter((part) => /^\d+$/.test(part));

  if (numericParts.length < 6) {
    throw new Error(`Could not parse birth date: ${value}`);
  }

  const [year, month, day] = numericParts.slice(-3).map(Number);
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function parseSquads(html) {
  const revision = Number(html.match(/"wgRevisionId":(\d+)/)?.[1]);

  if (revision !== WIKIPEDIA_REVISION) {
    throw new Error(`Expected Wikipedia revision ${WIKIPEDIA_REVISION}, received ${revision || "unknown"}.`);
  }

  const headingPattern = /<h3 id="[^"]+">([\s\S]*?)<\/h3>/g;
  const headings = [...html.matchAll(headingPattern)];
  const teams = [];

  for (let headingIndex = 0; headingIndex < headings.length; headingIndex += 1) {
    const heading = headings[headingIndex];
    const chunkEnd = headings[headingIndex + 1]?.index ?? html.length;
    const chunk = html.slice(heading.index, chunkEnd);
    const encodedMetadata = [...chunk.matchAll(/data-mw='([^']*nat fs g player[^']*)'/g)][0]?.[1];

    if (!encodedMetadata) {
      continue;
    }

    const metadata = JSON.parse(decodeHtmlAttribute(encodedMetadata));
    const playerTemplates = metadata.parts.filter(
      (part) => part.template?.target?.wt?.toLowerCase() === "nat fs g player",
    );
    const teamName = decodeHtmlAttribute(heading[1].replace(/<[^>]+>/g, ""));
    const group = String.fromCharCode(65 + Math.floor(teams.length / 4));
    const players = playerTemplates.map(({ template }) => {
      const params = template.params;
      return {
        id: `wc2026-${slugify(teamName)}-${params.no.wt.padStart(2, "0")}`,
        name: plainWikitext(params.name.wt),
        number: Number(params.no.wt),
        position: params.pos.wt,
        birthDate: parseBirthDate(params.age.wt),
        capsBeforeTournament: Number(params.caps.wt),
        goalsBeforeTournament: Number(params.goals.wt),
        club: plainWikitext(params.club.wt),
        clubAssociation: params.clubnat.wt,
        captain: params.other?.wt?.toLowerCase().includes("captain") ?? false,
      };
    });

    teams.push({ id: slugify(teamName), name: teamName, group, players });
  }

  return teams;
}

function parseCsv(source) {
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

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows.shift();
  return rows
    .filter((values) => values.some(Boolean))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeName(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function surname(value) {
  const suffixes = new Set(["jr", "junior", "sr", "senior"]);
  const tokens = value.split(/[\s-]+/).filter(Boolean);
  const lastToken = suffixes.has(normalizeName(tokens.at(-1) ?? "")) ? tokens.at(-2) : tokens.at(-1);
  return normalizeName(lastToken ?? value);
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

function similarity(left, right) {
  const longestLength = Math.max(left.length, right.length);
  return longestLength === 0 ? 1 : 1 - editDistance(left, right) / longestLength;
}

function namesAreCompatible(squadName, ratingName) {
  const normalizedSquadName = normalizeName(squadName);
  const normalizedRatingName = normalizeName(ratingName);
  const squadTokens = squadName.split(/[\s-]+/).map(normalizeName).filter(Boolean);
  const ratingTokens = ratingName.split(/[\s-]+/).map(normalizeName).filter(Boolean);
  const firstRatingInitial = ratingTokens[0]?.[0];
  const hasCompatibleInitial = squadTokens.some((token) => token[0] === firstRatingInitial);
  const surnameSimilarity = similarity(surname(squadName), surname(ratingName));
  return (
    normalizedSquadName === normalizedRatingName ||
    normalizedSquadName.includes(normalizedRatingName) ||
    normalizedRatingName.includes(normalizedSquadName) ||
    (hasCompatibleInitial && surname(squadName) === surname(ratingName)) ||
    (hasCompatibleInitial && surnameSimilarity >= 0.72)
  );
}

function nullableNumber(value) {
  return value === "" ? null : Number(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function ratingPayload(row, method) {
  return {
    sourcePlayerId: Number(row.player_id),
    sourceName: row.player_name,
    sourceNationality: row.nationality,
    matchMethod: method,
    elo: Number(row.elo),
    currentRank: Number(row.current_rank),
    eloPrevious28Days: nullableNumber(row.elo_prev_28d),
    rankPrevious28Days: nullableNumber(row.rank_prev_28d),
    sourcePosition: row.position || null,
    currentTeam: row.current_team || null,
    currentLeague: row.current_league || null,
    gamesPlayed: Number(row.games_played),
    eloAboveReplacementCareer: nullableNumber(row.ear_career),
    eloAboveReplacementMatches: nullableNumber(row.ear_matches),
    eloAboveReplacement180Days: nullableNumber(row.ear_180),
    lastUpdated: row.last_updated,
  };
}

function matchRating(teamName, player, ratings) {
  const acceptedNationalities = nationalityAliases.get(teamName) ?? [teamName];
  const nationalityAndBirthDate = ratings.filter(
    (rating) => acceptedNationalities.includes(rating.nationality) && rating.birth_date === player.birthDate,
  );
  const compatibleNationalMatches = nationalityAndBirthDate.filter((rating) =>
    namesAreCompatible(player.name, rating.player_name),
  );

  if (compatibleNationalMatches.length === 1) {
    return ratingPayload(compatibleNationalMatches[0], "nationality_birth_date_name");
  }

  const globalBirthDateMatches = ratings.filter(
    (rating) => rating.birth_date === player.birthDate && namesAreCompatible(player.name, rating.player_name),
  );

  if (globalBirthDateMatches.length === 1) {
    return ratingPayload(globalBirthDateMatches[0], "birth_date_name");
  }

  return null;
}

function validateSourceData(teams) {
  if (teams.length !== 48) {
    throw new Error(`Expected 48 teams, received ${teams.length}.`);
  }

  for (const team of teams) {
    if (team.players.length !== 26) {
      throw new Error(`Expected 26 players for ${team.name}, received ${team.players.length}.`);
    }

    const numbers = new Set(team.players.map((player) => player.number));
    if (numbers.size !== 26 || [...numbers].some((number) => number < 1 || number > 26)) {
      throw new Error(`Invalid squad numbers for ${team.name}.`);
    }
  }
}

async function main() {
  const argumentsMap = parseArguments(process.argv.slice(2));
  const outputPath = resolve(argumentsMap.get("output") ?? "data/world-cup-2026-players.json");
  const { squadsPath, ratingsPath } = await resolveInputs(argumentsMap);
  const [squadsHtml, ratingsCsv] = await Promise.all([
    readFile(squadsPath, "utf8"),
    readFile(ratingsPath, "utf8"),
  ]);
  const teams = parseSquads(squadsHtml);
  const ratings = parseCsv(ratingsCsv);
  const squadSourceSha256 = sha256(JSON.stringify(teams));
  const ratingsSourceSha256 = sha256(JSON.stringify(ratings));
  validateSourceData(teams);

  let matchedPlayers = 0;
  for (const team of teams) {
    team.players = team.players.map((player) => {
      const playerElo = matchRating(team.name, player, ratings);
      matchedPlayers += playerElo ? 1 : 0;
      return { ...player, playerElo };
    });
  }

  const playerCount = teams.reduce((total, team) => total + team.players.length, 0);
  const result = {
    metadata: {
      tournament: "2026 FIFA World Cup",
      generatedAt: new Date().toISOString(),
      teamCount: teams.length,
      playerCount,
      ratingsMatched: matchedPlayers,
      ratingsUnmatched: playerCount - matchedPlayers,
      ratingMatchRate: Number((matchedPlayers / playerCount).toFixed(4)),
      ratingMeaning:
        "PlayerElo estimates contribution to match results. It is not a direct pace, passing, defending, or talent score.",
      sources: [
        {
          name: "2026 FIFA World Cup squads",
          publisher: "Wikipedia contributors",
          url: WIKIPEDIA_URL,
          revision: WIKIPEDIA_REVISION,
          sha256: squadSourceSha256,
          license: "CC BY-SA 4.0",
        },
        {
          name: "PlayerElo Football Ratings",
          publisher: "PlayerElo",
          url: "https://www.kaggle.com/datasets/mwolters/playerelo-football-ratings",
          datasetVersion: PLAYERELO_VERSION,
          sha256: ratingsSourceSha256,
          license: "CC BY 4.0",
        },
      ],
    },
    teams,
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    `Wrote ${playerCount} players across ${teams.length} teams to ${outputPath}. PlayerElo matched ${matchedPlayers}/${playerCount} (${(result.metadata.ratingMatchRate * 100).toFixed(2)}%).`,
  );
}

await main();

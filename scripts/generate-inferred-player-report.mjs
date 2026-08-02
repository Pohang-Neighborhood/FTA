import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_INPUT_PATH =
  "data/world-cup-2026-player-abilities.json";
export const DEFAULT_OUTPUT_PATH = "docs/inferred-player-abilities.md";

function compareText(left, right) {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function comparePlayers(left, right) {
  return (
    left.number - right.number ||
    compareText(left.name, right.name) ||
    compareText(left.position, right.position) ||
    compareText(left.club, right.club) ||
    compareText(left.id, right.id)
  );
}

function escapeTableCell(value) {
  const text = String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replace(/\s+/g, " ")
    .trim();
  return text || "—";
}

function validateMetadataCount(metadata, field, actual) {
  const declared = metadata?.[field];
  if (declared !== undefined && declared !== actual) {
    throw new RangeError(
      `Dataset metadata ${field}=${declared} does not match ${actual}.`,
    );
  }
}

export function createInferredPlayerReportModel(dataset) {
  if (!dataset || !Array.isArray(dataset.players)) {
    throw new TypeError("Ability dataset must contain a players array.");
  }

  const inferredPlayers = dataset.players.filter(
    (player) => player.provenance?.isInferred === true,
  );
  const playerIds = new Set();
  let playerEloUsedCount = 0;

  for (const player of inferredPlayers) {
    if (typeof player.id !== "string" || player.id.length === 0) {
      throw new TypeError("Every inferred player requires a non-empty ID.");
    }
    if (playerIds.has(player.id)) {
      throw new RangeError(`Duplicate inferred player ID: ${player.id}`);
    }
    playerIds.add(player.id);

    if (typeof player.provenance.playerEloUsed !== "boolean") {
      throw new TypeError(
        `Inferred player ${player.id} requires boolean playerEloUsed.`,
      );
    }
    if (player.provenance.playerEloUsed) {
      playerEloUsedCount += 1;
    }
  }

  const playerEloUnusedCount = inferredPlayers.length - playerEloUsedCount;
  validateMetadataCount(
    dataset.metadata,
    "inferredCount",
    inferredPlayers.length,
  );
  validateMetadataCount(
    dataset.metadata,
    "inferredWithPlayerEloCount",
    playerEloUsedCount,
  );
  validateMetadataCount(
    dataset.metadata,
    "inferredWithoutPlayerEloCount",
    playerEloUnusedCount,
  );

  const countries = new Map();
  for (const player of inferredPlayers) {
    const countryKey = `${player.group}\u0000${player.teamId}`;
    const country = countries.get(countryKey) ?? {
      group: player.group,
      teamId: player.teamId,
      teamName: player.teamName,
      players: [],
    };
    if (
      country.teamName !== player.teamName ||
      country.group !== player.group
    ) {
      throw new RangeError(
        `Inconsistent country metadata for team ${player.teamId}.`,
      );
    }
    country.players.push(player);
    countries.set(countryKey, country);
  }

  const groups = new Map();
  const sortedCountries = [...countries.values()].sort(
    (left, right) =>
      compareText(left.group, right.group) ||
      compareText(left.teamName, right.teamName) ||
      compareText(left.teamId, right.teamId),
  );
  for (const country of sortedCountries) {
    country.players.sort(comparePlayers);
    const groupCountries = groups.get(country.group) ?? [];
    groupCountries.push(country);
    groups.set(country.group, groupCountries);
  }

  return {
    snapshotAt: dataset.metadata?.snapshotAt ?? null,
    stats: {
      inferredCount: inferredPlayers.length,
      playerEloUsedCount,
      playerEloUnusedCount,
    },
    groups: [...groups.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([group, groupCountries]) => ({
        group,
        countries: groupCountries,
      })),
  };
}

export function generateInferredPlayerReport(dataset) {
  const model = createInferredPlayerReportModel(dataset);
  const lines = [
    "# 추정 능력치 선수 목록",
    "",
    "이 문서는 2026 FIFA 월드컵 선수 능력치 데이터 중 추정 모델로 생성된 선수만 정리합니다.",
    "",
    "## 요약",
    "",
    `- 총 추정 선수: **${model.stats.inferredCount}명**`,
    `- PlayerElo 사용: **${model.stats.playerEloUsedCount}명**`,
    `- PlayerElo 미사용: **${model.stats.playerEloUnusedCount}명**`,
    "- UI 정책: 추정 능력치 선수도 다른 선수와 동일하게 제공하며, 서비스 UI에는 `추정` 또는 출처 배지를 표시하지 않습니다.",
  ];

  if (model.snapshotAt) {
    lines.push(`- 데이터 스냅샷: \`${model.snapshotAt}\``);
  }

  lines.push(
    "",
    "## 국가별 목록",
    "",
    "각 국가는 월드컵 조 순서로, 선수는 등번호·이름·포지션·클럽·ID 순서로 정렬했습니다.",
    "",
  );

  for (const group of model.groups) {
    lines.push(`### Group ${escapeTableCell(group.group)}`, "");
    for (const country of group.countries) {
      lines.push(
        `#### ${escapeTableCell(country.teamName)} (${country.players.length}명)`,
        "",
        "| 등번호 | 이름 | 포지션 | 클럽 |",
        "| ---: | --- | :---: | --- |",
      );
      for (const player of country.players) {
        lines.push(
          `| ${player.number} | ${escapeTableCell(player.name)} | ${escapeTableCell(player.position)} | ${escapeTableCell(player.club)} |`,
        );
      }
      lines.push("");
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function parseArguments(argv) {
  let inputPath = DEFAULT_INPUT_PATH;
  let outputPath = DEFAULT_OUTPUT_PATH;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--stdin") {
      inputPath = "-";
      continue;
    }
    if (argument === "--stdout") {
      outputPath = "-";
      continue;
    }
    if (argument === "--input" || argument === "--output") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${argument} requires a path or '-'.`);
      }
      if (argument === "--input") {
        inputPath = value;
      } else {
        outputPath = value;
      }
      index += 1;
      continue;
    }
    throw new Error(`Unsupported argument: ${argument}`);
  }

  return { inputPath, outputPath };
}

async function readStandardInput() {
  let source = "";
  for await (const chunk of process.stdin) {
    source += chunk;
  }
  if (!source.trim()) {
    throw new Error("Standard input did not contain an ability dataset.");
  }
  return source;
}

async function run() {
  const { inputPath, outputPath } = parseArguments(process.argv.slice(2));
  const source =
    inputPath === "-"
      ? await readStandardInput()
      : await readFile(resolve(inputPath), "utf8");
  const report = generateInferredPlayerReport(JSON.parse(source));

  if (outputPath === "-") {
    process.stdout.write(report);
    return;
  }

  const resolvedOutputPath = resolve(outputPath);
  await mkdir(dirname(resolvedOutputPath), { recursive: true });
  await writeFile(resolvedOutputPath, report);
  process.stdout.write(`Generated ${resolvedOutputPath}\n`);
}

const isMainModule =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMainModule) {
  await run();
}

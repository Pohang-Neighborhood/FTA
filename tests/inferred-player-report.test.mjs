import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createInferredPlayerReportModel,
  generateInferredPlayerReport,
} from "../scripts/generate-inferred-player-report.mjs";

const teams = [
  { teamId: "alpha", teamName: "Alpha Nation", group: "A" },
  { teamId: "beta", teamName: "Beta Nation", group: "A" },
  { teamId: "gamma", teamName: "Gamma Nation", group: "B" },
  { teamId: "delta", teamName: "Delta Nation", group: "B" },
];

function player(index, { inferred = true } = {}) {
  const team = teams[index % teams.length];
  return {
    id: `${inferred ? "inferred" : "direct"}-${String(index).padStart(3, "0")}`,
    ...team,
    name: `${inferred ? "Inferred" : "Direct"} Player ${String(index).padStart(3, "0")}`,
    number: (index % 26) + 1,
    position: ["GK", "DF", "MF", "FW"][index % 4],
    club: `Club ${String(20 - (index % 20)).padStart(2, "0")}`,
    provenance: {
      isInferred: inferred,
      playerEloUsed: inferred ? index < 281 : false,
    },
  };
}

function dataset() {
  const inferredPlayers = Array.from({ length: 323 }, (_, index) =>
    player(index),
  );
  return {
    metadata: {
      snapshotAt: "2026-07-22T06:45:36.189Z",
      inferredCount: 323,
      inferredWithPlayerEloCount: 281,
      inferredWithoutPlayerEloCount: 42,
    },
    players: [
      ...inferredPlayers,
      player(500, { inferred: false }),
      player(501, { inferred: false }),
    ],
  };
}

function occurrences(source, value) {
  return source.split(value).length - 1;
}

test("lists all 323 inferred players exactly once and no direct players", () => {
  const source = dataset();
  const report = generateInferredPlayerReport(source);
  const inferredPlayers = source.players.filter(
    (candidate) => candidate.provenance.isInferred,
  );
  const directPlayers = source.players.filter(
    (candidate) => !candidate.provenance.isInferred,
  );

  assert.equal((report.match(/^\| \d+ \|/gm) ?? []).length, 323);
  for (const inferredPlayer of inferredPlayers) {
    assert.equal(occurrences(report, inferredPlayer.name), 1);
  }
  for (const directPlayer of directPlayers) {
    assert.equal(occurrences(report, directPlayer.name), 0);
  }
});

test("keeps statistics and ordering deterministic", () => {
  const source = dataset();
  const report = generateInferredPlayerReport(source);
  const reversedReport = generateInferredPlayerReport({
    ...source,
    players: [...source.players].reverse(),
  });
  const model = createInferredPlayerReportModel(source);

  assert.equal(report, reversedReport);
  assert.deepEqual(model.stats, {
    inferredCount: 323,
    playerEloUsedCount: 281,
    playerEloUnusedCount: 42,
  });
  assert.match(report, /총 추정 선수: \*\*323명\*\*/);
  assert.match(report, /PlayerElo 사용: \*\*281명\*\*/);
  assert.match(report, /PlayerElo 미사용: \*\*42명\*\*/);
  assert.match(report, /서비스 UI에는 `추정` 또는 출처 배지를 표시하지 않습니다/);
  assert.ok(report.indexOf("### Group A") < report.indexOf("### Group B"));
  assert.ok(
    report.indexOf("#### Alpha Nation") < report.indexOf("#### Beta Nation"),
  );

  const invalidMetadata = dataset();
  invalidMetadata.metadata.inferredCount = 322;
  assert.throws(
    () => generateInferredPlayerReport(invalidMetadata),
    /does not match 323/,
  );
});

test("supports stdin and explicit input and output paths", async () => {
  const source = JSON.stringify(dataset());
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "fta-inferred-report-test-"),
  );
  const inputPath = join(temporaryDirectory, "abilities.json");
  const stdinOutputPath = join(temporaryDirectory, "stdin-report.md");
  const explicitOutputPath = join(temporaryDirectory, "explicit-report.md");
  await writeFile(inputPath, source);

  const stdinResult = spawnSync(
    process.execPath,
    [
      "scripts/generate-inferred-player-report.mjs",
      "--input",
      "-",
      "--output",
      stdinOutputPath,
    ],
    { cwd: new URL("..", import.meta.url), encoding: "utf8", input: source },
  );
  assert.equal(stdinResult.status, 0, stdinResult.stderr);

  const explicitResult = spawnSync(
    process.execPath,
    [
      "scripts/generate-inferred-player-report.mjs",
      "--input",
      inputPath,
      "--output",
      explicitOutputPath,
    ],
    { cwd: new URL("..", import.meta.url), encoding: "utf8" },
  );
  assert.equal(explicitResult.status, 0, explicitResult.stderr);

  const expected = generateInferredPlayerReport(dataset());
  assert.equal(await readFile(stdinOutputPath, "utf8"), expected);
  assert.equal(await readFile(explicitOutputPath, "utf8"), expected);
});

test("keeps the committed actual report statistics and row count aligned", async () => {
  const abilityDataset = JSON.parse(
    await readFile(
      new URL(
        "../data/world-cup-2026-player-abilities.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const report = await readFile(
    new URL("../docs/inferred-player-abilities.md", import.meta.url),
    "utf8",
  );
  assert.equal(report, generateInferredPlayerReport(abilityDataset));
  assert.match(report, /총 추정 선수: \*\*323명\*\*/);
  assert.match(report, /PlayerElo 사용: \*\*281명\*\*/);
  assert.match(report, /PlayerElo 미사용: \*\*42명\*\*/);
  assert.equal((report.match(/^\| \d+ \|/gm) ?? []).length, 323);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_SIMULATION_DURATION_MS,
  SIMULATION_TICK_MS,
  compileSimulation,
  eventsBetween,
  sampleSimulation,
  summarizeSimulation,
} from "../lib/simulation-core.js";
import {
  applyPlayerTacticalRolePreset,
  createDefaultPlayerTacticalRole,
  customizePlayerTacticalRole,
} from "../lib/player-tactical-role.js";
import { PITCH_BOUNDS } from "../lib/tactics-core.js";

const defaultAbilities = {
  speed: 72,
  acceleration: 74,
  sprintSpeed: 76,
  agility: 73,
  stamina: 78,
  passing: 75,
  ballControl: 75,
  attacking: 70,
  defending: 70,
  positioning: 72,
  reactions: 74,
  decisionMaking: 73,
};

const homeLayout = [
  ["gk", "GK", 50, 91],
  ["lb", "LB", 15, 73],
  ["lcb", "LCB", 38, 76],
  ["rcb", "RCB", 62, 76],
  ["rb", "RB", 85, 73],
  ["dm", "DM", 50, 60],
  ["lcm", "LCM", 34, 49],
  ["rcm", "RCM", 66, 49],
  ["lw", "LW", 18, 28],
  ["st", "ST", 50, 24],
  ["rw", "RW", 82, 28],
];

function createPlayers({
  homeOverrides = {},
  awayOverrides = {},
  moveAwayFromPassLane = false,
} = {}) {
  const home = homeLayout.map(([suffix, role, x, y]) => {
    const id = `home:${suffix}`;
    return {
      id,
      team: "home",
      role,
      position: { x, y },
      abilities: { ...defaultAbilities },
      ...(homeOverrides[id] ?? {}),
    };
  });
  const away = homeLayout.map(([suffix, role, x, y]) => {
    const id = `away:${suffix}`;
    return {
      id,
      team: "away",
      role,
      position: {
        x: moveAwayFromPassLane && role !== "GK" ? Math.max(68, 100 - x) : 100 - x,
        y: 100 - y,
      },
      abilities: { ...defaultAbilities },
      ...(awayOverrides[id] ?? {}),
    };
  });
  return [...home, ...away];
}

function createScenario(overrides = {}) {
  return {
    durationMs: 2_000,
    players: createPlayers(),
    initialBallOwnerId: "home:st",
    manualRoutes: [
      {
        playerId: "home:st",
        startAtMs: 0,
        waypoints: [
          { x: 40, y: 36 },
          { x: 62, y: 36 },
        ],
      },
    ],
    passes: [],
    ...overrides,
  };
}

function createInstructionScenario(instructions, overrides = {}) {
  return createScenario({
    ...overrides,
    manualRoutes: undefined,
    passes: undefined,
    instructions,
  });
}

function createSequenceScenario(sequences, overrides = {}) {
  return createScenario({
    ...overrides,
    manualRoutes: undefined,
    passes: undefined,
    sequences,
  });
}

function createTwoSequencePlan(passOverrides = {}) {
  return [
    {
      id: "sequence-build-up",
      order: 1,
      name: "전개 시작",
      instructions: [
        {
          id: "pass-a-b",
          order: 0,
          type: "pass",
          playerId: "home:st",
          targetPlayerId: "home:lcm",
          atMs: 0,
          ...passOverrides,
        },
        {
          id: "move-d",
          order: 1,
          type: "move",
          playerId: "home:lw",
          atMs: 0,
          waypoints: [{ x: 19, y: 27 }],
        },
      ],
    },
    {
      id: "sequence-runs",
      order: 2,
      name: "침투",
      instructions: [
        {
          id: "move-c",
          order: 0,
          type: "move",
          playerId: "home:rcm",
          atMs: 0,
          waypoints: [{ x: 65, y: 48 }],
        },
        {
          id: "move-e",
          order: 1,
          type: "move",
          playerId: "home:rw",
          atMs: 0,
          waypoints: [{ x: 84, y: 26 }],
        },
      ],
    },
  ];
}

function allEvents(run) {
  return run.frames.flatMap((frame) => frame.events);
}

function createSuccessfulPassScenario() {
  return createScenario({
    durationMs: 2_000,
    players: createPlayers({
      moveAwayFromPassLane: true,
      homeOverrides: {
        "home:st": { position: { x: 10, y: 62 } },
        "home:lcm": { position: { x: 10, y: 42 } },
      },
    }),
    initialBallOwnerId: "home:st",
    manualRoutes: [
      {
        playerId: "home:st",
        startAtMs: 0,
        waypoints: [{ x: 10, y: 62 }],
      },
      {
        playerId: "home:lcm",
        startAtMs: 0,
        waypoints: [{ x: 10, y: 42 }],
      },
    ],
    passes: [
      {
        id: "pass-success",
        fromPlayerId: "home:st",
        toPlayerId: "home:lcm",
        atMs: 0,
      },
    ],
  });
}

function pointIsOnManualRoute(position, tolerance = 1e-6) {
  const start = { x: 50, y: 24 };
  const corner = { x: 40, y: 36 };
  const finish = { x: 62, y: 36 };
  const firstCrossProduct =
    (position.x - start.x) * (corner.y - start.y) -
    (position.y - start.y) * (corner.x - start.x);
  const onFirst =
    Math.abs(firstCrossProduct) <= tolerance &&
    position.x <= start.x + tolerance &&
    position.x >= corner.x - tolerance &&
    position.y >= start.y - tolerance &&
    position.y <= corner.y + tolerance;
  const onSecond =
    Math.abs(position.y - corner.y) <= tolerance &&
    position.x >= corner.x - tolerance &&
    position.x <= finish.x + tolerance;
  return onFirst || onSecond;
}

test("compiles exactly 22 bounded players at deterministic 50ms ticks", () => {
  const scenario = createScenario();
  const first = compileSimulation(scenario);
  const second = compileSimulation(scenario);

  assert.equal(first.tickMs, SIMULATION_TICK_MS);
  assert.equal(first.frames.length, scenario.durationMs / SIMULATION_TICK_MS + 1);
  assert.deepEqual(first, second);

  for (const frame of first.frames) {
    assert.equal(Object.keys(frame.players).length, 22);
    for (const player of Object.values(frame.players)) {
      assert.ok(Number.isFinite(player.position.x));
      assert.ok(Number.isFinite(player.position.y));
      assert.ok(
        player.position.x >= PITCH_BOUNDS.minX &&
          player.position.x <= PITCH_BOUNDS.maxX,
      );
      assert.ok(
        player.position.y >= PITCH_BOUNDS.minY &&
          player.position.y <= PITCH_BOUNDS.maxY,
      );
    }
    assert.ok(
      frame.ball.position.x >= PITCH_BOUNDS.minX &&
        frame.ball.position.x <= PITCH_BOUNDS.maxX,
    );
    assert.ok(
      frame.ball.position.y >= PITCH_BOUNDS.minY &&
        frame.ball.position.y <= PITCH_BOUNDS.maxY,
    );
  }
});

test("keeps edge-seeking players and the ball inside render-safe bounds", () => {
  const run = compileSimulation(
    createScenario({
      players: createPlayers({
        homeOverrides: {
          "home:st": { position: { x: 0, y: 100 } },
        },
      }),
      initialBallOwnerId: undefined,
      initialBallPosition: { x: 100, y: 0 },
      manualRoutes: [
        {
          playerId: "home:st",
          startAtMs: 0,
          waypoints: [{ x: 0, y: 100 }],
        },
      ],
    }),
  );

  for (const frame of run.frames) {
    for (const player of Object.values(frame.players)) {
      assert.ok(
        player.position.x >= PITCH_BOUNDS.minX &&
          player.position.x <= PITCH_BOUNDS.maxX,
      );
      assert.ok(
        player.position.y >= PITCH_BOUNDS.minY &&
          player.position.y <= PITCH_BOUNDS.maxY,
      );
    }
    assert.ok(
      frame.ball.position.x >= PITCH_BOUNDS.minX &&
        frame.ball.position.x <= PITCH_BOUNDS.maxX,
    );
    assert.ok(
      frame.ball.position.y >= PITCH_BOUNDS.minY &&
        frame.ball.position.y <= PITCH_BOUNDS.maxY,
    );
  }
});

test("preserves the exact manual route while ability values control travel time", () => {
  const fastScenario = createScenario({ durationMs: 6_000 });
  const slowScenario = createScenario({
    durationMs: 6_000,
    players: createPlayers({
      homeOverrides: {
        "home:st": {
          abilities: {
            ...defaultAbilities,
            acceleration: 15,
            sprintSpeed: 20,
            agility: 20,
          },
        },
      },
    }),
  });
  const fast = compileSimulation(fastScenario);
  const slow = compileSimulation(slowScenario);

  for (const frame of fast.frames) {
    assert.ok(
      pointIsOnManualRoute(frame.players["home:st"].position),
      `manual route drifted at ${frame.elapsedMs}ms`,
    );
    assert.equal(frame.players["home:st"].mode, "manual");
    assert.equal(frame.players["home:st"].behavior, "manual");
  }

  assert.ok(
    fast.frames.some(
      (frame) =>
        frame.players["home:st"].position.x > 40 &&
        Math.abs(frame.players["home:st"].position.y - 36) <= 1e-6,
    ),
    "the player must traverse the second segment after the waypoint",
  );
  assert.ok(fast.frames.at(-1).players["home:st"].arrived);
  assert.equal(fast.frames.at(-1).players["home:st"].routeRemainingM, 0);
  assert.ok(
    fast.frames.at(-1).players["home:st"].distanceM >
      slow.frames.at(-1).players["home:st"].distanceM,
  );
});

test("does not complete a short delayed route before its start tick", () => {
  const run = compileSimulation(
    createScenario({
      durationMs: 1_000,
      manualRoutes: [
        {
          playerId: "home:st",
          startAtMs: 500,
          waypoints: [{ x: 50.05, y: 24 }],
        },
      ],
    }),
  );
  const beforeStart = run.frames.find((frame) => frame.elapsedMs === 450);
  const startFrame = run.frames.find((frame) => frame.elapsedMs === 500);
  const completedFrame = run.frames.find((frame) => frame.elapsedMs === 550);

  assert.equal(beforeStart.players["home:st"].arrived, false);
  assert.equal(startFrame.players["home:st"].arrived, false);
  assert.deepEqual(startFrame.players["home:st"].position, { x: 50, y: 24 });
  assert.equal(completedFrame.players["home:st"].arrived, true);
  assert.equal(completedFrame.players["home:st"].arrivedAtMs, 550);
  assert.deepEqual(completedFrame.players["home:st"].position, {
    x: 50.05,
    y: 24,
  });
});

test("keeps legacy routes compatible with canonical move instructions", () => {
  const legacy = compileSimulation(createScenario());
  const canonical = compileSimulation(
    createInstructionScenario([
      {
        id: "move-st",
        order: 0,
        type: "move",
        playerId: "home:st",
        atMs: 0,
        waypoints: [
          { x: 40, y: 36 },
          { x: 62, y: 36 },
        ],
      },
    ]),
  );

  assert.deepEqual(canonical, legacy);
});

test("sorts canonical instructions independently of their input array order", () => {
  const instructions = [
    {
      id: "carry-before-pass",
      order: 0,
      type: "carry",
      playerId: "home:st",
      atMs: 0,
      waypoints: [{ x: 50, y: 24 }],
    },
    {
      id: "pass-after-carry",
      order: 1,
      type: "pass",
      playerId: "home:st",
      targetPlayerId: "home:lcm",
      atMs: 0,
    },
    {
      id: "move-lcm",
      order: 2,
      type: "move",
      playerId: "home:lcm",
      atMs: 500,
      waypoints: [{ x: 30, y: 44 }],
    },
  ];

  const ordered = compileSimulation(
    createInstructionScenario(instructions, { durationMs: 2_000 }),
  );
  const shuffled = compileSimulation(
    createInstructionScenario(instructions.toReversed(), {
      durationMs: 2_000,
    }),
  );

  assert.deepEqual(shuffled, ordered);
  assert.equal(
    allEvents(ordered).some(
      (event) => event.type === "instruction_cancelled",
    ),
    false,
  );
});

test("starts the next sequence from the exact completed state of the prior sequence", () => {
  const run = compileSimulation(
    createSequenceScenario(createTwoSequencePlan(), {
      durationMs: 4_000,
      players: createPlayers({
        moveAwayFromPassLane: true,
        homeOverrides: {
          "home:st": { position: { x: 10, y: 62 } },
          "home:lcm": { position: { x: 10, y: 42 } },
        },
      }),
    }),
  );
  const [first, second] = run.sequenceTimeline;

  assert.equal(first.status, "completed");
  assert.equal(second.status, "completed");
  assert.equal(first.completedAtMs, second.startedAtMs);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(first.endSnapshot.players).map(([id, player]) => [
        id,
        player.position,
      ]),
    ),
    Object.fromEntries(
      Object.entries(second.startSnapshot.players).map(([id, player]) => [
        id,
        player.position,
      ]),
    ),
  );
  assert.deepEqual(first.endSnapshot.ball, second.startSnapshot.ball);
  assert.notDeepEqual(
    second.startSnapshot.players["home:rcm"].position,
    run.frames[0].players["home:rcm"].position,
  );
  assert.ok(
    allEvents(run).some(
      (event) =>
        event.type === "sequence_started" &&
        event.sequenceId === second.id &&
        event.atMs === first.completedAtMs,
    ),
  );
});

test("treats a failed instruction as terminal before advancing", () => {
  const run = compileSimulation(
    createSequenceScenario(
      createTwoSequencePlan({
        playerId: "home:lcm",
        targetPlayerId: "home:rcm",
      }),
      { durationMs: 4_000 },
    ),
  );
  const [first, second] = run.sequenceTimeline;
  const cancellation = allEvents(run).find(
    (event) =>
      event.type === "pass_cancelled" && event.passId === "pass-a-b",
  );

  assert.equal(cancellation.atMs, 0);
  assert.equal(first.status, "completed");
  assert.equal(first.completedAtMs, second.startedAtMs);
  assert.ok(second.startedAtMs > cancellation.atMs);
});

test("applies an instruction offset relative to the actual sequence start", () => {
  const run = compileSimulation(
    createSequenceScenario(
      [
        {
          id: "sequence-one",
          order: 1,
          name: "첫 구간",
          instructions: [
            {
              id: "opening-move",
              order: 0,
              type: "move",
              playerId: "home:st",
              atMs: 0,
              waypoints: [{ x: 50, y: 23 }],
            },
          ],
        },
        {
          id: "sequence-two",
          order: 2,
          name: "두 번째 구간",
          instructions: [
            {
              id: "offset-pass",
              order: 0,
              type: "pass",
              playerId: "home:st",
              targetPlayerId: "home:lcm",
              atMs: 200,
            },
          ],
        },
      ],
      { durationMs: 1_500 },
    ),
  );
  const passStarted = allEvents(run).find(
    (event) => event.type === "pass_started",
  );
  const second = run.sequenceTimeline[1];

  assert.ok(second.startedAtMs > 0);
  assert.equal(passStarted.atMs, second.startedAtMs + 200);
});

test("compiles shuffled sequence groups to the same deterministic run", () => {
  const sequences = createTwoSequencePlan();
  const shuffled = sequences
    .toReversed()
    .map((sequence) => ({
      ...sequence,
      instructions: sequence.instructions.toReversed(),
    }));
  const scenarioOptions = {
    durationMs: 2_000,
    players: createPlayers({ moveAwayFromPassLane: true }),
  };

  assert.deepEqual(
    compileSimulation(createSequenceScenario(shuffled, scenarioOptions)),
    compileSimulation(createSequenceScenario(sequences, scenarioOptions)),
  );
});

test("keeps a single sequence physically compatible with flat instructions", () => {
  const instructions = [
    {
      id: "flat-move",
      order: 0,
      type: "move",
      playerId: "home:st",
      atMs: 0,
      waypoints: [{ x: 40, y: 36 }],
    },
    {
      id: "flat-pass",
      order: 1,
      type: "pass",
      playerId: "home:st",
      targetPlayerId: "home:lcm",
      atMs: 500,
    },
  ];
  const flat = compileSimulation(
    createInstructionScenario(instructions, { durationMs: 2_000 }),
  );
  const grouped = compileSimulation(
    createSequenceScenario(
      [
        {
          id: "migrated-sequence",
          order: 1,
          name: "기본 시퀀스",
          instructions,
        },
      ],
      { durationMs: 2_000 },
    ),
  );

  assert.deepEqual(
    grouped.frames.map((frame) => ({
      players: frame.players,
      ball: frame.ball,
      metrics: frame.metrics,
    })),
    flat.frames.map((frame) => ({
      players: frame.players,
      ball: frame.ball,
      metrics: frame.metrics,
    })),
  );
  assert.equal(grouped.sequenceTimeline[0].startedAtMs, 0);
});

test("rejects invalid sequence order, offsets, and duplicate references", () => {
  const valid = createTwoSequencePlan();

  assert.throws(
    () =>
      compileSimulation(
        createScenario({
          sequences: valid,
        }),
      ),
    /either sequences or instructions\/legacy/,
  );
  assert.throws(
    () =>
      compileSimulation(
        createSequenceScenario([
          { ...valid[0], order: 1 },
          { ...valid[1], order: 1 },
        ]),
      ),
    /order must be 2 after ordering/,
  );
  assert.throws(
    () =>
      compileSimulation(
        createSequenceScenario([
          {
            ...valid[0],
            instructions: [
              { ...valid[0].instructions[0], atMs: 25 },
            ],
          },
          valid[1],
        ]),
      ),
    /simulation tick offset/,
  );
  assert.throws(
    () =>
      compileSimulation(
        createSequenceScenario([
          valid[0],
          {
            ...valid[1],
            instructions: [
              { ...valid[1].instructions[0], id: "pass-a-b" },
            ],
          },
        ]),
      ),
    /Duplicate instruction id/,
  );
  assert.throws(
    () =>
      compileSimulation(
        createSequenceScenario([
          valid[0],
          { ...valid[1], id: valid[0].id },
        ]),
      ),
    /Duplicate sequence id/,
  );
  assert.throws(
    () =>
      compileSimulation(
        createSequenceScenario(
          [
            {
              ...valid[0],
              instructions: [
                { ...valid[0].instructions[0], atMs: 2_000 },
              ],
            },
          ],
          { durationMs: 2_000 },
        ),
      ),
    /execute inside the simulation/,
  );
});

test("times out the active sequence and keeps later sequences waiting", () => {
  const run = compileSimulation(
    createSequenceScenario(
      [
        {
          id: "long-sequence",
          order: 1,
          name: "긴 이동",
          instructions: [
            {
              id: "long-run",
              order: 0,
              type: "move",
              playerId: "home:st",
              atMs: 0,
              waypoints: [{ x: 10, y: 90 }],
            },
          ],
        },
        {
          id: "waiting-sequence",
          order: 2,
          name: "대기",
          instructions: [],
        },
      ],
      { durationMs: 500 },
    ),
  );

  assert.equal(run.sequenceTimeline[0].status, "timed_out");
  assert.equal(run.sequenceTimeline[1].status, "waiting");
  assert.ok(
    allEvents(run).some((event) => event.type === "sequence_timed_out"),
  );
});

test("dispatches a later motion at its own tick after the prior route completes", () => {
  const run = compileSimulation(
    createInstructionScenario(
      [
        {
          id: "settle",
          order: 0,
          type: "move",
          playerId: "home:st",
          atMs: 0,
          waypoints: [{ x: 50.05, y: 24 }],
        },
        {
          id: "second-run",
          order: 1,
          type: "move",
          playerId: "home:st",
          atMs: 500,
          waypoints: [{ x: 60, y: 24 }],
        },
      ],
      { durationMs: 1_000 },
    ),
  );
  const beforeDispatch = run.frames.find((frame) => frame.elapsedMs === 450);
  const dispatchFrame = run.frames.find((frame) => frame.elapsedMs === 500);
  const afterDispatch = run.frames.find((frame) => frame.elapsedMs === 550);

  assert.deepEqual(beforeDispatch.players["home:st"].position, {
    x: 50.05,
    y: 24,
  });
  assert.deepEqual(
    dispatchFrame.players["home:st"].position,
    beforeDispatch.players["home:st"].position,
  );
  assert.ok(afterDispatch.players["home:st"].position.x > 50.05);
});

test("cancels an overlapping motion instead of replacing its active route", () => {
  const run = compileSimulation(
    createInstructionScenario(
      [
        {
          id: "long-run",
          order: 0,
          type: "move",
          playerId: "home:st",
          atMs: 0,
          waypoints: [{ x: 10, y: 24 }],
        },
        {
          id: "overlap",
          order: 1,
          type: "move",
          playerId: "home:st",
          atMs: 50,
          waypoints: [{ x: 90, y: 24 }],
        },
      ],
      { durationMs: 1_000 },
    ),
  );
  const cancellation = allEvents(run).find(
    (event) =>
      event.type === "instruction_cancelled" &&
      event.instructionId === "overlap",
  );

  assert.deepEqual(cancellation, {
    type: "instruction_cancelled",
    instructionId: "overlap",
    instructionType: "move",
    playerId: "home:st",
    atMs: 50,
    reason: "player_busy",
  });
  assert.ok(run.frames.at(-1).players["home:st"].position.x < 50);
});

test("requires possession for carry instructions and keeps a valid carry on the ball", () => {
  const cancelledRun = compileSimulation(
    createInstructionScenario(
      [
        {
          id: "invalid-carry",
          order: 0,
          type: "carry",
          playerId: "home:lcm",
          atMs: 0,
          waypoints: [{ x: 34, y: 35 }],
        },
      ],
      { durationMs: 1_000 },
    ),
  );
  const cancellation = allEvents(cancelledRun).find(
    (event) => event.type === "instruction_cancelled",
  );

  assert.equal(cancellation.instructionId, "invalid-carry");
  assert.equal(cancellation.reason, "no_possession");
  assert.deepEqual(
    cancelledRun.frames.at(-1).players["home:lcm"].position,
    cancelledRun.frames[0].players["home:lcm"].position,
  );

  const carryRun = compileSimulation(
    createInstructionScenario(
      [
        {
          id: "valid-carry",
          order: 0,
          type: "carry",
          playerId: "home:st",
          atMs: 0,
          waypoints: [{ x: 50, y: 16 }],
        },
      ],
      { durationMs: 1_000 },
    ),
  );

  for (const frame of carryRun.frames) {
    assert.equal(frame.ball.kind, "controlled");
    assert.equal(frame.ball.ownerId, "home:st");
    assert.deepEqual(frame.ball.position, frame.players["home:st"].position);
  }
});

test("moves unassigned home support and assigns away pressure, cover, block, and goalkeeper reactions", () => {
  const run = compileSimulation(createScenario());
  const initial = run.frames[0];
  const final = run.frames.at(-1);

  assert.ok(final.players["home:lcm"].distanceM > 0);
  assert.equal(final.players["home:lcm"].mode, "automatic");
  assert.ok(
    Object.values(final.players)
      .filter((player) => player.team === "away")
      .some((player) => player.behavior === "pressure"),
  );
  assert.ok(
    Object.values(final.players)
      .filter((player) => player.team === "away")
      .some((player) => player.behavior === "cover"),
  );
  assert.ok(
    Object.values(final.players)
      .filter((player) => player.team === "away")
      .some((player) => player.behavior === "block"),
  );
  assert.equal(final.players["away:gk"].behavior, "goalkeeper-reaction");
  assert.notDeepEqual(
    final.players["away:gk"].position,
    initial.players["away:gk"].position,
  );
});

test("turns fullback overlap and underlap presets into distinct bounded lanes", () => {
  const compileFullback = (presetId) =>
    compileSimulation(
      createScenario({
        players: createPlayers({
          homeOverrides: {
            "home:lb": {
              tacticalRole: applyPlayerTacticalRolePreset("LB", presetId),
            },
          },
        }),
      }),
    );
  const overlap = compileFullback("fullback-overlap").frames.find(
    (frame) => frame.elapsedMs === 250,
  ).players["home:lb"];
  const underlap = compileFullback("fullback-underlap").frames.find(
    (frame) => frame.elapsedMs === 250,
  ).players["home:lb"];

  assert.equal(overlap.behavior, "overlap");
  assert.equal(underlap.behavior, "underlap");
  assert.ok(overlap.target.x < underlap.target.x);
  assert.ok(overlap.target.y < 73);
  assert.ok(underlap.target.y < 73);
});

test("keeps automatic targets inside configured lateral and vertical activity ranges", () => {
  const constrainedRole = customizePlayerTacticalRole(
    createDefaultPlayerTacticalRole("RCM"),
    {
      preferredZone: "wide",
      lateralRange: "low",
      verticalRange: "low",
    },
  );
  const run = compileSimulation(
    createScenario({
      players: createPlayers({
        homeOverrides: {
          "home:rcm": { tacticalRole: constrainedRole },
        },
      }),
    }),
  );
  const target = run.frames.find((frame) => frame.elapsedMs === 250).players[
    "home:rcm"
  ].target;

  assert.ok(Math.abs(target.x - 66) <= (5 / 68) * 100 + 1e-6);
  assert.ok(Math.abs(target.y - 49) <= (7 / 105) * 100 + 1e-6);
});

test("selects ball-carrier actions from fixed role preferences and pitch context", () => {
  const compileOwner = (ownerId, tacticalRole) =>
    compileSimulation(
      createScenario({
        durationMs: 500,
        players: createPlayers({
          homeOverrides: { [ownerId]: { tacticalRole } },
        }),
        initialBallOwnerId: ownerId,
        manualRoutes: [],
      }),
    ).frames.find((frame) => frame.elapsedMs === 250).players[ownerId]
      .behavior;

  assert.equal(
    compileOwner(
      "home:st",
      applyPlayerTacticalRolePreset("ST", "striker-advanced"),
    ),
    "ball-carrier-shoot",
  );
  assert.equal(
    compileOwner(
      "home:rw",
      applyPlayerTacticalRolePreset("RW", "wide-touchline"),
    ),
    "ball-carrier-cross",
  );
  assert.equal(
    compileOwner(
      "home:lcm",
      applyPlayerTacticalRolePreset("LCM", "midfield-playmaker"),
    ),
    "ball-carrier-pass",
  );
});

test("uses pressing preference in deterministic pressure assignment", () => {
  const lowPress = customizePlayerTacticalRole(
    createDefaultPlayerTacticalRole("LB"),
    { pressing: "low", verticalRange: "high" },
  );
  const highPress = customizePlayerTacticalRole(
    createDefaultPlayerTacticalRole("LCM"),
    { pressing: "high", verticalRange: "high" },
  );
  const run = compileSimulation(
    createScenario({
      durationMs: 600,
      players: createPlayers({
        homeOverrides: {
          "home:lb": {
            position: { x: 50, y: 72 },
            tacticalRole: lowPress,
          },
          "home:lcm": {
            position: { x: 50, y: 65 },
            tacticalRole: highPress,
          },
        },
      }),
      initialBallOwnerId: "away:st",
      manualRoutes: [],
    }),
  );
  const decision = run.frames.find((frame) => frame.elapsedMs === 300);

  assert.equal(decision.players["home:lcm"].behavior, "pressure");
  assert.notEqual(decision.players["home:lb"].behavior, "pressure");
});

test("keeps explicit movement instructions above persistent player roles", () => {
  const run = compileSimulation(
    createScenario({
      players: createPlayers({
        homeOverrides: {
          "home:st": {
            tacticalRole: applyPlayerTacticalRolePreset(
              "ST",
              "striker-advanced",
            ),
          },
        },
      }),
    }),
  );

  assert.equal(run.frames[1].players["home:st"].mode, "manual");
  assert.equal(run.frames[1].players["home:st"].behavior, "manual");
  assert.ok(
    run.frames.at(-1).players["home:st"].distanceM > 0,
  );
});

test("rejects a tactical role that does not match the player formation role", () => {
  const players = createPlayers({
    homeOverrides: {
      "home:lcb": {
        tacticalRole: applyPlayerTacticalRolePreset(
          "LB",
          "fullback-overlap",
        ),
      },
    },
  });

  assert.throws(
    () => compileSimulation(createScenario({ players })),
    /does not match the formation role group/,
  );
});

test("updates automatic tactical targets independently from 50ms physics ticks", () => {
  const run = compileSimulation(createScenario());
  const decisionFrame = run.frames.find((frame) => frame.elapsedMs === 300);
  const pressurePlayer = Object.values(decisionFrame.players).find(
    (player) => player.team === "away" && player.behavior === "pressure",
  );
  assert.ok(pressurePlayer);

  const heldTargets = run.frames
    .filter(
      (frame) => frame.elapsedMs >= 300 && frame.elapsedMs <= 500,
    )
    .map((frame) => frame.players[pressurePlayer.id].target);

  assert.ok(
    run.frames.find((frame) => frame.elapsedMs === 500).players[
      pressurePlayer.id
    ].distanceM > decisionFrame.players[pressurePlayer.id].distanceM,
  );
  assert.ok(
    heldTargets.every(
      (target) => JSON.stringify(target) === JSON.stringify(heldTargets[0]),
    ),
  );
});

test("does not refresh existing opponent decisions at a sequence boundary", () => {
  const sequences = [
    {
      id: "sequence-one",
      order: 1,
      name: "첫 구간",
      instructions: [
        {
          id: "short-move-one",
          order: 0,
          type: "move",
          playerId: "home:st",
          atMs: 0,
          waypoints: [{ x: 50.05, y: 24 }],
        },
      ],
    },
    {
      id: "sequence-two",
      order: 2,
      name: "두 번째 구간",
      instructions: [
        {
          id: "short-move-two",
          order: 0,
          type: "move",
          playerId: "home:lcm",
          atMs: 0,
          waypoints: [{ x: 34.05, y: 49 }],
        },
      ],
    },
  ];
  const run = compileSimulation(
    createSequenceScenario(sequences, { durationMs: 500 }),
  );
  const boundaryAtMs = run.sequenceTimeline[0].completedAtMs;
  const boundaryFrame = run.frames.find(
    (frame) => frame.elapsedMs === boundaryAtMs,
  );
  const nextFrame = run.frames.find(
    (frame) => frame.elapsedMs === boundaryAtMs + SIMULATION_TICK_MS,
  );

  assert.equal(boundaryAtMs, run.sequenceTimeline[1].startedAtMs);
  for (const player of Object.values(boundaryFrame.players).filter(
    (candidate) => candidate.team === "away",
  )) {
    assert.deepEqual(nextFrame.players[player.id].target, player.target);
    assert.equal(nextFrame.players[player.id].behavior, player.behavior);
  }
});

test("moves an independent pass to its receiver and summarizes the reception", () => {
  const run = compileSimulation(createSuccessfulPassScenario());
  const events = allEvents(run);
  const inFlightFrames = run.frames.filter(
    (frame) => frame.ball.kind === "inFlight",
  );

  assert.ok(inFlightFrames.length > 1);
  assert.notDeepEqual(
    inFlightFrames[0].ball.position,
    inFlightFrames.at(-1).ball.position,
  );
  assert.ok(events.some((event) => event.type === "pass_received"));
  assert.equal(run.frames.at(-1).ball.kind, "controlled");
  assert.equal(run.frames.at(-1).ball.ownerId, "home:lcm");
  assert.deepEqual(summarizeSimulation(run).passes, {
    attempted: 1,
    received: 1,
    intercepted: 0,
    incomplete: 0,
    cancelled: 0,
    recovered: 0,
  });
});

test("resolves a defender on the pass lane as a deterministic interception", () => {
  const players = createPlayers({
    homeOverrides: {
      "home:st": { position: { x: 50, y: 68 } },
      "home:lcm": { position: { x: 50, y: 34 } },
    },
    awayOverrides: {
      "away:dm": {
        position: { x: 50, y: 51 },
        abilities: {
          ...defaultAbilities,
          defending: 95,
          reactions: 95,
        },
      },
    },
  });
  const run = compileSimulation(
    createScenario({
      durationMs: 2_000,
      players,
      initialBallOwnerId: "home:st",
      manualRoutes: [
        {
          playerId: "home:st",
          startAtMs: 0,
          waypoints: [{ x: 50, y: 68 }],
        },
        {
          playerId: "home:lcm",
          startAtMs: 0,
          waypoints: [{ x: 50, y: 34 }],
        },
      ],
      passes: [
        {
          id: "pass-intercepted",
          fromPlayerId: "home:st",
          toPlayerId: "home:lcm",
          atMs: 0,
        },
      ],
    }),
  );
  const interception = allEvents(run).find(
    (event) => event.type === "pass_intercepted",
  );

  assert.equal(interception.playerId, "away:dm");
  assert.equal(run.frames.at(-1).ball.kind, "controlled");
  assert.equal(run.frames.at(-1).ball.ownerId, "away:dm");
  assert.equal(run.frames.at(-1).players["away:dm"].behavior, "ball-carrier");
  assert.ok(
    Object.values(run.frames.at(-1).players)
      .filter(
        (player) =>
          player.team === "home" && player.mode === "automatic",
      )
      .some((player) => player.behavior === "pressure"),
  );
  assert.ok(
    Object.values(run.frames.at(-1).players)
      .filter(
        (player) =>
          player.team === "away" && player.id !== "away:dm",
      )
      .some((player) => player.behavior === "support"),
  );
  assert.equal(summarizeSimulation(run).passes.intercepted, 1);
});

test("recovers an incomplete loose ball by distance and stable player id", () => {
  const stationaryRecoveryAbilities = {
    ...defaultAbilities,
    ballControl: 100,
    reactions: 100,
  };
  const run = compileSimulation(
    createScenario({
      durationMs: 2_000,
      players: createPlayers({
        moveAwayFromPassLane: true,
        homeOverrides: {
          "home:st": { position: { x: 10, y: 62 } },
          "home:lcm": {
            position: { x: 10, y: 42 },
            abilities: { ...defaultAbilities, ballControl: 0 },
          },
          "home:lb": {
            position: { x: 8.2, y: 42 },
            abilities: stationaryRecoveryAbilities,
          },
          "home:rcm": {
            position: { x: 11.8, y: 42 },
            abilities: stationaryRecoveryAbilities,
          },
        },
      }),
      initialBallOwnerId: "home:st",
      manualRoutes: [
        {
          playerId: "home:st",
          startAtMs: 0,
          waypoints: [{ x: 10, y: 62 }],
        },
        {
          playerId: "home:lcm",
          startAtMs: 0,
          waypoints: [{ x: 30, y: 42 }],
        },
        {
          playerId: "home:lb",
          startAtMs: 0,
          waypoints: [{ x: 8.2, y: 42 }],
        },
        {
          playerId: "home:rcm",
          startAtMs: 0,
          waypoints: [{ x: 11.8, y: 42 }],
        },
      ],
      passes: [
        {
          id: "pass-loose",
          fromPlayerId: "home:st",
          toPlayerId: "home:lcm",
          atMs: 0,
        },
      ],
    }),
  );
  const events = allEvents(run);
  const incomplete = events.find((event) => event.type === "pass_incomplete");
  const recovery = events.find((event) => event.type === "ball_recovered");

  assert.ok(incomplete);
  assert.ok(recovery.atMs > incomplete.atMs);
  assert.equal(recovery.playerId, "home:lb");
  assert.equal(run.frames.at(-1).ball.kind, "controlled");
  assert.equal(run.frames.at(-1).ball.ownerId, "home:lb");
  assert.equal(summarizeSimulation(run).passes.recovered, 1);
});

test("cancels a pass when the instructed passer has no possession", () => {
  const run = compileSimulation(
    createScenario({
      passes: [
        {
          id: "invalid-owner",
          fromPlayerId: "home:lcm",
          toPlayerId: "home:rcm",
          atMs: 0,
        },
      ],
    }),
  );
  const cancellation = allEvents(run).find(
    (event) => event.type === "pass_cancelled",
  );

  assert.equal(cancellation.passId, "invalid-owner");
  assert.equal(cancellation.reason, "no_possession");
  assert.equal(summarizeSimulation(run).passes.cancelled, 1);
});

test("starts a deterministic loose ball at a user-defined pitch position", () => {
  const scenario = createScenario({
    initialBallOwnerId: undefined,
    initialBallPosition: { x: 27, y: 63 },
    manualRoutes: [],
  });
  const first = compileSimulation(scenario);
  const second = compileSimulation(scenario);

  assert.equal(first.frames[0].ball.kind, "loose");
  assert.deepEqual(first.frames[0].ball.position, { x: 27, y: 63 });
  assert.deepEqual(first, second);
});

test("requires exactly one initial ball source", () => {
  assert.throws(
    () =>
      compileSimulation(
        createScenario({
          initialBallPosition: { x: 50, y: 50 },
        }),
      ),
    /either initialBallOwnerId or initialBallPosition/,
  );
  assert.throws(
    () =>
      compileSimulation(
        createScenario({
          initialBallOwnerId: undefined,
        }),
      ),
    /either initialBallOwnerId or initialBallPosition/,
  );
  assert.throws(
    () =>
      compileSimulation(
        createScenario({
          initialBallOwnerId: undefined,
          initialBallPosition: { x: -1, y: 50 },
        }),
      ),
    /initialBallPosition must stay inside/,
  );
});

test("samples interpolated frames and summarizes distance and shape changes", () => {
  const run = compileSimulation(createScenario());
  const sampled = sampleSimulation(run, 75);
  const summary = summarizeSimulation(run);

  assert.equal(sampled.elapsedMs, 75);
  assert.equal(Object.keys(sampled.players).length, 22);
  assert.ok(
    sampled.players["home:st"].distanceM >
      run.frames[1].players["home:st"].distanceM,
  );
  assert.ok(
    sampled.players["home:st"].distanceM <
      run.frames[2].players["home:st"].distanceM,
  );
  assert.equal(summary.playerCount, 22);
  assert.equal(summary.frameCount, run.frames.length);
  assert.ok(summary.players["home:st"].distanceM > 0);
  assert.ok(Number.isFinite(summary.teams.home.widthChangeM));
  assert.ok(Number.isFinite(summary.teams.away.spacingChangeM));
});

test("returns detached samples and summaries while freezing the compiled run", () => {
  const run = compileSimulation(createScenario());
  const sampled = sampleSimulation(run, 0);
  const summary = summarizeSimulation(run);
  const originalPlayerX = run.frames[0].players["home:st"].position.x;
  const originalWidth = run.frames[0].metrics.teams.home.widthM;

  assert.ok(Object.isFrozen(run));
  assert.ok(Object.isFrozen(run.frames[0].players["home:st"].position));
  assert.notEqual(sampled, run.frames[0]);
  assert.notEqual(
    summary.teams.home.start,
    run.frames[0].metrics.teams.home,
  );

  sampled.players["home:st"].position.x = -10;
  summary.teams.home.start.widthM = -10;
  assert.equal(
    run.frames[0].players["home:st"].position.x,
    originalPlayerX,
  );
  assert.equal(run.frames[0].metrics.teams.home.widthM, originalWidth);
});

test("reads tick events with a cursor even when visual sampling is interpolated", () => {
  const run = compileSimulation(createSuccessfulPassScenario());
  const receivedFrame = run.frames.find((frame) =>
    frame.events.some((event) => event.type === "pass_received"),
  );

  assert.equal(sampleSimulation(run, 25).events.length, 0);
  assert.deepEqual(
    eventsBetween(run, -1, 0)
      .filter((event) => event.type.startsWith("pass_"))
      .map((event) => event.type),
    ["pass_started"],
  );
  assert.deepEqual(
    eventsBetween(run, 0, receivedFrame.elapsedMs).map(
      (event) => event.type,
    ),
    ["pass_received"],
  );
  assert.deepEqual(
    eventsBetween(
      run,
      receivedFrame.elapsedMs,
      run.durationMs,
    ),
    [],
  );
});

test("rejects malformed team, route, and tick inputs", () => {
  assert.throws(
    () => compileSimulation(createScenario({ durationMs: 1_025 })),
    RangeError,
  );
  assert.throws(
    () =>
      compileSimulation(
        createScenario({
          durationMs: MAX_SIMULATION_DURATION_MS + SIMULATION_TICK_MS,
        }),
      ),
    /must not exceed/,
  );
  assert.throws(
    () =>
      compileSimulation(createScenario(), {
        maximumDurationMs: 1_000,
      }),
    /must not exceed/,
  );
  assert.throws(
    () =>
      compileSimulation(createScenario(), {
        automaticDecisionIntervalMs: 225,
      }),
    /automaticDecisionIntervalMs must align/,
  );
  assert.throws(
    () =>
      compileSimulation(
        createScenario({
          players: createPlayers().slice(0, 21),
        }),
      ),
    /exactly 22/,
  );
  assert.throws(
    () =>
      compileSimulation(
        createScenario({
          manualRoutes: [
            {
              playerId: "away:st",
              startAtMs: 0,
              waypoints: [{ x: 50, y: 50 }],
            },
          ],
        }),
      ),
    /Only home players/,
  );
});

test("rejects mixed, opponent, and malformed canonical instructions", () => {
  assert.throws(
    () =>
      compileSimulation(
        createScenario({
          instructions: [],
        }),
      ),
    /either instructions or legacy manualRoutes\/passes/,
  );
  assert.throws(
    () =>
      compileSimulation(
        createInstructionScenario([
          {
            id: "away-move",
            order: 0,
            type: "move",
            playerId: "away:st",
            atMs: 0,
            waypoints: [{ x: 50, y: 50 }],
          },
        ]),
      ),
    /Only home players/,
  );
  assert.throws(
    () =>
      compileSimulation(
        createInstructionScenario([
          {
            id: "away-pass-target",
            order: 0,
            type: "pass",
            playerId: "home:st",
            targetPlayerId: "away:st",
            atMs: 0,
          },
        ]),
      ),
    /Only home-to-home/,
  );
  assert.throws(
    () =>
      compileSimulation(
        createInstructionScenario([
          {
            id: "off-tick",
            order: 0,
            type: "move",
            playerId: "home:st",
            atMs: 25,
            waypoints: [{ x: 50, y: 50 }],
          },
        ]),
      ),
    /must align to a simulation tick/,
  );
  assert.throws(
    () =>
      compileSimulation(
        createInstructionScenario([
          {
            id: "missing-target",
            order: 0,
            type: "pass",
            playerId: "home:st",
            atMs: 0,
          },
        ]),
      ),
    /unknown target player/,
  );
});

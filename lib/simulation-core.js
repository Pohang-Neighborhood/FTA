export const SIMULATION_TICK_MS = 50;
export const MAX_SIMULATION_DURATION_MS = 15_000;

export const DEFAULT_SIMULATION_CONFIG = Object.freeze({
  pitchWidthM: 68,
  pitchLengthM: 105,
  maximumDurationMs: MAX_SIMULATION_DURATION_MS,
  manualArrivalThresholdM: 0.08,
  passBaseSpeedMps: 14,
  passRatingSpeedMps: 0.12,
  looseBallRetentionPerTick: 0.96,
  automaticTargetToleranceM: 0.12,
});

const MINIMUM_PLAYER_COUNT = 22;
const TEAM_PLAYER_COUNT = 11;
const EPSILON = 1e-9;

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function deepClone(value) {
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, deepClone(item)]),
    );
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const item of Object.values(value)) {
    deepFreeze(item);
  }
  return Object.freeze(value);
}

function assertFiniteNumber(value, label) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
}

function assertPoint(point, label) {
  if (!point || typeof point !== "object") {
    throw new TypeError(`${label} must be a point.`);
  }
  assertFiniteNumber(point.x, `${label}.x`);
  assertFiniteNumber(point.y, `${label}.y`);
  if (point.x < 0 || point.x > 100 || point.y < 0 || point.y > 100) {
    throw new RangeError(`${label} must stay inside the normalized pitch.`);
  }
}

function point(x, y) {
  return { x, y };
}

function add(left, right) {
  return point(left.x + right.x, left.y + right.y);
}

function subtract(left, right) {
  return point(left.x - right.x, left.y - right.y);
}

function scale(vector, multiplier) {
  return point(vector.x * multiplier, vector.y * multiplier);
}

function magnitude(vector) {
  return Math.hypot(vector.x, vector.y);
}

function distance(left, right) {
  return magnitude(subtract(left, right));
}

function normalize(vector) {
  const length = magnitude(vector);
  return length <= EPSILON ? point(0, 0) : scale(vector, 1 / length);
}

function lerp(left, right, amount) {
  return point(
    left.x + (right.x - left.x) * amount,
    left.y + (right.y - left.y) * amount,
  );
}

function clampVectorMagnitude(vector, maximum) {
  const length = magnitude(vector);
  if (length <= maximum || length <= EPSILON) {
    return vector;
  }
  return scale(vector, maximum / length);
}

function normalizedToMeters(position, config) {
  return point(
    (position.x / 100) * config.pitchWidthM,
    (position.y / 100) * config.pitchLengthM,
  );
}

function metersToNormalized(position, config) {
  return point(
    clamp((position.x / config.pitchWidthM) * 100, 0, 100),
    clamp((position.y / config.pitchLengthM) * 100, 0, 100),
  );
}

function clampMeters(position, config) {
  return point(
    clamp(position.x, 0, config.pitchWidthM),
    clamp(position.y, 0, config.pitchLengthM),
  );
}

function ability(player, field) {
  const value = player.abilities?.[field];
  if (Number.isFinite(value)) {
    return clamp(value, 0, 100);
  }

  if ((field === "speed" || field === "sprintSpeed") && Number.isFinite(player.pace)) {
    return clamp(player.pace, 0, 100);
  }
  if (field === "passing" && Number.isFinite(player.passing)) {
    return clamp(player.passing, 0, 100);
  }
  if (field === "defending" && Number.isFinite(player.defending)) {
    return clamp(player.defending, 0, 100);
  }
  return 50;
}

function isGoalkeeper(player) {
  return player.role === "GK" || player.position === "GK";
}

function maximumSpeedMps(state) {
  return 4 + ability(state.player, "sprintSpeed") * 0.05;
}

function accelerationMps2(state) {
  return 1.5 + ability(state.player, "acceleration") * 0.045;
}

function staminaRetention(state) {
  return 0.55 + ability(state.player, "stamina") * 0.0045;
}

function effectiveMaximumSpeedMps(state) {
  const fatigue = clamp(state.sprintWorkM / 80, 0, 1);
  const retention = staminaRetention(state);
  return maximumSpeedMps(state) * (1 - fatigue * (1 - retention));
}

function reactionDelayMs(state) {
  const recognition =
    ability(state.player, "reactions") * 0.65 +
    ability(state.player, "decisionMaking") * 0.35;
  return 100 + (100 - recognition) * 5;
}

function compareById(left, right) {
  return left.player.id.localeCompare(right.player.id);
}

function compareByDistanceThenId(reference) {
  return (left, right) => {
    const difference =
      distance(left.positionM, reference) - distance(right.positionM, reference);
    return Math.abs(difference) > EPSILON ? difference : compareById(left, right);
  };
}

function createRoute(points) {
  const segments = [];
  let totalLengthM = 0;

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const lengthM = distance(start, end);
    if (lengthM <= EPSILON) {
      continue;
    }
    segments.push({
      start,
      end,
      lengthM,
      startDistanceM: totalLengthM,
      endDistanceM: totalLengthM + lengthM,
    });
    totalLengthM += lengthM;
  }

  return { points, segments, totalLengthM };
}

function positionAtRouteDistance(route, progressM) {
  if (route.segments.length === 0) {
    return route.points.at(-1);
  }

  const boundedProgress = clamp(progressM, 0, route.totalLengthM);
  const segment =
    route.segments.find(
      (candidate) => boundedProgress <= candidate.endDistanceM + EPSILON,
    ) ?? route.segments.at(-1);
  const localProgress =
    segment.lengthM <= EPSILON
      ? 1
      : clamp(
          (boundedProgress - segment.startDistanceM) / segment.lengthM,
          0,
          1,
        );
  return lerp(segment.start, segment.end, localProgress);
}

function routeTurnSpeedFactor(route, progressM, agility) {
  const segmentIndex = route.segments.findIndex(
    (segment) => progressM <= segment.endDistanceM + EPSILON,
  );
  if (segmentIndex < 0 || segmentIndex >= route.segments.length - 1) {
    return 1;
  }

  const segment = route.segments[segmentIndex];
  const nextSegment = route.segments[segmentIndex + 1];
  const remainingM = segment.endDistanceM - progressM;
  if (remainingM > 3) {
    return 1;
  }

  const currentDirection = normalize(subtract(segment.end, segment.start));
  const nextDirection = normalize(subtract(nextSegment.end, nextSegment.start));
  const dot = clamp(
    currentDirection.x * nextDirection.x + currentDirection.y * nextDirection.y,
    -1,
    1,
  );
  const severity = (1 - dot) / 2;
  const abilityFactor = 0.35 + agility * 0.0065;
  const proximity = 1 - clamp(remainingM / 3, 0, 1);
  return 1 - severity * (1 - abilityFactor) * proximity;
}

function createPlayerState(player, manualInstruction, config) {
  const positionM = normalizedToMeters(player.position, config);
  const route = manualInstruction
    ? createRoute([
        positionM,
        ...manualInstruction.waypoints.map((waypoint) =>
          normalizedToMeters(waypoint, config),
        ),
      ])
    : null;

  return {
    player,
    positionM,
    previousPositionM: positionM,
    anchorM: positionM,
    velocityMps: point(0, 0),
    distanceM: 0,
    sprintWorkM: 0,
    mode: route ? "manual" : "automatic",
    behavior: route ? "manual" : "hold",
    targetM: positionM,
    route,
    routeStartAtMs: manualInstruction?.startAtMs ?? null,
    routeProgressM: 0,
    arrivedAtMs:
      route &&
      route.totalLengthM <= EPSILON &&
      manualInstruction.startAtMs === 0
        ? 0
        : null,
  };
}

function validateScenario(scenario, config) {
  if (!scenario || typeof scenario !== "object") {
    throw new TypeError("Simulation scenario is required.");
  }
  assertFiniteNumber(scenario.durationMs, "durationMs");
  if (
    scenario.durationMs <= 0 ||
    scenario.durationMs % SIMULATION_TICK_MS !== 0
  ) {
    throw new RangeError(
      `durationMs must be a positive multiple of ${SIMULATION_TICK_MS}.`,
    );
  }
  if (scenario.durationMs > config.maximumDurationMs) {
    throw new RangeError(
      `durationMs must not exceed ${config.maximumDurationMs}ms.`,
    );
  }
  if (!Array.isArray(scenario.players) || scenario.players.length !== MINIMUM_PLAYER_COUNT) {
    throw new RangeError("A simulation requires exactly 22 players.");
  }

  const playerIds = new Set();
  const teamCounts = { home: 0, away: 0 };
  for (const player of scenario.players) {
    if (!player || typeof player.id !== "string" || player.id.length === 0) {
      throw new TypeError("Each player requires a non-empty id.");
    }
    if (playerIds.has(player.id)) {
      throw new RangeError(`Duplicate player id: ${player.id}`);
    }
    playerIds.add(player.id);
    if (player.team !== "home" && player.team !== "away") {
      throw new TypeError(`${player.id}.team must be home or away.`);
    }
    teamCounts[player.team] += 1;
    assertPoint(player.position, `${player.id}.position`);
  }
  if (
    teamCounts.home !== TEAM_PLAYER_COUNT ||
    teamCounts.away !== TEAM_PLAYER_COUNT
  ) {
    throw new RangeError("A simulation requires 11 home and 11 away players.");
  }

  if (
    typeof scenario.initialBallOwnerId !== "string" ||
    !playerIds.has(scenario.initialBallOwnerId)
  ) {
    throw new RangeError("initialBallOwnerId must identify a simulation player.");
  }

  const manualPlayerIds = new Set();
  for (const [index, instruction] of (scenario.manualRoutes ?? []).entries()) {
    if (!playerIds.has(instruction.playerId)) {
      throw new RangeError(`manualRoutes[${index}] references an unknown player.`);
    }
    const player = scenario.players.find(
      (candidate) => candidate.id === instruction.playerId,
    );
    if (player.team !== "home") {
      throw new RangeError("Only home players can receive manual routes.");
    }
    if (manualPlayerIds.has(instruction.playerId)) {
      throw new RangeError(`Duplicate manual route: ${instruction.playerId}`);
    }
    manualPlayerIds.add(instruction.playerId);
    assertFiniteNumber(instruction.startAtMs, `manualRoutes[${index}].startAtMs`);
    if (
      instruction.startAtMs < 0 ||
      instruction.startAtMs >= scenario.durationMs ||
      instruction.startAtMs % SIMULATION_TICK_MS !== 0
    ) {
      throw new RangeError(
        `manualRoutes[${index}].startAtMs must align to a simulation tick.`,
      );
    }
    if (!Array.isArray(instruction.waypoints) || instruction.waypoints.length === 0) {
      throw new RangeError(`manualRoutes[${index}] requires at least one waypoint.`);
    }
    instruction.waypoints.forEach((waypoint, waypointIndex) =>
      assertPoint(
        waypoint,
        `manualRoutes[${index}].waypoints[${waypointIndex}]`,
      ),
    );
  }

  const passIds = new Set();
  for (const [index, pass] of (scenario.passes ?? []).entries()) {
    if (!pass || typeof pass.id !== "string" || pass.id.length === 0) {
      throw new TypeError(`passes[${index}] requires a non-empty id.`);
    }
    if (passIds.has(pass.id)) {
      throw new RangeError(`Duplicate pass id: ${pass.id}`);
    }
    passIds.add(pass.id);
    const passer = scenario.players.find((player) => player.id === pass.fromPlayerId);
    const receiver = scenario.players.find((player) => player.id === pass.toPlayerId);
    if (!passer || !receiver) {
      throw new RangeError(`passes[${index}] references an unknown player.`);
    }
    if (passer.team !== "home" || receiver.team !== "home") {
      throw new RangeError("Only home-to-home pass instructions are supported.");
    }
    if (pass.fromPlayerId === pass.toPlayerId) {
      throw new RangeError(`passes[${index}] requires two different players.`);
    }
    assertFiniteNumber(pass.atMs, `passes[${index}].atMs`);
    if (
      pass.atMs < 0 ||
      pass.atMs >= scenario.durationMs ||
      pass.atMs % SIMULATION_TICK_MS !== 0
    ) {
      throw new RangeError(`passes[${index}].atMs must align to a simulation tick.`);
    }
  }
}

function mergeConfig(overrides) {
  const config = { ...DEFAULT_SIMULATION_CONFIG, ...(overrides ?? {}) };
  for (const [key, value] of Object.entries(config)) {
    assertFiniteNumber(value, `config.${key}`);
    if (value <= 0) {
      throw new RangeError(`config.${key} must be greater than zero.`);
    }
  }
  if (
    config.maximumDurationMs > MAX_SIMULATION_DURATION_MS ||
    config.maximumDurationMs % SIMULATION_TICK_MS !== 0
  ) {
    throw new RangeError(
      `config.maximumDurationMs must be tick-aligned and at most ${MAX_SIMULATION_DURATION_MS}.`,
    );
  }
  if (config.looseBallRetentionPerTick > 1) {
    throw new RangeError(
      "config.looseBallRetentionPerTick must not exceed one.",
    );
  }
  return Object.freeze(config);
}

function currentBallPositionM(ball, statesById) {
  if (ball.kind === "controlled") {
    return statesById.get(ball.ownerId).positionM;
  }
  return ball.positionM;
}

function goalkeeperTarget(state, ballPositionM, config) {
  const isHome = state.player.team === "home";
  const targetY =
    state.anchorM.y + (ballPositionM.y - state.anchorM.y) * 0.08;
  return clampMeters(
    point(
      state.anchorM.x + (ballPositionM.x - state.anchorM.x) * 0.16,
      isHome
        ? clamp(
            targetY,
            config.pitchLengthM * 0.82,
            config.pitchLengthM * 0.97,
          )
        : clamp(
            targetY,
            config.pitchLengthM * 0.03,
            config.pitchLengthM * 0.18,
          ),
    ),
    config,
  );
}

function possessionTeamForBall(ball, statesById) {
  if (ball.kind === "controlled") {
    return statesById.get(ball.ownerId).player.team;
  }
  if (ball.kind === "inFlight") {
    return ball.passerTeam;
  }
  return null;
}

function otherTeam(team) {
  return team === "home" ? "away" : "home";
}

function orientAttackingOffset(offset, team) {
  return team === "home" ? offset : point(-offset.x, -offset.y);
}

function attackingAutomaticIntents(
  states,
  attackingTeam,
  ball,
  ballPositionM,
  config,
) {
  const intents = new Map();
  const automaticStates = states
    .filter(
      (state) =>
        state.player.team === attackingTeam && state.mode === "automatic",
    )
    .sort(compareById);
  const controlledOwnerId =
    ball.kind === "controlled" ? ball.ownerId : null;
  const outfield = automaticStates.filter(
    (state) =>
      !isGoalkeeper(state.player) && state.player.id !== controlledOwnerId,
  );

  const supportCandidates = outfield.sort(
    compareByDistanceThenId(ballPositionM),
  );
  const supportOffsets = [
    point(-8, 7),
    point(8, 7),
    point(0, -9),
  ];

  for (const state of automaticStates) {
    if (state.player.id === controlledOwnerId) {
      const forwardDirection = attackingTeam === "home" ? -1 : 1;
      const carryDistanceM =
        3 + ability(state.player, "attacking") * 0.03;
      intents.set(state.player.id, {
        behavior: "ball-carrier",
        intensity:
          0.58 + ability(state.player, "decisionMaking") * 0.0022,
        targetM: clampMeters(
          add(
            state.positionM,
            point(0, forwardDirection * carryDistanceM),
          ),
          config,
        ),
      });
      continue;
    }

    if (isGoalkeeper(state.player)) {
      intents.set(state.player.id, {
        behavior: "goalkeeper-support",
        intensity: 0.5,
        targetM: goalkeeperTarget(state, ballPositionM, config),
      });
      continue;
    }

    const supportIndex = supportCandidates.indexOf(state);
    if (supportIndex >= 0 && supportIndex < supportOffsets.length) {
      const attackingBiasM =
        ((ability(state.player, "attacking") - 50) / 50) * 2;
      const localOffset = add(
        supportOffsets[supportIndex],
        point(0, -attackingBiasM),
      );
      const disciplinedSupportM = add(
        ballPositionM,
        orientAttackingOffset(localOffset, attackingTeam),
      );
      const positioningWeight =
        0.55 + ability(state.player, "positioning") * 0.0045;
      intents.set(state.player.id, {
        behavior: "support",
        intensity:
          0.62 + ability(state.player, "decisionMaking") * 0.002,
        targetM: clampMeters(
          lerp(state.anchorM, disciplinedSupportM, positioningWeight),
          config,
        ),
      });
      continue;
    }

    const decisionWeight =
      0.08 + ability(state.player, "decisionMaking") * 0.0008;
    const positioningWeight =
      0.08 + ability(state.player, "positioning") * 0.0006;
    intents.set(state.player.id, {
      behavior: "shape",
      intensity: 0.62,
      targetM: clampMeters(
        point(
          state.anchorM.x +
            (ballPositionM.x - state.anchorM.x) * decisionWeight,
          state.anchorM.y +
            (ballPositionM.y - state.anchorM.y) * positioningWeight,
        ),
        config,
      ),
    });
  }
  return intents;
}

function defendingAutomaticIntents(
  states,
  defendingTeam,
  ball,
  ballPositionM,
  phaseElapsedMs,
  config,
) {
  const intents = new Map();
  const defendingStates = states
    .filter(
      (state) =>
        state.player.team === defendingTeam && state.mode === "automatic",
    )
    .sort(compareById);
  const outfield = defendingStates
    .filter((state) => !isGoalkeeper(state.player))
    .sort(compareByDistanceThenId(ballPositionM));
  const ownGoalM = point(
    config.pitchWidthM / 2,
    defendingTeam === "home" ? config.pitchLengthM : 0,
  );

  for (const state of defendingStates) {
    if (phaseElapsedMs < reactionDelayMs(state)) {
      intents.set(state.player.id, {
        behavior: "hold",
        intensity: 0.4,
        targetM: state.anchorM,
      });
      continue;
    }

    if (isGoalkeeper(state.player)) {
      intents.set(state.player.id, {
        behavior: "goalkeeper-reaction",
        intensity: 0.55,
        targetM: goalkeeperTarget(state, ballPositionM, config),
      });
      continue;
    }

    const rank = outfield.indexOf(state);
    if (rank === 0) {
      intents.set(state.player.id, {
        behavior: "pressure",
        intensity: 0.78 + ability(state.player, "defending") * 0.0018,
        targetM: ballPositionM,
      });
      continue;
    }
    if (rank === 1) {
      const coverReference =
        ball.kind === "inFlight" ? ball.targetM : ownGoalM;
      const coverDepth =
        0.25 + ability(state.player, "positioning") * 0.002;
      intents.set(state.player.id, {
        behavior: "cover",
        intensity:
          0.68 + ability(state.player, "decisionMaking") * 0.0014,
        targetM: clampMeters(
          lerp(ballPositionM, coverReference, coverDepth),
          config,
        ),
      });
      continue;
    }

    const horizontalShift =
      0.1 + ability(state.player, "decisionMaking") * 0.001;
    const verticalShift =
      0.08 + ability(state.player, "positioning") * 0.0008;
    intents.set(state.player.id, {
      behavior: "block",
      intensity: 0.64,
      targetM: clampMeters(
        point(
          state.anchorM.x +
            (ballPositionM.x - state.anchorM.x) * horizontalShift,
          state.anchorM.y +
            (ballPositionM.y - state.anchorM.y) * verticalShift,
        ),
        config,
      ),
    });
  }
  return intents;
}

function looseBallAutomaticIntents(states, ballPositionM, config) {
  const intents = new Map();

  for (const team of ["home", "away"]) {
    const automaticStates = states
      .filter(
        (state) =>
          state.player.team === team && state.mode === "automatic",
      )
      .sort(compareById);
    const outfield = automaticStates
      .filter((state) => !isGoalkeeper(state.player))
      .sort(compareByDistanceThenId(ballPositionM));
    const recoveryPlayer = outfield[0];

    for (const state of automaticStates) {
      if (state === recoveryPlayer) {
        intents.set(state.player.id, {
          behavior: "recover",
          intensity: 0.9,
          targetM: ballPositionM,
        });
      } else if (isGoalkeeper(state.player)) {
        intents.set(state.player.id, {
          behavior: "goalkeeper-reaction",
          intensity: 0.52,
          targetM: goalkeeperTarget(state, ballPositionM, config),
        });
      } else {
        intents.set(state.player.id, {
          behavior: "block",
          intensity: 0.58,
          targetM: clampMeters(
            lerp(state.anchorM, ballPositionM, 0.12),
            config,
          ),
        });
      }
    }
  }

  return intents;
}

function automaticIntents(
  states,
  ball,
  ballPositionM,
  possessionTeam,
  phaseElapsedMs,
  config,
) {
  if (possessionTeam === null) {
    return looseBallAutomaticIntents(states, ballPositionM, config);
  }

  return new Map([
    ...attackingAutomaticIntents(
      states,
      possessionTeam,
      ball,
      ballPositionM,
      config,
    ),
    ...defendingAutomaticIntents(
      states,
      otherTeam(possessionTeam),
      ball,
      ballPositionM,
      phaseElapsedMs,
      config,
    ),
  ]);
}

function integrateManualPlayer(state, elapsedMs, deltaSeconds, config) {
  state.previousPositionM = state.positionM;
  state.behavior = "manual";

  if (elapsedMs < state.routeStartAtMs || state.arrivedAtMs !== null) {
    state.velocityMps = point(0, 0);
    state.targetM =
      state.arrivedAtMs === null
        ? state.route.points[1] ?? state.positionM
        : state.route.points.at(-1);
    return;
  }

  if (state.route.totalLengthM <= EPSILON) {
    state.positionM = state.route.points.at(-1);
    state.velocityMps = point(0, 0);
    state.targetM = state.positionM;
    state.arrivedAtMs = elapsedMs;
    return;
  }

  const agility = ability(state.player, "agility");
  const turnFactor = routeTurnSpeedFactor(
    state.route,
    state.routeProgressM,
    agility,
  );
  const targetSpeedMps = effectiveMaximumSpeedMps(state) * turnFactor;
  const nextSpeedMps = Math.min(
    targetSpeedMps,
    magnitude(state.velocityMps) + accelerationMps2(state) * deltaSeconds,
  );
  const remainingM = state.route.totalLengthM - state.routeProgressM;
  const movementM = Math.min(remainingM, nextSpeedMps * deltaSeconds);
  state.routeProgressM += movementM;
  state.positionM = positionAtRouteDistance(state.route, state.routeProgressM);
  state.velocityMps = scale(
    subtract(state.positionM, state.previousPositionM),
    1 / deltaSeconds,
  );
  state.distanceM += movementM;
  if (nextSpeedMps >= maximumSpeedMps(state) * 0.7) {
    state.sprintWorkM += movementM;
  }

  const activeSegment = state.route.segments.find(
    (segment) => state.routeProgressM <= segment.endDistanceM + EPSILON,
  );
  state.targetM = activeSegment?.end ?? state.route.points.at(-1);

  if (
    state.route.totalLengthM - state.routeProgressM <=
    config.manualArrivalThresholdM
  ) {
    state.routeProgressM = state.route.totalLengthM;
    state.positionM = state.route.points.at(-1);
    state.velocityMps = point(0, 0);
    state.targetM = state.positionM;
    state.arrivedAtMs = elapsedMs + SIMULATION_TICK_MS;
  }
}

function integrateAutomaticPlayer(state, intent, deltaSeconds, config) {
  state.previousPositionM = state.positionM;
  state.behavior = intent.behavior;
  state.targetM = intent.targetM;

  const displacement = subtract(intent.targetM, state.positionM);
  const targetDistanceM = magnitude(displacement);
  if (targetDistanceM <= config.automaticTargetToleranceM) {
    state.distanceM += targetDistanceM;
    state.positionM = intent.targetM;
    state.velocityMps = point(0, 0);
    return;
  }

  const desiredSpeedMps = Math.min(
    effectiveMaximumSpeedMps(state) * intent.intensity,
    targetDistanceM / deltaSeconds,
  );
  const desiredVelocityMps = scale(
    normalize(displacement),
    desiredSpeedMps,
  );
  const agilityFactor = 0.55 + ability(state.player, "agility") * 0.006;
  const maximumVelocityChange =
    accelerationMps2(state) * agilityFactor * deltaSeconds;
  const velocityChange = clampVectorMagnitude(
    subtract(desiredVelocityMps, state.velocityMps),
    maximumVelocityChange,
  );
  state.velocityMps = add(state.velocityMps, velocityChange);

  const movement = scale(state.velocityMps, deltaSeconds);
  const movementLengthM = magnitude(movement);
  if (movementLengthM >= targetDistanceM) {
    state.positionM = intent.targetM;
    state.velocityMps = scale(
      subtract(state.positionM, state.previousPositionM),
      1 / deltaSeconds,
    );
  } else {
    state.positionM = clampMeters(add(state.positionM, movement), config);
  }

  const travelledM = distance(state.previousPositionM, state.positionM);
  state.distanceM += travelledM;
  if (magnitude(state.velocityMps) >= maximumSpeedMps(state) * 0.7) {
    state.sprintWorkM += travelledM;
  }
}

function processPassCommands(
  commands,
  elapsedMs,
  ball,
  statesById,
  config,
) {
  const events = [];
  let nextBall = ball;

  for (const command of commands.filter((candidate) => candidate.atMs === elapsedMs)) {
    if (
      nextBall.kind !== "controlled" ||
      nextBall.ownerId !== command.fromPlayerId
    ) {
      events.push({
        type: "pass_cancelled",
        passId: command.id,
        atMs: elapsedMs,
        fromPlayerId: command.fromPlayerId,
        toPlayerId: command.toPlayerId,
        reason: "no_possession",
      });
      continue;
    }

    const passer = statesById.get(command.fromPlayerId);
    const receiver = statesById.get(command.toPlayerId);
    const originM = passer.positionM;
    const speedMps =
      config.passBaseSpeedMps +
      ability(passer.player, "passing") * config.passRatingSpeedMps;
    const directDistanceM = distance(originM, receiver.positionM);
    const travelSeconds = directDistanceM / speedMps;
    const targetM = clampMeters(
      add(
        receiver.positionM,
        scale(receiver.velocityMps, travelSeconds * 0.7),
      ),
      config,
    );
    const direction = normalize(subtract(targetM, originM));
    nextBall = {
      kind: "inFlight",
      passId: command.id,
      fromPlayerId: command.fromPlayerId,
      toPlayerId: command.toPlayerId,
      passerTeam: passer.player.team,
      positionM: originM,
      targetM,
      velocityMps: scale(direction, speedMps),
      distanceTravelledM: 0,
    };
    events.push({
      type: "pass_started",
      passId: command.id,
      atMs: elapsedMs,
      fromPlayerId: command.fromPlayerId,
      toPlayerId: command.toPlayerId,
    });
  }

  return { ball: nextBall, events };
}

function closestPointOnSegment(candidate, start, end) {
  const segment = subtract(end, start);
  const lengthSquared = segment.x ** 2 + segment.y ** 2;
  if (lengthSquared <= EPSILON) {
    return { parameter: 0, distanceM: distance(candidate, start) };
  }
  const relative = subtract(candidate, start);
  const parameter = clamp(
    (relative.x * segment.x + relative.y * segment.y) / lengthSquared,
    0,
    1,
  );
  const closest = add(start, scale(segment, parameter));
  return { parameter, distanceM: distance(candidate, closest) };
}

function resolvePassContact(ball, startM, endM, states, elapsedMs) {
  const candidates = [];
  const receiver = states.find(
    (state) => state.player.id === ball.toPlayerId,
  );
  const receiverContact = closestPointOnSegment(
    receiver.positionM,
    startM,
    endM,
  );
  const receiverRadiusM =
    0.65 + ability(receiver.player, "ballControl") * 0.007;
  if (receiverContact.distanceM <= receiverRadiusM) {
    candidates.push({
      kind: "reception",
      state: receiver,
      ...receiverContact,
    });
  }

  for (const state of states) {
    if (state.player.team === ball.passerTeam) {
      continue;
    }
    const contact = closestPointOnSegment(state.positionM, startM, endM);
    const interceptionRadiusM =
      0.45 +
      ability(state.player, "defending") * 0.008 +
      ability(state.player, "reactions") * 0.002;
    if (contact.distanceM <= interceptionRadiusM) {
      candidates.push({
        kind: "interception",
        state,
        ...contact,
      });
    }
  }

  candidates.sort((left, right) => {
    const parameterDifference = left.parameter - right.parameter;
    if (Math.abs(parameterDifference) > EPSILON) {
      return parameterDifference;
    }
    const distanceDifference = left.distanceM - right.distanceM;
    if (Math.abs(distanceDifference) > EPSILON) {
      return distanceDifference;
    }
    return left.state.player.id.localeCompare(right.state.player.id);
  });

  const contact = candidates[0];
  if (!contact) {
    return null;
  }

  const contactPositionM = lerp(startM, endM, contact.parameter);
  if (contact.kind === "reception") {
    return {
      ball: {
        kind: "controlled",
        ownerId: contact.state.player.id,
        positionM: contactPositionM,
        velocityMps: point(0, 0),
      },
      event: {
        type: "pass_received",
        passId: ball.passId,
        atMs: elapsedMs,
        playerId: contact.state.player.id,
      },
    };
  }

  return {
    ball: {
      kind: "controlled",
      ownerId: contact.state.player.id,
      positionM: contactPositionM,
      velocityMps: point(0, 0),
    },
    event: {
      type: "pass_intercepted",
      passId: ball.passId,
      atMs: elapsedMs,
      playerId: contact.state.player.id,
    },
  };
}

function resolveLooseBallRecovery(positionM, states, elapsedMs) {
  const candidates = states
    .map((state) => ({
      state,
      distanceM: distance(state.positionM, positionM),
      recoveryRadiusM:
        0.45 +
        ability(state.player, "ballControl") * 0.007 +
        ability(state.player, "reactions") * 0.002,
    }))
    .filter((candidate) => candidate.distanceM <= candidate.recoveryRadiusM)
    .sort((left, right) => {
      const distanceDifference = left.distanceM - right.distanceM;
      return Math.abs(distanceDifference) > EPSILON
        ? distanceDifference
        : left.state.player.id.localeCompare(right.state.player.id);
    });
  const recovery = candidates[0];
  if (!recovery) {
    return null;
  }

  return {
    ball: {
      kind: "controlled",
      ownerId: recovery.state.player.id,
      positionM: recovery.state.positionM,
      velocityMps: recovery.state.velocityMps,
    },
    event: {
      type: "ball_recovered",
      atMs: elapsedMs,
      playerId: recovery.state.player.id,
    },
  };
}

function integrateBall(ball, states, statesById, elapsedMs, deltaSeconds, config) {
  if (ball.kind === "controlled") {
    const owner = statesById.get(ball.ownerId);
    return {
      ball: {
        ...ball,
        positionM: owner.positionM,
        velocityMps: owner.velocityMps,
      },
      events: [],
    };
  }

  if (ball.kind === "loose") {
    const nextPositionM = clampMeters(
      add(ball.positionM, scale(ball.velocityMps, deltaSeconds)),
      config,
    );
    const recovery = resolveLooseBallRecovery(
      nextPositionM,
      states,
      elapsedMs,
    );
    if (recovery) {
      return { ball: recovery.ball, events: [recovery.event] };
    }
    return {
      ball: {
        ...ball,
        positionM: nextPositionM,
        velocityMps: scale(
          ball.velocityMps,
          config.looseBallRetentionPerTick,
        ),
      },
      events: [],
    };
  }

  const startM = ball.positionM;
  const remainingM = distance(startM, ball.targetM);
  const requestedMovementM = magnitude(ball.velocityMps) * deltaSeconds;
  const movementM = Math.min(remainingM, requestedMovementM);
  const endM =
    remainingM <= EPSILON
      ? ball.targetM
      : add(startM, scale(normalize(subtract(ball.targetM, startM)), movementM));
  const contact = resolvePassContact(
    ball,
    startM,
    endM,
    states,
    elapsedMs,
  );
  if (contact) {
    return { ball: contact.ball, events: [contact.event] };
  }

  if (movementM >= remainingM - EPSILON) {
    return {
      ball: {
        kind: "loose",
        positionM: ball.targetM,
        velocityMps: point(0, 0),
      },
      events: [
        {
          type: "pass_incomplete",
          passId: ball.passId,
          atMs: elapsedMs,
        },
      ],
    };
  }

  return {
    ball: {
      ...ball,
      positionM: endM,
      distanceTravelledM: ball.distanceTravelledM + movementM,
    },
    events: [],
  };
}

function teamShape(playerSnapshots, team, config) {
  const teamPlayers = Object.values(playerSnapshots).filter(
    (player) => player.team === team,
  );
  const positionsM = teamPlayers.map((player) =>
    normalizedToMeters(player.position, config),
  );
  const xs = positionsM.map((position) => position.x);
  const ys = positionsM.map((position) => position.y);
  const centroidM = point(
    xs.reduce((sum, value) => sum + value, 0) / positionsM.length,
    ys.reduce((sum, value) => sum + value, 0) / positionsM.length,
  );
  const nearestDistances = positionsM.map((position, index) =>
    Math.min(
      ...positionsM
        .filter((_, candidateIndex) => candidateIndex !== index)
        .map((candidate) => distance(position, candidate)),
    ),
  );

  return {
    widthM: round(Math.max(...xs) - Math.min(...xs)),
    depthM: round(Math.max(...ys) - Math.min(...ys)),
    centroid: metersToNormalized(centroidM, config),
    averageNearestTeammateDistanceM: round(
      nearestDistances.reduce((sum, value) => sum + value, 0) /
        nearestDistances.length,
    ),
  };
}

function proximityMetrics(playerSnapshots, config) {
  const entries = Object.entries(playerSnapshots);
  return Object.fromEntries(
    entries.map(([playerId, player]) => {
      const positionM = normalizedToMeters(player.position, config);
      const teammates = entries.filter(
        ([candidateId, candidate]) =>
          candidateId !== playerId && candidate.team === player.team,
      );
      const opponents = entries.filter(
        ([, candidate]) => candidate.team !== player.team,
      );
      return [
        playerId,
        {
          nearestTeammateM: round(
            Math.min(
              ...teammates.map(([, candidate]) =>
                distance(
                  positionM,
                  normalizedToMeters(candidate.position, config),
                ),
              ),
            ),
          ),
          nearestOpponentM: round(
            Math.min(
              ...opponents.map(([, candidate]) =>
                distance(
                  positionM,
                  normalizedToMeters(candidate.position, config),
                ),
              ),
            ),
          ),
        },
      ];
    }),
  );
}

function calculateFrameMetrics(playerSnapshots, config) {
  return {
    teams: {
      home: teamShape(playerSnapshots, "home", config),
      away: teamShape(playerSnapshots, "away", config),
    },
    players: proximityMetrics(playerSnapshots, config),
  };
}

function snapshotBall(ball, statesById, config) {
  const positionM =
    ball.kind === "controlled"
      ? statesById.get(ball.ownerId).positionM
      : ball.positionM;
  const snapshot = {
    kind: ball.kind,
    position: metersToNormalized(positionM, config),
    velocityMps: {
      x: round(ball.velocityMps.x),
      y: round(ball.velocityMps.y),
    },
  };
  if (ball.kind === "controlled") {
    snapshot.ownerId = ball.ownerId;
  } else if (ball.kind === "inFlight") {
    snapshot.passId = ball.passId;
    snapshot.fromPlayerId = ball.fromPlayerId;
    snapshot.toPlayerId = ball.toPlayerId;
    snapshot.target = metersToNormalized(ball.targetM, config);
  }
  return snapshot;
}

function createFrame(elapsedMs, states, ball, events, config) {
  const statesById = new Map(
    states.map((state) => [state.player.id, state]),
  );
  const playerSnapshots = Object.fromEntries(
    states
      .slice()
      .sort(compareById)
      .map((state) => [
        state.player.id,
        {
          id: state.player.id,
          team: state.player.team,
          role: state.player.role,
          mode: state.mode,
          behavior: state.behavior,
          position: metersToNormalized(state.positionM, config),
          velocityMps: {
            x: round(state.velocityMps.x),
            y: round(state.velocityMps.y),
          },
          speedMps: round(magnitude(state.velocityMps)),
          distanceM: round(state.distanceM),
          target: metersToNormalized(state.targetM, config),
          routeRemainingM:
            state.route === null
              ? null
              : round(
                  Math.max(
                    0,
                    state.route.totalLengthM - state.routeProgressM,
                  ),
                ),
          arrived: state.route !== null && state.arrivedAtMs !== null,
          arrivedAtMs: state.arrivedAtMs,
        },
      ]),
  );

  return {
    elapsedMs,
    players: playerSnapshots,
    ball: snapshotBall(ball, statesById, config),
    metrics: calculateFrameMetrics(playerSnapshots, config),
    events,
  };
}

function interpolateBall(lower, upper, amount) {
  const interpolated = {
    ...lower,
    position: lerp(lower.position, upper.position, amount),
    velocityMps: lerp(lower.velocityMps, upper.velocityMps, amount),
  };
  return interpolated;
}

export function compileSimulation(scenario, configOverrides) {
  const config = mergeConfig(configOverrides);
  validateScenario(scenario, config);
  const manualInstructions = new Map(
    (scenario.manualRoutes ?? []).map((instruction) => [
      instruction.playerId,
      {
        ...instruction,
        waypoints: instruction.waypoints.map((waypoint) => ({ ...waypoint })),
      },
    ]),
  );
  const states = scenario.players
    .map((player) =>
      createPlayerState(
        {
          ...player,
          position: { ...player.position },
          abilities: { ...(player.abilities ?? {}) },
        },
        manualInstructions.get(player.id),
        config,
      ),
    )
    .sort(compareById);
  const statesById = new Map(
    states.map((state) => [state.player.id, state]),
  );
  const passCommands = (scenario.passes ?? [])
    .map((pass) => ({ ...pass }))
    .sort(
      (left, right) =>
        left.atMs - right.atMs || left.id.localeCompare(right.id),
    );
  let ball = {
    kind: "controlled",
    ownerId: scenario.initialBallOwnerId,
    positionM: statesById.get(scenario.initialBallOwnerId).positionM,
    velocityMps: point(0, 0),
  };

  const initialPasses = processPassCommands(
    passCommands,
    0,
    ball,
    statesById,
    config,
  );
  ball = initialPasses.ball;
  let possessionTeam = possessionTeamForBall(ball, statesById);
  let possessionPhaseStartedAtMs = 0;
  const frames = [
    createFrame(0, states, ball, initialPasses.events, config),
  ];
  const deltaSeconds = SIMULATION_TICK_MS / 1000;

  for (
    let elapsedMs = 0;
    elapsedMs < scenario.durationMs;
    elapsedMs += SIMULATION_TICK_MS
  ) {
    const ballPositionM = currentBallPositionM(ball, statesById);
    const intents = automaticIntents(
      states,
      ball,
      ballPositionM,
      possessionTeam,
      elapsedMs - possessionPhaseStartedAtMs,
      config,
    );

    for (const state of states) {
      if (state.mode === "manual") {
        integrateManualPlayer(state, elapsedMs, deltaSeconds, config);
      } else {
        const intent = intents.get(state.player.id);
        integrateAutomaticPlayer(state, intent, deltaSeconds, config);
      }
    }

    const nextElapsedMs = elapsedMs + SIMULATION_TICK_MS;
    const ballStep = integrateBall(
      ball,
      states,
      statesById,
      nextElapsedMs,
      deltaSeconds,
      config,
    );
    ball = ballStep.ball;
    const passStep = processPassCommands(
      passCommands,
      nextElapsedMs,
      ball,
      statesById,
      config,
    );
    ball = passStep.ball;
    const nextPossessionTeam = possessionTeamForBall(ball, statesById);
    if (nextPossessionTeam !== possessionTeam) {
      possessionTeam = nextPossessionTeam;
      possessionPhaseStartedAtMs = nextElapsedMs;
    }
    frames.push(
      createFrame(
        nextElapsedMs,
        states,
        ball,
        [...ballStep.events, ...passStep.events],
        config,
      ),
    );
  }

  return deepFreeze({
    tickMs: SIMULATION_TICK_MS,
    durationMs: scenario.durationMs,
    config,
    frames,
  });
}

function assertSimulationRun(run) {
  if (
    !run ||
    !Array.isArray(run.frames) ||
    run.frames.length === 0 ||
    run.tickMs !== SIMULATION_TICK_MS
  ) {
    throw new TypeError("A compiled simulation run is required.");
  }
}

export function sampleSimulation(run, elapsedMs) {
  assertSimulationRun(run);
  assertFiniteNumber(elapsedMs, "elapsedMs");
  const boundedElapsedMs = clamp(elapsedMs, 0, run.durationMs);
  const lowerIndex = Math.floor(boundedElapsedMs / run.tickMs);
  const upperIndex = Math.min(lowerIndex + 1, run.frames.length - 1);
  const lower = run.frames[lowerIndex];
  const upper = run.frames[upperIndex];
  if (lowerIndex === upperIndex || boundedElapsedMs === lower.elapsedMs) {
    return deepClone(lower);
  }

  const amount =
    (boundedElapsedMs - lower.elapsedMs) /
    (upper.elapsedMs - lower.elapsedMs);
  const players = Object.fromEntries(
    Object.keys(lower.players).map((playerId) => {
      const lowerPlayer = lower.players[playerId];
      const upperPlayer = upper.players[playerId];
      return [
        playerId,
        {
          ...lowerPlayer,
          position: lerp(lowerPlayer.position, upperPlayer.position, amount),
          velocityMps: lerp(
            lowerPlayer.velocityMps,
            upperPlayer.velocityMps,
            amount,
          ),
          speedMps:
            lowerPlayer.speedMps +
            (upperPlayer.speedMps - lowerPlayer.speedMps) * amount,
          distanceM:
            lowerPlayer.distanceM +
            (upperPlayer.distanceM - lowerPlayer.distanceM) * amount,
          target: lerp(lowerPlayer.target, upperPlayer.target, amount),
          routeRemainingM:
            lowerPlayer.routeRemainingM === null ||
            upperPlayer.routeRemainingM === null
              ? null
              : lowerPlayer.routeRemainingM +
                (upperPlayer.routeRemainingM -
                  lowerPlayer.routeRemainingM) *
                  amount,
        },
      ];
    }),
  );

  return deepClone({
    elapsedMs: boundedElapsedMs,
    players,
    ball: interpolateBall(lower.ball, upper.ball, amount),
    metrics: calculateFrameMetrics(players, run.config),
    events: [],
  });
}

export function eventsBetween(run, fromExclusiveMs, toInclusiveMs) {
  assertSimulationRun(run);
  assertFiniteNumber(fromExclusiveMs, "fromExclusiveMs");
  assertFiniteNumber(toInclusiveMs, "toInclusiveMs");
  if (toInclusiveMs <= fromExclusiveMs) {
    return [];
  }

  const upperBound = clamp(toInclusiveMs, 0, run.durationMs);
  return deepClone(
    run.frames
      .filter(
        (frame) =>
          frame.elapsedMs > fromExclusiveMs &&
          frame.elapsedMs <= upperBound,
      )
      .flatMap((frame) => frame.events),
  );
}

export function summarizeSimulation(run) {
  assertSimulationRun(run);
  const firstFrame = run.frames[0];
  const lastFrame = run.frames.at(-1);
  const events = run.frames.flatMap((frame) => frame.events);
  const passEvents = {
    attempted: events.filter((event) => event.type === "pass_started").length,
    received: events.filter((event) => event.type === "pass_received").length,
    intercepted: events.filter((event) => event.type === "pass_intercepted")
      .length,
    incomplete: events.filter((event) => event.type === "pass_incomplete").length,
    cancelled: events.filter((event) => event.type === "pass_cancelled").length,
    recovered: events.filter((event) => event.type === "ball_recovered").length,
  };

  return deepClone({
    durationMs: run.durationMs,
    tickMs: run.tickMs,
    frameCount: run.frames.length,
    playerCount: Object.keys(lastFrame.players).length,
    players: Object.fromEntries(
      Object.entries(lastFrame.players).map(([playerId, player]) => [
        playerId,
        {
          team: player.team,
          mode: player.mode,
          distanceM: player.distanceM,
          arrivedAtMs: player.arrivedAtMs,
        },
      ]),
    ),
    teams: {
      home: {
        start: deepClone(firstFrame.metrics.teams.home),
        end: deepClone(lastFrame.metrics.teams.home),
        widthChangeM: round(
          lastFrame.metrics.teams.home.widthM -
            firstFrame.metrics.teams.home.widthM,
        ),
        depthChangeM: round(
          lastFrame.metrics.teams.home.depthM -
            firstFrame.metrics.teams.home.depthM,
        ),
        spacingChangeM: round(
          lastFrame.metrics.teams.home.averageNearestTeammateDistanceM -
            firstFrame.metrics.teams.home.averageNearestTeammateDistanceM,
        ),
      },
      away: {
        start: deepClone(firstFrame.metrics.teams.away),
        end: deepClone(lastFrame.metrics.teams.away),
        widthChangeM: round(
          lastFrame.metrics.teams.away.widthM -
            firstFrame.metrics.teams.away.widthM,
        ),
        depthChangeM: round(
          lastFrame.metrics.teams.away.depthM -
            firstFrame.metrics.teams.away.depthM,
        ),
        spacingChangeM: round(
          lastFrame.metrics.teams.away.averageNearestTeammateDistanceM -
            firstFrame.metrics.teams.away.averageNearestTeammateDistanceM,
        ),
      },
    },
    passes: passEvents,
  });
}

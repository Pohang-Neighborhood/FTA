export const TEAM_TACTICAL_PHASES = Object.freeze([
  "loose-ball",
  "build-up",
  "progression",
  "final-third",
  "defensive-transition",
  "organized-defense",
]);

const DEFENSIVE_TRANSITION_MS = 1_000;

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function assertTeam(team, label) {
  if (team !== "home" && team !== "away") {
    throw new TypeError(`${label} must be home or away.`);
  }
}

function attackingProgress(team, ballY) {
  return team === "home" ? 1 - ballY / 100 : ballY / 100;
}

export function deriveTeamTacticalState({
  team,
  possessionTeam,
  ballPosition,
  possessionElapsedMs = 0,
}) {
  assertTeam(team, "team");
  if (possessionTeam !== null) {
    assertTeam(possessionTeam, "possessionTeam");
  }
  if (
    !ballPosition ||
    !Number.isFinite(ballPosition.x) ||
    !Number.isFinite(ballPosition.y)
  ) {
    throw new TypeError("ballPosition must contain finite x and y values.");
  }
  if (!Number.isFinite(possessionElapsedMs) || possessionElapsedMs < 0) {
    throw new RangeError("possessionElapsedMs must be a non-negative number.");
  }

  const boundedBall = {
    x: clamp(ballPosition.x, 0, 100),
    y: clamp(ballPosition.y, 0, 100),
  };

  if (possessionTeam === null) {
    return Object.freeze({
      phase: "loose-ball",
      inPossession: false,
      progress: null,
      defensiveLineY: team === "home" ? 74 : 26,
      defensiveWidth: 42,
      pressureCount: 1,
      restDefenseCount: 3,
      offsideTrapActive: false,
    });
  }

  if (possessionTeam === team) {
    const progress = clamp(attackingProgress(team, boundedBall.y), 0, 1);
    const phase =
      progress < 0.28
        ? "build-up"
        : progress < 0.68
          ? "progression"
          : "final-third";
    return Object.freeze({
      phase,
      inPossession: true,
      progress,
      defensiveLineY: team === "home" ? 78 : 22,
      defensiveWidth: phase === "final-third" ? 34 : 39,
      pressureCount: 0,
      restDefenseCount: phase === "final-third" ? 3 : 2,
      offsideTrapActive: false,
    });
  }

  const opponentProgress = clamp(
    attackingProgress(possessionTeam, boundedBall.y),
    0,
    1,
  );
  const transition = possessionElapsedMs < DEFENSIVE_TRANSITION_MS;
  const offsideTrapActive =
    !transition &&
    opponentProgress >= 0.25 &&
    opponentProgress <= 0.52 &&
    boundedBall.x >= 20 &&
    boundedBall.x <= 80;
  const shallowLineY = team === "home" ? 64 : 36;
  const deepLineY = team === "home" ? 86 : 14;
  const baseLineY =
    shallowLineY + (deepLineY - shallowLineY) * opponentProgress;

  return Object.freeze({
    phase: transition ? "defensive-transition" : "organized-defense",
    inPossession: false,
    progress: opponentProgress,
    defensiveLineY: offsideTrapActive
      ? baseLineY + (team === "home" ? -4 : 4)
      : baseLineY,
    defensiveWidth: 42 - opponentProgress * 10,
    pressureCount: transition ? 2 : 1,
    restDefenseCount: 0,
    offsideTrapActive,
  });
}

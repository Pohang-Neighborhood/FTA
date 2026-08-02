import assert from "node:assert/strict";
import test from "node:test";
import {
  TEAM_TACTICAL_PHASES,
  deriveTeamTacticalState,
} from "../lib/team-tactical-phase.js";

test("classifies attacking phases in each team's playing direction", () => {
  assert.equal(
    deriveTeamTacticalState({
      team: "home",
      possessionTeam: "home",
      ballPosition: { x: 50, y: 88 },
    }).phase,
    "build-up",
  );
  assert.equal(
    deriveTeamTacticalState({
      team: "home",
      possessionTeam: "home",
      ballPosition: { x: 50, y: 18 },
    }).phase,
    "final-third",
  );
  assert.equal(
    deriveTeamTacticalState({
      team: "away",
      possessionTeam: "away",
      ballPosition: { x: 50, y: 82 },
    }).phase,
    "final-third",
  );
});

test("keeps a deterministic transition window before organized defense", () => {
  const transition = deriveTeamTacticalState({
    team: "home",
    possessionTeam: "away",
    ballPosition: { x: 30, y: 62 },
    possessionTransitionElapsedMs: 750,
  });
  const organized = deriveTeamTacticalState({
    team: "home",
    possessionTeam: "away",
    ballPosition: { x: 30, y: 62 },
    possessionTransitionElapsedMs: 1_000,
  });

  assert.equal(transition.phase, "defensive-transition");
  assert.equal(transition.pressureCount, 2);
  assert.equal(organized.phase, "organized-defense");
  assert.equal(organized.pressureCount, 1);
  assert.ok(organized.defensiveWidth < 42);
});

test("activates a collective offside line only in stable central conditions", () => {
  const active = deriveTeamTacticalState({
    team: "home",
    possessionTeam: "away",
    ballPosition: { x: 50, y: 40 },
    offsideTrapEligible: true,
  });
  const wide = deriveTeamTacticalState({
    team: "home",
    possessionTeam: "away",
    ballPosition: { x: 8, y: 40 },
    offsideTrapEligible: true,
  });

  assert.equal(active.offsideTrapRequested, true);
  assert.equal(wide.offsideTrapRequested, false);
  assert.ok(active.defensiveLineY < wide.defensiveLineY);
});

test("starts in an organized shape without inventing an initial turnover", () => {
  const state = deriveTeamTacticalState({
    team: "away",
    possessionTeam: "home",
    ballPosition: { x: 50, y: 40 },
  });

  assert.equal(state.phase, "organized-defense");
  assert.equal(state.offsideTrapRequested, false);
});

test("keeps the offside line inactive without a controlled pressure trigger", () => {
  const state = deriveTeamTacticalState({
    team: "home",
    possessionTeam: "away",
    ballPosition: { x: 50, y: 40 },
    offsideTrapEligible: false,
  });

  assert.equal(state.offsideTrapRequested, false);
});

test("returns an explicit loose-ball state for both teams", () => {
  const state = deriveTeamTacticalState({
    team: "away",
    possessionTeam: null,
    ballPosition: { x: 50, y: 50 },
  });

  assert.equal(state.phase, "loose-ball");
  assert.equal(state.progress, null);
  assert.ok(TEAM_TACTICAL_PHASES.includes(state.phase));
});

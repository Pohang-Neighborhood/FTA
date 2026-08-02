import assert from "node:assert/strict";
import test from "node:test";

import {
  PLAYER_TACTICAL_ROLE_VERSION,
  applyPlayerTacticalRolePreset,
  createDefaultPlayerTacticalRole,
  customizePlayerTacticalRole,
  deserializePlayerTacticalRoles,
  reconcilePlayerTacticalRoles,
  serializePlayerTacticalRoles,
  tacticalRoleGroupForFormationRole,
  tacticalRolePresetsForFormationRole,
} from "../lib/player-tactical-role.js";

test("classifies formation roles into stable tactical role groups", () => {
  assert.equal(tacticalRoleGroupForFormationRole("LWB"), "fullback");
  assert.equal(tacticalRoleGroupForFormationRole("RCB"), "centerback");
  assert.equal(tacticalRoleGroupForFormationRole("LAM"), "midfield");
  assert.equal(tacticalRoleGroupForFormationRole("RW"), "wide");
  assert.equal(tacticalRoleGroupForFormationRole("ST"), "striker");
  assert.throws(
    () => tacticalRoleGroupForFormationRole("UNKNOWN"),
    /Unsupported formation role/,
  );
});

test("provides position-specific defaults and selectable presets", () => {
  const defaultRole = createDefaultPlayerTacticalRole("LB");
  const presets = tacticalRolePresetsForFormationRole("RB");

  assert.equal(defaultRole.presetId, "fullback-balanced");
  assert.equal(defaultRole.roleGroup, "fullback");
  assert.deepEqual(
    presets.map((candidate) => candidate.id),
    [
      "fullback-balanced",
      "fullback-overlap",
      "fullback-underlap",
      "fullback-hold",
    ],
  );
  assert.equal(
    applyPlayerTacticalRolePreset("LB", "fullback-overlap").forwardRun,
    "overlap",
  );
  assert.throws(
    () => applyPlayerTacticalRolePreset("CB", "fullback-overlap"),
    /not valid/,
  );
});

test("marks a preset as custom after a granular preference change", () => {
  const role = createDefaultPlayerTacticalRole("RW");
  const customized = customizePlayerTacticalRole(role, {
    shooting: "high",
    preferredZone: "half-space",
  });

  assert.equal(customized.presetId, "custom");
  assert.equal(customized.roleGroup, "wide");
  assert.equal(customized.shooting, "high");
  assert.equal(role.shooting, "balanced");
});

test("preserves settings inside a role group and resets incompatible slot changes", () => {
  const overlapping = applyPlayerTacticalRolePreset(
    "LB",
    "fullback-overlap",
  );
  const first = reconcilePlayerTacticalRoles(
    { kim: overlapping },
    [
      { playerId: "kim", role: "RWB" },
      { playerId: "lee", role: "CM" },
    ],
  );
  const second = reconcilePlayerTacticalRoles(first, [
    { playerId: "kim", role: "LCM" },
  ]);

  assert.equal(first.kim.presetId, "fullback-overlap");
  assert.equal(first.lee.presetId, "midfield-balanced");
  assert.equal(second.kim.presetId, "midfield-balanced");
  assert.deepEqual(Object.keys(second), ["kim"]);
});

test("serializes canonically and restores an isolated versioned document", () => {
  const roles = {
    zed: createDefaultPlayerTacticalRole("ST"),
    alpha: applyPlayerTacticalRolePreset("LB", "fullback-underlap"),
  };
  const serialized = serializePlayerTacticalRoles(roles);
  const document = JSON.parse(serialized);
  const restored = deserializePlayerTacticalRoles(serialized);

  assert.equal(document.version, PLAYER_TACTICAL_ROLE_VERSION);
  assert.deepEqual(
    document.players.map((entry) => entry.playerId),
    ["alpha", "zed"],
  );
  assert.equal(serialized, serializePlayerTacticalRoles(restored));
  restored.alpha.passing = "low";
  assert.equal(roles.alpha.passing, "high");
});

test("applies defaults when legacy scenario data has no tactical role document", () => {
  const restored = deserializePlayerTacticalRoles(null, [
    { playerId: "home:gk", role: "GK" },
    { playerId: "home:rw", role: "RW" },
  ]);

  assert.equal(restored["home:gk"].presetId, "goalkeeper-balanced");
  assert.equal(restored["home:rw"].presetId, "wide-balanced");
  assert.throws(
    () =>
      deserializePlayerTacticalRoles(
        JSON.stringify({ version: PLAYER_TACTICAL_ROLE_VERSION + 1 }),
      ),
    /Unsupported player tactical role version/,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  PITCH_BOUNDS,
  analyzeShape,
  clampPitchPosition,
  createPlacements,
  substitutePlayer,
  toPitchPosition,
  toPitchPositionWithOffset,
} from "../lib/tactics-core.js";

const slots = [
  { role: "GK", x: 50, y: 90 },
  { role: "LB", x: 14, y: 70 },
  { role: "ST", x: 50, y: 20 },
];

test("clamps pointer coordinates inside the playable pitch", () => {
  assert.deepEqual(clampPitchPosition(-50, 180), {
    x: PITCH_BOUNDS.minX,
    y: PITCH_BOUNDS.maxY,
  });
  assert.deepEqual(clampPitchPosition(48, 61), { x: 48, y: 61 });
});

test("converts browser coordinates to normalized pitch positions", () => {
  assert.deepEqual(
    toPitchPosition(150, 250, { left: 50, top: 50, width: 200, height: 400 }),
    { x: 50, y: 50 },
  );
  assert.throws(
    () => toPitchPosition(0, 0, { left: 0, top: 0, width: 0, height: 100 }),
    RangeError,
  );
});

test("preserves the grabbed point while dragging a player token", () => {
  const rect = { left: 50, top: 50, width: 200, height: 400 };
  assert.deepEqual(toPitchPositionWithOffset(160, 270, rect, 5, 5), {
    x: 50,
    y: 50,
  });
});

test("creates one immutable slot per unique starting player", () => {
  const playerIds = ["gk", "lb", "st"];
  const placements = createPlacements(playerIds, slots);

  assert.deepEqual(Object.keys(placements), playerIds);
  assert.deepEqual(placements.st, { role: "ST", x: 50, y: 20 });
  assert.throws(() => createPlacements(["gk", "gk", "st"], slots), RangeError);
  assert.throws(() => createPlacements(["gk"], slots), RangeError);
});

test("reports live shape labels and a bounded score", () => {
  const shape = analyzeShape({
    gk: { role: "GK", x: 50, y: 90 },
    lb: { role: "LB", x: 14, y: 70 },
    rb: { role: "RB", x: 86, y: 70 },
    lw: { role: "LW", x: 15, y: 22 },
    rw: { role: "RW", x: 85, y: 22 },
  });

  assert.equal(shape.width, 72);
  assert.equal(shape.widthLabel, "균형");
  assert.ok(shape.score >= 0 && shape.score <= 100);
  assert.equal(analyzeShape({}).score, 0);
});

test("substitutes one player without mutating or duplicating the lineup", () => {
  const playerIds = ["gk", "lb", "st"];
  const placements = createPlacements(playerIds, slots);
  const result = substitutePlayer(playerIds, placements, "st", "sub");

  assert.deepEqual(result.playerIds, ["gk", "lb", "sub"]);
  assert.deepEqual(result.placements.sub, placements.st);
  assert.equal(result.placements.st, undefined);
  assert.deepEqual(playerIds, ["gk", "lb", "st"]);
  assert.ok(placements.st);
  assert.throws(
    () => substitutePlayer(playerIds, placements, "missing", "sub"),
    RangeError,
  );
  assert.throws(
    () => substitutePlayer(playerIds, placements, "st", "lb"),
    RangeError,
  );
});

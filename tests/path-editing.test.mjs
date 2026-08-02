import assert from "node:assert/strict";
import test from "node:test";

import {
  appendSampledWaypoint,
  insertWaypoint,
  moveWaypoint,
  removeWaypoint,
} from "../lib/path-editing.js";

test("samples a dragged path without dense duplicate points", () => {
  const original = [{ x: 10, y: 10 }];
  const skipped = appendSampledWaypoint(original, { x: 11, y: 10 });
  const appended = appendSampledWaypoint(skipped, { x: 13, y: 10 });

  assert.deepEqual(skipped, original);
  assert.notEqual(skipped, original);
  assert.deepEqual(appended, [
    { x: 10, y: 10 },
    { x: 13, y: 10 },
  ]);
});

test("moves, inserts, and removes isolated waypoint copies", () => {
  const original = [
    { x: 10, y: 10 },
    { x: 30, y: 30 },
  ];
  const moved = moveWaypoint(original, 0, { x: 12, y: 14 });
  const inserted = insertWaypoint(moved, 1, { x: 20, y: 20 });
  const removed = removeWaypoint(inserted, 2);

  assert.deepEqual(original, [
    { x: 10, y: 10 },
    { x: 30, y: 30 },
  ]);
  assert.deepEqual(removed, [
    { x: 12, y: 14 },
    { x: 20, y: 20 },
  ]);
});

test("rejects invalid waypoint edits and sampling options", () => {
  assert.throws(() => moveWaypoint([], 0, { x: 10, y: 10 }), /Unknown/);
  assert.throws(
    () => insertWaypoint([], 1, { x: 10, y: 10 }),
    /Unknown/,
  );
  assert.throws(
    () => appendSampledWaypoint([], { x: -1, y: 10 }),
    /inside the pitch/,
  );
});

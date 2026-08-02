export const DEFAULT_PATH_SAMPLE_DISTANCE = 2;
export const DEFAULT_PATH_POINT_LIMIT = 40;

function clonePoint(point) {
  return { x: point.x, y: point.y };
}

function assertPoint(point, label) {
  if (
    !point ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    point.x < 0 ||
    point.x > 100 ||
    point.y < 0 ||
    point.y > 100
  ) {
    throw new RangeError(`${label} must stay inside the pitch.`);
  }
}

function assertWaypointIndex(waypoints, index, allowEnd = false) {
  const maximum = allowEnd ? waypoints.length : waypoints.length - 1;
  if (!Number.isInteger(index) || index < 0 || index > maximum) {
    throw new RangeError(`Unknown waypoint index ${index}.`);
  }
}

export function appendSampledWaypoint(
  waypoints,
  point,
  {
    minimumDistance = DEFAULT_PATH_SAMPLE_DISTANCE,
    maximumPoints = DEFAULT_PATH_POINT_LIMIT,
  } = {},
) {
  assertPoint(point, "point");
  if (!Number.isFinite(minimumDistance) || minimumDistance <= 0) {
    throw new RangeError("minimumDistance must be greater than zero.");
  }
  if (!Number.isInteger(maximumPoints) || maximumPoints < 1) {
    throw new RangeError("maximumPoints must be a positive integer.");
  }
  const cloned = waypoints.map(clonePoint);
  if (cloned.length >= maximumPoints) {
    return cloned;
  }
  const last = cloned.at(-1);
  if (last && Math.hypot(point.x - last.x, point.y - last.y) < minimumDistance) {
    return cloned;
  }
  return [...cloned, clonePoint(point)];
}

export function moveWaypoint(waypoints, index, point) {
  assertWaypointIndex(waypoints, index);
  assertPoint(point, "point");
  return waypoints.map((waypoint, waypointIndex) =>
    waypointIndex === index ? clonePoint(point) : clonePoint(waypoint),
  );
}

export function insertWaypoint(waypoints, index, point) {
  assertWaypointIndex(waypoints, index, true);
  assertPoint(point, "point");
  const cloned = waypoints.map(clonePoint);
  cloned.splice(index, 0, clonePoint(point));
  return cloned;
}

export function removeWaypoint(waypoints, index) {
  assertWaypointIndex(waypoints, index);
  return waypoints
    .filter((_, waypointIndex) => waypointIndex !== index)
    .map(clonePoint);
}

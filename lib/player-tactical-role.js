export const PLAYER_TACTICAL_ROLE_VERSION = 1;

const TACTICAL_LEVELS = new Set(["low", "balanced", "high"]);
const FORWARD_RUNS = new Set([
  "hold",
  "balanced",
  "overlap",
  "underlap",
]);
const PREFERRED_ZONES = new Set([
  "balanced",
  "wide",
  "half-space",
  "central",
]);

const BASE_ROLE = Object.freeze({
  forwardRun: "balanced",
  preferredZone: "balanced",
  lateralRange: "balanced",
  verticalRange: "balanced",
  defensiveDepth: "balanced",
  crossing: "balanced",
  shooting: "balanced",
  passing: "balanced",
  carrying: "balanced",
  pressing: "balanced",
});

function preset(id, group, label, description, overrides = {}) {
  return Object.freeze({
    id,
    group,
    label,
    description,
    settings: Object.freeze({ ...BASE_ROLE, ...overrides }),
  });
}

export const PLAYER_TACTICAL_ROLE_PRESETS = Object.freeze([
  preset(
    "goalkeeper-balanced",
    "goalkeeper",
    "균형 골키퍼",
    "골문 보호를 우선하며 짧게 빌드업을 지원합니다.",
    { forwardRun: "hold", verticalRange: "low", carrying: "low" },
  ),
  preset(
    "goalkeeper-sweeper",
    "goalkeeper",
    "전진 골키퍼",
    "수비 뒤 공간을 넓게 커버하고 전개에 적극 참여합니다.",
    { verticalRange: "high", passing: "high", defensiveDepth: "high" },
  ),
  preset(
    "centerback-balanced",
    "centerback",
    "균형 센터백",
    "라인을 지키며 안전한 전개와 커버를 수행합니다.",
    { forwardRun: "hold", shooting: "low", carrying: "low" },
  ),
  preset(
    "centerback-progressor",
    "centerback",
    "전진 센터백",
    "공간이 열리면 전진하며 전진 패스와 운반을 시도합니다.",
    { passing: "high", carrying: "high", verticalRange: "high" },
  ),
  preset(
    "fullback-balanced",
    "fullback",
    "균형 풀백",
    "측면 폭과 후방 안정성을 상황에 맞춰 조절합니다.",
    { preferredZone: "wide", shooting: "low" },
  ),
  preset(
    "fullback-overlap",
    "fullback",
    "오버래핑 풀백",
    "측면 바깥을 따라 전진해 크로스 지점을 만듭니다.",
    {
      forwardRun: "overlap",
      preferredZone: "wide",
      lateralRange: "high",
      verticalRange: "high",
      crossing: "high",
    },
  ),
  preset(
    "fullback-underlap",
    "fullback",
    "언더래핑 풀백",
    "하프스페이스로 전진해 중앙 연결과 침투를 지원합니다.",
    {
      forwardRun: "underlap",
      preferredZone: "half-space",
      verticalRange: "high",
      passing: "high",
    },
  ),
  preset(
    "fullback-hold",
    "fullback",
    "잔류 풀백",
    "후방 위치를 지키고 전환 상황의 수비 균형을 보호합니다.",
    {
      forwardRun: "hold",
      verticalRange: "low",
      defensiveDepth: "low",
      crossing: "low",
    },
  ),
  preset(
    "midfield-balanced",
    "midfield",
    "균형 미드필더",
    "중앙 연결과 압박을 균형 있게 수행합니다.",
    { preferredZone: "central" },
  ),
  preset(
    "midfield-anchor",
    "midfield",
    "후방 균형 미드필더",
    "수비 앞 공간을 지키며 패스 연결을 우선합니다.",
    {
      forwardRun: "hold",
      preferredZone: "central",
      verticalRange: "low",
      defensiveDepth: "low",
      passing: "high",
      shooting: "low",
    },
  ),
  preset(
    "midfield-runner",
    "midfield",
    "전진 왕복 미드필더",
    "넓은 상하 활동량으로 공격과 수비를 연결합니다.",
    {
      lateralRange: "high",
      verticalRange: "high",
      carrying: "high",
      pressing: "high",
    },
  ),
  preset(
    "midfield-playmaker",
    "midfield",
    "전진 플레이메이커",
    "하프스페이스에서 전진 패스와 슈팅 기회를 찾습니다.",
    {
      preferredZone: "half-space",
      passing: "high",
      shooting: "high",
      carrying: "low",
    },
  ),
  preset(
    "wide-balanced",
    "wide",
    "균형 측면 공격수",
    "측면과 안쪽 공간을 상황에 따라 오갑니다.",
    { preferredZone: "wide", lateralRange: "high" },
  ),
  preset(
    "wide-touchline",
    "wide",
    "터치라인 윙어",
    "폭을 최대한 넓히고 크로스를 우선합니다.",
    {
      preferredZone: "wide",
      lateralRange: "high",
      crossing: "high",
      shooting: "low",
    },
  ),
  preset(
    "wide-inside",
    "wide",
    "인사이드 공격수",
    "하프스페이스와 중앙으로 침투해 슈팅을 노립니다.",
    {
      forwardRun: "underlap",
      preferredZone: "half-space",
      verticalRange: "high",
      crossing: "low",
      shooting: "high",
      carrying: "high",
    },
  ),
  preset(
    "striker-balanced",
    "striker",
    "균형 스트라이커",
    "중앙에서 연계와 침투를 상황에 맞춰 선택합니다.",
    { preferredZone: "central", crossing: "low" },
  ),
  preset(
    "striker-advanced",
    "striker",
    "침투 스트라이커",
    "높은 위치에서 뒷공간 침투와 슈팅을 우선합니다.",
    {
      preferredZone: "central",
      verticalRange: "high",
      shooting: "high",
      passing: "low",
      pressing: "high",
    },
  ),
  preset(
    "striker-link",
    "striker",
    "연계 스트라이커",
    "중앙에서 내려와 동료와 패스 연결을 만듭니다.",
    {
      forwardRun: "hold",
      preferredZone: "central",
      passing: "high",
      shooting: "balanced",
    },
  ),
]);

const PRESETS_BY_ID = new Map(
  PLAYER_TACTICAL_ROLE_PRESETS.map((candidate) => [candidate.id, candidate]),
);

const DEFAULT_PRESET_BY_GROUP = Object.freeze({
  goalkeeper: "goalkeeper-balanced",
  centerback: "centerback-balanced",
  fullback: "fullback-balanced",
  midfield: "midfield-balanced",
  wide: "wide-balanced",
  striker: "striker-balanced",
});

export const PLAYER_TACTICAL_ROLE_OPTIONS = Object.freeze({
  forwardRun: Object.freeze([
    { value: "hold", label: "잔류" },
    { value: "balanced", label: "균형" },
    { value: "overlap", label: "오버래핑" },
    { value: "underlap", label: "언더래핑" },
  ]),
  preferredZone: Object.freeze([
    { value: "balanced", label: "상황에 맞춤" },
    { value: "wide", label: "측면" },
    { value: "half-space", label: "하프스페이스" },
    { value: "central", label: "중앙" },
  ]),
  level: Object.freeze([
    { value: "low", label: "낮음" },
    { value: "balanced", label: "보통" },
    { value: "high", label: "높음" },
  ]),
});

export function tacticalRoleGroupForFormationRole(role) {
  if (typeof role !== "string" || role.length === 0) {
    throw new TypeError("Formation role must be a non-empty string.");
  }
  const normalized = role.toUpperCase();
  if (normalized === "GK") {
    return "goalkeeper";
  }
  if (/(?:LB|RB|WB)$/.test(normalized)) {
    return "fullback";
  }
  if (/(?:CB)$/.test(normalized) || normalized === "DF") {
    return "centerback";
  }
  if (/(?:LW|RW|LM|RM)$/.test(normalized)) {
    return "wide";
  }
  if (/(?:DM|CM|AM)$/.test(normalized) || normalized === "MF") {
    return "midfield";
  }
  if (/(?:ST|CF)$/.test(normalized) || normalized === "FW") {
    return "striker";
  }
  throw new RangeError(`Unsupported formation role: ${role}`);
}

export function tacticalRolePresetsForFormationRole(role) {
  const group = tacticalRoleGroupForFormationRole(role);
  return PLAYER_TACTICAL_ROLE_PRESETS.filter(
    (candidate) => candidate.group === group,
  );
}

export function applyPlayerTacticalRolePreset(role, presetId) {
  const roleGroup = tacticalRoleGroupForFormationRole(role);
  const selected = PRESETS_BY_ID.get(presetId);
  if (!selected || selected.group !== roleGroup) {
    throw new RangeError(`Preset ${presetId} is not valid for ${role}.`);
  }
  return {
    presetId: selected.id,
    roleGroup,
    ...selected.settings,
  };
}

export function createDefaultPlayerTacticalRole(role) {
  const roleGroup = tacticalRoleGroupForFormationRole(role);
  return applyPlayerTacticalRolePreset(role, DEFAULT_PRESET_BY_GROUP[roleGroup]);
}

function assertRoleSettings(settings, label = "tacticalRole") {
  if (!settings || typeof settings !== "object") {
    throw new TypeError(`${label} must be an object.`);
  }
  if (
    typeof settings.presetId !== "string" ||
    settings.presetId.length === 0 ||
    typeof settings.roleGroup !== "string" ||
    !Object.hasOwn(DEFAULT_PRESET_BY_GROUP, settings.roleGroup)
  ) {
    throw new RangeError(`${label} requires a supported preset and role group.`);
  }
  if (!FORWARD_RUNS.has(settings.forwardRun)) {
    throw new RangeError(`${label}.forwardRun is unsupported.`);
  }
  if (!PREFERRED_ZONES.has(settings.preferredZone)) {
    throw new RangeError(`${label}.preferredZone is unsupported.`);
  }
  for (const field of [
    "lateralRange",
    "verticalRange",
    "defensiveDepth",
    "crossing",
    "shooting",
    "passing",
    "carrying",
    "pressing",
  ]) {
    if (!TACTICAL_LEVELS.has(settings[field])) {
      throw new RangeError(`${label}.${field} is unsupported.`);
    }
  }
}

export function validatePlayerTacticalRole(settings, expectedRole) {
  assertRoleSettings(settings);
  if (
    expectedRole &&
    settings.roleGroup !== tacticalRoleGroupForFormationRole(expectedRole)
  ) {
    throw new RangeError("Tactical role does not match the formation role group.");
  }
  return { ...settings };
}

export function customizePlayerTacticalRole(settings, patch) {
  assertRoleSettings(settings);
  if (!patch || typeof patch !== "object") {
    throw new TypeError("Tactical role patch must be an object.");
  }
  const next = {
    ...settings,
    ...patch,
    presetId: "custom",
    roleGroup: settings.roleGroup,
  };
  assertRoleSettings(next);
  return next;
}

export function reconcilePlayerTacticalRoles(settingsByPlayerId, lineup) {
  if (
    !settingsByPlayerId ||
    typeof settingsByPlayerId !== "object" ||
    Array.isArray(settingsByPlayerId)
  ) {
    throw new TypeError("Player tactical roles must be keyed by player ID.");
  }
  if (!Array.isArray(lineup)) {
    throw new TypeError("Lineup must be an array.");
  }

  return Object.fromEntries(
    lineup.map((entry, index) => {
      const playerId = entry?.playerId ?? entry?.player?.id;
      const role = entry?.role;
      if (typeof playerId !== "string" || playerId.length === 0) {
        throw new TypeError(`lineup[${index}] requires a player ID.`);
      }
      const roleGroup = tacticalRoleGroupForFormationRole(role);
      const existing = settingsByPlayerId[playerId];
      return [
        playerId,
        existing && existing.roleGroup === roleGroup
          ? validatePlayerTacticalRole(existing, role)
          : createDefaultPlayerTacticalRole(role),
      ];
    }),
  );
}

export function serializePlayerTacticalRoles(settingsByPlayerId) {
  if (
    !settingsByPlayerId ||
    typeof settingsByPlayerId !== "object" ||
    Array.isArray(settingsByPlayerId)
  ) {
    throw new TypeError("Player tactical roles must be keyed by player ID.");
  }
  const players = Object.entries(settingsByPlayerId)
    .map(([playerId, settings]) => {
      if (!playerId) {
        throw new TypeError("Player tactical role IDs must be non-empty.");
      }
      return { playerId, settings: validatePlayerTacticalRole(settings) };
    })
    .sort((left, right) => left.playerId.localeCompare(right.playerId));
  return JSON.stringify({ version: PLAYER_TACTICAL_ROLE_VERSION, players });
}

export function deserializePlayerTacticalRoles(serialized, lineup = []) {
  if (serialized === null || serialized === undefined || serialized === "") {
    return reconcilePlayerTacticalRoles({}, lineup);
  }
  if (typeof serialized !== "string") {
    throw new TypeError("Serialized player tactical roles must be a string.");
  }
  const document = JSON.parse(serialized);
  if (document?.version !== PLAYER_TACTICAL_ROLE_VERSION) {
    throw new RangeError("Unsupported player tactical role version.");
  }
  if (!Array.isArray(document.players)) {
    throw new TypeError("Serialized player tactical roles require players.");
  }
  const settingsByPlayerId = {};
  for (const [index, entry] of document.players.entries()) {
    if (
      typeof entry?.playerId !== "string" ||
      entry.playerId.length === 0 ||
      Object.hasOwn(settingsByPlayerId, entry.playerId)
    ) {
      throw new RangeError(`players[${index}] requires a unique player ID.`);
    }
    settingsByPlayerId[entry.playerId] = validatePlayerTacticalRole(
      entry.settings,
    );
  }
  return lineup.length > 0
    ? reconcilePlayerTacticalRoles(settingsByPlayerId, lineup)
    : settingsByPlayerId;
}

export function tacticalLevelValue(level) {
  if (!TACTICAL_LEVELS.has(level)) {
    throw new RangeError(`Unsupported tactical level: ${level}`);
  }
  return level === "low" ? 0 : level === "high" ? 2 : 1;
}

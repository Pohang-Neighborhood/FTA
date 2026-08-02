"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  PITCH_BOUNDS,
  clamp,
  mergePlacementOverrides,
  mirrorFormationSlots,
  nearestPlacementId,
  toPitchPosition,
  toPitchPositionWithOffset,
} from "../lib/tactics-core.js";
import {
  appendTacticalSequence,
  appendTacticalInstruction,
  createDefaultTacticalSequence,
  isMovementInstruction,
  nextSequentialInstructionTimeMs,
  reorderTacticalSequence,
  removeTacticalInstruction,
  removeTacticalSequence,
  replaceTacticalInstruction,
  replaceTacticalSequence,
  sortTacticalSequences,
  sortTacticalInstructions,
  validateTacticalSequences,
} from "../lib/instruction-model.js";
import {
  createParticipantId,
  positionForFormationRole,
  selectDefaultLineup,
} from "../lib/player-catalog.js";
import {
  lineupCompatibility,
  replaceLineupSlot,
  sortLineupCandidates,
  swapLineupSlots,
} from "../lib/lineup-editor.js";
import {
  appendSampledWaypoint,
  insertWaypoint,
  moveWaypoint,
  removeWaypoint,
} from "../lib/path-editing.js";
import { invalidateDependentInstructions } from "../lib/sequence-invalidation.js";
import { compactPlayerName } from "../lib/player-name.js";
import {
  PLAYER_TACTICAL_ROLE_OPTIONS,
  applyPlayerTacticalRolePreset,
  createDefaultPlayerTacticalRole,
  customizePlayerTacticalRole,
  reconcilePlayerTacticalRoles,
  tacticalRolePresetsForFormationRole,
} from "../lib/player-tactical-role.js";
import {
  MAX_SIMULATION_DURATION_MS,
  SIMULATION_TICK_MS,
  compileSimulation,
  eventsBetween,
  sampleSimulation,
  summarizeSimulation,
} from "../lib/simulation-core.js";
import {
  formations,
  type Formation,
  type FormationSlot,
} from "./formations";
import type {
  ParticipantId,
  PitchPoint,
  PlayerTacticalRole,
  SimulatorPlayer,
  SimulatorTeam,
  TeamSide,
} from "./simulator-types";

type SimulationWorkspaceProps = {
  teams: SimulatorTeam[];
};

type LineupParticipant = {
  participantId: ParticipantId;
  teamSide: TeamSide;
  role: string;
  player: SimulatorPlayer;
};

type Placement = PitchPoint & {
  role: string;
};

type PlacementMap = Record<string, Placement>;
type PlacementOverrideMap = Record<string, PitchPoint>;
type SetupStep = "teams" | "formations" | "simulator";
type LineupSelection = {
  teamId: string;
  formationId: string;
  playerIds: string[];
};

function positionGroupClass(role: string) {
  return `sim-player-position-${positionForFormationRole(role).toLowerCase()}`;
}

const FORMATION_ROLE_LABELS: Record<string, string> = {
  GK: "골키퍼",
  LB: "왼쪽 풀백",
  LCB: "왼쪽 센터백",
  CB: "센터백",
  RCB: "오른쪽 센터백",
  RB: "오른쪽 풀백",
  LWB: "왼쪽 윙백",
  RWB: "오른쪽 윙백",
  LDM: "왼쪽 수비형 미드필더",
  DM: "수비형 미드필더",
  RDM: "오른쪽 수비형 미드필더",
  LM: "왼쪽 미드필더",
  LCM: "왼쪽 중앙 미드필더",
  CM: "중앙 미드필더",
  RCM: "오른쪽 중앙 미드필더",
  RM: "오른쪽 미드필더",
  LAM: "왼쪽 공격형 미드필더",
  AM: "공격형 미드필더",
  RAM: "오른쪽 공격형 미드필더",
  LW: "왼쪽 윙어",
  LST: "왼쪽 스트라이커",
  ST: "스트라이커",
  RST: "오른쪽 스트라이커",
  RW: "오른쪽 윙어",
};

const PLAYER_POSITION_LABELS: Record<SimulatorPlayer["position"], string> = {
  GK: "골키퍼",
  DF: "수비수",
  MF: "미드필더",
  FW: "공격수",
};

function formationRoleLabel(role: string) {
  return FORMATION_ROLE_LABELS[role] ?? role;
}

function playerPositionLabel(position: SimulatorPlayer["position"]) {
  return PLAYER_POSITION_LABELS[position];
}

type DragState = {
  participantId: ParticipantId;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  grabOffsetX: number;
  grabOffsetY: number;
  moved: boolean;
  originalOverride?: PitchPoint;
};

type BallDragState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  grabOffsetX: number;
  grabOffsetY: number;
  moved: boolean;
  originalOwnerId: ParticipantId | "";
  originalPosition: PitchPoint | null;
  dropTargets: Record<string, PitchPoint>;
};

type PathDrawState = {
  pointerId: number;
  originalWaypoints: PitchPoint[];
  waypoints: PitchPoint[];
};

type WaypointDragState = {
  pointerId: number;
  index: number;
  originalWaypoints: PitchPoint[];
  waypoints: PitchPoint[];
};

type PassDragState = {
  pointerId: number;
  dropTargets: Record<string, PitchPoint>;
};

type DirectActionDragState = {
  participantId: ParticipantId;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  sequenceId: string;
  atMs: number;
  type: "move" | "carry";
  waypoints: PitchPoint[];
  dropTargets: Record<string, PitchPoint>;
  moved: boolean;
};

type MovementInstruction = {
  id: string;
  order: number;
  type: "move" | "carry";
  playerId: ParticipantId;
  atMs: number;
  waypoints: PitchPoint[];
};

type PassInstruction = {
  id: string;
  order: number;
  type: "pass";
  playerId: ParticipantId;
  atMs: number;
  targetPlayerId: ParticipantId;
};

type TacticalInstruction = MovementInstruction | PassInstruction;

type TacticalSequence = {
  id: string;
  order: number;
  name: string;
  instructions: TacticalInstruction[];
};

function cloneSequenceState(sequences: TacticalSequence[]) {
  return sortTacticalSequences(sequences) as TacticalSequence[];
}

type MovementActionDraft = {
  type: "move" | "carry";
  sequenceId: string;
  playerId: ParticipantId;
  atMs: number;
  waypoints: PitchPoint[];
  instructionId?: string;
  order?: number;
};

type PassActionDraft = {
  type: "pass";
  sequenceId: string;
  playerId: ParticipantId;
  atMs: number;
  instructionId?: string;
  order?: number;
};

type ActionDraft = MovementActionDraft | PassActionDraft;

type ManualActionOffset = {
  sequenceId: string;
  playerId: ParticipantId;
  atMs: number;
};

type PlannedMovementPath = {
  instruction: MovementInstruction;
  points: PitchPoint[];
  cancellationReason?: string;
};

type SimulationEvent = {
  type: string;
  atMs: number;
  passId?: string;
  sequenceId?: string;
  instructionId?: string;
  instructionType?: string;
  playerId?: string;
  fromPlayerId?: string;
  toPlayerId?: string;
  reason?: string;
};

type FramePlayer = {
  id: string;
  team: TeamSide;
  role: string;
  mode: "manual" | "automatic";
  behavior: string;
  position: PitchPoint;
  target: PitchPoint;
  speedMps: number;
  distanceM: number;
  routeRemainingM: number | null;
  arrived: boolean;
  arrivedAtMs: number | null;
};

type SimulationFrame = {
  elapsedMs: number;
  players: Record<string, FramePlayer>;
  ball: {
    kind: "controlled" | "inFlight" | "loose";
    position: PitchPoint;
    target?: PitchPoint;
    ownerId?: string;
    passId?: string;
    fromPlayerId?: string;
    toPlayerId?: string;
  };
  metrics: {
    teams: Record<
      TeamSide,
      {
        widthM: number;
        depthM: number;
        centroid: PitchPoint;
        averageNearestTeammateDistanceM: number;
      }
    >;
    players: Record<
      string,
      {
        nearestTeammateM: number;
        nearestOpponentM: number;
      }
    >;
  };
  tactics: Record<
    TeamSide,
    {
      phase:
        | "loose-ball"
        | "build-up"
        | "progression"
        | "final-third"
        | "defensive-transition"
        | "organized-defense";
      inPossession: boolean;
      progress: number | null;
      defensiveLineY: number;
      defensiveWidth: number;
      pressureCount: number;
      restDefenseCount: number;
      offsideTrapRequested: boolean;
      offsideTrapActive: boolean;
    }
  >;
  events: SimulationEvent[];
};

type SimulationRun = {
  tickMs: number;
  durationMs: number;
  frames: SimulationFrame[];
  config: Record<string, number>;
  sequenceTimeline?: Array<{
    id: string;
    order: number;
    name: string;
    instructionIds: string[];
    startedAtMs: number | null;
    completedAtMs: number | null;
    status: "waiting" | "running" | "completed" | "timed_out";
    startSnapshot: SimulationFrame | null;
    endSnapshot: SimulationFrame | null;
  }>;
};

type SimulationSummary = {
  players: Record<
    string,
    {
      team: TeamSide;
      mode: string;
      distanceM: number;
      arrivedAtMs: number | null;
    }
  >;
  teams: Record<
    TeamSide,
    {
      widthChangeM: number;
      depthChangeM: number;
      spacingChangeM: number;
    }
  >;
  passes: {
    attempted: number;
    received: number;
    intercepted: number;
    incomplete: number;
    cancelled: number;
    recovered: number;
  };
};

const DEFAULT_DURATION_MS = 12_000;
const INITIAL_SEQUENCE_ID = "sequence-1";

function createWorkspaceSequence(
  id: string,
  order: number,
  name: string,
) {
  return createDefaultTacticalSequence({
    id,
    order,
    name,
    instructions: [],
  }) as TacticalSequence;
}

function createInitialSequences() {
  return [createWorkspaceSequence(INITIAL_SEQUENCE_ID, 1, "시퀀스 1")];
}

const abilityLabels: Array<[keyof SimulatorPlayer["abilities"], string]> = [
  ["overall", "종합"],
  ["speed", "속도"],
  ["acceleration", "가속"],
  ["sprintSpeed", "최고 속도"],
  ["agility", "민첩성"],
  ["balance", "균형"],
  ["stamina", "지구력"],
  ["strength", "힘"],
  ["passing", "패스"],
  ["ballControl", "볼 컨트롤"],
  ["attacking", "공격"],
  ["defending", "수비"],
  ["positioning", "위치 선정"],
  ["reactions", "반응"],
  ["decisionMaking", "판단"],
];

const goalkeeperAbilityLabels: Array<
  [keyof NonNullable<SimulatorPlayer["goalkeeperAbilities"]>, string]
> = [
  ["diving", "다이빙"],
  ["handling", "핸들링"],
  ["distribution", "배급"],
  ["positioning", "GK 위치 선정"],
  ["reflexes", "반사 신경"],
  ["sweeping", "스위핑"],
];

type EditableTacticalRoleField = Exclude<
  keyof PlayerTacticalRole,
  "presetId" | "roleGroup"
>;

const tacticalRoleFields: Array<{
  field: EditableTacticalRoleField;
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}> = [
  {
    field: "forwardRun",
    label: "전진 방식",
    options: PLAYER_TACTICAL_ROLE_OPTIONS.forwardRun,
  },
  {
    field: "preferredZone",
    label: "선호 구역",
    options: PLAYER_TACTICAL_ROLE_OPTIONS.preferredZone,
  },
  {
    field: "lateralRange",
    label: "좌우 활동 범위",
    options: PLAYER_TACTICAL_ROLE_OPTIONS.level,
  },
  {
    field: "verticalRange",
    label: "상하 활동 범위",
    options: PLAYER_TACTICAL_ROLE_OPTIONS.level,
  },
  {
    field: "defensiveDepth",
    label: "수비 전진 깊이",
    options: PLAYER_TACTICAL_ROLE_OPTIONS.level,
  },
  {
    field: "crossing",
    label: "크로스 성향",
    options: PLAYER_TACTICAL_ROLE_OPTIONS.level,
  },
  {
    field: "shooting",
    label: "슛 성향",
    options: PLAYER_TACTICAL_ROLE_OPTIONS.level,
  },
  {
    field: "passing",
    label: "패스 성향",
    options: PLAYER_TACTICAL_ROLE_OPTIONS.level,
  },
  {
    field: "carrying",
    label: "볼 운반 성향",
    options: PLAYER_TACTICAL_ROLE_OPTIONS.level,
  },
  {
    field: "pressing",
    label: "압박 성향",
    options: PLAYER_TACTICAL_ROLE_OPTIONS.level,
  },
];

const automaticBehaviorLabels: Record<string, string> = {
  hold: "위치 유지",
  "hold-position": "후방 잔류",
  shape: "대형 유지",
  support: "공격 지원",
  overlap: "오버래핑",
  underlap: "언더래핑",
  pressure: "압박",
  cover: "커버",
  block: "차단 위치",
  recover: "루즈볼 회수",
  manual: "수동 경로",
  "ball-carrier": "볼 운반",
  "ball-carrier-pass": "패스 준비",
  "ball-carrier-cross": "크로스 준비",
  "ball-carrier-shoot": "슈팅 준비",
  "goalkeeper-support": "후방 빌드업 지원",
  "goalkeeper-reaction": "골문 대응",
  "rest-defense": "후방 균형",
  "defensive-line": "수비라인 유지",
  "offside-line": "오프사이드 라인",
};

const tacticalPhaseLabels: Record<
  SimulationFrame["tactics"][TeamSide]["phase"],
  string
> = {
  "loose-ball": "루즈볼 경합",
  "build-up": "후방 빌드업",
  "progression": "전진 전개",
  "final-third": "파이널 서드",
  "defensive-transition": "수비 전환",
  "organized-defense": "조직 수비",
};

function preferredTeamId(
  teams: SimulatorTeam[],
  preferredName: string,
  fallbackIndex: number,
) {
  const preferred = teams.find(
    (team) => team.name.toLowerCase() === preferredName.toLowerCase(),
  );
  return preferred?.id ?? teams[fallbackIndex]?.id ?? teams[0]?.id ?? "";
}

function formationById(formationId: string, fallbackIndex = 0) {
  return (
    formations.find((formation) => formation.id === formationId) ??
    formations[fallbackIndex] ??
    formations[0]
  );
}

function normalizedDuration(value: number) {
  const finiteValue = Number.isFinite(value) ? value : DEFAULT_DURATION_MS;
  return Math.min(
    MAX_SIMULATION_DURATION_MS,
    Math.max(
      SIMULATION_TICK_MS * 2,
      Math.round(finiteValue / SIMULATION_TICK_MS) * SIMULATION_TICK_MS,
    ),
  );
}

function normalizedSequenceOffset(
  value: number,
  durationMs: number,
) {
  const finiteValue = Number.isFinite(value) ? value : 0;
  const maximum = Math.max(0, durationMs - SIMULATION_TICK_MS);
  return Math.min(
    maximum,
    Math.max(
      0,
      Math.round(finiteValue / SIMULATION_TICK_MS) * SIMULATION_TICK_MS,
    ),
  );
}

function normalizeManualActionOffsetForTimeline(
  current: ManualActionOffset | null,
  sequences: TacticalSequence[],
  durationMs: number,
) {
  if (!current) {
    return null;
  }
  const sorted = sortTacticalSequences(sequences) as TacticalSequence[];
  const sequence = sorted.find(
    (sequence) => sequence.id === current.sequenceId,
  );
  if (!sequence) {
    return null;
  }
  const atMs = normalizedSequenceOffset(current.atMs, durationMs);
  return atMs === current.atMs ? current : { ...current, atMs };
}

function mirroredSlots(formation: Formation) {
  return mirrorFormationSlots(formation.slots) as FormationSlot[];
}

function selectLineup(
  catalog: SimulatorPlayer[],
  teamId: string,
  teamSide: TeamSide,
  formation: Formation,
) {
  if (!teamId) {
    return [];
  }
  return selectDefaultLineup(catalog, {
    teamId,
    teamSide,
    formationSlots: formation.slots,
  }) as LineupParticipant[];
}

function applyLineupSelection(
  defaultLineup: LineupParticipant[],
  team: SimulatorTeam | undefined,
  selection: LineupSelection | null,
  teamSide: TeamSide,
  formationId: string,
) {
  if (
    !selection ||
    !team ||
    selection.teamId !== team.id ||
    selection.formationId !== formationId
  ) {
    return defaultLineup;
  }
  if (
    selection.playerIds.length !== defaultLineup.length ||
    new Set(selection.playerIds).size !== selection.playerIds.length
  ) {
    throw new RangeError("선발 명단은 중복 없는 11명으로 구성해야 합니다.");
  }

  const playersById = new Map(team.players.map((player) => [player.id, player]));
  const selectedPlayers = selection.playerIds.map((playerId) => {
    const player = playersById.get(playerId);
    if (!player) {
      throw new RangeError("선발 명단에 현재 팀 소속이 아닌 선수가 있습니다.");
    }
    return player;
  });
  if (selectedPlayers.filter((player) => player.position === "GK").length !== 1) {
    throw new RangeError("선발 명단에는 골키퍼가 정확히 한 명 필요합니다.");
  }

  return defaultLineup.map((participant, index) => {
    const player = selectedPlayers[index];
    return {
      ...participant,
      participantId: createParticipantId(teamSide, player.id) as ParticipantId,
      player,
    };
  });
}

function lineupSelectionKey(selection: LineupSelection | null) {
  return selection
    ? `${selection.teamId}:${selection.formationId}:${selection.playerIds.join(",")}`
    : "auto";
}

function SetupFormationPreview({
  teamName,
  formation,
  lineup,
  teamSide,
  selectedSlotIndex = null,
  onSelectSlot,
}: {
  teamName: string;
  formation: Formation;
  lineup: LineupParticipant[];
  teamSide: TeamSide;
  selectedSlotIndex?: number | null;
  onSelectSlot?: (slotIndex: number) => void;
}) {
  const slots = teamSide === "away" ? mirroredSlots(formation) : formation.slots;

  return (
    <div className="sim-setup-preview">
      <div className="sim-setup-mini-pitch" aria-hidden="true">
        <div className="sim-setup-mini-halfway" />
        <div className="sim-setup-mini-circle" />
        {lineup.map((participant, index) => {
          const slot = slots[index];
          return (
            <span
              key={participant.participantId}
              className={`sim-setup-mini-player sim-setup-mini-player-${teamSide}${selectedSlotIndex === index ? " is-selected" : ""}`}
              style={
                {
                  left: `${slot.x}%`,
                  top: `${slot.y}%`,
                } as CSSProperties
              }
            >
              <strong>{participant.player.number}</strong>
              <small>{participant.role}</small>
              <em>{compactPlayerName(participant.player.name)}</em>
            </span>
          );
        })}
      </div>
      <ol className="sim-setup-lineup" aria-label={`${teamName} 선발 명단`}>
        {lineup.map((participant, index) => (
          <li
            key={participant.participantId}
            className={selectedSlotIndex === index ? "is-selected" : ""}
          >
            {onSelectSlot ? (
              <button
                type="button"
                aria-pressed={selectedSlotIndex === index}
                aria-label={`${participant.role} ${formationRoleLabel(participant.role)} 슬롯, ${participant.player.number}번 ${participant.player.name} 교체 대상 선택`}
                onClick={() => onSelectSlot(index)}
              >
                <span className="sim-setup-lineup-role">
                  <b>{participant.role}</b>
                  <small>{formationRoleLabel(participant.role)}</small>
                </span>
                <strong className="sim-setup-lineup-number">
                  {participant.player.number}
                </strong>
                <span className="sim-setup-lineup-identity">
                  <small>{participant.player.name}</small>
                  <em>
                    {participant.player.position} · {participant.player.club}
                  </em>
                  <span className="sim-setup-name-tooltip" role="tooltip">
                    {participant.player.name}
                  </span>
                </span>
              </button>
            ) : (
              <div
                tabIndex={0}
                aria-label={`${participant.role} ${formationRoleLabel(participant.role)} 슬롯, ${participant.player.number}번 ${participant.player.name}, ${playerPositionLabel(participant.player.position)}, ${participant.player.club}`}
              >
                <span className="sim-setup-lineup-role">
                  <b>{participant.role}</b>
                  <small>{formationRoleLabel(participant.role)}</small>
                </span>
                <strong className="sim-setup-lineup-number">
                  {participant.player.number}
                </strong>
                <span className="sim-setup-lineup-identity">
                  <small>{participant.player.name}</small>
                  <em>
                    {participant.player.position} · {participant.player.club}
                  </em>
                  <span className="sim-setup-name-tooltip" role="tooltip">
                    {participant.player.name}
                  </span>
                </span>
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function createPlacements(
  homeLineup: LineupParticipant[],
  awayLineup: LineupParticipant[],
  homeFormation: Formation,
  awayFormation: Formation,
): PlacementMap {
  const home = homeLineup.map((participant, index) => {
    const slot = homeFormation.slots[index];
    return [
      participant.participantId,
      { role: participant.role, x: slot.x, y: slot.y },
    ] as const;
  });
  const awaySlots = mirroredSlots(awayFormation);
  const away = awayLineup.map((participant, index) => {
    const slot = awaySlots[index];
    return [
      participant.participantId,
      { role: participant.role, x: slot.x, y: slot.y },
    ] as const;
  });
  return Object.fromEntries([...home, ...away]);
}

function simplifyPath(points: PitchPoint[]) {
  return points.filter((candidate, index) => {
    if (index === 0) {
      return true;
    }
    const previous = points[index - 1];
    return (
      Math.abs(candidate.x - previous.x) > 0.01 ||
      Math.abs(candidate.y - previous.y) > 0.01
    );
  });
}

function polylinePoints(points: PitchPoint[]) {
  return points.map((candidate) => `${candidate.x},${candidate.y}`).join(" ");
}

function seconds(milliseconds: number | null | undefined) {
  return milliseconds === null || milliseconds === undefined
    ? "—"
    : `${(milliseconds / 1_000).toFixed(2)}초`;
}

function metres(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : `${value.toFixed(1)}m`;
}

function eventDescription(
  event: SimulationEvent,
  participantsById: Map<string, LineupParticipant>,
) {
  const playerName = (playerId: string | undefined) =>
    playerId
      ? participantsById.get(playerId)?.player.name ?? playerId
      : "알 수 없는 선수";
  switch (event.type) {
    case "pass_started":
      return `${seconds(event.atMs)} ${playerName(event.fromPlayerId)} → ${playerName(event.toPlayerId)} 패스 시작`;
    case "pass_received":
      return `${seconds(event.atMs)} ${playerName(event.playerId)} 패스 수신`;
    case "pass_intercepted":
      return `${seconds(event.atMs)} ${playerName(event.playerId)} 패스 차단`;
    case "pass_incomplete":
      return `${seconds(event.atMs)} 패스 미완료`;
    case "pass_cancelled":
      return `${seconds(event.atMs)} 패스 취소 · ${event.reason ?? "실행 조건 불충족"}`;
    case "instruction_cancelled": {
      const action = event.instructionType === "carry" ? "볼 운반" : "이동";
      const reason =
        event.reason === "player_busy"
          ? "이전 이동이 끝나지 않음"
          : event.reason === "no_possession"
            ? "공 소유권 없음"
            : event.reason ?? "실행 조건 불충족";
      return `${seconds(event.atMs)} ${playerName(event.playerId)} ${action} 취소 · ${reason}`;
    }
    case "instruction_completed":
      return `${seconds(event.atMs)} ${playerName(event.playerId)} ${event.instructionType === "carry" ? "볼 운반" : "이동"} 완료`;
    case "sequence_started":
      return `${seconds(event.atMs)} ${event.sequenceId ?? "시퀀스"} 시작`;
    case "sequence_completed":
      return `${seconds(event.atMs)} ${event.sequenceId ?? "시퀀스"} 완료`;
    case "sequence_timed_out":
      return `${seconds(event.atMs)} ${event.sequenceId ?? "시퀀스"} 시간 초과`;
    case "ball_recovered":
      return `${seconds(event.atMs)} ${playerName(event.playerId)} 루즈볼 회수`;
    default:
      return `${seconds(event.atMs)} ${event.type}`;
  }
}

type WorkspaceRunSource = {
  durationMs: number;
  participants: LineupParticipant[];
  placements: PlacementMap;
  initialBallPosition: PitchPoint | null;
  initialBallOwnerId: ParticipantId | "";
  sequences: TacticalSequence[];
  playerTacticalRoles: Record<string, PlayerTacticalRole>;
  lineupError: string | null;
};

function compileWorkspaceRun({
  durationMs,
  participants,
  placements,
  initialBallPosition,
  initialBallOwnerId,
  sequences,
  playerTacticalRoles,
  lineupError,
}: WorkspaceRunSource) {
  if (
    participants.length !== 22 ||
    (!initialBallPosition && !initialBallOwnerId) ||
    lineupError
  ) {
    throw new Error(
      lineupError ?? "양 팀 선발 11명과 초기 공 위치가 필요합니다.",
    );
  }
  const scenario = {
    durationMs,
    players: participants.map((participant) => ({
      id: participant.participantId,
      team: participant.teamSide,
      role: participant.role,
      position: {
        x: placements[participant.participantId].x,
        y: placements[participant.participantId].y,
      },
      abilities: { ...participant.player.abilities },
      ...(participant.teamSide === "home"
        ? {
            tacticalRole:
              playerTacticalRoles[participant.player.id] ??
              createDefaultPlayerTacticalRole(participant.role),
          }
        : {}),
    })),
    ...(initialBallPosition
      ? { initialBallPosition: { ...initialBallPosition } }
      : { initialBallOwnerId }),
    sequences: validateTacticalSequences(sequences),
  };
  return compileSimulation(scenario) as SimulationRun;
}

export function SimulationWorkspace({ teams }: SimulationWorkspaceProps) {
  const defaultHomeTeamId = useMemo(
    () => preferredTeamId(teams, "South Korea", 0),
    [teams],
  );
  const defaultAwayTeamId = useMemo(
    () => preferredTeamId(teams, "Brazil", teams.length > 1 ? 1 : 0),
    [teams],
  );
  const [homeTeamId, setHomeTeamId] = useState(defaultHomeTeamId);
  const [awayTeamId, setAwayTeamId] = useState(defaultAwayTeamId);
  const [homeFormationId, setHomeFormationId] = useState(
    formations[0]?.id ?? "",
  );
  const [awayFormationId, setAwayFormationId] = useState(
    formations[1]?.id ?? formations[0]?.id ?? "",
  );
  const [setupStep, setSetupStep] = useState<SetupStep>("teams");
  const [hasEnteredSimulator, setHasEnteredSimulator] = useState(false);
  const [draftHomeTeamId, setDraftHomeTeamId] = useState(defaultHomeTeamId);
  const [draftAwayTeamId, setDraftAwayTeamId] = useState(defaultAwayTeamId);
  const [draftHomeFormationId, setDraftHomeFormationId] = useState(
    formations[0]?.id ?? "",
  );
  const [draftAwayFormationId, setDraftAwayFormationId] = useState(
    formations[1]?.id ?? formations[0]?.id ?? "",
  );
  const [showSetupResetConfirmation, setShowSetupResetConfirmation] =
    useState(false);
  const [homeLineupSelection, setHomeLineupSelection] =
    useState<LineupSelection | null>(null);
  const [draftHomeLineupSelection, setDraftHomeLineupSelection] =
    useState<LineupSelection | null>(null);
  const [selectedDraftLineupSlot, setSelectedDraftLineupSlot] =
    useState<number | null>(null);
  const [selectedParticipantId, setSelectedParticipantId] =
    useState<ParticipantId | null>(null);
  const [placementOverrides, setPlacementOverrides] =
    useState<PlacementOverrideMap>({});
  const [playerTacticalRoles, setPlayerTacticalRoles] = useState<
    Record<string, PlayerTacticalRole>
  >({});
  const [draggingParticipantId, setDraggingParticipantId] =
    useState<ParticipantId | null>(null);
  const [sequences, setSequences] = useState<TacticalSequence[]>(
    createInitialSequences,
  );
  const [selectedSequenceId, setSelectedSequenceId] = useState("");
  const [activeAction, setActiveAction] = useState<ActionDraft | null>(null);
  const [selectedWaypointIndex, setSelectedWaypointIndex] = useState<
    number | null
  >(null);
  const [passDragPosition, setPassDragPosition] = useState<PitchPoint | null>(
    null,
  );
  const [manualActionOffset, setManualActionOffset] =
    useState<ManualActionOffset | null>(null);
  const [targetCursor, setTargetCursor] = useState<PitchPoint>({ x: 50, y: 50 });
  const [ballOwnerId, setBallOwnerId] = useState<ParticipantId | "">("");
  const [initialBallPosition, setInitialBallPosition] =
    useState<PitchPoint | null>(null);
  const [isDraggingBall, setIsDraggingBall] = useState(false);
  const [durationMs, setDurationMs] = useState(DEFAULT_DURATION_MS);
  const [run, setRun] = useState<SimulationRun | null>(null);
  const [cursorMs, setCursorMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState(
    "시퀀스를 선택한 뒤 우리 팀 선수에게 이동·볼 운반·패스를 지정하세요.",
  );

  const pitchRef = useRef<HTMLDivElement>(null);
  const targetCursorRef = useRef<HTMLButtonElement>(null);
  const sequenceSelectRefs = useRef(
    new Map<string, HTMLButtonElement>(),
  );
  const pendingSequenceFocusRef = useRef<string | null>(null);
  const shouldFocusTargetCursorRef = useRef(false);
  const shouldFocusPassTargetRef = useRef(false);
  const dragRef = useRef<DragState | null>(null);
  const ballDragRef = useRef<BallDragState | null>(null);
  const pathDrawRef = useRef<PathDrawState | null>(null);
  const waypointDragRef = useRef<WaypointDragState | null>(null);
  const passDragRef = useRef<PassDragState | null>(null);
  const directActionDragRef = useRef<DirectActionDragState | null>(null);
  const suppressClickRef = useRef<ParticipantId | null>(null);
  const suppressBallClickRef = useRef(false);
  const suppressPitchClickRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);
  const cursorRef = useRef(0);
  const nextInstructionOrderRef = useRef(1);
  const nextSequenceIdRef = useRef(2);
  const sequenceUndoRef = useRef<TacticalSequence[][]>([]);
  const sequenceRedoRef = useRef<TacticalSequence[][]>([]);
  const previousSequencesRef = useRef(sequences);
  const suppressSequenceHistoryRef = useRef(false);
  const [sequenceHistoryCounts, setSequenceHistoryCounts] = useState({
    undo: 0,
    redo: 0,
  });

  const catalog = useMemo(
    () => teams.flatMap((team) => team.players),
    [teams],
  );
  const homeTeam = teams.find((team) => team.id === homeTeamId);
  const awayTeam = teams.find((team) => team.id === awayTeamId);
  const homeFormation = formationById(homeFormationId);
  const awayFormation = formationById(awayFormationId, 1);
  const draftHomeTeam = teams.find((team) => team.id === draftHomeTeamId);
  const draftAwayTeam = teams.find((team) => team.id === draftAwayTeamId);
  const draftHomeFormation = formationById(draftHomeFormationId);
  const draftAwayFormation = formationById(draftAwayFormationId, 1);
  const setupTeamsAreDistinct =
    Boolean(draftHomeTeamId) &&
    Boolean(draftAwayTeamId) &&
    draftHomeTeamId !== draftAwayTeamId;
  const setupHasChanges =
    draftHomeTeamId !== homeTeamId ||
    draftAwayTeamId !== awayTeamId ||
    draftHomeFormationId !== homeFormationId ||
    draftAwayFormationId !== awayFormationId ||
    lineupSelectionKey(draftHomeLineupSelection) !==
      lineupSelectionKey(homeLineupSelection);

  const setupPreviewState = useMemo(() => {
    if (!setupTeamsAreDistinct) {
      return {
        home: [] as LineupParticipant[],
        away: [] as LineupParticipant[],
        error: "우리 팀과 상대 팀은 서로 다른 국가를 선택해야 합니다.",
      };
    }
    try {
      const defaultHomeLineup = selectLineup(
        catalog,
        draftHomeTeamId,
        "home",
        draftHomeFormation,
      );
      return {
        home: applyLineupSelection(
          defaultHomeLineup,
          draftHomeTeam,
          draftHomeLineupSelection,
          "home",
          draftHomeFormationId,
        ),
        away: selectLineup(
          catalog,
          draftAwayTeamId,
          "away",
          draftAwayFormation,
        ),
        error: null,
      };
    } catch (error) {
      return {
        home: [] as LineupParticipant[],
        away: [] as LineupParticipant[],
        error:
          error instanceof Error
            ? error.message
            : "포메이션 미리보기를 준비하지 못했습니다.",
      };
    }
  }, [
    catalog,
    draftAwayFormation,
    draftAwayTeamId,
    draftHomeLineupSelection,
    draftHomeFormation,
    draftHomeFormationId,
    draftHomeTeam,
    draftHomeTeamId,
    setupTeamsAreDistinct,
  ]);

  const setupHomeLineupPlayerIds = setupPreviewState.home.map(
    (participant) => participant.player.id,
  );
  const selectedDraftLineupParticipant =
    selectedDraftLineupSlot === null
      ? undefined
      : setupPreviewState.home[selectedDraftLineupSlot];
  const setupBenchCandidates = useMemo(
    () =>
      selectedDraftLineupParticipant && draftHomeTeam
        ? sortLineupCandidates(
            draftHomeTeam.players,
            setupHomeLineupPlayerIds,
            selectedDraftLineupParticipant.role,
          )
        : [],
    [
      draftHomeTeam,
      selectedDraftLineupParticipant,
      setupHomeLineupPlayerIds,
    ],
  );
  const setupLineupSwapCandidates = useMemo(() => {
    if (!selectedDraftLineupParticipant || selectedDraftLineupSlot === null) {
      return [];
    }

    return setupPreviewState.home.flatMap((participant, slotIndex) => {
      if (slotIndex === selectedDraftLineupSlot) {
        return [];
      }
      const selectedPlayerCompatibility = lineupCompatibility(
        participant.role,
        selectedDraftLineupParticipant.player.position,
      );
      const targetPlayerCompatibility = lineupCompatibility(
        selectedDraftLineupParticipant.role,
        participant.player.position,
      );
      if (
        selectedPlayerCompatibility === "ineligible" ||
        targetPlayerCompatibility === "ineligible"
      ) {
        return [];
      }
      return [
        {
          participant,
          slotIndex,
          isExact:
            selectedPlayerCompatibility === "exact" &&
            targetPlayerCompatibility === "exact",
        },
      ];
    });
  }, [
    selectedDraftLineupParticipant,
    selectedDraftLineupSlot,
    setupPreviewState.home,
  ]);
  const setupHomeBenchPlayers = useMemo(() => {
    const selected = new Set(setupHomeLineupPlayerIds);
    const positionOrder = new Map([
      ["GK", 0],
      ["DF", 1],
      ["MF", 2],
      ["FW", 3],
    ]);
    return [...(draftHomeTeam?.players ?? [])]
      .filter((player) => !selected.has(player.id))
      .sort(
        (left, right) =>
          (positionOrder.get(left.position) ?? 9) -
            (positionOrder.get(right.position) ?? 9) ||
          right.abilities.overall - left.abilities.overall ||
          left.name.localeCompare(right.name) ||
          left.id.localeCompare(right.id),
      );
  }, [draftHomeTeam, setupHomeLineupPlayerIds]);

  const lineupState = useMemo(() => {
    try {
      const defaultHomeLineup = selectLineup(
        catalog,
        homeTeamId,
        "home",
        homeFormation,
      );
      return {
        home: applyLineupSelection(
          defaultHomeLineup,
          homeTeam,
          homeLineupSelection,
          "home",
          homeFormationId,
        ),
        away: selectLineup(catalog, awayTeamId, "away", awayFormation),
        error: null,
      };
    } catch (error) {
      return {
        home: [] as LineupParticipant[],
        away: [] as LineupParticipant[],
        error: error instanceof Error ? error.message : "선발 명단을 구성하지 못했습니다.",
      };
    }
  }, [
    awayFormation,
    awayTeamId,
    catalog,
    homeFormation,
    homeFormationId,
    homeLineupSelection,
    homeTeam,
    homeTeamId,
  ]);

  const participants = useMemo(
    () => [...lineupState.home, ...lineupState.away],
    [lineupState.away, lineupState.home],
  );
  const homeParticipants = lineupState.home;
  const effectivePlayerTacticalRoles = useMemo(
    () =>
      reconcilePlayerTacticalRoles(
        playerTacticalRoles,
        homeParticipants.map((participant) => ({
          playerId: participant.player.id,
          role: participant.role,
        })),
      ) as Record<string, PlayerTacticalRole>,
    [homeParticipants, playerTacticalRoles],
  );
  const defaultPlacements = useMemo(
    () =>
      createPlacements(
        lineupState.home,
        lineupState.away,
        homeFormation,
        awayFormation,
      ),
    [awayFormation, homeFormation, lineupState.away, lineupState.home],
  );
  const placements = useMemo(
    () =>
      mergePlacementOverrides(
        defaultPlacements,
        placementOverrides,
      ) as PlacementMap,
    [defaultPlacements, placementOverrides],
  );
  const participantsById = useMemo(
    () =>
      new Map<string, LineupParticipant>(
        participants.map((participant) => [
          participant.participantId,
          participant,
        ]),
    ),
    [participants],
  );
  const defaultOwner =
    homeParticipants.find((participant) => participant.role.includes("ST")) ??
    homeParticipants.find((participant) => participant.role !== "GK") ??
    homeParticipants[0];
  const effectiveSelectedParticipantId =
    selectedParticipantId && participantsById.has(selectedParticipantId)
      ? selectedParticipantId
      : null;
  const effectiveBallOwnerId =
    ballOwnerId && participantsById.has(ballOwnerId)
      ? ballOwnerId
      : defaultOwner?.participantId ?? "";
  const selectedParticipant = effectiveSelectedParticipantId
    ? participantsById.get(effectiveSelectedParticipantId)
    : undefined;

  const sortedSequences = useMemo(
    () => sortTacticalSequences(sequences) as TacticalSequence[],
    [sequences],
  );
  const effectiveSelectedSequenceId = sortedSequences.some(
    (sequence) => sequence.id === selectedSequenceId,
  )
    ? selectedSequenceId
    : "";
  const selectedSequence = sortedSequences.find(
    (sequence) => sequence.id === effectiveSelectedSequenceId,
  );
  const sortedInstructions = useMemo(
    () =>
      sortedSequences.flatMap(
        (sequence) =>
          sortTacticalInstructions(
            sequence.instructions,
          ) as TacticalInstruction[],
      ),
    [sortedSequences],
  );
  const confirmedMovementInstructions = useMemo(
    () =>
      sortedInstructions.filter(
        (instruction): instruction is MovementInstruction =>
          isMovementInstruction(instruction),
      ),
    [sortedInstructions],
  );
  const instructedPlayerIds = useMemo(
    () =>
      new Set(
        confirmedMovementInstructions.map(
          (instruction) => instruction.playerId,
        ),
      ),
    [confirmedMovementInstructions],
  );
  const displaySequences = useMemo(() => {
    if (
      !activeAction ||
      activeAction.type === "pass" ||
      activeAction.waypoints.length === 0
    ) {
      return sortedSequences;
    }
    const draftInstruction: MovementInstruction = {
      id: activeAction.instructionId ?? "instruction-draft",
      order: activeAction.order ?? Number.MAX_SAFE_INTEGER,
      type: activeAction.type,
      playerId: activeAction.playerId,
      atMs: activeAction.atMs,
      waypoints: activeAction.waypoints.map((waypoint) => ({ ...waypoint })),
    };
    return sortedSequences.map((sequence) => {
      if (sequence.id !== activeAction.sequenceId) {
        return sequence;
      }
      const nextInstructions = activeAction.instructionId
        ? sequence.instructions.map((instruction) =>
            instruction.id === activeAction.instructionId
              ? draftInstruction
              : instruction,
          )
        : [...sequence.instructions, draftInstruction];
      return {
        ...sequence,
        instructions: sortTacticalInstructions(
          nextInstructions,
        ) as TacticalInstruction[],
      };
    });
  }, [activeAction, sortedSequences]);
  const displayInstructions = useMemo(
    () =>
      (sortTacticalInstructions(
        displaySequences.find(
          (sequence) => sequence.id === effectiveSelectedSequenceId,
        )?.instructions ?? [],
      ) as TacticalInstruction[]),
    [displaySequences, effectiveSelectedSequenceId],
  );
  const instructionPreviewRun = useMemo(() => {
    if (draggingParticipantId || isDraggingBall) {
      return null;
    }
    try {
      return compileWorkspaceRun({
        durationMs,
        participants,
        placements,
        initialBallPosition,
        initialBallOwnerId: effectiveBallOwnerId,
        sequences: displaySequences,
        playerTacticalRoles: effectivePlayerTacticalRoles,
        lineupError: lineupState.error,
      });
    } catch {
      return null;
    }
  }, [
    displaySequences,
    draggingParticipantId,
    durationMs,
    effectiveBallOwnerId,
    initialBallPosition,
    isDraggingBall,
    lineupState.error,
    participants,
    effectivePlayerTacticalRoles,
    placements,
  ]);
  const routeRun = activeAction
    ? instructionPreviewRun
    : run ?? instructionPreviewRun;
  const instructionStartAtMsById = useMemo(() => {
    const starts = new Map<string, number>();
    for (const sequence of displaySequences) {
      const startedAtMs = routeRun?.sequenceTimeline?.find(
        (timeline) => timeline.id === sequence.id,
      )?.startedAtMs;
      if (startedAtMs === null || startedAtMs === undefined) {
        continue;
      }
      for (const instruction of sequence.instructions) {
        starts.set(instruction.id, startedAtMs + instruction.atMs);
      }
    }
    return starts;
  }, [displaySequences, routeRun]);
  const instructionCancellationById = useMemo(() => {
    const cancellations = new Map<string, string>();
    const events =
      routeRun?.frames.flatMap((candidate) => candidate.events) ?? [];
    for (const event of events) {
      const instructionId =
        event.type === "instruction_cancelled"
          ? event.instructionId
          : event.type === "pass_cancelled"
            ? event.passId
            : undefined;
      if (instructionId) {
        cancellations.set(instructionId, event.reason ?? "실행 조건 불충족");
      }
    }
    return cancellations;
  }, [routeRun]);
  const instructionCompletedAtMsById = useMemo(() => {
    const terminals = new Map<string, number>();
    const events =
      instructionPreviewRun?.frames.flatMap(
        (candidate) => candidate.events,
      ) ?? [];
    for (const event of events) {
      const instructionId =
        event.type === "instruction_completed"
          ? event.instructionId
          : event.type === "pass_received"
            ? event.passId
            : undefined;
      if (instructionId && Number.isFinite(event.atMs)) {
        terminals.set(instructionId, event.atMs);
      }
    }
    return terminals;
  }, [instructionPreviewRun]);
  const plannedMovementPaths = useMemo(() => {
    const lastPositionByPlayer = new Map<string, PitchPoint>(
      Object.entries(placements).map(([participantId, placement]) => [
        participantId,
        { x: placement.x, y: placement.y },
      ]),
    );
    return displayInstructions.flatMap((instruction) => {
      if (!isMovementInstruction(instruction)) {
        return [];
      }
      const movement = instruction as MovementInstruction;
      const instructionStartAtMs = instructionStartAtMsById.get(movement.id);
      const instructionFrame =
        routeRun && instructionStartAtMs !== undefined
          ? (sampleSimulation(routeRun, instructionStartAtMs) as SimulationFrame)
          : null;
      const start =
        instructionFrame?.players[movement.playerId]?.position ??
        lastPositionByPlayer.get(movement.playerId);
      if (!start || movement.waypoints.length === 0) {
        return [];
      }
      const points = [
        start,
        ...movement.waypoints.map((point) => ({ ...point })),
      ];
      const cancellationReason = instructionCancellationById.get(movement.id);
      if (!routeRun && !cancellationReason) {
        lastPositionByPlayer.set(movement.playerId, {
          ...movement.waypoints.at(-1)!,
        });
      }
      return [
        {
          instruction: movement,
          points,
          ...(cancellationReason ? { cancellationReason } : {}),
        } satisfies PlannedMovementPath,
      ];
    });
  }, [
    displayInstructions,
    instructionCancellationById,
    instructionStartAtMsById,
    placements,
    routeRun,
  ]);
  const plannedPassPaths = useMemo(
    () =>
      displayInstructions.flatMap((instruction) => {
        if (instruction.type !== "pass") {
          return [];
        }
        const instructionStartAtMs = instructionStartAtMsById.get(
          instruction.id,
        );
        const instructionFrame =
          routeRun && instructionStartAtMs !== undefined
            ? (sampleSimulation(
                routeRun,
                instructionStartAtMs,
              ) as SimulationFrame)
            : null;
        const from =
          instructionFrame?.players[instruction.playerId]?.position ??
          placements[instruction.playerId];
        const to =
          (instructionFrame?.ball.kind === "inFlight" &&
          instructionFrame.ball.passId === instruction.id
            ? instructionFrame.ball.target
            : undefined) ??
          instructionFrame?.players[instruction.targetPlayerId]?.position ??
          placements[instruction.targetPlayerId];
        return from && to
          ? [
              {
                instruction,
                points: [from, to] as PitchPoint[],
                cancellationReason: instructionCancellationById.get(
                  instruction.id,
                ),
              },
            ]
          : [];
      }),
    [
      instructionCancellationById,
      instructionStartAtMsById,
      placements,
      routeRun,
      displayInstructions,
    ],
  );
  const selectedManualActionOffset =
    manualActionOffset?.sequenceId === effectiveSelectedSequenceId &&
    manualActionOffset.playerId === effectiveSelectedParticipantId
      ? manualActionOffset
      : null;
  const nextActionAtMs = selectedManualActionOffset?.atMs ?? 0;

  const selectedSequenceStartFrame = useMemo(
    () =>
      instructionPreviewRun?.sequenceTimeline?.find(
        (timeline) => timeline.id === effectiveSelectedSequenceId,
      )?.startSnapshot ?? null,
    [effectiveSelectedSequenceId, instructionPreviewRun],
  );
  const playbackFrame = useMemo(
    () =>
      run
        ? (sampleSimulation(run, cursorMs) as SimulationFrame)
        : null,
    [cursorMs, run],
  );
  const frame =
    isPlaying || cursorMs > 0
      ? playbackFrame
      : selectedSequenceStartFrame ?? playbackFrame;
  const summary = useMemo(
    () =>
      run
        ? (summarizeSimulation(run) as SimulationSummary)
        : null,
    [run],
  );
  const hasPlayerTacticalRoleChanges = homeParticipants.some(
    (participant) =>
      effectivePlayerTacticalRoles[participant.player.id]?.presetId !==
      createDefaultPlayerTacticalRole(participant.role).presetId,
  );
  const hasScenarioChanges =
    sortedSequences.length > 1 ||
    sortedSequences[0]?.name !== "시퀀스 1" ||
    sortedSequences.some((sequence) => sequence.instructions.length > 0) ||
    Object.keys(placementOverrides).length > 0 ||
    initialBallPosition !== null ||
    ballOwnerId !== "" ||
    hasPlayerTacticalRoleChanges ||
    run !== null ||
    cursorMs > 0;
  const canUndoSequenceEdit = sequenceHistoryCounts.undo > 0;
  const canRedoSequenceEdit = sequenceHistoryCounts.redo > 0;

  const automaticPaths = useMemo(() => {
    if (!run || (!isPlaying && cursorMs === 0)) {
      return [] as Array<{ participantId: string; points: PitchPoint[] }>;
    }
    return participants
      .filter(
        (participant) => !instructedPlayerIds.has(participant.participantId),
      )
      .map((participant) => ({
        participantId: participant.participantId,
        points: simplifyPath(
          run.frames.map(
            (candidate) =>
              candidate.players[participant.participantId]?.position ??
              placements[participant.participantId],
          ),
        ),
      }));
  }, [cursorMs, instructedPlayerIds, isPlaying, participants, placements, run]);

  const visibleEvents = useMemo(
    () =>
      run
        ? run.frames
            .flatMap((candidate) => candidate.events)
            .filter((event) => event.atMs <= cursorMs)
        : [],
    [cursorMs, run],
  );
  const sequenceStatusById = useMemo(() => {
    const statuses = new Map<
      string,
      "waiting" | "current" | "executed" | "timed-out"
    >();
    if (!isPlaying && cursorMs === 0) {
      const selectedIndex = sortedSequences.findIndex(
        (sequence) => sequence.id === effectiveSelectedSequenceId,
      );
      sortedSequences.forEach((sequence, index) => {
        statuses.set(
          sequence.id,
          index < selectedIndex
            ? "executed"
            : index === selectedIndex
              ? "current"
              : "waiting",
        );
      });
      return statuses;
    }
    const timeline = run?.sequenceTimeline ?? [];
    sortedSequences.forEach((sequence) => {
      const entry = timeline.find((candidate) => candidate.id === sequence.id);
      statuses.set(
        sequence.id,
        entry?.startedAtMs === null || entry?.startedAtMs === undefined ||
          cursorMs < entry.startedAtMs
          ? "waiting"
          : entry.status === "timed_out" && cursorMs >= durationMs
            ? "timed-out"
          : entry.completedAtMs !== null &&
              entry.completedAtMs !== undefined &&
              cursorMs >= entry.completedAtMs
            ? "executed"
            : "current",
      );
    });
    return statuses;
  }, [cursorMs, durationMs, effectiveSelectedSequenceId, isPlaying, run, sortedSequences]);
  const currentPlaybackSequence = isPlaying
    ? sortedSequences.find(
        (sequence) => sequenceStatusById.get(sequence.id) === "current",
      )
    : undefined;
  const liveStatusMessage = currentPlaybackSequence
    ? `${currentPlaybackSequence.name} 실행 중 · ${statusMessage}`
    : statusMessage;

  useEffect(() => {
    cursorRef.current = cursorMs;
  }, [cursorMs]);

  useEffect(() => {
    if (previousSequencesRef.current === sequences) {
      return;
    }
    if (
      JSON.stringify(cloneSequenceState(previousSequencesRef.current)) ===
      JSON.stringify(cloneSequenceState(sequences))
    ) {
      previousSequencesRef.current = sequences;
      return;
    }
    if (suppressSequenceHistoryRef.current) {
      suppressSequenceHistoryRef.current = false;
      previousSequencesRef.current = sequences;
      return;
    }
    sequenceUndoRef.current.push(
      cloneSequenceState(previousSequencesRef.current),
    );
    if (sequenceUndoRef.current.length > 30) {
      sequenceUndoRef.current.shift();
    }
    sequenceRedoRef.current = [];
    previousSequencesRef.current = sequences;
    setSequenceHistoryCounts({
      undo: sequenceUndoRef.current.length,
      redo: sequenceRedoRef.current.length,
    });
  }, [sequences]);

  useEffect(() => {
    const sequenceId = pendingSequenceFocusRef.current;
    if (!sequenceId) {
      return;
    }
    pendingSequenceFocusRef.current = null;
    sequenceSelectRefs.current.get(sequenceId)?.focus();
  }, [sortedSequences]);

  useEffect(() => {
    if (!activeAction) {
      return;
    }
    if (
      shouldFocusTargetCursorRef.current &&
      activeAction.type !== "pass"
    ) {
      shouldFocusTargetCursorRef.current = false;
      targetCursorRef.current?.focus();
      return;
    }
    if (shouldFocusPassTargetRef.current && activeAction.type === "pass") {
      shouldFocusPassTargetRef.current = false;
      const targetId = homeParticipants.find(
        (participant) =>
          participant.participantId !== activeAction.playerId,
      )?.participantId;
      const targetToken = Array.from(
        pitchRef.current?.querySelectorAll<HTMLButtonElement>(
          "[data-sim-token]",
        ) ?? [],
      ).find((candidate) => candidate.dataset.simToken === targetId);
      targetToken?.focus();
    }
  }, [activeAction, homeParticipants]);

  useEffect(() => {
    if (!isPlaying || !run) {
      return;
    }

    const startedAt = performance.now();
    const startedCursor = cursorRef.current;
    let previousCursor =
      startedCursor === 0 ? -Number.EPSILON : startedCursor;

    const animate = (now: number) => {
      const nextCursor = Math.min(
        run.durationMs,
        startedCursor + (now - startedAt),
      );
      const newEvents = eventsBetween(
        run,
        previousCursor,
        nextCursor,
      ) as SimulationEvent[];
      previousCursor = nextCursor;
      cursorRef.current = nextCursor;
      setCursorMs(nextCursor);

      if (newEvents.length > 0) {
        setStatusMessage(
          eventDescription(newEvents.at(-1)!, participantsById),
        );
      }
      if (nextCursor >= run.durationMs) {
        setIsPlaying(false);
        setStatusMessage("시뮬레이션 재생이 완료되었습니다.");
        return;
      }
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isPlaying, participantsById, run]);

  function invalidateCompilation(message?: string) {
    setIsPlaying(false);
    setRun(null);
    setCompileError(null);
    cursorRef.current = 0;
    setCursorMs(0);
    if (message) {
      setStatusMessage(message);
    }
  }

  function invalidationMessage(message: string, removedCount: number) {
    return removedCount > 0
      ? `${message} 시작 상태가 달라진 후속 지시 ${removedCount}개를 삭제했습니다.`
      : message;
  }

  function invalidateForInitialPlayerChange(playerId: ParticipantId) {
    const ballChanged =
      initialBallPosition === null && effectiveBallOwnerId === playerId;
    const result = invalidateDependentInstructions(sequences, {
      playerIds: [playerId],
      ball: ballChanged,
    });
    const nextSequences = result.sequences as TacticalSequence[];
    setSequences(nextSequences);
    resetSequenceHistory(nextSequences);
    return result.removedInstructionIds.length;
  }

  function invalidateForInitialBallChange() {
    const result = invalidateDependentInstructions(sequences, { ball: true });
    const nextSequences = result.sequences as TacticalSequence[];
    setSequences(nextSequences);
    resetSequenceHistory(nextSequences);
    return result.removedInstructionIds.length;
  }

  function applySelectedTacticalRolePreset(presetId: string) {
    if (
      !selectedParticipant ||
      selectedParticipant.teamSide !== "home" ||
      isPlaying ||
      activeAction
    ) {
      return;
    }
    const nextRole = applyPlayerTacticalRolePreset(
      selectedParticipant.role,
      presetId,
    ) as PlayerTacticalRole;
    setPlayerTacticalRoles((current) => ({
      ...current,
      [selectedParticipant.player.id]: nextRole,
    }));
    const preset = tacticalRolePresetsForFormationRole(
      selectedParticipant.role,
    ).find((candidate) => candidate.id === presetId);
    invalidateCompilation(
      `${selectedParticipant.player.name}에게 ${preset?.label ?? "전술 역할"}을 적용했습니다.`,
    );
  }

  function updateSelectedTacticalRole(
    field: EditableTacticalRoleField,
    value: string,
  ) {
    if (
      !selectedParticipant ||
      selectedParticipant.teamSide !== "home" ||
      !effectivePlayerTacticalRoles[selectedParticipant.player.id] ||
      isPlaying ||
      activeAction
    ) {
      return;
    }
    const nextRole = customizePlayerTacticalRole(
      effectivePlayerTacticalRoles[selectedParticipant.player.id],
      { [field]: value },
    ) as PlayerTacticalRole;
    setPlayerTacticalRoles((current) => ({
      ...current,
      [selectedParticipant.player.id]: nextRole,
    }));
    invalidateCompilation(
      `${selectedParticipant.player.name}의 세부 전술 성향을 변경했습니다.`,
    );
  }

  function resetSelectedTacticalRole() {
    if (
      !selectedParticipant ||
      selectedParticipant.teamSide !== "home" ||
      isPlaying ||
      activeAction
    ) {
      return;
    }
    const nextRole = createDefaultPlayerTacticalRole(
      selectedParticipant.role,
    ) as PlayerTacticalRole;
    setPlayerTacticalRoles((current) => ({
      ...current,
      [selectedParticipant.player.id]: nextRole,
    }));
    invalidateCompilation(
      `${selectedParticipant.player.name}의 전술 역할을 포지션 기본값으로 되돌렸습니다.`,
    );
  }

  function resetSequenceHistory(nextSequences: TacticalSequence[]) {
    sequenceUndoRef.current = [];
    sequenceRedoRef.current = [];
    previousSequencesRef.current = nextSequences;
    suppressSequenceHistoryRef.current = false;
    setSequenceHistoryCounts({ undo: 0, redo: 0 });
  }

  function resetScenarioForSetup(message: string) {
    const initialSequences = createInitialSequences();
    setSelectedParticipantId(null);
    setDraggingParticipantId(null);
    setIsDraggingBall(false);
    setActiveAction(null);
    setSequences(initialSequences);
    resetSequenceHistory(initialSequences);
    setSelectedSequenceId("");
    setManualActionOffset(null);
    setTargetCursor({ x: 50, y: 50 });
    setBallOwnerId("");
    setInitialBallPosition(null);
    setPlacementOverrides({});
    dragRef.current = null;
    ballDragRef.current = null;
    suppressClickRef.current = null;
    suppressBallClickRef.current = false;
    nextInstructionOrderRef.current = 1;
    nextSequenceIdRef.current = 2;
    invalidateCompilation(message);
  }

  function changeDraftTeam(side: TeamSide, teamId: string) {
    if (side === "home") {
      setDraftHomeTeamId(teamId);
      setDraftHomeLineupSelection(null);
      setSelectedDraftLineupSlot(null);
      return;
    }
    setDraftAwayTeamId(teamId);
  }

  function changeDraftFormation(side: TeamSide, formationId: string) {
    if (side === "home") {
      setDraftHomeFormationId(formationId);
      setDraftHomeLineupSelection(null);
      setSelectedDraftLineupSlot(null);
      return;
    }
    setDraftAwayFormationId(formationId);
  }

  function replaceDraftHomeLineupPlayer(incomingPlayerId: string) {
    if (selectedDraftLineupSlot === null) {
      return;
    }
    try {
      const nextPlayerIds = replaceLineupSlot(
        setupHomeLineupPlayerIds,
        selectedDraftLineupSlot,
        incomingPlayerId,
      );
      setDraftHomeLineupSelection({
        teamId: draftHomeTeamId,
        formationId: draftHomeFormationId,
        playerIds: nextPlayerIds,
      });
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "선수를 교체하지 못했습니다.",
      );
    }
  }

  function swapDraftHomeLineupPlayers(targetSlotIndex: number) {
    if (selectedDraftLineupSlot === null) {
      return;
    }
    try {
      const nextPlayerIds = swapLineupSlots(
        setupHomeLineupPlayerIds,
        selectedDraftLineupSlot,
        targetSlotIndex,
      );
      setDraftHomeLineupSelection({
        teamId: draftHomeTeamId,
        formationId: draftHomeFormationId,
        playerIds: nextPlayerIds,
      });
      setSelectedDraftLineupSlot(null);
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "선발 선수의 포지션을 변경하지 못했습니다.",
      );
    }
  }

  function resetDraftHomeLineup() {
    setDraftHomeLineupSelection(null);
    setSelectedDraftLineupSlot(null);
  }

  function openInitialSetup() {
    setIsPlaying(false);
    setDraftHomeTeamId(homeTeamId);
    setDraftAwayTeamId(awayTeamId);
    setDraftHomeFormationId(homeFormationId);
    setDraftAwayFormationId(awayFormationId);
    setDraftHomeLineupSelection(
      homeLineupSelection
        ? {
            ...homeLineupSelection,
            playerIds: [...homeLineupSelection.playerIds],
          }
        : null,
    );
    setSelectedDraftLineupSlot(null);
    setShowSetupResetConfirmation(false);
    setSetupStep("formations");
  }

  function cancelInitialSetup() {
    setDraftHomeTeamId(homeTeamId);
    setDraftAwayTeamId(awayTeamId);
    setDraftHomeFormationId(homeFormationId);
    setDraftAwayFormationId(awayFormationId);
    setDraftHomeLineupSelection(
      homeLineupSelection
        ? {
            ...homeLineupSelection,
            playerIds: [...homeLineupSelection.playerIds],
          }
        : null,
    );
    setSelectedDraftLineupSlot(null);
    setShowSetupResetConfirmation(false);
    setSetupStep("simulator");
    setStatusMessage("기존 팀·포메이션 설정을 유지했습니다.");
  }

  function applyInitialSetup() {
    if (!setupTeamsAreDistinct || setupPreviewState.error) {
      return;
    }

    setHomeTeamId(draftHomeTeamId);
    setAwayTeamId(draftAwayTeamId);
    setHomeFormationId(draftHomeFormationId);
    setAwayFormationId(draftAwayFormationId);
    setHomeLineupSelection(
      draftHomeLineupSelection
        ? {
            ...draftHomeLineupSelection,
            playerIds: [...draftHomeLineupSelection.playerIds],
          }
        : null,
    );
    setPlayerTacticalRoles((current) =>
      reconcilePlayerTacticalRoles(
        current,
        setupPreviewState.home.map((participant) => ({
          playerId: participant.player.id,
          role: participant.role,
        })),
      ) as Record<string, PlayerTacticalRole>,
    );
    setHasEnteredSimulator(true);
    setShowSetupResetConfirmation(false);
    setSetupStep("simulator");

    if (!hasEnteredSimulator || setupHasChanges) {
      resetScenarioForSetup(
        hasEnteredSimulator
          ? "새 팀·포메이션을 적용하고 기존 배치·지시·재생 상태를 초기화했습니다."
          : "팀·포메이션 설정을 적용했습니다. 전술 지시를 시작하세요.",
      );
    } else {
      setStatusMessage("기존 팀·포메이션 설정을 유지했습니다.");
    }
  }

  function requestInitialSetupApply() {
    if (
      hasEnteredSimulator &&
      setupHasChanges &&
      hasScenarioChanges
    ) {
      setShowSetupResetConfirmation(true);
      return;
    }
    applyInitialSetup();
  }

  function clampToVisiblePitch(x: number, y: number) {
    const pitch = pitchRef.current;
    if (!pitch) {
      return {
        x: clamp(x, PITCH_BOUNDS.minX, PITCH_BOUNDS.maxX),
        y: clamp(y, PITCH_BOUNDS.minY, PITCH_BOUNDS.maxY),
      } as PitchPoint;
    }

    const rect = pitch.getBoundingClientRect();
    const horizontalInset = Math.max(PITCH_BOUNDS.minX, (35 / rect.width) * 100);
    const verticalInset = Math.max(PITCH_BOUNDS.minY, (34 / rect.height) * 100);
    return {
      x: clamp(x, horizontalInset, 100 - horizontalInset),
      y: clamp(y, verticalInset, 100 - verticalInset),
    } as PitchPoint;
  }

  function clampBallToVisiblePitch(x: number, y: number) {
    const pitch = pitchRef.current;
    if (!pitch) {
      return {
        x: clamp(x, PITCH_BOUNDS.minX, PITCH_BOUNDS.maxX),
        y: clamp(y, PITCH_BOUNDS.minY, PITCH_BOUNDS.maxY),
      } as PitchPoint;
    }

    const rect = pitch.getBoundingClientRect();
    const horizontalInset = Math.max(PITCH_BOUNDS.minX, (10 / rect.width) * 100);
    const verticalInset = Math.max(PITCH_BOUNDS.minY, (10 / rect.height) * 100);
    return {
      x: clamp(x, horizontalInset, 100 - horizontalInset),
      y: clamp(y, verticalInset, 100 - verticalInset),
    } as PitchPoint;
  }

  function updateBallPosition(
    clientX: number,
    clientY: number,
    grabOffsetX = 0,
    grabOffsetY = 0,
  ) {
    const pitch = pitchRef.current;
    if (!pitch) {
      return null;
    }
    const rawPosition = toPitchPositionWithOffset(
      clientX,
      clientY,
      pitch.getBoundingClientRect(),
      grabOffsetX,
      grabOffsetY,
    ) as PitchPoint;
    const nextPosition = clampBallToVisiblePitch(rawPosition.x, rawPosition.y);
    setInitialBallPosition(nextPosition);
    setBallOwnerId("");
    return nextPosition;
  }

  function handleBallPointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    displayedPosition: PitchPoint,
  ) {
    if (
      isPlaying ||
      activeAction ||
      (event.pointerType === "mouse" && event.button !== 0)
    ) {
      return;
    }
    event.stopPropagation();
    const pitch = pitchRef.current;
    if (!pitch) {
      return;
    }

    const pitchRect = pitch.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDraggingBall(true);
    ballDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      grabOffsetX:
        ((event.clientX - pitchRect.left) / pitchRect.width) * 100 -
        displayedPosition.x,
      grabOffsetY:
        ((event.clientY - pitchRect.top) / pitchRect.height) * 100 -
        displayedPosition.y,
      moved: false,
      originalOwnerId: ballOwnerId,
      originalPosition: initialBallPosition
        ? { ...initialBallPosition }
        : null,
      dropTargets: Object.fromEntries(
        participants.map((participant) => [
          participant.participantId,
          {
            ...(frame?.players[participant.participantId]?.position ??
              placements[participant.participantId]),
          },
        ]),
      ),
    };
  }

  function handleBallPointerMove(
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    const drag = ballDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const movement = Math.hypot(
      event.clientX - drag.startClientX,
      event.clientY - drag.startClientY,
    );
    if (!drag.moved && movement < 4) {
      return;
    }

    event.preventDefault();
    if (!drag.moved) {
      invalidateCompilation();
    }
    drag.moved = true;
    updateBallPosition(
      event.clientX,
      event.clientY,
      drag.grabOffsetX,
      drag.grabOffsetY,
    );
  }

  function finishBallDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    cancelled = false,
  ) {
    const drag = ballDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (cancelled) {
      setBallOwnerId(drag.originalOwnerId);
      setInitialBallPosition(drag.originalPosition);
      setStatusMessage("공 시작 위치 이동을 취소했습니다.");
    } else if (drag.moved) {
      const position = updateBallPosition(
        event.clientX,
        event.clientY,
        drag.grabOffsetX,
        drag.grabOffsetY,
      );
      const pitch = pitchRef.current;
      const nearestId =
        position && pitch
          ? nearestPlacementId(
              position,
              drag.dropTargets,
              pitch.getBoundingClientRect(),
              30,
            )
          : null;
      if (nearestId && participantsById.has(nearestId)) {
        const nextOwnerId = nearestId as ParticipantId;
        const nextOwner = participantsById.get(nextOwnerId);
        setBallOwnerId(nextOwnerId);
        setInitialBallPosition(null);
        const removedCount = invalidateForInitialBallChange();
        invalidateCompilation(
          invalidationMessage(
            `${nextOwner?.player.name ?? "선수"}를 초기 공 소유자로 지정했습니다.`,
            removedCount,
          ),
        );
      } else {
        const removedCount = invalidateForInitialBallChange();
        invalidateCompilation(
          invalidationMessage(
            "공을 초기 루즈볼 위치에 배치했습니다.",
            removedCount,
          ),
        );
      }
      suppressBallClickRef.current = true;
      window.setTimeout(() => {
        suppressBallClickRef.current = false;
      }, 0);
    }

    setIsDraggingBall(false);
    ballDragRef.current = null;
  }

  function handleBallKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const direction = {
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
    }[event.key];
    if (
      !direction ||
      isPlaying ||
      activeAction
    ) {
      return;
    }

    event.preventDefault();
    const currentPosition = ballPosition;
    const distance = event.shiftKey ? 5 : 2;
    setInitialBallPosition(
      clampBallToVisiblePitch(
        currentPosition.x + direction.x * distance,
        currentPosition.y + direction.y * distance,
      ),
    );
    setBallOwnerId("");
    const removedCount = invalidateForInitialBallChange();
    invalidateCompilation(
      invalidationMessage(
        "공 시작 위치를 방향키로 변경했습니다.",
        removedCount,
      ),
    );
  }

  function updatePlayerPosition(
    participantId: ParticipantId,
    clientX: number,
    clientY: number,
    grabOffsetX = 0,
    grabOffsetY = 0,
  ) {
    const pitch = pitchRef.current;
    if (!pitch) {
      return;
    }

    const rawPosition = toPitchPositionWithOffset(
      clientX,
      clientY,
      pitch.getBoundingClientRect(),
      grabOffsetX,
      grabOffsetY,
    ) as PitchPoint;
    const nextPosition = clampToVisiblePitch(rawPosition.x, rawPosition.y);
    setPlacementOverrides((current) => ({
      ...current,
      [participantId]: nextPosition,
    }));
  }

  function handlePlayerPointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    participantId: ParticipantId,
    displayedPosition: PitchPoint,
  ) {
    if (activeAction?.type === "pass") {
      event.stopPropagation();
      if (
        participantId !== activeAction.playerId ||
        (event.pointerType === "mouse" && event.button !== 0)
      ) {
        return;
      }
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      passDragRef.current = {
        pointerId: event.pointerId,
        dropTargets: Object.fromEntries(
          participants
            .filter(
              (participant) =>
                participant.teamSide === "home" &&
                participant.participantId !== activeAction.playerId,
            )
            .map((participant) => [
              participant.participantId,
              frame?.players[participant.participantId]?.position ??
                placements[participant.participantId],
            ]),
        ),
      };
      setPassDragPosition(displayedPosition);
      setStatusMessage("패스 출발 선수에서 받을 선수까지 드래그하세요.");
      return;
    }
    if (
      isPlaying ||
      activeAction ||
      (event.pointerType === "mouse" && event.button !== 0)
    ) {
      if (activeAction) {
        event.stopPropagation();
      }
      return;
    }

    event.stopPropagation();
    const participant = participantsById.get(participantId);
    if (
      selectedSequence &&
      participant?.teamSide === "home"
    ) {
      event.currentTarget.setPointerCapture(event.pointerId);
      setSelectedParticipantId(participantId);
      const isBallOwner = effectiveBallOwnerId === participantId;
      directActionDragRef.current = {
        participantId,
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        sequenceId: effectiveSelectedSequenceId,
        atMs:
          manualActionOffset?.sequenceId === effectiveSelectedSequenceId &&
          manualActionOffset.playerId === participantId
            ? manualActionOffset.atMs
            : 0,
        type: isBallOwner ? "carry" : "move",
        waypoints: [],
        dropTargets: Object.fromEntries(
          participants
            .filter(
              (candidate) =>
                candidate.teamSide === "home" &&
                candidate.participantId !== participantId,
            )
            .map((candidate) => [
              candidate.participantId,
              frame?.players[candidate.participantId]?.position ??
                placements[candidate.participantId],
            ]),
        ),
        moved: false,
      };
      return;
    }

    if (selectedSequence) {
      return;
    }

    const pitch = pitchRef.current;
    if (!pitch) {
      return;
    }

    const pitchRect = pitch.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedParticipantId(participantId);
    setDraggingParticipantId(participantId);
    dragRef.current = {
      participantId,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      grabOffsetX:
        ((event.clientX - pitchRect.left) / pitchRect.width) * 100 -
        displayedPosition.x,
      grabOffsetY:
        ((event.clientY - pitchRect.top) / pitchRect.height) * 100 -
        displayedPosition.y,
      moved: false,
      originalOverride: placementOverrides[participantId]
        ? { ...placementOverrides[participantId] }
        : undefined,
    };
  }

  function handlePlayerPointerMove(
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    const passDrag = passDragRef.current;
    const pitch = pitchRef.current;
    if (passDrag && passDrag.pointerId === event.pointerId && pitch) {
      event.preventDefault();
      event.stopPropagation();
      const rawPoint = toPitchPosition(
        event.clientX,
        event.clientY,
        pitch.getBoundingClientRect(),
      ) as PitchPoint;
      setPassDragPosition(clampToVisiblePitch(rawPoint.x, rawPoint.y));
      return;
    }
    const directDrag = directActionDragRef.current;
    if (
      directDrag &&
      directDrag.pointerId === event.pointerId &&
      pitch
    ) {
      const movement = Math.hypot(
        event.clientX - directDrag.startClientX,
        event.clientY - directDrag.startClientY,
      );
      if (!directDrag.moved && movement < 4) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const rawPoint = toPitchPosition(
        event.clientX,
        event.clientY,
        pitch.getBoundingClientRect(),
      ) as PitchPoint;
      const point = clampToVisiblePitch(rawPoint.x, rawPoint.y);
      directDrag.moved = true;
      directDrag.waypoints = appendSampledWaypoint(
        directDrag.waypoints,
        point,
        { minimumDistance: directDrag.waypoints.length === 0 ? 0.1 : undefined },
      ) as PitchPoint[];
      setActiveAction({
        type: directDrag.type,
        sequenceId: directDrag.sequenceId,
        playerId: directDrag.participantId,
        atMs: directDrag.atMs,
        waypoints: directDrag.waypoints,
      });
      setTargetCursor(point);
      setSelectedWaypointIndex(directDrag.waypoints.length - 1);
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const movement = Math.hypot(
      event.clientX - drag.startClientX,
      event.clientY - drag.startClientY,
    );
    if (!drag.moved && movement < 4) {
      return;
    }

    event.preventDefault();
    if (!drag.moved) {
      invalidateCompilation();
    }
    drag.moved = true;
    updatePlayerPosition(
      drag.participantId,
      event.clientX,
      event.clientY,
      drag.grabOffsetX,
      drag.grabOffsetY,
    );
  }

  function finishPlayerDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    cancelled = false,
  ) {
    const passDrag = passDragRef.current;
    if (passDrag && passDrag.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const pitch = pitchRef.current;
      const rawPosition = pitch
        ? (toPitchPosition(
            event.clientX,
            event.clientY,
            pitch.getBoundingClientRect(),
          ) as PitchPoint)
        : null;
      const position = rawPosition
        ? clampToVisiblePitch(rawPosition.x, rawPosition.y)
        : null;
      const targetPlayerId =
        !cancelled && position && pitch
          ? nearestPlacementId(
              position,
              passDrag.dropTargets,
              pitch.getBoundingClientRect(),
              34,
            )
          : null;
      if (targetPlayerId) {
        commitPassTarget(targetPlayerId as ParticipantId);
      } else {
        setStatusMessage(
          cancelled
            ? "패스 연결 드래그를 취소했습니다."
            : "받을 선수 위에서 드래그를 놓으세요. 기존 지시는 유지됩니다.",
        );
      }
      setPassDragPosition(null);
      passDragRef.current = null;
      return;
    }
    const directDrag = directActionDragRef.current;
    if (directDrag && directDrag.pointerId === event.pointerId) {
      event.stopPropagation();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (cancelled || !directDrag.moved) {
        setActiveAction(null);
        if (cancelled) {
          setStatusMessage("직접 전술 그리기를 취소했습니다.");
        }
        directActionDragRef.current = null;
        return;
      }
      const pitch = pitchRef.current;
      const rawPosition = pitch
        ? (toPitchPosition(
            event.clientX,
            event.clientY,
            pitch.getBoundingClientRect(),
          ) as PitchPoint)
        : null;
      const position = rawPosition
        ? clampToVisiblePitch(rawPosition.x, rawPosition.y)
        : null;
      const targetPlayerId =
        directDrag.type === "carry" && position && pitch
          ? nearestPlacementId(
              position,
              directDrag.dropTargets,
              pitch.getBoundingClientRect(),
              34,
            )
          : null;
      if (targetPlayerId) {
        savePassAction(
          {
            type: "pass",
            sequenceId: directDrag.sequenceId,
            playerId: directDrag.participantId,
            atMs: directDrag.atMs,
          },
          targetPlayerId as ParticipantId,
        );
      } else {
        saveMovementAction({
          type: directDrag.type,
          sequenceId: directDrag.sequenceId,
          playerId: directDrag.participantId,
          atMs: directDrag.atMs,
          waypoints: directDrag.waypoints,
        });
      }
      suppressClickRef.current = directDrag.participantId;
      window.setTimeout(() => {
        if (suppressClickRef.current === directDrag.participantId) {
          suppressClickRef.current = null;
        }
      }, 0);
      directActionDragRef.current = null;
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const participant = participantsById.get(drag.participantId);
    if (cancelled) {
      setPlacementOverrides((current) => {
        const next = { ...current };
        if (drag.originalOverride) {
          next[drag.participantId] = drag.originalOverride;
        } else {
          delete next[drag.participantId];
        }
        return next;
      });
      setStatusMessage("선수 시작 위치 이동을 취소했습니다.");
    } else if (drag.moved) {
      updatePlayerPosition(
        drag.participantId,
        event.clientX,
        event.clientY,
        drag.grabOffsetX,
        drag.grabOffsetY,
      );
      suppressClickRef.current = drag.participantId;
      window.setTimeout(() => {
        if (suppressClickRef.current === drag.participantId) {
          suppressClickRef.current = null;
        }
      }, 0);
      const removedCount = invalidateForInitialPlayerChange(
        drag.participantId,
      );
      invalidateCompilation(
        invalidationMessage(
          `${participant?.player.name ?? "선수"}의 시작 위치를 변경했습니다.`,
          removedCount,
        ),
      );
    }

    setDraggingParticipantId(null);
    dragRef.current = null;
  }

  function handlePlayerKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    participantId: ParticipantId,
  ) {
    if (
      activeAction?.type === "pass" &&
      (event.key === "Enter" || event.key === " ")
    ) {
      event.preventDefault();
      event.stopPropagation();
      commitPassTarget(participantId);
      return;
    }
    const direction = {
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
    }[event.key];

    if (
      !direction ||
      isPlaying ||
      activeAction ||
      Boolean(selectedSequence)
    ) {
      return;
    }

    event.preventDefault();
    const currentPlacement = placements[participantId];
    if (!currentPlacement) {
      return;
    }
    const distance = event.shiftKey ? 5 : 2;
    const nextPosition = clampToVisiblePitch(
      currentPlacement.x + direction.x * distance,
      currentPlacement.y + direction.y * distance,
    );
    const participant = participantsById.get(participantId);
    setSelectedParticipantId(participantId);
    setPlacementOverrides((current) => ({
      ...current,
      [participantId]: nextPosition,
    }));
    const removedCount = invalidateForInitialPlayerChange(participantId);
    invalidateCompilation(
      invalidationMessage(
        `${participant?.player.name ?? "선수"}의 시작 위치를 방향키로 변경했습니다.`,
        removedCount,
      ),
    );
  }

  function handlePitchClick(event: MouseEvent<HTMLDivElement>) {
    if (suppressPitchClickRef.current) {
      suppressPitchClickRef.current = false;
      return;
    }
    if (isPlaying) {
      setStatusMessage("재생 중에는 경로를 편집할 수 없습니다.");
      return;
    }
    if (!activeAction || activeAction.type === "pass") {
      setStatusMessage(
        activeAction?.type === "pass"
          ? "패스를 받을 우리 팀 선수 토큰을 선택하세요."
          : "우리 팀 선수를 선택하고 이동 또는 볼 운반 액션을 먼저 선택하세요.",
      );
      return;
    }
    if (
      (event.target as HTMLElement).closest(
        "[data-sim-token], [data-sim-ball], [data-sim-target-cursor]",
      )
    ) {
      return;
    }
    const position = toPitchPosition(
      event.clientX,
      event.clientY,
      event.currentTarget.getBoundingClientRect(),
    ) as PitchPoint;
    appendWaypointToDraft(position);
  }

  function handlePitchPointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    if (
      isPlaying ||
      !activeAction ||
      activeAction.type === "pass" ||
      (event.pointerType === "mouse" && event.button !== 0) ||
      (event.target as HTMLElement).closest(
        "[data-sim-token], [data-sim-ball], [data-sim-target-cursor], [data-sim-waypoint], [data-sim-route]",
      )
    ) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rawPoint = toPitchPosition(
      event.clientX,
      event.clientY,
      event.currentTarget.getBoundingClientRect(),
    ) as PitchPoint;
    const point = clampToVisiblePitch(rawPoint.x, rawPoint.y);
    const originalWaypoints = activeAction.waypoints.map((waypoint) => ({
      ...waypoint,
    }));
    const waypoints = appendSampledWaypoint(originalWaypoints, point, {
      minimumDistance: 0.1,
    }) as PitchPoint[];
    pathDrawRef.current = {
      pointerId: event.pointerId,
      originalWaypoints,
      waypoints,
    };
    setSelectedWaypointIndex(waypoints.length - 1);
    setTargetCursor(point);
    setActiveAction({ ...activeAction, waypoints });
  }

  function handlePitchPointerMove(
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    const draw = pathDrawRef.current;
    if (!draw || draw.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    const rawPoint = toPitchPosition(
      event.clientX,
      event.clientY,
      event.currentTarget.getBoundingClientRect(),
    ) as PitchPoint;
    const point = clampToVisiblePitch(rawPoint.x, rawPoint.y);
    const waypoints = appendSampledWaypoint(draw.waypoints, point) as PitchPoint[];
    if (waypoints.length === draw.waypoints.length) {
      return;
    }
    draw.waypoints = waypoints;
    setSelectedWaypointIndex(waypoints.length - 1);
    setTargetCursor(point);
    setActiveAction((current) =>
      current && current.type !== "pass"
        ? { ...current, waypoints }
        : current,
    );
  }

  function finishPitchPathDraw(
    event: ReactPointerEvent<HTMLDivElement>,
    cancelled = false,
  ) {
    const draw = pathDrawRef.current;
    if (!draw || draw.pointerId !== event.pointerId) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const waypoints = cancelled ? draw.originalWaypoints : draw.waypoints;
    setActiveAction((current) =>
      current && current.type !== "pass"
        ? { ...current, waypoints }
        : current,
    );
    setSelectedWaypointIndex(waypoints.length > 0 ? waypoints.length - 1 : null);
    setStatusMessage(
      cancelled
        ? "드래그 경로 생성을 취소했습니다."
        : `${waypoints.length}개 지점의 경로를 그렸습니다. 지점을 조정한 뒤 경로 완료를 누르세요.`,
    );
    suppressPitchClickRef.current = true;
    window.setTimeout(() => {
      suppressPitchClickRef.current = false;
    }, 0);
    pathDrawRef.current = null;
  }

  function beginAction(
    type: TacticalInstruction["type"],
    instruction?: TacticalInstruction,
    focusTarget = false,
    sequenceId = effectiveSelectedSequenceId,
    playerIdOverride?: ParticipantId,
  ) {
    if (isPlaying) {
      setStatusMessage("재생 중에는 지시를 편집할 수 없습니다.");
      return;
    }
    if (activeAction) {
      setStatusMessage("현재 액션을 완료하거나 취소한 뒤 다른 지시를 편집하세요.");
      return;
    }
    const playerId =
      instruction?.playerId ??
      playerIdOverride ??
      effectiveSelectedParticipantId;
    const participant = playerId ? participantsById.get(playerId) : undefined;
    if (!playerId || participant?.teamSide !== "home") {
      setStatusMessage("우리 팀 선수를 먼저 선택하세요.");
      return;
    }
    const targetSequence = sortedSequences.find(
      (sequence) => sequence.id === sequenceId,
    );
    if (!targetSequence) {
      setStatusMessage("지시를 추가할 시퀀스를 먼저 선택하세요.");
      return;
    }
    const atMs = normalizedSequenceOffset(
      instruction?.atMs ?? nextActionAtMs,
      durationMs,
    );
    const movement = instruction && isMovementInstruction(instruction)
      ? (instruction as MovementInstruction)
      : null;
    const plannedFallback = targetSequence.instructions
      .filter(
        (candidate): candidate is MovementInstruction =>
          isMovementInstruction(candidate) &&
          candidate.playerId === playerId &&
          candidate.id !== instruction?.id &&
          candidate.atMs <= atMs,
      )
      .at(-1)
      ?.waypoints.at(-1);
    const absoluteStartAtMs = instruction?.id
      ? instructionStartAtMsById.get(instruction.id)
      : (instructionPreviewRun?.sequenceTimeline?.find(
          (timeline) => timeline.id === targetSequence.id,
        )?.startedAtMs ?? 0) + atMs;
    const instructionFrame =
      instructionPreviewRun && absoluteStartAtMs !== undefined
      ? (sampleSimulation(
          instructionPreviewRun,
          absoluteStartAtMs,
        ) as SimulationFrame)
      : null;
    const startPoint =
      movement?.waypoints.at(-1) ??
      instructionFrame?.players[playerId]?.position ??
      plannedFallback ??
      placements[playerId] ??
      { x: 50, y: 50 };
    const initialTarget = movement
      ? { x: startPoint.x, y: startPoint.y }
      : clampToVisiblePitch(startPoint.x, startPoint.y - 6);
    setSelectedParticipantId(playerId);
    setSelectedSequenceId(targetSequence.id);
    setManualActionOffset(null);
    setSelectedWaypointIndex(null);
    setPassDragPosition(null);
    setTargetCursor(initialTarget);
    shouldFocusTargetCursorRef.current =
      focusTarget && type !== "pass";
    shouldFocusPassTargetRef.current = focusTarget && type === "pass";
    if (type === "pass") {
      setActiveAction({
        type,
        sequenceId: targetSequence.id,
        playerId,
        atMs,
        instructionId: instruction?.id,
        order: instruction?.order,
      });
      setStatusMessage(
        `${participant.player.name}의 패스 대상을 우리 팀 선수 토큰에서 선택하세요.`,
      );
      return;
    }
    setActiveAction({
      type,
      sequenceId: targetSequence.id,
      playerId,
      atMs,
      waypoints: movement?.waypoints.map((waypoint) => ({ ...waypoint })) ?? [],
      instructionId: instruction?.id,
      order: instruction?.order,
    });
    setStatusMessage(
      `${targetSequence.name}에서 ${participant.player.name}의 ${type === "carry" ? "볼 운반" : "이동"} 지점을 경기장에서 지정하세요.`,
    );
  }

  function cancelActiveAction() {
    if (!activeAction) {
      return;
    }
    setActiveAction(null);
    setSelectedWaypointIndex(null);
    setPassDragPosition(null);
    setStatusMessage(
      activeAction.instructionId
        ? "직접 반영된 경로 편집을 종료했습니다."
        : "현재 액션 생성을 취소했습니다.",
    );
  }

  function setActiveActionTiming(mode: "simultaneous" | "after") {
    if (!activeAction) {
      return;
    }
    const sequence = sequences.find(
      (candidate) => candidate.id === activeAction.sequenceId,
    );
    const otherInstructions =
      sequence?.instructions.filter(
        (instruction) => instruction.id !== activeAction.instructionId,
      ) ?? [];
    const nextSequentialAtMs =
      mode === "after" && otherInstructions.length > 0
        ? nextSequentialInstructionTimeMs(
            otherInstructions,
            instructionCompletedAtMsById,
            instructionPreviewRun?.sequenceTimeline?.find(
              (timeline) => timeline.id === activeAction.sequenceId,
            )?.startedAtMs ?? 0,
            durationMs,
          )
        : 0;
    if (nextSequentialAtMs === null) {
      setStatusMessage(
        "앞 액션이 정상 완료되지 않았거나 장면 길이 안에 끝나지 않아 연결할 수 없습니다.",
      );
      return;
    }
    const atMs = nextSequentialAtMs;
    const draft = { ...activeAction, atMs };
    setActiveAction(draft);
    if (draft.type !== "pass" && draft.instructionId) {
      saveMovementAction(draft, true);
    }
    setStatusMessage(
      mode === "simultaneous"
        ? "이 액션을 시퀀스 시작과 동시에 실행합니다."
        : `이 액션을 앞 액션 다음인 ${seconds(atMs)}에 실행합니다.`,
    );
  }

  function appendWaypointToDraft(position: PitchPoint) {
    if (!activeAction || activeAction.type === "pass") {
      return;
    }
    const nextPoint = clampToVisiblePitch(position.x, position.y);
    setTargetCursor(nextPoint);
    setActiveAction((current) =>
      current && current.type !== "pass"
        ? {
            ...current,
            waypoints: [...current.waypoints, nextPoint],
          }
        : current,
    );
    setStatusMessage(
      `${participantsById.get(activeAction.playerId)?.player.name ?? "선수"} 경로에 ${activeAction.waypoints.length + 1}번째 지점을 추가했습니다.`,
    );
  }

  function handleTargetCursorKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!activeAction || activeAction.type === "pass") {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelActiveAction();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      completeMovementAction();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      appendWaypointToDraft(targetCursor);
      return;
    }
    const direction = {
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
    }[event.key];
    if (!direction) {
      return;
    }
    event.preventDefault();
    const distance = event.shiftKey ? 5 : 2;
    setTargetCursor((current) =>
      clampToVisiblePitch(
        current.x + direction.x * distance,
        current.y + direction.y * distance,
      ),
    );
  }

  function saveMovementAction(
    draft: MovementActionDraft,
    keepEditing = false,
  ) {
    if (draft.waypoints.length === 0) {
      setStatusMessage("경기장에서 이동 지점을 하나 이상 지정하세요.");
      return false;
    }
    const sequence = sequences.find(
      (candidate) => candidate.id === draft.sequenceId,
    );
    if (!sequence) {
      setStatusMessage("지시를 저장할 시퀀스를 찾지 못했습니다.");
      return false;
    }
    const instruction: MovementInstruction = {
      id:
        draft.instructionId ??
        `instruction-${nextInstructionOrderRef.current}`,
      order:
        draft.order ?? nextInstructionOrderRef.current++,
      type: draft.type,
      playerId: draft.playerId,
      atMs: draft.atMs,
      waypoints: draft.waypoints.map((waypoint) => ({ ...waypoint })),
    };
    const nextInstructions = draft.instructionId
      ? (replaceTacticalInstruction(
          sequence.instructions,
          instruction,
        ) as TacticalInstruction[])
      : (appendTacticalInstruction(
          sequence.instructions,
          instruction,
        ) as TacticalInstruction[]);
    const updatedSequences = replaceTacticalSequence(sequences, {
      ...sequence,
      instructions: nextInstructions,
    }) as TacticalSequence[];
    const invalidation = invalidateDependentInstructions(updatedSequences, {
      playerIds: [instruction.playerId],
      ball: instruction.type === "carry",
      fromSequenceId: sequence.id,
      includeSource: false,
    });
    setSequences(invalidation.sequences as TacticalSequence[]);
    setActiveAction(keepEditing ? draft : null);
    if (!keepEditing) {
      setSelectedWaypointIndex(null);
    }
    invalidateCompilation(
      invalidationMessage(
        `${participantsById.get(instruction.playerId)?.player.name ?? "선수"}의 ${instruction.type === "carry" ? "볼 운반" : "이동"} 지시를 ${keepEditing ? "바로 반영했습니다." : "저장했습니다."}`,
        invalidation.removedInstructionIds.length,
      ),
    );
    return true;
  }

  function completeMovementAction() {
    if (!activeAction || activeAction.type === "pass") {
      return;
    }
    saveMovementAction(activeAction);
  }

  function removeLastDraftWaypoint() {
    if (!activeAction || activeAction.type === "pass") {
      return;
    }
    const draft = {
      ...activeAction,
      waypoints: activeAction.waypoints.slice(0, -1),
    };
    if (activeAction.instructionId && draft.waypoints.length === 0) {
      removeInstruction(
        activeAction.sequenceId,
        activeAction.instructionId,
        true,
      );
      return;
    }
    setActiveAction(draft);
    if (activeAction.instructionId) {
      saveMovementAction(draft, true);
    } else {
      setStatusMessage("현재 경로의 마지막 지점을 되돌렸습니다.");
    }
  }

  function insertDraftWaypoint(index: number, position: PitchPoint) {
    if (!activeAction || activeAction.type === "pass") {
      return;
    }
    const waypoints = insertWaypoint(
      activeAction.waypoints,
      index,
      clampToVisiblePitch(position.x, position.y),
    ) as PitchPoint[];
    const draft = { ...activeAction, waypoints };
    setActiveAction(draft);
    setSelectedWaypointIndex(index);
    if (activeAction.instructionId) {
      saveMovementAction(draft, true);
    } else {
      setStatusMessage(`경로의 ${index + 1}번째 지점을 삽입했습니다.`);
    }
  }

  function deleteDraftWaypoint(index: number) {
    if (!activeAction || activeAction.type === "pass") {
      return;
    }
    const waypoints = removeWaypoint(
      activeAction.waypoints,
      index,
    ) as PitchPoint[];
    if (activeAction.instructionId && waypoints.length === 0) {
      removeInstruction(
        activeAction.sequenceId,
        activeAction.instructionId,
        true,
      );
      return;
    }
    const draft = { ...activeAction, waypoints };
    setActiveAction(draft);
    setSelectedWaypointIndex(
      waypoints.length === 0 ? null : Math.min(index, waypoints.length - 1),
    );
    if (activeAction.instructionId) {
      saveMovementAction(draft, true);
    } else {
      setStatusMessage(`경로의 ${index + 1}번째 지점을 삭제했습니다.`);
    }
  }

  function handleWaypointPointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (
      !activeAction ||
      activeAction.type === "pass" ||
      (event.pointerType === "mouse" && event.button !== 0)
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const waypoints = activeAction.waypoints.map((waypoint) => ({ ...waypoint }));
    waypointDragRef.current = {
      pointerId: event.pointerId,
      index,
      originalWaypoints: waypoints,
      waypoints,
    };
    setSelectedWaypointIndex(index);
  }

  function handleWaypointPointerMove(
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    const drag = waypointDragRef.current;
    const pitch = pitchRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !pitch) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const rawPoint = toPitchPosition(
      event.clientX,
      event.clientY,
      pitch.getBoundingClientRect(),
    ) as PitchPoint;
    const point = clampToVisiblePitch(rawPoint.x, rawPoint.y);
    const waypoints = moveWaypoint(
      drag.waypoints,
      drag.index,
      point,
    ) as PitchPoint[];
    drag.waypoints = waypoints;
    setTargetCursor(point);
    setActiveAction((current) =>
      current && current.type !== "pass"
        ? { ...current, waypoints }
        : current,
    );
  }

  function finishWaypointDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    cancelled = false,
  ) {
    const drag = waypointDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const waypoints = cancelled ? drag.originalWaypoints : drag.waypoints;
    setActiveAction((current) =>
      current && current.type !== "pass"
        ? { ...current, waypoints }
        : current,
    );
    if (
      !cancelled &&
      activeAction?.type !== "pass" &&
      activeAction?.instructionId
    ) {
      saveMovementAction({ ...activeAction, waypoints }, true);
    } else {
      setStatusMessage(
        cancelled
          ? "지점 이동을 취소했습니다."
          : `${drag.index + 1}번째 지점 위치를 변경했습니다.`,
      );
    }
    waypointDragRef.current = null;
  }

  function handleWaypointKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (!activeAction || activeAction.type === "pass") {
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      deleteDraftWaypoint(index);
      return;
    }
    const direction = {
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
    }[event.key];
    if (!direction) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const distance = event.shiftKey ? 5 : 2;
    const current = activeAction.waypoints[index];
    const point = clampToVisiblePitch(
      current.x + direction.x * distance,
      current.y + direction.y * distance,
    );
    const draft = {
      ...activeAction,
      waypoints: moveWaypoint(
        activeAction.waypoints,
        index,
        point,
      ) as PitchPoint[],
    };
    setActiveAction(draft);
    setTargetCursor(point);
    setSelectedWaypointIndex(index);
    if (activeAction.instructionId) {
      saveMovementAction(draft, true);
    }
  }

  function savePassAction(
    draft: PassActionDraft,
    targetPlayerId: ParticipantId,
  ) {
    const target = participantsById.get(targetPlayerId);
    if (
      target?.teamSide !== "home" ||
      targetPlayerId === draft.playerId
    ) {
      return false;
    }
    const sequence = sequences.find(
      (candidate) => candidate.id === draft.sequenceId,
    );
    if (!sequence) {
      setStatusMessage("지시를 저장할 시퀀스를 찾지 못했습니다.");
      return false;
    }
    const instruction: PassInstruction = {
      id:
        draft.instructionId ??
        `instruction-${nextInstructionOrderRef.current}`,
      order: draft.order ?? nextInstructionOrderRef.current++,
      type: "pass",
      playerId: draft.playerId,
      atMs: draft.atMs,
      targetPlayerId,
    };
    const nextInstructions = draft.instructionId
      ? (replaceTacticalInstruction(
          sequence.instructions,
          instruction,
        ) as TacticalInstruction[])
      : (appendTacticalInstruction(
          sequence.instructions,
          instruction,
        ) as TacticalInstruction[]);
    const updatedSequences = replaceTacticalSequence(sequences, {
      ...sequence,
      instructions: nextInstructions,
    }) as TacticalSequence[];
    const invalidation = invalidateDependentInstructions(updatedSequences, {
      ball: true,
      fromSequenceId: sequence.id,
      includeSource: false,
    });
    setSequences(invalidation.sequences as TacticalSequence[]);
    setActiveAction(null);
    setPassDragPosition(null);
    setSelectedParticipantId(instruction.playerId);
    invalidateCompilation(
      invalidationMessage(
        `${sequence.name} 시작 후 ${seconds(instruction.atMs)}에 ${participantsById.get(instruction.playerId)?.player.name ?? "선수"} → ${target.player.name} 패스 지시를 저장했습니다.`,
        invalidation.removedInstructionIds.length,
      ),
    );
    return true;
  }

  function commitPassTarget(targetPlayerId: ParticipantId) {
    if (!activeAction || activeAction.type !== "pass") {
      return false;
    }
    const target = participantsById.get(targetPlayerId);
    if (
      target?.teamSide !== "home" ||
      targetPlayerId === activeAction.playerId
    ) {
      setStatusMessage(
        target?.teamSide === "away"
          ? "상대 팀 선수는 패스 대상으로 지정할 수 없습니다. 자동 반응만 수행합니다."
          : "패스 출발 선수와 다른 우리 팀 선수를 선택하세요.",
      );
      return true;
    }
    savePassAction(activeAction, targetPlayerId);
    return true;
  }

  function beginPassFromBall() {
    if (!selectedSequence) {
      setStatusMessage(
        "패스를 기록할 시퀀스를 먼저 선택하세요. 공 드래그는 초기 위치를 변경합니다.",
      );
      return;
    }
    const ownerId =
      frame?.ball.kind === "controlled"
        ? (frame.ball.ownerId as ParticipantId | undefined)
        : initialBallPosition
          ? undefined
          : effectiveBallOwnerId;
    const owner = ownerId ? participantsById.get(ownerId) : undefined;
    if (!ownerId || owner?.teamSide !== "home") {
      setStatusMessage(
        owner?.teamSide === "away"
          ? "상대 팀이 공을 소유한 상태에서는 우리 팀 패스를 지정할 수 없습니다."
          : "루즈볼 상태에서는 패스를 지정할 수 없습니다. 먼저 초기 공 소유자를 정하세요.",
      );
      return;
    }
    setSelectedParticipantId(ownerId);
    beginAction("pass", undefined, true, selectedSequence.id, ownerId);
  }

  function removeInstruction(
    sequenceId: string,
    instructionId: string,
    allowActiveAction = false,
  ) {
    if (isPlaying || (activeAction && !allowActiveAction)) {
      return;
    }
    const sequence = sequences.find((candidate) => candidate.id === sequenceId);
    if (!sequence) {
      return;
    }
    const removedInstruction = sequence.instructions.find(
      (instruction) => instruction.id === instructionId,
    );
    if (!removedInstruction) {
      return;
    }
    const nextInstructions = removeTacticalInstruction(
      sequence.instructions,
      instructionId,
    ) as TacticalInstruction[];
    const updatedSequences = replaceTacticalSequence(sequences, {
      ...sequence,
      instructions: nextInstructions,
    }) as TacticalSequence[];
    const invalidation = invalidateDependentInstructions(updatedSequences, {
      playerIds: isMovementInstruction(removedInstruction)
        ? [removedInstruction.playerId]
        : [],
      ball:
        removedInstruction.type === "carry" ||
        removedInstruction.type === "pass",
      fromSequenceId: sequence.id,
      includeSource: false,
    });
    setSequences(invalidation.sequences as TacticalSequence[]);
    setActiveAction(null);
    invalidateCompilation(
      invalidationMessage(
        "선수 지시를 삭제했습니다.",
        invalidation.removedInstructionIds.length,
      ),
    );
  }

  function createSequence() {
    if (isPlaying || activeAction) {
      return;
    }
    const previous = sortedSequences.at(-1);
    if (!previous || previous.instructions.length === 0) {
      setStatusMessage("현재 마지막 시퀀스에 지시를 하나 이상 추가한 뒤 새 시퀀스를 만드세요.");
      return;
    }
    const id = `sequence-${nextSequenceIdRef.current++}`;
    const sequence = createWorkspaceSequence(
      id,
      previous.order + 1,
      `시퀀스 ${sortedSequences.length + 1}`,
    );
    setSequences(
      appendTacticalSequence(sequences, sequence) as TacticalSequence[],
    );
    setSelectedSequenceId(id);
    setManualActionOffset(null);
    invalidateCompilation(`${sequence.name} 추가 완료`);
  }

  function renameSequence(sequenceId: string, value: string) {
    if (isPlaying || activeAction) {
      return;
    }
    const sequence = sequences.find((candidate) => candidate.id === sequenceId);
    if (!sequence) {
      return;
    }
    const name = value.trim() || `시퀀스 ${sequence.order}`;
    setSequences(
      replaceTacticalSequence(sequences, { ...sequence, name }) as TacticalSequence[],
    );
    setStatusMessage(`시퀀스 이름 변경: ${name}`);
  }

  function moveSequence(sequenceId: string, direction: -1 | 1) {
    if (isPlaying || activeAction) {
      return;
    }
    try {
      const nextSequences = reorderTacticalSequence(
        sequences,
        sequenceId,
        direction,
      ) as TacticalSequence[];
      setSequences(nextSequences);
      setManualActionOffset((current) =>
        normalizeManualActionOffsetForTimeline(
          current,
          nextSequences,
          durationMs,
        ),
      );
      invalidateCompilation("시퀀스 실행 순서를 변경했습니다.");
    } catch {
      setStatusMessage("시퀀스 순서를 변경하지 못했습니다.");
    }
  }

  function deleteSequence(sequenceId: string) {
    if (isPlaying || activeAction) {
      return;
    }
    const sequence = sequences.find((candidate) => candidate.id === sequenceId);
    if (
      !sequence ||
      sequence.instructions.length > 0 ||
      sequences.length <= 1
    ) {
      setStatusMessage("지시가 없는 시퀀스만 삭제할 수 있습니다.");
      return;
    }
    const sequenceIndex = sortedSequences.findIndex(
      (candidate) => candidate.id === sequenceId,
    );
    const fallbackSequenceId =
      sortedSequences[sequenceIndex + 1]?.id ??
      sortedSequences[sequenceIndex - 1]?.id ??
      INITIAL_SEQUENCE_ID;
    const next = removeTacticalSequence(
      sequences,
      sequenceId,
    ) as TacticalSequence[];
    pendingSequenceFocusRef.current = fallbackSequenceId;
    setSequences(next);
    if (effectiveSelectedSequenceId === sequenceId) {
      setSelectedSequenceId(fallbackSequenceId);
    }
    setManualActionOffset((current) =>
      normalizeManualActionOffsetForTimeline(current, next, durationMs),
    );
    invalidateCompilation(`${sequence.name} 삭제 완료`);
  }

  function clearSelectedRoute() {
    if (!effectiveSelectedParticipantId || isPlaying || activeAction) {
      return;
    }
    const sequence = sequences.find(
      (candidate) => candidate.id === effectiveSelectedSequenceId,
    );
    if (!sequence) {
      return;
    }
    const removedMovements = sequence.instructions.filter(
      (instruction) =>
        instruction.playerId === effectiveSelectedParticipantId &&
        isMovementInstruction(instruction),
    );
    const nextInstructions = sequence.instructions.filter(
      (instruction) =>
        instruction.playerId !== effectiveSelectedParticipantId ||
        !isMovementInstruction(instruction),
    );
    if (nextInstructions.length === sequence.instructions.length) {
      return;
    }
    const updatedSequences = replaceTacticalSequence(sequences, {
      ...sequence,
      instructions: sortTacticalInstructions(
        nextInstructions,
      ) as TacticalInstruction[],
    }) as TacticalSequence[];
    const invalidation = invalidateDependentInstructions(updatedSequences, {
      playerIds: [effectiveSelectedParticipantId],
      ball: removedMovements.some(
        (instruction) => instruction.type === "carry",
      ),
      fromSequenceId: sequence.id,
      includeSource: false,
    });
    setSequences(invalidation.sequences as TacticalSequence[]);
    setActiveAction(null);
    invalidateCompilation(
      invalidationMessage(
        `${sequence.name}에서 선택한 선수의 이동·볼 운반 지시를 삭제했습니다.`,
        invalidation.removedInstructionIds.length,
      ),
    );
  }

  function resetSelectedPlacement() {
    if (
      !effectiveSelectedParticipantId ||
      isPlaying ||
      activeAction ||
      selectedSequence
    ) {
      return;
    }
    setPlacementOverrides((current) => {
      const next = { ...current };
      delete next[effectiveSelectedParticipantId];
      return next;
    });
    const removedCount = invalidateForInitialPlayerChange(
      effectiveSelectedParticipantId,
    );
    invalidateCompilation(
      invalidationMessage(
        "선택한 선수의 시작 위치를 포메이션 기본값으로 되돌렸습니다.",
        removedCount,
      ),
    );
  }

  function clearAllInstructions() {
    if (isPlaying || activeAction) {
      return;
    }
    const defaultOwner =
      homeParticipants.find((participant) => participant.role.includes("ST")) ??
      homeParticipants[0];
    setSelectedParticipantId(null);
    setActiveAction(null);
    const initialSequences = createInitialSequences();
    setSequences(initialSequences);
    resetSequenceHistory(initialSequences);
    setSelectedSequenceId("");
    setManualActionOffset(null);
    nextInstructionOrderRef.current = 1;
    nextSequenceIdRef.current = 2;
    setPlacementOverrides({});
    setPlayerTacticalRoles({});
    setBallOwnerId(defaultOwner?.participantId ?? "");
    setInitialBallPosition(null);
    invalidateCompilation(
      "모든 선수 역할·초기 배치·이동·패스 지시를 초기화했습니다.",
    );
  }

  function restoreSequenceHistory(direction: "undo" | "redo") {
    if (isPlaying || activeAction) {
      return;
    }
    const source =
      direction === "undo" ? sequenceUndoRef.current : sequenceRedoRef.current;
    const target = source.pop();
    if (!target) {
      return;
    }
    const destination =
      direction === "undo" ? sequenceRedoRef.current : sequenceUndoRef.current;
    destination.push(cloneSequenceState(sequences));
    const restored = cloneSequenceState(target);
    suppressSequenceHistoryRef.current = true;
    setSequences(restored);
    setSelectedSequenceId((current) =>
      current === ""
        ? ""
        : restored.some((sequence) => sequence.id === current)
        ? current
        : restored[0]?.id ?? INITIAL_SEQUENCE_ID,
    );
    setManualActionOffset((current) =>
      normalizeManualActionOffsetForTimeline(current, restored, durationMs),
    );
    setSelectedWaypointIndex(null);
    setSequenceHistoryCounts({
      undo: sequenceUndoRef.current.length,
      redo: sequenceRedoRef.current.length,
    });
    invalidateCompilation(
      direction === "undo"
        ? "직전 전술 편집을 되돌렸습니다."
        : "되돌린 전술 편집을 다시 적용했습니다.",
    );
  }

  function buildRun(sequenceSource: TacticalSequence[] = sortedSequences) {
    return compileWorkspaceRun({
      durationMs,
      participants,
      placements,
      initialBallPosition,
      initialBallOwnerId: effectiveBallOwnerId,
      sequences: sequenceSource,
      playerTacticalRoles: effectivePlayerTacticalRoles,
      lineupError: lineupState.error,
    });
  }

  function play() {
    if (isPlaying) {
      setIsPlaying(false);
      setStatusMessage("시뮬레이션을 일시정지했습니다.");
      return;
    }
    if (activeAction) {
      setStatusMessage("현재 액션을 완료하거나 취소한 뒤 재생하세요.");
      return;
    }
    try {
      let activeRun = run;
      if (!activeRun) {
        activeRun = buildRun();
        setRun(activeRun);
        setCompileError(null);
      }
      if (cursorRef.current >= activeRun.durationMs) {
        cursorRef.current = 0;
        setCursorMs(0);
      }
      setIsPlaying(true);
      setStatusMessage("시뮬레이션을 재생합니다.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "시뮬레이션을 준비하지 못했습니다.";
      setCompileError(message);
      setStatusMessage(`시뮬레이션 준비 실패: ${message}`);
    }
  }

  function resetPlayback() {
    setIsPlaying(false);
    cursorRef.current = 0;
    setCursorMs(0);
    setStatusMessage("재생 위치를 처음으로 되돌렸습니다. 지시는 유지됩니다.");
  }

  const selectedFramePlayer = effectiveSelectedParticipantId
    ? frame?.players[effectiveSelectedParticipantId]
    : undefined;
  const selectedTacticalRole =
    selectedParticipant?.teamSide === "home"
      ? effectivePlayerTacticalRoles[selectedParticipant.player.id]
      : undefined;
  const selectedTacticalRolePresets = selectedParticipant
    ? tacticalRolePresetsForFormationRole(selectedParticipant.role)
    : [];
  const selectedTacticalRolePreset = selectedTacticalRolePresets.find(
    (preset) => preset.id === selectedTacticalRole?.presetId,
  );
  const selectedProximity = effectiveSelectedParticipantId
    ? frame?.metrics.players[effectiveSelectedParticipantId]
    : undefined;
  const selectedRoute = effectiveSelectedParticipantId
    ? plannedMovementPaths
        .filter(
          (path) =>
            path.instruction.playerId === effectiveSelectedParticipantId,
        )
        .flatMap((path) => path.instruction.waypoints)
    : [];
  const selectedSequenceHasMovement = Boolean(
    effectiveSelectedParticipantId &&
      selectedSequence?.instructions.some(
        (instruction) =>
          instruction.playerId === effectiveSelectedParticipantId &&
          isMovementInstruction(instruction),
      ),
  );
  const selectedEta = effectiveSelectedParticipantId
    ? summary?.players[effectiveSelectedParticipantId]?.arrivedAtMs
    : null;
  const ballPosition =
    frame?.ball.position ??
    initialBallPosition ??
    (effectiveBallOwnerId ? placements[effectiveBallOwnerId] : undefined) ??
    { x: 50, y: 50 };

  if (teams.length < 2) {
    return (
      <section className="sim-empty-state" aria-labelledby="sim-empty-title">
        <h2 id="sim-empty-title">시뮬레이션 준비 불가</h2>
        <p>서로 대결할 수 있는 두 국가의 선수 데이터가 필요합니다.</p>
      </section>
    );
  }

  if (setupStep !== "simulator") {
    const isTeamStep = setupStep === "teams";
    const primaryActionDisabled = isTeamStep
      ? !setupTeamsAreDistinct
      : Boolean(setupPreviewState.error);

    return (
      <section
        className="sim-workspace sim-setup-workspace"
        aria-labelledby="sim-setup-flow-title"
        data-sim-setup-step={setupStep}
      >
        <header className="sim-setup-flow-header">
          <div>
            <p className="sim-eyebrow">Match setup</p>
            <h1 id="sim-setup-flow-title">경기 설정</h1>
            <p>
              대결할 두 팀과 포메이션을 정한 뒤 배치를 확인하고 전술판을
              시작하세요.
            </p>
          </div>
          {hasEnteredSimulator ? (
            <button
              type="button"
              className="sim-setup-quiet-button"
              onClick={cancelInitialSetup}
            >
              변경 취소
            </button>
          ) : null}
        </header>

        <nav className="sim-setup-steps" aria-label="초기 설정 단계">
          <ol>
            <li
              className={isTeamStep ? "is-current" : "is-complete"}
              aria-current={isTeamStep ? "step" : undefined}
            >
              <span>1</span>
              <div>
                <strong>팀 선택</strong>
                <small>대결 국가 지정</small>
              </div>
            </li>
            <li
              className={!isTeamStep ? "is-current" : ""}
              aria-current={!isTeamStep ? "step" : undefined}
            >
              <span>2</span>
              <div>
                <strong>포메이션</strong>
                <small>자동 배치 확인</small>
              </div>
            </li>
          </ol>
        </nav>

        {isTeamStep ? (
          <div className="sim-setup-stage" aria-labelledby="sim-team-step-title">
            <div className="sim-setup-stage-heading">
              <p>Step 01</p>
              <h2 id="sim-team-step-title">대결 팀을 선택하세요</h2>
              <span>동일 국가는 양쪽에 동시에 선택할 수 없습니다.</span>
            </div>

            <div className="sim-team-choice-grid">
              <label className="sim-team-choice" htmlFor="sim-setup-home-team">
                <span>우리 팀</span>
                <select
                  id="sim-setup-home-team"
                  value={draftHomeTeamId}
                  onChange={(event) =>
                    changeDraftTeam("home", event.target.value)
                  }
                >
                  {teams.map((team) => (
                    <option
                      key={team.id}
                      value={team.id}
                      disabled={team.id === draftAwayTeamId}
                    >
                      {team.name} · Group {team.group}
                    </option>
                  ))}
                </select>
                <strong>{draftHomeTeam?.name ?? "팀을 선택하세요"}</strong>
                <small>
                  {draftHomeTeam
                    ? `Group ${draftHomeTeam.group} · 선수 ${draftHomeTeam.players.length}명`
                    : "선수 데이터 없음"}
                </small>
              </label>

              <div className="sim-setup-versus" aria-hidden="true">
                VS
              </div>

              <label className="sim-team-choice" htmlFor="sim-setup-away-team">
                <span>상대 팀</span>
                <select
                  id="sim-setup-away-team"
                  value={draftAwayTeamId}
                  onChange={(event) =>
                    changeDraftTeam("away", event.target.value)
                  }
                >
                  {teams.map((team) => (
                    <option
                      key={team.id}
                      value={team.id}
                      disabled={team.id === draftHomeTeamId}
                    >
                      {team.name} · Group {team.group}
                    </option>
                  ))}
                </select>
                <strong>{draftAwayTeam?.name ?? "팀을 선택하세요"}</strong>
                <small>
                  {draftAwayTeam
                    ? `Group ${draftAwayTeam.group} · 선수 ${draftAwayTeam.players.length}명`
                    : "선수 데이터 없음"}
                </small>
              </label>
            </div>

            {!setupTeamsAreDistinct ? (
              <p className="sim-setup-error" role="alert">
                우리 팀과 상대 팀은 서로 다른 국가를 선택해야 합니다.
              </p>
            ) : null}
          </div>
        ) : (
          <div
            className="sim-setup-stage sim-formation-stage"
            aria-labelledby="sim-formation-step-title"
          >
            <div className="sim-setup-stage-heading">
              <p>Step 02</p>
              <h2 id="sim-formation-step-title">포메이션과 자동 배치를 확인하세요</h2>
              <span>양 팀의 포메이션을 선택하면 기본 선발과 위치가 바뀝니다.</span>
            </div>

            <div className="sim-formation-team-grid">
              <section className="sim-formation-team-card" aria-labelledby="sim-home-formation-title">
                <header>
                  <p>우리 팀</p>
                  <h3 id="sim-home-formation-title">{draftHomeTeam?.name}</h3>
                </header>
                <div className="sim-formation-options" role="group" aria-label="우리 팀 포메이션 선택">
                  {formations.map((formation) => (
                    <button
                      key={formation.id}
                      type="button"
                      className={
                        formation.id === draftHomeFormationId
                          ? "is-selected"
                          : ""
                      }
                      aria-pressed={formation.id === draftHomeFormationId}
                      onClick={() =>
                        changeDraftFormation("home", formation.id)
                      }
                    >
                      <strong>{formation.label}</strong>
                      <span>{formation.name}</span>
                      <small>{formation.description}</small>
                    </button>
                  ))}
                </div>
                <SetupFormationPreview
                  teamName={draftHomeTeam?.name ?? "우리 팀"}
                  formation={draftHomeFormation}
                  lineup={setupPreviewState.home}
                  teamSide="home"
                  selectedSlotIndex={selectedDraftLineupSlot}
                  onSelectSlot={setSelectedDraftLineupSlot}
                />

                <section
                  className="sim-lineup-editor"
                  aria-labelledby="sim-lineup-editor-title"
                >
                  <header>
                    <div>
                      <p>선발 편집</p>
                      <h4 id="sim-lineup-editor-title">
                        선발 11 · 후보 {setupHomeBenchPlayers.length}
                      </h4>
                    </div>
                    <button
                      type="button"
                      className="sim-lineup-reset"
                      disabled={!draftHomeLineupSelection}
                      onClick={resetDraftHomeLineup}
                    >
                      자동 선발로 초기화
                    </button>
                  </header>

                  {selectedDraftLineupParticipant ? (
                    <>
                      <div className="sim-lineup-selected-slot" aria-live="polite">
                        <div className="sim-lineup-selected-identity">
                          <span>
                            <b>{selectedDraftLineupParticipant.role}</b>{" "}
                            {formationRoleLabel(selectedDraftLineupParticipant.role)} 편집 대상
                          </span>
                          <strong>
                            {selectedDraftLineupParticipant.player.number}. {selectedDraftLineupParticipant.player.name}
                          </strong>
                          <small>
                            {selectedDraftLineupParticipant.player.position} · {selectedDraftLineupParticipant.player.club}
                          </small>
                        </div>
                        <dl className="sim-lineup-selected-abilities" aria-label="선택 선수 주요 능력치">
                          <div>
                            <dt>종합</dt>
                            <dd>{selectedDraftLineupParticipant.player.abilities.overall}</dd>
                          </div>
                          <div>
                            <dt>속도</dt>
                            <dd>{selectedDraftLineupParticipant.player.abilities.speed}</dd>
                          </div>
                          <div>
                            <dt>패스</dt>
                            <dd>{selectedDraftLineupParticipant.player.abilities.passing}</dd>
                          </div>
                          <div>
                            <dt>수비</dt>
                            <dd>{selectedDraftLineupParticipant.player.abilities.defending}</dd>
                          </div>
                        </dl>
                      </div>

                      <details className="sim-lineup-swap">
                        <summary>선발 간 포지션 변경</summary>
                        <p>
                          다른 선발 선수를 선택하면 두 선수가 맡는 포메이션
                          슬롯을 서로 바꿉니다.
                        </p>
                        {setupLineupSwapCandidates.length > 0 ? (
                          <ul aria-label={`${selectedDraftLineupParticipant.player.name} 포지션 변경 대상`}>
                            {setupLineupSwapCandidates.map(
                              ({ participant, slotIndex, isExact }) => (
                                <li key={participant.participantId}>
                                  <button
                                    type="button"
                                    className={isExact ? "" : "is-out-of-position"}
                                    aria-label={`${selectedDraftLineupParticipant.player.name} 선수와 ${participant.player.name} 선수의 ${selectedDraftLineupParticipant.role}, ${participant.role} 포지션 교환`}
                                    onClick={() => swapDraftHomeLineupPlayers(slotIndex)}
                                  >
                                    <span>
                                      <b>{participant.role}</b>
                                      <small>{formationRoleLabel(participant.role)}</small>
                                    </span>
                                    <strong>
                                      {participant.player.number}. {participant.player.name}
                                    </strong>
                                    <small>{isExact ? "포지션 적합" : "포지션 변경"}</small>
                                  </button>
                                </li>
                              ),
                            )}
                          </ul>
                        ) : (
                          <p className="sim-lineup-swap-empty">
                            이 선수와 교환할 수 있는 선발 포지션이 없습니다.
                          </p>
                        )}
                      </details>
                    </>
                  ) : (
                    <p className="sim-lineup-help">
                      위 선발 명단에서 선수를 선택하면 후보 교체와 선발 간
                      포지션 변경을 진행할 수 있습니다.
                    </p>
                  )}

                  <ul
                    className="sim-bench-list"
                    aria-label={
                      selectedDraftLineupParticipant
                        ? `${selectedDraftLineupParticipant.role} 슬롯 교체 후보`
                        : `${draftHomeTeam?.name ?? "우리 팀"} 후보 명단`
                    }
                  >
                    {selectedDraftLineupParticipant
                      ? setupBenchCandidates.map(({ player, compatibility }) => (
                          <li key={player.id}>
                            <button
                              type="button"
                              className={
                                compatibility === "out-of-position"
                                  ? "is-out-of-position"
                                  : ""
                              }
                              onClick={() => replaceDraftHomeLineupPlayer(player.id)}
                            >
                              <span className="sim-bench-position">
                                <b>{player.position}</b>
                                <small>{playerPositionLabel(player.position)}</small>
                              </span>
                              <span className="sim-bench-identity">
                                <strong>{player.number}. {player.name}</strong>
                                <small>{player.club}</small>
                              </span>
                              <span className="sim-bench-fit">
                                {compatibility === "exact"
                                  ? "역할 적합"
                                  : "다른 포지션"}
                              </span>
                              <span className="sim-bench-abilities">
                                <small>종합 <b>{player.abilities.overall}</b></small>
                                <small>속도 <b>{player.abilities.speed}</b></small>
                                <small>패스 <b>{player.abilities.passing}</b></small>
                                <small>수비 <b>{player.abilities.defending}</b></small>
                              </span>
                            </button>
                          </li>
                        ))
                      : setupHomeBenchPlayers.map((player) => (
                          <li key={player.id} className="sim-bench-roster-item">
                            <span className="sim-bench-position">
                              <b>{player.position}</b>
                              <small>{playerPositionLabel(player.position)}</small>
                            </span>
                            <span className="sim-bench-identity">
                              <strong>{player.number}. {player.name}</strong>
                              <small>{player.club}</small>
                            </span>
                            <span className="sim-bench-overall">
                              종합 <strong>{player.abilities.overall}</strong>
                            </span>
                          </li>
                        ))}
                  </ul>
                </section>
              </section>

              <section className="sim-formation-team-card" aria-labelledby="sim-away-formation-title">
                <header>
                  <p>상대 팀</p>
                  <h3 id="sim-away-formation-title">{draftAwayTeam?.name}</h3>
                </header>
                <div className="sim-formation-options" role="group" aria-label="상대 팀 포메이션 선택">
                  {formations.map((formation) => (
                    <button
                      key={formation.id}
                      type="button"
                      className={
                        formation.id === draftAwayFormationId
                          ? "is-selected"
                          : ""
                      }
                      aria-pressed={formation.id === draftAwayFormationId}
                      onClick={() =>
                        changeDraftFormation("away", formation.id)
                      }
                    >
                      <strong>{formation.label}</strong>
                      <span>{formation.name}</span>
                      <small>{formation.description}</small>
                    </button>
                  ))}
                </div>
                <SetupFormationPreview
                  teamName={draftAwayTeam?.name ?? "상대 팀"}
                  formation={draftAwayFormation}
                  lineup={setupPreviewState.away}
                  teamSide="away"
                />
              </section>
            </div>

            <div className="sim-setup-summary" aria-label="선택한 경기 설정">
              <span>
                우리 팀 <strong>{draftHomeTeam?.name}</strong> · {draftHomeFormation.label}
              </span>
              <i aria-hidden="true">VS</i>
              <span>
                상대 팀 <strong>{draftAwayTeam?.name}</strong> · {draftAwayFormation.label}
              </span>
            </div>

            {setupPreviewState.error ? (
              <p className="sim-setup-error" role="alert">
                {setupPreviewState.error}
              </p>
            ) : null}

            {showSetupResetConfirmation ? (
              <section
                className="sim-setup-reset-confirmation"
                role="alertdialog"
                aria-labelledby="sim-setup-reset-title"
                aria-describedby="sim-setup-reset-description"
              >
                <div>
                  <p>설정 변경</p>
                  <h3 id="sim-setup-reset-title">현재 전술 작업을 초기화할까요?</h3>
                  <span id="sim-setup-reset-description">
                    변경을 적용하면 선수 시작 위치, 공 위치·소유, 등록한 지시와
                    재생 결과가 초기화됩니다.
                  </span>
                </div>
                <div>
                  <button
                    type="button"
                    className="sim-setup-quiet-button"
                    onClick={() => setShowSetupResetConfirmation(false)}
                    autoFocus
                  >
                    계속 검토
                  </button>
                  <button type="button" onClick={applyInitialSetup}>
                    초기화하고 적용
                  </button>
                </div>
              </section>
            ) : null}
          </div>
        )}

        <footer className="sim-setup-actions">
          {!isTeamStep ? (
            <button
              type="button"
              className="sim-setup-quiet-button"
              onClick={() => {
                setShowSetupResetConfirmation(false);
                setSetupStep("teams");
              }}
            >
              이전 단계
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            disabled={primaryActionDisabled || showSetupResetConfirmation}
            onClick={() => {
              if (isTeamStep) {
                setSetupStep("formations");
                return;
              }
              requestInitialSetupApply();
            }}
          >
            {isTeamStep
              ? "포메이션 선택"
              : hasEnteredSimulator
                ? "변경 적용"
                : "전술 설정 시작"}
          </button>
        </footer>
      </section>
    );
  }

  return (
    <section
      className="sim-workspace"
      aria-labelledby="sim-title"
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        const acceptsText =
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable;
        if (
          !acceptsText &&
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "z" &&
          !activeAction
        ) {
          event.preventDefault();
          restoreSequenceHistory(event.shiftKey ? "redo" : "undo");
          return;
        }
        if (event.key === "Escape" && activeAction) {
          event.preventDefault();
          cancelActiveAction();
        }
      }}
    >
      <header className="sim-header">
        <div>
          <p className="sim-eyebrow">Scenario movement simulator</p>
          <h1 id="sim-title">선수 움직임·패스 시뮬레이션</h1>
          <p>
            장면을 시간 순서의 시퀀스로 나누고 우리 팀의 이동·볼 운반·패스를
            함께 배치하면 상대 팀이 결정론적으로 압박·커버·차단합니다.
          </p>
        </div>
        <div className="sim-playback-controls" aria-label="재생 제어">
          <button type="button" onClick={play} disabled={Boolean(lineupState.error)}>
            {isPlaying
              ? "일시정지"
              : run && cursorMs >= run.durationMs
                ? "다시 재생"
                : cursorMs > 0
                  ? "계속 재생"
                  : "재생"}
          </button>
          <button type="button" onClick={resetPlayback}>
            재생 초기화
          </button>
          <button
            type="button"
            onClick={() => restoreSequenceHistory("undo")}
            disabled={isPlaying || Boolean(activeAction) || !canUndoSequenceEdit}
            aria-keyshortcuts="Control+Z Meta+Z"
          >
            편집 취소
          </button>
          <button
            type="button"
            onClick={() => restoreSequenceHistory("redo")}
            disabled={isPlaying || Boolean(activeAction) || !canRedoSequenceEdit}
            aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z"
          >
            다시 실행
          </button>
          <button
            type="button"
            onClick={clearAllInstructions}
            disabled={isPlaying || Boolean(activeAction)}
          >
            전술 전체 초기화
          </button>
        </div>
      </header>

      <div className="sim-timeline">
        <label htmlFor="sim-cursor">
          재생 위치
          <output>{seconds(cursorMs)}</output>
        </label>
        <input
          id="sim-cursor"
          type="range"
          min={0}
          max={durationMs}
          step={SIMULATION_TICK_MS}
          value={Math.min(cursorMs, durationMs)}
          disabled={isPlaying || !run}
          onChange={(event) => {
            const nextCursor = Number(event.target.value);
            cursorRef.current = nextCursor;
            setCursorMs(nextCursor);
          }}
        />
      </div>

      <div className="sim-layout">
        <aside className="sim-setup-panel" aria-labelledby="sim-setup-title">
          <h3 id="sim-setup-title">장면 설정</h3>

          <section className="sim-current-match" aria-label="현재 팀과 포메이션">
            <div>
              <span>우리 팀</span>
              <strong>{homeTeam?.name}</strong>
              <small>{homeFormation.label} · {homeFormation.name}</small>
              {homeLineupSelection ? <em>사용자 선발 적용</em> : null}
            </div>
            <i aria-hidden="true">VS</i>
            <div>
              <span>상대 팀</span>
              <strong>{awayTeam?.name}</strong>
              <small>{awayFormation.label} · {awayFormation.name}</small>
            </div>
            <button
              type="button"
              disabled={isPlaying || Boolean(activeAction)}
              onClick={openInitialSetup}
            >
              팀·포메이션 변경
            </button>
          </section>

          <label className="sim-field" htmlFor="sim-duration">
            <span>장면 길이</span>
            <input
              id="sim-duration"
              type="number"
              min={SIMULATION_TICK_MS * 2}
              max={MAX_SIMULATION_DURATION_MS}
              step={SIMULATION_TICK_MS}
              value={durationMs}
              disabled={isPlaying || Boolean(activeAction)}
              onChange={(event) => {
                const nextDuration = normalizedDuration(Number(event.target.value));
                const hasOutOfRangeSequence = sortedSequences.some(
                  (sequence) =>
                    sequence.instructions.some(
                      (instruction) => instruction.atMs >= nextDuration,
                    ),
                );
                if (hasOutOfRangeSequence) {
                  setStatusMessage(
                    "기존 액션의 상대 시각을 포함할 수 없는 길이입니다. 먼저 액션 시각을 줄이세요.",
                  );
                  return;
                }
                setDurationMs(nextDuration);
                setActiveAction(null);
                setManualActionOffset((current) =>
                  normalizeManualActionOffsetForTimeline(
                    current,
                    sortedSequences,
                    nextDuration,
                  ),
                );
                invalidateCompilation(
                  "장면 길이를 변경했습니다.",
                );
              }}
            />
            <small>100–15,000ms · 50ms 단위</small>
          </label>

          <label className="sim-field" htmlFor="sim-ball-owner">
            <span>초기 공 위치·소유</span>
            <select
              id="sim-ball-owner"
              value={initialBallPosition ? "" : effectiveBallOwnerId}
              disabled={isPlaying || Boolean(activeAction)}
              onChange={(event) => {
                const nextOwner = event.target.value as ParticipantId;
                if (!nextOwner) {
                  setInitialBallPosition({ ...ballPosition });
                  setBallOwnerId("");
                  const removedCount = invalidateForInitialBallChange();
                  invalidateCompilation(
                    invalidationMessage(
                      "현재 위치에서 루즈볼로 시작합니다.",
                      removedCount,
                    ),
                  );
                  return;
                }
                setBallOwnerId(nextOwner);
                setInitialBallPosition(null);
                const removedCount = invalidateForInitialBallChange();
                invalidateCompilation(
                  invalidationMessage(
                    "초기 공 소유 선수를 변경했습니다.",
                    removedCount,
                  ),
                );
              }}
            >
              <option value="">소유자 없음 · 루즈볼</option>
              <optgroup label={`우리 팀 · ${homeTeam?.name ?? ""}`}>
                {lineupState.home.map((participant) => (
                  <option
                    key={participant.participantId}
                    value={participant.participantId}
                  >
                    {participant.player.number}. {participant.player.name} ·{" "}
                    {participant.role}
                  </option>
                ))}
              </optgroup>
              <optgroup label={`상대 팀 · ${awayTeam?.name ?? ""}`}>
                {lineupState.away.map((participant) => (
                  <option
                    key={participant.participantId}
                    value={participant.participantId}
                  >
                    {participant.player.number}. {participant.player.name} ·{" "}
                    {participant.role}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>

        </aside>

        <div className="sim-pitch-column">
          <div className="sim-tactical-legend">
            <div className="sim-team-legend" aria-label="팀과 공격 방향">
              <span className="sim-legend-home">
                <i aria-hidden="true" /> {homeTeam?.name} 공격 ↑
              </span>
              <span className="sim-legend-away">
                <i aria-hidden="true" /> {awayTeam?.name} 공격 ↓
              </span>
            </div>
            {frame ? (
              <div
                className="sim-phase-legend"
                aria-label="현재 팀 전술 국면"
                aria-live="polite"
                aria-atomic="true"
              >
                <span className="sim-phase-home">
                  {homeTeam?.name}: {tacticalPhaseLabels[frame.tactics.home.phase]}
                  {frame.tactics.home.offsideTrapActive ? " · 오프사이드 라인" : ""}
                </span>
                <span className="sim-phase-away">
                  {awayTeam?.name}: {tacticalPhaseLabels[frame.tactics.away.phase]}
                  {frame.tactics.away.offsideTrapActive ? " · 오프사이드 라인" : ""}
                </span>
              </div>
            ) : null}
            <div
              className="sim-position-legend"
              aria-label="화살표 색상: 공격수 빨강, 미드필더 초록, 수비수 파랑, 골키퍼 노랑"
            >
              <span className="sim-position-fw">
                <i aria-hidden="true">▲▼</i> 공격
              </span>
              <span className="sim-position-mf">
                <i aria-hidden="true">▲▼</i> 미드필더
              </span>
              <span className="sim-position-df">
                <i aria-hidden="true">▲▼</i> 수비
              </span>
              <span className="sim-position-gk">
                <i aria-hidden="true">▲▼</i> 골키퍼
              </span>
            </div>
          </div>
          <p id="sim-pitch-instructions" className="sim-pitch-instructions">
            {selectedSequence
              ? `${selectedSequence.name} 편집 중입니다. 우리 팀 선수를 드래그하면 공 소유자는 운반, 비소유자는 이동으로 저장되고, 공 소유자를 동료에게 놓으면 패스가 됩니다.`
              : "시퀀스를 선택하지 않은 초기 배치 상태입니다. 선수와 공을 드래그해 시작 위치와 공 소유자를 정한 뒤 편집할 시퀀스를 선택하세요."}
          </p>
          <div
            ref={pitchRef}
            className={[
              "sim-pitch",
              isPlaying ? "sim-pitch-locked" : "",
              activeAction && activeAction.type !== "pass"
                ? "sim-pitch-targeting-movement"
                : "",
              activeAction?.type === "pass" ? "sim-pitch-targeting-pass" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            role="group"
            aria-label={`${homeTeam?.name} 대 ${awayTeam?.name} 시뮬레이션 경기장`}
            aria-describedby="sim-pitch-instructions"
            onClick={handlePitchClick}
            onPointerDown={handlePitchPointerDown}
            onPointerMove={handlePitchPointerMove}
            onPointerUp={(event) => finishPitchPathDraw(event)}
            onPointerCancel={(event) => finishPitchPathDraw(event, true)}
          >
            <div className="sim-pitch-stripes" aria-hidden="true" />
            <div className="sim-pitch-boundary" aria-hidden="true" />
            <div className="sim-center-line" aria-hidden="true" />
            <div className="sim-center-circle" aria-hidden="true" />
            <div className="sim-penalty-box sim-penalty-box-top" aria-hidden="true" />
            <div
              className="sim-penalty-box sim-penalty-box-bottom"
              aria-hidden="true"
            />

            {frame
              ? (["home", "away"] as const).map((teamSide) => {
                  const tactics = frame.tactics[teamSide];
                  if (tactics.inPossession || tactics.phase === "loose-ball") {
                    return null;
                  }
                  return (
                    <div
                      key={`defensive-line:${teamSide}`}
                      className={`sim-defensive-line sim-defensive-line-${teamSide}${tactics.offsideTrapActive ? " is-offside" : ""}`}
                      style={
                        {
                          top: `${tactics.defensiveLineY}%`,
                        } as CSSProperties
                      }
                      aria-hidden="true"
                    >
                      <span>
                        {tactics.offsideTrapActive
                          ? "오프사이드 라인"
                          : "수비라인"}
                      </span>
                    </div>
                  );
                })
              : null}

            {selectedParticipant?.teamSide === "home" &&
            selectedSequence &&
            !isPlaying &&
            !activeAction ? (
              <div
                className="sim-pitch-action-bar"
                aria-label={`${selectedParticipant.player.name} 빠른 액션`}
              >
                <strong>{compactPlayerName(selectedParticipant.player.name)}</strong>
                {(["move", "carry", "pass"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      beginAction(type, undefined, event.detail === 0);
                    }}
                  >
                    {type === "move"
                      ? "이동"
                      : type === "carry"
                        ? "운반"
                        : "패스"}
                  </button>
                ))}
              </div>
            ) : null}

            <svg
              className="sim-route-layer"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              role="group"
              aria-label={`${selectedSequence?.name ?? "선택 시퀀스"} 전술 경로`}
            >
              {automaticPaths.map((path) =>
                path.points.length > 1 ? (
                  <polyline
                    key={`auto:${path.participantId}`}
                    className={`sim-route sim-route-automatic ${
                      path.participantId.startsWith("home:")
                        ? "sim-route-home"
                        : "sim-route-away"
                    }`}
                    points={polylinePoints(path.points)}
                    fill="none"
                    vectorEffect="non-scaling-stroke"
                    style={{ pointerEvents: "none" }}
                  />
                ) : null,
              )}
              {activeAction?.type === "pass" && passDragPosition ? (
                <polyline
                  className="sim-route sim-route-pass sim-route-pass-drag"
                  points={polylinePoints([
                    frame?.players[activeAction.playerId]?.position ??
                      placements[activeAction.playerId],
                    passDragPosition,
                  ])}
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                  style={{ pointerEvents: "none" }}
                />
              ) : null}
              {plannedMovementPaths.map(
                ({ instruction, points, cancellationReason }) => (
                  <g
                    key={`manual:${instruction.id}`}
                    data-sim-route
                    role="button"
                    tabIndex={0}
                    aria-label={`${participantsById.get(instruction.playerId)?.player.name ?? "선수"} ${instruction.type === "carry" ? "볼 운반" : "이동"} 경로 편집`}
                    onClick={(event) => {
                      event.stopPropagation();
                      beginAction(
                        instruction.type,
                        instruction,
                        false,
                        effectiveSelectedSequenceId,
                      );
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        beginAction(
                          instruction.type,
                          instruction,
                          true,
                          effectiveSelectedSequenceId,
                        );
                      }
                    }}
                  >
                    <polyline
                      className={`sim-route sim-route-manual sim-route-home sim-route-${instruction.type}${cancellationReason ? " sim-route-cancelled" : ""}`}
                      points={polylinePoints(points)}
                      fill="none"
                      vectorEffect="non-scaling-stroke"
                      style={{ pointerEvents: "none" }}
                    />
                    <polyline
                      className="sim-route-hit"
                      points={polylinePoints(points)}
                      fill="none"
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                ),
              )}
              {plannedPassPaths.map(
                ({ instruction, points, cancellationReason }) => (
                  <g
                    key={`pass:${instruction.id}`}
                    data-sim-route
                    role="button"
                    tabIndex={0}
                    aria-label={`${participantsById.get(instruction.playerId)?.player.name ?? "선수"} 패스 대상 편집`}
                    onClick={(event) => {
                      event.stopPropagation();
                      beginAction(
                        "pass",
                        instruction,
                        false,
                        effectiveSelectedSequenceId,
                      );
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        beginAction(
                          "pass",
                          instruction,
                          true,
                          effectiveSelectedSequenceId,
                        );
                      }
                    }}
                  >
                    <polyline
                      className={`sim-route sim-route-pass ${run ? "sim-route-pass-result" : "sim-route-pass-plan"}${cancellationReason ? " sim-route-cancelled" : ""}`}
                      points={polylinePoints(points)}
                      fill="none"
                      vectorEffect="non-scaling-stroke"
                      style={{ pointerEvents: "none" }}
                    />
                    <polyline
                      className="sim-route-hit"
                      points={polylinePoints(points)}
                      fill="none"
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                ),
              )}
            </svg>

            {plannedMovementPaths.flatMap(
              ({ instruction, cancellationReason }) => {
                const isActivePath =
                  activeAction?.type !== "pass" &&
                  (activeAction?.instructionId
                    ? activeAction.instructionId === instruction.id
                    : instruction.id === "instruction-draft");
                return instruction.waypoints.map((waypoint, index) =>
                  isActivePath ? (
                    <button
                      key={`waypoint:${instruction.id}:${index}`}
                      type="button"
                      data-sim-waypoint
                      className={`sim-waypoint sim-waypoint-${instruction.type}${selectedWaypointIndex === index ? " is-selected" : ""}`}
                      style={
                        {
                          left: `${waypoint.x}%`,
                          top: `${waypoint.y}%`,
                        } as CSSProperties
                      }
                      aria-label={`${index + 1}번째 경로 지점. 드래그 또는 방향키로 이동, Delete로 삭제`}
                      aria-pressed={selectedWaypointIndex === index}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedWaypointIndex(index);
                      }}
                      onKeyDown={(event) =>
                        handleWaypointKeyDown(event, index)
                      }
                      onPointerDown={(event) =>
                        handleWaypointPointerDown(event, index)
                      }
                      onPointerMove={handleWaypointPointerMove}
                      onPointerUp={(event) => finishWaypointDrag(event)}
                      onPointerCancel={(event) =>
                        finishWaypointDrag(event, true)
                      }
                    >
                      {index + 1}
                    </button>
                  ) : (
                    <span
                      key={`waypoint:${instruction.id}:${index}`}
                      className={`sim-waypoint sim-waypoint-${instruction.type}${cancellationReason ? " sim-waypoint-cancelled" : ""}`}
                      style={
                        {
                          left: `${waypoint.x}%`,
                          top: `${waypoint.y}%`,
                        } as CSSProperties
                      }
                      aria-hidden="true"
                    >
                      {index + 1}
                    </span>
                  ),
                );
              },
            )}

            {plannedMovementPaths.flatMap(({ instruction, points }) => {
              const isActivePath =
                activeAction?.type !== "pass" &&
                (activeAction?.instructionId
                  ? activeAction.instructionId === instruction.id
                  : instruction.id === "instruction-draft");
              if (!isActivePath) {
                return [];
              }
              return instruction.waypoints.map((_, index) => {
                const start = points[index];
                const end = points[index + 1];
                const midpoint = {
                  x: (start.x + end.x) / 2,
                  y: (start.y + end.y) / 2,
                };
                return (
                  <button
                    key={`waypoint-insert:${instruction.id}:${index}`}
                    type="button"
                    data-sim-waypoint
                    className="sim-waypoint-insert"
                    style={
                      {
                        left: `${midpoint.x}%`,
                        top: `${midpoint.y}%`,
                      } as CSSProperties
                    }
                    aria-label={`${index + 1}번째 구간 중간에 지점 삽입`}
                    onClick={(event) => {
                      event.stopPropagation();
                      insertDraftWaypoint(index, midpoint);
                    }}
                  >
                    +
                  </button>
                );
              });
            })}

            {activeAction && activeAction.type !== "pass" ? (
              <button
                ref={targetCursorRef}
                type="button"
                data-sim-target-cursor
                className="sim-target-cursor"
                style={
                  {
                    left: `${targetCursor.x}%`,
                    top: `${targetCursor.y}%`,
                  } as CSSProperties
                }
                aria-label={`${activeAction.type === "carry" ? "볼 운반" : "이동"} 목표 커서, 가로 ${targetCursor.x.toFixed(0)}, 세로 ${targetCursor.y.toFixed(0)}. 방향키로 이동, Enter로 지점 추가, Command 또는 Control과 Enter로 경로 완료`}
                aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight Enter Control+Enter Meta+Enter Escape"
                onClick={(event) => {
                  event.stopPropagation();
                  appendWaypointToDraft(targetCursor);
                }}
                onKeyDown={handleTargetCursorKeyDown}
              >
                <span aria-hidden="true">+</span>
              </button>
            ) : null}

            {participants.map((participant) => {
              const placement = placements[participant.participantId];
              const playerFrame = frame?.players[participant.participantId];
              const position = playerFrame?.position ?? placement;
              const isSelected =
                participant.participantId === effectiveSelectedParticipantId;
              const isManual = instructedPlayerIds.has(
                participant.participantId,
              );
              const isPassTarget =
                activeAction?.type === "pass" &&
                participant.teamSide === "home" &&
                participant.participantId !== activeAction.playerId;
              const hasCustomPlacement = Boolean(
                placementOverrides[participant.participantId],
              );
              const isDragging =
                participant.participantId === draggingParticipantId;
              const tokenStyle = {
                left: `${position.x}%`,
                top: `${position.y}%`,
              } as CSSProperties;
              return (
                <button
                  type="button"
                  key={participant.participantId}
                  data-sim-token={participant.participantId}
                  className={[
                    "sim-player-token",
                    participant.teamSide === "home"
                      ? "sim-player-home"
                      : "sim-player-away",
                    positionGroupClass(participant.role),
                    isSelected ? "sim-player-selected" : "",
                    isManual ? "sim-player-manual" : "sim-player-automatic",
                    hasCustomPlacement ? "sim-player-custom-position" : "",
                    isDragging ? "sim-player-dragging" : "",
                    isPassTarget ? "sim-player-pass-target" : "",
                    activeAction?.type === "pass" &&
                    participant.teamSide === "away"
                      ? "sim-player-invalid-target"
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={tokenStyle}
                  aria-pressed={isSelected}
                  aria-label={
                    activeAction?.type === "pass"
                      ? participant.teamSide === "home"
                        ? participant.participantId === activeAction.playerId
                          ? `패스 출발 선수 ${participant.player.name}. 다른 우리 팀 선수를 선택하세요`
                          : `${participant.player.name}에게 패스`
                        : `상대 팀 ${participant.player.name}. 패스 대상 아님, 자동 반응 선수`
                      : isPlaying
                        ? `${participant.teamSide === "home" ? "우리 팀" : "상대 팀"} ${participant.player.name}, ${participant.player.number}번, ${participant.role}. 재생 중 위치 편집 잠금. 선수 정보 보기`
                        : activeAction
                          ? `${participant.teamSide === "home" ? "우리 팀" : "상대 팀"} ${participant.player.name}. 현재 ${activeAction.type === "carry" ? "볼 운반" : "이동"} 목표 지정 중. 선수 위치 편집 잠금`
                          : participant.teamSide === "home"
                            ? selectedSequence
                              ? `우리 팀 ${participant.player.name}, ${participant.player.number}번, ${participant.role}. 목표 지점까지 드래그해 ${effectiveBallOwnerId === participant.participantId ? "볼 운반 또는 동료에게 패스" : "이동"} 지시 생성`
                              : `우리 팀 ${participant.player.name}, ${participant.player.number}번, ${participant.role}. 드래그 또는 방향키로 시작 위치 이동`
                            : selectedSequence
                              ? `상대 팀 ${participant.player.name}, ${participant.player.number}번, ${participant.role}. 자동 반응 선수 정보 보기`
                              : `상대 팀 ${participant.player.name}, ${participant.player.number}번, ${participant.role}. 드래그 또는 방향키로 시작 위치 이동`
                  }
                  aria-keyshortcuts={
                    activeAction?.type === "pass"
                      ? "Enter Space"
                      : !isPlaying && !activeAction
                        ? "ArrowUp ArrowDown ArrowLeft ArrowRight"
                        : undefined
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    if (
                      suppressClickRef.current === participant.participantId
                    ) {
                      suppressClickRef.current = null;
                      return;
                    }
                    if (commitPassTarget(participant.participantId)) {
                      return;
                    }
                    if (activeAction) {
                      setStatusMessage(
                        "현재 이동 지시는 경기장의 빈 지점이나 목표 커서로 지정하세요.",
                      );
                      return;
                    }
                    setSelectedParticipantId(participant.participantId);
                    setStatusMessage(
                      `${participant.player.name} 선수를 선택했습니다.${
                        participant.teamSide === "away"
                          ? " 상대 팀 선수는 자동으로 반응합니다."
                          : ""
                      }`,
                    );
                  }}
                  onKeyDown={(event) =>
                    handlePlayerKeyDown(event, participant.participantId)
                  }
                  onPointerDown={(event) =>
                    handlePlayerPointerDown(
                      event,
                      participant.participantId,
                      position,
                    )
                  }
                  onPointerMove={handlePlayerPointerMove}
                  onPointerUp={(event) => finishPlayerDrag(event)}
                  onPointerCancel={(event) => finishPlayerDrag(event, true)}
                >
                  <span className="sim-player-disc">
                    <small>{participant.role}</small>
                    <strong>{participant.player.number}</strong>
                  </span>
                  <span className="sim-player-name" aria-hidden="true">
                    <span className="sim-player-name-short">
                      {compactPlayerName(participant.player.name)}
                    </span>
                    <span className="sim-player-name-full">
                      {participant.player.name}
                    </span>
                  </span>
                </button>
              );
            })}

            <button
              type="button"
              data-sim-ball
              className={`sim-ball-token${isDraggingBall ? " sim-ball-dragging" : ""}`}
              disabled={isPlaying || Boolean(activeAction)}
              aria-label={
                `${
                  !frame
                    ? initialBallPosition
                      ? "초기 루즈볼"
                      : `${participantsById.get(effectiveBallOwnerId)?.player.name ?? "선수"}가 초기 공 소유`
                    : frame.ball.kind === "controlled" && frame.ball.ownerId
                      ? `${participantsById.get(frame.ball.ownerId)?.player.name ?? "선수"}가 공 소유`
                      : frame.ball.kind === "inFlight"
                        ? "패스 중인 공"
                        : "루즈볼"
                }. 클릭해 패스 대상 선택, 드래그 또는 방향키로 초기 위치 이동`
              }
              aria-keyshortcuts="Enter Space ArrowUp ArrowDown ArrowLeft ArrowRight"
              style={
                {
                  left: `${ballPosition.x}%`,
                  top: `${ballPosition.y}%`,
                } as CSSProperties
              }
              onClick={(event) => {
                event.stopPropagation();
                if (suppressBallClickRef.current) {
                  suppressBallClickRef.current = false;
                  return;
                }
                if (activeAction) {
                  setStatusMessage(
                    activeAction.type === "pass"
                      ? "패스를 받을 우리 팀 선수 토큰을 선택하세요."
                      : "이동 목표는 빈 경기장이나 목표 커서로 지정하세요.",
                  );
                  return;
                }
                beginPassFromBall();
              }}
              onKeyDown={handleBallKeyDown}
              onPointerDown={(event) =>
                handleBallPointerDown(event, ballPosition)
              }
              onPointerMove={handleBallPointerMove}
              onPointerUp={(event) => finishBallDrag(event)}
              onPointerCancel={(event) => finishBallDrag(event, true)}
            >
              <span aria-hidden="true" />
            </button>
          </div>

          <p className="sim-status" role="status" aria-live="polite">
            {compileError ?? lineupState.error ?? liveStatusMessage}
          </p>
        </div>

        <aside className="sim-inspector" aria-labelledby="sim-inspector-title">
          <h3 id="sim-inspector-title">선수·장면 분석</h3>

          {activeAction ? (
            <section
              className="sim-instruction-editor"
              aria-labelledby="sim-instruction-editor-title"
            >
              <header>
                <div>
                  <p className="sim-instruction-kicker">
                    {selectedSequence?.name}
                  </p>
                  <h4 id="sim-instruction-editor-title">
                    {participantsById.get(activeAction.playerId)?.player.name} ·{" "}
                    {activeAction.type === "move"
                      ? "이동"
                      : activeAction.type === "carry"
                        ? "볼 운반"
                        : "패스"}
                  </h4>
                </div>
                <button type="button" onClick={cancelActiveAction}>
                  {activeAction.instructionId ? "편집 닫기" : "액션 취소"}
                </button>
              </header>

              <div className="sim-action-draft" data-action={activeAction.type}>
                <p>
                  {activeAction.type === "pass"
                    ? "받을 선수까지 연결하세요."
                    : `경로 지점을 직접 조정하세요. 현재 ${activeAction.waypoints.length}개 지점입니다.`}
                </p>
                <div className="sim-action-timing-shortcuts">
                  <button
                    type="button"
                    aria-pressed={activeAction.atMs === 0}
                    onClick={() => setActiveActionTiming("simultaneous")}
                  >
                    시퀀스와 동시
                  </button>
                  <button
                    type="button"
                    aria-pressed={activeAction.atMs > 0}
                    onClick={() => setActiveActionTiming("after")}
                  >
                    앞 액션 다음
                  </button>
                </div>
                <div>
                  {activeAction.type !== "pass" ? (
                    <>
                      {!activeAction.instructionId ? (
                        <button type="button" onClick={completeMovementAction}>
                          경로 완료
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={activeAction.waypoints.length === 0}
                        onClick={removeLastDraftWaypoint}
                      >
                        마지막 지점 취소
                      </button>
                      <button
                        type="button"
                        disabled={selectedWaypointIndex === null}
                        onClick={() => {
                          if (selectedWaypointIndex !== null) {
                            deleteDraftWaypoint(selectedWaypointIndex);
                          }
                        }}
                      >
                        선택 지점 삭제
                      </button>
                    </>
                  ) : null}
                  {activeAction.instructionId ? (
                    <button
                      type="button"
                      onClick={() =>
                        removeInstruction(
                          activeAction.sequenceId,
                          activeAction.instructionId!,
                          true,
                        )
                      }
                    >
                      이 지시 삭제
                    </button>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          <section
            className="sim-sequence-editor"
            aria-labelledby="sim-sequence-editor-title"
          >
            <header>
              <div>
                <h4 id="sim-sequence-editor-title">전술 시퀀스</h4>
                <p>위에서 아래 순서대로 실행 · 완료 상태를 다음 시작점으로 연결</p>
              </div>
              <button
                type="button"
                disabled={
                  isPlaying ||
                  Boolean(activeAction) ||
                  !sortedSequences.at(-1)?.instructions.length
                }
                onClick={createSequence}
                aria-describedby="sim-sequence-add-help"
              >
                시퀀스 추가
              </button>
            </header>
            <p id="sim-sequence-add-help" className="sim-form-help">
              마지막 시퀀스에 지시가 있어야 다음 시퀀스를 추가할 수 있습니다.
            </p>
            {sortedInstructions.some(
              (instruction) => instruction.type === "pass",
            ) ? (
              <p className="sim-pass-path-note">
                선택한 시퀀스의 이동·패스 선은 경기장에서 직접 선택해 편집합니다.
              </p>
            ) : null}
            <ol className="sim-sequence-list" aria-label="전술 시퀀스 목록">
              {sortedSequences.map((sequence, sequenceIndex) => {
                const status = sequenceStatusById.get(sequence.id) ?? "waiting";
                const statusLabel =
                  status === "current"
                    ? "현재"
                    : status === "executed"
                      ? "실행됨"
                      : status === "timed-out"
                        ? "시간 초과"
                      : "대기";
                const sequenceInstructions = sortTacticalInstructions(
                  sequence.instructions,
                ) as TacticalInstruction[];
                return (
                  <li
                    key={sequence.id}
                    className={`sim-sequence-card is-${status}${
                      sequence.id === effectiveSelectedSequenceId
                        ? " is-selected"
                        : ""
                    }`}
                    aria-current={status === "current" ? "step" : undefined}
                  >
                    <header>
                      <button
                        type="button"
                        className="sim-sequence-select"
                        ref={(node) => {
                          if (node) {
                            sequenceSelectRefs.current.set(sequence.id, node);
                          } else {
                            sequenceSelectRefs.current.delete(sequence.id);
                          }
                        }}
                        aria-pressed={
                          sequence.id === effectiveSelectedSequenceId
                        }
                        disabled={isPlaying || Boolean(activeAction)}
                        onClick={() => {
                          const isDeselecting =
                            sequence.id === effectiveSelectedSequenceId;
                          setSelectedSequenceId(
                            isDeselecting ? "" : sequence.id,
                          );
                          setManualActionOffset(null);
                          setStatusMessage(
                            isDeselecting
                              ? "시퀀스 선택을 해제했습니다. 초기 배치를 조정할 수 있습니다."
                              : `선택한 시퀀스: ${sequence.name}`,
                          );
                        }}
                      >
                        <span aria-hidden="true">{sequenceIndex + 1}</span>
                        <strong>{sequence.name}</strong>
                        <small>{sequenceInstructions.length}개 액션</small>
                      </button>
                      <span className={`sim-sequence-status is-${status}`}>
                        {statusLabel}
                      </span>
                    </header>

                    <div className="sim-sequence-fields">
                      <label htmlFor={`sim-sequence-name-${sequence.id}`}>
                        <span>이름</span>
                        <input
                          key={`${sequence.id}:${sequence.name}`}
                          id={`sim-sequence-name-${sequence.id}`}
                          type="text"
                          defaultValue={sequence.name}
                          disabled={isPlaying || Boolean(activeAction)}
                          onBlur={(event) => {
                            const nextName =
                              event.currentTarget.value.trim() ||
                              `시퀀스 ${sequence.order}`;
                            event.currentTarget.value = nextName;
                            renameSequence(sequence.id, nextName);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.currentTarget.blur();
                            }
                            if (event.key === "Escape") {
                              event.currentTarget.value = sequence.name;
                              event.currentTarget.blur();
                            }
                          }}
                        />
                      </label>
                    </div>

                    <div className="sim-sequence-actions">
                      <button
                        type="button"
                        disabled={
                          sequenceIndex === 0 ||
                          isPlaying ||
                          Boolean(activeAction)
                        }
                        onClick={() => moveSequence(sequence.id, -1)}
                        aria-label={`${sequence.name}: 앞 시퀀스와 교환`}
                      >
                        위로
                      </button>
                      <button
                        type="button"
                        disabled={
                          sequenceIndex >= sortedSequences.length - 1 ||
                          isPlaying ||
                          Boolean(activeAction)
                        }
                        onClick={() => moveSequence(sequence.id, 1)}
                        aria-label={`${sequence.name}: 다음 시퀀스와 교환`}
                      >
                        아래로
                      </button>
                      <button
                        type="button"
                        disabled={
                          sequence.instructions.length > 0 ||
                          sortedSequences.length <= 1 ||
                          isPlaying ||
                          Boolean(activeAction)
                        }
                        onClick={() => deleteSequence(sequence.id)}
                        aria-label={`${sequence.name} 삭제`}
                      >
                        빈 시퀀스 삭제
                      </button>
                    </div>

                    <p className="sim-sequence-summary">
                      {sequenceInstructions.length === 0
                        ? "빈 시퀀스 · 선택한 뒤 경기장에서 액션을 추가하세요."
                        : `${sequenceInstructions.length}개 액션 · 선택하면 경기장에 해당 경로만 표시됩니다.`}
                    </p>
                  </li>
                );
              })}
            </ol>
          </section>

          {selectedParticipant ? (
            <section className="sim-player-card">
              <header>
                <span>{selectedParticipant.player.number}</span>
                <div>
                  <small>
                    {selectedParticipant.teamSide === "home"
                      ? homeTeam?.name
                      : awayTeam?.name}
                  </small>
                  <h4>{selectedParticipant.player.name}</h4>
                  <p>
                    {selectedParticipant.player.club} · 만{" "}
                    {selectedParticipant.player.age}세
                  </p>
                  <p>
                    {selectedParticipant.player.position} · 역할{" "}
                    {selectedParticipant.role}
                  </p>
                </div>
              </header>

              {selectedParticipant.teamSide === "home" &&
              selectedTacticalRole ? (
                <section
                  className="sim-player-role-editor"
                  aria-labelledby={`sim-player-role-${selectedParticipant.player.id}`}
                >
                  <header>
                    <div>
                      <small>지속 전술 역할</small>
                      <h5
                        id={`sim-player-role-${selectedParticipant.player.id}`}
                      >
                        {selectedTacticalRolePreset?.label ?? "사용자 정의"}
                      </h5>
                    </div>
                    <span>
                      현재 판단 ·{" "}
                      {selectedFramePlayer
                        ? automaticBehaviorLabels[
                            selectedFramePlayer.behavior
                          ] ?? selectedFramePlayer.behavior
                        : "재생 시 표시"}
                    </span>
                  </header>

                  <div
                    className="sim-role-presets"
                    role="radiogroup"
                    aria-label={`${selectedParticipant.player.name} 전술 역할 프리셋`}
                  >
                    {selectedTacticalRolePresets.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        role="radio"
                        aria-checked={selectedTacticalRole.presetId === preset.id}
                        disabled={isPlaying || Boolean(activeAction)}
                        onClick={() =>
                          applySelectedTacticalRolePreset(preset.id)
                        }
                      >
                        <strong>{preset.label}</strong>
                        <small>{preset.description}</small>
                      </button>
                    ))}
                  </div>

                  <p className="sim-role-description">
                    {selectedTacticalRolePreset?.description ??
                      "선택한 프리셋을 기반으로 세부 성향을 직접 조정한 상태입니다."}
                  </p>

                  <details className="sim-role-customizer">
                    <summary>세부 성향 직접 조정</summary>
                    <div>
                      {tacticalRoleFields.map(({ field, label, options }) => (
                        <label
                          key={field}
                          htmlFor={`sim-role-${selectedParticipant.player.id}-${field}`}
                        >
                          <span>{label}</span>
                          <select
                            id={`sim-role-${selectedParticipant.player.id}-${field}`}
                            value={selectedTacticalRole[field]}
                            disabled={isPlaying || Boolean(activeAction)}
                            onChange={(event) =>
                              updateSelectedTacticalRole(
                                field,
                                event.target.value,
                              )
                            }
                          >
                            {options.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                  </details>

                  <button
                    type="button"
                    className="sim-role-reset"
                    disabled={
                      isPlaying ||
                      Boolean(activeAction) ||
                      selectedTacticalRole.presetId ===
                        createDefaultPlayerTacticalRole(
                          selectedParticipant.role,
                        ).presetId
                    }
                    onClick={resetSelectedTacticalRole}
                  >
                    포지션 기본 역할로 되돌리기
                  </button>
                </section>
              ) : null}

              <dl className="sim-live-player-metrics">
                <div>
                  <dt>이동 거리</dt>
                  <dd>
                    {metres(
                      selectedFramePlayer?.distanceM ??
                        summary?.players[selectedParticipant.participantId]
                          ?.distanceM ??
                        0,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>ETA</dt>
                  <dd>
                    {selectedRoute.length > 0
                      ? selectedEta === null
                        ? run
                          ? "장면 내 미도착"
                          : "컴파일 후 계산"
                        : seconds(selectedEta)
                      : "자동 경로"}
                  </dd>
                </div>
                <div>
                  <dt>최근접 팀원</dt>
                  <dd>{metres(selectedProximity?.nearestTeammateM)}</dd>
                </div>
                <div>
                  <dt>최근접 상대</dt>
                  <dd>{metres(selectedProximity?.nearestOpponentM)}</dd>
                </div>
              </dl>

              {selectedParticipant.teamSide === "home" ? (
                <button
                  type="button"
                  disabled={
                    isPlaying ||
                    Boolean(activeAction) ||
                    !selectedSequenceHasMovement
                  }
                  onClick={clearSelectedRoute}
                >
                  {selectedSequence?.name ?? "선택 시퀀스"}의 선택 선수 경로 삭제
                </button>
              ) : null}

              {placementOverrides[selectedParticipant.participantId] ? (
                <button
                  type="button"
                  disabled={
                    isPlaying || Boolean(activeAction) || Boolean(selectedSequence)
                  }
                  onClick={resetSelectedPlacement}
                >
                  선택 선수 시작 위치 초기화
                </button>
              ) : null}

              <div className="sim-ability-grid" aria-label="실제 선수 능력치">
                {abilityLabels.map(([field, label]) => (
                  <div key={field}>
                    <span>{label}</span>
                    <strong>{selectedParticipant.player.abilities[field]}</strong>
                  </div>
                ))}
                {selectedParticipant.player.goalkeeperAbilities
                  ? goalkeeperAbilityLabels.map(([field, label]) => (
                      <div key={`gk:${field}`}>
                        <span>{label}</span>
                        <strong>
                          {
                            selectedParticipant.player.goalkeeperAbilities?.[
                              field
                            ]
                          }
                        </strong>
                      </div>
                    ))
                  : null}
              </div>
            </section>
          ) : (
            <p>경기장의 선수를 선택하세요.</p>
          )}

          <section className="sim-team-metrics" aria-labelledby="sim-shape-title">
            <h4 id="sim-shape-title">팀 대형 변화</h4>
            {(["home", "away"] as const).map((side) => {
              const metrics = frame?.metrics.teams[side];
              const initialMetrics = run?.frames[0]?.metrics.teams[side];
              const widthChange =
                metrics && initialMetrics
                  ? metrics.widthM - initialMetrics.widthM
                  : undefined;
              const depthChange =
                metrics && initialMetrics
                  ? metrics.depthM - initialMetrics.depthM
                  : undefined;
              const spacingChange =
                metrics && initialMetrics
                  ? metrics.averageNearestTeammateDistanceM -
                    initialMetrics.averageNearestTeammateDistanceM
                  : undefined;
              return (
                <article key={side}>
                  <h5>
                    {side === "home" ? homeTeam?.name : awayTeam?.name}
                  </h5>
                  <dl>
                    <div>
                      <dt>폭</dt>
                      <dd>
                        {metres(metrics?.widthM)} · 변화{" "}
                        {metres(widthChange)}
                      </dd>
                    </div>
                    <div>
                      <dt>깊이</dt>
                      <dd>
                        {metres(metrics?.depthM)} · 변화{" "}
                        {metres(depthChange)}
                      </dd>
                    </div>
                    <div>
                      <dt>평균 간격</dt>
                      <dd>
                        {metres(metrics?.averageNearestTeammateDistanceM)} · 변화{" "}
                        {metres(spacingChange)}
                      </dd>
                    </div>
                  </dl>
                </article>
              );
            })}
          </section>

          <section className="sim-event-log" aria-labelledby="sim-event-title">
            <div>
              <h4 id="sim-event-title">시뮬레이션 이벤트</h4>
              {summary ? (
                <span>
                  시도 {summary.passes.attempted} · 성공{" "}
                  {summary.passes.received} · 차단{" "}
                  {summary.passes.intercepted} · 미완료{" "}
                  {summary.passes.incomplete} · 취소{" "}
                  {summary.passes.cancelled} · 루즈볼 회수{" "}
                  {summary.passes.recovered}
                </span>
              ) : null}
            </div>
            {visibleEvents.length > 0 ? (
              <ol>
                {visibleEvents.map((event, index) => (
                    <li key={`${event.type}:${event.atMs}:${event.passId ?? event.instructionId ?? event.playerId ?? index}`}>
                    {eventDescription(event, participantsById)}
                  </li>
                ))}
              </ol>
            ) : (
              <p>재생된 시뮬레이션 이벤트가 없습니다.</p>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}

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
  appendTacticalInstruction,
  isMovementInstruction,
  nextInstructionTimeMs,
  normalizeInstructionTimeMs,
  reorderTacticalInstruction,
  removeTacticalInstruction,
  replaceTacticalInstruction,
  sortTacticalInstructions,
} from "../lib/instruction-model.js";
import {
  positionForFormationRole,
  selectDefaultLineup,
} from "../lib/player-catalog.js";
import { compactPlayerName } from "../lib/player-name.js";
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

function positionGroupClass(role: string) {
  return `sim-player-position-${positionForFormationRole(role).toLowerCase()}`;
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

type MovementActionDraft = {
  type: "move" | "carry";
  playerId: ParticipantId;
  atMs: number;
  waypoints: PitchPoint[];
  instructionId?: string;
  order?: number;
};

type PassActionDraft = {
  type: "pass";
  playerId: ParticipantId;
  atMs: number;
  instructionId?: string;
  order?: number;
};

type ActionDraft = MovementActionDraft | PassActionDraft;

type ManualActionTime = {
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
  events: SimulationEvent[];
};

type SimulationRun = {
  tickMs: number;
  durationMs: number;
  frames: SimulationFrame[];
  config: Record<string, number>;
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

function SetupFormationPreview({
  teamName,
  formation,
  lineup,
  teamSide,
}: {
  teamName: string;
  formation: Formation;
  lineup: LineupParticipant[];
  teamSide: TeamSide;
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
              className={`sim-setup-mini-player sim-setup-mini-player-${teamSide}`}
              style={
                {
                  left: `${slot.x}%`,
                  top: `${slot.y}%`,
                } as CSSProperties
              }
            >
              <strong>{participant.player.number}</strong>
              <small>{participant.role}</small>
            </span>
          );
        })}
      </div>
      <ol className="sim-setup-lineup" aria-label={`${teamName} 자동 선발 명단`}>
        {lineup.map((participant) => (
          <li key={participant.participantId}>
            <span>{participant.role}</span>
            <strong>{participant.player.number}</strong>
            <small>{compactPlayerName(participant.player.name)}</small>
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
    case "ball_recovered":
      return `${seconds(event.atMs)} ${playerName(event.playerId)} 루즈볼 회수`;
    default:
      return `${seconds(event.atMs)} ${event.type}`;
  }
}

function instructionCancellationLabel(reason: string) {
  if (reason === "player_busy") {
    return "이전 이동이 끝나지 않음";
  }
  if (reason === "no_possession") {
    return "공 소유권 없음";
  }
  return reason;
}

type WorkspaceRunSource = {
  durationMs: number;
  participants: LineupParticipant[];
  placements: PlacementMap;
  initialBallPosition: PitchPoint | null;
  initialBallOwnerId: ParticipantId | "";
  instructions: TacticalInstruction[];
  lineupError: string | null;
};

function compileWorkspaceRun({
  durationMs,
  participants,
  placements,
  initialBallPosition,
  initialBallOwnerId,
  instructions,
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
    })),
    ...(initialBallPosition
      ? { initialBallPosition: { ...initialBallPosition } }
      : { initialBallOwnerId }),
    instructions: (
      sortTacticalInstructions(instructions) as TacticalInstruction[]
    ).map((instruction) =>
      isMovementInstruction(instruction)
        ? {
            ...instruction,
            waypoints: (instruction as MovementInstruction).waypoints.map(
              (waypoint) => ({ ...waypoint }),
            ),
          }
        : { ...instruction },
    ),
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
  const [selectedParticipantId, setSelectedParticipantId] =
    useState<ParticipantId | null>(null);
  const [placementOverrides, setPlacementOverrides] =
    useState<PlacementOverrideMap>({});
  const [draggingParticipantId, setDraggingParticipantId] =
    useState<ParticipantId | null>(null);
  const [instructions, setInstructions] = useState<TacticalInstruction[]>([]);
  const [activeAction, setActiveAction] = useState<ActionDraft | null>(null);
  const [manualActionTime, setManualActionTime] =
    useState<ManualActionTime | null>(null);
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
    "우리 팀 선수를 선택하고 지시 패널에서 이동·볼 운반·패스를 지정하세요.",
  );

  const pitchRef = useRef<HTMLDivElement>(null);
  const targetCursorRef = useRef<HTMLButtonElement>(null);
  const shouldFocusTargetCursorRef = useRef(false);
  const shouldFocusPassTargetRef = useRef(false);
  const dragRef = useRef<DragState | null>(null);
  const ballDragRef = useRef<BallDragState | null>(null);
  const suppressClickRef = useRef<ParticipantId | null>(null);
  const suppressBallClickRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);
  const cursorRef = useRef(0);
  const nextInstructionOrderRef = useRef(1);

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
    draftAwayFormationId !== awayFormationId;

  const setupPreviewState = useMemo(() => {
    if (!setupTeamsAreDistinct) {
      return {
        home: [] as LineupParticipant[],
        away: [] as LineupParticipant[],
        error: "우리 팀과 상대 팀은 서로 다른 국가를 선택해야 합니다.",
      };
    }
    try {
      return {
        home: selectLineup(
          catalog,
          draftHomeTeamId,
          "home",
          draftHomeFormation,
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
    draftHomeFormation,
    draftHomeTeamId,
    setupTeamsAreDistinct,
  ]);

  const lineupState = useMemo(() => {
    try {
      return {
        home: selectLineup(catalog, homeTeamId, "home", homeFormation),
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
  }, [awayFormation, awayTeamId, catalog, homeFormation, homeTeamId]);

  const participants = useMemo(
    () => [...lineupState.home, ...lineupState.away],
    [lineupState.away, lineupState.home],
  );
  const homeParticipants = lineupState.home;
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

  const sortedInstructions = useMemo(
    () => sortTacticalInstructions(instructions) as TacticalInstruction[],
    [instructions],
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
  const displayInstructions = useMemo(() => {
    if (
      !activeAction ||
      activeAction.type === "pass" ||
      activeAction.waypoints.length === 0
    ) {
      return sortedInstructions;
    }
    const draftInstruction: MovementInstruction = {
      id: activeAction.instructionId ?? "instruction-draft",
      order: activeAction.order ?? Number.MAX_SAFE_INTEGER,
      type: activeAction.type,
      playerId: activeAction.playerId,
      atMs: activeAction.atMs,
      waypoints: activeAction.waypoints.map((waypoint) => ({ ...waypoint })),
    };
    const next = activeAction.instructionId
      ? sortedInstructions.map((instruction) =>
          instruction.id === activeAction.instructionId
            ? draftInstruction
            : instruction,
        )
      : [...sortedInstructions, draftInstruction];
    return sortTacticalInstructions(next) as TacticalInstruction[];
  }, [activeAction, sortedInstructions]);
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
        instructions: displayInstructions,
        lineupError: lineupState.error,
      });
    } catch {
      return null;
    }
  }, [
    displayInstructions,
    draggingParticipantId,
    durationMs,
    effectiveBallOwnerId,
    initialBallPosition,
    isDraggingBall,
    lineupState.error,
    participants,
    placements,
  ]);
  const routeRun = activeAction
    ? instructionPreviewRun
    : run ?? instructionPreviewRun;
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
      const instructionFrame = routeRun
        ? (sampleSimulation(routeRun, movement.atMs) as SimulationFrame)
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
    placements,
    routeRun,
  ]);
  const plannedPassPaths = useMemo(
    () =>
      sortedInstructions.flatMap((instruction) => {
        if (instruction.type !== "pass") {
          return [];
        }
        const instructionFrame = routeRun
          ? (sampleSimulation(routeRun, instruction.atMs) as SimulationFrame)
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
    [instructionCancellationById, placements, routeRun, sortedInstructions],
  );

  const suggestedActionAtMs = useMemo<number | null | undefined>(() => {
    if (
      !effectiveSelectedParticipantId ||
      selectedParticipant?.teamSide !== "home" ||
      activeAction ||
      draggingParticipantId ||
      isDraggingBall
    ) {
      return undefined;
    }
    const baseAtMs = nextInstructionTimeMs(
      sortedInstructions,
      effectiveSelectedParticipantId,
      durationMs,
    );
    if (baseAtMs === null) {
      return null;
    }
    const latestMovement = confirmedMovementInstructions
      .filter(
        (instruction) =>
          instruction.playerId === effectiveSelectedParticipantId,
      )
      .at(-1);
    if (!latestMovement || !instructionPreviewRun) {
      return baseAtMs;
    }
    if (
      instructionCancellationById.get(latestMovement.id) === "no_possession"
    ) {
      return baseAtMs;
    }
    const arrivalAtMs = (
      summarizeSimulation(instructionPreviewRun) as SimulationSummary
    ).players[effectiveSelectedParticipantId]?.arrivedAtMs;
    if (arrivalAtMs === null || arrivalAtMs === undefined) {
      return null;
    }
    const candidate = Math.max(
      baseAtMs,
      arrivalAtMs + SIMULATION_TICK_MS,
    );
    return candidate < durationMs
      ? normalizeInstructionTimeMs(candidate, durationMs)
      : null;
  }, [
    activeAction,
    confirmedMovementInstructions,
    draggingParticipantId,
    durationMs,
    effectiveSelectedParticipantId,
    instructionCancellationById,
    instructionPreviewRun,
    isDraggingBall,
    selectedParticipant?.teamSide,
    sortedInstructions,
  ]);
  const selectedManualActionTime =
    manualActionTime?.playerId === effectiveSelectedParticipantId
      ? manualActionTime
      : null;
  const nextActionAtMs =
    selectedManualActionTime?.atMs ??
    (typeof suggestedActionAtMs === "number" ? suggestedActionAtMs : 0);
  const actionTimeRequiresInput =
    !activeAction &&
    selectedParticipant?.teamSide === "home" &&
    suggestedActionAtMs === null &&
    !selectedManualActionTime;

  const frame = useMemo(
    () =>
      run
        ? (sampleSimulation(run, cursorMs) as SimulationFrame)
        : null,
    [cursorMs, run],
  );
  const summary = useMemo(
    () =>
      run
        ? (summarizeSimulation(run) as SimulationSummary)
        : null,
    [run],
  );
  const hasScenarioChanges =
    instructions.length > 0 ||
    Object.keys(placementOverrides).length > 0 ||
    initialBallPosition !== null ||
    ballOwnerId !== "" ||
    run !== null ||
    cursorMs > 0;

  const automaticPaths = useMemo(() => {
    if (!run) {
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
  }, [instructedPlayerIds, participants, placements, run]);

  const visibleEvents = useMemo(
    () =>
      run
        ? run.frames
            .flatMap((candidate) => candidate.events)
            .filter((event) => event.atMs <= cursorMs)
        : [],
    [cursorMs, run],
  );

  useEffect(() => {
    cursorRef.current = cursorMs;
  }, [cursorMs]);

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

  function resetScenarioForSetup(message: string) {
    setSelectedParticipantId(null);
    setDraggingParticipantId(null);
    setIsDraggingBall(false);
    setActiveAction(null);
    setInstructions([]);
    setManualActionTime(null);
    setTargetCursor({ x: 50, y: 50 });
    setBallOwnerId("");
    setInitialBallPosition(null);
    setPlacementOverrides({});
    dragRef.current = null;
    ballDragRef.current = null;
    suppressClickRef.current = null;
    suppressBallClickRef.current = false;
    nextInstructionOrderRef.current = 1;
    invalidateCompilation(message);
  }

  function openInitialSetup() {
    setIsPlaying(false);
    setDraftHomeTeamId(homeTeamId);
    setDraftAwayTeamId(awayTeamId);
    setDraftHomeFormationId(homeFormationId);
    setDraftAwayFormationId(awayFormationId);
    setShowSetupResetConfirmation(false);
    setSetupStep("formations");
  }

  function cancelInitialSetup() {
    setDraftHomeTeamId(homeTeamId);
    setDraftAwayTeamId(awayTeamId);
    setDraftHomeFormationId(homeFormationId);
    setDraftAwayFormationId(awayFormationId);
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
        invalidateCompilation(
          `${nextOwner?.player.name ?? "선수"}를 초기 공 소유자로 지정했습니다.`,
        );
      } else {
        invalidateCompilation("공을 초기 루즈볼 위치에 배치했습니다.");
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
    if (!direction || isPlaying || activeAction) {
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
    invalidateCompilation("공 시작 위치를 방향키로 변경했습니다.");
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
      invalidateCompilation(
        `${participant?.player.name ?? "선수"}의 시작 위치를 변경했습니다.`,
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

    if (!direction || isPlaying || activeAction) {
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
    invalidateCompilation(
      `${participant?.player.name ?? "선수"}의 시작 위치를 방향키로 변경했습니다.`,
    );
  }

  function handlePitchClick(event: MouseEvent<HTMLDivElement>) {
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

  function beginAction(
    type: TacticalInstruction["type"],
    instruction?: TacticalInstruction,
    focusTarget = false,
  ) {
    if (isPlaying) {
      setStatusMessage("재생 중에는 지시를 편집할 수 없습니다.");
      return;
    }
    if (activeAction) {
      setStatusMessage("현재 액션을 완료하거나 취소한 뒤 다른 지시를 편집하세요.");
      return;
    }
    const playerId = instruction?.playerId ?? effectiveSelectedParticipantId;
    const participant = playerId ? participantsById.get(playerId) : undefined;
    if (!playerId || participant?.teamSide !== "home") {
      setStatusMessage("우리 팀 선수를 먼저 선택하세요.");
      return;
    }
    if (!instruction && actionTimeRequiresInput) {
      setStatusMessage(
        "장면 안에서 충돌 없는 자동 시각을 찾지 못했습니다. 실행 시각을 직접 입력한 뒤 액션을 선택하세요.",
      );
      return;
    }
    const atMs = normalizeInstructionTimeMs(
      instruction?.atMs ?? nextActionAtMs,
      durationMs,
    );
    const movement = instruction && isMovementInstruction(instruction)
      ? (instruction as MovementInstruction)
      : null;
    const plannedFallback = confirmedMovementInstructions
      .filter(
        (candidate) =>
          candidate.playerId === playerId &&
          candidate.id !== instruction?.id &&
          candidate.atMs <= atMs,
      )
      .at(-1)
      ?.waypoints.at(-1);
    const instructionFrame = instructionPreviewRun
      ? (sampleSimulation(
          instructionPreviewRun,
          instruction?.atMs ?? nextActionAtMs,
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
    setManualActionTime(null);
    setTargetCursor(initialTarget);
    shouldFocusTargetCursorRef.current =
      focusTarget && type !== "pass";
    shouldFocusPassTargetRef.current = focusTarget && type === "pass";
    if (type === "pass") {
      setActiveAction({
        type,
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
      playerId,
      atMs,
      waypoints: movement?.waypoints.map((waypoint) => ({ ...waypoint })) ?? [],
      instructionId: instruction?.id,
      order: instruction?.order,
    });
    setStatusMessage(
      `${participant.player.name}의 ${type === "carry" ? "볼 운반" : "이동"} 지점을 경기장에서 지정하세요.`,
    );
  }

  function handleBeginActionKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    type: TacticalInstruction["type"],
    instruction?: TacticalInstruction,
  ) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    beginAction(type, instruction, true);
  }

  function cancelActiveAction() {
    if (!activeAction) {
      return;
    }
    setActiveAction(null);
    setStatusMessage("현재 액션 편집을 취소했습니다. 기존 지시는 유지됩니다.");
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

  function completeMovementAction() {
    if (!activeAction || activeAction.type === "pass") {
      return;
    }
    if (activeAction.waypoints.length === 0) {
      setStatusMessage("경기장에서 이동 지점을 하나 이상 지정하세요.");
      return;
    }
    const instruction: MovementInstruction = {
      id:
        activeAction.instructionId ??
        `instruction-${nextInstructionOrderRef.current}`,
      order:
        activeAction.order ?? nextInstructionOrderRef.current++,
      type: activeAction.type,
      playerId: activeAction.playerId,
      atMs: activeAction.atMs,
      waypoints: activeAction.waypoints.map((waypoint) => ({ ...waypoint })),
    };
    const nextInstructions = activeAction.instructionId
      ? (replaceTacticalInstruction(
          instructions,
          instruction,
        ) as TacticalInstruction[])
      : (appendTacticalInstruction(
          instructions,
          instruction,
        ) as TacticalInstruction[]);
    setInstructions(nextInstructions);
    setActiveAction(null);
    invalidateCompilation(
      `${participantsById.get(instruction.playerId)?.player.name ?? "선수"}의 ${instruction.type === "carry" ? "볼 운반" : "이동"} 지시를 저장했습니다.`,
    );
  }

  function removeLastDraftWaypoint() {
    if (!activeAction || activeAction.type === "pass") {
      return;
    }
    setActiveAction({
      ...activeAction,
      waypoints: activeAction.waypoints.slice(0, -1),
    });
    setStatusMessage("현재 경로의 마지막 지점을 되돌렸습니다.");
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
    const instruction: PassInstruction = {
      id:
        activeAction.instructionId ??
        `instruction-${nextInstructionOrderRef.current}`,
      order:
        activeAction.order ?? nextInstructionOrderRef.current++,
      type: "pass",
      playerId: activeAction.playerId,
      atMs: activeAction.atMs,
      targetPlayerId,
    };
    const nextInstructions = activeAction.instructionId
      ? (replaceTacticalInstruction(
          instructions,
          instruction,
        ) as TacticalInstruction[])
      : (appendTacticalInstruction(
          instructions,
          instruction,
        ) as TacticalInstruction[]);
    setInstructions(nextInstructions);
    setActiveAction(null);
    setSelectedParticipantId(instruction.playerId);
    invalidateCompilation(
      `${seconds(instruction.atMs)} ${participantsById.get(instruction.playerId)?.player.name ?? "선수"} → ${target.player.name} 패스 지시를 저장했습니다.`,
    );
    return true;
  }

  function updateInstructionTime(instructionId: string, value: number) {
    if (isPlaying) {
      return;
    }
    const instruction = instructions.find(
      (candidate) => candidate.id === instructionId,
    );
    if (!instruction) {
      return;
    }
    const nextInstruction = {
      ...instruction,
      atMs: normalizeInstructionTimeMs(value, durationMs),
    } as TacticalInstruction;
    const nextInstructions = replaceTacticalInstruction(
      instructions,
      nextInstruction,
    ) as TacticalInstruction[];
    setInstructions(nextInstructions);
    invalidateCompilation("지시 실행 시각을 변경해 순서를 다시 정렬했습니다.");
  }

  function removeInstruction(instructionId: string) {
    if (isPlaying) {
      return;
    }
    const nextInstructions = removeTacticalInstruction(
      instructions,
      instructionId,
    ) as TacticalInstruction[];
    setInstructions(nextInstructions);
    if (activeAction?.instructionId === instructionId) {
      setActiveAction(null);
    }
    invalidateCompilation("선수 지시를 삭제했습니다.");
  }

  function reorderInstruction(instructionId: string, direction: -1 | 1) {
    if (isPlaying) {
      return;
    }
    const next = reorderTacticalInstruction(
      instructions,
      instructionId,
      direction,
    ) as TacticalInstruction[];
    if (
      next.map((instruction) => instruction.id).join(":") ===
      sortedInstructions.map((instruction) => instruction.id).join(":")
    ) {
      setStatusMessage("같은 실행 시각의 지시끼리만 순서를 바꿀 수 있습니다.");
      return;
    }
    setInstructions(next);
    invalidateCompilation("같은 시각에 실행되는 지시 순서를 변경했습니다.");
  }

  function clearSelectedRoute() {
    if (!effectiveSelectedParticipantId || isPlaying) {
      return;
    }
    const next = instructions.filter(
      (instruction) =>
        instruction.playerId !== effectiveSelectedParticipantId ||
        !isMovementInstruction(instruction),
    );
    setInstructions(sortTacticalInstructions(next) as TacticalInstruction[]);
    setActiveAction(null);
    invalidateCompilation("선택한 선수의 이동·볼 운반 지시를 삭제했습니다.");
  }

  function resetSelectedPlacement() {
    if (!effectiveSelectedParticipantId || isPlaying) {
      return;
    }
    setPlacementOverrides((current) => {
      const next = { ...current };
      delete next[effectiveSelectedParticipantId];
      return next;
    });
    invalidateCompilation("선택한 선수의 시작 위치를 포메이션 기본값으로 되돌렸습니다.");
  }

  function clearAllInstructions() {
    if (isPlaying) {
      return;
    }
    const defaultOwner =
      homeParticipants.find((participant) => participant.role.includes("ST")) ??
      homeParticipants[0];
    setSelectedParticipantId(null);
    setActiveAction(null);
    setInstructions([]);
    setManualActionTime(null);
    setPlacementOverrides({});
    setBallOwnerId(defaultOwner?.participantId ?? "");
    setInitialBallPosition(null);
    invalidateCompilation("모든 초기 배치·이동·패스 지시를 초기화했습니다.");
  }

  function buildRun(
    instructionSource: TacticalInstruction[] = sortedInstructions,
  ) {
    return compileWorkspaceRun({
      durationMs,
      participants,
      placements,
      initialBallPosition,
      initialBallOwnerId: effectiveBallOwnerId,
      instructions: instructionSource,
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
                  onChange={(event) => setDraftHomeTeamId(event.target.value)}
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
                  onChange={(event) => setDraftAwayTeamId(event.target.value)}
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
                      onClick={() => setDraftHomeFormationId(formation.id)}
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
                />
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
                      onClick={() => setDraftAwayFormationId(formation.id)}
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
            우리 팀의 이동·볼 운반·패스를 지시하면 상대 팀이 능력치에 따라
            결정론적으로 압박·커버·차단하며 전술적 빈틈을 드러냅니다.
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
            onClick={clearAllInstructions}
            disabled={isPlaying}
          >
            지시 전체 초기화
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
            </div>
            <i aria-hidden="true">VS</i>
            <div>
              <span>상대 팀</span>
              <strong>{awayTeam?.name}</strong>
              <small>{awayFormation.label} · {awayFormation.name}</small>
            </div>
            <button type="button" onClick={openInitialSetup}>
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
              disabled={isPlaying}
              onChange={(event) => {
                const nextDuration = normalizedDuration(Number(event.target.value));
                const boundedInstructions = instructions.filter(
                  (instruction) => instruction.atMs < nextDuration,
                );
                setDurationMs(nextDuration);
                setInstructions(boundedInstructions);
                setActiveAction(null);
                setManualActionTime((current) =>
                  current
                    ? {
                        ...current,
                        atMs: normalizeInstructionTimeMs(
                          current.atMs,
                          nextDuration,
                        ),
                      }
                    : null,
                );
                invalidateCompilation(
                  "장면 길이를 변경했습니다. 범위를 벗어난 지시는 제거했습니다.",
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
              disabled={isPlaying}
              onChange={(event) => {
                const nextOwner = event.target.value as ParticipantId;
                if (!nextOwner) {
                  setInitialBallPosition({ ...ballPosition });
                  setBallOwnerId("");
                  invalidateCompilation("현재 위치에서 루즈볼로 시작합니다.");
                  return;
                }
                setBallOwnerId(nextOwner);
                setInitialBallPosition(null);
                invalidateCompilation("초기 공 소유 선수를 변경했습니다.");
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
            선수와 공을 드래그하면 시작 위치가 바뀝니다. 공을 선수 위에 놓으면
            해당 선수가 소유하고, 빈 공간에 놓으면 루즈볼로 시작합니다. 우리 팀
            선수를 선택하고 오른쪽 지시 패널에서 액션을 고른 뒤 경기장 위치나
            대상 선수를 지정하세요. 상대 팀은 자동으로 반응합니다.
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

            <svg
              className="sim-route-layer"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
              focusable="false"
              style={{ pointerEvents: "none" }}
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
                  />
                ) : null,
              )}
              {plannedMovementPaths.map(
                ({ instruction, points, cancellationReason }) => (
                  <polyline
                    key={`manual:${instruction.id}`}
                    className={`sim-route sim-route-manual sim-route-home sim-route-${instruction.type}${cancellationReason ? " sim-route-cancelled" : ""}`}
                    points={polylinePoints(points)}
                    fill="none"
                    vectorEffect="non-scaling-stroke"
                  />
                ),
              )}
              {plannedPassPaths.map(
                ({ instruction, points, cancellationReason }) => (
                  <polyline
                    key={`pass:${instruction.id}`}
                    className={`sim-route sim-route-pass ${run ? "sim-route-pass-result" : "sim-route-pass-plan"}${cancellationReason ? " sim-route-cancelled" : ""}`}
                    points={polylinePoints(points)}
                    fill="none"
                    vectorEffect="non-scaling-stroke"
                  />
                ),
              )}
            </svg>

            {plannedMovementPaths.flatMap(
              ({ instruction, cancellationReason }) =>
                instruction.waypoints.map((waypoint, index) => (
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
                )),
            )}

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
                            ? `우리 팀 ${participant.player.name}, ${participant.player.number}번, ${participant.role}. 드래그 또는 방향키로 시작 위치 이동. 선택 후 지시 패널에서 액션 지정`
                            : `상대 팀 ${participant.player.name}, ${participant.player.number}번, ${participant.role}. 드래그 또는 방향키로 시작 위치 이동. 자동 반응 선수 정보 보기`
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
                !frame
                  ? initialBallPosition
                    ? "초기 루즈볼. 드래그 또는 방향키로 시작 위치 이동"
                    : `${participantsById.get(effectiveBallOwnerId)?.player.name ?? "선수"}가 초기 공 소유. 드래그 또는 방향키로 시작 위치 이동`
                  : frame.ball.kind === "controlled" && frame.ball.ownerId
                  ? `${participantsById.get(frame.ball.ownerId)?.player.name ?? "선수"}가 공 소유. 드래그 또는 방향키로 시작 위치 이동`
                  : frame.ball.kind === "inFlight"
                    ? "패스 중인 공. 드래그 또는 방향키로 초기 위치 이동"
                    : "루즈볼. 드래그 또는 방향키로 초기 위치 이동"
              }
              aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
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
                const ownerId =
                  frame?.ball.kind === "controlled"
                    ? (frame.ball.ownerId as ParticipantId | undefined)
                    : initialBallPosition
                      ? undefined
                      : effectiveBallOwnerId;
                if (ownerId && participantsById.has(ownerId)) {
                  setSelectedParticipantId(ownerId);
                  setStatusMessage(
                    `${participantsById.get(ownerId)?.player.name ?? "공 소유 선수"}를 선택했습니다.`,
                  );
                } else {
                  setStatusMessage("공을 선택했습니다. 드래그하거나 방향키로 이동하세요.");
                }
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
            {compileError ?? lineupState.error ?? statusMessage}
          </p>
        </div>

        <aside className="sim-inspector" aria-labelledby="sim-inspector-title">
          <h3 id="sim-inspector-title">선수·장면 분석</h3>

          <section
            className="sim-instruction-editor"
            aria-labelledby="sim-instruction-editor-title"
          >
            <header>
              <div>
                <p className="sim-instruction-kicker">Home team only</p>
                <h4 id="sim-instruction-editor-title">선수 지시</h4>
              </div>
              {selectedParticipant ? (
                <button
                  type="button"
                  disabled={isPlaying}
                  onClick={() => {
                    setSelectedParticipantId(null);
                    setActiveAction(null);
                    setStatusMessage("선수 선택을 해제했습니다.");
                  }}
                >
                  선택 해제
                </button>
              ) : null}
            </header>

            {selectedParticipant ? (
              selectedParticipant.teamSide === "home" ? (
                <>
                  <p className="sim-instruction-actor">
                    <strong>{selectedParticipant.player.name}</strong>
                    <span>
                      {selectedParticipant.role} ·{" "}
                      {actionTimeRequiresInput
                        ? "실행 시각 직접 입력 필요"
                        : `${seconds(nextActionAtMs)} 다음 지시`}
                    </span>
                  </p>
                  <fieldset
                    className="sim-action-picker"
                    disabled={isPlaying || Boolean(activeAction)}
                  >
                    <legend>적용할 액션</legend>
                    <div>
                      {(["move", "carry", "pass"] as const).map((type) => (
                        <button
                          type="button"
                          key={type}
                          aria-pressed={activeAction?.type === type}
                          onClick={(event) =>
                            beginAction(type, undefined, event.detail === 0)
                          }
                          onKeyDown={(event) =>
                            handleBeginActionKeyDown(event, type)
                          }
                        >
                          {type === "move"
                            ? "이동"
                            : type === "carry"
                              ? "볼 운반"
                              : "패스"}
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  <label
                    className="sim-instruction-time"
                    htmlFor="sim-action-time"
                  >
                    <span>실행 시각 (초)</span>
                    <input
                      id="sim-action-time"
                      type="number"
                      min={0}
                      max={(durationMs - SIMULATION_TICK_MS) / 1_000}
                      step={SIMULATION_TICK_MS / 1_000}
                      value={(activeAction?.atMs ?? nextActionAtMs) / 1_000}
                      disabled={isPlaying}
                      aria-describedby="sim-action-time-help"
                      onChange={(event) => {
                        const nextAtMs = normalizeInstructionTimeMs(
                          Number(event.target.value) * 1_000,
                          durationMs,
                        );
                        if (activeAction) {
                          setActiveAction((current) =>
                            current ? { ...current, atMs: nextAtMs } : current,
                          );
                        } else if (effectiveSelectedParticipantId) {
                          setManualActionTime({
                            playerId: effectiveSelectedParticipantId,
                            atMs: nextAtMs,
                          });
                        }
                      }}
                    />
                  </label>
                  <small id="sim-action-time-help" className="sim-form-help">
                    {actionTimeRequiresInput
                      ? "장면 안에 충돌 없는 자동 시각이 없습니다. 원하는 시각을 직접 입력하면 액션을 계속할 수 있습니다."
                      : "선수별 첫 지시는 0초, 다음 지시는 기존 액션과 이동 도착 이후의 안전한 시각을 제안합니다. 0.05초 단위로 수정할 수 있습니다."}
                  </small>

                  {activeAction ? (
                    <div
                      className="sim-action-draft"
                      data-action={activeAction.type}
                    >
                      <strong>
                        현재 액션 ·{" "}
                        {activeAction.type === "move"
                          ? "이동"
                          : activeAction.type === "carry"
                            ? "볼 운반"
                            : "패스"}
                      </strong>
                      <p>
                        {activeAction.type === "pass"
                          ? "Tab으로 우리 팀 선수에 이동한 뒤 Enter를 눌러 패스 대상을 지정하세요."
                          : `경기장 클릭 또는 목표 커서로 지점을 추가하세요. 현재 ${activeAction.waypoints.length}개 지점. 키보드는 Command 또는 Control+Enter로 완료합니다.`}
                      </p>
                      <div>
                        {activeAction.type !== "pass" ? (
                          <>
                            <button
                              type="button"
                              onClick={completeMovementAction}
                            >
                              경로 완료
                            </button>
                            <button
                              type="button"
                              disabled={activeAction.waypoints.length === 0}
                              onClick={removeLastDraftWaypoint}
                            >
                              마지막 지점 취소
                            </button>
                          </>
                        ) : null}
                        <button type="button" onClick={cancelActiveAction}>
                          액션 취소
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="sim-action-idle">
                      액션을 선택하면 경기장과 대상 선수 토큰이 입력 단계에 맞게
                      강조됩니다.
                    </p>
                  )}
                </>
              ) : (
                <div className="sim-opponent-notice">
                  <strong>{selectedParticipant.player.name}</strong>
                  <p>
                    상대 팀 선수는 직접 지시하지 않습니다. 우리 팀 지시에 맞춰
                    압박·커버·패스 차단 위치를 자동으로 만듭니다.
                  </p>
                </div>
              )
            ) : (
              <p className="sim-action-empty">
                경기장에서 우리 팀 선수를 선택하면 이동·볼 운반·패스 액션이
                표시됩니다.
              </p>
            )}
          </section>

          <section
            className="sim-instruction-queue"
            aria-labelledby="sim-instruction-queue-title"
          >
            <header>
              <div>
                <h4 id="sim-instruction-queue-title">장면 지시</h4>
                <p>실행 시각순 · 같은 시각은 지정 순서</p>
              </div>
              <span>{sortedInstructions.length}개</span>
            </header>
            {sortedInstructions.some(
              (instruction) => instruction.type === "pass",
            ) ? (
              <p className="sim-pass-path-note">
                파란 점선은 결정론적 미리보기에서 계산한 실제 실행 시각의 패스
                출발·대상 위치를 표시합니다.
              </p>
            ) : null}
            <ol aria-label="등록한 선수 지시">
              {sortedInstructions.map((instruction, index) => {
                const actor = participantsById.get(instruction.playerId);
                const target =
                  instruction.type === "pass"
                    ? participantsById.get(instruction.targetPlayerId)
                    : null;
                const actionLabel =
                  instruction.type === "move"
                    ? "이동"
                    : instruction.type === "carry"
                      ? "볼 운반"
                      : "패스";
                const sameTickInstructions = sortedInstructions.filter(
                  (candidate) => candidate.atMs === instruction.atMs,
                );
                const sameTickIndex = sameTickInstructions.findIndex(
                  (candidate) => candidate.id === instruction.id,
                );
                const cancellationReason = instructionCancellationById.get(
                  instruction.id,
                );
                return (
                  <li
                    key={instruction.id}
                    className={
                      cancellationReason
                        ? "sim-instruction-cancelled"
                        : undefined
                    }
                  >
                    <div className="sim-instruction-order" aria-hidden="true">
                      {index + 1}
                    </div>
                    <div className="sim-instruction-summary">
                      <strong>{actionLabel}</strong>
                      <span>
                        {actor?.player.name ?? instruction.playerId}
                        {instruction.type === "pass"
                          ? ` → ${target?.player.name ?? instruction.targetPlayerId}`
                          : ` · ${instruction.waypoints.length}개 지점`}
                      </span>
                      {cancellationReason ? (
                        <span className="sim-instruction-warning">
                          미리보기 취소 ·{" "}
                          {instructionCancellationLabel(cancellationReason)}
                        </span>
                      ) : null}
                    </div>
                    <label htmlFor={`sim-instruction-time-${instruction.id}`}>
                      <span className="sr-only">
                        {index + 1}번 {actionLabel} 실행 시각 (초)
                      </span>
                      <input
                        id={`sim-instruction-time-${instruction.id}`}
                        type="number"
                        min={0}
                        max={(durationMs - SIMULATION_TICK_MS) / 1_000}
                        step={SIMULATION_TICK_MS / 1_000}
                        value={instruction.atMs / 1_000}
                        disabled={isPlaying || Boolean(activeAction)}
                        aria-label={`${index + 1}번 ${actionLabel} 실행 시각 (초)`}
                        onChange={(event) =>
                          updateInstructionTime(
                            instruction.id,
                            Number(event.target.value) * 1_000,
                          )
                        }
                      />
                    </label>
                    <div className="sim-instruction-actions">
                      <button
                        type="button"
                        disabled={
                          isPlaying || Boolean(activeAction) || sameTickIndex <= 0
                        }
                        onClick={() => reorderInstruction(instruction.id, -1)}
                        aria-label={`${index + 1}번 ${actionLabel} 지시를 같은 시각 안에서 앞으로 이동`}
                      >
                        순서 앞으로
                      </button>
                      <button
                        type="button"
                        disabled={
                          isPlaying ||
                          Boolean(activeAction) ||
                          sameTickIndex < 0 ||
                          sameTickIndex >= sameTickInstructions.length - 1
                        }
                        onClick={() => reorderInstruction(instruction.id, 1)}
                        aria-label={`${index + 1}번 ${actionLabel} 지시를 같은 시각 안에서 뒤로 이동`}
                      >
                        순서 뒤로
                      </button>
                      <button
                        type="button"
                        disabled={isPlaying || Boolean(activeAction)}
                        onClick={(event) =>
                          beginAction(
                            instruction.type,
                            instruction,
                            event.detail === 0,
                          )
                        }
                        onKeyDown={(event) =>
                          handleBeginActionKeyDown(
                            event,
                            instruction.type,
                            instruction,
                          )
                        }
                      >
                        {instruction.type === "pass" ? "대상 변경" : "경로 편집"}
                      </button>
                      <button
                        type="button"
                        disabled={isPlaying || Boolean(activeAction)}
                        onClick={() => removeInstruction(instruction.id)}
                        aria-label={`${index + 1}번 ${actionLabel} 지시 삭제`}
                      >
                        삭제
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
            {sortedInstructions.length === 0 ? (
              <p className="sim-instruction-empty">
                등록한 지시가 없습니다. 우리 팀 선수를 선택해 시작하세요.
              </p>
            ) : null}
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
                  disabled={isPlaying || selectedRoute.length === 0}
                  onClick={clearSelectedRoute}
                >
                  선택 선수 경로 삭제
                </button>
              ) : null}

              {placementOverrides[selectedParticipant.participantId] ? (
                <button
                  type="button"
                  disabled={isPlaying}
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

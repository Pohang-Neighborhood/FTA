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
  positionForFormationRole,
  selectDefaultLineup,
} from "../lib/player-catalog.js";
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
type ManualRouteMap = Record<string, PitchPoint[]>;

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

type PassInstruction = {
  id: string;
  fromPlayerId: ParticipantId;
  toPlayerId: ParticipantId;
  atMs: number;
};

type SimulationEvent = {
  type: string;
  atMs: number;
  passId?: string;
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

function normalizedPassTime(value: number, durationMs: number) {
  const finiteValue = Number.isFinite(value) ? value : 1_000;
  return Math.min(
    durationMs - SIMULATION_TICK_MS,
    Math.max(
      0,
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
    case "ball_recovered":
      return `${seconds(event.atMs)} ${playerName(event.playerId)} 루즈볼 회수`;
    default:
      return `${seconds(event.atMs)} ${event.type}`;
  }
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
  const [selectedParticipantId, setSelectedParticipantId] =
    useState<ParticipantId | null>(null);
  const [placementOverrides, setPlacementOverrides] =
    useState<PlacementOverrideMap>({});
  const [draggingParticipantId, setDraggingParticipantId] =
    useState<ParticipantId | null>(null);
  const [manualRoutes, setManualRoutes] = useState<ManualRouteMap>({});
  const [ballOwnerId, setBallOwnerId] = useState<ParticipantId | "">("");
  const [initialBallPosition, setInitialBallPosition] =
    useState<PitchPoint | null>(null);
  const [isDraggingBall, setIsDraggingBall] = useState(false);
  const [passFromId, setPassFromId] = useState<ParticipantId | "">("");
  const [passTargetId, setPassTargetId] = useState<ParticipantId | "">("");
  const [passAtMs, setPassAtMs] = useState(1_000);
  const [passes, setPasses] = useState<PassInstruction[]>([]);
  const [durationMs, setDurationMs] = useState(DEFAULT_DURATION_MS);
  const [run, setRun] = useState<SimulationRun | null>(null);
  const [cursorMs, setCursorMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState(
    "우리 팀 선수를 선택하고 경기장을 눌러 이동 경로를 지정하세요.",
  );

  const pitchRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const ballDragRef = useRef<BallDragState | null>(null);
  const suppressClickRef = useRef<ParticipantId | null>(null);
  const suppressBallClickRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);
  const cursorRef = useRef(0);

  const catalog = useMemo(
    () => teams.flatMap((team) => team.players),
    [teams],
  );
  const homeTeam = teams.find((team) => team.id === homeTeamId);
  const awayTeam = teams.find((team) => team.id === awayTeamId);
  const homeFormation = formationById(homeFormationId);
  const awayFormation = formationById(awayFormationId, 1);

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
  const defaultTarget =
    homeParticipants.find(
      (participant) =>
        participant.participantId !== defaultOwner?.participantId &&
        participant.role !== "GK",
    ) ?? homeParticipants[0];
  const effectiveSelectedParticipantId =
    selectedParticipantId && participantsById.has(selectedParticipantId)
      ? selectedParticipantId
      : defaultOwner?.participantId ?? null;
  const effectiveBallOwnerId =
    ballOwnerId && participantsById.has(ballOwnerId)
      ? ballOwnerId
      : defaultOwner?.participantId ?? "";
  const effectivePassFromId =
    passFromId && participantsById.has(passFromId)
      ? passFromId
      : defaultOwner?.participantId ?? "";
  const effectivePassTargetId =
    passTargetId && participantsById.has(passTargetId)
      ? passTargetId
      : defaultTarget?.participantId ?? "";
  const selectedParticipant = effectiveSelectedParticipantId
    ? participantsById.get(effectiveSelectedParticipantId)
    : undefined;

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

  const automaticPaths = useMemo(() => {
    if (!run) {
      return [] as Array<{ participantId: string; points: PitchPoint[] }>;
    }
    return participants
      .filter(
        (participant) =>
          (manualRoutes[participant.participantId]?.length ?? 0) === 0,
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
  }, [manualRoutes, participants, placements, run]);

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

  function handleSetupChange(
    side: TeamSide,
    field: "team" | "formation",
    value: string,
  ) {
    if (isPlaying) {
      return;
    }
    if (side === "home" && field === "team") {
      setHomeTeamId(value);
    } else if (side === "away" && field === "team") {
      setAwayTeamId(value);
    } else if (side === "home") {
      setHomeFormationId(value);
    } else {
      setAwayFormationId(value);
    }
    setSelectedParticipantId(null);
    setBallOwnerId("");
    setInitialBallPosition(null);
    setPassFromId("");
    setPassTargetId("");
    setPlacementOverrides({});
    setManualRoutes({});
    setPasses([]);
    invalidateCompilation("라인업 변경을 반영했습니다. 기존 지시는 초기화됩니다.");
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
        if (nextOwner?.teamSide === "home") {
          setPassFromId(nextOwnerId);
        }
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
    if (!direction || isPlaying) {
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
    const direction = {
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
    }[event.key];

    if (!direction || isPlaying) {
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
    if (
      !effectiveSelectedParticipantId ||
      !effectiveSelectedParticipantId.startsWith("home:")
    ) {
      setStatusMessage("우리 팀 선수를 먼저 선택하세요.");
      return;
    }
    if ((event.target as HTMLElement).closest("[data-sim-token]")) {
      return;
    }
    const position = toPitchPosition(
      event.clientX,
      event.clientY,
      event.currentTarget.getBoundingClientRect(),
    ) as PitchPoint;
    setManualRoutes((current) => ({
      ...current,
      [effectiveSelectedParticipantId]: [
        ...(current[effectiveSelectedParticipantId] ?? []),
        position,
      ],
    }));
    invalidateCompilation(
      `${selectedParticipant?.player.name ?? "선수"} 경로에 지점을 추가했습니다.`,
    );
  }

  function clearSelectedRoute() {
    if (!effectiveSelectedParticipantId || isPlaying) {
      return;
    }
    setManualRoutes((current) => {
      const next = { ...current };
      delete next[effectiveSelectedParticipantId];
      return next;
    });
    invalidateCompilation("선택한 선수의 수동 경로를 삭제했습니다.");
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

  function addPassInstruction() {
    if (
      isPlaying ||
      !effectivePassFromId ||
      !effectivePassTargetId ||
      effectivePassFromId === effectivePassTargetId
    ) {
      setStatusMessage("서로 다른 우리 팀 패스 출발·도착 선수를 선택하세요.");
      return;
    }
    const atMs = normalizedPassTime(passAtMs, durationMs);
    setPasses((current) => [
      ...current,
      {
        id: `pass-${current.length + 1}`,
        fromPlayerId: effectivePassFromId,
        toPlayerId: effectivePassTargetId,
        atMs,
      },
    ]);
    invalidateCompilation(`${seconds(atMs)} 패스 지시를 추가했습니다.`);
  }

  function removePassInstruction(passId: string) {
    if (isPlaying) {
      return;
    }
    setPasses((current) =>
      current
        .filter((instruction) => instruction.id !== passId)
        .map((instruction, index) => ({
          ...instruction,
          id: `pass-${index + 1}`,
        })),
    );
    invalidateCompilation("패스 지시를 삭제했습니다.");
  }

  function clearAllInstructions() {
    if (isPlaying) {
      return;
    }
    const defaultOwner =
      homeParticipants.find((participant) => participant.role.includes("ST")) ??
      homeParticipants[0];
    const defaultTarget =
      homeParticipants.find(
        (participant) =>
          participant.participantId !== defaultOwner?.participantId,
      ) ?? homeParticipants[0];
    setManualRoutes({});
    setPlacementOverrides({});
    setPasses([]);
    setBallOwnerId(defaultOwner?.participantId ?? "");
    setInitialBallPosition(null);
    setPassFromId(defaultOwner?.participantId ?? "");
    setPassTargetId(defaultTarget?.participantId ?? "");
    setPassAtMs(1_000);
    invalidateCompilation("모든 초기 배치·이동·패스 지시를 초기화했습니다.");
  }

  function buildRun() {
    if (
      participants.length !== 22 ||
      (!initialBallPosition && !effectiveBallOwnerId) ||
      lineupState.error
    ) {
      throw new Error(
        lineupState.error ?? "양 팀 선발 11명과 초기 공 위치가 필요합니다.",
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
        : { initialBallOwnerId: effectiveBallOwnerId }),
      manualRoutes: Object.entries(manualRoutes).flatMap(
        ([participantId, waypoints]) =>
          waypoints.length > 0
            ? [
                {
                  playerId: participantId,
                  startAtMs: 0,
                  waypoints: waypoints.map((waypoint) => ({ ...waypoint })),
                },
              ]
            : [],
      ),
      passes: passes.map((instruction, index) => ({
        ...instruction,
        id: `pass-${index + 1}`,
      })),
    };
    return compileSimulation(scenario) as SimulationRun;
  }

  function play() {
    if (isPlaying) {
      setIsPlaying(false);
      setStatusMessage("시뮬레이션을 일시정지했습니다.");
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
    ? manualRoutes[effectiveSelectedParticipantId] ?? []
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

  return (
    <section className="sim-workspace" aria-labelledby="sim-title">
      <header className="sim-header">
        <div>
          <p className="sim-eyebrow">Scenario movement simulator</p>
          <h1 id="sim-title">선수 움직임·패스 시뮬레이션</h1>
          <p>
            우리 팀의 경로와 패스를 지시하면 나머지 선수들이 능력치에 따라
            결정론적으로 반응합니다.
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

          <fieldset className="sim-team-setup" disabled={isPlaying}>
            <legend>우리 팀</legend>
            <label htmlFor="sim-home-team">국가</label>
            <select
              id="sim-home-team"
              value={homeTeamId}
              onChange={(event) =>
                handleSetupChange("home", "team", event.target.value)
              }
            >
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name} · Group {team.group}
                </option>
              ))}
            </select>
            <label htmlFor="sim-home-formation">포메이션</label>
            <select
              id="sim-home-formation"
              value={homeFormationId}
              onChange={(event) =>
                handleSetupChange("home", "formation", event.target.value)
              }
            >
              {formations.map((formation) => (
                <option key={formation.id} value={formation.id}>
                  {formation.label} · {formation.name}
                </option>
              ))}
            </select>
          </fieldset>

          <fieldset className="sim-team-setup" disabled={isPlaying}>
            <legend>상대 팀</legend>
            <label htmlFor="sim-away-team">국가</label>
            <select
              id="sim-away-team"
              value={awayTeamId}
              onChange={(event) =>
                handleSetupChange("away", "team", event.target.value)
              }
            >
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name} · Group {team.group}
                </option>
              ))}
            </select>
            <label htmlFor="sim-away-formation">포메이션</label>
            <select
              id="sim-away-formation"
              value={awayFormationId}
              onChange={(event) =>
                handleSetupChange("away", "formation", event.target.value)
              }
            >
              {formations.map((formation) => (
                <option key={formation.id} value={formation.id}>
                  {formation.label} · {formation.name}
                </option>
              ))}
            </select>
          </fieldset>

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
                setDurationMs(nextDuration);
                setPasses((current) =>
                  current.filter((instruction) => instruction.atMs < nextDuration),
                );
                setPassAtMs((current) =>
                  normalizedPassTime(current, nextDuration),
                );
                invalidateCompilation("장면 길이를 변경했습니다.");
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
                if (nextOwner.startsWith("home:")) {
                  setPassFromId(nextOwner);
                }
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

          <fieldset className="sim-pass-editor" disabled={isPlaying}>
            <legend>패스 지시</legend>
            <label htmlFor="sim-pass-from">출발 선수</label>
            <select
              id="sim-pass-from"
              value={effectivePassFromId}
              onChange={(event) =>
                setPassFromId(event.target.value as ParticipantId)
              }
            >
              {homeParticipants.map((participant) => (
                <option
                  key={participant.participantId}
                  value={participant.participantId}
                >
                  {participant.player.name} · {participant.role}
                </option>
              ))}
            </select>
            <label htmlFor="sim-pass-target">도착 선수</label>
            <select
              id="sim-pass-target"
              value={effectivePassTargetId}
              onChange={(event) =>
                setPassTargetId(event.target.value as ParticipantId)
              }
            >
              {homeParticipants.map((participant) => (
                <option
                  key={participant.participantId}
                  value={participant.participantId}
                >
                  {participant.player.name} · {participant.role}
                </option>
              ))}
            </select>
            <label htmlFor="sim-pass-time">실행 시각 (ms)</label>
            <input
              id="sim-pass-time"
              type="number"
              min={0}
              max={durationMs - SIMULATION_TICK_MS}
              step={SIMULATION_TICK_MS}
              value={passAtMs}
              onChange={(event) =>
                setPassAtMs(
                  normalizedPassTime(Number(event.target.value), durationMs),
                )
              }
            />
            <button type="button" onClick={addPassInstruction}>
              패스 지시 추가
            </button>
          </fieldset>

          <ol className="sim-pass-list" aria-label="등록한 패스 지시">
            {passes.map((instruction) => (
              <li key={instruction.id}>
                <span>
                  {seconds(instruction.atMs)} ·{" "}
                  {participantsById.get(instruction.fromPlayerId)?.player.name} →{" "}
                  {participantsById.get(instruction.toPlayerId)?.player.name}
                </span>
                <button
                  type="button"
                  disabled={isPlaying}
                  onClick={() => removePassInstruction(instruction.id)}
                  aria-label={`${seconds(instruction.atMs)} 패스 지시 삭제`}
                >
                  삭제
                </button>
              </li>
            ))}
          </ol>
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
            선수를 선택한 뒤 경기장의 빈 지점을 누르면 이후 수동 경로가 순서대로
            추가됩니다.
          </p>
          <div
            ref={pitchRef}
            className={`sim-pitch${isPlaying ? " sim-pitch-locked" : ""}`}
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
              {Object.entries(manualRoutes).map(([participantId, waypoints]) => {
                const placement = placements[participantId];
                if (!placement || waypoints.length === 0) {
                  return null;
                }
                return (
                  <polyline
                    key={`manual:${participantId}`}
                    className="sim-route sim-route-manual sim-route-home"
                    points={polylinePoints([placement, ...waypoints])}
                    fill="none"
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </svg>

            {participants.map((participant) => {
              const placement = placements[participant.participantId];
              const playerFrame = frame?.players[participant.participantId];
              const position = playerFrame?.position ?? placement;
              const isSelected =
                participant.participantId === effectiveSelectedParticipantId;
              const isManual =
                (manualRoutes[participant.participantId]?.length ?? 0) > 0;
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
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={tokenStyle}
                  aria-pressed={isSelected}
                  aria-label={
                    participant.teamSide === "home"
                      ? `우리 팀 ${participant.player.name}, ${participant.player.number}번, ${participant.role}. 드래그 또는 방향키로 시작 위치 이동. 선택 후 경기장을 눌러 경로 지정`
                      : `상대 팀 ${participant.player.name}, ${participant.player.number}번, ${participant.role}. 드래그 또는 방향키로 시작 위치 이동. 자동 반응 선수 정보 보기`
                  }
                  aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (
                      suppressClickRef.current === participant.participantId
                    ) {
                      suppressClickRef.current = null;
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
                  <span className="sim-player-name">{participant.player.name}</span>
                </button>
              );
            })}

            <button
              type="button"
              data-sim-ball
              className={`sim-ball-token${isDraggingBall ? " sim-ball-dragging" : ""}`}
              disabled={isPlaying}
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
              <h4 id="sim-event-title">패스 이벤트</h4>
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
                  <li key={`${event.type}:${event.atMs}:${event.passId ?? event.playerId ?? index}`}>
                    {eventDescription(event, participantsById)}
                  </li>
                ))}
              </ol>
            ) : (
              <p>재생된 패스 이벤트가 없습니다.</p>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}

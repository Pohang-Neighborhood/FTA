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
  analyzeShape,
  clamp,
  clampPitchPosition,
  createPlacements,
  substitutePlayer,
  toPitchPosition,
  toPitchPositionWithOffset,
} from "../lib/tactics-core.js";
import {
  defensiveLines,
  formations,
  initialLineupIds,
  mentalities,
  mockPlayers,
  pressingLevels,
  widths,
  type Formation,
  type Player,
  type TacticalOption,
} from "./tactics-data";

type Placement = {
  role: string;
  x: number;
  y: number;
};

type PlacementMap = Record<string, Placement>;

type BoardSnapshot = {
  formationId: string;
  activePlayerIds: string[];
  placements: PlacementMap;
  selectedPlayerId: string | null;
};

type DragState = {
  playerId: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  grabOffsetX: number;
  grabOffsetY: number;
  moved: boolean;
  snapshot: BoardSnapshot;
};

type ChoiceGroupProps = {
  id: string;
  label: string;
  options: TacticalOption[];
  value: string;
  onChange: (value: string) => void;
};

const defaultFormation = formations[0];

function clonePlacements(placements: PlacementMap): PlacementMap {
  return Object.fromEntries(
    Object.entries(placements).map(([playerId, placement]) => [
      playerId,
      { ...placement },
    ]),
  );
}

function formationPlacements(
  playerIds: string[],
  formation: Formation,
): PlacementMap {
  return createPlacements(playerIds, formation.slots) as PlacementMap;
}

function findPlayer(playerId: string | null): Player | undefined {
  return mockPlayers.find((player) => player.id === playerId);
}

function ChoiceGroup({ id, label, options, value, onChange }: ChoiceGroupProps) {
  const activeOption = options.find((option) => option.id === value) ?? options[0];
  const descriptionId = `${id}-description`;

  return (
    <fieldset className="choice-group" aria-describedby={descriptionId}>
      <legend>{label}</legend>
      <div className="segmented-control">
        {options.map((option) => (
          <button
            type="button"
            key={option.id}
            aria-pressed={value === option.id}
            title={option.description}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p id={descriptionId} className="choice-description">
        {activeOption.description}
      </p>
    </fieldset>
  );
}

function PlayerStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="player-stat">
      <div className="player-stat-label">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="player-stat-track" aria-hidden="true">
        <span style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export function TacticsBoard() {
  const [formationId, setFormationId] = useState(defaultFormation.id);
  const [activePlayerIds, setActivePlayerIds] = useState([...initialLineupIds]);
  const [placements, setPlacements] = useState<PlacementMap>(() =>
    formationPlacements(initialLineupIds, defaultFormation),
  );
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>("p10");
  const [draggingPlayerId, setDraggingPlayerId] = useState<string | null>(null);
  const [history, setHistory] = useState<BoardSnapshot[]>([]);
  const [mentality, setMentality] = useState("balanced");
  const [width, setWidth] = useState("balanced");
  const [defensiveLine, setDefensiveLine] = useState("standard");
  const [pressing, setPressing] = useState("mid");
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState(
    "선수를 드래그하거나 선택한 뒤 경기장을 눌러 위치를 바꿔보세요.",
  );

  const pitchRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef<string | null>(null);
  const summaryDialogRef = useRef<HTMLDialogElement>(null);
  const summaryTriggerRef = useRef<HTMLButtonElement>(null);

  const formation =
    formations.find((candidate) => candidate.id === formationId) ?? defaultFormation;
  const activePlayers = activePlayerIds
    .map((playerId) => findPlayer(playerId))
    .filter((player): player is Player => Boolean(player));
  const benchPlayers = mockPlayers.filter(
    (player) => !activePlayerIds.includes(player.id),
  );
  const selectedPlayer = findPlayer(selectedPlayerId);
  const shape = useMemo(() => analyzeShape(placements), [placements]);

  const activeMentality =
    mentalities.find((option) => option.id === mentality) ?? mentalities[1];
  const activeWidth = widths.find((option) => option.id === width) ?? widths[1];
  const activeLine =
    defensiveLines.find((option) => option.id === defensiveLine) ?? defensiveLines[1];
  const activePressing =
    pressingLevels.find((option) => option.id === pressing) ?? pressingLevels[1];

  const pitchStyle = {
    "--defensive-line-y":
      defensiveLine === "deep" ? "70%" : defensiveLine === "high" ? "51%" : "61%",
    "--press-depth": pressing === "low" ? "18%" : pressing === "high" ? "46%" : "31%",
    "--attack-width": width === "narrow" ? "48%" : width === "wide" ? "88%" : "70%",
  } as CSSProperties;

  useEffect(() => {
    const dialog = summaryDialogRef.current;
    if (!dialog) {
      return;
    }

    if (summaryOpen && !dialog.open) {
      dialog.showModal();
    } else if (!summaryOpen && dialog.open) {
      dialog.close();
    }
  }, [summaryOpen]);

  function captureSnapshot(): BoardSnapshot {
    return {
      formationId,
      activePlayerIds: [...activePlayerIds],
      placements: clonePlacements(placements),
      selectedPlayerId,
    };
  }

  function pushHistory(snapshot: BoardSnapshot) {
    setHistory((current) => [...current.slice(-9), snapshot]);
  }

  function restoreSnapshot(snapshot: BoardSnapshot) {
    setFormationId(snapshot.formationId);
    setActivePlayerIds([...snapshot.activePlayerIds]);
    setPlacements(clonePlacements(snapshot.placements));
    setSelectedPlayerId(snapshot.selectedPlayerId);
  }

  function undo() {
    const snapshot = history.at(-1);
    if (!snapshot) {
      return;
    }

    restoreSnapshot(snapshot);
    setHistory((current) => current.slice(0, -1));
    setStatusMessage("직전 선수 배치를 되돌렸습니다.");
  }

  function resetBoard() {
    pushHistory(captureSnapshot());
    setFormationId(defaultFormation.id);
    setActivePlayerIds([...initialLineupIds]);
    setPlacements(formationPlacements(initialLineupIds, defaultFormation));
    setSelectedPlayerId("p10");
    setStatusMessage("기본 4-3-3 배치로 초기화했습니다.");
  }

  function changeFormation(nextFormationId: string) {
    if (nextFormationId === formationId) {
      return;
    }

    const nextFormation = formations.find(
      (candidate) => candidate.id === nextFormationId,
    );
    if (!nextFormation) {
      return;
    }

    pushHistory(captureSnapshot());
    setFormationId(nextFormation.id);
    setPlacements(formationPlacements(activePlayerIds, nextFormation));
    setStatusMessage(`${nextFormation.label} 포메이션으로 재배치했습니다.`);
  }

  function clampToVisiblePitch(x: number, y: number) {
    const pitch = pitchRef.current;
    if (!pitch) {
      return clampPitchPosition(x, y);
    }

    const rect = pitch.getBoundingClientRect();
    const horizontalInset = Math.max(6, (34 / rect.width) * 100);
    const verticalInset = Math.max(6, (34 / rect.height) * 100);
    return {
      x: clamp(x, horizontalInset, 100 - horizontalInset),
      y: clamp(y, verticalInset, 100 - verticalInset),
    };
  }

  function updatePlayerPosition(
    playerId: string,
    clientX: number,
    clientY: number,
    grabOffsetX = 0,
    grabOffsetY = 0,
  ) {
    const pitch = pitchRef.current;
    if (!pitch) {
      return;
    }

    const rect = pitch.getBoundingClientRect();
    const pointerPosition = toPitchPositionWithOffset(
      clientX,
      clientY,
      rect,
      grabOffsetX,
      grabOffsetY,
    );
    const nextPosition = clampToVisiblePitch(pointerPosition.x, pointerPosition.y);
    setPlacements((current) => ({
      ...current,
      [playerId]: {
        ...current[playerId],
        ...nextPosition,
      },
    }));
  }

  function handlePlayerPointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    playerId: string,
  ) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    event.stopPropagation();
    const pitch = pitchRef.current;
    const placement = placements[playerId];
    if (!pitch || !placement) {
      return;
    }

    const pitchRect = pitch.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedPlayerId(playerId);
    setDraggingPlayerId(playerId);
    dragRef.current = {
      playerId,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      grabOffsetX: ((event.clientX - pitchRect.left) / pitchRect.width) * 100 - placement.x,
      grabOffsetY: ((event.clientY - pitchRect.top) / pitchRect.height) * 100 - placement.y,
      moved: false,
      snapshot: captureSnapshot(),
    };
  }

  function handlePlayerPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
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

    drag.moved = true;
    updatePlayerPosition(
      drag.playerId,
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

    if (cancelled) {
      restoreSnapshot(drag.snapshot);
      setStatusMessage("선수 이동을 취소했습니다.");
    } else if (drag.moved) {
      updatePlayerPosition(
        drag.playerId,
        event.clientX,
        event.clientY,
        drag.grabOffsetX,
        drag.grabOffsetY,
      );
      pushHistory(drag.snapshot);
      const player = findPlayer(drag.playerId);
      setStatusMessage(`${player?.name ?? "선수"}의 위치를 변경했습니다.`);
      suppressClickRef.current = drag.playerId;
      window.setTimeout(() => {
        if (suppressClickRef.current === drag.playerId) {
          suppressClickRef.current = null;
        }
      }, 0);
    }

    setDraggingPlayerId(null);
    dragRef.current = null;
  }

  function handlePitchClick(event: MouseEvent<HTMLDivElement>) {
    if (!selectedPlayerId || !activePlayerIds.includes(selectedPlayerId)) {
      return;
    }

    if ((event.target as HTMLElement).closest("[data-player-token]")) {
      return;
    }

    const rawPosition = toPitchPosition(
      event.clientX,
      event.clientY,
      event.currentTarget.getBoundingClientRect(),
    );
    const position = clampToVisiblePitch(rawPosition.x, rawPosition.y);
    pushHistory(captureSnapshot());
    setPlacements((current) => ({
      ...current,
      [selectedPlayerId]: {
        ...current[selectedPlayerId],
        ...position,
      },
    }));
    setStatusMessage(`${selectedPlayer?.name ?? "선수"}을 선택한 위치로 이동했습니다.`);
  }

  function handlePlayerKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    playerId: string,
  ) {
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
    const currentPlacement = placements[playerId];
    const distance = event.shiftKey ? 5 : 2;
    const nextPosition = clampToVisiblePitch(
      currentPlacement.x + direction.x * distance,
      currentPlacement.y + direction.y * distance,
    );
    pushHistory(captureSnapshot());
    setSelectedPlayerId(playerId);
    setPlacements((current) => ({
      ...current,
      [playerId]: {
        ...current[playerId],
        ...nextPosition,
      },
    }));
    const player = findPlayer(playerId);
    setStatusMessage(`${player?.name ?? "선수"}을 방향키로 이동했습니다.`);
  }

  function swapSelectedPlayer(incomingPlayerId: string) {
    if (!selectedPlayerId) {
      return;
    }

    const lineupIndex = activePlayerIds.indexOf(selectedPlayerId);
    const currentPlacement = placements[selectedPlayerId];
    if (lineupIndex < 0 || !currentPlacement) {
      return;
    }

    pushHistory(captureSnapshot());
    const substitution = substitutePlayer(
      activePlayerIds,
      placements,
      selectedPlayerId,
      incomingPlayerId,
    ) as { playerIds: string[]; placements: PlacementMap };
    const incomingPlayer = findPlayer(incomingPlayerId);
    const outgoingPlayer = findPlayer(selectedPlayerId);

    setActivePlayerIds(substitution.playerIds);
    setPlacements(substitution.placements);
    setSelectedPlayerId(incomingPlayerId);
    setStatusMessage(
      `${incomingPlayer?.name ?? "교체 선수"} 투입 · ${outgoingPlayer?.name ?? "선발 선수"} 교체`,
    );
  }

  const planSummary = `${formation.label} · ${activeWidth.label} · ${activePressing.label} 압박`;
  const planDescription = `${activeMentality.description} ${activeWidth.description} ${activeLine.description}`;

  return (
    <div className="site-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">FTA</span>
          <div>
            <p>Football Tactics Architect</p>
            <h1>Match Lab</h1>
          </div>
        </div>

        <div className="match-chip" aria-label="데모 경기 대한민국 대 브라질">
          <span>KOR</span>
          <strong>VS</strong>
          <span>BRA</span>
          <em>DEMO 01</em>
        </div>

        <div className="topbar-actions">
          <button
            type="button"
            className="quiet-button"
            onClick={undo}
            disabled={!history.length}
            aria-label="배치 되돌리기"
          >
            ↶ <span>배치 되돌리기</span>
          </button>
          <button
            type="button"
            className="quiet-button"
            onClick={resetBoard}
            aria-label="배치 초기화"
          >
            ↺ <span>배치 초기화</span>
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="panel setup-panel" aria-labelledby="setup-title">
          <div className="panel-heading">
            <span>01</span>
            <div>
              <p>Match setup</p>
              <h2 id="setup-title">경기 계획</h2>
            </div>
          </div>

          <section className="fixture-card" aria-label="경기 시나리오">
            <div>
              <small>HOME · MOCK</small>
              <strong>대한민국</strong>
              <span>빠른 전환 · 기술형</span>
            </div>
            <b>:</b>
            <div className="fixture-away">
              <small>AWAY · MOCK</small>
              <strong>브라질</strong>
              <span>개인 돌파 · 강한 압박</span>
            </div>
          </section>

          <label className="select-field" htmlFor="formation-select">
            <span>포메이션</span>
            <select
              id="formation-select"
              value={formationId}
              onChange={(event) => changeFormation(event.target.value)}
            >
              {formations.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label} · {option.name}
                </option>
              ))}
            </select>
            <small>{formation.description}</small>
          </label>

          <ChoiceGroup
            id="mentality"
            label="경기 성향"
            options={mentalities}
            value={mentality}
            onChange={setMentality}
          />
          <ChoiceGroup
            id="width"
            label="공격 폭"
            options={widths}
            value={width}
            onChange={setWidth}
          />
          <ChoiceGroup
            id="defensive-line"
            label="수비 라인"
            options={defensiveLines}
            value={defensiveLine}
            onChange={setDefensiveLine}
          />
          <ChoiceGroup
            id="pressing"
            label="압박 강도"
            options={pressingLevels}
            value={pressing}
            onChange={setPressing}
          />

          <div className="prototype-note">
            <span>Prototype data</span>
            <p>현재 선수 이름과 능력치는 모두 초안 검증을 위한 가상 데이터입니다.</p>
          </div>
        </aside>

        <section className="board-column" aria-labelledby="board-title">
          <div className="board-heading">
            <div>
              <p>
                Interactive tactics board
                <span className="mock-badge">Mock players</span>
              </p>
              <h2 id="board-title">{formation.label} · {formation.name}</h2>
            </div>
            <div className="board-hint">
              <span aria-hidden="true">↕</span>
              드래그 · 필드 탭 · 방향키
            </div>
          </div>

          <label className="mobile-formation-control" htmlFor="mobile-formation-select">
            <span>포메이션 빠른 변경</span>
            <select
              id="mobile-formation-select"
              value={formationId}
              onChange={(event) => changeFormation(event.target.value)}
            >
              {formations.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label} · {option.name}
                </option>
              ))}
            </select>
          </label>

          <div className="pitch-frame">
            <div className="direction-label opponent-direction">
              <span>상대 골대</span>
              <strong>ATTACK ↑</strong>
            </div>
            <div
              ref={pitchRef}
              className="pitch"
              data-testid="tactics-pitch"
              style={pitchStyle}
              onClick={handlePitchClick}
              aria-label="축구 전술 경기장. 선수를 드래그하거나 선택한 뒤 빈 공간을 누르세요."
            >
              <div className="pitch-stripes" aria-hidden="true" />
              <div className="pitch-boundary" aria-hidden="true" />
              <div className="center-line" aria-hidden="true" />
              <div className="center-circle" aria-hidden="true" />
              <div className="center-dot" aria-hidden="true" />
              <div className="penalty-box penalty-box-top" aria-hidden="true" />
              <div className="goal-box goal-box-top" aria-hidden="true" />
              <div className="penalty-box penalty-box-bottom" aria-hidden="true" />
              <div className="goal-box goal-box-bottom" aria-hidden="true" />
              <div className="pressing-zone" aria-hidden="true">
                <span>PRESS ZONE</span>
              </div>
              <div className="width-zone" aria-hidden="true" />
              <div className="defensive-line-guide" aria-hidden="true">
                <span>DEFENSIVE LINE</span>
              </div>

              {activePlayers.map((player) => {
                const placement = placements[player.id];
                if (!placement) {
                  return null;
                }

                const isSelected = player.id === selectedPlayerId;
                const isDragging = player.id === draggingPlayerId;
                return (
                  <button
                    type="button"
                    key={player.id}
                    data-player-token={player.id}
                    className={`player-token${isSelected ? " is-selected" : ""}${isDragging ? " is-dragging" : ""}`}
                    style={{ left: `${placement.x}%`, top: `${placement.y}%` }}
                    aria-label={`${player.name}, ${player.number}번, ${placement.role}. 방향키로 위치 이동`}
                    aria-pressed={isSelected}
                    aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (suppressClickRef.current === player.id) {
                        suppressClickRef.current = null;
                        return;
                      }
                      setSelectedPlayerId(player.id);
                      setStatusMessage(`${player.name} 선수를 선택했습니다.`);
                    }}
                    onKeyDown={(event) => handlePlayerKeyDown(event, player.id)}
                    onPointerDown={(event) => handlePlayerPointerDown(event, player.id)}
                    onPointerMove={handlePlayerPointerMove}
                    onPointerUp={(event) => finishPlayerDrag(event)}
                    onPointerCancel={(event) => finishPlayerDrag(event, true)}
                  >
                    <span className="player-disc">
                      <small>{placement.role}</small>
                      <strong>{player.number}</strong>
                    </span>
                    <span className="player-name">{player.name}</span>
                  </button>
                );
              })}
            </div>
            <div className="direction-label home-direction">
              <strong>↓ BUILD</strong>
              <span>우리 골대</span>
            </div>
          </div>

          <p className="sr-status" role="status" aria-live="polite">
            {statusMessage}
          </p>
        </section>

        <aside className="panel squad-panel" aria-labelledby="squad-title">
          <div className="panel-heading">
            <span>02</span>
            <div>
              <p>Squad room</p>
              <h2 id="squad-title">선수단</h2>
            </div>
          </div>

          {selectedPlayer ? (
            <section className="selected-player-card" aria-label="선택한 선수 정보">
              <div className="selected-player-header">
                <span className="selected-number">{selectedPlayer.number}</span>
                <div>
                  <small>SELECTED PLAYER</small>
                  <h3>{selectedPlayer.name}</h3>
                  <p>
                    {placements[selectedPlayer.id]?.role ?? selectedPlayer.primaryPosition}
                    <i>·</i>
                    {selectedPlayer.foot}
                  </p>
                </div>
              </div>
              <div className="player-stats">
                <PlayerStat label="속도" value={selectedPlayer.pace} />
                <PlayerStat label="패스" value={selectedPlayer.passing} />
                <PlayerStat label="수비" value={selectedPlayer.defending} />
              </div>
            </section>
          ) : null}

          <section className="bench-section" aria-labelledby="bench-title">
            <div className="section-title-row">
              <div>
                <small>SUBSTITUTES</small>
                <h3 id="bench-title">교체 명단</h3>
              </div>
              <span>{benchPlayers.length}명</span>
            </div>
            <p className="bench-help">필드 선수를 선택한 뒤 교체 선수를 누르세요.</p>
            <div className="bench-list">
              {benchPlayers.map((player) => (
                <button
                  type="button"
                  key={player.id}
                  onClick={() => swapSelectedPlayer(player.id)}
                  disabled={!selectedPlayerId}
                  aria-label={`${player.name}, ${player.number}번, ${player.primaryPosition} 투입`}
                >
                  <strong>{player.number}</strong>
                  <span>
                    {player.name}
                    <small>{player.primaryPosition} · {player.secondaryPosition}</small>
                  </span>
                  <em>투입</em>
                </button>
              ))}
            </div>
          </section>

          <section className="shape-card" aria-labelledby="shape-title">
            <div
              className="shape-score"
              style={{ "--score": `${shape.score * 3.6}deg` } as CSSProperties}
              aria-label={`전술 균형도 ${shape.score}점`}
            >
              <span>{shape.score}</span>
              <small>/ 100</small>
            </div>
            <div>
              <small>LIVE SHAPE</small>
              <h3 id="shape-title">전술 균형도</h3>
              <dl>
                <div><dt>폭</dt><dd>{shape.widthLabel} · {shape.width}</dd></div>
                <div><dt>라인</dt><dd>{shape.lineLabel} · {shape.averageLine}</dd></div>
              </dl>
            </div>
          </section>

          <section className="game-plan-card" aria-labelledby="plan-title">
            <small>GAME PLAN</small>
            <h3 id="plan-title">{planSummary}</h3>
            <p>{planDescription}</p>
            <button
              ref={summaryTriggerRef}
              type="button"
              className="primary-button"
              onClick={() => setSummaryOpen(true)}
            >
              전술 카드 완성 <span aria-hidden="true">→</span>
            </button>
          </section>
        </aside>
      </main>

      <dialog
          ref={summaryDialogRef}
          className="summary-modal"
          aria-labelledby="summary-title"
          onCancel={(event) => {
            event.preventDefault();
            setSummaryOpen(false);
          }}
          onClose={() => {
            setSummaryOpen(false);
            summaryTriggerRef.current?.focus();
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSummaryOpen(false);
            }
          }}
        >
          <section
            className="summary-dialog"
          >
            <button
              type="button"
              className="dialog-close"
              onClick={() => setSummaryOpen(false)}
              aria-label="전술 카드 닫기"
            >
              ×
            </button>
            <div className="summary-kicker">
              <span>FTA / MATCH PLAN 01</span>
              <em>PROTOTYPE</em>
            </div>
            <p className="summary-eyebrow">KOREA REPUBLIC · VS BRAZIL</p>
            <h2 id="summary-title">{planSummary}</h2>
            <p className="summary-lead">{planDescription}</p>
            <div className="summary-grid">
              <div><small>MENTALITY</small><strong>{activeMentality.label}</strong></div>
              <div><small>PRESSING</small><strong>{activePressing.label}</strong></div>
              <div><small>DEFENSIVE LINE</small><strong>{activeLine.label}</strong></div>
              <div><small>SHAPE SCORE</small><strong>{shape.score}</strong></div>
            </div>
            <div className="summary-lineup">
              {activePlayers.map((player) => (
                <span key={player.id}>
                  <b>{player.number}</b> {player.name}
                </span>
              ))}
            </div>
            <div className="summary-footer">
              <p>모든 선수 데이터는 UI/UX 검증을 위한 가상 데이터입니다.</p>
              <button type="button" className="primary-button" onClick={() => setSummaryOpen(false)}>
                보드로 돌아가기
              </button>
            </div>
          </section>
        </dialog>
    </div>
  );
}

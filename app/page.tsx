import type { Metadata } from "next";
import abilityDatabase from "../data/world-cup-2026-player-abilities.json";
import { projectSimulatorTeams } from "../lib/player-catalog.js";
import { SimulationWorkspace } from "./SimulationWorkspace";
import type { SimulatorTeam } from "./simulator-types";

export const metadata: Metadata = {
  title: { absolute: "FTA | Football Tactics Architect" },
  description:
    "실제 선수 능력치로 이동 경로와 패스 상황을 재현하는 축구 전술 시뮬레이터",
};

const simulatorTeams = projectSimulatorTeams(
  abilityDatabase.players,
) as SimulatorTeam[];

export default function Home() {
  return (
    <main className="sim-page">
      <SimulationWorkspace teams={simulatorTeams} />
    </main>
  );
}

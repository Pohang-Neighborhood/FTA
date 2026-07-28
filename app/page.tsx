import type { Metadata } from "next";
import { TacticsBoard } from "./TacticsBoard";

export const metadata: Metadata = {
  title: { absolute: "FTA | Football Tactics Architect" },
  description: "선수를 직접 배치하고 경기 계획을 완성하는 인터랙티브 축구 전술 보드",
};

export default function Home() {
  return <TacticsBoard />;
}

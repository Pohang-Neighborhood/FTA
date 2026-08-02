export type FormationSlot = {
  role: string;
  x: number;
  y: number;
};

export type Formation = {
  id: string;
  label: string;
  name: string;
  description: string;
  slots: FormationSlot[];
};

export const formations: Formation[] = [
  {
    id: "4-3-3",
    label: "4-3-3",
    name: "Wide Control",
    description: "측면 폭과 중앙의 삼각형을 함께 확보합니다.",
    slots: [
      { role: "GK", x: 50, y: 90 },
      { role: "LB", x: 14, y: 70 },
      { role: "LCB", x: 38, y: 74 },
      { role: "RCB", x: 62, y: 74 },
      { role: "RB", x: 86, y: 70 },
      { role: "DM", x: 50, y: 57 },
      { role: "LCM", x: 31, y: 47 },
      { role: "RCM", x: 69, y: 47 },
      { role: "LW", x: 15, y: 24 },
      { role: "ST", x: 50, y: 19 },
      { role: "RW", x: 85, y: 24 },
    ],
  },
  {
    id: "4-2-3-1",
    label: "4-2-3-1",
    name: "Central Overload",
    description: "두 명의 수비형 미드필더로 전환 상황을 보호합니다.",
    slots: [
      { role: "GK", x: 50, y: 90 },
      { role: "LB", x: 14, y: 71 },
      { role: "LCB", x: 38, y: 75 },
      { role: "RCB", x: 62, y: 75 },
      { role: "RB", x: 86, y: 71 },
      { role: "LDM", x: 36, y: 57 },
      { role: "RDM", x: 64, y: 57 },
      { role: "AM", x: 50, y: 39 },
      { role: "LW", x: 17, y: 32 },
      { role: "ST", x: 50, y: 18 },
      { role: "RW", x: 83, y: 32 },
    ],
  },
  {
    id: "3-4-2-1",
    label: "3-4-2-1",
    name: "Half-space Press",
    description: "윙백의 폭과 두 공격형 미드필더의 압박을 활용합니다.",
    slots: [
      { role: "GK", x: 50, y: 90 },
      { role: "LCB", x: 24, y: 72 },
      { role: "CB", x: 50, y: 77 },
      { role: "RCB", x: 76, y: 72 },
      { role: "LWB", x: 11, y: 51 },
      { role: "LCM", x: 38, y: 55 },
      { role: "RCM", x: 62, y: 55 },
      { role: "RWB", x: 89, y: 51 },
      { role: "LAM", x: 33, y: 33 },
      { role: "ST", x: 50, y: 17 },
      { role: "RAM", x: 67, y: 33 },
    ],
  },
  {
    id: "4-4-2",
    label: "4-4-2",
    name: "Compact Pair",
    description: "두 줄의 간격을 좁히고 투톱으로 빠르게 전진합니다.",
    slots: [
      { role: "GK", x: 50, y: 90 },
      { role: "LB", x: 14, y: 72 },
      { role: "LCB", x: 38, y: 76 },
      { role: "RCB", x: 62, y: 76 },
      { role: "RB", x: 86, y: 72 },
      { role: "LM", x: 15, y: 49 },
      { role: "LCM", x: 39, y: 54 },
      { role: "RCM", x: 61, y: 54 },
      { role: "RM", x: 85, y: 49 },
      { role: "LST", x: 37, y: 22 },
      { role: "RST", x: 63, y: 22 },
    ],
  },
];

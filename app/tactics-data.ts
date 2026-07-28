export type Player = {
  id: string;
  name: string;
  number: number;
  primaryPosition: string;
  secondaryPosition: string;
  foot: "왼발" | "오른발";
  pace: number;
  passing: number;
  defending: number;
};

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

export type TacticalOption = {
  id: string;
  label: string;
  description: string;
};

export const mockPlayers: Player[] = [
  {
    id: "p01",
    name: "김현우",
    number: 1,
    primaryPosition: "GK",
    secondaryPosition: "SW",
    foot: "오른발",
    pace: 54,
    passing: 77,
    defending: 84,
  },
  {
    id: "p02",
    name: "윤태석",
    number: 2,
    primaryPosition: "RB",
    secondaryPosition: "CB",
    foot: "오른발",
    pace: 82,
    passing: 75,
    defending: 79,
  },
  {
    id: "p03",
    name: "박민재",
    number: 4,
    primaryPosition: "CB",
    secondaryPosition: "DM",
    foot: "오른발",
    pace: 68,
    passing: 72,
    defending: 86,
  },
  {
    id: "p04",
    name: "이정호",
    number: 5,
    primaryPosition: "CB",
    secondaryPosition: "LB",
    foot: "왼발",
    pace: 71,
    passing: 76,
    defending: 85,
  },
  {
    id: "p05",
    name: "최도윤",
    number: 3,
    primaryPosition: "LB",
    secondaryPosition: "WB",
    foot: "왼발",
    pace: 84,
    passing: 78,
    defending: 77,
  },
  {
    id: "p06",
    name: "오세진",
    number: 6,
    primaryPosition: "DM",
    secondaryPosition: "CM",
    foot: "오른발",
    pace: 72,
    passing: 84,
    defending: 82,
  },
  {
    id: "p07",
    name: "한시우",
    number: 8,
    primaryPosition: "CM",
    secondaryPosition: "AM",
    foot: "오른발",
    pace: 78,
    passing: 88,
    defending: 70,
  },
  {
    id: "p08",
    name: "강준호",
    number: 10,
    primaryPosition: "AM",
    secondaryPosition: "CM",
    foot: "왼발",
    pace: 81,
    passing: 90,
    defending: 58,
  },
  {
    id: "p09",
    name: "임태윤",
    number: 7,
    primaryPosition: "RW",
    secondaryPosition: "ST",
    foot: "왼발",
    pace: 90,
    passing: 80,
    defending: 49,
  },
  {
    id: "p10",
    name: "서민규",
    number: 9,
    primaryPosition: "ST",
    secondaryPosition: "CF",
    foot: "오른발",
    pace: 85,
    passing: 74,
    defending: 42,
  },
  {
    id: "p11",
    name: "정지환",
    number: 11,
    primaryPosition: "LW",
    secondaryPosition: "AM",
    foot: "오른발",
    pace: 88,
    passing: 82,
    defending: 50,
  },
  {
    id: "p12",
    name: "이도현",
    number: 12,
    primaryPosition: "GK",
    secondaryPosition: "SW",
    foot: "왼발",
    pace: 57,
    passing: 74,
    defending: 81,
  },
  {
    id: "p13",
    name: "백승원",
    number: 14,
    primaryPosition: "CB",
    secondaryPosition: "DM",
    foot: "오른발",
    pace: 73,
    passing: 70,
    defending: 83,
  },
  {
    id: "p14",
    name: "노유찬",
    number: 15,
    primaryPosition: "LB",
    secondaryPosition: "RB",
    foot: "왼발",
    pace: 86,
    passing: 73,
    defending: 74,
  },
  {
    id: "p15",
    name: "문재원",
    number: 17,
    primaryPosition: "CM",
    secondaryPosition: "DM",
    foot: "오른발",
    pace: 76,
    passing: 85,
    defending: 75,
  },
  {
    id: "p16",
    name: "유건우",
    number: 18,
    primaryPosition: "AM",
    secondaryPosition: "RW",
    foot: "왼발",
    pace: 84,
    passing: 86,
    defending: 52,
  },
  {
    id: "p17",
    name: "장태오",
    number: 19,
    primaryPosition: "ST",
    secondaryPosition: "LW",
    foot: "오른발",
    pace: 87,
    passing: 72,
    defending: 40,
  },
];

export const initialLineupIds = [
  "p01",
  "p05",
  "p03",
  "p04",
  "p02",
  "p06",
  "p07",
  "p08",
  "p11",
  "p10",
  "p09",
];

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

export const mentalities: TacticalOption[] = [
  { id: "cautious", label: "안정", description: "공을 잃은 뒤 구조를 먼저 회복합니다." },
  { id: "balanced", label: "균형", description: "점유와 전진의 위험을 균형 있게 관리합니다." },
  { id: "front-foot", label: "주도", description: "상대 진영에서 더 많은 숫자로 압박합니다." },
];

export const widths: TacticalOption[] = [
  { id: "narrow", label: "좁게", description: "중앙에 간격을 좁혀 짧게 연결합니다." },
  { id: "balanced", label: "균형", description: "중앙과 측면을 같은 비중으로 활용합니다." },
  { id: "wide", label: "넓게", description: "터치라인까지 폭을 넓혀 수비를 벌립니다." },
];

export const defensiveLines: TacticalOption[] = [
  { id: "deep", label: "낮게", description: "뒷공간을 먼저 지키는 낮은 수비 라인입니다." },
  { id: "standard", label: "보통", description: "중앙선 아래에서 안정적으로 간격을 유지합니다." },
  { id: "high", label: "높게", description: "수비 라인을 끌어올려 팀 간격을 압축합니다." },
];

export const pressingLevels: TacticalOption[] = [
  { id: "low", label: "대기", description: "자리를 지키며 상대의 전진을 유도합니다." },
  { id: "mid", label: "중간", description: "중앙 진입 순간부터 압박을 시작합니다." },
  { id: "high", label: "강하게", description: "상대 빌드업 첫 패스부터 압박합니다." },
];

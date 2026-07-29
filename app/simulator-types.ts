export type TeamSide = "home" | "away";

export type WorldCupPosition = "GK" | "DF" | "MF" | "FW";

export type PlayerAbilities = {
  overall: number;
  speed: number;
  acceleration: number;
  sprintSpeed: number;
  agility: number;
  balance: number;
  stamina: number;
  strength: number;
  passing: number;
  ballControl: number;
  attacking: number;
  defending: number;
  positioning: number;
  reactions: number;
  decisionMaking: number;
};

export type GoalkeeperAbilities = {
  diving: number;
  handling: number;
  distribution: number;
  positioning: number;
  reflexes: number;
  sweeping: number;
};

export type SimulatorPlayer = {
  id: string;
  teamId: string;
  teamName: string;
  group: string;
  name: string;
  number: number;
  position: WorldCupPosition;
  age: number;
  club: string;
  abilities: PlayerAbilities;
  goalkeeperAbilities: GoalkeeperAbilities | null;
};

export type SimulatorTeam = {
  id: string;
  name: string;
  group: string;
  players: SimulatorPlayer[];
};

export type ParticipantId = `${TeamSide}:${string}`;

export type PitchPoint = {
  x: number;
  y: number;
};

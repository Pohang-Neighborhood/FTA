import type { WorldCupPosition } from "./world-cup-2026-players.types";

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

export type DirectAbilityProvenance = {
  source: "fc26";
  sourceVersion: 3;
  sourcePlayerId: number;
  sourceName: string;
  matchMethod:
    | "exact_name_birth_date"
    | "first_surname_birth_date"
    | "token_name_birth_date"
    | "verified_alias_birth_date";
  isInferred: false;
  confidence: number;
  confidenceLevel: "high" | "medium";
  sourcePositionCompatible: boolean;
  playerEloUsed: false;
  donorPlayerIds: [];
  meanNeighborDistance: null;
};

export type InferredAbilityProvenance = {
  source: "fta_estimate";
  sourceVersion: null;
  sourcePlayerId: null;
  sourceName: null;
  matchMethod: "position_age_playerelo_knn" | "position_age_knn";
  isInferred: true;
  confidence: 0.6 | 0.4;
  confidenceLevel: "medium" | "low";
  sourcePositionCompatible: null;
  playerEloUsed: boolean;
  donorPlayerIds: number[];
  meanNeighborDistance: number;
};

export type PlayerAbilityRecord = {
  id: string;
  teamId: string;
  teamName: string;
  group: "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L";
  name: string;
  number: number;
  position: WorldCupPosition;
  birthDate: string;
  ageAtTournament: number;
  club: string;
  playerElo: { elo: number; currentRank: number } | null;
  abilities: PlayerAbilities;
  goalkeeperAbilities: GoalkeeperAbilities | null;
  provenance: DirectAbilityProvenance | InferredAbilityProvenance;
};

export type WorldCupPlayerAbilityData = {
  metadata: {
    schemaVersion: 1;
    tournament: "2026 FIFA World Cup";
    snapshotAt: string;
    tournamentStartDate: "2026-06-11";
    teamCount: 48;
    playerCount: 1248;
    goalkeeperCount: number;
    directMatchCount: number;
    inferredCount: number;
    inferredWithPlayerEloCount: number;
    inferredWithoutPlayerEloCount: number;
    directMatchRate: number;
    matchMethodCounts: Record<string, number>;
    sourcePositionWarningCount: number;
    abilityScale: { minimum: 0; maximum: 100; integer: true };
    abilityDefinitions: Record<keyof PlayerAbilities, string>;
    goalkeeperDefinitions: Record<keyof GoalkeeperAbilities, string>;
    estimationModel: {
      version: "fc26-playerelo-knn-v1";
      description: string;
      fieldPlayerNeighborCount: 11;
      goalkeeperNeighborCount: 7;
      playerEloConfidence: 0.6;
      noPlayerEloConfidence: 0.4;
    };
    sources: Array<{
      id: string;
      name: string;
      publisher?: string;
      path?: string;
      url?: string;
      datasetVersion?: number;
      updatedAt?: string;
      sourceGeneratedAt?: string;
      upstreamSources?: Array<{
        name: string;
        publisher: string;
        url: string;
        revision?: number;
        datasetVersion?: number;
        sha256: string;
        license: "CC BY-SA 4.0" | "CC BY 4.0";
      }>;
      sha256: string;
      license: string;
      licenseUrl?: string;
      licenseBasis?: string;
      thirdPartyRightsNotice?: string;
    }>;
    notices: string[];
  };
  players: PlayerAbilityRecord[];
};

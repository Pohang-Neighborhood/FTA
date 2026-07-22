export type WorldCupPosition = "GK" | "DF" | "MF" | "FW";

export type PlayerEloRating = {
  sourcePlayerId: number;
  sourceName: string;
  sourceNationality: string;
  matchMethod: "nationality_birth_date_name" | "birth_date_name";
  elo: number;
  currentRank: number;
  eloPrevious28Days: number | null;
  rankPrevious28Days: number | null;
  sourcePosition: string | null;
  currentTeam: string | null;
  currentLeague: string | null;
  gamesPlayed: number;
  eloAboveReplacementCareer: number | null;
  eloAboveReplacementMatches: number | null;
  eloAboveReplacement180Days: number | null;
  lastUpdated: string;
};

export type WorldCupPlayer = {
  id: string;
  name: string;
  number: number;
  position: WorldCupPosition;
  birthDate: string;
  capsBeforeTournament: number;
  goalsBeforeTournament: number;
  club: string;
  clubAssociation: string;
  captain: boolean;
  playerElo: PlayerEloRating | null;
};

export type WorldCupTeam = {
  id: string;
  name: string;
  group: "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L";
  players: WorldCupPlayer[];
};

export type WorldCupPlayerData = {
  metadata: {
    tournament: "2026 FIFA World Cup";
    generatedAt: string;
    teamCount: number;
    playerCount: number;
    ratingsMatched: number;
    ratingsUnmatched: number;
    ratingMatchRate: number;
    ratingMeaning: string;
    sources: Array<{
      name: string;
      publisher: string;
      url: string;
      revision?: number;
      datasetVersion?: number;
      sha256: string;
      license: "CC BY-SA 4.0" | "CC BY 4.0";
    }>;
  };
  teams: WorldCupTeam[];
};

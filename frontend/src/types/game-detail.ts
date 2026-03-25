export interface EspnHeadshot {
  href?: string;
  alt?: string;
}

export interface EspnLogo {
  href?: string;
  rel?: string[];
}

export interface EspnStatistic {
  name?: string;
  label?: string;
  shortDisplayName?: string;
  displayName?: string;
  abbreviation?: string;
  displayValue?: string | number;
  value?: string | number;
}

export interface EspnAthlete {
  id?: string | number;
  displayName?: string;
  shortName?: string;
  headshot?: string | EspnHeadshot;
  position?: {
    abbreviation?: string;
  };
}

export interface EspnAthleteStatRow {
  athlete?: EspnAthlete;
  stats?: Array<string | number | null | undefined>;
}

export interface EspnLeaderEntry {
  athlete?: EspnAthlete;
  displayValue?: string | number;
}

export interface EspnLeaderCategory {
  displayName?: string;
  name?: string;
  leaders?: EspnLeaderEntry[];
}

export interface EspnSummaryLeaderGroup {
  team?: EspnTeamBlob;
  leaders?: EspnLeaderCategory[];
}

export interface EspnLineScore {
  value?: string | number;
  displayValue?: string | number;
  score?: string | number;
  points?: string | number;
  runs?: string | number;
}

export interface EspnTeamBlob {
  id?: string | number;
  displayName?: string;
  shortDisplayName?: string;
  abbreviation?: string;
  logo?: string;
  logos?: EspnLogo[];
  color?: string;
  name?: string;
  location?: string;
}

export interface EspnTeamRecord {
  summary?: string;
}

export interface EspnCompetitor {
  team?: EspnTeamBlob;
  records?: EspnTeamRecord[];
  score?: string | number;
  leaders?: EspnLeaderCategory[];
  statistics?: EspnStatistic[];
  linescores?: EspnLineScore[];
  homeAway?: string;
}

export interface EspnVenue {
  fullName?: string;
  displayName?: string;
  address?: {
    city?: string;
    state?: string;
  };
}

export interface EspnOdds {
  details?: string;
  overUnder?: string | number;
  spread?: string | number;
}

export interface EspnBroadcast {
  names?: string[];
}

export interface EspnStatusType {
  name?: string;
  shortDetail?: string;
  detail?: string;
  state?: string;
}

export interface EspnStatusBlob {
  type?: EspnStatusType;
}

export interface EspnCompetition {
  competitors?: EspnCompetitor[];
  venue?: EspnVenue;
  odds?: EspnOdds[];
  broadcasts?: EspnBroadcast[];
  status?: EspnStatusBlob;
  date?: string;
}

export interface EspnHeaderSeason {
  year?: string | number;
  type?: string | number;
}

export interface EspnHeader {
  competitions?: EspnCompetition[];
  season?: EspnHeaderSeason;
}

export interface EspnBoxscorePlayerTeam {
  team?: EspnTeamBlob;
  statistics?: Array<EspnStatisticGroup | EspnStatistic>;
}

export interface EspnAthleteStatValue {
  name?: string;
  value?: string | number;
}

export interface EspnAthleteStatCategory {
  stats?: EspnAthleteStatValue[];
}

export interface EspnAthleteStatsPayload {
  splits?: {
    categories?: EspnAthleteStatCategory[];
  };
}

export interface EspnStatisticGroup {
  labels?: Array<string | number>;
  athletes?: EspnAthleteStatRow[];
}

export interface EspnPlayPeriod {
  number?: string | number;
  displayValue?: string;
}

export interface EspnPlayClock {
  displayValue?: string;
  value?: string | number;
}

export interface EspnPlayType {
  text?: string;
}

export interface EspnPlayParticipant {
  athlete?: EspnAthlete;
}

export interface EspnPlayRecord {
  id?: string | number;
  text?: string;
  description?: string;
  shortText?: string;
  type?: EspnPlayType;
  clock?: EspnPlayClock;
  period?: EspnPlayPeriod;
  scoreValue?: string | number;
  scoringPlay?: boolean;
  homeScore?: string | number;
  awayScore?: string | number;
  team?: EspnTeamBlob;
  athlete?: EspnAthlete;
  participants?: EspnPlayParticipant[];
}

export interface EspnDrive {
  plays?: EspnPlayRecord[];
}

export interface EspnSummary {
  header?: EspnHeader;
  boxscore?: {
    players?: EspnBoxscorePlayerTeam[];
    teams?: EspnBoxscorePlayerTeam[];
  };
  leaders?: EspnSummaryLeaderGroup[];
  plays?: EspnPlayRecord[];
  drives?: {
    previous?: EspnDrive[];
  };
  gameInfo?: {
    venue?: EspnVenue;
  };
  odds?: EspnOdds[];
  broadcasts?: EspnBroadcast[];
}

export interface Play {
  id: string;
  text: string;
  shortText?: string;
  type?: string;
  playType?: string;
  clock?: string;
  period?: number;
  periodText?: string;
  statusDetail?: string;
  scoreValue?: number;
  scoringPlay?: boolean;
  homeScore: string | number;
  awayScore: string | number;
  team?: string;
  teamLogo?: string;
  playTeamName?: string;
  playTeamAbbr?: string;
  playTeamLogo?: string;
  athleteName: string;
  athleteHeadshot: string;
  athleteStats?: string;
  athlete2Name?: string;
  athlete2Headshot?: string;
}

export interface PlayerStat {
  name: string;
  shortName: string;
  headshot: unknown;
  position: string;
  stats: Record<string, string>;
}

export interface BoxScoreTeam {
  teamName: string;
  teamAbbr: string;
  teamLogo: string;
  players: PlayerStat[];
  labels: string[];
}

export interface Leader {
  team: string;
  teamAbbr: string;
  category: string;
  name: string;
  value: string;
  headshot: unknown;
}

export interface TeamLeaderItem {
  category: string;
  name: string;
  value: string;
  headshot: unknown;
}

export interface TeamDetailStat {
  name: string;
  label: string;
  abbreviation: string;
}

export interface TeamDetail {
  id: string;
  name: string;
  abbreviation: string;
  logo: string;
  color: string;
  record: string;
  score: string;
  leaders: TeamLeaderItem[];
  stats: TeamDetailStat[];
  linescores: number[];
}

export interface GameData {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeAbbr: string;
  awayAbbr: string;
  homeScore: number;
  awayScore: number;
  homeBadge: string;
  awayBadge: string;
  status: string;
  statusDetail: string;
  league: string;
  dateEvent: string;
  scheduledAt?: string;
  strVenue: string;
  strEvent: string;
  homeDetail: TeamDetail;
  awayDetail: TeamDetail;
  venue: { name: string; city: string; state: string };
  odds: { details: string; overUnder: number; spread: number } | null;
  broadcasts: string[];
}

export interface GameDetailResponse {
  game: GameData | null;
  plays: Play[];
  boxScore: BoxScoreTeam[];
  leaders: Leader[];
  error?: string;
}

export interface GamePredictionResponse {
  game_id: string;
  home_win_prob: number;
  away_win_prob: number;
  model_version: string;
  confidence?: number;
  factors?: string[];
  created_at: string;
}

export interface ResolvedPlayTeam {
  name: string;
  abbr: string;
  logo: string;
  side: "home" | "away";
}

export interface DisplayPlay extends Play {
  displayText: string;
  playType: string;
  playTeamName: string;
  playTeamAbbr: string;
  playTeamLogo: string;
  athleteName: string;
  athleteHeadshot: string;
  athleteStats: string;
  athlete2Name: string;
  athlete2Headshot: string;
  isMatchupEvent: boolean;
}

export type DerivedTeamLeaders = TeamDetail["leaders"];

export interface DerivedLeadersPayload {
  leaders: Leader[];
  byTeamKey: Record<string, DerivedTeamLeaders>;
}

export interface StandingsTeam {
  id: string;
  name: string;
  short_name: string;
  city: string;
  logo_url: string;
}

export interface StandingsEntryStats {
  wins: string;
  losses: string;
  ties: string;
  otl: string;
  pct: string;
  gb: string;
  home: string;
  away: string;
  conference: string;
  division: string;
  last_ten: string;
  streak: string;
  points: string;
  points_for: string;
  points_against: string;
  diff: string;
}

export interface StandingsEntry {
  rank: string;
  is_champion?: boolean;
  team: StandingsTeam;
  record: string;
  stats: StandingsEntryStats;
}

export interface StandingsGroup {
  id: string;
  name: string;
  short_name: string;
  entries: StandingsEntry[];
}

export interface StandingsSeason {
  year: string;
  display_name: string;
  start_date: string;
  end_date: string;
}

export interface StandingsChampion {
  team_id: string;
  team_name: string;
  team_abbr: string;
  logo_url: string;
  event_id: string;
  event_name: string;
  event_date: string;
}

export interface StandingsResponse {
  league: string;
  season: string;
  seasons: StandingsSeason[];
  champion?: StandingsChampion | null;
  groups: StandingsGroup[];
}

export interface SavedStandingTeam {
  name: string;
  shortName: string;
  city: string;
  league: string;
  sport: string;
}

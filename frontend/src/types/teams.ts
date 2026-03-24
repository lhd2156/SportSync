export type LeagueKey = "NFL" | "NBA" | "MLB" | "NHL" | "EPL";

export interface TeamItem {
  id: string;
  requestId: string;
  dbId?: string;
  name: string;
  shortName: string;
  league: LeagueKey;
  logo: string;
}

export interface SavedTeamResponse {
  id: string;
  external_id?: string;
  name: string;
  short_name?: string;
  sport?: string;
  league?: string;
  logo_url?: string;
  city?: string;
}

export interface TeamCatalogResponse {
  id: string;
  external_id?: string;
  name: string;
  short_name?: string;
  league?: string;
  sport?: string;
  logo_url?: string;
  city?: string;
}

export interface TeamGroup {
  name: string;
  teams: string[];
  teamIds: string[];
}

export interface TeamGroupsResponse {
  groups?: TeamGroup[];
}

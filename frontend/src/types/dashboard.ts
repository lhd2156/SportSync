export interface ESPNGame {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeAbbr: string;
  awayAbbr: string;
  homeScore: number;
  awayScore: number;
  homeBadge: string;
  awayBadge: string;
  homeColor?: string;
  awayColor?: string;
  status: string;
  statusDetail: string;
  league: string;
  dateEvent: string;
  scheduledAt?: string;
  strTime: string;
  strEvent: string;
  strVenue: string;
  headline: string;
}

export interface GameItem {
  id: string;
  homeTeam: { name: string; shortName?: string; logoUrl?: string | null; color?: string | null };
  awayTeam: { name: string; shortName?: string; logoUrl?: string | null; color?: string | null };
  homeScore: number;
  awayScore: number;
  status: string;
  statusDetail: string;
  league: string;
  leagueKey: string;
  scheduledAt: string;
}

export interface PredictionResult {
  gameId: string;
  homeWinProb: number;
  awayWinProb: number;
  modelVersion: string;
}

export interface PredictionCacheEntry {
  fetchedAt: number;
  fingerprint: string;
  data: PredictionResult | null;
}

export interface SavedTeamSummary {
  id: string;
  name: string;
  shortName?: string;
  league?: string;
  sport?: string;
}

export interface NewsItem {
  id: string;
  headline: string;
  source: string;
  imageUrl: string | null;
  publishedAt: string;
  url: string | null;
  league: string;
  description?: string;
}

export interface FeaturedItem {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: string;
  statusDetail: string;
  league: string;
  homeBadge: string | null;
  awayBadge: string | null;
  thumb: string | null;
  dateEvent: string;
  scheduledAt?: string;
  strTime: string;
  strEvent: string;
  strVenue: string;
}

export interface ActivityItem {
  id: string;
  gameId: string;
  gameMatchup?: string;
  text: string;
  playType: string;
  athleteName: string;
  athleteHeadshot: string;
  athleteStats: string;
  athlete2Name: string;
  athlete2Headshot: string;
  playTeamName: string;
  playTeamAbbr: string;
  playTeamLogo: string;
  league: string;
  statusDetail: string;
  homeTeam: string;
  awayTeam: string;
  homeAbbr: string;
  awayAbbr: string;
  homeScore: number;
  awayScore: number;
  homeBadge: string;
  awayBadge: string;
  status: string;
  sortWallclock?: string;
  isSavedTeam?: boolean;
}

export interface ActivityCacheEntry {
  items: ActivityItem[];
  total: number;
  hasMore: boolean;
  allItems?: ActivityItem[];
  cachedForDay?: string;
  cachedAt?: number;
  effectiveDate?: string;
}

export type ActivityDisplayOrder = "recentFirst" | "chronological";

export interface GameSlateCacheEntry {
  cachedAt: number;
  data: GameItem[];
}

export interface CachedNewsEntry {
  cachedAt: number;
  items: NewsItem[];
}

export interface CachedFeaturedEntry {
  cachedAt: number;
  items: FeaturedItem[];
}

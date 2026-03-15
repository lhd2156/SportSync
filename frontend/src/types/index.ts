/**
 * SportSync - Core TypeScript Interfaces
 * All shared types live in src/types/ -- never define inline in components.
 */

export interface User {
  id: string;
  email: string;
  displayName: string;
  dateOfBirth: string;
  gender: string | null;
  profilePictureUrl: string | null;
  isOnboarded: boolean;
  createdAt: string;
  sports: string[];
  provider: string | null;
}

export interface Team {
  id: string;
  externalId: string;
  name: string;
  shortName: string;
  sport: string;
  league: string;
  logoUrl: string;
  city: string;
}

export interface Game {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeam: Team;
  awayTeam: Team;
  sport: string;
  league: string;
  scheduledAt: string;
  status: GameStatus;
  homeScore: number;
  awayScore: number;
}

export type GameStatus = "scheduled" | "live" | "final" | "postponed";

export interface Prediction {
  id: string;
  gameId: string;
  homeWinProb: number;
  awayWinProb: number;
  modelVersion: string;
  createdAt: string;
}

export interface ScoreEvent {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: GameStatus;
  sport: string;
  league: string;
}

export interface AuthResponse {
  accessToken: string;
  isOnboarded: boolean;
  isNewUser?: boolean;
}

export interface ApiError {
  detail: string;
  code: string;
}

export interface FeedItem {
  type: "score" | "news" | "play";
  data: Game | NewsItem | PlayEvent;
  priority: number;
}

export interface NewsItem {
  id: string;
  headline: string;
  source: string;
  thumbnailUrl: string;
  timestamp: string;
  url: string;
}

export interface PlayEvent {
  id: string;
  gameId: string;
  playerName: string;
  playerPhotoUrl: string;
  description: string;
  scoreContext: string;
  timestamp: string;
}

export interface CookiePreferences {
  essential: boolean;
  functional: boolean;
  analytics: boolean;
}

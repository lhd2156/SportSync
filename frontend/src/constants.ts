/**
 * SportSync Frontend - Application Constants
 * All magic strings and numbers live here. Never define inline.
 */

export const APP_NAME = "SportSync";
export const APP_VERSION = "0.1";
export const APP_TAGLINE = "Your personalized sports command center";

export const CONTACT_EMAILS = {
  PRIVACY: "privacy@onsportsync.com",
  LEGAL: "legal@onsportsync.com",
  NO_REPLY: "noreply@onsportsync.com",
} as const;

/* Supported sports shown in the tab bar and onboarding */
export const SUPPORTED_SPORTS = [
  { id: "NFL", label: "NFL", sport: "Football" },
  { id: "NBA", label: "NBA", sport: "Basketball" },
  { id: "MLB", label: "MLB", sport: "Baseball" },
  { id: "NHL", label: "NHL", sport: "Hockey" },
  { id: "EPL", label: "EPL", sport: "Soccer" },
] as const;

/* Route paths used in react-router navigation */
export const ROUTES = {
  HOME: "/",
  LOGIN: "/login",
  REGISTER: "/register",
  FORGOT_PASSWORD: "/forgot-password",
  RESET_PASSWORD: "/reset-password",
  ONBOARDING_STEP_1: "/onboarding/step-1",
  ONBOARDING_STEP_2: "/onboarding/step-2",
  ONBOARDING_STEP_3: "/onboarding/step-3",
  DASHBOARD: "/dashboard",
  HIGHLIGHTS: "/highlights",
  SCORES: "/scores",
  STANDINGS: "/standings",
  TEAMS: "/teams",
  TEAM_DETAIL: "/teams/:id",
  GAME_DETAIL: "/games/:slug",
  SETTINGS: "/settings",
  TERMS: "/terms",
  PRIVACY: "/privacy",
  COOKIES: "/cookies",
  ABOUT: "/about",
} as const;

/* API endpoint paths (appended to VITE_API_BASE_URL) */
export const API = {
  AUTH_REGISTER: "/api/auth/register",
  AUTH_LOGIN: "/api/auth/login",
  AUTH_GOOGLE: "/api/auth/google",
  AUTH_REFRESH: "/api/auth/refresh",
  AUTH_LOGOUT: "/api/auth/logout",
  AUTH_PASSWORD_RESET: "/api/auth/password-reset",
  AUTH_PASSWORD_RESET_VALIDATE: "/api/auth/password-reset/validate",
  AUTH_PASSWORD_RESET_CONFIRM: "/api/auth/password-reset/confirm",
  AUTH_PASSWORD_RESET_CODE_CONFIRM: "/api/auth/password-reset/code/confirm",
  AUTH_CHANGE_PASSWORD: "/api/auth/change-password",
  ONBOARDING_STEP_1: "/api/auth/onboarding/step-1",
  ONBOARDING_STEP_2: "/api/auth/onboarding/step-2",
  ONBOARDING_COMPLETE: "/api/auth/onboarding/complete",
  AUTH_SET_PASSWORD: "/api/auth/set-password",
  TEAMS: "/api/teams",
  SCORES: "/api/scores",
  GAMES: "/api/games",
  PREDICT: "/api/predict",
  PREDICT_BATCH: "/api/predict/batch",
  USER_FEED: "/api/user/feed",
  USER_TEAMS: "/api/user/teams",
  USER_PROFILE: "/api/user/profile",
  USER_PROFILE_AVATAR: "/api/user/profile/avatar",
  USER_ACCOUNT: "/api/user/account",
  SPORTS_EVENTS_DAY: "/api/sports/events/day",
  SPORTS_EVENTS_PAST: "/api/sports/events/past",
  SPORTS_EVENTS_NEXT: "/api/sports/events/next",
  SPORTS_LEAGUE: "/api/sports/league",
  SPORTS_TEAMS: "/api/sports/teams",
  SPORTS_NEWS: "/api/sports/news",
  SPORTS_HIGHLIGHTS: "/api/sports/highlights",
  SPORTS_FEATURED: "/api/sports/featured",
  /* ESPN API proxy endpoints */
  ESPN_SCOREBOARD: "/api/sports/espn/scoreboard",
  ESPN_ALL: "/api/sports/espn/all",
  ESPN_FEATURED: "/api/sports/espn/featured",
  ESPN_NEWS: "/api/sports/espn/news",
  ESPN_HIGHLIGHTS: "/api/sports/espn/highlights",
  ESPN_ACTIVITY: "/api/sports/espn/activity",
  ESPN_ACTIVITY_LATEST_DATE: "/api/sports/espn/activity/latest-date",
  ESPN_HEADSHOT: "/api/sports/espn/headshot",
  ESPN_NBA_ROSTER: "/api/sports/espn/nba/roster",
  ESPN_NBA_ATHLETE_STATS: "/api/sports/espn/nba/athlete-stats",
  ESPN_GAME: "/api/sports/espn/game",  // + /{eventId}
} as const;

/* Cookie names must match the backend exactly */
export const COOKIE_NAMES = {
  CONSENT: "cookie_consent",
  PREFERENCES: "cookie_prefs",
} as const;

export const STORAGE_KEYS = {
  AUTH_USER_SNAPSHOT: "sportsync_auth_user_snapshot_v1",
  AUTH_SESSION_HINT: "sportsync_auth_session_hint_v1",
} as const;

/* Minimum age required to use the platform */
export const MINIMUM_AGE_YEARS = 18;

/* Date format used across the application */
export const DATE_FORMAT = "MMM d, yyyy";

/* Pagination default */
export const DEFAULT_PAGE_SIZE = 20;

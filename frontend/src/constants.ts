/**
 * SportSync Frontend - Application Constants
 * All magic strings and numbers live here. Never define inline.
 */

export const APP_NAME = "SportSync";
export const APP_VERSION = "0.1";
export const APP_TAGLINE = "Your personalized sports command center";

/* Supported sports shown in the tab bar and onboarding */
export const SUPPORTED_SPORTS = [
  { id: "NFL", label: "NFL", sport: "Football" },
  { id: "NBA", label: "NBA", sport: "Basketball" },
  { id: "MLB", label: "MLB", sport: "Baseball" },
  { id: "NHL", label: "NHL", sport: "Hockey" },
  { id: "MLS", label: "MLS", sport: "Soccer" },
  { id: "EPL", label: "EPL", sport: "Soccer" },
] as const;

/* Route paths used in react-router navigation */
export const ROUTES = {
  HOME: "/",
  LOGIN: "/login",
  REGISTER: "/register",
  ONBOARDING_STEP_1: "/onboarding/step-1",
  ONBOARDING_STEP_2: "/onboarding/step-2",
  ONBOARDING_STEP_3: "/onboarding/step-3",
  DASHBOARD: "/dashboard",
  SCORES: "/scores",
  TEAMS: "/teams",
  TEAM_DETAIL: "/teams/:id",
  GAME_DETAIL: "/games/:id",
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
  ONBOARDING_STEP_1: "/api/auth/onboarding/step-1",
  ONBOARDING_STEP_2: "/api/auth/onboarding/step-2",
  ONBOARDING_COMPLETE: "/api/auth/onboarding/complete",
  AUTH_SET_PASSWORD: "/api/auth/set-password",
  TEAMS: "/api/teams",
  SCORES: "/api/scores",
  GAMES: "/api/games",
  PREDICT: "/api/predict",
  USER_FEED: "/api/user/feed",
  USER_TEAMS: "/api/user/teams",
  USER_PROFILE: "/api/user/profile",
} as const;

/* Cookie names must match the backend exactly */
export const COOKIE_NAMES = {
  CONSENT: "cookie_consent",
  PREFERENCES: "cookie_prefs",
} as const;

/* Minimum age required to use the platform */
export const MINIMUM_AGE_YEARS = 18;

/* Date format used across the application */
export const DATE_FORMAT = "MMM d, yyyy";

/* Pagination default */
export const DEFAULT_PAGE_SIZE = 20;

import { ROUTES } from "../constants";

const ALLOWED_INTERNAL_PREFIXES = [
  ROUTES.HOME,
  ROUTES.DASHBOARD,
  ROUTES.LOGIN,
  ROUTES.REGISTER,
  ROUTES.FORGOT_PASSWORD,
  ROUTES.RESET_PASSWORD,
  ROUTES.ONBOARDING_STEP_1,
  ROUTES.ONBOARDING_STEP_2,
  ROUTES.ONBOARDING_STEP_3,
  ROUTES.SCORES,
  ROUTES.STANDINGS,
  "/teams",
  "/games",
  ROUTES.SETTINGS,
  ROUTES.TERMS,
  ROUTES.PRIVACY,
  ROUTES.COOKIES,
  ROUTES.ABOUT,
];

function isAllowedInternalPath(path: string): boolean {
  return ALLOWED_INTERNAL_PREFIXES.some((prefix) => {
    if (prefix === ROUTES.HOME) {
      return path === ROUTES.HOME;
    }
    return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`);
  });
}

export function getSafeRedirectTarget(
  candidate: string | null | undefined,
  fallback = ROUTES.DASHBOARD,
): string {
  if (!candidate) {
    return fallback;
  }

  try {
    const trimmed = candidate.trim();
    if (!trimmed || trimmed.startsWith("//")) {
      return fallback;
    }

    if (trimmed.startsWith("/")) {
      const internalUrl = new URL(trimmed, window.location.origin);
      const normalizedPath = `${internalUrl.pathname}${internalUrl.search}${internalUrl.hash}`;
      return isAllowedInternalPath(internalUrl.pathname) ? normalizedPath : fallback;
    }

    const url = new URL(trimmed);
    const allowedOrigins = new Set<string>([
      window.location.origin,
      ...(import.meta.env.VITE_ALLOWED_REDIRECT_ORIGINS || "")
        .split(",")
        .map((origin: string) => origin.trim())
        .filter(Boolean),
    ]);

    if (!allowedOrigins.has(url.origin)) {
      return fallback;
    }

    const normalizedPath = `${url.pathname}${url.search}${url.hash}`;
    return isAllowedInternalPath(url.pathname) ? normalizedPath : fallback;
  } catch {
    return fallback;
  }
}

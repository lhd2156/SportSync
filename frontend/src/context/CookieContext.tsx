/**
 * SportSync - Cookie Consent Context
 *
 * Manages the cookie consent state across the application.
 * Essential cookies are always enabled. Functional and analytics
 * are configurable via the cookie banner and preferences modal.
 */
import { createContext, useContext, useState, useCallback, useEffect } from "react";
import type { ReactNode } from "react";
import { COOKIE_NAMES } from "../constants";
import type { CookiePreferences } from "../types";

type CookieContextValue = {
  hasConsent: boolean;
  preferences: CookiePreferences;
  showBanner: boolean;
  acceptAll: () => void;
  savePreferences: (prefs: CookiePreferences) => void;
};

const DEFAULT_PREFERENCES: CookiePreferences = {
  essential: true,
  functional: true,
  analytics: false,
};

const CookieContext = createContext<CookieContextValue | null>(null);

/* Read a cookie value by name */
function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[2]) : null;
}

/* Set a cookie with path, SameSite, and expiry */
function setCookie(name: string, value: string, maxAgeDays: number): void {
  const maxAge = maxAgeDays * 86400;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Strict`;
}

export function CookieProvider({ children }: { children: ReactNode }) {
  const [hasConsent, setHasConsent] = useState(false);
  const [showBanner, setShowBanner] = useState(false);
  const [preferences, setPreferences] = useState<CookiePreferences>(DEFAULT_PREFERENCES);

  /* Check existing consent on mount */
  useEffect(() => {
    const consent = getCookie(COOKIE_NAMES.CONSENT);
    if (consent === "true") {
      setHasConsent(true);
      setShowBanner(false);

      const savedPrefs = getCookie(COOKIE_NAMES.PREFERENCES);
      if (savedPrefs) {
        try {
          setPreferences(JSON.parse(savedPrefs));
        } catch {
          setPreferences(DEFAULT_PREFERENCES);
        }
      }
    } else {
      setShowBanner(true);
    }
  }, []);

  const acceptAll = useCallback(() => {
    const allAccepted: CookiePreferences = {
      essential: true,
      functional: true,
      analytics: true,
    };
    setCookie(COOKIE_NAMES.CONSENT, "true", 365);
    setCookie(COOKIE_NAMES.PREFERENCES, JSON.stringify(allAccepted), 365);
    setHasConsent(true);
    setPreferences(allAccepted);
    setShowBanner(false);
  }, []);

  const savePreferences = useCallback((prefs: CookiePreferences) => {
    const finalPrefs = { ...prefs, essential: true };
    setCookie(COOKIE_NAMES.CONSENT, "true", 365);
    setCookie(COOKIE_NAMES.PREFERENCES, JSON.stringify(finalPrefs), 365);
    setHasConsent(true);
    setPreferences(finalPrefs);
    setShowBanner(false);
  }, []);

  const value: CookieContextValue = {
    hasConsent,
    preferences,
    showBanner,
    acceptAll,
    savePreferences,
  };

  return <CookieContext.Provider value={value}>{children}</CookieContext.Provider>;
}

export function useCookieConsent(): CookieContextValue {
  const context = useContext(CookieContext);
  if (!context) {
    throw new Error("useCookieConsent must be used within a CookieProvider");
  }
  return context;
}

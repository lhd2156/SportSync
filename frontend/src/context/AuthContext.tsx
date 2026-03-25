/* eslint-disable react-refresh/only-export-components */
/**
 * SportSync - Authentication Context
 *
 * Manages the global auth state: current user, access token, and auth actions.
 * Token is stored in memory only. Refresh tokens live in HTTP-only cookies
 * that the browser sends automatically.
 */
import { createContext, useContext, useState, useCallback, useEffect } from "react";
import type { ReactNode } from "react";
import apiClient, { setAccessToken } from "../api/client";
import { API, STORAGE_KEYS } from "../constants";
import { queryClient } from "../lib/queryClient";
import type { User } from "../types";

type AuthContextValue = {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string, rememberMe: boolean) => Promise<void>;
  register: (email: string, password: string, confirmPassword: string, firstName: string, lastName: string, displayName: string, dateOfBirth: string, gender: string | null) => Promise<void>;
  loginWithGoogle: (googleToken: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  setUser: (user: User) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function readString(data: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string") return value;
  }
  return "";
}

function readNullableString(data: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string") return value;
  }
  return null;
}

function readBool(data: Record<string, unknown>, ...keys: string[]): boolean {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "boolean") return value;
  }
  return false;
}

/** Build a User object from the auth response data */
function buildUserFromResponse(data: Record<string, unknown>): User {
  const createdAt = readString(data, "created_at", "createdAt") || new Date().toISOString();
  const sportsValue = data.sports;
  return {
    id: readString(data, "user_id", "id"),
    email: readString(data, "email"),
    displayName: readString(data, "display_name", "displayName"),
    firstName: readString(data, "first_name", "firstName"),
    lastName: readString(data, "last_name", "lastName"),
    dateOfBirth: readString(data, "date_of_birth", "dateOfBirth"),
    gender: readNullableString(data, "gender"),
    profilePictureUrl: readNullableString(data, "profile_picture_url", "profilePictureUrl"),
    isOnboarded: readBool(data, "is_onboarded", "isOnboarded"),
    createdAt,
    sports: Array.isArray(sportsValue) ? sportsValue.filter((sport): sport is string => typeof sport === "string") : [],
    provider: readNullableString(data, "provider"),
    hasPassword: readBool(data, "has_password", "hasPassword"),
  };
}

function writeAuthUserSnapshot(user: User | null): void {
  try {
    if (!user) {
      sessionStorage.removeItem(STORAGE_KEYS.AUTH_USER_SNAPSHOT);
      return;
    }

    sessionStorage.setItem(STORAGE_KEYS.AUTH_USER_SNAPSHOT, JSON.stringify(user));
  } catch {
    // Ignore storage failures and keep auth interactive.
  }
}

function writeAuthSessionHint(enabled: boolean): void {
  try {
    if (!enabled) {
      localStorage.removeItem(STORAGE_KEYS.AUTH_SESSION_HINT);
      return;
    }

    localStorage.setItem(STORAGE_KEYS.AUTH_SESSION_HINT, "1");
  } catch {
    // Ignore storage failures and keep auth interactive.
  }
}

function hasAuthRestoreHint(): boolean {
  try {
    return Boolean(
      sessionStorage.getItem(STORAGE_KEYS.AUTH_USER_SNAPSHOT)
      || localStorage.getItem(STORAGE_KEYS.AUTH_SESSION_HINT),
    );
  } catch {
    return false;
  }
}

function clearStorageNamespace(storage: Storage, prefix: string): void {
  const keysToRemove: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && key.startsWith(prefix)) {
      keysToRemove.push(key);
    }
  }

  for (const key of keysToRemove) {
    storage.removeItem(key);
  }
}

function clearClientAuthArtifacts(): void {
  try {
    clearStorageNamespace(sessionStorage, "sportsync_");
    clearStorageNamespace(localStorage, "sportsync_");
    queryClient.clear();
  } catch {
    // Ignore storage/query cache cleanup failures.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const syncUser = useCallback((nextUser: User | null) => {
    setUserState(nextUser);
    writeAuthUserSnapshot(nextUser);
  }, []);

  /* Try to restore session on mount by refreshing the access token */
  const refreshAuth = useCallback(async () => {
    try {
      const response = await apiClient.post(API.AUTH_REFRESH);
      setAccessToken(response.data.access_token);

      // Try to fetch full profile; fall back to building from refresh response
      try {
        const profileResponse = await apiClient.get(API.USER_PROFILE);
        syncUser(buildUserFromResponse(profileResponse.data));
      } catch {
        syncUser(buildUserFromResponse(response.data));
      }
      writeAuthSessionHint(true);
    } catch {
      /* No valid session, user must log in */
      setAccessToken(null);
      clearClientAuthArtifacts();
      syncUser(null);
    } finally {
      setIsLoading(false);
    }
  }, [syncUser]);

  useEffect(() => {
    if (!hasAuthRestoreHint()) {
      setIsLoading(false);
      return;
    }
    refreshAuth();
  }, [refreshAuth]);

  const login = useCallback(async (email: string, password: string, rememberMe: boolean) => {
    const response = await apiClient.post(API.AUTH_LOGIN, {
      email,
      password,
      remember_me: rememberMe,
    });

    setAccessToken(response.data.access_token);
    writeAuthSessionHint(true);
    syncUser(buildUserFromResponse(response.data));
  }, [syncUser]);

  const register = useCallback(async (
    email: string,
    password: string,
    confirmPassword: string,
    firstName: string,
    lastName: string,
    displayName: string,
    dateOfBirth: string,
    gender: string | null,
  ) => {
    const response = await apiClient.post(API.AUTH_REGISTER, {
      email,
      password,
      confirm_password: confirmPassword,
      first_name: firstName,
      last_name: lastName,
      display_name: displayName,
      date_of_birth: dateOfBirth,
      gender: gender || null,
    });

    setAccessToken(response.data.access_token);
    writeAuthSessionHint(true);
    syncUser(buildUserFromResponse(response.data));
  }, [syncUser]);

  const loginWithGoogle = useCallback(async (googleToken: string) => {
    const response = await apiClient.post(API.AUTH_GOOGLE, {
      google_token: googleToken,
    });

    setAccessToken(response.data.access_token);
    writeAuthSessionHint(true);
    syncUser(buildUserFromResponse(response.data));
  }, [syncUser]);

  const logout = useCallback(async () => {
    try {
      await apiClient.post(API.AUTH_LOGOUT);
    } finally {
      setAccessToken(null);
      clearClientAuthArtifacts();
      syncUser(null);
    }
  }, [syncUser]);

  const setUser = useCallback((nextUser: User) => {
    syncUser(nextUser);
  }, [syncUser]);

  const value: AuthContextValue = {
    user,
    isAuthenticated: !!user,
    isLoading,
    login,
    register,
    loginWithGoogle,
    logout,
    refreshAuth,
    setUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

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
import { API } from "../constants";
import type { User } from "../types";

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string, rememberMe: boolean) => Promise<void>;
  register: (email: string, password: string, confirmPassword: string, firstName: string, lastName: string, displayName: string, dateOfBirth: string, gender: string | null) => Promise<void>;
  loginWithGoogle: (googleToken: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  setUser: (user: User) => void;
}

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  /* Try to restore session on mount by refreshing the access token */
  const refreshAuth = useCallback(async () => {
    try {
      const response = await apiClient.post(API.AUTH_REFRESH);
      setAccessToken(response.data.access_token);

      // Try to fetch full profile; fall back to building from refresh response
      try {
        const profileResponse = await apiClient.get(API.USER_PROFILE);
        setUser(buildUserFromResponse(profileResponse.data));
      } catch {
        setUser(buildUserFromResponse(response.data));
      }
    } catch {
      /* No valid session, user must log in */
      setAccessToken(null);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  const login = useCallback(async (email: string, password: string, rememberMe: boolean) => {
    const response = await apiClient.post(API.AUTH_LOGIN, {
      email,
      password,
      remember_me: rememberMe,
    });

    setAccessToken(response.data.access_token);
    setUser(buildUserFromResponse(response.data));
  }, []);

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
    setUser(buildUserFromResponse(response.data));
  }, []);

  const loginWithGoogle = useCallback(async (googleToken: string) => {
    const response = await apiClient.post(API.AUTH_GOOGLE, {
      google_token: googleToken,
    });

    setAccessToken(response.data.access_token);
    setUser(buildUserFromResponse(response.data));
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiClient.post(API.AUTH_LOGOUT);
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

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

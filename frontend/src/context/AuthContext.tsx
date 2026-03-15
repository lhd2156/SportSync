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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  /* Try to restore session on mount by refreshing the access token */
  const refreshAuth = useCallback(async () => {
    try {
      const response = await apiClient.post(API.AUTH_REFRESH);
      setAccessToken(response.data.access_token);

      const profileResponse = await apiClient.get(API.USER_PROFILE);
      setUser(profileResponse.data);
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

    const profileResponse = await apiClient.get(API.USER_PROFILE);
    setUser(profileResponse.data);
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

    const profileResponse = await apiClient.get(API.USER_PROFILE);
    setUser(profileResponse.data);
  }, []);

  const loginWithGoogle = useCallback(async (googleToken: string) => {
    const response = await apiClient.post(API.AUTH_GOOGLE, {
      google_token: googleToken,
    });

    setAccessToken(response.data.accessToken);

    const profileResponse = await apiClient.get(API.USER_PROFILE);
    setUser(profileResponse.data);
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

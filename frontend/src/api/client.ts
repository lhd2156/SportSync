/**
 * SportSync - Axios HTTP Client
 *
 * Pre-configured Axios instance that:
 * - Attaches JWT access token to every request via Authorization header
 * - Automatically refreshes expired tokens on 401 responses
 * - Never stores tokens in localStorage (kept in memory only)
 */
import axios from "axios";
import { API } from "../constants";
import { normalizeConfiguredLoopbackUrl } from "../utils/http";

function resolveApiBaseUrl(): string {
  const configured = String(import.meta.env.VITE_API_BASE_URL || "").trim();
  if (configured) {
    return normalizeConfiguredLoopbackUrl(configured);
  }

  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }

  return "http://localhost:8000";
}

const API_BASE_URL = resolveApiBaseUrl();
const API_REQUEST_TIMEOUT_MS = 12_000;

/* Access token stored in memory only, never in localStorage or sessionStorage */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

const AUTH_ENDPOINTS_THAT_SHOULD_NOT_TRIGGER_REFRESH = new Set<string>([
  API.AUTH_LOGIN,
  API.AUTH_REGISTER,
  API.AUTH_GOOGLE,
  API.AUTH_LOGOUT,
  API.AUTH_PASSWORD_RESET,
  API.AUTH_PASSWORD_RESET_VALIDATE,
  API.AUTH_PASSWORD_RESET_CONFIRM,
  API.AUTH_PASSWORD_RESET_CODE_CONFIRM,
]);

function getRequestPath(url: unknown): string {
  if (typeof url !== "string" || url.trim() === "") {
    return "";
  }

  try {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return new URL(url).pathname;
    }
  } catch {
    // Fall through to the raw string return below.
  }

  return url;
}

function shouldAttemptTokenRefresh(url: unknown): boolean {
  const requestPath = getRequestPath(url);
  if (!requestPath) {
    return true;
  }

  return !AUTH_ENDPOINTS_THAT_SHOULD_NOT_TRIGGER_REFRESH.has(requestPath);
}

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_REQUEST_TIMEOUT_MS,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

/* Attach JWT to outgoing requests if we have one */
apiClient.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

/* Auto-refresh on 401: try to get a new access token using the refresh cookie */
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    const requestPath = getRequestPath(originalRequest?.url);
    const isRefreshAttempt = requestPath === API.AUTH_REFRESH;
    const alreadyRetried = originalRequest._retry;

    if (
      error.response?.status === 401
      && !isRefreshAttempt
      && !alreadyRetried
      && shouldAttemptTokenRefresh(originalRequest?.url)
    ) {
      originalRequest._retry = true;
      try {
        const refreshResponse = await apiClient.post(API.AUTH_REFRESH);
        const newToken = refreshResponse.data.access_token;
        setAccessToken(newToken);
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return apiClient(originalRequest);
      } catch {
        /* Refresh failed -- user must log in again */
        setAccessToken(null);
        window.location.href = "/login";
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;

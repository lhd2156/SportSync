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

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

/* Access token stored in memory only, never in localStorage or sessionStorage */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

const apiClient = axios.create({
  baseURL: API_BASE_URL,
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

    const isRefreshAttempt = originalRequest.url === API.AUTH_REFRESH;
    const alreadyRetried = originalRequest._retry;

    if (error.response?.status === 401 && !isRefreshAttempt && !alreadyRetried) {
      originalRequest._retry = true;
      try {
        const refreshResponse = await apiClient.post(API.AUTH_REFRESH);
        const newToken = refreshResponse.data.accessToken;
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

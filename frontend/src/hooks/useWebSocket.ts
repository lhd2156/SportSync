/**
 * SportSync - WebSocket Hook
 *
 * Manages WebSocket connection to the Go realtime service.
 * Handles automatic reconnection, JWT auth, and cleanup on unmount.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { getAccessToken } from "../api/client";
import type { ScoreEvent } from "../types";
import { normalizeConfiguredLoopbackUrl } from "../utils/http";

function resolveWsBaseUrl(): string {
  const configured = String(import.meta.env.VITE_WS_URL || "").trim();
  if (configured) {
    return normalizeConfiguredLoopbackUrl(configured);
  }

  if (typeof window !== "undefined" && window.location?.host) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}`;
  }

  return "ws://localhost:8080";
}

const WS_BASE_URL = resolveWsBaseUrl();

type UseWebSocketOptions = {
  onMessage?: (event: ScoreEvent) => void;
  enabled?: boolean;
};

export function useWebSocket({ onMessage, enabled = true }: UseWebSocketOptions = {}) {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const connect = useCallback(() => {
    const token = getAccessToken();
    if (!token || !enabled) return;

    const ws = new WebSocket(`${WS_BASE_URL}/ws/scores?token=${token}`);

    ws.onopen = () => {
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data: ScoreEvent = JSON.parse(event.data);
        onMessage?.(data);
      } catch {
        /* Ignore malformed messages */
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      /* Attempt reconnect after 3 seconds */
      reconnectTimeoutRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, [enabled, onMessage]);

  /* Connect on mount, clean up on unmount */
  useEffect(() => {
    if (enabled) {
      connect();
    }

    return () => {
      clearTimeout(reconnectTimeoutRef.current);
      wsRef.current?.close();
    };
  }, [connect, enabled]);

  return { isConnected };
}

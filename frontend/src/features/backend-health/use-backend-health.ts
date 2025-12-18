"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getBackendBaseUrl } from "@/lib/backend-url";

export type BackendHealth = "online" | "offline" | "degraded";

const CHECK_INTERVAL_MS = 10_000;
const DEGRADED_THRESHOLD_MS = 3_000;
const TIMEOUT_MS = 5_000;

export function useBackendHealth() {
  const [health, setHealth] = useState<BackendHealth>("offline");
  const [responseTime, setResponseTime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unmountedRef = useRef(false);

  const checkNow = useCallback(async () => {
    if (unmountedRef.current) return;
    const start = Date.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const base = getBackendBaseUrl();
      const res = await fetch(`${base}/api/history`, { signal: controller.signal });
      clearTimeout(timeout);

      const elapsed = Date.now() - start;
      if (unmountedRef.current) return;

      if (res.ok) {
        setResponseTime(elapsed);
        setError(null);
        setHealth(elapsed > DEGRADED_THRESHOLD_MS ? "degraded" : "online");
      } else {
        setHealth("offline");
        setResponseTime(null);
        setError(`HTTP ${res.status}`);
      }
    } catch (err) {
      if (unmountedRef.current) return;
      setHealth("offline");
      setResponseTime(null);
      if (err instanceof Error) {
        setError(err.name === "AbortError" ? "Request timeout" : err.message);
      } else {
        setError("Unknown error");
      }
    }
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    const initial = setTimeout(() => {
      void checkNow();
    }, 0);

    intervalRef.current = setInterval(() => {
      void checkNow();
    }, CHECK_INTERVAL_MS);
    return () => {
      unmountedRef.current = true;
      clearTimeout(initial);
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [checkNow]);

  return { health, responseTime, error, checkNow };
}

export function getHealthColor(health: BackendHealth): string {
  switch (health) {
    case "online":
      return "#10b981";
    case "degraded":
      return "#f59e0b";
    case "offline":
      return "#ef4444";
    default:
      return "#6b7280";
  }
}

export function getHealthMessage(health: BackendHealth, responseTime: number | null, error: string | null): string {
  switch (health) {
    case "online":
      return responseTime !== null ? `Backend responding in ${responseTime}ms` : "Backend is online";
    case "degraded":
      return responseTime !== null ? `Backend slow (${responseTime}ms)` : "Backend responding slowly";
    case "offline":
      return error ? `Backend offline: ${error}` : "Backend is not responding";
    default:
      return "Checking backend status...";
  }
}



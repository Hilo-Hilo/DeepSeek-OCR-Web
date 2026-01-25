/**
 * Backend URL helpers
 *
 * Requirements:
 * - Works when accessing the UI from another machine (e.g. via Tailscale IP)
 * - Defaults to using the same hostname as the frontend, but port 8002
 * - Allows explicit override via NEXT_PUBLIC_BACKEND_URL
 */

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Returns the HTTP base URL for the FastAPI backend.
 *
 * Priority:
 * 1) NEXT_PUBLIC_BACKEND_URL
 * 2) In browser: derive from window.location.hostname -> http://<host>:8002
 *    - localhost -> http://127.0.0.1:8002 (avoid IPv6 localhost pitfalls)
 * 3) Fallback: http://127.0.0.1:8002
 */
export function getBackendBaseUrl(): string {
  const env = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (env && env.trim()) return stripTrailingSlash(env.trim());

  if (typeof window !== "undefined") {
    const hostname = window.location.hostname;
    if (hostname === "localhost") return "http://127.0.0.1:8002";
    return `http://${hostname}:8002`;
  }

  return "http://127.0.0.1:8002";
}

export function toWebSocketBaseUrl(httpBaseUrl: string): string {
  const normalized = stripTrailingSlash(httpBaseUrl);
  if (normalized.startsWith("https://")) return normalized.replace(/^https:\/\//, "wss://");
  if (normalized.startsWith("http://")) return normalized.replace(/^http:\/\//, "ws://");
  // If caller provided a bare host, assume ws://
  return `ws://${normalized}`;
}






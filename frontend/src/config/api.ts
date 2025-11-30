/**
 * API 配置文件
 * 
 * 动态检测后端地址：
 * - 本地访问 (localhost/127.0.0.1) → 使用 127.0.0.1:8002
 * - 远程访问 (Tailscale/其他IP) → 使用相同主机名:8002
 */

const getBackendUrl = (): string => {
  // In browser environment, use the current hostname
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    // Use the same host as frontend, but with backend port
    return `http://${hostname}:8002`;
  }
  // Fallback for SSR or non-browser environments
  return 'http://127.0.0.1:8002';
};

export const API_CONFIG = {
  /**
   * 后端 API 基础地址
   * 
   * 自动检测：
   * - 本地访问：http://127.0.0.1:8002
   * - Tailscale访问：http://<tailscale-ip>:8002
   */
  BASE_URL: getBackendUrl(),
};

export default API_CONFIG;

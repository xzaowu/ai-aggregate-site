/**
 * Build-time site configuration.
 *
 * NEXT_PUBLIC_* 变量在构建时嵌入 JS 产物。
 * 生产 Docker 构建应通过 ARG/ENV 或 build args 传入 NEXT_PUBLIC_API_BASE_URL=/api。
 * 本地开发时 .env 中的 NEXT_PUBLIC_API_BASE_URL=http://localhost:4000 会覆盖默认值。
 */
export const siteConfig = {
  siteName: "AI Aggregate",
  siteDescription: "A simple multi-model AI assistant platform.",
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || null,
  appUrl: process.env.NEXT_PUBLIC_APP_URL?.trim() || null,

  /**
   * 浏览器端 API 基础地址。
   *
   * 默认 /api 适用于单域名 Docker 部署（Nginx 反向代理 /api/ → API 容器）。
   * 本地开发请在 .env 中设置为 http://localhost:4000。
   * 独立 API 域名部署请设置为 https://api.your-domain.example。
   */
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL?.trim().replace(/\/+$/, "") || "/api",
};

/**
 * 安全拼接 API URL。
 * 处理 apiBaseUrl 和 path 之间的斜杠，避免重复或缺失。
 *
 *   apiUrl("/setup/status")
 *   // /api  → /api/setup/status
 *   // http://localhost:4000  → http://localhost:4000/setup/status
 *   // https://api.your-domain.example/api  → https://api.your-domain.example/api/setup/status
 */
export function apiUrl(path: string): string {
  const base = siteConfig.apiBaseUrl;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

/**
 * COS 图片地址 → 同源代理地址。
 *
 * 背景：COS 桶没配 CORS，浏览器里跨域图片无法用于 canvas 导出：
 *   · 带 crossOrigin 加载 → 被拒（图片都不显示）
 *   · 不带 crossOrigin   → canvas 被污染，toBlob 抛 SecurityError
 * 走 vite 的 `/cos-proxy`（见 vite.config.ts）后就是同源，两个问题都消失。
 *
 * ⚠️ 仅用于**需要读像素**的场景（裁剪）。普通展示一律用原始地址，
 *    既不增加代理负担，也不会掩盖"生产环境需要配 CORS 或反代"这件事。
 */
export function toSameOriginImageUrl(url?: string | null): string {
  if (!url) return ''
  // blob: / data: 本身就已经是同源或内联，直接用
  if (url.startsWith('blob:') || url.startsWith('data:')) return url
  try {
    const u = new URL(url)
    // 只代理 http(s) 的远程地址；已经是相对路径的不动
    if (!/^https?:$/.test(u.protocol)) return url
    return `/cos-proxy${u.pathname}${u.search}`
  } catch {
    return url
  }
}

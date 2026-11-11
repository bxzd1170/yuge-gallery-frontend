/**
 * 展示层格式化工具。
 * 注意：后端把 Long 序列化成字符串（防 JS 精度丢失），
 * 所以 picSize / maxSize / totalSize 这类字段运行时是字符串，统一用 Number() 兜一层。
 */

export function formatSize(bytes?: number | string): string {
  const n = Number(bytes)
  if (!n || Number.isNaN(n)) return '0'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function formatTime(t?: string): string {
  if (!t) return '—'
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 后端主色调存的是 0xRRGGBB，转成 CSS 用的 #RRGGBB */
export function formatColor(raw?: string): string | null {
  if (!raw) return null
  return raw.startsWith('0x') ? `#${raw.slice(2)}` : raw
}

/** 按码点计数，接近 MySQL 对 varchar(n) 的“字符”语义（emoji 不会被算成 2 个） */
export function charLen(s: string): number {
  return [...(s ?? '')].length
}

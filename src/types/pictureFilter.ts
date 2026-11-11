/**
 * 空间内搜索 / 筛选条件。
 *
 * 字段严格对应后端 `PictureQueryRequest`，且只包含 `getQueryWrapper` 里**真实生效**的条件：
 *   · searchText → (name LIKE %x% OR introduction LIKE %x%)，不搜标签/分类
 *   · name / introduction / picFormat → LIKE
 *   · category → `eq` 精确匹配
 *   · tags → 按 JSON 字符串 `like "\"tag\""`，多个标签是「同时包含」
 *   · picWidth / picHeight → `eq` **精确等值**（后端没有 between）
 *   · startEditTime / endEditTime → 过滤 `editTime`，不是 createTime
 */
export interface PictureFilters {
  searchText?: string
  name?: string
  introduction?: string
  category?: string
  tags?: string[]
  picFormat?: string
  picWidth?: number
  picHeight?: number
  /** ISO 字符串 */
  startEditTime?: string
  endEditTime?: string
}

/** 转成后端请求体（雪花 ID 一律字符串传） */
export function toQueryFilters(f: PictureFilters): Partial<API.PictureQueryRequest> {
  const out: Partial<API.PictureQueryRequest> = {}
  if (f.searchText) out.searchText = f.searchText
  if (f.name) out.name = f.name
  if (f.introduction) out.introduction = f.introduction
  if (f.category) out.category = f.category
  if (f.tags?.length) out.tags = f.tags
  if (f.picFormat) out.picFormat = f.picFormat
  if (f.picWidth != null) out.picWidth = f.picWidth
  if (f.picHeight != null) out.picHeight = f.picHeight
  if (f.startEditTime) out.startEditTime = f.startEditTime as unknown as string
  if (f.endEditTime) out.endEditTime = f.endEditTime as unknown as string
  return out
}

/** 有几项有效条件（用于按钮上的「已筛 N 项」） */
export function countFilters(f: PictureFilters): number {
  return Object.values(f).filter((v) => {
    if (v == null || v === '') return false
    if (Array.isArray(v)) return v.length > 0
    return true
  }).length
}

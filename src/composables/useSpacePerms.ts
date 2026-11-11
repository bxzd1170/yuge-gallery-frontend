import { ref } from 'vue'
import { getSpaceVoByIdUsingGet } from '@/api/spaceController'

/**
 * 「我在某个空间里有哪些权限」—— 直接问后端，不自己推算。
 *
 * 为什么不用前端拼角色：
 *   `SpaceVO.permissionList` 是 `SpaceUserAuthManager#getPermissionList` 按
 *   `spaceUserAuthConfig.json`（viewer/editor/admin → 权限码）算出来的**唯一权威结论**，
 *   而这份配置随时可能被改。前端自己写 `role === 'editor' ? 能编辑 : 不能`，
 *   只要后端加/减一个权限码就会漂移。
 *
 * 重要前提（已核实）：`GET /space/get/vo` **没有鉴权注解**，任何登录用户都能查任意空间的
 * 详情，但 `permissionList` 反映的始终是「当前登录用户」在该空间的权限 —— 所以可以放心用它
 * 判断别人空间里的按钮可见性，不存在越权泄露。
 *
 * 缓存：同一空间在一次会话里权限不会变（成员管理界面改完角色后会主动清缓存），
 * 所以按 spaceId 缓存，避免 Lightbox 翻图时每张都请求一次。
 */
interface SpaceMeta {
  perms: string[]
  name?: string
  type?: number
}
const cache = new Map<string, SpaceMeta>()

function keyOf(spaceId?: string | number | null): string {
  return spaceId != null && String(spaceId) !== '' ? String(spaceId) : ''
}

/** 清空缓存（成员角色变更后调用；不调用也不会错，只是要刷新页面才生效） */
export function clearSpacePermsCache(spaceId?: string | number | null) {
  const k = keyOf(spaceId)
  if (k) cache.delete(k)
  else cache.clear()
}

export function useSpacePerms() {
  /** null = 还没拿到（或这张图不在空间里），调用方应退回按归属判断 */
  const perms = ref<string[] | null>(null)
  /** 空间的基本信息，用于界面上显示「团队空间「xxx」」而不是一串 ID */
  const space = ref<{ name?: string; type?: number } | null>(null)
  const loading = ref(false)
  let seq = 0

  async function load(spaceId?: string | number | null) {
    const id = keyOf(spaceId)
    if (!id) {
      perms.value = null
      space.value = null
      return
    }
    const hit = cache.get(id)
    if (hit) {
      perms.value = hit.perms
      space.value = { name: hit.name, type: hit.type }
      return
    }
    const my = ++seq
    loading.value = true
    try {
      const res = await getSpaceVoByIdUsingGet({ id: id as unknown as number })
      const list = res.data?.permissionList ?? []
      const meta: SpaceMeta = { perms: list, name: res.data?.spaceName, type: res.data?.spaceType }
      cache.set(id, meta)
      if (my === seq) {
        perms.value = list
        space.value = { name: meta.name, type: meta.type }
      }
    } catch {
      // 查不到就退回归属判断，不要让按钮因为一次网络失败全部消失
      if (my === seq) perms.value = null
    } finally {
      if (my === seq) loading.value = false
    }
  }

  /** 切换图片时先把上一个空间的结论清掉，避免短暂用错误的权限渲染 */
  function reset() {
    seq++
    perms.value = null
    space.value = null
    loading.value = false
  }

  return { perms, space, loading, load, reset }
}

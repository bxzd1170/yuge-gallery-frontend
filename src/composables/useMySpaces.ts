import { ref } from 'vue'
import { listSpaceVoByPageUsingPost } from '@/api/spaceController'
import { listMyTeamSpaceUsingPost } from '@/api/spaceUserController'

export interface MySpaceOption {
  id: string
  name: string
  isTeam: boolean
  /** 是否由我创建（决定能否改名/删除，也决定按色搜索能不能用） */
  isMine: boolean
  /** 我在该空间里的角色（自己创建的空间按管理员算） */
  role: string
}

/**
 * 「我的空间」列表：我创建的 + 我加入的团队空间。
 *
 * 两个数据来源缺一不可，这是后端决定的：
 *   · `POST /space/list/page/vo` 传 userId → 我创建的空间；
 *   · `POST /spaceUser/list/my` → 我加入的团队空间（后端直接带出我在其中的角色）。
 * 另外后端**没有**按登录用户强制过滤空间列表，所以 userId 必须前端自己传。
 */
export function useMySpaces() {
  const spaces = ref<MySpaceOption[]>([])
  const loading = ref(false)
  const error = ref('')

  async function load(myUserId?: string | number) {
    const uid = myUserId != null && String(myUserId) !== '' ? String(myUserId) : ''
    const out: MySpaceOption[] = []
    loading.value = true
    error.value = ''
    try {
      if (uid) {
        try {
          const res = await listSpaceVoByPageUsingPost({
            userId: uid as unknown as number,
            current: 1,
            pageSize: 20,
          })
          for (const s of res.data?.records ?? []) {
            if (!s.id) continue
            out.push({
              id: String(s.id),
              name: s.spaceName || `空间 ${s.id}`,
              isTeam: s.spaceType === 1,
              isMine: true,
              role: 'admin',
            })
          }
        } catch {
          /* 单个来源失败不影响另一个 */
        }
      }
      try {
        const res = await listMyTeamSpaceUsingPost()
        for (const su of res.data ?? []) {
          const id = su.spaceId ? String(su.spaceId) : ''
          if (!id || out.some((o) => o.id === id)) continue
          out.push({
            id,
            name: su.space?.spaceName || `空间 ${id}`,
            isTeam: true,
            isMine: false,
            role: su.spaceRole || 'viewer',
          })
        }
      } catch {
        /* 忽略 */
      }
      spaces.value = out
    } finally {
      loading.value = false
    }
  }

  return { spaces, loading, error, load }
}

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NInput, NModal, NSelect, useDialog, useMessage, type SelectOption } from 'naive-ui'
import {
  addSpaceUserUsingPost,
  deleteSpaceUserUsingPost,
  editSpaceUserUsingPost,
  listSpaceUserUsingPost,
} from '@/api/spaceUserController'
import { getSpaceVoByIdUsingGet } from '@/api/spaceController'
import { isSelf } from '@/auth/permissions'
import { clearSpacePermsCache } from '@/composables/useSpacePerms'
import { useLoginUserStore } from '@/stores/useLoginUserStore'
import { formatTime } from '@/utils/format'

/**
 * 空间成员管理（团队空间「共同编辑」的入口）。
 *
 * 之前这套功能只存在于管理台 `/admin/spaces`，而管理台是**管理员专属路由** ——
 * 于是普通用户里的「团队空间创建者」明明有 spaceUser:manage 权限，却没有任何入口，
 * 只能让系统管理员代他加人。这个组件就是把它挪到普通用户能到的地方。
 *
 * 权限不靠前端猜：打开时先读 `/space/get/vo` 的 permissionList，
 * 看后端算出来的结果里有没有 `spaceUser:manage`。
 *   · 私有空间 → 空间创建者本人 / 系统管理员有
 *   · 团队空间 → 只有 `space_user` 里角色为 admin 的人有（**系统管理员不在该团队也没有**）
 */

const props = defineProps<{
  show: boolean
  spaceId?: string | number
  spaceName?: string
}>()

const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  /** 成员或角色变化后通知外层（外层可刷新空间列表/清缓存） */
  (e: 'changed'): void
}>()

const message = useMessage()
const dialog = useDialog()
const loginUserStore = useLoginUserStore()

const visible = computed({
  get: () => props.show,
  set: (v: boolean) => emit('update:show', v),
})

const ROLE_OPTIONS: SelectOption[] = [
  { label: '浏览者 · 只能看', value: 'viewer' },
  { label: '编辑者 · 可上传/编辑/删除', value: 'editor' },
  { label: '管理员 · 再含成员管理', value: 'admin' },
]
const roleText = (r?: string) => (r === 'admin' ? '管理员' : r === 'editor' ? '编辑者' : '浏览者')

const loading = ref(false)
const perms = ref<string[] | null>(null)
const canManage = computed(() => Boolean(perms.value?.includes('spaceUser:manage')))

const members = ref<API.SpaceUserVO[]>([])
const errorMsg = ref('')

const newUserId = ref('')
const newRole = ref('viewer')
const adding = ref(false)

/** 拉权限 + 成员列表。先查权限，没权限就不必去撞 spaceUser/list 的 403 */
async function loadAll() {
  const id = props.spaceId
  if (id == null || String(id) === '') return
  loading.value = true
  errorMsg.value = ''
  members.value = []
  try {
    const vo = await getSpaceVoByIdUsingGet({ id: String(id) as unknown as number })
    perms.value = vo.data?.permissionList ?? []
  } catch (e) {
    perms.value = []
    errorMsg.value = (e as Error).message || '无法读取空间权限'
    loading.value = false
    return
  }
  if (!canManage.value) {
    loading.value = false
    return
  }
  try {
    const res = await listSpaceUserUsingPost({ spaceId: String(id) as unknown as number })
    members.value = res.data ?? []
  } catch (e) {
    errorMsg.value = (e as Error).message || '无法加载成员列表'
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.show, props.spaceId] as const,
  ([show]) => {
    if (show) {
      newUserId.value = ''
      newRole.value = 'viewer'
      void loadAll()
    }
  },
  { immediate: true },
)

async function addMember() {
  const uid = newUserId.value.trim()
  if (!/^\d+$/.test(uid)) {
    message.warning('请填写对方的用户 ID（纯数字）')
    return
  }
  /*
    后端 `SpaceUserServiceImpl#validSpaceUser` 只校验了「用户存在 / 空间存在 / 角色合法」，
    **没有查重** —— 同一个人可以被重复添加，产生两条 space_user 记录（权限按哪条算取决于查询）。
    这是后端缺的一道校验，前端能挡就先挡住。
  */
  if (members.value.some((m) => String(m.userId) === uid)) {
    message.warning('该用户已经是这个空间的成员了')
    return
  }
  adding.value = true
  try {
    await addSpaceUserUsingPost({
      spaceId: String(props.spaceId) as unknown as number,
      userId: uid as unknown as number,
      spaceRole: newRole.value,
    })
    message.success('已加入空间')
    newUserId.value = ''
    await afterChange()
  } catch (e) {
    message.error((e as Error).message || '添加失败')
  } finally {
    adding.value = false
  }
}

async function changeRole(m: API.SpaceUserVO, role: string) {
  if (m.spaceRole === role) return
  try {
    await editSpaceUserUsingPost({ id: String(m.id) as unknown as number, spaceRole: role })
    message.success(`已改为${roleText(role)}`)
    await afterChange()
  } catch (e) {
    message.error((e as Error).message || '修改失败')
  }
}

function removeMember(m: API.SpaceUserVO) {
  const who = m.user?.userName || m.user?.userAccount || `用户 ${m.userId}`
  const isMe = isSelf(loginUserStore.loginUser, m.userId)
  dialog.warning({
    title: '移除成员',
    content: isMe
      ? `你正在把自己移出「${props.spaceName || '该空间'}」。移除后将立刻失去该空间的所有权限（包括成员管理）。`
      : `确定把「${who}」移出该空间？`,
    positiveText: '移除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await deleteSpaceUserUsingPost({ id: String(m.id) as unknown as number })
        message.success('已移除')
        await afterChange()
      } catch (e) {
        message.error((e as Error).message || '移除失败')
      }
    },
  })
}

async function afterChange() {
  // 角色变了，本会话里缓存的空间权限就过期了 —— 清掉，下次判断会重新问后端
  clearSpacePermsCache(props.spaceId)
  await loadAll()
  emit('changed')
}
</script>

<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    :title="`成员 · ${spaceName || '空间'}`"
    style="width: min(620px, 94vw)"
    :bordered="false"
  >
    <div v-if="loading" class="mm__state">加载中…</div>

    <div v-else-if="!canManage" class="mm__state mm__state--warn">
      <b>你没有这个空间的成员管理权限</b>
      <p>
        成员管理只对这些身份开放：
        <br />· <b>私有空间</b> → 仅空间创建者本人或系统管理员；
        <br />· <b>团队空间</b> → 仅该团队里角色为<b>管理员</b>的成员（系统管理员若不在团队里也没有）。
      </p>
      <p>需要加人/改角色？请联系空间创建者或管理员。</p>
    </div>

    <template v-else>
      <div v-if="errorMsg" class="mm__state mm__state--warn">{{ errorMsg }}</div>

      <!-- 添加成员 -->
      <div class="mm__add">
        <n-input
          v-model:value="newUserId"
          placeholder="对方的用户 ID"
          size="small"
          :input-props="{ inputmode: 'numeric' }"
        />
        <n-select v-model:value="newRole" :options="ROLE_OPTIONS" size="small" class="mm__role" />
        <button class="primary-btn" :disabled="adding" @click="addMember">
          {{ adding ? '添加中…' : '添加' }}
        </button>
      </div>
      <!--
        这是后端能力的真实限制，必须写在界面上：
        `/user/list/page/vo` 只有管理员能调，普通用户没有「按昵称搜人」的接口。
        所以只能手输 userId —— 不写清楚的话，用户会以为这是个坏掉的搜索框。
      -->
      <div class="mm__tip">
        只能按<b>用户 ID</b>加人：目前还没有「按昵称搜人」的功能，非管理员也看不到用户列表。
        请让对方在「个人设置」里查看自己的 ID 后告诉你。
      </div>

      <div class="mm__list">
        <div v-for="m in members" :key="m.id" class="mm__row">
          <img v-if="m.user?.userAvatar" class="mm__av" :src="m.user.userAvatar" alt="" />
          <div v-else class="mm__av mm__av--ph">
            {{ (m.user?.userName || m.user?.userAccount || '?').slice(0, 1) }}
          </div>

          <div class="mm__who">
            <div class="mm__name">
              {{ m.user?.userName || m.user?.userAccount || `用户 ${m.userId}` }}
              <span v-if="isSelf(loginUserStore.loginUser, m.userId)" class="mm__me">我</span>
            </div>
            <div class="mm__sub">
              ID {{ m.userId }} · 加入于 {{ formatTime(m.createTime) }}
            </div>
          </div>

          <n-select
            :value="m.spaceRole"
            :options="ROLE_OPTIONS"
            size="small"
            class="mm__role-sel"
            @update:value="(v: string) => changeRole(m, v)"
          />
          <button class="mini mini--danger" @click="removeMember(m)">移除</button>
        </div>

        <div v-if="!members.length" class="mm__empty">还没有其他成员，用上面的输入框加人</div>
      </div>

      <div class="mm__foot">
        各角色能做的事（固定规则）：
        浏览者只能查看；编辑者可以上传、编辑、删除<b>包括别人上传的</b>图片（共同编辑）；
        管理员另外可以管理成员。角色变更后，对方刷新页面即可生效。
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.mm__state {
  padding: 18px 4px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.9;
}
.mm__state--warn {
  color: var(--text-primary);
  background: var(--bg-inset, rgba(240, 160, 60, 0.08));
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 14px 16px;
}
.mm__state--warn p {
  margin: 8px 0 0;
  line-height: 1.9;
}
.mm__add {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.mm__add :deep(.n-input) {
  flex: 1;
  min-width: 150px;
}
.mm__role {
  width: 190px;
}
.mm__tip {
  margin-top: 8px;
  font-size: 11px;
  line-height: 1.8;
  color: var(--text-tertiary);
}
.mm__list {
  margin-top: 14px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  overflow: hidden;
}
.mm__row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}
.mm__row:last-child {
  border-bottom: none;
}
.mm__av {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  object-fit: cover;
  flex: none;
}
.mm__av--ph {
  display: grid;
  place-items: center;
  background: var(--bg-inset);
  color: var(--text-secondary);
  font-size: 12px;
}
.mm__who {
  flex: 1;
  min-width: 0;
}
.mm__name {
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mm__me {
  margin-left: 6px;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--bg-inset);
  color: var(--text-tertiary);
}
.mm__sub {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 2px;
}
.mm__role-sel {
  width: 190px;
  flex: none;
}
.mm__empty {
  padding: 18px;
  text-align: center;
  font-size: 12px;
  color: var(--text-tertiary);
}
.mm__foot {
  margin-top: 12px;
  font-size: 11px;
  line-height: 1.8;
  color: var(--text-tertiary);
}
.mini {
  flex: none;
}
@media (max-width: 560px) {
  .mm__role,
  .mm__role-sel {
    width: 100%;
  }
  .mm__row {
    flex-wrap: wrap;
  }
}
</style>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  NButton,
  NInput,
  NModal,
  NRadioButton,
  NRadioGroup,
  NSelect,
  useDialog,
  useMessage,
  type SelectOption,
} from 'naive-ui'
import {
  addSpaceUsingPost,
  deleteSpaceUsingPost,
  editSpaceUsingPost,
  listSpaceLevelUsingGet,
  listSpaceVoByPageUsingPost,
} from '@/api/spaceController'
import { listMyTeamSpaceUsingPost } from '@/api/spaceUserController'
import SpaceMembersModal from '@/components/space/SpaceMembersModal.vue'
import { useLoginUserStore } from '@/stores/useLoginUserStore'
import {
  canEditSpaceQuota,
  canManageSpaceMembers,
  canUseSpaceLevel,
  isAdmin as isAdminUser,
} from '@/auth/permissions'
import { charLen, formatSize, formatTime } from '@/utils/format'

const dialog = useDialog()
const message = useMessage()
const loginUserStore = useLoginUserStore()
const isAdmin = computed(() => isAdminUser(loginUserStore.loginUser))

/* ============================ 成员管理 ============================
   团队空间「共同编辑」的入口。
   以前这块只在管理台（管理员专属路由），普通用户里的团队创建者反而没有入口。
   ================================================================ */
const showMembers = ref(false)
const memberSpaceId = ref<string>('')
const memberSpaceName = ref('')

function openMembers(id?: string | number, name?: string) {
  if (id == null) return
  memberSpaceId.value = String(id)
  memberSpaceName.value = name || ''
  showMembers.value = true
}

/**
 * 我创建的空间能否管成员。
 * ⚠️ 必须限定团队空间：私有空间的创建者虽然也拿到 spaceUser:manage（本人=ADMIN 全集），
 * 但私有空间没有"成员"概念 —— 加了人也看不到图，按钮只会误导。
 */
const canManageMine = (s: API.SpaceVO) =>
  s.spaceType === 1 &&
  canManageSpaceMembers(
    loginUserStore.loginUser,
    { id: s.id, userId: s.userId, spaceType: s.spaceType },
    'admin',
  )

/** 我加入的团队空间：只有角色为 admin 的成员能管 */
const canManageJoined = (su: API.SpaceUserVO) =>
  canManageSpaceMembers(loginUserStore.loginUser, { spaceType: 1 }, su.spaceRole)

/** 我创建的空间 */
const mySpaces = ref<API.SpaceVO[]>([])
/** 我加入的团队空间：附带我在该空间的角色（后端 listMyTeamSpace 直接返回） */
const joined = ref<API.SpaceUserVO[]>([])
const levels = ref<API.SpaceLevel[]>([])
const loading = ref(false)

/** spaceName 列是 varchar(128)，前端按真实列长限制 */
const NAME_MAX = 128

const levelText = (v?: number) => levels.value.find((l) => l.value === v)?.text ?? `等级 ${v ?? '?'}`
const typeText = (v?: number) => (v === 1 ? '团队' : '私有')

/*
  后端规则（SpaceServiceImpl#addSpace）：同一用户「每类空间只能创建一个」，
  按 spaceType（0 私有 / 1 团队）判重，重复创建会直接返回
  「每个用户每类空间只能创建一个」。所以前端要按已占用的类型把选择锁掉，
  否则用户填完名字才被拒。
*/
const takenTypes = computed(() => new Set(mySpaces.value.map((s) => s.spaceType ?? 0)))
const freeTypes = computed(() => [0, 1].filter((t) => !takenTypes.value.has(t)))
const canCreate = computed(() => freeTypes.value.length > 0)
const hasTeamSpace = computed(() => takenTypes.value.has(1))

/*
  页头只留一句轻提示；「两类都已创建」这种限制说明不常驻在页面上，
  改成用户真的点了「新建空间」时才解释 —— 常驻红字会一直占着视线，
  而且大部分时间用户并不想建空间。
*/
const createHint = computed(() => {
  if (!canCreate.value) return ''
  const t = freeTypes.value[0]
  return `还可以创建一个「${t === 1 ? '团队' : '私有'}」空间`
})

const levelOptions = computed<SelectOption[]>(() =>
  levels.value.map((l) => ({
    label: `${l.text}（${l.maxCount} 张 / ${formatSize(l.maxSize)}）`,
    value: l.value,
    // 非管理员只能创建普通版（后端 addSpace 会直接拒绝，这里前移成不可选）
    disabled: !canUseSpaceLevel(loginUserStore.loginUser, l.value),
  })),
)

async function load() {
  loading.value = true
  try {
    const myId = loginUserStore.loginUser?.id
    const [mineRes, levelsRes] = await Promise.all([
      myId
        ? listSpaceVoByPageUsingPost({
            userId: String(myId) as unknown as number,
            current: 1,
            pageSize: 20,
          })
        : Promise.resolve(null),
      listSpaceLevelUsingGet(),
    ])
    mySpaces.value = mineRes?.data?.records ?? []
    levels.value = levelsRes.data ?? []

    try {
      const joinedRes = await listMyTeamSpaceUsingPost()
      // 过滤掉自己创建的空间，避免和上面一组重复展示
      const myIds = new Set(mySpaces.value.map((s) => String(s.id)))
      joined.value = (joinedRes.data ?? []).filter((su) => !myIds.has(String(su.spaceId)))
    } catch {
      joined.value = []
    }
  } catch (e) {
    message.error((e as Error).message || '加载失败')
  } finally {
    loading.value = false
  }
}

/* ---------- 新建 / 编辑 ---------- */
const showModal = ref(false)
const editingId = ref<string>('')
const form = ref({ spaceName: '', spaceLevel: 0, spaceType: 0 })
const submitting = ref(false)

const nameLen = computed(() => charLen(form.value.spaceName))
const nameError = computed(() =>
  nameLen.value === 0
    ? '空间名称不能为空'
    : nameLen.value > NAME_MAX
      ? `名称最多 ${NAME_MAX} 字，当前 ${nameLen.value}`
      : '',
)
const canSubmit = computed(() => !nameError.value && !submitting.value)
const isEdit = computed(() => !!editingId.value)
const pickedLevel = computed(() => levels.value.find((l) => l.value === form.value.spaceLevel))

function openCreate() {
  // 两类空间都已占满：后端 addSpace 会直接拒绝，所以先把原因讲清楚，
  // 而不是给一个灰按钮让人猜「为什么点不了」。
  if (!canCreate.value) {
    dialog.warning({
      title: '不能再新建空间了',
      content:
        '每个账号「私有」「团队」各只能创建一个空间，你的两类空间都已创建。' +
        '如需更多空间，可以删除现有的同类空间后再建，或联系管理员协助处理。',
      positiveText: '知道了',
    })
    return
  }
  editingId.value = ''
  // 默认选还没被占用的那个类型
  form.value = { spaceName: '', spaceLevel: 0, spaceType: freeTypes.value[0] ?? 0 }
  showModal.value = true
}

function openEdit(space: API.SpaceVO) {
  editingId.value = String(space.id)
  form.value = {
    spaceName: space.spaceName ?? '',
    spaceLevel: space.spaceLevel ?? 0,
    spaceType: space.spaceType ?? 0,
  }
  showModal.value = true
}

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    if (isEdit.value) {
      // 用户侧只能改名（SpaceEditRequest 只有 id + spaceName）
      await editSpaceUsingPost({
        id: editingId.value as unknown as number,
        spaceName: form.value.spaceName.trim(),
      })
      message.success('已保存')
    } else {
      await addSpaceUsingPost({
        spaceName: form.value.spaceName.trim(),
        spaceLevel: form.value.spaceLevel,
        spaceType: form.value.spaceType,
      })
      message.success('空间已创建')
    }
    showModal.value = false
    await load()
  } catch (e) {
    message.error((e as Error).message || '操作失败')
  } finally {
    submitting.value = false
  }
}

/* ---------- 删除 ---------- */
function confirmDelete(space: API.SpaceVO) {
  dialog.warning({
    title: '删除空间',
    content: `确定删除「${space.spaceName || '未命名'}」吗？该操作不可恢复。若空间内仍有图片，请先清空。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await deleteSpaceUsingPost({ id: String(space.id) as unknown as number })
        message.success('已删除')
        await load()
      } catch (e) {
        message.error((e as Error).message || '删除失败')
      }
    },
  })
}

function pct(used?: number | string, max?: number | string) {
  const u = Number(used ?? 0)
  const m = Number(max ?? 0)
  if (!m) return 0
  return Math.min(100, (u / m) * 100)
}

onMounted(async () => {
  if (!loginUserStore.fetched) await loginUserStore.fetchLoginUser()
  await load()
})
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <h2>我的空间</h2>
      <div class="toolbar__right">
        <span v-if="createHint" class="rule-hint">{{ createHint }}</span>
        <button class="primary-btn" @click="openCreate">新建空间</button>
      </div>
    </div>

    <!-- 我创建的 -->
    <section class="group">
      <div class="group__h">
        我创建的空间
        <span class="group__c">{{ mySpaces.length }}</span>
      </div>

      <div v-if="!mySpaces.length && !loading" class="empty">还没有空间，点右上角「新建空间」创建一个</div>

      <div class="cards">
        <article v-for="s in mySpaces" :key="s.id" class="scard">
          <header class="scard__h">
            <RouterLink class="scard__n ellipsis" :to="`/s/${s.id}`">{{ s.spaceName || '未命名' }}</RouterLink>
            <span class="badge">{{ typeText(s.spaceType) }}</span>
            <span class="badge badge--lv">{{ levelText(s.spaceLevel) }}</span>
          </header>

          <div class="quotas">
            <div class="quota">
              <div class="quota__l">
                <span>图片</span>
                <b>{{ s.totalCount ?? 0 }} / {{ s.maxCount ?? 0 }}</b>
              </div>
              <div class="bar"><i :style="{ width: pct(s.totalCount, s.maxCount) + '%' }" /></div>
            </div>
            <div class="quota">
              <div class="quota__l">
                <span>容量</span>
                <b>{{ formatSize(s.totalSize) }} / {{ formatSize(s.maxSize) }}</b>
              </div>
              <div class="bar"><i :style="{ width: pct(s.totalSize, s.maxSize) + '%' }" /></div>
            </div>
          </div>

          <footer class="scard__f">
            <span class="scard__t">{{ formatTime(s.createTime) }}</span>
            <RouterLink class="mini" :to="`/s/${s.id}`">进入</RouterLink>
            <button v-if="canManageMine(s)" class="mini" @click="openMembers(s.id, s.spaceName)">成员</button>
            <button class="mini" @click="openEdit(s)">改名</button>
            <button class="mini mini--danger" @click="confirmDelete(s)">删除</button>
          </footer>
        </article>
      </div>
    </section>

    <!-- 我加入的团队空间 -->
    <section v-if="joined.length" class="group">
      <div class="group__h">
        我加入的团队空间
        <span class="group__c">{{ joined.length }}</span>
      </div>
      <div class="cards">
        <article v-for="su in joined" :key="su.id" class="scard">
          <header class="scard__h">
            <RouterLink class="scard__n ellipsis" :to="`/s/${su.spaceId}`">
              {{ su.space?.spaceName || `空间 ${su.spaceId}` }}
            </RouterLink>
            <span class="badge">团队</span>
            <span class="badge badge--role">
              我是{{ su.spaceRole === 'admin' ? '管理员' : su.spaceRole === 'editor' ? '编辑者' : '浏览者' }}
            </span>
          </header>

          <div class="quotas">
            <div class="quota">
              <div class="quota__l">
                <span>图片</span>
                <b>{{ su.space?.totalCount ?? 0 }} / {{ su.space?.maxCount ?? 0 }}</b>
              </div>
              <div class="bar"><i :style="{ width: pct(su.space?.totalCount, su.space?.maxCount) + '%' }" /></div>
            </div>
            <div class="quota">
              <div class="quota__l">
                <span>容量</span>
                <b>{{ formatSize(su.space?.totalSize) }} / {{ formatSize(su.space?.maxSize) }}</b>
              </div>
              <div class="bar"><i :style="{ width: pct(su.space?.totalSize, su.space?.maxSize) + '%' }" /></div>
            </div>
          </div>

          <footer class="scard__f">
            <span class="scard__t">{{ formatTime(su.createTime) }}</span>
            <RouterLink class="mini" :to="`/s/${su.spaceId}`">进入</RouterLink>
            <button
              v-if="canManageJoined(su)"
              class="mini"
              @click="openMembers(su.spaceId, su.space?.spaceName)"
            >
              成员
            </button>
          </footer>
        </article>
      </div>
    </section>

    <!-- 新建 / 改名 -->
    <n-modal
      v-model:show="showModal"
      preset="card"
      :title="isEdit ? '修改空间名称' : '新建空间'"
      class="space-modal"
      :bordered="false"
      :mask-closable="!submitting"
    >
      <div class="fld">
        <label>
          空间名称
          <span class="cnt" :class="{ bad: !!nameError }">{{ nameLen }} / {{ NAME_MAX }}</span>
        </label>
        <n-input v-model:value="form.spaceName" size="small" placeholder="例如：项目素材库" />
        <div v-if="nameError" class="err">{{ nameError }}</div>
      </div>

      <template v-if="!isEdit">
        <div class="fld">
          <label>空间等级</label>
          <n-select v-model:value="form.spaceLevel" :options="levelOptions" size="small" />
          <div v-if="!isAdmin" class="hint">
            非管理员只能创建<b>普通版</b>空间，需要更大配额请联系管理员。
          </div>
        </div>

        <div class="fld">
          <label>空间类型</label>
          <n-radio-group v-model:value="form.spaceType" size="small">
            <n-radio-button :value="0" :disabled="takenTypes.has(0)">私有</n-radio-button>
            <n-radio-button :value="1" :disabled="takenTypes.has(1)">团队</n-radio-button>
          </n-radio-group>
          <div class="hint">
            私有空间只有你自己（和管理员）可见；团队空间需要加成员后才能协作。
            <br />
            <b>每类空间只能创建一个</b>（已占用的类型不可选）。
            <template v-if="hasTeamSpace">
              <br />
              提示：团队空间创建时会自动把你加为管理员。
            </template>
          </div>
        </div>
      </template>

      <div v-else class="hint">
        等级与配额不可自助修改（这里只开放改名）。
        <template v-if="!canEditSpaceQuota(loginUserStore.loginUser)">
          需要更大配额请联系管理员。
        </template>
        <template v-else>
          你可以到 <b>管理台 → 空间管理</b> 里调整任意空间的等级与配额。
        </template>
      </div>

      <template #footer>
        <div class="foot">
          <n-button size="small" :disabled="submitting" @click="showModal = false">取消</n-button>
          <n-button size="small" type="primary" :disabled="!canSubmit" @click="submit">
            {{ submitting ? '提交中…' : isEdit ? '保存' : '创建' }}
          </n-button>
        </div>
      </template>
    </n-modal>

    <SpaceMembersModal
      v-model:show="showMembers"
      :space-id="memberSpaceId"
      :space-name="memberSpaceName"
      @changed="load"
    />
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  margin-bottom: 18px;
}
.toolbar h2 {
  margin: 0;
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.toolbar__right {
  margin-left: auto;
  display: flex;
  align-items: center;
}

.group {
  margin-bottom: 26px;
}
.group__h {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text-secondary);
  margin-bottom: 12px;
}
.group__c {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 99px;
  background: var(--accent-soft);
  color: var(--accent);
}
.empty {
  padding: 26px;
  text-align: center;
  font-size: 13px;
  color: var(--text-tertiary);
  border: 1px dashed var(--border-strong);
  border-radius: var(--r-md);
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
}
.scard {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 14px 16px 12px;
  box-shadow: var(--shadow-card);
}
.scard__h {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}
.scard__n {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--text-primary);
  min-width: 0;
  flex: 0 1 auto;
}
.scard__n:hover {
  color: var(--accent);
}
.badge {
  font-size: 10.5px;
  padding: 2px 7px;
  border-radius: 99px;
  border: 1px solid var(--border-strong);
  color: var(--text-secondary);
  flex: 0 0 auto;
}
.badge--lv {
  background: var(--accent-soft);
  border-color: transparent;
  color: var(--accent);
}
.badge--role {
  background: rgba(53, 208, 186, 0.14);
  border-color: transparent;
  color: var(--success);
}

.quotas {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.quota__l {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 5px;
}
.quota__l b {
  color: var(--text-primary);
  font-weight: 600;
}
.bar {
  height: 5px;
  border-radius: 99px;
  background: var(--accent-soft);
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  border-radius: 99px;
  background: var(--accent);
}

.scard__f {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
  padding-top: 11px;
  border-top: 1px solid var(--border);
  /* 按钮从 3 个变成 4 个（多了「成员」）后会挤到换行，允许折行避免文字被压成竖排 */
  flex-wrap: wrap;
}
.scard__t {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-right: auto;
}
.mini {
  font-family: var(--font);
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  /* 卡片变窄时不要把「进入」压成两行 */
  white-space: nowrap;
  flex: none;
}
.mini:hover {
  color: var(--text-primary);
  border-color: var(--border-strong);
}
.mini--danger {
  color: var(--danger);
}
.mini--danger:hover {
  border-color: var(--danger);
}

.rule-hint {
  font-size: 11.5px;
  color: var(--text-tertiary);
  margin-right: 12px;
}
.primary-btn {
  height: 36px;
  padding: 0 18px;
  border-radius: 9px;
  border: 0;
  background: var(--accent);
  color: #fff;
  font-family: var(--font);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: 0 6px 16px -6px rgba(85, 99, 224, 0.55);
}
.primary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
}

.fld {
  margin-bottom: 16px;
}
.fld label {
  display: flex;
  align-items: center;
  font-size: 12.5px;
  color: var(--text-secondary);
  margin-bottom: 6px;
}
.cnt {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-tertiary);
}
.cnt.bad {
  color: var(--danger);
}
.err {
  margin-top: 5px;
  font-size: 11.5px;
  color: var(--danger);
}
.hint {
  margin-top: 7px;
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--text-tertiary);
}
.hint b {
  color: var(--text-secondary);
}
.foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>

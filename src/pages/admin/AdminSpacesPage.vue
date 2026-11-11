<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NButton, NInput, NInputNumber, NModal, NSelect, useDialog, useMessage, type SelectOption } from 'naive-ui'
import {
  deleteSpaceUsingPost,
  listSpaceByPageUsingPost,
  listSpaceLevelUsingGet,
  updateSpaceUsingPost,
} from '@/api/spaceController'
import {
  addSpaceUserUsingPost,
  deleteSpaceUserUsingPost,
  editSpaceUserUsingPost,
  listSpaceUserUsingPost,
} from '@/api/spaceUserController'
import PageBar from '@/components/ui/PageBar.vue'
import { formatSize, formatTime } from '@/utils/format'
import AdminNav from '@/components/admin/AdminNav.vue'

const dialog = useDialog()
const message = useMessage()

/* ============================ 空间列表 ============================ */
const rows = ref<API.Space[]>([])
const total = ref(0)
const current = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const errorMsg = ref('')

const filters = ref({ spaceName: '', spaceType: '' as '' | 0 | 1, spaceLevel: '' as '' | 0 | 1 | 2 })

const TYPE_OPTIONS: SelectOption[] = [
  { label: '全部类型', value: '' },
  { label: '私有', value: 0 },
  { label: '团队', value: 1 },
]

const levels = ref<API.SpaceLevel[]>([])
const levelOptions = computed<SelectOption[]>(() =>
  levels.value.map((l) => ({ label: `${l.text}（${l.maxCount} 张 / ${formatSize(l.maxSize)}）`, value: l.value })),
)
const levelText = (v?: number) => levels.value.find((l) => l.value === v)?.text ?? `等级 ${v ?? '?'}`

async function load(page = current.value) {
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await listSpaceByPageUsingPost({
      current: page,
      pageSize: pageSize.value,
      sortField: 'createTime',
      sortOrder: 'descend',
      ...(filters.value.spaceName.trim() ? { spaceName: filters.value.spaceName.trim() } : {}),
      ...(filters.value.spaceType === '' ? {} : { spaceType: filters.value.spaceType }),
      ...(filters.value.spaceLevel === '' ? {} : { spaceLevel: filters.value.spaceLevel }),
    })
    rows.value = res.data?.records ?? []
    total.value = Number(res.data?.total ?? 0)
    current.value = page
  } catch (e) {
    errorMsg.value = (e as Error).message || '加载失败'
  } finally {
    loading.value = false
  }
}

function search() {
  load(1)
}
function resetFilters() {
  filters.value = { spaceName: '', spaceType: '', spaceLevel: '' }
  load(1)
}

/* ============================ 编辑空间 ============================ */
/*
  后端：/space/update 仅管理员可用，controller 里直接 updateById，
  配合 fillSpaceBySpaceLevel（只在该字段为 null 时才用等级默认值）。
  => 改了等级但没显式给配额时，配额会被重置成该等级的默认值；
     显式填了配额则以填写的为准。这里用「改等级自动带出默认配额」来对齐这个行为。
*/
const showEdit = ref(false)
const editForm = ref({ id: '', spaceName: '', spaceLevel: 0, maxCount: 100, maxSize: 104857600 })
const editing = ref(false)

function openEdit(row: API.Space) {
  editForm.value = {
    id: String(row.id),
    spaceName: row.spaceName ?? '',
    spaceLevel: row.spaceLevel ?? 0,
    maxCount: Number(row.maxCount ?? 0),
    maxSize: Number(row.maxSize ?? 0),
  }
  showEdit.value = true
}

function onLevelChange(v: number) {
  const lv = levels.value.find((l) => l.value === v)
  if (!lv) return
  // 与后端“等级默认值”保持一致
  editForm.value.maxCount = Number(lv.maxCount ?? 0)
  editForm.value.maxSize = Number(lv.maxSize ?? 0)
}

async function submitEdit() {
  editing.value = true
  try {
    await updateSpaceUsingPost({
      id: editForm.value.id as unknown as number,
      spaceName: editForm.value.spaceName.trim(),
      spaceLevel: editForm.value.spaceLevel,
      maxCount: editForm.value.maxCount,
      maxSize: editForm.value.maxSize,
    })
    message.success('已保存')
    showEdit.value = false
    await load()
  } catch (e) {
    message.error((e as Error).message || '保存失败')
  } finally {
    editing.value = false
  }
}

function confirmDelete(row: API.Space) {
  dialog.error({
    title: '删除空间',
    content: `确定删除「${row.spaceName || '未命名'}」？该操作不可恢复（空间内图片不会被自动删除）。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await deleteSpaceUsingPost({ id: String(row.id) as unknown as number })
        message.success('已删除')
        await load()
      } catch (e) {
        message.error((e as Error).message || '删除失败')
      }
    },
  })
}

/* ============================ 成员管理 ============================
   spaceUser/* 全部需要 spaceUser:manage 权限，它由后端按「当前用户在该空间里的角色」算：
     · 私有空间 → 本人或系统管理员 = 管理员权限
     · 团队空间 → 查 space_user，不是成员就没有任何权限（系统管理员也一样）
   所以别人的团队空间点进来可能会 403，这里直接把后端的报错显示出来。
   ================================================================= */
const showMembers = ref(false)
const memberSpace = ref<API.Space | null>(null)
const members = ref<API.SpaceUserVO[]>([])
const membersLoading = ref(false)
const membersError = ref('')

const ROLE_OPTIONS: SelectOption[] = [
  { label: '浏览者（只能看）', value: 'viewer' },
  { label: '编辑者（可传可改可删）', value: 'editor' },
  { label: '管理员（含成员管理）', value: 'admin' },
]
const roleText = (r?: string) => (r === 'admin' ? '管理员' : r === 'editor' ? '编辑者' : '浏览者')

const newMember = ref({ userId: '', spaceRole: 'viewer' })
const adding = ref(false)

async function openMembers(row: API.Space) {
  memberSpace.value = row
  showMembers.value = true
  members.value = []
  membersError.value = ''
  newMember.value = { userId: '', spaceRole: 'viewer' }
  await loadMembers()
}

async function loadMembers() {
  if (!memberSpace.value?.id) return
  membersLoading.value = true
  membersError.value = ''
  try {
    const res = await listSpaceUserUsingPost({
      spaceId: String(memberSpace.value.id) as unknown as number,
    })
    members.value = res.data ?? []
  } catch (e) {
    membersError.value = (e as Error).message || '无法加载成员（可能没有成员管理权限）'
  } finally {
    membersLoading.value = false
  }
}

async function addMember() {
  const uid = newMember.value.userId.trim()
  if (!uid) {
    message.warning('请输入用户 ID')
    return
  }
  adding.value = true
  try {
    await addSpaceUserUsingPost({
      spaceId: String(memberSpace.value?.id) as unknown as number,
      userId: uid as unknown as number,
      spaceRole: newMember.value.spaceRole,
    })
    message.success('已添加')
    newMember.value = { userId: '', spaceRole: 'viewer' }
    await loadMembers()
  } catch (e) {
    message.error((e as Error).message || '添加失败')
  } finally {
    adding.value = false
  }
}

async function changeMemberRole(m: API.SpaceUserVO, role: string) {
  try {
    await editSpaceUserUsingPost({ id: String(m.id) as unknown as number, spaceRole: role })
    message.success('已更新角色')
    await loadMembers()
  } catch (e) {
    message.error((e as Error).message || '更新失败')
  }
}

function removeMember(m: API.SpaceUserVO) {
  dialog.warning({
    title: '移除成员',
    content: `确定把「${m.user?.userName || m.user?.userAccount || m.userId}」移出该空间？`,
    positiveText: '移除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await deleteSpaceUserUsingPost({ id: String(m.id) as unknown as number })
        message.success('已移除')
        await loadMembers()
      } catch (e) {
        message.error((e as Error).message || '移除失败')
      }
    },
  })
}

onMounted(async () => {
  try {
    const res = await listSpaceLevelUsingGet()
    levels.value = res.data ?? []
  } catch {
    /* 等级拉不到不影响列表 */
  }
  load(1)
})
</script>

<template>
  <div class="page">
    <AdminNav />
    <div class="toolbar">
      <h2>空间管理</h2>
      <div class="pill">共 {{ total }} 个</div>
      <div class="toolbar__right">
        <button class="ghost-btn" @click="resetFilters">重置筛选</button>
        <button class="primary-btn" :disabled="loading" @click="search">查询</button>
      </div>
    </div>

    <section class="filters">
      <div class="fld">
        <label>空间名称</label>
        <n-input v-model:value="filters.spaceName" size="small" placeholder="输入空间名称" @keyup.enter="search" />
      </div>
      <div class="fld fld--sm">
        <label>类型</label>
        <n-select v-model:value="filters.spaceType" :options="TYPE_OPTIONS" size="small" />
      </div>
      <div class="fld fld--sm">
        <label>等级</label>
        <n-select
          v-model:value="filters.spaceLevel"
          :options="[{ label: '全部等级', value: '' }, ...levelOptions]"
          size="small"
        />
      </div>
    </section>

    <div v-if="errorMsg" class="notice notice--err">{{ errorMsg }}</div>

    <div class="tbl-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th>空间名称 / ID</th>
            <th style="width: 150px">归属用户</th>
            <th style="width: 90px">类型</th>
            <th style="width: 100px">等级</th>
            <th style="width: 210px">配额用量</th>
            <th style="width: 130px">创建时间</th>
            <th style="width: 200px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="7" class="tbl__empty">加载中…</td>
          </tr>
          <tr v-else-if="!rows.length">
            <td colspan="7" class="tbl__empty">没有符合条件的空间</td>
          </tr>
          <template v-else>
            <tr v-for="row in rows" :key="row.id">
              <td>
                <div class="nm">{{ row.spaceName || '未命名' }}</div>
                <div class="sub">{{ row.id }}</div>
              </td>
              <td class="sub">{{ row.userId }}</td>
              <td>
                <span class="tag" :class="{ 'tag--plain': row.spaceType !== 1 }">
                  {{ row.spaceType === 1 ? '团队' : '私有' }}
                </span>
              </td>
              <td class="sub">{{ levelText(row.spaceLevel) }}</td>
              <td class="sub">
                {{ row.totalCount ?? 0 }} / {{ row.maxCount ?? 0 }} 张<br />
                {{ formatSize(row.totalSize) }} / {{ formatSize(row.maxSize) }}
              </td>
              <td class="sub">{{ formatTime(row.createTime) }}</td>
              <td>
                <div class="acts">
                  <button class="mini" @click="openEdit(row)">编辑</button>
                  <!-- 只有团队空间才有"成员"这个概念；私有空间加了人也看不到图 -->
                  <button v-if="row.spaceType === 1" class="mini" @click="openMembers(row)">成员</button>
                  <button class="mini mini--danger" @click="confirmDelete(row)">删除</button>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <PageBar :current="current" :total="total" :page-size="pageSize" :disabled="loading" @change="load" />

    <!-- 编辑空间 -->
    <n-modal
      v-model:show="showEdit"
      preset="card"
      title="编辑空间"
      class="sp-modal"
      :bordered="false"
      :mask-closable="!editing"
    >
      <div class="f" >
        <label>空间名称</label>
        <n-input v-model:value="editForm.spaceName" size="small" />
      </div>
      <div class="f">
        <label>空间等级</label>
        <n-select v-model:value="editForm.spaceLevel" :options="levelOptions" size="small" @update:value="onLevelChange" />
      </div>
      <div class="f-row">
        <div class="f">
          <label>图片上限（张）</label>
          <n-input-number v-model:value="editForm.maxCount" size="small" :min="0" />
        </div>
        <div class="f">
          <label>容量上限（字节）</label>
          <n-input-number v-model:value="editForm.maxSize" size="small" :min="0" />
        </div>
      </div>
      <div class="hint">
        改等级会自动带出该等级的默认配额；也可以直接手填覆盖。
        当前容量上限约 <b>{{ formatSize(editForm.maxSize) }}</b>。
      </div>
      <template #footer>
        <div class="foot">
          <n-button size="small" :disabled="editing" @click="showEdit = false">取消</n-button>
          <n-button size="small" type="primary" :disabled="editing" @click="submitEdit">
            {{ editing ? '保存中…' : '保存' }}
          </n-button>
        </div>
      </template>
    </n-modal>

    <!-- 成员管理 -->
    <n-modal
      v-model:show="showMembers"
      preset="card"
      :title="`成员管理 · ${memberSpace?.spaceName || ''}`"
      class="sp-modal sp-modal--wide"
      :bordered="false"
    >
      <div v-if="membersError" class="notice notice--err">{{ membersError }}</div>

      <div v-else-if="membersLoading" class="hint">加载中…</div>

      <template v-else>
        <div v-if="!members.length" class="hint">该空间还没有成员。</div>
        <ul v-else class="mems">
          <li v-for="m in members" :key="m.id" class="mem">
            <span class="mem__av">{{ (m.user?.userName || m.user?.userAccount || '?').slice(0, 1) }}</span>
            <div class="mem__txt">
              <div class="nm">{{ m.user?.userName || '未命名' }}</div>
              <div class="sub">{{ m.user?.userAccount }}　{{ m.userId }}</div>
            </div>
            <n-select
              class="mem__sel"
              size="small"
              :value="m.spaceRole"
              :options="ROLE_OPTIONS"
              @update:value="(v: string) => changeMemberRole(m, v)"
            />
            <button class="mini mini--danger" @click="removeMember(m)">移除</button>
          </li>
        </ul>

        <div class="add">
          <div class="f">
            <label>添加成员<span class="opt">需要对方已有的用户 ID</span></label>
            <n-input v-model:value="newMember.userId" size="small" placeholder="输入用户 ID" />
          </div>
          <div class="f f--sm">
            <label>角色</label>
            <n-select v-model:value="newMember.spaceRole" :options="ROLE_OPTIONS" size="small" />
          </div>
          <n-button size="small" type="primary" :disabled="adding" @click="addMember">
            {{ adding ? '添加中…' : '添加' }}
          </n-button>
        </div>
        <div class="hint">
          成员管理按你在该空间里的角色判定：
          私有空间仅创建者本人或系统管理员可用；<b>团队空间必须先是你所在的团队成员</b>（否则会提示无权限）。
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
.toolbar h2 {
  margin: 0;
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.pill {
  font-size: 11px;
  color: var(--accent);
  background: var(--accent-soft);
  padding: 3px 9px;
  border-radius: 99px;
}
.toolbar__right {
  margin-left: auto;
  display: flex;
  gap: 8px;
}
.ghost-btn {
  height: 34px;
  padding: 0 14px;
  border-radius: 9px;
  border: 1px solid var(--border);
  background: var(--bg-surface);
  color: var(--text-primary);
  font-family: var(--font);
  font-size: 12.5px;
  cursor: pointer;
}
.primary-btn {
  height: 34px;
  padding: 0 18px;
  border-radius: 9px;
  border: 0;
  background: var(--accent);
  color: #fff;
  font-family: var(--font);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
}
.primary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.filters {
  display: flex;
  gap: 14px;
  align-items: flex-end;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 14px 16px;
  margin-bottom: 14px;
}
.fld {
  flex: 1;
  min-width: 0;
}
.fld--sm {
  flex: 0 0 200px;
}
.fld label {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 6px;
}
.fld .opt {
  color: var(--text-tertiary);
  margin-left: 5px;
  font-size: 11px;
}
/* 列是固定宽度的，窄屏放不下时应当容器内横向滚动；
   原来写 overflow: hidden 会把右侧几列直接切掉且无法查看。 */
.tbl-wrap {
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  overflow-x: auto;
  background: var(--bg-surface);
}
.tbl {
  min-width: 720px;
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.tbl th {
  text-align: left;
  font-weight: 500;
  font-size: 11.5px;
  color: var(--text-tertiary);
  padding: 11px 14px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.tbl td {
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
  color: var(--text-primary);
}
.tbl tbody tr:hover td {
  background: var(--accent-soft);
}
.tbl__empty {
  text-align: center;
  color: var(--text-tertiary);
  padding: 40px 0 !important;
}
.nm {
  font-size: 13px;
}
.sub {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 2px;
}
.tag {
  font-size: 10.5px;
  padding: 2px 7px;
  border-radius: 99px;
  background: rgba(53, 208, 186, 0.14);
  color: var(--success);
  white-space: nowrap;
}
.tag--plain {
  background: transparent;
  border: 1px solid var(--border-strong);
  color: var(--text-secondary);
}
.acts {
  display: flex;
  gap: 6px;
}
.mini {
  font-family: var(--font);
  font-size: 11.5px;
  padding: 4px 10px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.mini:hover {
  color: var(--text-primary);
  border-color: var(--border-strong);
}
.mini--danger {
  color: var(--danger);
}
.notice {
  padding: 10px 12px;
  border-radius: var(--r-sm);
  font-size: 12px;
  margin-bottom: 12px;
}
.notice--err {
  background: rgba(240, 101, 95, 0.12);
  color: var(--danger);
}
.f,
.f-row .f {
  margin-bottom: 14px;
}
.f-row {
  display: flex;
  gap: 14px;
}
.f-row .f {
  flex: 1;
}
.f label {
  display: block;
  font-size: 12.5px;
  color: var(--text-secondary);
  margin-bottom: 6px;
}
.f .opt {
  color: var(--text-tertiary);
  margin-left: 5px;
  font-size: 11px;
}
.hint {
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
.mems {
  list-style: none;
  margin: 0 0 14px;
  padding: 0;
}
.mem {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px solid var(--border);
}
.mem__av {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: linear-gradient(140deg, #6c7bff, #35d0ba);
  color: #fff;
  font-size: 12px;
  flex: 0 0 30px;
}
.mem__txt {
  flex: 1;
  min-width: 0;
}
.mem__sel {
  width: 210px;
  flex: 0 0 210px;
}
.add {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
  margin-bottom: 12px;
}
.add .f {
  flex: 1;
  margin-bottom: 0;
}
.add .f--sm {
  flex: 0 0 210px;
}
.sp-modal--wide {
  width: 620px;
}
</style>

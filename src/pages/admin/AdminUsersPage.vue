<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NInput, NModal, NSelect, useDialog, useMessage, type SelectOption } from 'naive-ui'
import {
  addUserUsingPost,
  deleteUserUsingPost,
  listUserVoByPageUsingPost,
  updateUserUsingPost,
} from '@/api/userController'
import PageBar from '@/components/ui/PageBar.vue'
import { useLoginUserStore } from '@/stores/useLoginUserStore'
import { formatTime } from '@/utils/format'
import AdminNav from '@/components/admin/AdminNav.vue'

const dialog = useDialog()
const message = useMessage()
const loginUserStore = useLoginUserStore()
const myId = computed(() => String(loginUserStore.loginUser?.id ?? ''))

const rows = ref<API.UserVO[]>([])
const total = ref(0)
const current = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const errorMsg = ref('')

/**
 * 账号 / 昵称 / 简介在后端都是 like 模糊匹配，userRole 是 eq 精确匹配；
 * id 也是 eq —— 雪花 ID 必须传字符串，否则 JS 侧丢精度。
 */
const filters = ref({ id: '', userAccount: '', userName: '', userRole: '' })

const ROLE_OPTIONS: SelectOption[] = [
  { label: '全部角色', value: '' },
  { label: '普通用户', value: 'user' },
  { label: '管理员', value: 'admin' },
]

async function load(page = current.value) {
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await listUserVoByPageUsingPost({
      current: page,
      pageSize: pageSize.value,
      sortField: 'createTime',
      sortOrder: 'descend',
      ...(filters.value.id.trim() ? { id: filters.value.id.trim() as unknown as number } : {}),
      ...(filters.value.userAccount.trim() ? { userAccount: filters.value.userAccount.trim() } : {}),
      ...(filters.value.userName.trim() ? { userName: filters.value.userName.trim() } : {}),
      ...(filters.value.userRole ? { userRole: filters.value.userRole } : {}),
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
  // 雪花 ID 是纯数字，先挡住明显错误的输入，避免后端类型转换失败返「系统错误」
  if (filters.value.id.trim() && !/^\d+$/.test(filters.value.id.trim())) {
    message.warning('用户 ID 只能是数字')
    return
  }
  load(1)
}
function resetFilters() {
  filters.value = { id: '', userAccount: '', userName: '', userRole: '' }
  load(1)
}

/* ---------- 新建用户 ----------
  后端 POST /user/add 只认 账号/昵称/头像/简介/角色，密码由服务端写死一个初始值，
   所以这里不提供密码输入，但必须把初始密码如实告诉管理员。
*/
const showCreate = ref(false)
const creating = ref(false)
const DEFAULT_PWD = '12345678' // 与后端 UserController#addUser 的初始密码保持一致
const newUser = ref({ userAccount: '', userName: '', userRole: 'user', userAvatar: '', userProfile: '' })

const CREATE_ROLE_OPTIONS: SelectOption[] = [
  { label: '普通用户', value: 'user' },
  { label: '管理员', value: 'admin' },
]

function openCreate() {
  newUser.value = { userAccount: '', userName: '', userRole: 'user', userAvatar: '', userProfile: '' }
  showCreate.value = true
}

async function submitCreate() {
  if (creating.value) return
  const account = newUser.value.userAccount.trim()
  if (!account) {
    message.warning('请填写账号')
    return
  }
  if (account.length < 4) {
    message.warning('账号至少 4 位')
    return
  }
  if (account.length > 32) {
    message.warning('账号最多 32 位')
    return
  }
  if (newUser.value.userProfile.length > 512) {
    message.warning('简介最多 512 字')
    return
  }
  creating.value = true
  try {
    /*
      后端 addUser 没有查重校验，重复账号会直接撞数据库唯一索引 → 50000「系统错误」。
      这里先做一次精确比对，给管理员可读的提示（模糊查询后再按值比对，避免误判）。
    */
    const probe = await listUserVoByPageUsingPost({ current: 1, pageSize: 20, userAccount: account })
    const dup = (probe.data?.records ?? []).some((r) => (r.userAccount || '') === account)
    if (dup) {
      message.warning('该账号已存在')
      return
    }
    await addUserUsingPost({
      userAccount: account,
      userName: newUser.value.userName.trim() || '无名',
      userRole: newUser.value.userRole || 'user',
      userAvatar: newUser.value.userAvatar.trim() || undefined,
      userProfile: newUser.value.userProfile.trim() || undefined,
    })
    message.success(`已创建「${account}」，初始密码 ${DEFAULT_PWD}`)
    showCreate.value = false
    await load(1)
  } catch (e) {
    /*
      后端 addUser 没有查重，重复账号会撞唯一索引抛 RuntimeException，
      全局异常处理把它变成 50000「系统错误」—— 对管理员没有指导意义，这里翻译成人话。
    */
    const code = (e as { code?: number }).code
    message.error(
      code === 50000
        ? '创建失败：账号可能已存在（或数据库异常），请换一个账号再试'
        : (e as Error).message || '创建失败',
    )
  } finally {
    creating.value = false
  }
}

/** 防止把自己降级或删掉，导致再也进不了管理台 */
const isSelf = (row: API.UserVO) => String(row.id) === myId.value

function changeRole(row: API.UserVO, role: string) {
  if (isSelf(row)) {
    message.warning('不能修改自己的角色，请用另一个管理员账号操作')
    return
  }
  const label = role === 'admin' ? '管理员' : '普通用户'
  dialog.warning({
    title: '修改角色',
    content: `把「${row.userName || row.userAccount}」设为${label}？`,
    positiveText: '确认',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await updateUserUsingPost({ id: String(row.id) as unknown as number, userRole: role })
        message.success('已更新')
        await load()
      } catch (e) {
        message.error((e as Error).message || '更新失败')
      }
    },
  })
}

function confirmDelete(row: API.UserVO) {
  if (isSelf(row)) {
    message.warning('不能删除自己')
    return
  }
  dialog.error({
    title: '删除用户',
    content: `确定删除「${row.userName || row.userAccount}」？该操作不可恢复。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await deleteUserUsingPost({ id: String(row.id) as unknown as number })
        message.success('已删除')
        await load()
      } catch (e) {
        message.error((e as Error).message || '删除失败')
      }
    },
  })
}

onMounted(() => load(1))
</script>

<template>
  <div class="page">
    <AdminNav />
    <div class="toolbar">
      <h2>用户管理</h2>
      <div class="pill">共 {{ total }} 人</div>
      <div class="toolbar__right">
        <button class="primary-btn" @click="openCreate">新建用户</button>
        <button class="ghost-btn" @click="resetFilters">重置筛选</button>
        <button class="ghost-btn" :disabled="loading" @click="search">查询</button>
      </div>
    </div>

    <section class="filters">
      <div class="fld fld--sm">
        <label>用户 ID</label>
        <n-input v-model:value="filters.id" size="small" placeholder="输入用户 ID" @keyup.enter="search" />
      </div>
      <div class="fld">
        <label>账号</label>
        <n-input v-model:value="filters.userAccount" size="small" placeholder="输入账号" @keyup.enter="search" />
      </div>
      <div class="fld">
        <label>昵称</label>
        <n-input v-model:value="filters.userName" size="small" placeholder="输入昵称" @keyup.enter="search" />
      </div>
      <div class="fld fld--sm">
        <label>角色</label>
        <n-select v-model:value="filters.userRole" :options="ROLE_OPTIONS" size="small" />
      </div>
    </section>

    <div v-if="errorMsg" class="notice notice--err">{{ errorMsg }}</div>

    <div class="tbl-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th style="width: 230px">用户</th>
            <th>简介</th>
            <th style="width: 100px">角色</th>
            <th style="width: 100px">会员</th>
            <th style="width: 130px">注册时间</th>
            <th style="width: 210px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="6" class="tbl__empty">加载中…</td>
          </tr>
          <tr v-else-if="!rows.length">
            <td colspan="6" class="tbl__empty">没有符合条件的用户</td>
          </tr>
          <template v-else>
            <tr v-for="row in rows" :key="row.id">
              <td>
                <div class="u">
                  <img v-if="row.userAvatar" class="av" :src="row.userAvatar" alt="" referrerpolicy="no-referrer" />
                  <span v-else class="av av--ph">{{ (row.userName || row.userAccount || '?').slice(0, 1) }}</span>
                  <div class="u__txt">
                    <div class="nm">
                      {{ row.userName || '未命名' }}
                      <span v-if="isSelf(row)" class="me">你</span>
                    </div>
                    <div class="sub">{{ row.userAccount }}　{{ row.id }}</div>
                  </div>
                </div>
              </td>
              <td class="sub ellipsis">{{ row.userProfile || '—' }}</td>
              <td>
                <span class="st" :class="row.userRole === 'admin' ? 'ok' : 'plain'">
                  {{ row.userRole === 'admin' ? '管理员' : '普通用户' }}
                </span>
              </td>
              <td class="sub">
                <template v-if="row.vipNumber || row.vipExpireTime">
                  VIP · {{ formatTime(row.vipExpireTime) }}
                </template>
                <template v-else>—</template>
              </td>
              <td class="sub">{{ formatTime(row.createTime) }}</td>
              <td>
                <div class="acts">
                  <button
                    class="mini"
                    :disabled="isSelf(row)"
                    @click="changeRole(row, row.userRole === 'admin' ? 'user' : 'admin')"
                  >
                    {{ row.userRole === 'admin' ? '降为普通' : '设为管理员' }}
                  </button>
                  <button class="mini mini--danger" :disabled="isSelf(row)" @click="confirmDelete(row)">
                    删除
                  </button>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <PageBar :current="current" :total="total" :page-size="pageSize" :disabled="loading" @change="load" />

    <!-- 新建用户：密码由服务端给定初始值，这里只收集资料 -->
    <n-modal
      v-model:show="showCreate"
      preset="card"
      title="新建用户"
      :style="{ width: '420px' }"
      :bordered="false"
      :mask-closable="false"
    >
      <div class="cf">
        <div class="cf__i">
          <label>账号<span class="req">必填</span><span class="opt">至少 4 位，登录时使用</span></label>
          <n-input v-model:value="newUser.userAccount" size="small" placeholder="输入账号" />
        </div>
        <div class="cf__i">
          <label>昵称<span class="opt">选填，留空为「无名」</span></label>
          <n-input v-model:value="newUser.userName" size="small" placeholder="输入昵称" />
        </div>
        <div class="cf__i">
          <label>角色</label>
          <n-select v-model:value="newUser.userRole" :options="CREATE_ROLE_OPTIONS" size="small" />
        </div>
        <div class="cf__i">
          <label>头像地址<span class="opt">选填，图片 URL</span></label>
          <n-input v-model:value="newUser.userAvatar" size="small" placeholder="输入图片地址" />
        </div>
        <div class="cf__i">
          <label>个人简介<span class="opt">选填</span></label>
          <n-input
            v-model:value="newUser.userProfile"
            type="textarea"
            size="small"
            :autosize="{ minRows: 2, maxRows: 3 }"
            placeholder="选填"
          />
        </div>

        <div class="cf__tip">
          初始密码由系统统一设置为 <b>{{ DEFAULT_PWD }}</b>，创建后请转告该用户及时修改。
        </div>

        <div class="cf__acts">
          <button class="ghost-btn" :disabled="creating" @click="showCreate = false">取消</button>
          <button class="primary-btn" :disabled="creating" @click="submitCreate">
            {{ creating ? '创建中…' : '创建' }}
          </button>
        </div>
      </div>
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
  flex: 0 0 190px;
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
.u {
  display: flex;
  align-items: center;
  gap: 10px;
}
.av {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  object-fit: cover;
  flex: 0 0 34px;
  border: 1px solid var(--border);
}
.av--ph {
  display: grid;
  place-items: center;
  background: linear-gradient(140deg, #6c7bff, #35d0ba);
  color: #fff;
  font-size: 13px;
}
.u__txt {
  min-width: 0;
}
.nm {
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.me {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 99px;
  background: var(--accent-soft);
  color: var(--accent);
}
.sub {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 2px;
  max-width: 260px;
}
.st {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 99px;
  white-space: nowrap;
}
.st.ok {
  background: rgba(53, 208, 186, 0.14);
  color: var(--success);
}
.st.plain {
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
  white-space: nowrap;
}
.mini:hover:not(:disabled) {
  color: var(--text-primary);
  border-color: var(--border-strong);
}
.mini:disabled {
  opacity: 0.35;
  cursor: not-allowed;
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

/* ---------- 新建用户弹窗 ---------- */
.cf__i {
  margin-bottom: 12px;
}
.cf__i label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 6px;
}
.cf__i .opt {
  font-size: 11px;
  color: var(--text-tertiary);
}
.cf__i .req {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 99px;
  background: var(--accent-soft);
  color: var(--accent);
}
.cf__tip {
  margin: 4px 0 14px;
  padding: 10px 12px;
  border-radius: var(--r-sm);
  background: var(--accent-soft);
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--text-secondary);
}
.cf__tip b {
  color: var(--text-primary);
}
.cf__acts {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>

<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { NInput, NSelect, useDialog, useMessage, type SelectOption } from 'naive-ui'
import {
  deletePictureUsingPost,
  doPictureReviewUsingPost,
  listPictureByPageUsingPost,
} from '@/api/pictureController'
import PageBar from '@/components/ui/PageBar.vue'
import PictureEditModal from '@/components/gallery/PictureEditModal.vue'
import { formatSize, formatTime } from '@/utils/format'
import AdminNav from '@/components/admin/AdminNav.vue'

const dialog = useDialog()
const message = useMessage()

/**
 * 管理台用的是 /picture/list/page（返回原始 Picture），
 * 这是**唯一**能拿到 reviewStatus / reviewMessage 的接口 ——
 * PictureVO 不含审核字段，普通画廊看不到审核状态。
 * 另外该接口与 /user/list/page/vo 都**不受 pageSize ≤ 20 的防爬虫限制**
 * （那条限制只加在公开的 /picture/list/page/vo 上）。
 */
const rows = ref<API.Picture[]>([])
const total = ref(0)
const current = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const errorMsg = ref('')

const filters = ref({
  searchText: '',
  reviewStatus: '' as '' | 0 | 1 | 2,
  category: '',
  userId: '',
})

const REVIEW_OPTIONS: SelectOption[] = [
  { label: '全部状态', value: '' },
  { label: '待审核', value: 0 },
  { label: '已通过', value: 1 },
  { label: '已拒绝', value: 2 },
]

/** 审核状态枚举：0 待审核 / 1 通过 / 2 拒绝 */
const reviewMeta = (v?: number) => {
  if (v === 1) return { text: '已通过', cls: 'ok' }
  if (v === 2) return { text: '已拒绝', cls: 'bad' }
  return { text: '待审核', cls: 'wait' }
}

async function load(page = current.value) {
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await listPictureByPageUsingPost({
      current: page,
      pageSize: pageSize.value,
      sortField: 'createTime',
      sortOrder: 'descend',
      ...(filters.value.searchText.trim() ? { searchText: filters.value.searchText.trim() } : {}),
      ...(filters.value.reviewStatus === '' ? {} : { reviewStatus: filters.value.reviewStatus }),
      ...(filters.value.category.trim() ? { category: filters.value.category.trim() } : {}),
      ...(filters.value.userId.trim()
        ? { userId: filters.value.userId.trim() as unknown as number }
        : {}),
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
  filters.value = { searchText: '', reviewStatus: '', category: '', userId: '' }
  load(1)
}

function onlyPending() {
  filters.value.reviewStatus = 0
  load(1)
  loadPendingTotal()
}

/*
  「待审核」的数量必须是**全量**的。
  原来这里算的是当前页里有几条待审核 —— 但按钮上挂个数字徽章，用户一定读成"总共有 N 张等我审"，
  而当前页只有 20 条，这个数字既没意义又误导。改成单独问一次后端要 total。
*/
const pendingTotal = ref(0)

async function loadPendingTotal() {
  try {
    const res = await listPictureByPageUsingPost({
      current: 1,
      pageSize: 1, // 只要 total，不需要数据
      reviewStatus: 0,
    })
    pendingTotal.value = Number(res.data?.total ?? 0)
  } catch {
    pendingTotal.value = 0
  }
}

/* ---------- 审核 ---------- */
const REVIEWING = 0
const PASS = 1
const REJECT = 2

function canReview(row: API.Picture, target: number) {
  // 后端会拒绝「重复审核」：状态与目标相同时直接报错，所以这里直接禁用
  return row.reviewStatus !== target
}

function review(row: API.Picture, reviewStatus: number) {
  if (!canReview(row, reviewStatus)) {
    message.warning('该图片已是此审核状态，无需重复审核')
    return
  }
  if (reviewStatus === PASS) {
    dialog.success({
      title: '审核通过',
      content: `确认通过「${row.name || '未命名'}」？`,
      positiveText: '通过',
      negativeText: '取消',
      onPositiveClick: () => submitReview(row, PASS, ''),
    })
    return
  }
  // 拒绝时收集理由：用 h() 渲染一个输入框作为 dialog 内容
  const reason = ref('')
  dialog.warning({
    title: '审核拒绝',
    content: () =>
      h(NInput, {
        value: reason.value,
        'onUpdate:value': (v: string) => (reason.value = v),
        type: 'textarea',
        placeholder: '拒绝理由（可选，会展示给上传者）',
        autosize: { minRows: 2, maxRows: 4 },
        size: 'small',
      }),
    positiveText: '拒绝',
    negativeText: '取消',
    onPositiveClick: () => submitReview(row, REJECT, reason.value),
  })
}

async function submitReview(row: API.Picture, reviewStatus: number, reviewMessage: string) {
  if (!row.id) return
  try {
    await doPictureReviewUsingPost({
      id: String(row.id) as unknown as number,
      reviewStatus,
      reviewMessage: reviewMessage.trim() || undefined,
    })
    message.success(reviewStatus === PASS ? '已通过' : '已拒绝')
    await load()
    loadPendingTotal()
  } catch (e) {
    message.error((e as Error).message || '审核失败')
  }
}

/* ---------- 编辑 / 删除 ---------- */
const showEdit = ref(false)
const editing = ref<API.PictureVO | null>(null)

function openEdit(row: API.Picture) {
  // Picture 的 tags 是 JSON 字符串，转成数组再交给弹窗（弹窗按 VO 的形状使用）
  let tags: string[] = []
  try {
    const parsed = JSON.parse(row.tags || '[]')
    if (Array.isArray(parsed)) tags = parsed
  } catch {
    tags = []
  }
  editing.value = { ...row, tags } as unknown as API.PictureVO
  showEdit.value = true
}

function confirmDelete(row: API.Picture) {
  dialog.warning({
    title: '删除图片',
    content: `确定删除「${row.name || '未命名'}」？对象存储中的文件会一并清理，且不可恢复。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await deletePictureUsingPost({ id: String(row.id) as unknown as number })
        message.success('已删除')
        await load()
        loadPendingTotal()
      } catch (e) {
        message.error((e as Error).message || '删除失败')
      }
    },
  })
}

onMounted(() => {
  load(1)
  loadPendingTotal()
})
</script>

<template>
  <div class="page">
    <AdminNav />
    <div class="toolbar">
      <h2>图片管理</h2>
      <div class="pill">共 {{ total }} 张</div>
      <div class="toolbar__right">
        <button class="ghost-btn" @click="onlyPending">
          只看待审核
          <span v-if="pendingTotal" class="dot" :title="`共 ${pendingTotal} 张待审核`">{{ pendingTotal }}</span>
        </button>
        <button class="ghost-btn" @click="resetFilters">重置筛选</button>
        <button class="primary-btn" :disabled="loading" @click="search">查询</button>
      </div>
    </div>

    <!-- 筛选 -->
    <section class="filters">
      <div class="fld">
        <label>关键词<span class="opt">名称或简介</span></label>
        <n-input
          v-model:value="filters.searchText"
          size="small"
          placeholder="输入关键词"
          @keyup.enter="search"
        />
      </div>
      <div class="fld fld--sm">
        <label>审核状态</label>
        <n-select v-model:value="filters.reviewStatus" :options="REVIEW_OPTIONS" size="small" />
      </div>
      <div class="fld fld--sm">
        <label>分类</label>
        <n-input v-model:value="filters.category" size="small" placeholder="输入分类" />
      </div>
      <div class="fld fld--sm">
        <label>上传者 ID</label>
        <n-input v-model:value="filters.userId" size="small" placeholder="输入上传者 ID" />
      </div>
    </section>

    <div v-if="errorMsg" class="notice notice--err">{{ errorMsg }}</div>

    <!-- 表格 -->
    <div class="tbl-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th style="width: 66px">图片</th>
            <th>名称 / ID</th>
            <th style="width: 150px">上传者</th>
            <th style="width: 120px">归属</th>
            <th style="width: 110px">审核</th>
            <th style="width: 118px">大小 / 尺寸</th>
            <th style="width: 130px">上传时间</th>
            <th style="width: 236px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="8" class="tbl__empty">加载中…</td>
          </tr>
          <tr v-else-if="!rows.length">
            <td colspan="8" class="tbl__empty">没有符合条件的图片</td>
          </tr>
          <!-- 注意：v-for 不能和 v-else 写在同一个元素上（v-if 优先级高于 v-for），
               必须用 <template v-else> 包一层 -->
          <template v-else>
            <tr v-for="row in rows" :key="row.id">
            <td>
              <img
                v-if="row.thumbnailUrl || row.url"
                class="thumb"
                :src="row.thumbnailUrl || row.url"
                alt=""
                loading="lazy"
                referrerpolicy="no-referrer"
              />
            </td>
            <td>
              <div class="nm ellipsis">{{ row.name || '未命名' }}</div>
              <div class="sub">{{ row.id }}</div>
            </td>
            <td class="sub">{{ row.userId }}</td>
            <td>
              <span v-if="row.spaceId" class="tag">空间 {{ row.spaceId }}</span>
              <span v-else class="tag tag--plain">公开</span>
            </td>
            <td>
              <span class="st" :class="reviewMeta(row.reviewStatus).cls">
                {{ reviewMeta(row.reviewStatus).text }}
              </span>
              <div v-if="row.reviewMessage" class="sub ellipsis" :title="row.reviewMessage">
                {{ row.reviewMessage }}
              </div>
            </td>
            <td class="sub">
              {{ formatSize(row.picSize) }}<br />
              {{ row.picWidth || '—' }} × {{ row.picHeight || '—' }}
            </td>
            <td class="sub">{{ formatTime(row.createTime) }}</td>
            <td>
              <div class="acts">
                <button class="mini mini--ok" :disabled="!canReview(row, 1)" @click="review(row, 1)">
                  通过
                </button>
                <button class="mini mini--warn" :disabled="!canReview(row, 2)" @click="review(row, 2)">
                  拒绝
                </button>
                <button class="mini" @click="openEdit(row)">编辑</button>
                <button class="mini mini--danger" @click="confirmDelete(row)">删除</button>
              </div>
            </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <PageBar
      :current="current"
      :total="total"
      :page-size="pageSize"
      :disabled="loading"
      @change="load"
    />

    <PictureEditModal v-model:show="showEdit" :picture="editing" @saved="load()" />
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
  align-items: center;
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
  display: inline-flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
}
.ghost-btn:hover {
  border-color: var(--border-strong);
}
.ghost-btn .dot {
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: 99px;
  background: var(--danger);
  color: #fff;
  font-size: 10.5px;
  display: grid;
  place-items: center;
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
.tbl tbody tr:last-child td {
  border-bottom: 0;
}
.tbl tbody tr:hover td {
  background: var(--accent-soft);
}
.tbl__empty {
  text-align: center;
  color: var(--text-tertiary);
  padding: 40px 0 !important;
}
.thumb {
  width: 44px;
  height: 44px;
  object-fit: cover;
  border-radius: 7px;
  border: 1px solid var(--border);
  display: block;
}
.nm {
  max-width: 260px;
}
.sub {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 2px;
  max-width: 220px;
}
.tag {
  font-size: 10.5px;
  padding: 2px 7px;
  border-radius: 99px;
  background: var(--accent-soft);
  color: var(--accent);
  white-space: nowrap;
}
.tag--plain {
  background: transparent;
  border: 1px solid var(--border-strong);
  color: var(--text-secondary);
}
.st {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 99px;
  white-space: nowrap;
}
.st.wait {
  background: rgba(255, 184, 107, 0.16);
  color: var(--accent-warm);
}
.st.ok {
  background: rgba(53, 208, 186, 0.14);
  color: var(--success);
}
.st.bad {
  background: rgba(240, 101, 95, 0.14);
  color: var(--danger);
}
.acts {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
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
.mini:hover:not(:disabled) {
  color: var(--text-primary);
  border-color: var(--border-strong);
}
.mini:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.mini--ok {
  color: var(--success);
}
.mini--warn {
  color: var(--accent-warm);
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
</style>

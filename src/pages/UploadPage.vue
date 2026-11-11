<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NInput, NInputNumber, NSelect, useMessage, type SelectOption } from 'naive-ui'
import {
  uploadPictureUsingPost,
  uploadPictureByUrlUsingPost,
  uploadPictureByBatchUsingPost,
} from '@/api/pictureController'
import { getSpaceVoByIdUsingGet, listSpaceVoByPageUsingPost } from '@/api/spaceController'
import { listMyTeamSpaceUsingPost } from '@/api/spaceUserController'
import { useLoginUserStore } from '@/stores/useLoginUserStore'
import { canBatchUpload } from '@/auth/permissions'

const message = useMessage()
const loginUserStore = useLoginUserStore()

/** 批量抓取是管理员专属（后端 /picture/upload/batch 标了 mustRole=ADMIN_ROLE） */
const isAdmin = computed(() => canBatchUpload(loginUserStore.loginUser))

/* ============================================================
   上传目标空间
   后端的空间权限上下文规则：请求里所有字段都为空 → 视为公共图库 → 直接放行。
   所以「公共图库」= 不传 spaceId。
   ⚠️ 但公共图库**不是私密的**：后端查询时不做 userId 过滤，
   所有登录用户上传到公共图库的图彼此可见，所以这里必须把「公开」讲清楚。
   ============================================================ */
type SpaceOption = { id: string; name: string; roleLabel: string; canUpload: boolean }

const spaceOptions = ref<SpaceOption[]>([])
const spacesLoading = ref(false)

/** 选中的空间 id；'' 表示公共图库（所有人可见） */
const targetSpaceId = ref<string>('')

/**
 * 权限与配额只能从「空间详情」拿到：
 * SpaceVO.permissionList 仅在 /space/get/vo 里被赋值，
 * 所有列表接口都不返回它 —— 所以不能靠列表接口自己推断权限。
 */
const spaceQuota = ref<{ maxCount: number; totalCount: number; maxSize: number; totalSize: number } | null>(null)
const canUploadToTarget = ref(true)
const spaceCheckMsg = ref('')

async function loadSpaces() {
  spacesLoading.value = true
  try {
    const opts: SpaceOption[] = []
    const myId = loginUserStore.loginUser?.id

    // 1) 我创建的空间：按 userId 过滤查询
    if (myId) {
      const res = await listSpaceVoByPageUsingPost({
        userId: String(myId) as unknown as number,
        current: 1,
        pageSize: 20,
      })
      for (const s of res.data?.records ?? []) {
        if (!s.id) continue
        opts.push({
          id: String(s.id),
          name: s.spaceName || `空间 ${s.id}`,
          roleLabel: '我创建的',
          canUpload: true,
        })
      }
    }

    // 2) 我加入的团队空间：接口直接返回我在该空间里的角色
    try {
      const res = await listMyTeamSpaceUsingPost()
      for (const su of res.data ?? []) {
        const id = su.spaceId ? String(su.spaceId) : ''
        if (!id || opts.some((o) => o.id === id)) continue
        const role = su.spaceRole || ''
        opts.push({
          id,
          name: su.space?.spaceName || `空间 ${id}`,
          // 角色码 → 中文展示；是否能上传仍以后端返回的 permissionList 为准
          roleLabel: role === 'admin' ? '管理员' : role === 'editor' ? '编辑者' : '浏览者',
          canUpload: role !== 'viewer',
        })
      }
    } catch {
      // 团队空间查询失败不应阻塞整个上传页
    }

    spaceOptions.value = opts
  } finally {
    spacesLoading.value = false
  }
}

const selectOptions = computed<SelectOption[]>(() => [
  { label: '公共图库（不属于任何空间，所有人可见）', value: '' },
  ...spaceOptions.value.map((o) => ({
    label: `${o.name} · ${o.roleLabel}`,
    value: o.id,
  })),
])

/** 切换空间 → 问后端要权限列表与配额 */
async function onSpaceChange(id: string) {
  targetSpaceId.value = id
  spaceQuota.value = null
  spaceCheckMsg.value = ''
  canUploadToTarget.value = true

  if (!id) return

  try {
    const res = await getSpaceVoByIdUsingGet({ id: id as unknown as number })
    const vo = res.data
    if (!vo) return
    spaceQuota.value = {
      maxCount: Number(vo.maxCount ?? 0),
      totalCount: Number(vo.totalCount ?? 0),
      maxSize: Number(vo.maxSize ?? 0),
      totalSize: Number(vo.totalSize ?? 0),
    }
    // 后端权威结论：permissionList 里没有 picture:upload 就不能传
    const perms = vo.permissionList ?? []
    canUploadToTarget.value = perms.includes('picture:upload')
    if (!canUploadToTarget.value) {
      spaceCheckMsg.value = `你在「${vo.spaceName}」中的角色没有「上传图片」权限，请换一个空间或联系空间管理员`
    }
  } catch (e) {
    canUploadToTarget.value = false
    spaceCheckMsg.value = (e as Error).message || '无法获取空间权限信息'
  }
}

/** 提交时附带的 spaceId；公共图库必须不传该字段 */
function spacePayload(): Record<string, unknown> {
  return targetSpaceId.value ? { spaceId: targetSpaceId.value } : {}
}

/* ============================================================
   Tab 1 · 本地文件
   后端 FilePictureUpload 的校验：≤2MB，后缀白名单 jpeg/png/jpg/webp。
   这里前移到前端做即时拦截，避免用户提交后才报错。
   ============================================================ */
const MAX_SIZE = 2 * 1024 * 1024
const ALLOW_SUFFIX = ['jpeg', 'png', 'jpg', 'webp']

type QueueItem = {
  key: string
  file: File
  name: string
  status: 'ready' | 'uploading' | 'done' | 'fail'
  reason?: string
}

const queue = ref<QueueItem[]>([])
const dragOver = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

function suffixOf(name: string) {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

/*
  数据库 picture.name 是 varchar(128)。文件名是用户给的外部输入（可能很长），
  超长会被数据库直接拒绝并抛出一个难懂的错，所以入队时先截断。
  （之前只在图片编辑弹窗里限制了名称长度，上传入口漏了。）
*/
const MAX_NAME = 128

function addFiles(files: FileList | File[]) {
  const accepted: QueueItem[] = []
  for (const f of Array.from(files)) {
    const suffix = suffixOf(f.name)
    if (f.size > MAX_SIZE) {
      message.warning(`「${f.name}」超过 2MB，已跳过`)
      continue
    }
    if (!ALLOW_SUFFIX.includes(suffix)) {
      message.warning(`「${f.name}」格式不支持（仅 jpeg / png / jpg / webp），已跳过`)
      continue
    }
    accepted.push({
      key: `${f.name}-${f.size}-${f.lastModified}`,
      file: f,
      name: f.name.replace(/\.[^.]+$/, '').slice(0, MAX_NAME),
      status: 'ready',
    })
  }
  // 同名同大小同时间的视为重复，避免重复入队
  const existing = new Set(queue.value.map((q) => q.key))
  queue.value = [...queue.value, ...accepted.filter((a) => !existing.has(a.key))]
}

function onDrop(e: DragEvent) {
  dragOver.value = false
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files)
}

function pickFiles() {
  fileInput.value?.click()
}

function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files?.length) addFiles(input.files)
  input.value = ''
}

function removeItem(key: string) {
  queue.value = queue.value.filter((q) => q.key !== key)
}

const readyCount = computed(() => queue.value.filter((q) => q.status === 'ready').length)

/** 串行上传：避免一次性并发把后端打满（上传本身是重操作） */
async function startUpload() {
  if (!canUploadToTarget.value) return
  const pending = queue.value.filter((q) => q.status === 'ready')
  if (!pending.length) return
  uploading.value = true
  let ok = 0
  for (const item of pending) {
    item.status = 'uploading'
    try {
      await uploadPictureUsingPost(
        {},
        { picName: item.name, ...spacePayload() } as Record<string, unknown>,
        item.file,
      )
      item.status = 'done'
      item.reason = undefined
      ok++
    } catch (e) {
      item.status = 'fail'
      item.reason = (e as Error).message || '上传失败'
    }
  }
  uploading.value = false
  if (ok) {
    message.success(`成功上传 ${ok} 张`)
    // 配额是后端累计值，上传后重新问一次
    if (targetSpaceId.value) onSpaceChange(targetSpaceId.value)
  }
  if (ok < pending.length) message.warning(`${pending.length - ok} 张上传失败`)
}

/* ============================================================
   Tab 2 · URL 上传
   后端 UrlPictureUpload：仅 http/https；HEAD 校验（响应头存在时校验类型与 ≤2MB）。
   ============================================================ */
const urlInput = ref('')
const urlName = ref('')
const urlSubmitting = ref(false)
const urlResult = ref<API.PictureVO | null>(null)

async function submitUrl() {
  if (!canUploadToTarget.value) return
  const u = urlInput.value.trim()
  if (!u) {
    message.warning('请输入图片地址')
    return
  }
  if (!/^https?:\/\//i.test(u)) {
    message.warning('仅支持 http:// 或 https:// 开头的地址')
    return
  }
  urlSubmitting.value = true
  urlResult.value = null
  try {
    const res = await uploadPictureByUrlUsingPost({
      fileUrl: u,
      picName: urlName.value.trim().slice(0, MAX_NAME) || undefined,
      ...(spacePayload() as { spaceId?: number }),
    })
    urlResult.value = res.data ?? null
    message.success('上传成功')
    urlInput.value = ''
    urlName.value = ''
    if (targetSpaceId.value) onSpaceChange(targetSpaceId.value)
  } catch (e) {
    message.error((e as Error).message || '上传失败')
  } finally {
    urlSubmitting.value = false
  }
}

/* ============================================================
   Tab 3 · 批量抓取（仅管理员）
   后端实现是爬 cn.bing.com 图片搜索页取缩略图：
     · count 上限 30
     · 抓到的是 Bing 缩略图（尺寸不可控），不是原图
     · 同步逐张下载+上传，耗时长，因此这里放宽请求超时
   ============================================================ */
const batchText = ref('')
const batchCount = ref(10)
const batchPrefix = ref('')
const batchSubmitting = ref(false)
const batchResult = ref<number | null>(null)

async function submitBatch() {
  if (!canUploadToTarget.value) return
  const text = batchText.value.trim()
  if (!text) {
    message.warning('请输入搜索关键词')
    return
  }
  if (batchCount.value > 30) {
    message.warning('最多 30 条')
    return
  }
  batchSubmitting.value = true
  batchResult.value = null
  try {
    const res = await uploadPictureByBatchUsingPost(
      {
        searchText: text,
        count: batchCount.value,
        namePrefix: batchPrefix.value.trim() || text,
      },
      // 后端同步抓取+逐张上传，30 条可能耗时数分钟；默认 30s 超时不够
      { timeout: 300000 },
    )
    batchResult.value = Number(res.data ?? 0)
    message.success(`抓取完成，成功上传 ${batchResult.value} 张`)
    if (targetSpaceId.value) onSpaceChange(targetSpaceId.value)
  } catch (e) {
    message.error((e as Error).message || '抓取失败')
  } finally {
    batchSubmitting.value = false
  }
}

/* ---------- Tab 切换 ---------- */
const tab = ref<'file' | 'url' | 'batch'>('file')

/* ---------- 展示 ---------- */
function formatSize(bytes?: number | string): string {
  const n = Number(bytes)
  if (!n || Number.isNaN(n)) return '0'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

onMounted(async () => {
  if (!loginUserStore.fetched) await loginUserStore.fetchLoginUser()
  await loadSpaces()
})
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <h2>上传中心</h2>
      <div class="toolbar__right">
        <RouterLink to="/" class="ghost-btn">返回画廊</RouterLink>
      </div>
    </div>

    <!-- 上传目标：空间 -->
    <section class="card-block">
      <div class="row">
        <div class="row__label">
          上传到
          <span class="row__hint">不选空间 = 存入公共图库</span>
        </div>
        <div class="row__ctrl">
          <n-select
            :value="targetSpaceId"
            :options="selectOptions"
            :loading="spacesLoading"
            size="small"
            style="min-width: 260px"
            @update:value="onSpaceChange"
          />
        </div>
      </div>

      <!-- 配额：数据同样来自 /space/get/vo -->
      <div v-if="spaceQuota" class="quota">
        <span class="quota__item">
          图片
          <b>{{ spaceQuota.totalCount }}</b> / {{ spaceQuota.maxCount }} 张
        </span>
        <span class="quota__item">
          容量
          <b>{{ formatSize(spaceQuota.totalSize) }}</b> / {{ formatSize(spaceQuota.maxSize) }}
        </span>
        <div class="quota__bar">
          <i
            :style="{
              width: Math.min(100, (spaceQuota.totalSize / Math.max(1, spaceQuota.maxSize)) * 100) + '%',
            }"
          />
        </div>
      </div>

      <div v-if="spaceCheckMsg" class="notice notice--err">{{ spaceCheckMsg }}</div>

      <!--
        不选空间 = 公共图库。后端查询**不按 userId 过滤**，
        所以这里必须明确说清「所有人可见」，否则用户会误以为只有自己能看到。
      -->
      <div v-else-if="!targetSpaceId" class="notice">
        上传到 <b>公共图库</b>：<b>所有登录用户都能看到</b>这张图。
        想只给自己看，请在上面选择一个<b>私有空间</b>。
      </div>
    </section>

    <!-- Tabs -->
    <div class="tabs">
      <button :class="{ on: tab === 'file' }" @click="tab = 'file'">本地文件</button>
      <button :class="{ on: tab === 'url' }" @click="tab = 'url'">URL 上传</button>
      <button v-if="isAdmin" :class="{ on: tab === 'batch' }" @click="tab = 'batch'">批量抓取</button>
    </div>

    <!-- ========== 本地文件 ========== -->
    <section v-if="tab === 'file'" class="card-block">
      <div
        class="drop"
        :class="{ over: dragOver }"
        @click="pickFiles"
        @dragover.prevent="dragOver = true"
        @dragleave.prevent="dragOver = false"
        @drop.prevent="onDrop"
      >
        <svg viewBox="0 0 24 24"><path d="M12 16V5M8 9l4-4 4 4M4 17v2a1 1 0 001 1h14a1 1 0 001-1v-2" /></svg>
        <div class="drop__t">把图片拖到这里，或点击选择</div>
        <div class="drop__s">
          单张不超过 <b>2MB</b>　支持 <b>jpeg / png / jpg / webp</b>　可多选
        </div>
        <input
          ref="fileInput"
          type="file"
          accept="image/jpeg,image/png,image/jpg,image/webp"
          multiple
          hidden
          @change="onPick"
        />
      </div>

      <ul v-if="queue.length" class="queue">
        <li v-for="q in queue" :key="q.key" class="qitem">
          <span class="qitem__dot" :class="q.status" />
          <span class="qitem__n ellipsis">{{ q.file.name }}</span>
          <span class="qitem__s">{{ formatSize(q.file.size) }}</span>
          <span class="qitem__st" :class="q.status">
            <template v-if="q.status === 'ready'">待上传</template>
            <template v-else-if="q.status === 'uploading'">上传中…</template>
            <template v-else-if="q.status === 'done'">成功</template>
            <template v-else>{{ q.reason || '失败' }}</template>
          </span>
          <button class="qitem__x" title="移除" @click.stop="removeItem(q.key)">×</button>
        </li>
      </ul>

      <div class="actions">
        <button
          class="primary-btn"
          :disabled="!readyCount || uploading || !canUploadToTarget"
          @click="startUpload"
        >
          {{ uploading ? '上传中…' : `开始上传${readyCount ? `（${readyCount}）` : ''}` }}
        </button>
        <button v-if="queue.length" class="ghost-btn" :disabled="uploading" @click="queue = []">
          清空列表
        </button>
      </div>
    </section>

    <!-- ========== URL 上传 ========== -->
    <section v-else-if="tab === 'url'" class="card-block">
      <div class="field">
        <label>图片地址</label>
        <n-input
          v-model:value="urlInput"
          size="small"
          placeholder="https://example.com/photo.jpg"
        />
      </div>
      <div class="field">
        <label>图片名称<span class="opt">（可选）</span></label>
        <n-input v-model:value="urlName" size="small" placeholder="留空则用文件名" />
      </div>

      <div class="notice">
        提交时会先校验该地址：仅支持 <b>http / https</b>；
        若地址能返回图片类型与大小，会一并校验 <b>格式</b> 与 <b>≤2MB</b>。地址末尾带 <code>?</code> 参数不影响上传。
      </div>

      <div class="actions">
        <button class="primary-btn" :disabled="urlSubmitting || !canUploadToTarget" @click="submitUrl">
          {{ urlSubmitting ? '提交中…' : '上传' }}
        </button>
      </div>

      <div v-if="urlResult" class="result">
        <img v-if="urlResult.thumbnailUrl || urlResult.url" :src="urlResult.thumbnailUrl || urlResult.url" alt="" />
        <div class="result__info">
          <div class="result__t">{{ urlResult.name || '未命名' }}</div>
          <div class="result__s">
            {{ urlResult.picWidth || '—' }} × {{ urlResult.picHeight || '—' }} ·
            {{ formatSize(urlResult.picSize) }} · {{ (urlResult.picFormat || '').toUpperCase() }}
          </div>
        </div>
      </div>
    </section>

    <!-- ========== 批量抓取（管理员） ========== -->
    <section v-else class="card-block">
      <div class="field">
        <label>搜索关键词</label>
        <n-input v-model:value="batchText" size="small" placeholder="例如：星空 壁纸" />
      </div>
      <div class="field-row">
        <div class="field">
          <label>抓取数量<span class="opt">（上限 30）</span></label>
          <n-input-number v-model:value="batchCount" size="small" :min="1" :max="30" />
        </div>
        <div class="field">
          <label>名称前缀<span class="opt">（可选）</span></label>
          <n-input v-model:value="batchPrefix" size="small" placeholder="留空则用关键词" />
        </div>
      </div>

      <div class="notice notice--warn">
        抓取到的是搜索引擎的<b>缩略图</b>，不是原图 ——
        抓到的图片尺寸不可控（常见仅 400~500px 宽），且宽度可能不足 512px 导致<b>后续无法使用 AI 扩图</b>。
        另外它同步逐张下载+上传，<b>30 条可能需要数分钟</b>，请勿重复提交。
      </div>

      <div class="actions">
        <button class="primary-btn" :disabled="batchSubmitting || !canUploadToTarget" @click="submitBatch">
          {{ batchSubmitting ? '抓取中，请稍候…' : '开始抓取' }}
        </button>
      </div>

      <div v-if="batchResult !== null" class="notice notice--ok">
        本次成功上传 <b>{{ batchResult }}</b> 张到{{ targetSpaceId ? '所选空间' : '公共图库' }}。
      </div>
    </section>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  margin-bottom: 16px;
}
.toolbar h2 {
  margin: 0;
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.toolbar__right {
  margin-left: auto;
}

.card-block {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 16px 18px;
  margin-bottom: 14px;
}

.row {
  display: flex;
  align-items: center;
  gap: 16px;
}
.row__label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}
.row__hint {
  font-size: 11.5px;
  color: var(--text-tertiary);
  font-weight: 400;
  margin-left: 6px;
}
.row__ctrl {
  margin-left: auto;
}

.quota {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
}
.quota__item {
  font-size: 12px;
  color: var(--text-secondary);
}
.quota__item b {
  color: var(--text-primary);
  font-weight: 600;
}
.quota__bar {
  flex: 1;
  min-width: 120px;
  height: 5px;
  border-radius: 99px;
  background: var(--accent-soft);
  overflow: hidden;
}
.quota__bar i {
  display: block;
  height: 100%;
  border-radius: 99px;
  background: var(--accent);
  transition: width 0.25s ease;
}

.notice {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: var(--r-sm);
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-secondary);
  background: var(--accent-soft);
}
.notice--err {
  background: rgba(240, 101, 95, 0.12);
  color: var(--danger);
}
.notice--warn {
  background: rgba(255, 184, 107, 0.12);
  color: var(--text-primary);
  border: 1px solid rgba(255, 184, 107, 0.32);
}
.notice--ok {
  background: rgba(53, 208, 186, 0.12);
  color: var(--text-primary);
}
.notice code {
  background: rgba(255, 255, 255, 0.1);
  padding: 1px 5px;
  border-radius: 4px;
}

.tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 14px;
}
.tabs button {
  height: 34px;
  padding: 0 16px;
  border-radius: 9px;
  border: 1px solid var(--border);
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-family: var(--font);
  font-size: 13px;
  cursor: pointer;
}
.tabs button.on {
  background: var(--accent-soft);
  border-color: transparent;
  color: var(--accent);
  font-weight: 500;
}

.drop {
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--r-md);
  padding: 32px 20px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.18s ease, background-color 0.18s ease;
}
.drop:hover,
.drop.over {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.drop svg {
  width: 26px;
  height: 26px;
  stroke: var(--accent);
  fill: none;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.drop__t {
  margin-top: 10px;
  font-size: 13.5px;
  color: var(--text-primary);
}
.drop__s {
  margin-top: 6px;
  font-size: 11.5px;
  color: var(--text-tertiary);
}
.drop__s b {
  color: var(--text-secondary);
}

.queue {
  list-style: none;
  margin: 14px 0 0;
  padding: 0;
}
.qitem {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
  font-size: 12.5px;
}
.qitem__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 7px;
  background: var(--text-tertiary);
}
.qitem__dot.uploading {
  background: var(--accent-warm);
}
.qitem__dot.done {
  background: var(--success);
}
.qitem__dot.fail {
  background: var(--danger);
}
.qitem__n {
  flex: 1;
  min-width: 0;
  color: var(--text-primary);
}
.qitem__s {
  color: var(--text-tertiary);
  flex: 0 0 auto;
}
.qitem__st {
  flex: 0 0 auto;
  color: var(--text-secondary);
}
.qitem__st.done {
  color: var(--success);
}
.qitem__st.fail {
  color: var(--danger);
}
.qitem__x {
  border: 0;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
}
.qitem__x:hover {
  color: var(--danger);
}

.field {
  margin-bottom: 14px;
  flex: 1;
  min-width: 0;
}
.field label {
  display: block;
  font-size: 12.5px;
  color: var(--text-secondary);
  margin-bottom: 6px;
}
.field .opt {
  color: var(--text-tertiary);
}
.field-row {
  display: flex;
  gap: 16px;
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}
.primary-btn {
  height: 36px;
  padding: 0 20px;
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
.ghost-btn {
  height: 36px;
  padding: 0 16px;
  border-radius: 9px;
  border: 1px solid var(--border);
  background: var(--bg-surface);
  color: var(--text-primary);
  font-family: var(--font);
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
}
.ghost-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.result {
  margin-top: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
}
.result img {
  width: 64px;
  height: 64px;
  object-fit: cover;
  border-radius: 6px;
  flex: 0 0 64px;
}
.result__t {
  font-size: 13px;
  color: var(--text-primary);
  margin-bottom: 4px;
}
.result__s {
  font-size: 11.5px;
  color: var(--text-tertiary);
}
</style>

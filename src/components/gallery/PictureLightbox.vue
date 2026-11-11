<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDialog, useMessage } from 'naive-ui'
import { deletePictureUsingPost, getPictureVoByIdUsingGet } from '@/api/pictureController'
import PictureEditModal from '@/components/gallery/PictureEditModal.vue'
import ShareModal from '@/components/gallery/ShareModal.vue'
import ImageSearchModal from '@/components/gallery/ImageSearchModal.vue'
import { useLoginUserStore } from '@/stores/useLoginUserStore'
import { canEditPicture, canDeletePicture } from '@/auth/permissions'
import { useSpacePerms } from '@/composables/useSpacePerms'

const props = defineProps<{
  /** 当前页已加载的图片列表；Lightbox 依赖它做上一张/下一张 */
  pictures: API.PictureVO[]
}>()

/** 删除/编辑后通知画廊重新加载当前页（列表由 HomePage 持有） */
const emit = defineEmits<{
  (e: 'deleted'): void
  (e: 'updated'): void
}>()

const route = useRoute()
const router = useRouter()
const dialog = useDialog()
const message = useMessage()
const loginUserStore = useLoginUserStore()

/*
  图片级权限门禁 —— 这一条很容易漏：
  公共图库是**所有登录用户共享**的，所以你会看到别人上传的图，
  而「编辑 / 删除 / 裁剪扩图」在后端只允许**图片所属人本人或系统管理员**
  （@SaSpaceCheckPermission(PICTURE_EDIT/PICTURE_DELETE)）。

  但**团队空间不一样**：后端按 `space_user` 里的角色给权限，
  editor / admin 成员可以编辑、删除**别人上传到该空间**的图 —— 这就是「共同编辑」。
  所以图片属于某个空间时，必须问后端要 permissionList 再判，不能只看 userId，
  否则团队空间的编辑者会连按钮都看不到（共同编辑等于没实现）。
*/
const spacePerms = useSpacePerms()
const canModify = computed(() =>
  canEditPicture(loginUserStore.loginUser, current.value?.userId, spacePerms.perms.value),
)
const canRemove = computed(() =>
  canDeletePicture(loginUserStore.loginUser, current.value?.userId, spacePerms.perms.value),
)

/** 无权限时的「为什么」只用于按钮点击兜底提示（confirmDelete），不再占版面 */
const noPermissionText = computed(() => {
  const p = current.value
  if (!p) return ''
  if (p.spaceId && spacePerms.perms.value) {
    return '你在该空间是浏览者（viewer），只能查看。需要编辑或删除请联系空间管理员调整你的角色。'
  }
  return '这张图不是你上传的。公共图库对所有登录用户可见，但只有上传者本人（或管理员）能编辑和删除。'
})

/* ---------- 分享 ---------- */
/*
  链接固定指向公开的深链路由 /picture/:id：
  · 列表里翻到哪张都一样，id 是唯一标识；
  · 雪花 ID 走 String，避免丢精度；
  · 空间图也用这个入口 —— 打开后按访问者权限自然放行/拦截。
*/
const showShare = ref(false)
/*
  ⚠️ 这里曾经写死成 `${origin}/picture/${id}`，而路由实际是 `/p/:id`（空间图是 `/s/:spaceId/p/:id`），
  分享出去的链接会命中兜底路由、被重定向回首页 —— 等于分享功能是坏的。
  现在改用 router.resolve 按路由名解析，路径由路由表决定，以后改路径这里不会再次失配。
*/
const shareLink = computed(() => {
  const p = current.value
  if (!p?.id) return ''
  const resolved = p.spaceId
    ? router.resolve({
        name: 'spacePicture',
        params: { spaceId: String(p.spaceId), pictureId: String(p.id) },
      })
    : router.resolve({ name: 'picture', params: { pictureId: String(p.id) } })
  return `${window.location.origin}${resolved.href}`
})

/* ---------- 以图搜图 ---------- */
/*
  入口只对「空间内的图」开放（私有空间 + 团队空间），公共图库不给 —— 这是产品取舍，不是能力限制：
  · 后端 `/picture/search/picture` 只认 pictureId，任何图都能搜，没有空间校验；
  · 但搜索会把这张图**上传给第三方识图服务**，公共图库里的图是别人的、属于"公共浏览位"，
    拿别人的图去外部搜索不合适；空间里的图要么是自己的（私有），要么是协作内容（团队），语义上说得通；
  · 顺带的好处：外部服务有调用成本（每次 1~3 秒、可能被限流），把入口收在工作区里更可控。
*/
const showImageSearch = ref(false)
const canImageSearch = computed(() => !!current.value?.spaceId)


/**
 * 雪花 ID 是 19 位（如 2110389011700252674），**超过 JS 的 Number.MAX_SAFE_INTEGER**。
 * 所以：
 *  1. 比较 id 必须转成字符串，用 === 比 number 会因精度丢失而失配；
 *  2. 调接口传 id 也要传字符串（后端 Jackson 把 Long 序列化成 String 正是这个原因）。
 */
const routeId = computed(() => String(route.params.pictureId ?? ''))

const fromList = computed(() => props.pictures.some((p) => String(p.id) === routeId.value))
const index = computed(() => props.pictures.findIndex((p) => String(p.id) === routeId.value))

/** 深链直接打开（列表里没有）时，单独按 id 拉一次 */
const standalone = ref<API.PictureVO | null>(null)
const standaloneError = ref('')

const current = computed<API.PictureVO | null>(() =>
  fromList.value ? (props.pictures[index.value] ?? null) : standalone.value,
)

/** 上一张/下一张只在「从列表进入」时可用；深链单张时退化为纯查看 */
const canNav = computed(() => fromList.value && props.pictures.length > 1)
const hasPrev = computed(() => canNav.value && index.value > 0)
const hasNext = computed(() => canNav.value && index.value < props.pictures.length - 1)
const position = computed(() => (canNav.value ? index.value + 1 : 1))
const totalInList = computed(() => (canNav.value ? props.pictures.length : 1))

async function ensureStandalone() {
  if (fromList.value) {
    standalone.value = null
    standaloneError.value = ''
    return
  }
  const id = routeId.value
  if (!id) return
  standaloneError.value = ''
  try {
    // id 以字符串下发，避免 19 位雪花 ID 在 JS 侧丢精度
    const res = await getPictureVoByIdUsingGet({ id: id as unknown as number })
    standalone.value = res.data ?? null
    if (!standalone.value) standaloneError.value = '图片不存在或无权访问'
  } catch (e) {
    standaloneError.value = (e as Error).message || '加载失败'
  }
}

watch([fromList, routeId], ensureStandalone, { immediate: true })

/*
  图片属于某个空间时，向 `/space/get/vo` 要 permissionList（后端权威结论）。
  必须放在 `current` 声明之后，否则 immediate watch 会撞上 TDZ。
*/
watch(
  () => current.value?.spaceId,
  (sid) => {
    if (sid) void spacePerms.load(sid)
    else spacePerms.reset()
  },
  { immediate: true },
)

/* ---------- 大图加载（用原图 url，不是缩略图） ---------- */
const imgSrc = computed(() => current.value?.url || '')
const imgLoading = ref(true)
const imgFailed = ref(false)

watch(imgSrc, () => {
  imgLoading.value = true
  imgFailed.value = false
})

function onImgLoad() {
  imgLoading.value = false
}

function onImgError() {
  imgLoading.value = false
  imgFailed.value = true
}

/** 预加载相邻两张，切换时不出现空白 */
watch(
  [index, fromList],
  () => {
    if (!canNav.value) return
    for (const i of [index.value - 1, index.value + 1]) {
      const p = props.pictures[i]
      if (p?.url) new Image().src = p.url
    }
  },
  { immediate: true },
)

function go(delta: number) {
  const next = index.value + delta
  const p = props.pictures[next]
  if (!p) return
  // 沿用「当前路由」的名字与参数，只替换 pictureId ——
  // 这样同一份 Lightbox 在个人画廊(/p/:id)和空间画廊(/s/:spaceId/p/:id)下都能正确翻图
  router.replace({
    name: route.name ?? undefined,
    params: { ...route.params, pictureId: String(p.id) },
  })
}

function close() {
  if (window.history.state?.back) {
    router.back()
    return
  }
  // 直接深链进来时没有可回退的历史，就回到所在画廊
  const spaceId = route.params.spaceId
  if (spaceId) router.push({ name: 'space', params: { spaceId } })
  else router.push({ name: 'home' })
}

/* ---------- 编辑信息 ---------- */
const showEdit = ref(false)
/* ---------- 删除 ---------- */
const deleting = ref(false)

function confirmDelete() {
  const p = current.value
  if (!p?.id) return
  // 双保险：按钮已经按权限隐藏，这里再挡一次，防止将来别处调用绕过
  if (!canRemove.value) {
    message.warning(noPermissionText.value || '你没有删除这张图片的权限')
    return
  }
  dialog.warning({
    title: '删除图片',
    content: `确定要删除「${p.name || '未命名'}」吗？对象存储中的文件会一并清理，且不可恢复。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: doDelete,
  })
}

async function doDelete() {
  const p = current.value
  if (!p?.id) return

  // 删除前先算好落点：优先下一张，其次上一张，都没有就关闭
  const fallback = props.pictures[index.value + 1] ?? props.pictures[index.value - 1]

  deleting.value = true
  try {
    await deletePictureUsingPost({ id: String(p.id) as unknown as number })
    message.success('已删除')
    emit('deleted')
    if (fallback?.id) {
      router.replace({ name: 'picture', params: { pictureId: String(fallback.id) } })
    } else {
      close()
    }
  } catch (e) {
    message.error((e as Error).message || '删除失败')
  } finally {
    deleting.value = false
  }
}

/* ---------- 键盘 ---------- */
function onKeydown(e: KeyboardEvent) {
  // 弹窗打开时不响应翻图/关闭快捷键，避免和表单交互打架
  if (showEdit.value || showShare.value || showImageSearch.value) return
  if (e.key === 'Escape') close()
  else if (e.key === 'ArrowLeft') go(-1)
  else if (e.key === 'ArrowRight') go(1)
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  document.documentElement.classList.add('lightbox-open')
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  document.documentElement.classList.remove('lightbox-open')
})

/* ---------- 展示格式化 ---------- */
function formatSize(bytes?: number | string): string {
  const n = Number(bytes)
  if (!n || Number.isNaN(n)) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function formatColor(raw?: string): string | null {
  if (!raw) return null
  return raw.startsWith('0x') ? `#${raw.slice(2)}` : raw
}

function formatTime(t?: string): string {
  if (!t) return '—'
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
</script>

<template>
  <div class="lb">
    <div class="lb__main">
      <header class="lb__top">
        <div class="lb__meta">
          <div class="lb__name ellipsis">{{ current?.name || '未命名' }}</div>
          <div class="lb__idx">{{ position }} / {{ totalInList }}</div>
        </div>
        <button class="ibtn" title="关闭 (Esc)" @click="close">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </header>

      <div class="lb__stage" @click.self="close">
        <img
          v-if="imgSrc && !imgFailed"
          :src="imgSrc"
          :alt="current?.name || '图片'"
          referrerpolicy="no-referrer"
          @load="onImgLoad"
          @error="onImgError"
        />

        <div v-if="imgLoading && !imgFailed" class="spinner" />
        <div v-if="imgFailed" class="lb__err">图片加载失败，请稍后重试</div>
        <div v-else-if="standaloneError" class="lb__err">{{ standaloneError }}</div>
      </div>

      <button class="arrow arrow--prev" :disabled="!hasPrev" title="上一张 (←)" @click.stop="go(-1)">
        <svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" /></svg>
      </button>
      <button class="arrow arrow--next" :disabled="!hasNext" title="下一张 (→)" @click.stop="go(1)">
        <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
      </button>

      <footer class="lb__hint">
        <kbd>←</kbd><kbd>→</kbd> 切换
        <span class="dot">·</span>
        <kbd>Esc</kbd> 关闭
        <span class="dot">·</span>
        点击空白处关闭
      </footer>
    </div>

    <aside v-if="current" class="lb__panel" @click.stop>
      <div class="pnl__scroll">
        <div class="pnl__head">
          <h3 class="pnl__name">{{ current.name || '未命名' }}</h3>
          <p v-if="current.introduction" class="pnl__sub">{{ current.introduction }}</p>
        </div>

        <div v-if="current.category || (current.tags && current.tags.length)" class="pnl__block">
          <div class="pnl__t">标签</div>
          <div class="chips">
            <span v-if="current.category" class="chip chip--cat">{{ current.category }}</span>
            <span v-for="t in current.tags" :key="t" class="chip">{{ t }}</span>
          </div>
        </div>

        <div class="pnl__block">
          <div class="pnl__t">图片信息</div>
          <div class="kv">
            <span>尺寸</span>
            <span>{{ current.picWidth || '—' }} × {{ current.picHeight || '—' }}</span>
          </div>
          <div class="kv">
            <span>大小</span>
            <span>{{ formatSize(current.picSize) }}</span>
          </div>
          <div class="kv">
            <span>格式</span>
            <span>{{ (current.picFormat || '—').toUpperCase() }}</span>
          </div>
          <div v-if="formatColor(current.picColor)" class="kv">
            <span>主色调</span>
            <span class="kv__c">
              <i class="swatch" :style="{ background: formatColor(current.picColor) || '' }" />
              {{ formatColor(current.picColor) }}
            </span>
          </div>
        </div>

        <div class="pnl__block">
          <div class="pnl__t">归属</div>
          <div class="kv">
            <span>上传者</span>
            <span>{{ current.user?.userName || current.user?.userAccount || '—' }}</span>
          </div>
          <div class="kv">
            <span>所属</span>
            <span>{{ current.spaceId ? `空间 #${current.spaceId}` : '公开图库' }}</span>
          </div>
          <div class="kv">
            <span>上传时间</span>
            <span>{{ formatTime(current.createTime) }}</span>
          </div>
        </div>
      </div>

      <div class="pnl__acts">
        <a class="act" :href="current.url" target="_blank" rel="noopener noreferrer">下载原图</a>
        <button class="act" @click="showShare = true">分享</button>

        <!-- 只有空间内的图才给入口：公共图库的图是别人的，不拿去第三方搜索 -->
        <button v-if="canImageSearch" class="act act--wide" @click="showImageSearch = true">
          以图搜图
        </button>

        <!--
          修改类操作的可见性：
            · 公共图库 → 仅上传者本人或管理员
            · 私有空间 → 空间创建者本人或管理员
            · 团队空间 → **editor / admin 成员可以编辑别人上传到该空间的图**（共同编辑）
          权限结论来自后端 permissionList，不是前端自己算的。
          没权限时这些按钮整个不出现（为什么，由 confirmDelete 的兜底提示说明）。
        -->
        <template v-if="canModify">
          <button class="act" @click="showEdit = true">编辑信息</button>
          <button v-if="canRemove" class="act act--danger" :disabled="deleting" @click="confirmDelete">
            {{ deleting ? '删除中…' : '删除' }}
          </button>
          <RouterLink class="act act--wide" :to="`/studio/${current.id}`">裁剪 / 扩图</RouterLink>
        </template>

      </div>
    </aside>

    <ShareModal v-model:show="showShare" :link="shareLink" />

    <ImageSearchModal v-model:show="showImageSearch" :picture="current" />

    <PictureEditModal
      v-model:show="showEdit"
      :picture="current"
      @saved="emit('updated')"
    />
  </div>
</template>

<style scoped>
.lb {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  background: var(--lb-stage);
  animation: lbIn 0.16s ease both;
}
@keyframes lbIn {
  from {
    opacity: 0;
  }
}
/* 主体轻微缩放进场，比整块淡入更有"打开"的质感 */
.lb__main {
  animation: lbPop 0.2s cubic-bezier(0.2, 0.7, 0.3, 1) both;
}
@keyframes lbPop {
  from {
    transform: scale(0.985);
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .lb,
  .lb__main {
    animation: none;
  }
}

/* ---------- 左侧：照片舞台 ---------- */
.lb__main {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.lb__top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 60px;
  padding: 0 18px;
  display: flex;
  align-items: center;
  gap: 12px;
  z-index: 2;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.42), transparent);
}
.lb__meta {
  min-width: 0;
}
.lb__name {
  font-size: 13.5px;
  font-weight: 500;
  color: #fff;
}
.lb__idx {
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.62);
  margin-top: 2px;
}
.ibtn {
  margin-left: auto;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(0, 0, 0, 0.28);
  color: #fff;
  display: grid;
  place-items: center;
  cursor: pointer;
  flex: 0 0 34px;
}
.ibtn svg {
  width: 16px;
  height: 16px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
}
.ibtn:hover {
  background: rgba(0, 0, 0, 0.5);
}

.lb__stage {
  flex: 1;
  min-height: 0;
  display: grid;
  place-items: center;
  padding: 68px 72px 56px;
}
.lb__stage img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 6px;
  box-shadow: 0 30px 70px -20px rgba(0, 0, 0, 0.75);
}
.lb__err {
  font-size: 13px;
  color: var(--text-secondary);
}
.spinner {
  position: absolute;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2.5px solid rgba(255, 255, 255, 0.2);
  border-top-color: var(--accent);
  animation: lbspin 0.75s linear infinite;
}
@keyframes lbspin {
  to {
    transform: rotate(360deg);
  }
}

.arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(0, 0, 0, 0.32);
  color: #fff;
  display: grid;
  place-items: center;
  cursor: pointer;
  backdrop-filter: blur(6px);
  transition: opacity 0.18s ease;
}
.arrow svg {
  width: 20px;
  height: 20px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.arrow:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.55);
}
.arrow:disabled {
  opacity: 0.25;
  cursor: not-allowed;
}
.arrow--prev {
  left: 16px;
}
.arrow--next {
  right: 16px;
}

.lb__hint {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.5);
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.lb__hint kbd {
  font-family: var(--font);
  font-size: 10.5px;
  padding: 2px 6px;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.72);
}
.dot {
  opacity: 0.4;
}

/* ---------- 右侧：信息面板 ---------- */
/*
  面板本身不滚动：中段 .pnl__scroll 滚动，页脚 .pnl__acts 固定。
  不要用「绝对定位页脚 + 面板整体滚动」—— 绝对定位元素会跟着内容一起滚，
  看似固定在底部，内容一长就跑到看不见的地方（在视觉稿上踩过一次）。
*/
.lb__panel {
  width: 320px;
  flex: 0 0 320px;
  background: var(--bg-base);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.pnl__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.pnl__block {
  min-width: 0;
}
.pnl__name {
  margin: 0 0 6px;
  font-size: 15.5px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text-primary);
  word-break: break-all;
}
.pnl__sub {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text-secondary);
}
.pnl__t {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  margin-bottom: 10px;
}
.kv {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12.5px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
  color: var(--text-secondary);
}
.kv > span:last-child {
  color: var(--text-primary);
  text-align: right;
  word-break: break-all;
}
.kv__c {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.swatch {
  width: 20px;
  height: 13px;
  border-radius: 4px;
  border: 1px solid var(--border-strong);
  display: inline-block;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 99px;
  background: var(--accent-soft);
  color: var(--accent);
}
.chip--cat {
  background: transparent;
  border: 1px solid var(--border-strong);
  color: var(--text-secondary);
}

.pnl__acts {
  flex: 0 0 auto;
  padding: 14px 20px 20px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  background: var(--bg-base);
  border-top: 1px solid var(--border);
}
.act {
  height: 38px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: 12.5px;
  font-family: var(--font);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.act:hover:not(:disabled) {
  border-color: var(--border-strong);
}
.act:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.act--danger {
  color: var(--danger);
}
.act--danger:hover:not(:disabled) {
  border-color: var(--danger);
}
.act--wide {
  grid-column: 1 / -1;
}
</style>

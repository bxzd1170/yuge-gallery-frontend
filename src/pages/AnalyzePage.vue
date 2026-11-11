<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NInput, NInputNumber, NSelect, useMessage, type SelectOption } from 'naive-ui'
import {
  getSpaceCategoryAnalyzeUsingPost,
  getSpaceRankAnalyzeUsingPost,
  getSpaceSizeAnalyzeUsingPost,
  getSpaceTagAnalyzeUsingPost,
  getSpaceUsageAnalyzeUsingPost,
  getSpaceUserAnalyzeUsingPost,
} from '@/api/spaceAnalyzeController'
import { useMySpaces } from '@/composables/useMySpaces'
import { useLoginUserStore } from '@/stores/useLoginUserStore'
import { canAnalyzeGlobal, canAnalyzeSpace, isAdmin as isAdminUser } from '@/auth/permissions'
import { formatSize } from '@/utils/format'
import WordCloud from 'wordcloud2/src/wordcloud2.js'
import { useTheme } from '@/theme/useTheme'

const message = useMessage()
const route = useRoute()
const router = useRouter()
const loginUserStore = useLoginUserStore()
const { spaces, load: loadSpaces } = useMySpaces()
const isAdmin = computed(() => isAdminUser(loginUserStore.loginUser))

/*
  鉴权比别处更严（SpaceAnalyzeServiceImpl#checkSpaceAnalyzeAuth）：
    · queryPublic / queryAll → **仅系统管理员**
    · 指定 spaceId → **仅空间创建者本人或系统管理员**（注意：空间成员也不行，走的是 checkSpaceAuth）
  所以可选范围必须按角色筛，普通用户只能分析自己创建的空间。
*/
const scope = ref<string>('')

const scopeOptions = computed<SelectOption[]>(() => {
  /*
    后端可分析范围（SpaceAnalyzeServiceImpl#checkSpaceAnalyzeAuth + SpaceServiceImpl#checkSpaceAuth）：
      · 指定空间 → 仅「空间创建者本人」或「系统管理员」
      · queryPublic / queryAll → 仅系统管理员
    列表里只有「我创建的空间(isMine)」和「我加入的团队空间」：
      → 普通用户只能选 isMine 的；管理员还能选自己加入的团队空间（管理员对任意空间都放行）
    管理员理论上能分析任意空间，但拿不到别人的空间清单（那要再查 /space/list/page），
    所以范围就是「列表里的空间 + 公共图库 + 全空间」，够用且不误导。
  */
  const base = spaces.value
    .filter((s) => s.isMine || isAdmin.value)
    .map((s) => ({ label: s.name, value: s.id }))
  if (canAnalyzeGlobal(loginUserStore.loginUser)) {
    return [{ label: '公共图库', value: 'public' }, ...base, { label: '全空间', value: 'all' }]
  }
  return base
})

/** 三个维度共用：把范围翻译成后端要的参数 */
function scopePayload(): Record<string, unknown> {
  if (scope.value === 'public') return { queryPublic: true }
  if (scope.value === 'all') return { queryAll: true }
  return scope.value ? { spaceId: scope.value as unknown as number } : {}
}

const loading = ref(false)
/*
  后端在「空间不存在」或「无分析权限」时会让六个接口全部失败。
  如果只是各自 catch 成空数组，页面会渲染出六张「暂无数据」的图 —— 
  用户会以为这个空间真的没有数据，而不是「这个空间你打不开」。
  所以这里单独留一个错误态。
*/
const loadError = ref('')

/** 六个维度全空 + 有错误 → 认为整个范围不可用 */
const scopeUnavailable = computed(
  () =>
    !!loadError.value &&
    !usage.value &&
    !categories.value.length &&
    !tags.value.length &&
    !sizes.value.length &&
    !trend.value.length,
)

/* ---------- 1. 用量 ---------- */
const usage = ref<API.SpaceUsageAnalyzeResponse | null>(null)

/* ---------- 2. 分类 ---------- */
const categories = ref<API.SpaceCategoryAnalyzeResponse[]>([])

/* ---------- 3. 标签 ---------- */
const tags = ref<API.SpaceTagAnalyzeResponse[]>([])

/* ---------- 4. 大小 ---------- */
const sizes = ref<API.SpaceSizeAnalyzeResponse[]>([])

/* ---------- 5. 上传趋势 ---------- */
const trend = ref<API.SpaceUserAnalyzeResponse[]>([])
const dimension = ref<'day' | 'week' | 'month'>('day')
const trendUserId = ref('')

/* ---------- 6. 空间排行（管理员） ---------- */
const ranking = ref<API.Space[]>([])
const topN = ref(10)

async function loadAll() {
  if (!scope.value) return
  loading.value = true
  loadError.value = ''
  const p = scopePayload()
  try {
    // 六个维度并行拉取；单个失败不影响其他图表，但要记住第一条错误
    const note = (e: unknown) => {
      if (!loadError.value) loadError.value = (e as Error)?.message || '加载失败'
    }
    const tasks: Promise<unknown>[] = [
      getSpaceUsageAnalyzeUsingPost(p as API.SpaceUsageAnalyzeRequest)
        .then((r) => (usage.value = r.data ?? null))
        .catch((e) => {
          usage.value = null
          note(e)
        }),
      getSpaceCategoryAnalyzeUsingPost(p as API.SpaceCategoryAnalyzeRequest)
        .then((r) => (categories.value = r.data ?? []))
        .catch(() => (categories.value = [])),
      getSpaceTagAnalyzeUsingPost(p as API.SpaceTagAnalyzeRequest)
        .then((r) => (tags.value = r.data ?? []))
        .catch(() => (tags.value = [])),
      getSpaceSizeAnalyzeUsingPost(p as API.SpaceSizeAnalyzeRequest)
        .then((r) => (sizes.value = r.data ?? []))
        .catch(() => (sizes.value = [])),
      loadTrend(),
    ]
    if (isAdmin.value) {
      tasks.push(
        getSpaceRankAnalyzeUsingPost({ topN: topN.value })
          .then((r) => (ranking.value = r.data ?? []))
          .catch(() => (ranking.value = [])),
      )
    }
    await Promise.all(tasks)
  } finally {
    loading.value = false
  }
}

async function loadTrend() {
  try {
    const res = await getSpaceUserAnalyzeUsingPost({
      ...scopePayload(),
      // timeDimension 只支持 day / week / month，传别的后端会抛「不支持的时间维度」
      timeDimension: dimension.value,
      ...(trendUserId.value.trim()
        ? { userId: trendUserId.value.trim() as unknown as number }
        : {}),
    } as API.SpaceUserAnalyzeRequest)
    trend.value = res.data ?? []
  } catch {
    trend.value = []
  }
}

/* ---------- 图表计算 ---------- */
const maxCategoryCount = computed(() =>
  Math.max(1, ...categories.value.map((c) => Number(c.count ?? 0))),
)
const maxSizeCount = computed(() => Math.max(1, ...sizes.value.map((s) => Number(s.count ?? 0))))
/**
 * 排行接口只 select 了 id / spaceName / totalSize / userId —— **totalCount 返回 null**，
 * 所以这里必须用 totalSize 作为指标，用 totalCount 会全部显示成 0。
 */
/* ---------- 标签云（wordcloud2 canvas 版） ---------- */
const cloudCanvas = ref<HTMLCanvasElement | null>(null)
const cloudTip = ref<{ show: boolean; x: number; y: number; text: string }>({
  show: false,
  x: 0,
  y: 0,
  text: '',
})
/** 布局放不下时退回 chip 形式，不让用户看到一块空白 */
const cloudFallback = ref(false)
const { resolved } = useTheme()

const PALETTE: Record<'dark' | 'light', string[]> = {
  dark: ['#8b95ff', '#46dfc8', '#ffc37a', '#f58e8e', '#9fe1cb', '#a9c6f7', '#d8a9f7'],
  light: ['#185fa5', '#0f6e56', '#a35f0b', '#a32d2d', '#1d9e75', '#534ab7', '#993556'],
}

/** 给每个词固定一个颜色（同一词刷新前后不变，避免悬停时跳色） */
function colorOf(word: string, theme: 'dark' | 'light') {
  let h = 0
  for (let i = 0; i < word.length; i++) h = (h * 31 + word.charCodeAt(i)) >>> 0
  const palette = PALETTE[theme]
  return palette[h % palette.length]
}

function renderCloud() {
  const cv = cloudCanvas.value
  if (!cv || !tags.value.length) return
  const host = cv.parentElement as HTMLElement
  const w = Math.max(280, host.clientWidth)
  const h = 260
  const dpr = window.devicePixelRatio || 1
  cv.width = Math.round(w * dpr)
  cv.height = Math.round(h * dpr)
  cv.style.width = w + 'px'
  cv.style.height = h + 'px'

  const list = tags.value.map((t) => [String(t.tag), Math.max(1, Number(t.count ?? 0))] as [string, number])
  const counts = list.map((x) => x[1])
  const max = Math.max(...counts)
  const min = Math.min(...counts)

  const ok = WordCloud(cv, {
    list,
    gridSize: 6,
    // 次数 → 字号：14px（最少）到 44px（最多），差距小时整体取中间值
    weightFactor: (size: number) => {
      const t = max === min ? 0.5 : (size - min) / (max - min)
      return Math.round(14 + t * 30)
    },
    fontFamily: getComputedStyle(cv).fontFamily || 'sans-serif',
    color: (word: string) => colorOf(word, resolved.value),
    backgroundColor: 'transparent',
    rotateRatio: 0.55,
    minRotation: -Math.PI / 2,
    maxRotation: Math.PI / 2,
    rotationSteps: 2,
    hover: (item, dim, ev) => {
      if (item && dim) {
        const hostBox = host.getBoundingClientRect()
        cloudTip.value = {
          show: true,
          x: Math.min(ev.clientX - hostBox.left + 10, w - 90),
          y: Math.min(ev.clientY - hostBox.top + 12, h - 30),
          text: `${item[0]}：${item[1]} 次`,
        }
      } else {
        cloudTip.value.show = false
      }
    },
  })
  cloudFallback.value = !ok
}

/** 数据或主题变化时重画（主题影响配色） */
watch([tags, resolved], async () => {
  await nextTick()
  renderCloud()
})

/** 窗口宽度变化时按容器宽度重排 */
let cloudResizeTimer = 0
function onCloudResize() {
  if (!tags.value.length) return
  window.clearTimeout(cloudResizeTimer)
  cloudResizeTimer = window.setTimeout(renderCloud, 200)
}

const maxRankSize = computed(() => Math.max(1, ...ranking.value.map((r) => Number(r.totalSize ?? 0))))


/** 折线图：把 period/count 映射到 SVG 坐标 */
const CHART = { w: 640, h: 180, padL: 34, padR: 12, padT: 14, padB: 26 }
const trendMax = computed(() => Math.max(1, ...trend.value.map((t) => Number(t.count ?? 0))))

const trendPoints = computed(() => {
  const pts = trend.value.map((t, i) => {
    const n = trend.value.length
    const x =
      n === 1
        ? CHART.padL + (CHART.w - CHART.padL - CHART.padR) / 2
        : CHART.padL + (i / (n - 1)) * (CHART.w - CHART.padL - CHART.padR)
    const y =
      CHART.h -
      CHART.padB -
      (Number(t.count ?? 0) / trendMax.value) * (CHART.h - CHART.padT - CHART.padB)
    return { x, y, label: String(t.period ?? ''), count: Number(t.count ?? 0) }
  })
  return pts
})

const trendLine = computed(() => trendPoints.value.map((p) => `${p.x},${p.y}`).join(' '))
const trendArea = computed(() => {
  const pts = trendPoints.value
  if (!pts.length) return ''
  const base = CHART.h - CHART.padB
  return `M ${pts[0].x},${base} L ${pts.map((p) => `${p.x},${p.y}`).join(' L ')} L ${pts[pts.length - 1].x},${base} Z`
})
/** x 轴最多显示 6 个标签，避免密集重叠 */
const trendTicks = computed(() => {
  const pts = trendPoints.value
  if (pts.length <= 6) return pts
  const step = Math.ceil(pts.length / 6)
  return pts.filter((_, i) => i % step === 0)
})

const scopeName = computed(() => {
  if (scope.value === 'public') return '公共图库'
  if (scope.value === 'all') return '全空间'
  return spaces.value.find((s) => s.id === scope.value)?.name ?? '—'
})

/* ---------- 初始化 ---------- */
async function resolveScope() {
  const raw = String(route.params.spaceId ?? '')
  const mine = spaces.value.filter((s) => s.isMine)
  if (raw === 'auto' || raw === '0' || !raw) {
    // 自动挑一个能分析的维度：优先自己的空间，管理员兜底到公共图库
    // 注意要直接给 scope 赋值 —— 只 router.replace 的话组件不会重新走 onMounted，
    // 结果就是地址栏对了、页面却还是空状态
    scope.value = mine[0]?.id ?? (isAdmin.value ? 'public' : '')
    return
  }
  scope.value = raw
}

onMounted(() => {
  window.addEventListener('resize', onCloudResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', onCloudResize)
})

onMounted(async () => {
  if (!loginUserStore.fetched) await loginUserStore.fetchLoginUser()
  await loadSpaces(loginUserStore.loginUser?.id)
  await resolveScope()
  if (scope.value) await loadAll()
})

watch(scope, (v) => {
  if (!v) return
  // 把选择同步到地址栏，便于分享
  if (String(route.params.spaceId) !== v) router.replace({ name: 'analyze', params: { spaceId: v } })
  loadAll()
})

watch(dimension, () => {
  if (scope.value) loadTrend()
})

/** 地址栏里的范围被改（比如从图标栏点「分析」进来）时重新解析 */
watch(
  () => route.params.spaceId,
  (v) => {
    const raw = String(v ?? '')
    if (raw && raw !== scope.value) resolveScope()
  },
)
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <h2>空间分析</h2>
      <div class="pill">{{ scopeName }}</div>
      <div class="toolbar__right">
        <n-select
          v-model:value="scope"
          :options="scopeOptions"
          size="small"
          style="min-width: 220px"
          placeholder="选择分析范围"
        />
        <button class="ghost-btn" :disabled="loading" @click="loadAll">
          {{ loading ? '加载中…' : '刷新' }}
        </button>
      </div>
    </div>

    <div class="hint">
      分析范围只有「你自己创建的空间」可用；<b>公共图库</b>与<b>全空间</b>仅管理员可选。
      注意：分析权限比看图更严格 —— 空间成员也不能分析，只有空间创建者本人可以。
    </div>

    <div v-if="!scope" class="empty">你还没有可分析的空间</div>

    <!-- 空间不存在 / 无权限时明确报错，而不是渲染六张「暂无数据」让人误以为没数据 -->
    <div v-else-if="scopeUnavailable" class="fail">
      <div class="fail__t">无法加载「{{ scopeName }}」的分析数据</div>
      <div class="fail__m">{{ loadError }}</div>
      <div class="fail__h">
        常见原因：该空间不存在、已被删除，或者你不是它的创建者（分析只允许
        <b>空间创建者本人或系统管理员</b>，空间成员也不行）。
      </div>
      <button class="ghost-btn" @click="router.push('/spaces')">去我的空间</button>
    </div>

    <template v-else>
      <!-- 1. 用量 -->
      <section class="cardx">
        <div class="cardx__h">用量概览</div>
        <!--
          公共图库 / 全空间模式下后端返回的 maxSize / maxCount / 比率全是 null（没有配额概念），
          这时只能显示实际用量，不能显示「/ 0」和「已用 0%」那样会误导人的分母。
        -->
        <template v-if="usage">
          <div class="meters">
            <div class="meter">
              <div class="meter__l">
                <span>图片数量</span>
                <b>
                  {{ usage.usedCount ?? 0 }}
                  <template v-if="usage.maxCount != null"> / {{ usage.maxCount }}</template>
                </b>
              </div>
              <div v-if="usage.countUsageRatio != null" class="bar">
                <i :style="{ width: Math.min(100, Number(usage.countUsageRatio) * 100) + '%' }" />
              </div>
              <div v-if="usage.countUsageRatio != null" class="meter__s">
                已用 {{ (Number(usage.countUsageRatio) * 100).toFixed(1) }}%
              </div>
            </div>
            <div class="meter">
              <div class="meter__l">
                <span>存储容量</span>
                <b>
                  {{ formatSize(usage.usedSize) }}
                  <template v-if="usage.maxSize != null"> / {{ formatSize(usage.maxSize) }}</template>
                </b>
              </div>
              <div v-if="usage.sizeUsageRatio != null" class="bar">
                <i :style="{ width: Math.min(100, Number(usage.sizeUsageRatio) * 100) + '%' }" />
              </div>
              <div v-if="usage.sizeUsageRatio != null" class="meter__s">
                已用 {{ (Number(usage.sizeUsageRatio) * 100).toFixed(1) }}%
              </div>
            </div>
          </div>
          <div v-if="usage.maxCount == null" class="meter__note">
            当前范围没有配额上限（公共图库 / 全空间不属于任何空间），因此只显示实际用量。
          </div>
        </template>
        <div v-else class="none">暂无数据</div>
      </section>

      <div class="cols">
        <!-- 2. 分类 -->
        <section class="cardx">
          <div class="cardx__h">分类分布</div>
          <div v-if="categories.length" class="hbars">
            <div v-for="c in categories" :key="String(c.category)" class="hbar">
              <span class="hbar__k ellipsis">{{ c.category || '未分类' }}</span>
              <div class="hbar__t">
                <i :style="{ width: (Number(c.count ?? 0) / maxCategoryCount) * 100 + '%' }" />
              </div>
              <span class="hbar__v">{{ c.count }} 张 · {{ formatSize(c.totalSize) }}</span>
            </div>
          </div>
          <div v-else class="none">暂无分类数据</div>
        </section>

        <!-- 4. 大小 -->
        <section class="cardx">
          <div class="cardx__h">文件大小分布</div>
          <div v-if="sizes.length" class="vbars">
            <div v-for="s in sizes" :key="String(s.sizeRange)" class="vbar">
              <span class="vbar__n">{{ s.count }}</span>
              <div class="vbar__t">
                <i :style="{ height: (Number(s.count ?? 0) / maxSizeCount) * 100 + '%' }" />
              </div>
              <span class="vbar__k">{{ s.sizeRange }}</span>
            </div>
          </div>
          <div v-else class="none">暂无数据</div>
        </section>
      </div>

      <!-- 3. 标签云：wordcloud2 canvas 版（与原版 echarts-wordcloud 同源的底层库） -->
      <section class="cardx">
        <div class="cardx__h">标签云<span class="cardx__s">字号大小 = 使用次数 · 悬停查看次数</span></div>
        <div v-if="tags.length" class="cloud">
          <canvas ref="cloudCanvas" class="cloud__cv"></canvas>
          <div v-if="cloudTip.show" class="cloud__tip" :style="{ left: cloudTip.x + 'px', top: cloudTip.y + 'px' }">
            {{ cloudTip.text }}
          </div>
        </div>
        <!-- 容器太窄、布局失败时退回 chip 形式 -->
        <div v-else-if="cloudFallback && tags.length" class="cloud cloud--chip">
          <span v-for="t in tags" :key="String(t.tag)" class="cloud__chip">
            {{ t.tag }}<em>{{ t.count }}</em>
          </span>
        </div>
        <div v-else class="none">暂无标签数据</div>
      </section>

      <!-- 5. 上传趋势 -->
      <section class="cardx">
        <div class="cardx__h">
          上传趋势
          <span class="cardx__s">按 {{ dimension === 'day' ? '日' : dimension === 'week' ? '周' : '月' }} 统计</span>
          <div class="cardx__r">
            <n-input
              v-model:value="trendUserId"
              size="tiny"
              placeholder="用户 ID（留空=全部）"
              style="width: 160px"
              @keyup.enter="loadTrend"
            />
            <div class="seg">
              <button :class="{ on: dimension === 'day' }" @click="dimension = 'day'">日</button>
              <button :class="{ on: dimension === 'week' }" @click="dimension = 'week'">周</button>
              <button :class="{ on: dimension === 'month' }" @click="dimension = 'month'">月</button>
            </div>
            <button class="ghost-btn ghost-btn--sm" @click="loadTrend">查询</button>
          </div>
        </div>

        <div v-if="trend.length" class="chart">
          <svg :viewBox="`0 0 ${CHART.w} ${CHART.h}`" preserveAspectRatio="none" class="chart__svg">
            <!-- y 轴网格 0 / 50% / 100% -->
            <g stroke="var(--border)" stroke-width="1">
              <line
                v-for="r in 3"
                :key="r"
                :x1="CHART.padL"
                :x2="CHART.w - CHART.padR"
                :y1="CHART.padT + ((r - 1) / 2) * (CHART.h - CHART.padT - CHART.padB)"
                :y2="CHART.padT + ((r - 1) / 2) * (CHART.h - CHART.padT - CHART.padB)"
              />
            </g>
            <path :d="trendArea" fill="var(--accent)" opacity="0.14" />
            <polyline :points="trendLine" fill="none" stroke="var(--accent)" stroke-width="2" />
          </svg>
          <div class="chart__pts">
            <span
              v-for="(p, i) in trendPoints"
              :key="i"
              class="chart__dot"
              :style="{ left: (p.x / CHART.w) * 100 + '%', top: (p.y / CHART.h) * 100 + '%' }"
              :title="`${p.label}：${p.count}`"
            />
          </div>
          <div class="chart__x">
            <span v-for="(t, i) in trendTicks" :key="i">{{ t.label }}</span>
          </div>
          <div class="chart__max">峰值 {{ trendMax }} 张</div>
        </div>
        <div v-else class="none">暂无上传记录</div>
      </section>

      <!-- 6. 空间排行（管理员） -->
      <section v-if="isAdmin" class="cardx">
        <div class="cardx__h">
          空间使用排行
          <div class="cardx__r">
            <n-input-number v-model:value="topN" size="tiny" :min="1" :max="50" style="width: 90px" />
            <button class="ghost-btn ghost-btn--sm" @click="loadAll">刷新</button>
          </div>
        </div>
        <div v-if="ranking.length" class="hbars">
          <div v-for="(s, i) in ranking" :key="s.id" class="hbar">
            <span class="hbar__i">{{ i + 1 }}</span>
            <span class="hbar__k ellipsis">{{ s.spaceName || `空间 ${s.id}` }}</span>
            <div class="hbar__t">
              <i :style="{ width: (Number(s.totalSize ?? 0) / maxRankSize) * 100 + '%' }" />
            </div>
            <span class="hbar__v">{{ formatSize(s.totalSize) }}</span>
          </div>
        </div>
        <div v-else class="none">暂无数据</div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
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
.ghost-btn--sm {
  height: 28px;
  padding: 0 10px;
  font-size: 11.5px;
}
.hint {
  font-size: 11.5px;
  line-height: 1.8;
  color: var(--text-tertiary);
  margin-bottom: 14px;
}
.hint b {
  color: var(--text-secondary);
}
.hint code {
  background: var(--accent-soft);
  color: var(--accent);
  padding: 1px 5px;
  border-radius: 4px;
}
.cardx {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 15px 17px 17px;
  margin-bottom: 14px;
}
.cardx__h {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13.5px;
  font-weight: 600;
  margin-bottom: 14px;
}
.cardx__s {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-tertiary);
}
.cardx__r {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
.cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
@media (max-width: 900px) {
  .cols {
    grid-template-columns: 1fr;
  }
}
.fail {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 26px;
  text-align: center;
}
.fail__t {
  font-size: 14.5px;
  font-weight: 600;
  margin-bottom: 8px;
}
.fail__m {
  font-size: 12.5px;
  color: var(--danger);
  margin-bottom: 10px;
}
.fail__h {
  font-size: 12px;
  line-height: 1.85;
  color: var(--text-tertiary);
  margin-bottom: 16px;
}
.fail__h b {
  color: var(--text-secondary);
}
.none,
.empty {
  padding: 22px;
  text-align: center;
  font-size: 12.5px;
  color: var(--text-tertiary);
}
.empty {
  border: 1px dashed var(--border-strong);
  border-radius: var(--r-md);
}

.meters {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.meter__l {
  display: flex;
  justify-content: space-between;
  font-size: 12.5px;
  color: var(--text-secondary);
  margin-bottom: 7px;
}
.meter__l b {
  color: var(--text-primary);
}
.meter__s {
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-tertiary);
}
.meter__note {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  font-size: 11.5px;
  color: var(--text-tertiary);
}
.bar {
  height: 7px;
  border-radius: 99px;
  background: var(--accent-soft);
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  border-radius: 99px;
  background: linear-gradient(90deg, var(--accent), var(--accent-2));
  transition: width 0.3s ease;
}

.hbars {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.hbar {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}
.hbar__i {
  width: 16px;
  flex: 0 0 16px;
  color: var(--text-tertiary);
  font-size: 11px;
}
.hbar__k {
  width: 92px;
  flex: 0 0 92px;
  color: var(--text-secondary);
}
.hbar__t {
  flex: 1;
  height: 8px;
  border-radius: 99px;
  background: var(--accent-soft);
  overflow: hidden;
}
.hbar__t i {
  display: block;
  height: 100%;
  border-radius: 99px;
  background: var(--accent);
  transition: width 0.3s ease;
}
.hbar__v {
  flex: 0 0 118px;
  text-align: right;
  color: var(--text-tertiary);
  font-size: 11px;
}

.vbars {
  display: flex;
  align-items: flex-end;
  justify-content: space-around;
  gap: 12px;
  height: 170px;
  padding-top: 8px;
}
.vbar {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
}
.vbar__n {
  font-size: 11.5px;
  color: var(--text-secondary);
  margin-bottom: 5px;
}
.vbar__t {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
}
.vbar__t i {
  display: block;
  width: 100%;
  border-radius: 6px 6px 0 0;
  background: linear-gradient(180deg, var(--accent), var(--accent-2));
  min-height: 2px;
  transition: height 0.3s ease;
}
.vbar__k {
  margin-top: 7px;
  font-size: 10.5px;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.cloud {
  position: relative;
  height: 260px;
}
.cloud__cv {
  display: block;
}
.cloud__tip {
  position: absolute;
  z-index: 2;
  padding: 4px 9px;
  border-radius: var(--r-sm);
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  font-size: 11.5px;
  color: var(--text-primary);
  pointer-events: none;
  white-space: nowrap;
}
.cloud--chip {
  height: auto;
  display: flex;
  flex-wrap: wrap;
  gap: 10px 12px;
}
.cloud__chip {
  padding: 4px 11px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-size: 12px;
}
.cloud__chip em {
  font-style: normal;
  margin-left: 5px;
  color: var(--text-tertiary);
  font-size: 10px;
}

.chart {
  position: relative;
  padding-bottom: 18px;
}
.chart__svg {
  width: 100%;
  height: 180px;
  display: block;
}
.chart__pts {
  position: absolute;
  inset: 0 0 18px 0;
  pointer-events: none;
}
.chart__dot {
  position: absolute;
  width: 7px;
  height: 7px;
  margin: -3.5px 0 0 -3.5px;
  border-radius: 50%;
  background: var(--accent);
  border: 1.5px solid var(--bg-surface);
  pointer-events: auto;
}
.chart__x {
  display: flex;
  justify-content: space-between;
  font-size: 10.5px;
  color: var(--text-tertiary);
  padding: 0 4px;
}
.chart__max {
  position: absolute;
  top: 0;
  right: 0;
  font-size: 10.5px;
  color: var(--text-tertiary);
}
.seg {
  display: flex;
  gap: 4px;
}
.seg button {
  height: 26px;
  padding: 0 10px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  font-family: var(--font);
  font-size: 11.5px;
  cursor: pointer;
}
.seg button.on {
  background: var(--accent-soft);
  border-color: transparent;
  color: var(--accent);
}
</style>

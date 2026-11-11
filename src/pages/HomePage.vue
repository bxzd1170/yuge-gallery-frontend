<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NDropdown, useMessage } from 'naive-ui'
import {
  listPictureTagCategoryUsingGet,
  listPictureVoByPageUsingPost,
  searchPictureByColorUsingPost,
} from '@/api/pictureController'
import { getSpaceVoByIdUsingGet } from '@/api/spaceController'
import { isSelf } from '@/auth/permissions'
import { countFilters, toQueryFilters, type PictureFilters } from '@/types/pictureFilter'
import { formatSize } from '@/utils/format'
import { useLoginUserStore } from '@/stores/useLoginUserStore'
import PictureCard from '@/components/gallery/PictureCard.vue'
import PageBar from '@/components/ui/PageBar.vue'
import SpaceMembersModal from '@/components/space/SpaceMembersModal.vue'
import PictureFilterDrawer from '@/components/gallery/PictureFilterDrawer.vue'

const route = useRoute()
const router = useRouter()
const loginUserStore = useLoginUserStore()
const message = useMessage()

/**
 * 打开 Lightbox：沿用当前路由名与参数，只补一个 pictureId。
 * 这样同一份代码在个人画廊(/p/:id)与空间画廊(/s/:spaceId/p/:id)下都能正确跳转。
 * 雪花 ID 在 JSON 里是字符串（超出 JS 安全整数），统一 String() 后再拼路由。
 */
function openPicture(p: API.PictureVO) {
  if (!p.id) return
  const pictureId = String(p.id)
  /*
    游客只能看列表，点卡片先引导登录（2026-10-25 产品约定）。
    注意这里只拦「站内点击」这一条路径：别人发来的分享深链直接命中 /p/:id 路由，
    不经过本函数 —— 所以分享链接对游客仍然可看，不会因为这条规则变成废链接。
  */
  if (!loginUserStore.loginUser?.id) {
    message.info('登录后可查看大图')
    const target = spaceId.value ? `/s/${spaceId.value}/p/${pictureId}` : `/p/${pictureId}`
    router.push({ path: '/login', query: { redirect: target } })
    return
  }
  /*
    必须显式指定「大图」子路由的名字。
    从画廊点卡片时 route.name 是父路由（home / space，路径不含 p/:pictureId），
    只往父路由塞 pictureId 参数是不会跳到子路由的 —— URL 会原地不动、大图打不开。
    Lightbox 内部的翻图则可以沿用当前路由名，因为那时 route.name 已经是子路由了。
  */
  if (spaceId.value) {
    router.push({ name: 'spacePicture', params: { spaceId: spaceId.value, pictureId } })
  } else {
    router.push({ name: 'picture', params: { pictureId } })
  }
}

/**
 * 当前是否处于某个空间画廊。
 * 后端对两种图库的处理不同：不传 spaceId 时它会强制 spaceId IS NULL + reviewStatus=已过审，
 * 传 spaceId 时只校验 picture:view 权限、不覆盖 reviewStatus。
 * 所以前端只负责传 spaceId，过滤规则交给后端，避免两边各猜一套。
 */
const spaceId = computed(() => (route.params.spaceId ? String(route.params.spaceId) : ''))
const inSpace = computed(() => !!spaceId.value)

/** 空间信息（名称/等级/配额/我的权限），仅空间画廊下加载 */
const spaceInfo = ref<API.SpaceVO | null>(null)
const spaceCanUpload = ref(true)

/**
 * 能否管理这个空间的成员 —— 直接用后端 permissionList 里的 `spaceUser:manage`。
 * 不自己算角色：后端 `spaceUserAuthConfig.json` 才是权威，团队空间只有 admin 角色有这条。
 */
const spaceCanManageMembers = computed(
  () => Boolean(spaceInfo.value?.permissionList?.includes('spaceUser:manage')),
)
const showMembersModal = ref(false)

/* ============================================================
   排序
   ------------------------------------------------------------
   后端 `getQueryWrapper` 里是 `orderBy(..., sortField)` —— **列名直接拼进 SQL**，
   而且**没有白名单校验**。所以这里的 sortField 只能来自下面这份固定枚举，
   绝不能把任何外部输入（URL 参数、用户输入）直接透传过去，否则就是 SQL 注入面。
   ============================================================ */
const SORT_PRESETS = [
  { label: '最新上传', key: 'createTime:descend' },
  { label: '最早上传', key: 'createTime:ascend' },
  { label: '最近编辑', key: 'editTime:descend' },
  { label: '名称 A→Z', key: 'name:ascend' },
  { label: '体积从大到小', key: 'picSize:descend' },
  { label: '体积从小到大', key: 'picSize:ascend' },
] as const

const sort = ref({ field: 'createTime', order: 'descend' })
const sortKey = computed(() => `${sort.value.field}:${sort.value.order}`)
const sortLabel = computed(() => SORT_PRESETS.find((o) => o.key === sortKey.value)?.label ?? '最新上传')
/** 非默认排序时按钮高亮，让人知道"现在不是按时间排的" */
const sortChanged = computed(() => sortKey.value !== 'createTime:descend')

const sortOptions = computed(() =>
  SORT_PRESETS.map((o) => ({
    label: (o.key === sortKey.value ? '✓ ' : '　') + o.label,
    key: o.key,
  })),
)

function onSortSelect(key: string) {
  const [field, order] = key.split(':')
  sort.value = { field, order }
  loadPage(1)
}

/* ============================================================
   空间内搜索 / 筛选
   ------------------------------------------------------------
   进到空间之后直接筛，不用跳到全局搜索中心再绕回来。
   条件走 `/picture/list/page/vo`（分页正常）；按色搜索是独立接口，
   结果无分页（后端 .limit(12)），所以单独用 colorMode 标记。
   ============================================================ */
const showFilter = ref(false)
const filters = ref<PictureFilters>({})
const filterCount = computed(() => countFilters(filters.value))

/** 非 null = 当前展示的是按色搜索结果（此时不能翻页） */
const colorMode = ref<{ color: string; count: number } | null>(null)

/**
 * 按色搜索的权限：后端写死 `space.userId.equals(loginUser.id)` ——
 * 只有空间创建者本人，成员和系统管理员都不行，所以直接用 isSelf 判断。
 */
const canColorSearch = computed(
  () => inSpace.value && isSelf(loginUserStore.loginUser, spaceInfo.value?.userId),
)

/* ---------- 快捷筛选：分类 tab + 标签 chip ----------
   为什么要做：抽屉里的分类/标签要两步才能点到，而它们恰恰是最常用的两个维度。
   数据源只有一个 —— `/picture/tag_category`（固定词表，不是热度统计），
   所以这里只做「按词表筛」，不编造"热门/常备注"的说法。
   · 分类：单选（后端 `category` 是 eq）
   · 标签：多选（后端是「同时包含」，见 PictureServiceImpl#getQueryWrapper）
*/
const tagVocab = ref<string[]>([])
const categoryVocab = ref<string[]>([])

async function loadVocab() {
  try {
    const res = await listPictureTagCategoryUsingGet()
    categoryVocab.value = res.data?.categoryList ?? []
    tagVocab.value = res.data?.tagList ?? []
  } catch {
    // 词表拿不到就不显示这一栏，不影响正常浏览
    tagVocab.value = []
    categoryVocab.value = []
  }
}

const selectedTags = computed(() => filters.value.tags ?? [])

/** 分类单选：再点一次取消 */
function toggleCategory(c: string) {
  filters.value = {
    ...filters.value,
    category: filters.value.category === c ? undefined : c,
  }
  colorMode.value = null
  loadPage(1)
}

/** 标签多选：再点一次移除。全部取消时把字段置空，避免空数组被当成一项筛选 */
function toggleTag(t: string) {
  const cur = selectedTags.value
  const next = cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]
  filters.value = { ...filters.value, tags: next.length ? next : undefined }
  colorMode.value = null
  loadPage(1)
}

/** 「全部」= 清掉分类这一个条件，其他筛选保留 */
function clearCategoryFilter() {
  if (!filters.value.category) return
  filters.value = { ...filters.value, category: undefined }
  colorMode.value = null
  loadPage(1)
}

/** 只清标签，不动其他条件 */
function clearTagFilter() {
  if (!selectedTags.value.length) return
  filters.value = { ...filters.value, tags: undefined }
  colorMode.value = null
  loadPage(1)
}

function applyFilters(f: PictureFilters) {
  filters.value = f
  colorMode.value = null
  loadPage(1)
}

function clearFilters() {
  filters.value = {}
  colorMode.value = null
  loadPage(1)
}

async function runColorSearch(color: string) {
  if (!spaceId.value) return
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await searchPictureByColorUsingPost({
      spaceId: spaceId.value as unknown as number,
      picColor: color,
    })
    pictures.value = res.data ?? []
    total.value = pictures.value.length
    colorMode.value = { color, count: pictures.value.length }
    // 按色搜索和字段筛选互斥，避免两套条件叠在一起让人误解
    filters.value = {}
    current.value = 1
    scrollContentToTop()
  } catch (e) {
    errorMsg.value = (e as Error).message || '按色搜索失败'
  } finally {
    loading.value = false
  }
}

async function loadSpaceInfo() {
  if (!spaceId.value) {
    spaceInfo.value = null
    spaceCanUpload.value = true
    return
  }
  try {
    const res = await getSpaceVoByIdUsingGet({ id: spaceId.value as unknown as number })
    spaceInfo.value = res.data ?? null
    // 权限列表只有空间详情接口会返回，用它判断能否往这里上传
    spaceCanUpload.value = (res.data?.permissionList ?? []).includes('picture:upload')
  } catch {
    spaceInfo.value = null
  }
}

/** 视图模式：等高网格 / 等比瀑布流 */
const view = ref<'grid' | 'masonry'>('grid')

const pictures = ref<API.PictureVO[]>([])
const total = ref(0)
const current = ref(1)
const loading = ref(false)
const errorMsg = ref('')

/**
 * 后端 PictureController#listPictureVOByPage 有防爬虫限制：
 *   ThrowUtils.throwIf(size > 20, ErrorCode.PARAMS_ERROR);
 * 因此 pageSize 绝对不能超过 20，否则直接返回「请求参数错误」。
 */
const PAGE_SIZE = 20

/**
 * 列数随窗口宽度自适应（网格与瀑布流共用）。
 * 注意瀑布流不要用 CSS `columns` —— 它是「按列填充」，
 * 会让最新图片全堆在最左列、横向阅读顺序错乱。
 * 这里用「序号 % 列数」分配到多列 flex，保证横向仍是时间顺序。
 */
const columnCount = ref(5)
function syncColumnCount() {
  const w = window.innerWidth
  columnCount.value = w < 680 ? 2 : w < 940 ? 3 : w < 1220 ? 4 : 5
}

const pictureColumns = computed(() => {
  const cols: API.PictureVO[][] = Array.from({ length: columnCount.value }, () => [])
  pictures.value.forEach((p, i) => cols[i % columnCount.value].push(p))
  return cols
})

const skeletonBars = [0.62, 0.86, 0.74, 0.95]

/** 页面根元素：翻页后需要从它向上找到滚动容器 */
const pageEl = ref<HTMLElement | null>(null)

async function loadPage(page: number, opts: { keepScroll?: boolean } = {}) {
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await listPictureVoByPageUsingPost({
      current: page,
      pageSize: PAGE_SIZE,
      // 只允许用固定预设里的字段（后端对 sortField 没有白名单）
      sortField: sort.value.field,
      sortOrder: sort.value.order,
      // 空间画廊才传 spaceId（雪花 ID 必须按字符串传）；
      // 不传 reviewStatus —— 公共图库由后端强制「spaceId IS NULL + 只看已过审」，
      // 空间则由后端按权限放行。注意公共图库**不会**按 userId 过滤，是所有人共享的。
      ...(spaceId.value ? { spaceId: spaceId.value as unknown as number } : {}),
      // 筛选条件（字段与后端 getQueryWrapper 一一对应，见 types/pictureFilter.ts）
      ...toQueryFilters(filters.value),
    })
    pictures.value = res.data?.records ?? []
    total.value = Number(res.data?.total ?? pictures.value.length)
    current.value = page
    // 翻页才回顶；因删除/编辑而原地刷新时保持滚动位置，
    // 否则关掉 Lightbox 会看到画廊莫名跳回顶部
    if (!opts.keepScroll) scrollContentToTop()
  } catch (e) {
    errorMsg.value = (e as Error).message || '加载失败'
  } finally {
    loading.value = false
  }
}

/** 翻页后回到顶部，否则第 2 页会停在上一页的滚动位置 */
function scrollContentToTop() {
  const box = pageEl.value?.closest('.content') as HTMLElement | null
  if (box) box.scrollTo({ top: 0, behavior: 'smooth' })
  else window.scrollTo({ top: 0, behavior: 'smooth' })
}

const title = computed(() => (route.meta.title as string) || '公共图库')

/** 在空间之间切换时重置到第一页并重新取空间信息 */
watch(spaceId, async (id, old) => {
  if (id === old) return
  // 换了空间，之前那个空间的筛选条件不该带过来
  filters.value = {}
  colorMode.value = null
  await loadSpaceInfo()
  loadPage(1)
})

onMounted(async () => {
  syncColumnCount()
  window.addEventListener('resize', syncColumnCount)
  if (!loginUserStore.fetched) {
    await loginUserStore.fetchLoginUser()
  }
  await loadSpaceInfo()
  loadPage(1)
  // 分类/标签词表是全局的，只需取一次
  loadVocab()
})

onUnmounted(() => {
  window.removeEventListener('resize', syncColumnCount)
})
</script>

<template>
  <div ref="pageEl" class="page">
    <div class="toolbar">
      <h2 v-if="!inSpace">{{ title }}</h2>
      <template v-else>
        <RouterLink to="/spaces" class="back" title="返回空间列表">
          <svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" /></svg>
        </RouterLink>
        <h2>{{ spaceInfo?.spaceName || `空间 ${spaceId}` }}</h2>
        <span v-if="spaceInfo" class="badge">{{ spaceInfo.spaceType === 1 ? '团队' : '私有' }}</span>
      </template>

      <div class="pill">{{ total }} 张图片</div>

      <div v-if="inSpace && spaceInfo" class="quota-inline">
        <span>{{ spaceInfo.totalCount ?? 0 }}/{{ spaceInfo.maxCount ?? 0 }} 张</span>
        <span class="dot" />
        <span>{{ formatSize(spaceInfo.totalSize) }} / {{ formatSize(spaceInfo.maxSize) }}</span>
      </div>

      <div v-if="inSpace && !spaceCanUpload" class="noauth">当前角色没有上传权限</div>

      <div class="toolbar__right">
        <!--
          成员管理入口：**只对团队空间显示**。
          私有空间虽然后端也给了 spaceUser:manage（本人=ADMIN 全集），
          但私有空间根本没有"成员"概念 —— 图片只有创建者本人能访问，加了人也看不到任何东西。
          之前只判了 permissionList，导致私有空间也冒出一个"成员"按钮，纯属误导。
        -->
        <button
          v-if="inSpace && spaceInfo?.spaceType === 1 && spaceCanManageMembers"
          class="iconbtn"
          title="成员管理"
          @click="showMembersModal = true"
        >
          <svg viewBox="0 0 24 24">
            <circle cx="9" cy="8" r="3.2" />
            <path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" />
            <path d="M16 5.2a3 3 0 010 5.6M17.5 14.6c2 .5 3.2 2 3.6 4.4" />
          </svg>
        </button>
        <div class="seg">
          <div :class="{ on: view === 'grid' }" @click="view = 'grid'">网格</div>
          <div :class="{ on: view === 'masonry' }" @click="view = 'masonry'">瀑布流</div>
        </div>
        <n-dropdown
          :options="sortOptions"
          trigger="click"
          :disabled="!!colorMode"
          @select="onSortSelect"
        >
          <button
            class="iconbtn"
            :class="{ 'is-on': sortChanged }"
            :title="colorMode ? '按色搜索结果不支持排序' : `排序：${sortLabel}`"
          >
            <svg viewBox="0 0 24 24"><path d="M4 7h16M6 12h12M9 17h6" /></svg>
          </button>
        </n-dropdown>
        <!-- 搜索 / 筛选：进到空间后直接在这里筛，不用跳走 -->
        <button
          class="iconbtn iconbtn--search"
          :class="{ 'is-on': filterCount > 0 || colorMode }"
          :title="inSpace ? '在这个空间里搜索 / 筛选' : '在公共图库里搜索 / 筛选'"
          @click="showFilter = true"
        >
          <svg viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M20 20l-4.2-4.2" />
          </svg>
          <span v-if="filterCount" class="iconbtn__n">{{ filterCount }}</span>
          <span v-else-if="colorMode" class="iconbtn__dot" />
        </button>
      </div>
    </div>

    <!--
      快捷筛选：分类 / 标签直接铺在列表上方，不用打开抽屉。
      词表来自 /picture/tag_category（固定词表，不是使用频次统计）。
    -->
    <div v-if="!colorMode && (categoryVocab.length || tagVocab.length)" class="quick">
      <div v-if="categoryVocab.length" class="quick__row">
        <span class="quick__l">分类</span>
        <div class="quick__items">
          <button class="chip" :class="{ on: !filters.category }" @click="clearCategoryFilter">全部</button>
          <button
            v-for="c in categoryVocab"
            :key="c"
            class="chip"
            :class="{ on: filters.category === c }"
            @click="toggleCategory(c)"
          >
            {{ c }}
          </button>
        </div>
      </div>

      <div v-if="tagVocab.length" class="quick__row">
        <span class="quick__l">
          标签
          <span v-if="selectedTags.length" class="quick__n">{{ selectedTags.length }}</span>
        </span>
        <div class="quick__items">
          <button
            v-for="t in tagVocab"
            :key="t"
            class="chip"
            :class="{ on: selectedTags.includes(t) }"
            @click="toggleTag(t)"
          >
            {{ t }}
          </button>
          <button v-if="selectedTags.length" class="chip chip--ghost" @click="clearTagFilter">
            清除标签
          </button>
        </div>
      </div>
    </div>

    <!-- 筛选 / 按色搜索的状态条：让人清楚"现在看的不是全部图片" -->
    <div v-if="colorMode || filterCount" class="fbar">
      <span class="fbar__l">
        <template v-if="colorMode">
          按色搜索
          <i class="fbar__swatch" :style="{ background: colorMode.color }" />
          <code>{{ colorMode.color }}</code>
          · {{ colorMode.count }} 张
          <span class="fbar__note">最多 12 张且不支持分页</span>
        </template>
        <template v-else>已应用 {{ filterCount }} 项筛选条件</template>
      </span>
      <button class="fbar__x" @click="clearFilters">清除</button>
    </div>

    <!-- 错误 -->
    <div v-if="errorMsg" class="state state--err">
      <div class="state__t">数据加载失败</div>
      <div class="state__s">{{ errorMsg }}</div>
      <button class="state__btn" @click="loadPage(current)">重试</button>
    </div>

    <!-- 骨架 -->
    <template v-else-if="loading">
      <div v-if="view === 'grid'" class="grid" :style="{ '--cols': String(columnCount) }">
        <div v-for="i in PAGE_SIZE" :key="i" class="sk" />
      </div>
      <div v-else class="masonry">
        <div v-for="(_, ci) in columnCount" :key="ci" class="masonry__col">
          <div v-for="(r, i) in skeletonBars" :key="i" class="sk" :style="{ aspectRatio: r }" />
        </div>
      </div>
    </template>

    <!-- 空态：区分「库里本来就没图」和「筛选后没命中」 -->
    <div v-else-if="!pictures.length" class="state">
      <div class="state__t">{{ colorMode || filterCount ? '没有符合条件的图片' : '画廊还是空的' }}</div>
      <div class="state__s">
        {{
          colorMode || filterCount
            ? '换个条件再试，或者清除筛选看全部'
            : '上传第一张图片，开始建立你的视觉资产库'
        }}
      </div>
      <button v-if="colorMode || filterCount" class="state__btn" @click="clearFilters">清除筛选</button>
      <RouterLink v-else to="/upload" class="state__btn">去上传</RouterLink>
    </div>

    <template v-else>
      <!-- 等高网格：行列严格对齐，页码高度稳定 -->
      <div v-if="view === 'grid'" class="grid" :style="{ '--cols': String(columnCount) }">
        <PictureCard v-for="p in pictures" :key="p.id" :picture="p" fit="cover" @open="openPicture" />
      </div>

      <!-- 等比瀑布流：不裁切任何图 -->
      <div v-else class="masonry">
        <div v-for="(col, ci) in pictureColumns" :key="ci" class="masonry__col">
          <PictureCard v-for="p in col" :key="p.id" :picture="p" fit="auto" @open="openPicture" />
        </div>
      </div>

      <PageBar
        v-if="!colorMode"
        :current="current"
        :total="total"
        :page-size="PAGE_SIZE"
        :disabled="loading"
        @change="loadPage"
      />
    </template>

    <!--
      Lightbox 子路由出口：/p/:pictureId 时渲染它，画廊保持挂载。
      props 把当前页列表传下去，供上一张/下一张使用。
    -->
    <RouterView v-slot="{ Component }">
      <component
        :is="Component"
        :pictures="pictures"
        @deleted="loadPage(current, { keepScroll: true })"
        @updated="loadPage(current, { keepScroll: true })"
      />
    </RouterView>

    <SpaceMembersModal
      v-model:show="showMembersModal"
      :space-id="spaceId"
      :space-name="spaceInfo?.spaceName"
      @changed="loadSpaceInfo"
    />

    <PictureFilterDrawer
      v-model:show="showFilter"
      :space-id="spaceId"
      :space-name="spaceInfo?.spaceName"
      :can-color-search="canColorSearch"
      :initial="filters"
      @apply="applyFilters"
      @color-search="runColorSearch"
      @reset="clearFilters"
    />
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 16px;
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
  font-weight: 500;
}
.toolbar__right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
}
.back {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  flex: 0 0 26px;
}
.back:hover {
  color: var(--text-primary);
  border-color: var(--border-strong);
}
.back svg {
  width: 15px;
  height: 15px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.badge {
  font-size: 10.5px;
  padding: 2px 7px;
  border-radius: 99px;
  border: 1px solid var(--border-strong);
  color: var(--text-secondary);
}
.quota-inline {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11.5px;
  color: var(--text-tertiary);
}
.quota-inline .dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--text-tertiary);
  opacity: 0.6;
}
.noauth {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 99px;
  background: rgba(240, 101, 95, 0.12);
  color: var(--danger);
}
.seg {
  display: flex;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 3px;
  gap: 2px;
}
.seg div {
  padding: 5px 11px;
  border-radius: 7px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
}
.seg div.on {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 500;
}
.iconbtn {
  position: relative;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  display: grid;
  place-items: center;
  color: var(--text-secondary);
  cursor: pointer;
}
.iconbtn.is-on {
  border-color: var(--accent);
  color: var(--accent);
}
/* 筛选条件数量的角标 */
.iconbtn__n {
  position: absolute;
  top: -5px;
  right: -5px;
  min-width: 15px;
  height: 15px;
  padding: 0 3px;
  border-radius: 8px;
  background: var(--accent);
  color: #fff;
  font-size: 9.5px;
  line-height: 15px;
  text-align: center;
}
/* 按色搜索模式：只亮一个小点（没有"几项"可言） */
.iconbtn__dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}

/* ---------- 筛选状态条 ---------- */
/* ---------- 快捷筛选条（分类 / 标签） ---------- */
.quick {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-surface);
}
.quick__row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}
.quick__l {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--text-tertiary);
  line-height: 23px;
}
.quick__n {
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 10px;
  line-height: 15px;
  text-align: center;
}
.quick__items {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}
.chip {
  font-family: var(--font);
  font-size: 11.5px;
  line-height: 1;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.chip:hover,
.chip:focus-visible {
  border-color: var(--border-strong);
  color: var(--text-primary);
}
.chip.on {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}
.chip--ghost {
  border-style: dashed;
  color: var(--text-tertiary);
}

/* ---------- 快捷筛选条（分类 / 标签） ---------- */
.quick {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-surface);
}
.quick__row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}
.quick__l {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--text-tertiary);
  line-height: 23px;
}
.quick__n {
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 10px;
  line-height: 15px;
  text-align: center;
}
.quick__items {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}
.chip {
  font-family: var(--font);
  font-size: 11.5px;
  line-height: 1;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.chip:hover,
.chip:focus-visible {
  border-color: var(--border-strong);
  color: var(--text-primary);
}
.chip.on {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}
.chip--ghost {
  border-style: dashed;
  color: var(--text-tertiary);
}

.fbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: -4px 0 14px;
  padding: 8px 12px;
  border-radius: var(--r-sm);
  background: var(--accent-soft);
  border: 1px solid rgba(108, 123, 255, 0.35);
  font-size: 12px;
  color: var(--text-secondary);
  flex-wrap: wrap;
}
.fbar__l {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  flex-wrap: wrap;
}
.fbar__swatch {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 1px solid var(--border-strong);
  display: inline-block;
}
.fbar__note {
  color: var(--text-tertiary);
  font-size: 11px;
}
.fbar__x {
  font-family: var(--font);
  font-size: 11.5px;
  padding: 3px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  flex: none;
}
.fbar__x:hover {
  color: var(--text-primary);
  border-color: var(--border-strong);
}
.iconbtn svg {
  width: 16px;
  height: 16px;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.8;
  stroke-linecap: round;
}

/* ---------- 等高网格 ---------- */
.grid {
  display: grid;
  grid-template-columns: repeat(var(--cols, 5), minmax(0, 1fr));
  gap: 14px;
  align-items: start;
}

/* ---------- 瀑布流（多列 flex，按序号分配） ---------- */
.masonry {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}
.masonry__col {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ---------- 骨架 ---------- */
.sk {
  border-radius: var(--r-md);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  animation: pulse 1.4s ease-in-out infinite;
}
.grid .sk {
  aspect-ratio: var(--tile-ratio, 1 / 1);
}
@keyframes pulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}

/* ---------- 空态 / 错误态 ---------- */
.state {
  padding: 80px 20px;
  text-align: center;
}
.state__t {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 8px;
}
.state--err .state__t {
  color: var(--danger);
}
.state__s {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 18px;
}
.state__btn {
  display: inline-flex;
  align-items: center;
  height: 36px;
  padding: 0 18px;
  border-radius: 9px;
  background: var(--accent);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  border: 0;
  cursor: pointer;
}
</style>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { listPictureVoByPageUsingPost } from '@/api/pictureController'
import { userLogoutUsingPost } from '@/api/userController'
import { useMySpaces } from '@/composables/useMySpaces'
import { clearSpacePermsCache } from '@/composables/useSpacePerms'
import { useLoginUserStore } from '@/stores/useLoginUserStore'
import { useTheme, type ThemeMode } from '@/theme/useTheme'
import { isAdmin as isAdminUser } from '@/auth/permissions'
import { formatSize } from '@/utils/format'

const router = useRouter()
const message = useMessage()
const loginUserStore = useLoginUserStore()
const { mode, setMode } = useTheme()
const { spaces, load: loadSpaces } = useMySpaces()

const show = ref(false)
const q = ref('')
const active = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)

interface Cmd {
  id: string
  label: string
  hint?: string
  svg: string
  run: () => void
}

const isAdmin = computed(() => isAdminUser(loginUserStore.loginUser))

/* ---------- 命令定义 ---------- */
const ICON = {
  nav: '<path d="M4 12l8-8 8 8"/><path d="M6 10v10h12V10"/>',
  space: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  upload: '<path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 20h16"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  chart: '<path d="M4 19V10M10 19V5M16 19v-6M22 19H2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-2.82 1.18V21a2 2 0 11-4 0v-.09A1.65 1.65 0 007 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 002.6 15H2a2 2 0 110-4h.09A1.65 1.65 0 003.6 9.4l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 6.6V6a2 2 0 114 0v.09a1.65 1.65 0 002.82 1.18l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0021.4 12H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  pic: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M4 18l5-5 4 4 3-3 4 4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z"/>',
  logout: '<path d="M15 17l5-5-5-5"/><path d="M20 12H9"/><path d="M12 3H5a2 2 0 00-2 2v14a2 2 0 002 2h7"/>',
  ai: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18 17l.9 2.1L21 20l-2.1.9L18 23l-.9-2.1L15 20l2.1-.9z"/>',
}

const NAV_ITEMS: { label: string; to: string; svg: string; admin?: boolean }[] = [
  { label: '公共图库', to: '/', svg: ICON.pic },
  { label: '我的空间', to: '/spaces', svg: ICON.space },
  { label: '上传中心', to: '/upload', svg: ICON.upload },
  { label: '搜索中心', to: '/search', svg: ICON.search },
  { label: '空间分析', to: '/analyze/auto', svg: ICON.chart },
  { label: '个人设置', to: '/settings', svg: ICON.gear },
  { label: '用户管理', to: '/admin/users', svg: ICON.user, admin: true },
  { label: '图片管理（含审核队列）', to: '/admin/pictures', svg: ICON.pic, admin: true },
  { label: '空间管理（含成员）', to: '/admin/spaces', svg: ICON.space, admin: true },
]

const navCommands = computed<Cmd[]>(() =>
  NAV_ITEMS.filter((n) => !n.admin || isAdmin.value).map((n) => ({
    id: 'nav:' + n.to,
    label: n.label,
    // 这里原来显示路由（/spaces、/upload…）—— 用户不需要知道内部路径
    svg: n.svg,
    run: () => router.push(n.to),
  })),
)

const spaceCommands = computed<Cmd[]>(() =>
  spaces.value.map((s) => ({
    id: 'space:' + s.id,
    label: s.name,
    hint: (s.isTeam ? '团队空间' : '私有空间') + (s.isMine ? '' : ' · 我加入的'),
    svg: ICON.space,
    run: () => router.push(`/s/${s.id}`),
  })),
)

const actionCommands = computed<Cmd[]>(() => {
  const theme = (label: string, m: ThemeMode): Cmd => ({
    id: 'theme:' + m,
    label,
    hint: mode.value === m ? '当前' : '',
    svg: m === 'dark' ? ICON.moon : ICON.sun,
    run: () => setMode(m),
  })
  return [
    theme('切换主题：深色', 'dark'),
    theme('切换主题：浅色', 'light'),
    theme('切换主题：跟随系统', 'system'),
    {
      id: 'act:upload',
      label: '上传图片',
      hint: '本地 / URL / 批量抓取',
      svg: ICON.upload,
      run: () => router.push('/upload'),
    },
    {
      id: 'act:logout',
      label: '退出登录',
      svg: ICON.logout,
      run: async () => {
        try {
          await userLogoutUsingPost()
          // 换账号时前端没刷新页面，空间权限缓存必须清掉，否则会沿用上一个账号的权限
          clearSpacePermsCache()
          loginUserStore.setLoginUser(undefined)
          router.push('/login')
        } catch (e) {
          message.error((e as Error).message || '退出失败')
        }
      },
    },
  ]
})

/* ---------- 图片搜索（输入非空时去后端查） ---------- */
const pics = ref<API.PictureVO[]>([])
const searching = ref(false)
let timer: number | null = null

function scheduleSearch() {
  if (timer !== null) window.clearTimeout(timer)
  const text = q.value.trim()
  if (!text) {
    pics.value = []
    return
  }
  // 防抖：每敲一个字都发请求没必要
  timer = window.setTimeout(async () => {
    searching.value = true
    try {
      const res = await listPictureVoByPageUsingPost({
        current: 1,
        pageSize: 8,
        sortField: 'createTime',
        sortOrder: 'descend',
        searchText: text,
      })
      pics.value = res.data?.records ?? []
    } catch {
      pics.value = []
    } finally {
      searching.value = false
    }
  }, 280)
}

const picCommands = computed<Cmd[]>(() =>
  pics.value.map((p) => ({
    id: 'pic:' + p.id,
    label: p.name || '未命名',
    // 尺寸可能缺失（历史数据），别渲染成 undefined×undefined
    hint: p.picWidth && p.picHeight
      ? `${p.picWidth}×${p.picHeight} · ${formatSize(p.picSize)}`
      : formatSize(p.picSize),
    svg: ICON.pic,
    run: () => {
      const pictureId = String(p.id)
      if (p.spaceId) router.push({ name: 'spacePicture', params: { spaceId: String(p.spaceId), pictureId } })
      else router.push({ name: 'picture', params: { pictureId } })
    },
  })),
)

/* ---------- 过滤 + 分组 ---------- */
const match = (c: Cmd, kw: string) =>
  !kw || c.label.toLowerCase().includes(kw) || (c.hint || '').toLowerCase().includes(kw)

const groups = computed(() => {
  const kw = q.value.trim().toLowerCase()
  const g: { label: string; items: Cmd[] }[] = []
  const nav = navCommands.value.filter((c) => match(c, kw))
  const sp = spaceCommands.value.filter((c) => match(c, kw))
  const pic = picCommands.value
  const act = actionCommands.value.filter((c) => match(c, kw))
  if (nav.length) g.push({ label: '前往', items: nav })
  if (sp.length) g.push({ label: '我的空间', items: sp })
  if (pic.length) g.push({ label: '图片（按名称/简介搜索）', items: pic })
  if (act.length) g.push({ label: '操作', items: act })
  return g
})

/** 扁平化后用于键盘上下选择 */
const flat = computed(() => groups.value.flatMap((g) => g.items))
const indexOf = (id: string) => flat.value.findIndex((c) => c.id === id)

watch(q, () => {
  active.value = 0
  scheduleSearch()
})
watch(flat, () => {
  if (active.value >= flat.value.length) active.value = Math.max(0, flat.value.length - 1)
})

/*
  「我的空间」按需加载：面板可能整场都不会被打开，
  之前在 onMounted 里预取，等于每次进站都白花两个请求（而且布局壳已经拉过一份）。
*/
let spacesLoaded = false

function open() {
  show.value = true
  q.value = ''
  pics.value = []
  active.value = 0
  if (!spacesLoaded) {
    spacesLoaded = true
    loadSpaces(loginUserStore.loginUser?.id)
  }
  nextTick(() => inputRef.value?.focus())
}

function close() {
  show.value = false
}

function run(c: Cmd | undefined) {
  if (!c) return
  close()
  c.run()
}

function onKeydown(e: KeyboardEvent) {
  // Cmd/Ctrl + K 打开；再按一次关闭
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    show.value ? close() : open()
    return
  }
  if (!show.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (flat.value.length) active.value = (active.value + 1) % flat.value.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (flat.value.length) active.value = (active.value - 1 + flat.value.length) % flat.value.length
  } else if (e.key === 'Enter') {
    e.preventDefault()
    run(flat.value[active.value])
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  // 只拉登录态；空间列表等真正打开面板时再取
  if (!loginUserStore.fetched) await loginUserStore.fetchLoginUser()
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  if (timer !== null) window.clearTimeout(timer)
})

defineExpose({ open })
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="cp-mask" @click.self="close">
      <div class="cp">
        <div class="cp__search">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input
            ref="inputRef"
            v-model="q"
            class="cp__input"
            type="text"
            placeholder="搜索图片名称，或输入命令…（前往 / 主题 / 上传）"
            autocomplete="off"
          />
          <span v-if="searching" class="cp__spin">搜索中…</span>
          <kbd class="cp__esc">Esc</kbd>
        </div>

        <div class="cp__list">
          <template v-for="g in groups" :key="g.label">
            <div class="cp__g">{{ g.label }}</div>
            <button
              v-for="c in g.items"
              :key="c.id"
              class="cp__i"
              :class="{ on: indexOf(c.id) === active }"
              @mousemove="active = indexOf(c.id)"
              @click="run(c)"
            >
              <!-- eslint-disable-next-line vue/no-v-html -->
              <svg class="cp__ico" viewBox="0 0 24 24" v-html="c.svg" />
              <span class="cp__t ellipsis">{{ c.label }}</span>
              <span v-if="c.hint" class="cp__h ellipsis">{{ c.hint }}</span>
            </button>
          </template>

          <div v-if="!flat.length" class="cp__empty">
            {{ q.trim() ? '没有匹配的命令或图片' : '输入关键词开始搜索' }}
          </div>
        </div>

        <div class="cp__foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
          <span><kbd>Enter</kbd> 执行</span>
          <span><kbd>Esc</kbd> 关闭</span>
          <span class="cp__k">⌘K / Ctrl+K 随时唤起</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cp-mask {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: rgba(0, 0, 0, 0.42);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
}
.cp {
  width: min(620px, calc(100vw - 32px));
  background: var(--bg-surface);
  border: 1px solid var(--border-strong);
  border-radius: 14px;
  box-shadow: 0 24px 60px -20px rgba(0, 0, 0, 0.55);
  overflow: hidden;
  animation: cpin 0.16s ease-out;
}
@keyframes cpin {
  from {
    opacity: 0;
    transform: translateY(-6px) scale(0.99);
  }
}
.cp__search {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px 15px;
  border-bottom: 1px solid var(--border);
}
.cp__search svg {
  width: 17px;
  height: 17px;
  flex: 0 0 17px;
  fill: none;
  stroke: var(--text-tertiary);
  stroke-width: 2;
  stroke-linecap: round;
}
.cp__input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-family: var(--font);
  font-size: 14px;
}
.cp__input::placeholder {
  color: var(--text-tertiary);
}
.cp__spin {
  font-size: 11px;
  color: var(--text-tertiary);
}
.cp__esc {
  font-size: 10.5px;
  color: var(--text-tertiary);
  border: 1px solid var(--border-strong);
  border-radius: 5px;
  padding: 1px 5px;
}
.cp__list {
  max-height: 46vh;
  overflow-y: auto;
  padding: 6px;
}
.cp__g {
  font-size: 10.5px;
  color: var(--text-tertiary);
  padding: 9px 10px 5px;
}
.cp__i {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  font-family: var(--font);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}
.cp__i.on {
  background: var(--accent-soft);
  color: var(--accent);
}
.cp__ico {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.85;
}
.cp__t {
  flex: 1;
  min-width: 0;
}
.cp__h {
  flex: 0 1 auto;
  max-width: 46%;
  font-size: 11px;
  color: var(--text-tertiary);
}
.cp__i.on .cp__h {
  color: var(--accent);
  opacity: 0.8;
}
.cp__empty {
  padding: 26px;
  text-align: center;
  font-size: 12.5px;
  color: var(--text-tertiary);
}
.cp__foot {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 9px 14px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-tertiary);
}
.cp__foot kbd {
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  padding: 0 4px;
  margin-right: 3px;
  font-size: 10px;
}
.cp__k {
  margin-left: auto;
}
</style>

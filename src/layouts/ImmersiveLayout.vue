<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { NDropdown, useMessage, type DropdownOption } from 'naive-ui'
import { useTheme, type ThemeMode } from '@/theme/useTheme'
import { useLoginUserStore } from '@/stores/useLoginUserStore'
import { userLogoutUsingPost } from '@/api/userController'
import { useMySpaces } from '@/composables/useMySpaces'
import { clearSpacePermsCache } from '@/composables/useSpacePerms'
import { isAdmin as isAdminUser } from '@/auth/permissions'
import CommandPalette from '@/components/ui/CommandPalette.vue'

const route = useRoute()
const router = useRouter()
const message = useMessage()

/** 游客点「登录」时带上回跳地址（登录页成功后 router.replace(redirect)） */
const loginLink = computed(() => ({ path: '/login', query: { redirect: route.fullPath } }))

/** 命令面板（⌘K/Ctrl+K 由组件自己监听，这里只负责"点搜索框也能打开"） */
const palette = ref<{ open: () => void } | null>(null)
const openPalette = () => palette.value?.open()
const { mode, resolved, setMode, toggle } = useTheme()
const loginUserStore = useLoginUserStore()

/**
 * 图标：静态可控的 SVG 字符串，仅在模板中绑定，不存在用户输入。
 */
const navs = [
  {
    to: '/',
    label: '画廊',
    svg: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  },
  {
    to: '/spaces',
    label: '空间',
    svg: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  },
  {
    to: '/analyze/auto',
    label: '分析',
    svg: '<path d="M4 19V10M10 19V5M16 19v-6M22 19H2"/>',
  },
  {
    to: '/admin/pictures',
    label: '管理台',
    adminOnly: true,
    svg: '<path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h.09a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51h.09a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v.09a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/>',
  },
]

const isActive = (to: string) => {
  // 空间入口要同时覆盖「空间列表」和「某个空间画廊」
  if (to === '/spaces') return route.path === '/spaces' || route.path.startsWith('/s/')
  // 管理台入口覆盖所有 /admin/* 子页
  if (to === '/admin/pictures') return route.path.startsWith('/admin')
  return to === '/' ? route.path === '/' : route.path.startsWith(to.split('/').slice(0, 2).join('/'))
}

const loggedIn = computed(() => !!loginUserStore.loginUser?.id)

/** 页面过渡的 key：大图详情页映射回所属画廊，避免打开大图时整页重挂载 */
const viewKey = computed(() => {
  const name = String(route.name ?? '')
  if (name === 'picture') return '/'
  if (name === 'spacePicture') return route.params.spaceId ? `/s/${route.params.spaceId}` : '/'
  return route.path
})

/**
 * 哪些页面显示品牌页脚。
 * 用白名单而不是黑名单：新增画廊类页面时默认不会误挂页脚。
 * 画廊（home / space / picture / spacePicture）刻意排除 —— 沉浸式浏览不该被页脚打断。
 */
const FOOTER_ROUTE_NAMES = new Set([
  'spaces',
  'upload',
  'search',
  'settings',
  'analyze',
  'studio',
  'adminUsers',
  'adminPictures',
  'adminSpaces',
  'forbidden',
])
const showFooter = computed(() => FOOTER_ROUTE_NAMES.has(String(route.name)))
const isAdmin = computed(() => isAdminUser(loginUserStore.loginUser))

/**
 * 图标栏导航项按角色过滤：管理台只对管理员显示。
 * 后端所有 /admin/* 都标了 @AuthCheck(ADMIN_ROLE)，普通用户即使访问也会 401，
 * 前端把入口藏掉是「体验对齐权限」—— 不给用户看他用不了的东西。
 */
const visibleNavs = computed(() =>
  navs.filter((n) => n.adminOnly !== true || isAdmin.value),
)
const displayName = computed(
  () => loginUserStore.loginUser?.userName || loginUserStore.loginUser?.userAccount || '未登录',
)
const avatarText = computed(() => displayName.value.slice(0, 1))

/* ---------- 空间切换器 ----------
   数据来源与上传页/空间页保持一致：
     · 我创建的空间 → /space/list/page/vo（按 userId 过滤）
     · 我加入的团队空间 → /spaceUser/list/my（后端带出我的角色）
   不传 spaceId 就是后端语义里的「公共图库」（spaceId IS NULL），
   而且后端**不会按 userId 过滤** —— 所有登录用户上传到公共图库的图彼此可见。
   所以它绝不能叫「个人图库」，那会让人误以为是私密的。 */
// 「我创建的空间 + 我加入的团队空间」的加载逻辑已抽到 composable，
// 上传页、搜索页、切换器共用同一份，避免三处实现各写一遍后走偏
const { spaces, load: loadSpaces } = useMySpaces()

const activeSpaceId = computed(() => (route.params.spaceId ? String(route.params.spaceId) : ''))
const activeSpace = computed(() => spaces.value.find((s) => s.id === activeSpaceId.value) ?? null)

const PERSONAL_KEY = '__personal__'
const spaceChipLabel = computed(() => {
  if (!loggedIn.value) return '未登录'
  if (!activeSpaceId.value) return '公共图库'
  return activeSpace.value?.name || '空间'
})
const spaceChipIcon = computed(() => {
  if (!loggedIn.value) return '公'
  if (!activeSpaceId.value) return '共'
  return activeSpace.value?.isTeam ? '团' : '私'
})

const spaceOptions = computed<DropdownOption[]>(() => [
  { label: '公共图库（所有人可见）', key: PERSONAL_KEY },
  ...spaces.value.map((s) => ({ label: `${s.name}${s.isTeam ? '（团队）' : ''}`, key: s.id })),
  {
    type: 'divider',
    key: 'sd',
  },
  { label: '管理我的空间…', key: '__manage__' },
])

function onSpaceSelect(key: string) {
  if (key === PERSONAL_KEY) router.push({ path: '/' })
  else if (key === '__manage__') router.push({ path: '/spaces' })
  else router.push({ path: `/s/${key}` })
}

const themeOptions: DropdownOption[] = [
  { label: '跟随系统', key: 'system' },
  { label: '深色', key: 'dark' },
  { label: '浅色', key: 'light' },
]
const themeLabel = computed(() =>
  mode.value === 'system' ? '跟随系统' : mode.value === 'dark' ? '深色' : '浅色',
)
function onThemeSelect(key: string) {
  setMode(key as ThemeMode)
}

async function onLogout() {
  try {
    await userLogoutUsingPost()
    // 空间权限是按 spaceId 缓存在模块里的；不退出页面就换账号会串权限，必须清
    clearSpacePermsCache()
    loginUserStore.setLoginUser(undefined)
    message.success('已退出登录')
    router.push('/login')
  } catch (e) {
    message.error((e as Error).message || '退出失败')
  }
}

const userOptions = computed<DropdownOption[]>(() => {
  const opts: DropdownOption[] = [
    // 顺带把当前身份标出来，避免用户不清楚自己为什么看不到管理台
    { label: `个人设置（${isAdmin.value ? '管理员' : '普通用户'}）`, key: 'settings', disabled: false },
  ]
  // 判断统一走 @/auth/permissions，不在模板/脚本里重复写角色比较
  if (isAdmin.value) {
    opts.push({ label: '管理后台', key: 'admin' })
  }
  opts.push({ type: 'divider', key: 'd1' }, { label: '退出登录', key: 'logout' })
  return opts
})
function onUserSelect(key: string) {
  if (key === 'settings') router.push('/settings')
  else if (key === 'admin') router.push('/admin/pictures')
  else if (key === 'logout') onLogout()
}

onMounted(async () => {
  if (!loginUserStore.fetched) await loginUserStore.fetchLoginUser()
  await loadSpaces(loginUserStore.loginUser?.id)
})

defineExpose({ toggle })
</script>

<template>
  <div class="layout">
    <!--
      极简图标栏：默认 64px 只有图标，鼠标移上来（或键盘 Tab 进来）展开成 216px，
      露出「宇阁云图库」和每个图标的文字。
      展开的是 rail__inner 这层浮层（absolute），所以**不会挤压右侧内容**。
    -->
    <aside class="rail">
      <div class="rail__inner">
        <RouterLink to="/" class="rail__logo" title="宇阁云图库">
          <img src="/logo.png" alt="宇阁云图库" />
          <span class="rail__brand">宇阁云图库</span>
        </RouterLink>

        <nav class="rail__nav">
          <RouterLink
            v-for="n in visibleNavs"
            :key="n.to"
            :to="n.to"
            class="navbtn"
            :class="{ on: isActive(n.to) }"
            :title="n.label"
          >
            <!-- eslint-disable-next-line vue/no-v-html -->
            <svg viewBox="0 0 24 24" v-html="n.svg" />
            <span class="navbtn__t">{{ n.label }}</span>
          </RouterLink>
        </nav>

        <div class="rail__spacer" />

        <n-dropdown :options="themeOptions" trigger="click" @select="onThemeSelect">
          <button class="navbtn" :title="`主题：${themeLabel}`">
            <svg v-if="resolved === 'dark'" viewBox="0 0 24 24">
              <path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" />
            </svg>
            <svg v-else viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
            </svg>
            <span class="navbtn__t">主题：{{ themeLabel }}</span>
          </button>
        </n-dropdown>
      </div>
    </aside>

    <!-- 主体 -->
    <div class="main">
      <header class="topbar">
        <n-dropdown
          v-if="loggedIn"
          :options="spaceOptions"
          trigger="click"
          @select="onSpaceSelect"
        >
          <button class="space-chip" :title="spaceChipLabel">
            <span class="space-chip__ico">{{ spaceChipIcon }}</span>
            <span class="space-chip__t ellipsis">{{ spaceChipLabel }}</span>
            <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg>
          </button>
        </n-dropdown>

        <RouterLink v-else to="/login" class="space-chip">
          <span class="space-chip__ico">公</span>
          <span class="space-chip__t">未登录</span>
        </RouterLink>

        <!--
          这里以前是个指向 /search 的假搜索框，却标着 Ctrl K —— 按了没反应，属于"界面撒谎"。
          现在改成命令面板的真实入口：点它或按 ⌘K/Ctrl+K 都能唤起，
          面板里既能搜图、也能跳「搜索中心」，功能反而更全。
        -->
        <button class="search field-inset" type="button" @click="openPalette">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <span>搜索图片，或输入命令…</span>
          <kbd>⌘K</kbd>
        </button>

        <div class="topbar__right">
          <!--
            游客态（2026-10-25）：只给「登录 / 注册」两个入口。
            以前这里永远摆着「上传」，游客点了才被守卫弹去登录 —— 属于"按钮撒谎"，
            而且让第一次来的人以为必须先上传才能用。
          -->
          <template v-if="loggedIn">
            <RouterLink to="/upload" class="btn primary">
              <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
              <!-- 文字包一层 span，窄屏才能只留图标 -->
              <span>上传</span>
            </RouterLink>

            <n-dropdown :options="userOptions" trigger="click" @select="onUserSelect">
              <button class="me">
                <!-- 有头像显示图片，没有才退回首字母（之前写死了文字块，用户改了头像也不生效） -->
                <img
                  v-if="loginUserStore.loginUser?.userAvatar"
                  class="me__avatar me__avatar--img"
                  :src="loginUserStore.loginUser.userAvatar"
                  alt=""
                  referrerpolicy="no-referrer"
                />
                <span v-else class="me__avatar">{{ avatarText }}</span>
                <span class="me__name ellipsis">{{ displayName }}</span>
              </button>
            </n-dropdown>
          </template>

          <template v-else>
            <RouterLink :to="loginLink" class="btn primary">登录</RouterLink>
            <RouterLink to="/register" class="btn ghost">注册</RouterLink>
          </template>
        </div>
      </header>


      <main class="content">
        <!--
          路由切换过渡。
          viewKey 的映射很关键：Lightbox 是画廊的**子路由**（/p/:id、/s/:id/p/:id），
          如果直接用 route.path 当 key，打开大图会把整个画廊页重挂载、图片全部重新请求。
          所以把这两种路由映射回它们所属的画廊路径，打开大图不触发过渡。
        -->
        <router-view v-slot="{ Component }">
          <transition name="page" mode="out-in">
            <component :is="Component" :key="viewKey" />
          </transition>
        </router-view>
        <!--
          品牌页脚：只在「非画廊页」出现。
          画廊（公共图库 / 空间画廊）是沉浸式的，底部再挂一条品牌条会破坏全屏感，
          所以那里刻意不加 —— 品牌露出靠侧栏展开时的名字。
        -->
        <footer v-if="showFooter" class="sitefoot">
          <b class="sitefoot__b">宇阁云图库</b>
          <i class="sitefoot__dot" />
          <span>多空间视觉资产管理系统</span>
        </footer>
      </main>
    </div>

    <!-- 命令面板：自己监听 ⌘K/Ctrl+K，这里只是为了能用 ref 调 open() -->
    <CommandPalette ref="palette" />
  </div>
</template>

<style scoped>
/*
  为什么用视口高度而不是 height:100%：
  App.vue 里 n-config-provider / n-message-provider / n-dialog-provider
  会各渲染一层包裹 div，它们都是 auto 高度，导致百分比高度链断裂
  ——表现为 .content 撑成内容高度（内部不滚动），实际由整个文档滚动，
  顶部栏和左侧图标栏会跟着滚走。直接用视口高度可绕开中间包裹层。
*/
.layout {
  display: flex;
  height: 100vh;
  height: 100dvh;
  background: var(--bg-base);
}

/* ---------- 图标栏 ---------- */
.rail {
  width: var(--rail-w);
  flex: 0 0 var(--rail-w);
  position: relative;
  /* 背景/边框交给 inner —— inner 展开时会变宽，rail 只负责占住 64px 的位 */
}
.rail__inner {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: var(--rail-w);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 0;
  gap: 8px;
  background: var(--bg-surface);
  border-right: 1px solid var(--border);
  overflow: hidden;
  transition: width 0.2s cubic-bezier(0.2, 0.7, 0.3, 1);
  z-index: 30;
}
/*
  展开：宽度变大 + 左对齐（否则元素还是居中，文字会从右边溢出去）。
  只在支持 hover 的设备上启用 —— 触屏没有 hover，展开会变成"点一下就卡住"。
  focus-within 是为了键盘用户：Tab 进导航时也能看到文字。
*/
@media (hover: hover) {
  .rail:hover .rail__inner {
    width: 216px;
    align-items: stretch;
    box-shadow: 4px 0 24px rgba(0, 0, 0, 0.18);
  }
}
.rail__inner:focus-within {
  width: 216px;
  align-items: stretch;
  box-shadow: 4px 0 24px rgba(0, 0, 0, 0.18);
}

.rail__logo {
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  padding: 0 12px;
  flex: none;
  text-decoration: none;
}
.rail__logo img {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  flex: none;
  display: block;
  object-fit: cover;
  background: #0c3572; /* 和图片底色一致，避免加载瞬间闪白 */
}
.rail__brand {
  display: none;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  letter-spacing: 0.01em;
}
.rail__inner:hover .rail__brand,
.rail__inner:focus-within .rail__brand {
  display: block;
  animation: railFade 0.18s ease 0.04s both;
}
@keyframes railFade {
  from {
    opacity: 0;
    transform: translateX(-4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.rail__nav {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  padding: 0 12px;
  margin-top: 14px;
}
.rail__spacer {
  flex: 1;
}
.navbtn {
  width: 40px;
  height: 40px;
  border-radius: 11px;
  /*
    收起态只有图标：单列 grid + 居中。
    ⚠️ 必须写死 grid-template-columns: 1fr —— 不写的话，展开时多出来的
    <span> 会被塞进第二行，图标和文字变成上下排列。
  */
  display: grid;
  grid-template-columns: 1fr;
  place-items: center;
  color: var(--text-tertiary);
  position: relative;
  background: transparent;
  border: 0;
  cursor: pointer;
  padding: 0;
  text-decoration: none;
  font-family: var(--font);
}
/* 底部那个主题按钮不在 rail__nav 里，单独给它水平内边距让它在 64px 内居中 */
.rail__inner > .n-dropdown {
  width: 100%;
  padding: 0 12px;
  display: flex;
}
.navbtn__t {
  display: none;
  font-size: 12.5px;
  white-space: nowrap;
  color: inherit;
}
.rail__inner:hover .navbtn,
.rail__inner:focus-within .navbtn {
  width: 100%;
  grid-template-columns: 20px 1fr;
  place-items: center start;
  gap: 12px;
  padding: 0 12px;
}
.rail__inner:hover .navbtn__t,
.rail__inner:focus-within .navbtn__t {
  display: block;
  animation: railFade 0.18s ease 0.04s both;
}
.navbtn svg {
  width: 19px;
  height: 19px;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.navbtn:hover {
  color: var(--text-primary);
  background: var(--accent-soft);
}
.navbtn.on {
  color: var(--accent);
  background: var(--accent-soft);
}
.navbtn.on::before {
  content: '';
  position: absolute;
  left: -12px;
  width: 3px;
  height: 18px;
  border-radius: 2px;
  background: var(--accent);
}

/* ---------- 顶栏 ---------- */
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.topbar {
  height: var(--topbar-h);
  flex: 0 0 var(--topbar-h);
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 22px;
  border-bottom: 1px solid var(--border);
}
.space-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 12px 7px 8px;
  border-radius: 10px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  cursor: pointer;
  color: var(--text-primary);
}
.space-chip__ico {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: var(--accent-soft);
  display: grid;
  place-items: center;
  color: var(--accent);
  font-size: 12px;
}
.space-chip__t {
  font-size: 13px;
  font-weight: 500;
  max-width: 140px;
}
.space-chip svg {
  width: 14px;
  height: 14px;
  stroke: var(--text-tertiary);
  fill: none;
  stroke-width: 1.8;
}

.search {
  flex: 1;
  max-width: 460px;
  height: 38px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  border-radius: 10px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  color: var(--text-tertiary);
  font-size: 13px;
}
.search svg {
  width: 16px;
  height: 16px;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.8;
}
.search kbd {
  margin-left: auto;
  font-family: var(--font);
  font-size: 11px;
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 2px 6px;
}
:root[data-theme='light'] .search kbd {
  background: rgba(20, 24, 45, 0.06);
}

.topbar__right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
}
.btn {
  height: 36px;
  padding: 0 15px;
  border-radius: 9px;
  border: 1px solid transparent;
  cursor: pointer;
  font-size: 13px;
  font-family: var(--font);
  display: flex;
  align-items: center;
  gap: 7px;
}
.btn svg {
  width: 16px;
  height: 16px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
}
.btn.ghost {
  background: var(--bg-surface);
  border-color: var(--border);
  color: var(--text-primary);
}
.btn.primary {
  background: var(--accent);
  color: #fff;
  font-weight: 500;
  box-shadow: 0 6px 16px -6px rgba(85, 99, 224, 0.55);
}
.btn.primary:hover {
  background: var(--accent-hover);
}

.me {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 12px 0 5px;
  border-radius: 99px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  cursor: pointer;
  color: var(--text-primary);
  max-width: 160px;
}
.me__avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: linear-gradient(140deg, #ffb86b, #f0655f);
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  flex: 0 0 26px;
}
.me__avatar--img {
  object-fit: cover;
  overflow: hidden;
}
.me__name {
  font-size: 13px;
}

/* ---------- 内容区 ---------- */
.content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 20px 22px 22px;
}

/* ---------- 品牌页脚（仅非画廊页） ---------- */
.sitefoot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 34px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
  font-size: 11.5px;
  color: var(--text-tertiary);
}
.sitefoot__b {
  font-weight: 500;
  color: var(--text-secondary);
}
.sitefoot__dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--text-tertiary);
  opacity: 0.7;
}

/* ---------- 窄屏适配 ----------
   实测 390px 下顶栏三个子元素（空间切换器 130 + 搜索 120 + 右侧 157）= 407px，
   而可用宽度只有 326px：flex 子项默认不肯缩到 min-content 以下，于是撑破视口、
   连带整页横向滚动（每个页面都溢出到 525px）。
   这里给顶栏子项补上可收缩能力，并在窄屏隐藏纯装饰性文字。
   更通用的规则（工具条换行、表格横向滚动）在 styles/global.css 里。 */
.topbar > * {
  min-width: 0;
}
.search {
  min-width: 0;
}
.search > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.topbar__right {
  flex-shrink: 1;
  min-width: 0;
  flex-wrap: nowrap;
}

@media (max-width: 768px) {
  .topbar {
    padding: 0 12px;
    gap: 10px;
  }
  .content {
    padding: 14px 12px 16px;
  }
}

@media (max-width: 560px) {
  /* 只留图标：空间切换器的文字、用户名的文字 */
  .me__name {
    display: none;
  }
  .search kbd {
    display: none;
  }
}


/* ---------- 路由切换过渡 ---------- */
.page-enter-active,
.page-leave-active {
  transition: opacity 0.14s ease, transform 0.14s ease;
}
.page-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.page-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .page-enter-active,
  .page-leave-active {
    transition: none;
  }
}
</style>
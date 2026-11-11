import { createRouter, createWebHistory } from 'vue-router'
import ImmersiveLayout from '@/layouts/ImmersiveLayout.vue'
import { useLoginUserStore } from '@/stores/useLoginUserStore'
import { canAccessRoute } from '@/auth/permissions'


const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/pages/UserLoginPage.vue'),
      meta: { public: true, title: '登录' },
    },
    {
      path: '/register',
      name: 'register',
      component: () => import('@/pages/UserRegisterPage.vue'),
      meta: { public: true, title: '注册' },
    },
    {
      path: '/',
      component: ImmersiveLayout,
      children: [
        {
          path: '',
          name: 'home',
          component: () => import('@/pages/HomePage.vue'),
          // 后端语义：不传 spaceId = 公共图库（spaceId IS NULL），且不按用户过滤 → 命名要和后端一致
          /*
            public: true —— 公共图库允许游客浏览（2026-10-25）。
            依据：后端 POST /picture/list/page/vo 在 spaceId 为空时不做任何登录校验，
            GET /picture/get/vo 也已放开（游客拿不到登录用户时权限列表为空）。
            注意子路由 p/:pictureId 会继承这份 meta，所以分享深链对游客同样可看；
            而「站内点卡片」由 HomePage#openPicture 拦（未登录先引导登录），两者互不冲突。
          */
          meta: { title: '公共图库', subtitle: '网格 / 瀑布流', public: true },
          /*
            Lightbox 做成画廊的子路由，而不是独立页面。
            好处：打开大图时画廊保持挂载 ——
              · 上一张/下一张可直接复用已验证的列表，无需重新请求；
              · 关闭后滚动位置不丢；
              · 地址栏可分享、浏览器后退可关闭。
            HomePage 里通过 <RouterView> 渲染它。
          */
          children: [
            {
              path: 'p/:pictureId',
              name: 'picture',
              component: () => import('@/components/gallery/PictureLightbox.vue'),
              // 单独给标题，否则会继承父路由的「公共图库」，标签页上看起来像换了站点
              meta: { title: '图片详情' },
            },
          ],
        },
        {
          path: 'spaces',
          name: 'spaces',
          component: () => import('@/pages/SpacesPage.vue'),
          meta: { title: '我的空间', subtitle: '创建 / 管理空间与配额' },
        },
        {
          path: 's/:spaceId',
          name: 'space',
          // 空间画廊与个人画廊是同一套能力（网格/瀑布流 + 分页 + Lightbox），
          // 只是查询多带一个 spaceId，因此复用同一个组件，避免两份实现走偏
          component: () => import('@/pages/HomePage.vue'),
          meta: { title: '空间画廊', subtitle: '网格 / 瀑布流' },
          // 空间画廊下的大图路由：/s/:spaceId/p/:id
          // 与个人画廊的 /p/:id 互不冲突（父路径不同），各自都能保持所在页面挂载
          children: [
            {
              path: 'p/:pictureId',
              name: 'spacePicture',
              component: () => import('@/components/gallery/PictureLightbox.vue'),
            },
          ],
        },
        {
          path: 'upload',
          name: 'upload',
          component: () => import('@/pages/UploadPage.vue'),
          meta: { title: '上传中心', subtitle: '本地文件 / URL / 批量抓取' },
        },
        {
          // 裁剪全程在前端（vue-cropper + canvas），保存复用上传接口；扩图走后端异步任务
          path: 'studio/:pictureId',
          name: 'studio',
          component: () => import('@/pages/StudioPage.vue'),
          meta: { title: '编辑工作台', subtitle: '裁剪 · AI 扩图 · 信息编辑' },
        },
        {
          path: 'search',
          name: 'search',
          component: () => import('@/pages/SearchPage.vue'),
          meta: { title: '搜索中心', subtitle: '跨范围关键词 · 按色搜索' },
        },
        {
          path: 'settings',
          name: 'settings',
          component: () => import('@/pages/SettingsPage.vue'),
          meta: { title: '个人设置', subtitle: '资料 / 会员 / 兑换码' },
        },
        {
          // spaceId 可以是真实空间 id，也可以是 public（公共图库）/ all（全空间）/ auto（自动选）
          path: 'analyze/:spaceId',
          name: 'analyze',
          component: () => import('@/pages/AnalyzePage.vue'),
          meta: { title: '空间分析', subtitle: '6 维用量分析' },
        },
        /*
          管理台三页：meta.requiresAdmin 由全局守卫消费（见下方 beforeEach）。
          这三页对应的后端接口全部标了 @AuthCheck(mustRole = ADMIN_ROLE)，
          所以前端也按角色把路由拦掉 —— 否则普通用户手输 URL 会看到一堆空的表格和 401。
        */
        {
          path: 'admin/users',
          name: 'adminUsers',
          component: () => import('@/pages/admin/AdminUsersPage.vue'),
          meta: { title: '用户管理', subtitle: '管理台', requiresAdmin: true },
        },
        {
          path: 'admin/pictures',
          name: 'adminPictures',
          component: () => import('@/pages/admin/AdminPicturesPage.vue'),
          meta: { title: '图片管理', subtitle: '管理台 · 含审核队列', requiresAdmin: true },
        },
        {
          path: 'admin/spaces',
          name: 'adminSpaces',
          component: () => import('@/pages/admin/AdminSpacesPage.vue'),
          meta: { title: '空间管理', subtitle: '管理台 · 含成员管理', requiresAdmin: true },
        },
        {
          path: '403',
          name: 'forbidden',
          component: () => import('@/pages/ForbiddenPage.vue'),
          meta: { title: '无访问权限' },
        },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

/**
 * 登录守卫
 * 进入受保护路由前，确保已尝试拉取登录态（后端用 Sa-Token + Session，靠 Cookie 维持）。
 * 注意：store 必须在守卫内惰性获取 —— 此时 pinia 才已安装。
 */
router.beforeEach(async (to) => {
  const store = useLoginUserStore()

  if (!store.fetched) {
    await store.fetchLoginUser()
  }

  const isPublic = Boolean(to.meta.public)
  const loggedIn = Boolean(store.loginUser?.id)

  if (!isPublic && !loggedIn) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
  /*
    ⚠️ 这里以前是 `if (isPublic && loggedIn) return { path: '/' }`。
    那是「public = 登录页」的写法，只成立在 public 只有 login/register 的时候。
    公共图库放开给游客后首页也是 public —— 一刀切会把**已登录用户**从首页弹回 '/'，
    重定向到同一个地址直接死循环。所以改成只对登录/注册两个页面生效。
  */
  if (loggedIn && (to.name === 'login' || to.name === 'register')) {
    const back = typeof to.query.redirect === 'string' ? to.query.redirect : '/'
    return { path: back }
  }

  /*
    权限守卫：管理员专属路由。
    判断逻辑统一走 @/auth/permissions，不在守卫里重复写角色比较 ——
    也避免「图标栏藏了入口但直接敲 URL 还是能进」这种半吊子处理。
    meta.requiresAdmin 是路由上的静态标记，这里用 canAccessRoute 读取。
  */
  if (!canAccessRoute(store.loginUser, to.meta) && to.name !== 'forbidden') {
    return { name: 'forbidden', query: { from: to.fullPath } }
  }

  return true
})

/**
 * 浏览器标签页标题
 * 之前永远是「宇阁云图库」，切到哪个页面都不变 —— 开着多个标签根本分不清。
 * 现在统一成「页面名 · 宇阁云图库」，品牌名固定在后缀，是浏览器标签的常规做法。
 */
router.afterEach((to) => {
  const name = typeof to.meta.title === 'string' ? to.meta.title : ''
  /*
    首页只用品牌名作为标签标题（2026-10-25）：
    「公共图库」写在浏览器标签上，看起来像另一个站点，而且它只是首页的一种视图状态
    （登录后同一个页面还可能是空间画廊），不适合当标签名。
  */
  const isHome = to.name === 'home'
  document.title = !name || isHome ? '宇阁云图库' : `${name} · 宇阁云图库`
})

export default router

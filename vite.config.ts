import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    /*
      固定 5175：本机 5173 常被鱼皮那套前端占用，
      若用默认端口会每次随机漂移（5173 → 5174 → 5175…），书签和文档里的地址就失效。
      strictPort 打开是为了「端口被占时直接报错」，而不是悄悄换号。
    */
    port: 5175,
    strictPort: true,
    proxy: {
      /*
        后端 context-path 就是 /api，直接透传，无需 rewrite。

        ws: true 是给「实时协同编辑」用的：
          前端连 ws://localhost:5175/api/ws/picture/edit?pictureId=xxx，
          由 vite 升级并转发到后端 8123 的 /api/ws/picture/edit。
        好处是前端不用把后端地址写死，开发/生产都是同源（生产由 Nginx 反代，需带
        `proxy_http_version 1.1` + `Upgrade`/`Connection` 头，见 README 的部署说明）。
      */
      '/api': {
        target: 'http://localhost:8123',
        changeOrigin: true,
        ws: true,
      },
      /*
        COS 图片的同源代理 —— 只给「裁剪」用。

        为什么需要：COS 桶没有配置 CORS（响应里没有 Access-Control-Allow-Origin），
        于是浏览器里跨域加载图片会二选一失败：
          · 带 crossOrigin（vue-cropper 内部就是这么设的）→ 图片直接加载失败
          · 不带 crossOrigin → 图片能显示，但 canvas 被污染，toBlob 抛
            SecurityError: Tainted canvases may not be exported
        走同源代理后浏览器认为图来自 localhost:5175，两个问题都没有了。

        ⚠️ 这是**开发期**方案（生产环境要在 Nginx / 网关做同样的反代，或者给 COS 桶配 CORS）。
        目标桶换掉时改这里，或用 VITE_COS_HOST 覆盖。
      */
      '/cos-proxy': {
        target: process.env.VITE_COS_HOST || 'https://bxzd1170-1499956584.cos.ap-shanghai.myqcloud.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/cos-proxy/, ''),
      },
    },
  },
})

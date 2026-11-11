# 宇阁云图库 · YuGe Gallery

> 多空间视觉资产管理系统 —— 公共图库、私有空间、团队空间三级隔离，多人实时协同编辑，AI 扩图与对象存储。

**在线体验**：<http://39.104.13.97/> · 未登录可直接浏览公共图库，登录后使用空间与协同编辑
**后端仓库**：[yuge-picture-backend](https://github.com/bxzd1170/yuge-picture-backend)（Spring Boot 2.7 + MyBatis-Plus + Sa-Token + 腾讯云 COS）

---

## 界面预览

| 公共图库 | 大图浏览 |
| --- | --- |
| ![公共图库](docs/screenshots/01-gallery.jpg) | ![大图浏览](docs/screenshots/02-lightbox.jpg) |

| 多人协同编辑 | 以图搜图 |
| --- | --- |
| ![协同编辑](docs/screenshots/03-coedit.jpg) | ![以图搜图](docs/screenshots/04-image-search.jpg) |

| AI 扩图 |
| --- |
| ![AI 扩图](docs/screenshots/05-ai-outpaint.jpg) |

---

## 功能特性

| 模块 | 能力 |
| --- | --- |
| **画廊** | 网格 / 瀑布流双视图、页码分页、分类与标签快捷筛选、6 种排序、列表用缩略图按需加载 |
| **大图浏览** | 子路由 Lightbox、`←` `→` / `Esc` 键盘操作、相邻预加载、可分享深链、图片信息面板 |
| **搜索** | 关键词跨范围搜索、空间内筛选抽屉、按色搜索、以图搜图（限空间内） |
| **空间** | 公共 / 私有 / 团队三类空间，配额与等级，成员管理与角色分配 |
| **协同** | WebSocket 实时协同：单编辑者 + 多人围观，操作实时广播、抢锁超时、断线重连 |
| **编辑** | 浏览器内裁剪（旋转 / 缩放 / WebP·JPEG·PNG 导出）、AI 扩图（异步轮询 + 结果入库） |
| **分析** | 6 维统计：用量概览、分类分布、标签云、体积分布、上传趋势、空间排行 |
| **管理台** | 图片审核（通过 · 拒绝 · 理由）、用户角色管理、空间配额与成员管理 |
| **体验** | 命令面板 `⌘K`、深色 / 浅色双主题、首屏防闪烁、390px 起响应式、全站中文 |

## 技术栈

| 分类 | 选型 |
| --- | --- |
| 框架 | Vue 3.5 · Vite 6 · TypeScript |
| 状态 | Pinia |
| 路由 | vue-router 4 |
| UI | Naive UI（令牌映射，非默认皮肤） |
| 请求 | axios + `@umijs/openapi` 自动生成客户端 |
| 可视化 | 手写 SVG / CSS（无图表库）· `wordcloud2` 词云 |
| 图像 | `vue-cropper` 裁剪（纯前端 canvas） |
| 工具 | @vueuse/core |

---

## 快速开始

```bash
npm install
npm run dev        # http://localhost:5175（端口在 vite.config.ts 里固定，strictPort 打开）
```

> **前置条件**：后端已启动在 `8123` 端口。开发环境通过 Vite 代理（`/api` → `http://localhost:8123`）转发请求，因此不存在跨域问题。

### 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 类型检查 + 生产构建 |
| `npm run build-only` | 仅生产构建 |
| `npm run type-check` | 仅类型检查 |
| `npm run openapi` | **从后端 Swagger 重新生成 API 客户端**（需后端运行） |

`src/api/` 目录由生成器产出，**不要手改**；后端接口变更后跑一次 `npm run openapi` 即可。

---

## 目录结构

```
src/
├── api/            # openapi 自动生成，禁止手改
├── assets/
├── auth/           # 权限判定的唯一来源
├── components/     # 通用组件（ui / gallery / space / admin）
├── composables/    # 组合式函数
├── layouts/        # 布局壳
├── pages/          # 页面
├── router/         # 路由与登录守卫
├── stores/         # Pinia
├── styles/         # 设计令牌与主题
│   ├── tokens.css        # 深色（默认）全量语义变量
│   ├── theme-light.css   # 浅色覆盖层
│   └── global.css        # reset + 过渡 + 工具类
├── theme/          # 主题机制（三态 + 持久化 + Naive UI 映射）
├── request.ts      # axios 实例与统一错误处理
└── main.ts
```

设计基准见 `design/视觉稿.html`（4 屏 · 双主题可实时切换）与 `设计方案.md`。

---

## 文档

| 文档 | 内容 |
| --- | --- |
| [前端架构](docs/前端架构.md) | 双主题实现、画廊双视图与分页、Lightbox 子路由、命令面板、响应式、品牌露出 |
| [搜索与筛选](docs/搜索与筛选.md) | 三条搜索路径、按色搜索的真实限制、以图搜图链路与风险 |
| [页面说明](docs/页面说明.md) | 空间、空间分析（6 维）、编辑工作台（裁剪 / AI 扩图）、个人设置 |
| [权限设计](docs/权限设计.md) | 三层身份模型、功能 × 角色矩阵、三个反直觉的边界、团队共同编辑 |
| [实时协同编辑](docs/实时协同编辑.md) | WebSocket 协议、协作模型、远端重放、生产环境 Nginx 配置 |
| [开发笔记](docs/开发笔记.md) | 后端接口约束清单、CSS 陷阱、文案约定、修复记录 |

---

## 说明

- **游客模式**：未登录可直接浏览公共图库与大图详情，分享链接对未登录用户有效；上传、空间、分析、管理台需要登录。
- **公共图库对所有登录用户可见**：后端对 `spaceId IS NULL` 的查询不按用户过滤，术语上刻意不叫「个人图库」。
- 仓库不含任何数据库密码、对象存储密钥或生产数据；`application-local.yml` 等配置已在 `.gitignore` 中排除。

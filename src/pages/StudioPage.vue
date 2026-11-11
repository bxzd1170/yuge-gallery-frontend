<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NInput, NInputNumber, useMessage } from 'naive-ui'
import {
  createPictureOutPaintingTaskUsingPost,
  getPictureOutPaintingTaskUsingGet,
  getPictureVoByIdUsingGet,
  uploadPictureByUrlUsingPost,
} from '@/api/pictureController'
import PictureEditModal from '@/components/gallery/PictureEditModal.vue'
import PictureCropper from '@/components/studio/PictureCropper.vue'
import { useLoginUserStore } from '@/stores/useLoginUserStore'
import { canEditPicture } from '@/auth/permissions'
import { useSpacePerms } from '@/composables/useSpacePerms'
import { formatSize, formatTime } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const loginUserStore = useLoginUserStore()

const picture = ref<API.PictureVO | null>(null)
const loading = ref(true)
const errorMsg = ref('')

const pictureId = computed(() => String(route.params.pictureId ?? ''))

/**
 * 工作台的所有写操作（编辑信息 / 裁剪保存 / AI 扩图）在后端都要求 PICTURE_EDIT。
 * 权限按图片所在场景不同：
 *   · 公共图库 → 上传者本人或系统管理员
 *   · 团队空间 → `space_user` 里的 editor / admin 也能改别人上传的图（共同编辑）
 * 所以图片属于某个空间时，问后端要 permissionList，不自己算角色。
 */
const spacePerms = useSpacePerms()
/**
 * 归属展示：不给用户看 spaceId 这种内部标识。
 * 空间名来自 useSpacePerms 的 /space/get/vo 结果（本来就要查权限，顺带缓存）。
 */
const spaceLabel = computed(() => {
  if (!picture.value?.spaceId) return '公共图库'
  const sp = spacePerms.space.value
  if (!sp?.name) return '空间'
  return `${sp.type === 1 ? '团队空间' : '私有空间'}「${sp.name}」`
})

const canModify = computed(() =>
  canEditPicture(loginUserStore.loginUser, picture.value?.userId, spacePerms.perms.value),
)

/* ============================================================
   AI 扩图
   后端：POST /picture/out_painting/create_task → 返回 taskId（异步）
         GET  /picture/out_painting/get_task?taskId=... → 查询进度与结果
   两条前置约束（后端真实校验，已前移到 UI）：
     ① 权限：create_task 标了 @SaSpaceCheckPermission(PICTURE_EDIT) → 本人或管理员
     ② 尺寸：阿里云 wanx2.1-imageedit 要求宽、高**都在 512~4096** 之间，
        否则后端直接抛错。本库里 81 张是批量抓来的 Bing 缩略图（宽 474px），全部不满足。
   ============================================================ */
const MIN_SIDE = 512
const MAX_SIDE = 4096

const canOutpaint = computed(() => {
  const w = Number(picture.value?.picWidth ?? 0)
  const h = Number(picture.value?.picHeight ?? 0)
  if (!w || !h) return false
  return w >= MIN_SIDE && w <= MAX_SIDE && h >= MIN_SIDE && h <= MAX_SIDE
})

const sizeReason = computed(() => {
  const w = Number(picture.value?.picWidth ?? 0)
  const h = Number(picture.value?.picHeight ?? 0)
  if (!w || !h) return '这张图缺少尺寸信息，无法判断是否可扩图'
  if (w < MIN_SIDE || h < MIN_SIDE) {
    return `当前 ${w} × ${h}，最小边小于 ${MIN_SIDE}px 不满足扩图要求（批量抓取来的图宽度通常只有 474px，都属于这种情况）`
  }
  if (w > MAX_SIDE || h > MAX_SIDE) {
    return `当前 ${w} × ${h}，超过了模型上限 ${MAX_SIDE}px`
  }
  return ''
})

const xScale = ref(1.5)
const yScale = ref(1.5)
const prompt = ref('')
const creating = ref(false)
const taskId = ref('')
const taskStatus = ref('')
const outputUrl = ref('')
const taskMsg = ref('')

/* ---------- 应用扩图结果 ----------
  后端没有"扩图保存"接口，但 /picture/upload/url 就是现成的落地通道：
  服务端会自己去拉那个临时地址 → 转存到自己的存储 → 建图库记录。
  原图在空间里就存回同一空间（编辑者本就有上传权限），公共图就存公共图库。
  约束（源码 UrlPictureUpload.validPicture）：临时地址的 Content-Length > 2MB 会被拒，
  失败时如实报错，用户还能走「打开原图」手动保存。
*/
const savingResult = ref(false)
const savedPicture = ref<API.PictureVO | null>(null)

async function saveResult() {
  if (!outputUrl.value || savingResult.value) return
  savingResult.value = true
  try {
    const res = await uploadPictureByUrlUsingPost({
      fileUrl: outputUrl.value,
      picName: `${picture.value?.name || '图片'}-扩图`,
      ...(picture.value?.spaceId ? { spaceId: picture.value.spaceId as unknown as number } : {}),
    } as API.PictureUploadRequest)
    savedPicture.value = res.data ?? null
    message.success('已存入图库')
  } catch (e) {
    message.error((e as Error).message || '保存失败，可打开原图手动下载')
  } finally {
    savingResult.value = false
  }
}
let timer: number | null = null

function stopPoll() {
  if (timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
}

async function startOutpaint() {
  if (!canOutpaint.value || !pictureId.value) return
  creating.value = true
  outputUrl.value = ''
  taskStatus.value = ''
  taskMsg.value = ''
  savedPicture.value = null
  try {
    const res = await createPictureOutPaintingTaskUsingPost({
      pictureId: pictureId.value as unknown as number,
      parameters: {
        xScale: xScale.value,
        yScale: yScale.value,
        prompt: prompt.value.trim() || undefined,
      },
    })
    taskId.value = String(res.data?.output?.taskId ?? '')
    taskStatus.value = String(res.data?.output?.taskStatus ?? 'PENDING')
    if (!taskId.value) {
      message.error(res.message || '创建任务失败：未返回 taskId')
      return
    }
    message.success('任务已提交，正在扩图中…')
    poll()
  } catch (e) {
    message.error((e as Error).message || '创建扩图任务失败')
  } finally {
    creating.value = false
  }
}

/** 异步任务要轮询：PENDING / RUNNING 都还没结束 */
function poll() {
  stopPoll()
  timer = window.setInterval(async () => {
    try {
      const res = await getPictureOutPaintingTaskUsingGet({ taskId: taskId.value })
      const out = res.data?.output
      taskStatus.value = String(out?.taskStatus ?? '')
      taskMsg.value = String(out?.message ?? '')
      if (taskStatus.value === 'SUCCEEDED') {
        outputUrl.value = String(out?.outputImageUrl ?? '')
        stopPoll()
        message.success('扩图完成')
      } else if (['FAILED', 'CANCELED', 'UNKNOWN'].includes(taskStatus.value)) {
        stopPoll()
        message.error(`扩图任务${taskStatus.value === 'FAILED' ? '失败' : '已结束'}${taskMsg.value ? '：' + taskMsg.value : ''}`)
      }
    } catch (e) {
      stopPoll()
      message.error((e as Error).message || '查询任务失败')
    }
  }, 3000)
}

const running = computed(() => ['PENDING', 'RUNNING'].includes(taskStatus.value))
const statusText = computed(() => {
  switch (taskStatus.value) {
    case 'PENDING':
      return '排队中'
    case 'RUNNING':
      return '处理中'
    case 'SUCCEEDED':
      return '已完成'
    case 'FAILED':
      return '失败'
    case 'CANCELED':
      return '已取消'
    default:
      return taskStatus.value
  }
})

/* ---------- 裁剪 ---------- */
const showCrop = ref(false)

/** 另存为新图片后，直接切到那张新图，让用户马上看到结果 */
function onCropSaved(saved: API.PictureVO) {
  if (saved?.id && String(saved.id) !== pictureId.value) {
    router.push({ name: 'studio', params: { pictureId: String(saved.id) } })
  } else {
    loadPicture()
  }
}

/* ---------- 其它操作 ---------- */
const showEdit = ref(false)

async function copyLink() {
  const url = picture.value?.url || ''
  if (!url) return
  try {
    await navigator.clipboard.writeText(url)
    message.success('图片直链已复制')
  } catch {
    message.warning('浏览器不允许自动复制，请手动复制')
  }
}

function viewInGallery() {
  const p = picture.value
  if (!p?.id) return
  if (p.spaceId) {
    router.push({ name: 'spacePicture', params: { spaceId: String(p.spaceId), pictureId: String(p.id) } })
  } else {
    router.push({ name: 'picture', params: { pictureId: String(p.id) } })
  }
}

const tags = computed<string[]>(() => {
  const t = picture.value?.tags
  return Array.isArray(t) ? t : []
})

async function loadPicture() {
  loading.value = true
  errorMsg.value = ''
  // 非数字 id 会被后端当成类型转换失败，返回「系统错误」这种读不懂的信息；
  // 前端能提前判断，就直接给出人话。
  if (!/^\d+$/.test(pictureId.value)) {
    errorMsg.value = '图片 ID 不合法'
    loading.value = false
    return
  }
  try {
    const res = await getPictureVoByIdUsingGet({ id: pictureId.value as unknown as number })
    picture.value = res.data ?? null
    if (!picture.value) errorMsg.value = '图片不存在或已删除'
    // 图片在空间里 → 取后端算好的权限列表，决定写操作是否可见
    if (picture.value?.spaceId) await spacePerms.load(picture.value.spaceId)
    else spacePerms.reset()
  } catch (e) {
    errorMsg.value = (e as Error).message || '加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (!loginUserStore.fetched) await loginUserStore.fetchLoginUser()
  await loadPicture()
})

// 「另存为新图片」之后是同一路由换参数，组件不会重新挂载，必须自己监听
watch(
  () => route.params.pictureId,
  (v, old) => {
    if (v && v !== old) {
      stopPoll()
      taskId.value = ''
      taskStatus.value = ''
      outputUrl.value = ''
      loadPicture()
      window.scrollTo({ top: 0 })
    }
  },
)

onUnmounted(stopPoll)
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <button class="back" title="返回" @click="router.back()">
        <svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" /></svg>
      </button>
      <h2>编辑工作台</h2>
      <div class="toolbar__right">
        <button class="ghost-btn" @click="viewInGallery">在画廊中查看</button>
        <button class="ghost-btn" @click="copyLink">复制直链</button>
        <a v-if="picture?.url" class="ghost-btn" :href="picture.url" target="_blank" rel="noopener">下载原图</a>
      </div>
    </div>

    <div v-if="loading" class="state">加载中…</div>
    <div v-else-if="errorMsg" class="state state--err">{{ errorMsg }}</div>

    <div v-else-if="picture" class="cols">
      <!-- 左：预览 -->
      <section class="stage">
        <img :src="picture.url" alt="" referrerpolicy="no-referrer" />
        <div class="stage__bar">
          <span class="sub">{{ picture.picWidth }} × {{ picture.picHeight }}</span>
          <span class="sub">{{ formatSize(picture.picSize) }}</span>
          <span class="sub">{{ picture.picFormat || '未知格式' }}</span>
          <span v-if="picture.picColor" class="swatch" :title="picture.picColor">
            <i :style="{ background: picture.picColor }" />{{ picture.picColor }}
          </span>
        </div>
      </section>

      <!-- 右：信息 + 操作 -->
      <aside class="side">
        <div class="block">
          <div class="block__h">图片信息</div>
          <div class="kv"><span>名称</span><b>{{ picture.name || '未命名' }}</b></div>
          <div class="kv"><span>简介</span><b>{{ picture.introduction || '—' }}</b></div>
          <div class="kv"><span>分类</span><b>{{ picture.category || '未分类' }}</b></div>
          <div class="kv">
            <span>标签</span>
            <b>
              <template v-if="tags.length">{{ tags.join('、') }}</template>
              <template v-else>—</template>
            </b>
          </div>
          <div class="kv"><span>归属</span><b>{{ spaceLabel }}</b></div>
          <div class="kv"><span>上传时间</span><b>{{ formatTime(picture.createTime) }}</b></div>
          <button v-if="canModify" class="primary-btn block__btn" @click="showEdit = true">编辑信息</button>
        </div>

        <!-- 无写权限时的说明：不是「没功能」，而是「你在当前位置没有写权限」 -->
        <div v-if="!canModify" class="block block--muted">
          <div class="block__h">只读模式</div>
          <div class="hint">
            <template v-if="picture.spaceId && spacePerms.perms.value">
              你在<b>这个空间里是浏览者</b>，只能查看。
              编辑信息、裁剪保存与 AI 扩图需要在空间里拥有<b>编辑者</b>或<b>管理员</b>角色 ——
              请让空间管理员调整你的角色。
            </template>
            <template v-else>
              这是<b>别人上传的图片</b>，
              只有上传者本人或系统管理员能编辑信息、裁剪保存与 AI 扩图。
            </template>
            你仍然可以下载原图、复制直链、按此图搜索。
          </div>
        </div>

        <div v-if="canModify" class="block">
          <div class="block__h">
            裁剪
          </div>
          <div class="hint">
            自由框选裁剪区域，可旋转 / 缩放。裁完可以<b>下载到本地</b>，或
            <b>另存为新图片</b>（不动原图）、<b>覆盖原图</b>。
            <br />
            保存时按普通上传处理，因此同样受 <b>2MB</b> 与后缀白名单限制（已在弹窗里提前校验）。
          </div>
          <button class="primary-btn" @click="showCrop = true">开始裁剪</button>
        </div>

        <div v-if="canModify" class="block">
          <div class="block__h">
            AI 扩图
          </div>

          <div v-if="!canOutpaint" class="notice">
            <b>这张图不能扩图。</b>{{ sizeReason }}
          </div>

          <template v-else>
            <div class="hint">
              横向（左右）与纵向（上下）的扩展比例默认都是 <b>1.5</b>，可分别调整。
              注意：<b>最终输出尺寸由模型决定</b>，不是简单的倍数换算
              （实测 1316×1002 的图按 1.5 扩展后得到 1664×1248）。
            </div>
            <div class="row">
              <label>水平扩展</label>
              <n-input-number
                v-model:value="xScale"
                size="small"
                :min="1"
                :max="2"
                :step="0.1"
                style="width: 120px"
              />
            </div>
            <div class="row">
              <label>垂直扩展</label>
              <n-input-number
                v-model:value="yScale"
                size="small"
                :min="1"
                :max="2"
                :step="0.1"
                style="width: 120px"
              />
            </div>
            <div class="row row--col">
              <label>提示词<span class="opt">选填，留空使用默认描述</span></label>
              <n-input
                v-model:value="prompt"
                type="textarea"
                size="small"
                :autosize="{ minRows: 2, maxRows: 3 }"
                placeholder="例如：向右扩展出街道与建筑，保持原图的光影与色调"
              />
            </div>

            <button class="primary-btn" :disabled="creating || running" @click="startOutpaint">
              {{ creating ? '提交中…' : running ? `扩图中（${statusText}）…` : '开始扩图' }}
            </button>

            <div v-if="taskStatus" class="task">
              <div class="task__l">
                任务状态：<b :class="{ ok: taskStatus === 'SUCCEEDED', bad: taskStatus === 'FAILED' }">
                  {{ statusText }}
                </b>
              </div>
              <div v-if="taskMsg" class="task__m">{{ taskMsg }}</div>
              <div v-if="running" class="task__bar"><i /></div>
            </div>

            <div v-if="outputUrl" class="result">
              <div class="result__h">扩图结果</div>
              <img :src="outputUrl" alt="扩图结果" referrerpolicy="no-referrer" />
              <div class="result__acts">
                <template v-if="savedPicture">
                  <span class="sub ok">✓ 已存入图库</span>
                  <RouterLink class="ghost-btn" :to="`/picture/${savedPicture.id}`">查看新图</RouterLink>
                </template>
                <template v-else>
                  <button class="primary-btn" :disabled="savingResult" @click="saveResult">
                    {{ savingResult ? '保存中…' : '应用结果' }}
                  </button>
                  <a class="ghost-btn" :href="outputUrl" target="_blank" rel="noopener">打开原图</a>
                  <span class="sub">结果为临时地址，尽快应用或下载</span>
                </template>
              </div>
            </div>
          </template>
        </div>

        <div class="block block--muted">
          <div class="block__h">如实说明</div>
          <div class="hint">
            <b>裁剪怎么保存：</b>裁剪全程在浏览器里完成，保存时以<b>一张新图</b>上传到图库 ——
            可以选择「另存为新图片」或「覆盖原图」。
            <br />
            <b>分享：</b>暂不支持生成分享页或外链，这里提供<b>复制图片直链</b>。
            <br />
            <b>扩图结果入库：</b>点「应用结果」即可把结果存为图库里的<b>一张新图</b>（原图在空间里就存回该空间）。
            结果地址是临时的，过期失效，建议生成后尽快应用；超过 2MB 的结果会被拒，届时可打开原图手动保存。
          </div>
        </div>
      </aside>
    </div>

    <PictureEditModal v-model:show="showEdit" :picture="picture" @saved="loadPicture" />
    <PictureCropper v-model:show="showCrop" :picture="picture" @saved="onCropSaved" />
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}
.back {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  border: 1px solid var(--border);
  background: var(--bg-surface);
  color: var(--text-secondary);
  display: grid;
  place-items: center;
  cursor: pointer;
}
.back svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.toolbar h2 {
  margin: 0;
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -0.01em;
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
  display: inline-flex;
  align-items: center;
  text-decoration: none;
}
.state {
  padding: 60px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 13px;
}
.state--err {
  color: var(--danger);
}
.cols {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 400px;
  gap: 16px;
  align-items: start;
}
@media (max-width: 1100px) {
  .cols {
    grid-template-columns: 1fr;
  }
}
.stage {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 14px;
  position: sticky;
  top: 0;
}
.stage img {
  width: 100%;
  max-height: 68vh;
  object-fit: contain;
  border-radius: var(--r-sm);
  background: var(--bg-base);
  display: block;
}
.stage__bar {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.sub {
  font-size: 11.5px;
  color: var(--text-tertiary);
}
.sub.ok {
  color: var(--success);
  font-weight: 500;
}
.swatch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--text-tertiary);
}
.swatch i {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  border: 1px solid var(--border-strong);
  display: block;
}
.side {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.block {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 15px 17px 17px;
}
.block--muted {
  opacity: 0.92;
}
.block__h {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  font-weight: 600;
  margin-bottom: 12px;
}
.block__btn {
  margin-top: 4px;
}
.kv {
  display: flex;
  gap: 10px;
  font-size: 12.5px;
  padding: 5px 0;
  line-height: 1.7;
}
.kv span {
  flex: 0 0 62px;
  color: var(--text-tertiary);
}
.kv b {
  font-weight: 400;
  color: var(--text-primary);
  word-break: break-all;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.row label {
  font-size: 12.5px;
  color: var(--text-secondary);
  flex: 1;
}
.row--col {
  flex-direction: column;
  align-items: stretch;
}
.row .opt {
  color: var(--text-tertiary);
  font-size: 11px;
  margin-left: 5px;
}
.primary-btn {
  width: 100%;
  height: 36px;
  margin-top: 4px;
  border-radius: 9px;
  border: 0;
  background: var(--accent);
  color: #fff;
  font-family: var(--font);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.primary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.hint {
  font-size: 11.5px;
  line-height: 1.85;
  color: var(--text-tertiary);
  margin-bottom: 12px;
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
.notice {
  padding: 11px 13px;
  border-radius: var(--r-sm);
  background: rgba(255, 184, 107, 0.12);
  border: 1px solid rgba(255, 184, 107, 0.32);
  font-size: 12px;
  line-height: 1.85;
  color: var(--text-secondary);
}
.notice b {
  color: var(--text-primary);
}
.task {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
.task__l {
  font-size: 12.5px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.task__l b.ok {
  color: var(--success);
}
.task__l b.bad {
  color: var(--danger);
}
.task__m {
  margin-top: 6px;
  font-size: 11.5px;
  color: var(--text-tertiary);
}
.task__bar {
  margin-top: 8px;
  height: 4px;
  border-radius: 99px;
  background: var(--accent-soft);
  overflow: hidden;
}
.task__bar i {
  display: block;
  width: 40%;
  height: 100%;
  border-radius: 99px;
  background: var(--accent);
  animation: slide 1.2s ease-in-out infinite;
}
@keyframes slide {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(250%);
  }
}
.result {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
.result__h {
  font-size: 12.5px;
  font-weight: 600;
  margin-bottom: 8px;
}
.result img {
  width: 100%;
  border-radius: var(--r-sm);
  border: 1px solid var(--border);
  display: block;
}
.result__acts {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  flex-wrap: wrap;
}
</style>

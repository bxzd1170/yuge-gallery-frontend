<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { NButton, NModal, NSelect, useDialog, useMessage, type SelectOption } from 'naive-ui'
import { VueCropper } from 'vue-cropper'
import 'vue-cropper/dist/index.css'
import { uploadPictureUsingPost } from '@/api/pictureController'
import { getSpaceVoByIdUsingGet } from '@/api/spaceController'
import { useLoginUserStore } from '@/stores/useLoginUserStore'
import { usePictureEditSocket, type EditAction } from '@/composables/usePictureEditSocket'
import { toSameOriginImageUrl } from '@/utils/cos'
import { formatSize } from '@/utils/format'

const props = defineProps<{
  show: boolean
  picture: API.PictureVO | null
}>()
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'saved', p: API.PictureVO): void
}>()

const message = useMessage()
const dialog = useDialog()

const cropperRef = ref<InstanceType<typeof VueCropper> | null>(null)

/*
  为什么图片要走同源代理：
  COS 桶没配 CORS，直接拿跨域地址做 canvas 裁剪会有两个必死结局 ——
  带 crossOrigin 加载不成功、不带则 canvas 被污染（toBlob 抛 SecurityError）。
  详见 src/utils/cos.ts 与 vite.config.ts 里的 /cos-proxy。
*/
const cropSrc = computed(() => toSameOriginImageUrl(props.picture?.url))

/* ---------- 输出参数 ---------- */
const outputType = ref<'webp' | 'jpeg' | 'png'>('webp')
const quality = ref(0.92)

const TYPE_OPTIONS: SelectOption[] = [
  { label: 'WebP（体积最小，推荐）', value: 'webp' },
  { label: 'JPEG（兼容性最好）', value: 'jpeg' },
  { label: 'PNG（无损，体积大）', value: 'png' },
]
const QUALITY_OPTIONS: SelectOption[] = [
  { label: '高（0.95）', value: 0.95 },
  { label: '推荐（0.92）', value: 0.92 },
  { label: '中（0.8）', value: 0.8 },
  { label: '低（0.6，体积最小）', value: 0.6 },
]

const SUFFIX: Record<string, string> = { webp: 'webp', jpeg: 'jpg', png: 'png' }

/** 后端 uploadPicture 的业务上限就是 2MB，这里前移成保存前的硬门槛 */
const MAX_UPLOAD = 2 * 1024 * 1024

/* ---------- 测量输出体积 ---------- */
const blob = ref<Blob | null>(null)
const measuring = ref(false)
const measureErr = ref('')

function measure() {
  const c = cropperRef.value
  if (!c) return
  measuring.value = true
  measureErr.value = ''
  try {
    // getCropBlob 是回调式的：它内部渲染 canvas 后 toBlob
    ;(c as unknown as { getCropBlob: (cb: (b: Blob) => void) => void }).getCropBlob((b: Blob) => {
      blob.value = b
      measuring.value = false
    })
  } catch (e) {
    measuring.value = false
    measureErr.value = (e as Error).message || '无法导出裁剪结果（可能是画布被跨域污染）'
  }
}

const tooLarge = computed(() => (blob.value?.size ?? 0) > MAX_UPLOAD)

/* ============================================================
   实时协同编辑
   ------------------------------------------------------------
   后端已经有完整实现（PictureEditHandler + WsHandshakeInterceptor），
   前端负责：连上去、显示「谁在编辑」、把他的操作在本机重放。

   三个由后端决定的前提（不是前端选择）：
     ① **只有团队空间支持协同**：握手拦截器里明确拒绝「图片属于私有空间」和公共图库。
     ② 同一张图同时只能有**一个人**处于编辑状态（服务端 pictureEditingUsers 是单值 Map），
        其他人是「实时围观」，点按钮要等对方退出。
     ③ 同步的只有 4 个动作（放大/缩小/左旋/右旋），**裁剪框的拖拽不同步** ——
        所以别人看到的是画面在转/缩放，而不是框在动。
   ============================================================ */
const loginUserStore = useLoginUserStore()
const {
  status: collabStatus,
  editingUser,
  isEditor,
  lockedByOther,
  lastEvent,
  lastEventAt,
  lastEventType,
  eventLog,
  connect: connectCollab,
  disconnect: disconnectCollab,
  enterEdit,
  exitEdit,
  sendAction,
  logLocal,
} = usePictureEditSocket()

const isTeamSpace = ref(false)
const detectingSpace = ref(false)

/** 团队空间里，只有当前编辑者能操作；非团队空间就不受协同约束（各自本地编辑） */
const canEditNow = computed(() => !isTeamSpace.value || isEditor.value)
const collabOn = computed(() => isTeamSpace.value && collabStatus.value === 'open')

async function detectTeamSpace() {
  const sid = props.picture?.spaceId
  isTeamSpace.value = false
  if (sid == null || String(sid) === '') return
  detectingSpace.value = true
  try {
    const res = await getSpaceVoByIdUsingGet({ id: String(sid) as unknown as number })
    isTeamSpace.value = res.data?.spaceType === 1
  } catch {
    // 查不到空间就当普通图处理：不连协同，避免连上去被握手拒绝后反复重试
    isTeamSpace.value = false
  } finally {
    detectingSpace.value = false
  }
}

/** 远端操作在本机重放（不再往回广播，否则会形成回环） */
function applyRemoteAction(action: EditAction) {
  if (action === 'ROTATE_LEFT') rotateLeft(true)
  else if (action === 'ROTATE_RIGHT') rotateRight(true)
  else if (action === 'ZOOM_IN') zoom(1, true)
  else if (action === 'ZOOM_OUT') zoom(-1, true)
}

/** 团队空间里还没抢到编辑锁 —— 按钮禁用要给出原因，否则用户不知道点哪里 */
const needEnterEdit = computed(
  () => isTeamSpace.value && collabOn.value && !isEditor.value && !editingUser.value,
)

/*
  「谁干了什么」要立刻可见：
    · ENTER_EDIT / EXIT_EDIT / EDIT_ACTION → 弹一条 toast（原版就是每条都 message.info）
    · INFO（进/出房间）太吵，只进下方的「协同动态」列表，不弹窗
  另外所有事件都会进 eventLog，弹窗关掉后再打开也能看到刚才发生了什么。
*/
watch(lastEventAt, () => {
  if (!lastEvent.value) return
  const t = lastEventType.value
  if (t === 'ENTER_EDIT' || t === 'EXIT_EDIT' || t === 'EDIT_ACTION' || t === 'ERROR') {
    message.info(lastEvent.value, { duration: 3200 })
  }
})

function timeShort(at: number) {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function startCollab() {
  const id = props.picture?.id
  if (!id || !isTeamSpace.value) return
  connectCollab(String(id), { onRemoteAction: applyRemoteAction })
}

/** 申请成为当前编辑者；抢锁失败（有人正在编辑）时服务端是静默忽略的 */
function askEnterEdit() {
  if (!collabOn.value) {
    message.warning('协同连接还没建立，请稍候')
    return
  }
  enterEdit(() => {
    message.warning(
      editingUser.value
        ? `${editingUser.value.userName || '其他人'} 正在编辑，等他退出后你才能操作`
        : '进入编辑失败：当前有人正在编辑（状态可能刚刚变化），请稍后再试',
    )
  })
}

function leaveEdit() {
  exitEdit()
}

const statusText = computed(() => {
  if (!isTeamSpace.value) return '本地编辑 · 团队空间才支持协同'
  if (detectingSpace.value) return '正在检测空间…'
  if (collabStatus.value === 'connecting') return '正在连接协同…'
  if (collabStatus.value === 'closed') return '协同连接已断开'
  if (collabStatus.value === 'error') return '协同连接失败'
  if (collabStatus.value !== 'open') return '未连接协同'
  if (isEditor.value) return '你正在编辑'
  if (editingUser.value) return `${editingUser.value.userName || '有人'} 正在编辑`
  return '空闲 · 可以进入编辑'
})

const statusTone = computed(() => {
  if (!isTeamSpace.value) return 'off'
  if (collabStatus.value !== 'open') return 'warn'
  return isEditor.value ? 'me' : editingUser.value ? 'busy' : 'free'
})

/* ---------- 操作 ---------- */
const rotating = ref(false)

/*
  ⚠️ 这里的权限判断必须区分「本地操作」和「重放别人的操作」：
    · 本地操作：非编辑者一律不许（canEditNow = false 就 return）
    · 远端重放：**必须绕过这个判断** —— 观看者的 canEditNow 本来就是 false，
      如果也走这个闸门，别人转了半天他的画面一动不动（这正是之前的 bug）。
      安全性不用担心：这个动作已经在服务端鉴权过（只有当前编辑者能发 EDIT_ACTION）。
*/
function rotateLeft(remote = false) {
  if (!remote && !canEditNow.value) return
  ;(cropperRef.value as unknown as { rotateLeft: () => void })?.rotateLeft()
  afterTransform()
  if (!remote) {
    sendAction('ROTATE_LEFT')
    logLocal('你 执行 左旋操作', 'ROTATE_LEFT')
  }
}
function rotateRight(remote = false) {
  if (!remote && !canEditNow.value) return
  ;(cropperRef.value as unknown as { rotateRight: () => void })?.rotateRight()
  afterTransform()
  if (!remote) {
    sendAction('ROTATE_RIGHT')
    logLocal('你 执行 右旋操作', 'ROTATE_RIGHT')
  }
}
function zoom(d: number, remote = false) {
  if (!remote && !canEditNow.value) return
  ;(cropperRef.value as unknown as { changeScale: (n: number) => void })?.changeScale(d)
  afterTransform()
  if (!remote) {
    sendAction(d > 0 ? 'ZOOM_IN' : 'ZOOM_OUT')
    logLocal(d > 0 ? '你 执行 放大操作' : '你 执行 缩小操作', d > 0 ? 'ZOOM_IN' : 'ZOOM_OUT')
  }
}
/** 变换后等一帧再测：canvas 需要重绘 */
function afterTransform() {
  rotating.value = true
  window.setTimeout(() => {
    rotating.value = false
    measure()
  }, 260)
}

let previewUrl = ''

function revoke() {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl)
    previewUrl = ''
  }
}

/** 下载到本地（纯前端，不改图库） */
async function download() {
  if (!blob.value) return
  revoke()
  previewUrl = URL.createObjectURL(blob.value)
  const a = document.createElement('a')
  a.href = previewUrl
  a.download = `${props.picture?.name || 'image'}-裁剪.${SUFFIX[outputType.value]}`
  a.click()
  message.success('已开始下载')
}

const saving = ref(false)

/**
 * 保存到图库。
 * overwrite = true → 传 id，走「更新」（会**替换原图**，不可恢复）
 * overwrite = false → 不传 id，新建一张，落在与原图相同的空间/图库
 */
async function save(overwrite: boolean) {
  const p = props.picture
  if (!p?.id || !blob.value) return
  // 协同模式下只有当前编辑者能落盘，避免围观者把别人正在调的画面存成一张图
  if (!canEditNow.value) {
    message.warning('有人正在编辑这张图，你只能围观。等他退出后再保存')
    return
  }
  if (tooLarge.value) {
    message.error(`裁剪结果 ${formatSize(blob.value.size)} 超过 2MB 上限，请改用 WebP / 调低质量 / 缩小裁剪范围`)
    return
  }
  if (p.picWidth === 0 && p.picHeight === 0) return

  const doUpload = async () => {
    saving.value = true
    try {
      const suffix = SUFFIX[outputType.value]
      const name = overwrite
        ? `${p.name || 'image'}-裁剪`
        : `${p.name || 'image'}-裁剪-${Date.now() % 100000}`
      const file = new File([blob.value as Blob], `${name}.${suffix}`, {
        type: `image/${outputType.value}`,
      })
      /*
        注意两个易错点：
        1) 生成器签名是 (params, body, file)：表单字段要放**第二个** body 参数
           （放第一个会变成 URL query，虽然后端也能绑上，但语义不对）。
        2) src/request.ts 的响应拦截器**已经解包**并返回 {code,data,message}，
           所以载荷是 res.data，不是 res.data.data。
      */
      const res = await uploadPictureUsingPost(
        {},
        {
          picName: name,
          // 覆盖时不传 spaceId：后端会复用原图的空间（传了就必须完全一致，否则报「空间 id 不一致」）
          ...(overwrite ? { id: String(p.id) as unknown as number } : p.spaceId ? { spaceId: p.spaceId } : {}),
        } as Record<string, unknown>,
        file,
      )
      const saved = res.data
      if (saved) {
        message.success(overwrite ? '已用裁剪结果覆盖原图' : '已另存为新图片')
        emit('saved', saved)
        emit('update:show', false)
      } else {
        message.error(res.message || '保存失败')
      }
    } catch (e) {
      message.error((e as Error).message || '保存失败')
    } finally {
      saving.value = false
    }
  }

  if (!overwrite) {
    await doUpload()
    return
  }
  dialog.warning({
    title: '覆盖原图',
    content: '裁剪结果会替换原图（不可恢复，且空间配额会按体积差值调整）。确定继续？',
    positiveText: '确定覆盖',
    negativeText: '取消',
    onPositiveClick: doUpload,
  })
}

/* ---------- 生命周期 ---------- */
function close() {
  // 先主动让出编辑锁，其他人不用等我这条连接被服务端超时清理
  if (isEditor.value) exitEdit()
  disconnectCollab()
  emit('update:show', false)
}

watch(
  () => props.show,
  async (v) => {
    if (v) {
      blob.value = null
      measureErr.value = ''
      // 先判断是不是团队空间，再决定要不要连协同（私有空间/公共图库连了也会被握手拒绝）
      await detectTeamSpace()
      startCollab()
      await nextTick()
      // 等图片加载完才有尺寸可裁
      window.setTimeout(measure, 1200)
    } else {
      disconnectCollab()
    }
  },
)
watch([outputType, quality], () => {
  if (props.show) window.setTimeout(measure, 350)
})
onUnmounted(() => {
  disconnectCollab()
  revoke()
})
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    title="裁剪图片"
    class="crop-modal"
    :bordered="false"
    :mask-closable="!saving"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="crop">
      <!-- 跨域图片必须走同源代理，否则 canvas 无法导出 -->
      <VueCropper
        v-if="show && cropSrc"
        ref="cropperRef"
        :img="cropSrc"
        :output-type="outputType"
        :output-size="quality"
        :info="true"
        :can-move-box="canEditNow"
        :fixed-box="false"
        :auto-crop="true"
        :center-box="true"
        :can-scale="canEditNow"
        class="crop__stage"
      />
    </div>

    <!--
      协同状态条：只有团队空间才出现（后端握手拦截器明确拒绝私有空间和公共图库）。
      「同一时刻只有一个人能操作」是后端 pictureEditingUsers 的设计，不是前端限制。
    -->
    <div v-if="isTeamSpace" class="collab" :class="`collab--${statusTone}`">
      <span class="collab__dot" />
      <span class="collab__t">协同编辑 · {{ statusText }}</span>
      <span v-if="editingUser && !isEditor" class="collab__who">
        <img v-if="editingUser.userAvatar" class="collab__av" :src="editingUser.userAvatar" alt="" />
        <b>{{ editingUser.userName || '用户' }}</b>
      </span>
      <span class="collab__grow" />
      <button v-if="collabOn && !editingUser" class="collab__btn" @click="askEnterEdit">进入编辑</button>
      <button v-if="isEditor" class="collab__btn collab__btn--out" @click="leaveEdit">退出编辑</button>
    </div>

    <div v-if="lockedByOther" class="collab__lock">
      {{ editingUser?.userName || '其他用户' }} 正在编辑，你的操作已暂时锁住 ——
      他退出后才能在「进入编辑」里接手。你现在看到的是他的实时画面。
    </div>
    <div v-else-if="needEnterEdit" class="collab__lock collab__lock--hint">
      这是团队空间的图片：为避免多人同时改同一张图，需要先点右上角<b>「进入编辑」</b>才能操作和保存。
    </div>

    <div class="crop__ctrl">
      <n-button size="small" :disabled="saving || !canEditNow" @click="rotateLeft()">向左旋转</n-button>
      <n-button size="small" :disabled="saving || !canEditNow" @click="rotateRight()">向右旋转</n-button>
      <n-button size="small" :disabled="saving || !canEditNow" @click="zoom(1)">放大</n-button>
      <n-button size="small" :disabled="saving || !canEditNow" @click="zoom(-1)">缩小</n-button>
      <n-button size="small" :disabled="saving || measuring || !canEditNow" @click="measure">
        {{ measuring ? '计算中…' : '重新计算体积' }}
      </n-button>
    </div>

    <!--
      协同动态放在操作按钮下面：它是「这些操作的流水」，紧贴操作区更好读，
      也不会把图片舞台和按钮之间的视觉动线切断。
    -->
    <div v-if="isTeamSpace && eventLog.length" class="clog">
      <div class="clog__h">协同动态</div>
      <div
        v-for="(e, i) in eventLog.slice(0, 5)"
        :key="e.at"
        class="clog__i"
        :class="{
          'clog__i--new': i === 0,
          'clog__i--act': e.type === 'EDIT_ACTION' || e.type === 'LOCAL',
          'clog__i--mine': e.type === 'LOCAL',
        }"
      >
        <span class="clog__t">{{ timeShort(e.at) }}</span>
        <span class="clog__x">{{ e.text }}</span>
      </div>
    </div>

    <div class="crop__out">
      <div class="f">
        <label>输出格式</label>
        <n-select v-model:value="outputType" :options="TYPE_OPTIONS" size="small" />
      </div>
      <div class="f">
        <label>压缩质量<span class="opt">越低体积越小</span></label>
        <n-select v-model:value="quality" :options="QUALITY_OPTIONS" size="small" />
      </div>
      <div class="f f--size">
        <label>预计体积</label>
        <div class="size" :class="{ bad: tooLarge }">
          <template v-if="measureErr">{{ measureErr }}</template>
          <template v-else-if="measuring">计算中…</template>
          <template v-else-if="blob">
            {{ formatSize(blob.size) }}
            <span class="size__lim">/ 上限 2 MB</span>
          </template>
          <template v-else>—</template>
        </div>
      </div>
    </div>

    <div v-if="tooLarge" class="notice notice--err">
      裁剪结果超过 <b>2MB</b> 上传上限，无法保存到图库。可以：改用 <b>WebP</b>、调低压缩质量、或缩小裁剪范围。
      （仍然可以「下载到本地」。）
    </div>

    <div class="hint">
      原图尺寸 {{ picture?.picWidth }} × {{ picture?.picHeight }}。
      保存到图库有两种方式：「另存为新图片」不会动原图；「覆盖原图」会用裁剪结果替换它。
      <template v-if="isTeamSpace">
        <br />
        协同只同步<b>放大 / 缩小 / 左旋 / 右旋</b>四种动作（目前只支持这四个），
        <b>裁剪框的拖拽不会同步</b> —— 对方看到的是画面变化，框的位置各自独立。
      </template>
    </div>

    <template #footer>
      <div class="foot">
        <n-button size="small" :disabled="saving" @click="close">取消</n-button>
        <n-button size="small" :disabled="saving || !blob" @click="download">下载到本地</n-button>
        <n-button size="small" :disabled="saving || !blob || tooLarge || !canEditNow" @click="save(false)">
          {{ saving ? '处理中…' : '另存为新图片' }}
        </n-button>
        <n-button
          size="small"
          type="primary"
          :disabled="saving || !blob || tooLarge || !canEditNow"
          @click="save(true)"
        >
          覆盖原图
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.crop-modal {
  width: 900px;
}
.crop {
  background: var(--bg-base);
  border-radius: var(--r-md);
  overflow: hidden;
}
.crop__stage {
  height: 420px;
  width: 100%;
}

/* ---------- 协同状态条 ---------- */
.collab {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding: 8px 12px;
  border-radius: var(--r-sm);
  border: 1px solid var(--border);
  background: var(--bg-surface);
  font-size: 12px;
  color: var(--text-secondary);
  flex-wrap: wrap;
}
.collab__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-tertiary);
  flex: none;
}
.collab--free .collab__dot {
  background: var(--success);
}
.collab--me {
  border-color: rgba(108, 123, 255, 0.45);
  background: var(--accent-soft);
}
.collab--me .collab__dot {
  background: var(--accent);
}
.collab--busy .collab__dot {
  background: var(--accent-warm);
}
.collab--warn {
  border-color: rgba(240, 101, 95, 0.4);
}
.collab--warn .collab__dot {
  background: var(--danger);
}
.collab__t {
  color: var(--text-primary);
}
.collab__who {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--text-secondary);
}
.collab__av {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  object-fit: cover;
}
.collab__grow {
  flex: 1;
}
.collab__btn {
  font-family: var(--font);
  font-size: 11.5px;
  padding: 4px 12px;
  border-radius: 7px;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: #fff;
  cursor: pointer;
  white-space: nowrap;
}
.collab__btn:hover {
  background: var(--accent-hover);
}
.collab__btn--out {
  background: transparent;
  color: var(--text-secondary);
  border-color: var(--border-strong);
}
.collab__btn--out:hover {
  background: transparent;
  color: var(--text-primary);
}
/* ---------- 协同动态 ---------- */
.clog {
  margin-top: 8px;
  padding: 8px 12px 6px;
  border-radius: var(--r-sm);
  background: var(--bg-surface);
  border: 1px solid var(--border);
}
.clog__h {
  font-size: 10.5px;
  letter-spacing: 0.06em;
  color: var(--text-tertiary);
  margin-bottom: 4px;
}
.clog__i {
  display: flex;
  gap: 8px;
  font-size: 11.5px;
  line-height: 1.9;
  color: var(--text-tertiary);
}
.clog__i--act {
  color: var(--text-secondary);
}
.clog__i--new {
  color: var(--text-primary);
}
/* 自己的操作：用主色区分，一眼看出「这条是我做的」 */
.clog__i--mine .clog__x {
  color: var(--accent);
}
.clog__t {
  font-variant-numeric: tabular-nums;
  flex: none;
  color: var(--text-tertiary);
}
.clog__x {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.collab__lock {
  margin-top: 8px;
  padding: 8px 12px;
  border-radius: var(--r-sm);
  background: rgba(255, 184, 107, 0.1);
  border: 1px solid rgba(255, 184, 107, 0.35);
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--accent-warm);
}
.collab__lock--hint {
  background: var(--bg-surface);
  border-color: var(--border);
  color: var(--text-secondary);
}
.collab__lock--hint b {
  color: var(--text-primary);
}
.crop__ctrl {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.crop__out {
  display: flex;
  gap: 14px;
  margin-top: 14px;
  align-items: flex-end;
}
.crop__out .f {
  flex: 1;
}
.crop__out .f--size {
  flex: 0 0 190px;
}
.crop__out label {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 6px;
}
.crop__out .opt {
  color: var(--text-tertiary);
  font-size: 11px;
  margin-left: 4px;
}
.size {
  height: 34px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-base);
  font-size: 12.5px;
  color: var(--text-primary);
}
.size.bad {
  color: var(--danger);
  border-color: rgba(240, 101, 95, 0.5);
}
.size__lim {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-left: 6px;
}
.notice {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: var(--r-sm);
  font-size: 12px;
  line-height: 1.8;
}
.notice--err {
  background: rgba(240, 101, 95, 0.12);
  color: var(--danger);
}
.notice b {
  color: inherit;
}
.hint {
  margin-top: 12px;
  font-size: 11.5px;
  line-height: 1.8;
  color: var(--text-tertiary);
}
.foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>

import { computed, ref } from 'vue'
import { useLoginUserStore } from '@/stores/useLoginUserStore'

/**
 * 图片实时协同编辑（WebSocket 客户端）
 *
 * 后端实现已存在，前端只是接入：
 *   · 端点：`ws(s)://<同源>/api/ws/picture/edit?pictureId=xxx`
 *     （`WebSocketConfig#registerWebSocketHandlers` → `PictureEditHandler`）
 *   · 握手鉴权（`WsHandshakeInterceptor`）三个硬条件，任一不满足就直接拒绝握手：
 *       1. 必须已登录（用 cookie 里的登录态）
 *       2. 图片必须存在
 *       3. **图片若属于空间，该空间必须是「团队空间」**（私有空间/公共图库一律拒绝）
 *       4. 当前用户在该空间有 `picture:edit` 权限
 *   · 服务端是「单编辑者 + 多人围观」模型（`pictureEditingUsers` 是 Map<pictureId, userId>）：
 *       同一张图同时只允许一个人处于编辑状态，其他人能看到他做的每一个操作。
 *
 * 消息协议（`PictureEditMessageTypeEnum` / `PictureEditActionEnum`）：
 *   C→S  { type: 'ENTER_EDIT' } / { type: 'EXIT_EDIT' } / { type: 'EDIT_ACTION', editAction }
 *   S→C  { type: 'INFO'|'ERROR'|'ENTER_EDIT'|'EXIT_EDIT'|'EDIT_ACTION', message, editAction, user }
 *
 * ⚠️ 两个由后端协议决定的限制，前端无法绕过，界面上必须如实说明：
 *   1. `ENTER_EDIT` 在「已有人编辑」时是**静默忽略**的（不返回错误），
 *      所以点「进入编辑」后只能等服务端广播 `ENTER_EDIT` 才算成功，需要有超时提示。
 *   2. `EDIT_ACTION` 只支持 4 种动作（放大/缩小/左旋/右旋），**裁剪框拖拽不在同步范围内**。
 *      所以别人看到的是"把画面转了/缩放了"，而不是"框在动"。
 */

export type CollabStatus = 'off' | 'connecting' | 'open' | 'closed' | 'error'
export type EditAction = 'ZOOM_IN' | 'ZOOM_OUT' | 'ROTATE_LEFT' | 'ROTATE_RIGHT'
export type EditMessageType = 'INFO' | 'ERROR' | 'ENTER_EDIT' | 'EXIT_EDIT' | 'EDIT_ACTION'

interface EditMessage {
  type?: EditMessageType
  message?: string
  editAction?: EditAction
  user?: API.UserVO
}

/** 一条协同动态，用于界面上回溯「谁在什么时候做了什么」 */
export interface CollabEvent {
  at: number
  type: EditMessageType | 'LOCAL'
  text: string
  /** 动作类事件才带，便于界面区分样式 */
  action?: EditAction
}

const ACTION_TEXT: Record<EditAction, string> = {
  ZOOM_IN: '放大',
  ZOOM_OUT: '缩小',
  ROTATE_LEFT: '左旋',
  ROTATE_RIGHT: '右旋',
}

export function usePictureEditSocket() {
  const loginUserStore = useLoginUserStore()

  const status = ref<CollabStatus>('off')
  /** 当前正在编辑的人；null = 没人编辑 */
  const editingUser = ref<API.UserVO | null>(null)
  /** 最近一条协同事件文案（用于 toast 与高亮） */
  const lastEvent = ref('')
  const lastEventAt = ref(0)
  /** 最近一条事件的类型，调用方据此决定要不要弹 toast */
  const lastEventType = ref<EditMessageType | 'LOCAL'>('INFO')
  /** 协同动态（最新的在前，最多 8 条） */
  const eventLog = ref<CollabEvent[]>([])
  const MAX_LOG = 8

  const myId = computed(() => {
    const id = loginUserStore.loginUser?.id
    return id == null ? '' : String(id)
  })
  const isEditor = computed(() => {
    const u = editingUser.value
    return Boolean(u?.id != null && myId.value && String(u.id) === myId.value)
  })
  /** 有人（不是我）正在编辑 → 本地操作要锁住 */
  const lockedByOther = computed(() => Boolean(editingUser.value) && !isEditor.value)

  let ws: WebSocket | null = null
  let currentPictureId = ''
  let onRemoteAction: ((a: EditAction) => void) | null = null
  let manualClose = false
  let retryCount = 0
  let retryTimer = 0
  let enterTimer = 0

  function emitEvent(type: EditMessageType | 'LOCAL', text: string, action?: EditAction) {
    if (!text) return
    const at = Date.now()
    lastEvent.value = text
    lastEventAt.value = at
    lastEventType.value = type
    eventLog.value = [{ at, type, text, action }, ...eventLog.value].slice(0, MAX_LOG)
  }

  function buildUrl(pictureId: string) {
    /*
      必须走**同源**（localhost:5175 → vite 代理 → 8123）。
      直连 ws://localhost:8123 也能通，但那样就得把后端地址写死在代码里，
      上线还要改；同源写法在开发/生产都成立（生产由 Nginx 反代 /api，见 README）。
    */
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${window.location.host}/api/ws/picture/edit?pictureId=${encodeURIComponent(pictureId)}`
  }

  function clearTimers() {
    if (retryTimer) {
      window.clearTimeout(retryTimer)
      retryTimer = 0
    }
    if (enterTimer) {
      window.clearTimeout(enterTimer)
      enterTimer = 0
    }
  }

  function handleMessage(raw: string) {
    let msg: EditMessage
    try {
      msg = JSON.parse(raw) as EditMessage
    } catch {
      return
    }
    switch (msg.type) {
      case 'ENTER_EDIT':
        // 服务端会广播给房间内所有人（包括发起者自己），所以这里就是「抢锁成功」的确认
        editingUser.value = msg.user ?? null
        if (enterTimer) {
          window.clearTimeout(enterTimer)
          enterTimer = 0
        }
        emitEvent('ENTER_EDIT', msg.message || '有人开始编辑')
        break
      case 'EXIT_EDIT':
        // 只清掉「正在编辑的那个人」，避免把新进入的人误清
        if (!editingUser.value || String(msg.user?.id) === String(editingUser.value.id)) {
          editingUser.value = null
        }
        emitEvent('EXIT_EDIT', msg.message || '编辑者已退出')
        break
      case 'EDIT_ACTION':
        if (msg.editAction && msg.editAction in ACTION_TEXT) {
          // 先重放动作，再记录动态 —— 文案与画面顺序一致
          onRemoteAction?.(msg.editAction)
        }
        emitEvent(
          'EDIT_ACTION',
          msg.message || (msg.editAction ? `对方执行了${ACTION_TEXT[msg.editAction]}` : '对方有操作'),
          msg.editAction,
        )
        break
      case 'INFO':
        // 「用户 x 加入/离开编辑」——这是房间进出通知，不代表进入编辑状态
        emitEvent('INFO', msg.message || '')
        break
      case 'ERROR':
        emitEvent('ERROR', msg.message || '协同编辑出错')
        break
      default:
        break
    }
  }

  function connect(pictureId: string, opts?: { onRemoteAction?: (a: EditAction) => void }) {
    if (!pictureId) return
    onRemoteAction = opts?.onRemoteAction ?? null
    currentPictureId = pictureId
    manualClose = false
    retryCount = 0
    open()
  }

  function open() {
    closeSocket()
    status.value = 'connecting'
    let socket: WebSocket
    try {
      socket = new WebSocket(buildUrl(currentPictureId))
    } catch {
      status.value = 'error'
      return
    }
    ws = socket

    socket.onopen = () => {
      status.value = 'open'
      retryCount = 0
    }
    socket.onmessage = (ev) => handleMessage(String(ev.data))
    socket.onerror = () => {
      status.value = 'error'
    }
    socket.onclose = () => {
      ws = null
      editingUser.value = null
      if (manualClose) {
        status.value = 'off'
        return
      }
      status.value = 'closed'
      /*
        断线自动重连：后端重启 / 网络抖动 / 代理超时都会走到这里。
        握手失败（无权限、非团队空间）也会立刻 close，这种情况重试没意义 ——
        但前端区分不了，所以最多重试 2 次就停，避免无意义刷屏。
      */
      if (retryCount < 2) {
        retryCount += 1
        retryTimer = window.setTimeout(() => {
          if (!manualClose && currentPictureId) open()
        }, 2000 * retryCount)
      }
    }
  }

  function closeSocket() {
    if (ws) {
      ws.onopen = null
      ws.onmessage = null
      ws.onerror = null
      ws.onclose = null
      try {
        ws.close()
      } catch {
        /* ignore */
      }
      ws = null
    }
  }

  function disconnect() {
    manualClose = true
    clearTimers()
    closeSocket()
    status.value = 'off'
    editingUser.value = null
    lastEvent.value = ''
    eventLog.value = []
  }

  function send(payload: Record<string, unknown>) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    ws.send(JSON.stringify(payload))
    return true
  }

  /**
   * 申请进入编辑。
   * 服务端在「已有人编辑」时不会报错、也不会回复 —— 所以这里挂了超时：
   * 2 秒内没收到 ENTER_EDIT 广播，就判定为抢锁失败。
   */
  function enterEdit(onFail?: () => void) {
    if (!send({ type: 'ENTER_EDIT' })) {
      onFail?.()
      return
    }
    if (enterTimer) window.clearTimeout(enterTimer)
    enterTimer = window.setTimeout(() => {
      enterTimer = 0
      if (!isEditor.value) onFail?.()
    }, 2200)
  }

  function exitEdit() {
    send({ type: 'EXIT_EDIT' })
  }

  function sendAction(action: EditAction) {
    send({ type: 'EDIT_ACTION', editAction: action })
  }

  /**
   * 记录「自己」的操作。
   * 服务端广播 EDIT_ACTION 时**会排除发送者**（否则本地会重复执行一次），
   * 所以自己的动作不会从 WebSocket 回来 —— 想在「协同动态」里看到完整流水，
   * 必须本地补一条。类型记为 LOCAL，调用方据此不弹 toast（自己的操作自己能看见）。
   */
  function logLocal(text: string, action?: EditAction) {
    emitEvent('LOCAL', text, action)
  }

  return {
    status,
    editingUser,
    isEditor,
    lockedByOther,
    lastEvent,
    lastEventAt,
    lastEventType,
    eventLog,
    connect,
    disconnect,
    enterEdit,
    exitEdit,
    sendAction,
    logLocal,
  }
}

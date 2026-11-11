import { computed, ref, watch } from 'vue'

export type ThemeMode = 'system' | 'dark' | 'light'
export type ResolvedTheme = 'dark' | 'light'

const STORAGE_KEY = 'yuge-theme'

const media =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: light)')
    : null

function readMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'system' || saved === 'dark' || saved === 'light') return saved
  } catch {
    /* localStorage 不可用时忽略 */
  }
  // 默认深色。注意：这里刻意不返回 'system'，
  // 否则系统为浅色时会把默认主题带跑，违背「以暗色为主」的产品设定。
  return 'dark'
}

/** 用户选择（持久化） */
const mode = ref<ThemeMode>(readMode())

/** 系统是否为浅色 */
const systemLight = ref(media ? media.matches : false)

if (media) {
  const onChange = (e: MediaQueryListEvent) => {
    systemLight.value = e.matches
  }
  if (media.addEventListener) {
    media.addEventListener('change', onChange)
  } else {
    // 兼容旧版 Safari
    ;(media as MediaQueryList & { addListener: (cb: (e: MediaQueryListEvent) => void) => void }).addListener(onChange)
  }
}

/** 实际生效的主题 */
const resolved = computed<ResolvedTheme>(() =>
  mode.value === 'system' ? (systemLight.value ? 'light' : 'dark') : mode.value,
)

function applyToDom() {
  const root = document.documentElement
  root.setAttribute('data-theme', resolved.value)
  root.setAttribute('data-theme-mode', mode.value)
}

// 任何人改 mode、或系统偏好变化时，同步到 DOM
watch([resolved, mode], applyToDom, { immediate: true })

export function useTheme() {
  function setMode(next: ThemeMode) {
    mode.value = next
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }

  /** 在深色 / 浅色之间直接切换（不进入「跟随系统」态） */
  function toggle() {
    setMode(resolved.value === 'dark' ? 'light' : 'dark')
  }

  return { mode, resolved, setMode, toggle }
}

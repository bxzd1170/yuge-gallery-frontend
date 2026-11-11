<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 当前页码，从 1 开始 */
    current: number
    /** 总条数 */
    total: number
    /** 每页条数 */
    pageSize: number
    disabled?: boolean
  }>(),
  { disabled: false },
)

const emit = defineEmits<{ (e: 'change', page: number): void }>()

const pageCount = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))

/**
 * 生成页码序列，页数多时以省略号收窄。
 * 始终保留：首页、末页、当前页及其左右各一页。
 */
const pages = computed<(number | '...')[]>(() => {
  const n = pageCount.value
  const c = props.current
  if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1)

  const keep = new Set<number>([1, n, c - 1, c, c + 1])
  const sorted = [...keep].filter((p) => p >= 1 && p <= n).sort((a, b) => a - b)

  const out: (number | '...')[] = []
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push('...')
    out.push(p)
  })
  return out
})

function go(page: number) {
  if (props.disabled) return
  if (page < 1 || page > pageCount.value || page === props.current) return
  emit('change', page)
}
</script>

<template>
  <nav v-if="pageCount > 1" class="pager">
    <span class="pager__info">共 {{ total }} 张 · 第 {{ current }} / {{ pageCount }} 页</span>

    <div class="pager__ctrl">
      <button class="pbtn" :disabled="disabled || current <= 1" @click="go(current - 1)">
        <svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" /></svg>
      </button>

      <template v-for="(p, i) in pages" :key="`${p}-${i}`">
        <span v-if="p === '...'" class="pdots">…</span>
        <button
          v-else
          class="pbtn pbtn--num"
          :class="{ on: p === current }"
          :disabled="disabled"
          @click="go(Number(p))"
        >
          {{ p }}
        </button>
      </template>

      <button class="pbtn" :disabled="disabled || current >= pageCount" @click="go(current + 1)">
        <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.pager {
  margin-top: 22px;
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.pager__info {
  font-size: 12.5px;
  color: var(--text-tertiary);
}
.pager__ctrl {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}
.pbtn {
  min-width: 32px;
  height: 32px;
  padding: 0 8px;
  border-radius: 9px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-family: var(--font);
  font-size: 12.5px;
  display: grid;
  place-items: center;
  cursor: pointer;
}
.pbtn:hover:not(:disabled) {
  color: var(--text-primary);
  border-color: var(--border-strong);
}
.pbtn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.pbtn svg {
  width: 15px;
  height: 15px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.pbtn--num.on {
  background: var(--accent-soft);
  border-color: transparent;
  color: var(--accent);
  font-weight: 600;
}
.pdots {
  min-width: 20px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12.5px;
}
</style>

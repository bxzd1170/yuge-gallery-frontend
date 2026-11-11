<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    picture: API.PictureVO
    /**
     * cover = 等高网格：瓦片固定比例，图片居中裁切，行列严格对齐
     * auto  = 瀑布流：保持图片原始比例，不裁切
     */
    fit?: 'cover' | 'auto'
  }>(),
  { fit: 'auto' },
)

const emit = defineEmits<{ (e: 'open', picture: API.PictureVO): void }>()

const fitMode = computed(() => `card--${props.fit}`)

/**
 * 优先用缩略图：实测中位字节数 8.4KB，原图则是几百 KB；
 * 缩略图宽度多为 474px，在 200px 级瓦片里足够（含 2x DPR）。
 */
const src = computed(() => props.picture.thumbnailUrl || props.picture.url || '')

/**
 * 标签要做兼容处理：后端 `PictureVO.tags` 是 `List<String>`（已经是数组），
 * 而 `Picture`（实体/DTO）里存的是 JSON 字符串。
 * ⚠️ 对数组直接 JSON.parse 会抛异常并被 catch 吞掉 —— 表现为「标签永远不显示」。
 */
const tags = computed<string[]>(() => {
  const raw = props.picture.tags as unknown
  if (!raw) return []
  if (Array.isArray(raw)) return raw.filter(Boolean).map(String)
  if (typeof raw === 'string') {
    try {
      const arr = JSON.parse(raw)
      return Array.isArray(arr) ? arr.filter(Boolean).map(String) : []
    } catch {
      return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    }
  }
  return []
})
</script>

<template>
  <figure class="card" :class="fitMode" @click="emit('open', picture)">
    <div class="card__ph">
      <img :src="src" :alt="picture.name || '未命名'" loading="lazy" referrerpolicy="no-referrer" />

      <div class="card__ov">
        <div class="card__ovrow">
          <div class="card__tags">
            <span v-if="picture.category" class="tag">{{ picture.category }}</span>
            <span v-for="t in tags" :key="t" class="tag">{{ t }}</span>
          </div>
          <div class="card__acts">
            <i title="下载">
              <svg viewBox="0 0 24 24"><path d="M12 4v10M8 11l4 4 4-4M5 20h14" /></svg>
            </i>
            <i title="编辑">
              <svg viewBox="0 0 24 24"><path d="M4 20h4L19 9a2 2 0 0 0-3-3L5 17v3z" /></svg>
            </i>
          </div>
        </div>
      </div>
    </div>

    <figcaption class="card__cap">
      <div class="card__n ellipsis">{{ picture.name || '未命名' }}</div>
    </figcaption>
  </figure>
</template>

<style scoped>
.card {
  margin: 0;
  border-radius: var(--r-md);
  overflow: hidden;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-card);
  cursor: pointer;
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}
/* 悬停：轻微上浮 + 图片微放大（触屏无效是正常的，触屏没有 hover） */
.card:hover {
  transform: translateY(-3px);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-card-hover);
}
.card__ph img {
  transition: transform 0.25s ease;
}
.card:hover .card__ph img {
  transform: scale(1.035);
}
@media (prefers-reduced-motion: reduce) {
  .card,
  .card__ph img {
    transition: none;
  }
  .card:hover {
    transform: none;
  }
  .card:hover .card__ph img {
    transform: none;
  }
}

.card__ph {
  position: relative;
  display: block;
  line-height: 0;
  overflow: hidden;
}

/* 等高网格：固定瓦片比例 + 居中裁切，保证每行高度一致 */
.card--cover .card__ph {
  aspect-ratio: var(--tile-ratio, 1 / 1);
}
.card--cover .card__ph img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
}

/* 瀑布流：完全保持原始比例，不裁切 */
.card--auto .card__ph img {
  width: 100%;
  height: auto;
}

.card__ov {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  padding: 10px 12px;
  opacity: 0;
  background: var(--scrim);
  transition: opacity 0.18s ease;
}
.card:hover .card__ov {
  opacity: 1;
}
/* 触屏没有 hover，标签必须常驻，否则永久不可见 */
@media (hover: none) {
  .card__ov {
    opacity: 1;
  }
}

.card__ovrow {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.card__tags {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}
.tag {
  font-size: 10.5px;
  padding: 2px 7px;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.14);
  color: #d6dae6;
  backdrop-filter: blur(4px);
  white-space: nowrap;
}
.card__acts {
  margin-left: auto;
  display: flex;
  gap: 6px;
}
.card__acts i {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.16);
  display: grid;
  place-items: center;
  backdrop-filter: blur(4px);
}
.card__acts svg {
  width: 14px;
  height: 14px;
  stroke: #fff;
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.card__cap {
  padding: 9px 12px 10px;
  background: var(--bg-surface);
}
.card__n {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text-primary);
}
</style>

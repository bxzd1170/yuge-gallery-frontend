<script setup lang="ts">
/*
  以图搜图弹窗
  ------------------------------------------------------------------
  数据仅来自一个既有接口：POST /picture/search/picture，请求体只有 { pictureId }。
  后端做的事：把这张图上传到第三方识图服务，拿回「缩略图 + 来源网页」列表。
  所以：
  · 每次打开都会真实调用一次外部服务（约 1~3 秒），不做自动轮询，只在打开时查一次 + 失败可重试；
  · 结果里的缩略图是第三方外链（http），必须带 referrerpolicy="no-referrer"，
    否则容易被防盗链拦成白块；
  · 缩略图加载失败时用占位块兜住，避免整格塌掉。
  入口放在大图页，且只对「空间内的图」开放（见 PictureLightbox 的 canImageSearch 注释）。
*/
import { computed, ref, watch } from 'vue'
import { NButton, NModal, NSpin } from 'naive-ui'
import { searchPictureByPictureUsingPost } from '@/api/pictureController'

const props = defineProps<{
  show: boolean
  /** 要拿去搜索的图（只用它的 id） */
  picture: API.PictureVO | null
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
}>()

const loading = ref(false)
const error = ref('')
const results = ref<API.ImageSearchResult[]>([])
/** 记录加载失败的缩略图，用于渲染占位（外链可能是 http + 防盗链） */
const brokenThumbs = ref<Record<number, boolean>>({})

const title = computed(() => '找相似图片')

async function run() {
  const id = props.picture?.id
  if (!id) return
  loading.value = true
  error.value = ''
  results.value = []
  brokenThumbs.value = {}
  try {
    // 雪花 ID 以字符串传递（19 位超过 Number.MAX_SAFE_INTEGER）
    const res = await searchPictureByPictureUsingPost({ pictureId: String(id) as unknown as number })
    results.value = (res.data ?? []).filter((item) => !!item.thumbUrl)
  } catch (e) {
    error.value = (e as Error).message || '搜索失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

// 每次打开都重新查：同一张图的结果会随时间变化，缓存意义不大
watch(
  () => props.show,
  (visible) => {
    if (visible) run()
  },
)

function hostOf(url?: string) {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function openSource(url?: string) {
  if (!url) return
  window.open(url, '_blank', 'noopener,noreferrer')
}
</script>

<template>
  <n-modal
    :show="props.show"
    preset="card"
    :title="title"
    :style="{ width: '760px', maxWidth: '92vw' }"
    :bordered="false"
    :mask-closable="true"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="is">
      <!-- 加载中 -->
      <div v-if="loading" class="is__state">
        <n-spin size="small" />
        <span>正在搜索相似图片，大约需要几秒…</span>
      </div>

      <!-- 失败：外部服务不稳定时给一条人话 + 重试 -->
      <div v-else-if="error" class="is__state is__state--err">
        <span>{{ error }}</span>
        <n-button size="tiny" secondary @click="run">重试</n-button>
      </div>

      <!-- 结果为空 -->
      <div v-else-if="!results.length" class="is__state">
        <span>没有找到相似图片。</span>
        <span class="is__hint">换一张主体更明确、更清晰的图再试试。</span>
      </div>

      <!-- 结果网格 -->
      <div v-else class="is__grid">
        <button
          v-for="(item, i) in results"
          :key="`${i}-${item.thumbUrl}`"
          class="is__cell"
          :title="item.fromUrl || '打开来源网页'"
          @click="openSource(item.fromUrl)"
        >
          <img
            v-if="!brokenThumbs[i]"
            :src="item.thumbUrl"
            alt=""
            loading="lazy"
            referrerpolicy="no-referrer"
            @error="brokenThumbs[i] = true"
          />
          <span v-else class="is__ph">图片无法预览</span>
          <span class="is__src">{{ hostOf(item.fromUrl) || '查看来源' }}</span>
        </button>
      </div>
    </div>
  </n-modal>
</template>

<style scoped>
.is {
  display: flex;
  flex-direction: column;
  min-height: 180px;
}

/* ---------- 状态区 ---------- */
.is__state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 34px 16px;
  font-size: 12.5px;
  color: var(--text-secondary);
  text-align: center;
}
.is__state--err {
  color: var(--danger);
}
.is__hint {
  font-size: 11.5px;
  color: var(--text-tertiary);
}

/* ---------- 结果网格 ---------- */
.is__grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  max-height: 60vh;
  overflow-y: auto;
  padding: 2px;
}
@media (max-width: 720px) {
  .is__grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

.is__cell {
  position: relative;
  display: block;
  aspect-ratio: 1;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--bg-base);
  padding: 0;
  cursor: pointer;
}
.is__cell img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.is__cell:hover {
  border-color: var(--border-strong);
}
.is__ph {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--text-tertiary);
}
/* 来源站点名：平时半透明压在图底部，悬停加深，方便快速判断出处 */
.is__src {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 14px 7px 5px;
  font-size: 10.5px;
  color: #fff;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.62), rgba(0, 0, 0, 0));
  opacity: 0.85;
}
.is__cell:hover .is__src {
  opacity: 1;
}
</style>

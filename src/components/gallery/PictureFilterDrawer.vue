<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NDatePicker, NDrawer, NDrawerContent, NInput, dateZhCN, zhCN } from 'naive-ui'
import type { PictureFilters } from '@/types/pictureFilter'

/**
 * 空间内搜索 / 筛选抽屉
 *
 * 为什么做成抽屉而不是一个独立页面：
 *   进到空间之后直接在图片上方筛，不用跳走再跳回来，也不丢当前浏览的上下文。
 *
 * 字段全部来自后端 `PictureQueryRequest` + `getQueryWrapper` 里**真实生效**的条件，
 * 不做后端不支持的筛选（比如「宽度大于 500」这种范围查询，后端只支持精确等值）。
 *
 * 按色搜索是**另一个接口**（`/picture/search/color`），不是列表条件：
 *   · 必须传 spaceId，所以公共图库下不可用
 *   · 后端写死「只允许空间创建者本人」，成员/系统管理员都会被拒
 *   · 结果 `.limit(12)` 且无分页
 */

const props = defineProps<{
  show: boolean
  spaceId?: string
  spaceName?: string
  /** 只有空间创建者本人能按色搜索（后端硬编码） */
  canColorSearch: boolean
  /** 重新打开时回填上次条件 */
  initial?: PictureFilters
}>()

const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'apply', f: PictureFilters): void
  (e: 'colorSearch', color: string): void
  (e: 'reset'): void
}>()

const visible = computed({
  get: () => props.show,
  set: (v: boolean) => emit('update:show', v),
})

const tab = ref<'keyword' | 'color'>('keyword')

const form = ref({
  searchText: '',
  name: '',
  introduction: '',
  category: '',
  tagsText: '',
  picFormat: '',
  picWidth: '',
  picHeight: '',
})

const editRange = ref<[number, number] | null>(null)
const color = ref('#5563e0')

watch(
  () => props.show,
  (v) => {
    if (!v) return
    // 回填
    const f = props.initial || {}
    form.value = {
      searchText: f.searchText || '',
      name: f.name || '',
      introduction: f.introduction || '',
      category: f.category || '',
      tagsText: (f.tags || []).join('、'),
      picFormat: f.picFormat || '',
      picWidth: f.picWidth ? String(f.picWidth) : '',
      picHeight: f.picHeight ? String(f.picHeight) : '',
    }
    editRange.value =
      f.startEditTime && f.endEditTime
        ? [new Date(f.startEditTime).getTime(), new Date(f.endEditTime).getTime()]
        : null
    tab.value = 'keyword'
  },
)

/** 有效条件数量，用于按钮上显示「已筛 N 项」 */
const activeCount = computed(() => {
  const o: PictureFilters = {}
  if (form.value.searchText.trim()) o.searchText = form.value.searchText
  if (form.value.name.trim()) o.name = form.value.name
  if (form.value.introduction.trim()) o.introduction = form.value.introduction
  if (form.value.category.trim()) o.category = form.value.category
  if (form.value.tagsText.trim()) o.tags = form.value.tagsText.split(/[、,，\s]+/).filter(Boolean)
  if (form.value.picFormat.trim()) o.picFormat = form.value.picFormat
  if (form.value.picWidth.trim()) o.picWidth = Number(form.value.picWidth)
  if (form.value.picHeight.trim()) o.picHeight = Number(form.value.picHeight)
  if (editRange.value) {
    o.startEditTime = new Date(editRange.value[0]).toISOString()
    o.endEditTime = new Date(editRange.value[1]).toISOString()
  }
  return Object.keys(o).length
})

function buildFilters(): PictureFilters {
  const f: PictureFilters = {}
  const trim = (s: string) => s.trim()
  if (trim(form.value.searchText)) f.searchText = trim(form.value.searchText)
  if (trim(form.value.name)) f.name = trim(form.value.name)
  if (trim(form.value.introduction)) f.introduction = trim(form.value.introduction)
  if (trim(form.value.category)) f.category = trim(form.value.category)
  const tags = trim(form.value.tagsText).split(/[、,，\s]+/).filter(Boolean)
  if (tags.length) f.tags = tags
  if (trim(form.value.picFormat)) f.picFormat = trim(form.value.picFormat)
  if (trim(form.value.picWidth)) f.picWidth = Number(form.value.picWidth)
  if (trim(form.value.picHeight)) f.picHeight = Number(form.value.picHeight)
  if (editRange.value) {
    f.startEditTime = new Date(editRange.value[0]).toISOString()
    f.endEditTime = new Date(editRange.value[1]).toISOString()
  }
  return f
}

function apply() {
  emit('apply', buildFilters())
  visible.value = false
}

function reset() {
  form.value = {
    searchText: '',
    name: '',
    introduction: '',
    category: '',
    tagsText: '',
    picFormat: '',
    picWidth: '',
    picHeight: '',
  }
  editRange.value = null
  emit('reset')
  visible.value = false
}

function runColor() {
  emit('colorSearch', color.value)
  visible.value = false
}
</script>

<template>
  <n-drawer v-model:show="visible" :width="400" placement="right">
    <n-drawer-content :title="spaceName ? `在「${spaceName}」中搜索` : '搜索图片'" closable>
      <div class="tabs">
        <button :class="{ on: tab === 'keyword' }" @click="tab = 'keyword'">关键词 / 条件</button>
        <button :class="{ on: tab === 'color' }" @click="tab = 'color'">按色搜索</button>
      </div>

      <!-- 关键词 / 字段 -->
      <template v-if="tab === 'keyword'">
        <div class="fld">
          <label>关键词</label>
          <n-input v-model:value="form.searchText" placeholder="同时匹配名称与简介" size="small" />
          <div class="tip">只匹配<b>名称和简介</b>，<b>不搜标签与分类</b>。</div>
        </div>

        <div class="row2">
          <div class="fld">
            <label>名称</label>
            <n-input v-model:value="form.name" placeholder="模糊匹配" size="small" />
          </div>
          <div class="fld">
            <label>分类</label>
            <n-input v-model:value="form.category" placeholder="精确匹配，如 海报" size="small" />
          </div>
        </div>

        <div class="fld">
          <label>简介</label>
          <n-input v-model:value="form.introduction" placeholder="模糊匹配" size="small" />
        </div>

        <div class="fld">
          <label>标签</label>
          <n-input v-model:value="form.tagsText" placeholder="多个用顿号或逗号分隔，如 艺术、热门" size="small" />
          <div class="tip">多个标签是<b>同时包含</b>的关系（不是任一命中）。</div>
        </div>

        <div class="row3">
          <div class="fld">
            <label>格式</label>
            <n-input v-model:value="form.picFormat" placeholder="webp" size="small" />
          </div>
          <div class="fld">
            <label>宽度</label>
            <n-input v-model:value="form.picWidth" placeholder="精确值" size="small" />
          </div>
          <div class="fld">
            <label>高度</label>
            <n-input v-model:value="form.picHeight" placeholder="精确值" size="small" />
          </div>
        </div>
        <div class="tip tip--warn">
          宽高是<b>精确等值</b>匹配，不是范围：填 474 只会出现宽度恰好 474px 的图片。
        </div>

        <div class="fld">
          <label>编辑时间范围</label>
          <n-date-picker
            v-model:value="editRange"
            type="datetimerange"
            clearable
            size="small"
            :locale="zhCN"
            :date-locale="dateZhCN"
            style="width: 100%"
          />
          <div class="tip">
            过滤的是<b>最后一次编辑或上传</b>的时间，<b>不是创建时间</b>。
          </div>
        </div>
      </template>

      <!-- 按色搜索 -->
      <template v-else>
        <div v-if="!spaceId" class="notice">
          按色搜索<b>只能在某个空间内部</b>进行，公共图库不支持。
        </div>
        <div v-else-if="!canColorSearch" class="notice">
          按色搜索<b>只对空间创建者本人</b>开放 ——
          空间成员、甚至系统管理员都用不了。你的角色不够，这条搜不了。
        </div>
        <template v-else>
          <div class="fld">
            <label>选择颜色</label>
            <div class="colorrow">
              <input v-model="color" type="color" class="colorinput" />
              <code>{{ color }}</code>
            </div>
            <div class="tip">
              支持 <code>#RRGGBB</code> 与 <code>0xRRGGBB</code> 两种写法，
              只搜这个空间内部的图。
            </div>
          </div>
          <div class="notice notice--soft">
            结果最多 <b>12 张</b>，不支持分页。
          </div>
        </template>
      </template>

      <template #footer>
        <div class="foot">
          <button class="mini" @click="reset">重置</button>
          <div class="grow" />
          <button v-if="tab === 'keyword'" class="primary-btn" @click="apply">
            应用筛选<template v-if="activeCount">（{{ activeCount }} 项）</template>
          </button>
          <button v-else-if="tab === 'color' && spaceId && canColorSearch" class="primary-btn" @click="runColor">
            按颜色搜索
          </button>
        </div>
      </template>
    </n-drawer-content>
  </n-drawer>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.tabs button {
  font-family: var(--font);
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.tabs button.on {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--text-primary);
}
.fld {
  margin-bottom: 12px;
}
.fld label {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 5px;
}
.row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.row3 {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 10px;
}
.tip {
  margin-top: 5px;
  font-size: 11px;
  line-height: 1.7;
  color: var(--text-tertiary);
}
.tip--warn {
  padding: 7px 10px;
  border-radius: var(--r-sm);
  background: rgba(255, 184, 107, 0.1);
  border: 1px solid rgba(255, 184, 107, 0.3);
  color: var(--accent-warm);
}
.notice {
  padding: 10px 12px;
  border-radius: var(--r-sm);
  font-size: 11.5px;
  line-height: 1.8;
  background: rgba(240, 101, 95, 0.1);
  border: 1px solid rgba(240, 101, 95, 0.3);
  color: var(--danger);
  margin-bottom: 12px;
}
.notice--soft {
  background: var(--bg-surface);
  border-color: var(--border);
  color: var(--text-secondary);
}
.colorrow {
  display: flex;
  align-items: center;
  gap: 10px;
}
.colorinput {
  width: 52px;
  height: 34px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: transparent;
  cursor: pointer;
}
.colorrow code {
  font-size: 12px;
  color: var(--text-secondary);
}
.foot {
  display: flex;
  align-items: center;
  gap: 10px;
}
.grow {
  flex: 1;
}
.foot .mini,
.foot .primary-btn {
  font-family: var(--font);
  font-size: 12.5px;
  padding: 7px 14px;
  border-radius: 8px;
  cursor: pointer;
}
.foot .mini {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
}
.foot .primary-btn {
  border: 1px solid var(--accent);
  background: var(--accent);
  color: #fff;
}
</style>

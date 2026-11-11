<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NInput, NSelect, useMessage, type SelectOption } from 'naive-ui'
import {
  listPictureVoByPageUsingPost,
  searchPictureByColorUsingPost,
} from '@/api/pictureController'
import PageBar from '@/components/ui/PageBar.vue'
import PictureCard from '@/components/gallery/PictureCard.vue'
import { useMySpaces } from '@/composables/useMySpaces'
import { useLoginUserStore } from '@/stores/useLoginUserStore'

const message = useMessage()
const router = useRouter()
const loginUserStore = useLoginUserStore()
const { spaces, load: loadSpaces } = useMySpaces()

const tab = ref<'keyword' | 'color'>('keyword')

/** 排序/分页都用后端支持的字段 */
const PAGE_SIZE = 20

/* ============================================================
   Tab 1 · 关键词搜索
   后端：searchText 会拼成 (name like %x% or introduction like %x%)，
   所以它搜的是**名称与简介**，不搜标签/分类。
   ============================================================ */
const keyword = ref('')
const scope = ref<string>('') // '' = 公共图库
const kwRows = ref<API.PictureVO[]>([])
const kwTotal = ref(0)
const kwCurrent = ref(1)
const kwLoading = ref(false)
const kwSearched = ref(false)

const scopeOptions = computed<SelectOption[]>(() => [
  { label: '公共图库（所有人可见）', value: '' },
  ...spaces.value.map((s) => ({ label: `${s.name}${s.isTeam ? '（团队）' : ''}`, value: s.id })),
])

async function searchKeyword(page = kwCurrent.value) {
  const text = keyword.value.trim()
  if (!text) {
    message.warning('请输入关键词')
    return
  }
  kwLoading.value = true
  try {
    const res = await listPictureVoByPageUsingPost({
      current: page,
      pageSize: PAGE_SIZE,
      sortField: 'createTime',
      sortOrder: 'descend',
      searchText: text,
      // 不传 spaceId 时后端强制「spaceId IS NULL + 只看已过审」
      ...(scope.value ? { spaceId: scope.value as unknown as number } : {}),
    })
    kwRows.value = res.data?.records ?? []
    kwTotal.value = Number(res.data?.total ?? 0)
    kwCurrent.value = page
    kwSearched.value = true
  } catch (e) {
    message.error((e as Error).message || '搜索失败')
  } finally {
    kwLoading.value = false
  }
}

/* ============================================================
   Tab 3 · 按色搜索
   后端限制（都已前移到 UI）：
     · spaceId 必填 —— 只能搜某个空间内部的图，公共图库搜不了
     · 必须是该空间的**创建者本人**（成员/管理员都不行）
     · 最多返回 12 张，无分页
     · picColor 需能被 Color.decode 解析（#RRGGBB 或 0xRRGGBB）
   ============================================================ */
const color = ref('#5563e0')
const colorSpace = ref<string>('')
const colorRows = ref<API.PictureVO[]>([])
const colorLoading = ref(false)
const colorSearched = ref(false)

/** 按色搜索只有「我创建的空间」可用 */
const myOwnSpaces = computed(() => spaces.value.filter((s) => s.isMine))
const colorSpaceOptions = computed<SelectOption[]>(() =>
  myOwnSpaces.value.map((s) => ({ label: `${s.name}${s.isTeam ? '（团队）' : ''}`, value: s.id })),
)

async function runColorSearch() {
  if (!colorSpace.value) {
    message.warning('按色搜索必须选择一个你创建的空间')
    return
  }
  colorLoading.value = true
  colorRows.value = []
  colorSearched.value = false
  try {
    const res = await searchPictureByColorUsingPost({
      spaceId: colorSpace.value as unknown as number,
      // Color.decode 同时接受 #RRGGBB 与 0xRRGGBB，这里直接用取色器给的 # 形式
      picColor: color.value,
    })
    colorRows.value = res.data ?? []
    colorSearched.value = true
  } catch (e) {
    message.error((e as Error).message || '搜索失败')
  } finally {
    colorLoading.value = false
  }
}

/* ---------- 打开大图：按结果所属范围跳到对应的 Lightbox 子路由 ---------- */
function openResult(p: API.PictureVO, fallbackSpaceId?: string) {
  if (!p.id) return
  const pictureId = String(p.id)
  const sid = p.spaceId ? String(p.spaceId) : fallbackSpaceId || ''
  if (sid) router.push({ name: 'spacePicture', params: { spaceId: sid, pictureId } })
  else router.push({ name: 'picture', params: { pictureId } })
}

onMounted(async () => {
  if (!loginUserStore.fetched) await loginUserStore.fetchLoginUser()
  await loadSpaces(loginUserStore.loginUser?.id)
})
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <h2>搜索中心</h2>
      <div class="toolbar__right">
        <span class="scope-note" title="这里有完整的分页结果；单个空间内的快速筛选请进入空间后使用筛选抽屉">
          跨范围搜索 · 单个空间内筛选在画廊里
        </span>
      </div>
    </div>

    <div class="tabs">
      <button :class="{ on: tab === 'keyword' }" @click="tab = 'keyword'">关键词</button>
      <button :class="{ on: tab === 'color' }" @click="tab = 'color'">按色搜索</button>
    </div>

    <!-- ========== 关键词 ========== -->
    <section v-if="tab === 'keyword'" class="panel">
      <div class="bar">
        <div class="fld">
          <n-input
            v-model:value="keyword"
            size="small"
            placeholder="输入关键词，匹配图片名称与简介"
            @keyup.enter="searchKeyword(1)"
          />
        </div>
        <div class="fld fld--sm">
          <n-select v-model:value="scope" :options="scopeOptions" size="small" />
        </div>
        <button class="primary-btn" :disabled="kwLoading" @click="searchKeyword(1)">
          {{ kwLoading ? '搜索中…' : '搜索' }}
        </button>
      </div>
      <div class="hint">关键词会同时模糊匹配<b>名称</b>与<b>简介</b>，不搜标签与分类。</div>

      <template v-if="kwSearched">
        <div class="res-head">
          共 <b>{{ kwTotal }}</b> 个结果
          <span v-if="scope">· 范围：{{ spaces.find((s) => s.id === scope)?.name }}</span>
          <span v-else>· 范围：公共图库</span>
        </div>
        <div v-if="kwRows.length" class="grid">
          <PictureCard
            v-for="p in kwRows"
            :key="p.id"
            :picture="p"
            fit="cover"
            @open="openResult(p)"
          />
        </div>
        <div v-else class="empty">没有匹配的图片</div>
        <PageBar
          :current="kwCurrent"
          :total="kwTotal"
          :page-size="PAGE_SIZE"
          :disabled="kwLoading"
          @change="searchKeyword"
        />
      </template>
      <div v-else class="empty">输入关键词开始搜索</div>
    </section>

    <!-- ========== 按色搜索 ========== -->
    <section v-else class="panel">
      <div class="hint">
        按色搜索的规则：
        ① <b>必须指定空间</b>，只能搜某个空间内部的图，<b>公共图库的图搜不了</b>；
        ② 只有该空间的<b>创建者本人</b>能搜（成员或系统管理员都不行）；
        ③ 最多返回 <b>12 张</b>，按颜色相似度排序，无主色调的排在最后。
      </div>

      <div class="bar">
        <div class="fld">
          <label>空间<span class="opt">必选，且只能选你创建的空间</span></label>
          <n-select
            v-model:value="colorSpace"
            :options="colorSpaceOptions"
            size="small"
            placeholder="选择空间"
          />
        </div>
        <div class="fld fld--color">
          <label>目标颜色</label>
          <div class="colorrow">
            <input v-model="color" type="color" class="colorinput" />
            <code>{{ color }}</code>
          </div>
        </div>
        <button class="primary-btn" :disabled="colorLoading" @click="runColorSearch">
          {{ colorLoading ? '搜索中…' : '搜索' }}
        </button>
      </div>

      <div v-if="!myOwnSpaces.length" class="empty">你还没有创建任何空间，无法使用按色搜索</div>

      <template v-else-if="colorSearched">
        <div class="res-head">找到 <b>{{ colorRows.length }}</b> 张（上限 12）</div>
        <div v-if="colorRows.length" class="grid">
          <PictureCard
            v-for="p in colorRows"
            :key="p.id"
            :picture="p"
            fit="cover"
            @open="openResult(p, colorSpace)"
          />
        </div>
        <div v-else class="empty">该空间里没有带主色调的图片</div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  margin-bottom: 14px;
}
.toolbar h2 {
  margin: 0;
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.toolbar__right {
  margin-left: auto;
}
.scope-note {
  font-size: 11.5px;
  color: var(--text-tertiary);
  cursor: help;
}
.tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 14px;
}
.tabs button {
  height: 34px;
  padding: 0 16px;
  border-radius: 9px;
  border: 1px solid var(--border);
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-family: var(--font);
  font-size: 13px;
  cursor: pointer;
}
.tabs button.on {
  background: var(--accent-soft);
  border-color: transparent;
  color: var(--accent);
  font-weight: 500;
}
.panel {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 16px 18px 18px;
}
.bar {
  display: flex;
  align-items: flex-end;
  gap: 12px;
}
.fld {
  flex: 1;
  min-width: 0;
}
.fld--sm {
  flex: 0 0 230px;
}
.fld--color {
  flex: 0 0 200px;
}
.fld label {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 6px;
}
.fld .opt {
  color: var(--text-tertiary);
  margin-left: 5px;
  font-size: 11px;
}
.colorrow {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-base);
}
.colorinput {
  width: 30px;
  height: 22px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.colorrow code {
  font-size: 12px;
  color: var(--text-secondary);
}
.primary-btn {
  height: 34px;
  padding: 0 18px;
  border-radius: 9px;
  border: 0;
  background: var(--accent);
  color: #fff;
  font-family: var(--font);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}
.primary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.hint {
  margin-top: 12px;
  font-size: 11.5px;
  line-height: 1.8;
  color: var(--text-tertiary);
}
.hint b {
  color: var(--text-secondary);
}
.res-head {
  margin-top: 16px;
  font-size: 12.5px;
  color: var(--text-secondary);
}
.res-head b {
  color: var(--accent);
}
.grid {
  margin-top: 12px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}
.empty {
  margin-top: 16px;
  padding: 28px;
  text-align: center;
  font-size: 13px;
  color: var(--text-tertiary);
  border: 1px dashed var(--border-strong);
  border-radius: var(--r-md);
}
</style>

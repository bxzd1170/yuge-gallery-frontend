<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  NButton,
  NDynamicTags,
  NInput,
  NModal,
  NSelect,
  useMessage,
  type SelectOption,
} from 'naive-ui'
import { editPictureUsingPost, listPictureTagCategoryUsingGet } from '@/api/pictureController'
import { useLoginUserStore } from '@/stores/useLoginUserStore'
import { isAdmin as isAdminUser } from '@/auth/permissions'

const props = defineProps<{
  show: boolean
  picture: API.PictureVO | null
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'saved'): void
}>()

const message = useMessage()
const loginUserStore = useLoginUserStore()
const isAdmin = computed(() => isAdminUser(loginUserStore.loginUser))

/**
 * 长度上限取「数据库列定义」而不是后端校验值 ——
 * 后端 validPicture 只校验了 introduction ≤ 800，
 * 但 picture 表里 introduction 是 varchar(512)、name 是 varchar(128)、category 是 varchar(64)，
 * 超出会直接撞数据库报错（后端不会兜住）。所以前端按更严的那个来拦。
 */
const LIMITS = { name: 128, introduction: 512, category: 64 }

/** 字符数按码点算，更接近 MySQL 的“字符”语义 */
const charLen = (s: string) => [...(s ?? '')].length

const form = ref({ name: '', introduction: '', category: '', tags: [] as string[] })
const submitting = ref(false)

/** 分类与标签的建议值来自后端 /picture/tag_category（后端写死的词表） */
const categoryOptions = ref<SelectOption[]>([])
const tagSuggestions = ref<string[]>([])
const optionsLoaded = ref(false)

async function loadOptions() {
  if (optionsLoaded.value) return
  try {
    const res = await listPictureTagCategoryUsingGet()
    categoryOptions.value = (res.data?.categoryList ?? []).map((c) => ({ label: c, value: c }))
    tagSuggestions.value = res.data?.tagList ?? []
    optionsLoaded.value = true
  } catch {
    // 词表拉不到不影响编辑，退化为纯手输
  }
}

watch(
  () => props.show,
  (v) => {
    if (!v) return
    loadOptions()
    const p = props.picture
    form.value = {
      name: p?.name ?? '',
      introduction: p?.introduction ?? '',
      category: p?.category ?? '',
      // VO 里 tags 是数组（实体里才是 JSON 字符串）
      tags: Array.isArray(p?.tags) ? [...(p!.tags as string[])] : [],
    }
  },
)

const nameLen = computed(() => charLen(form.value.name))
const introLen = computed(() => charLen(form.value.introduction))
const catLen = computed(() => charLen(form.value.category))

const nameError = computed(() =>
  nameLen.value === 0
    ? '名称不能为空（数据库为 NOT NULL）'
    : nameLen.value > LIMITS.name
      ? `名称最多 ${LIMITS.name} 字，当前 ${nameLen.value}`
      : '',
)
const introError = computed(() =>
  introLen.value > LIMITS.introduction
    ? `简介最多 ${LIMITS.introduction} 字（数据库列长度），当前 ${introLen.value}`
    : '',
)
const catError = computed(() =>
  catLen.value > LIMITS.category ? `分类最多 ${LIMITS.category} 字` : '',
)

const canSubmit = computed(
  () => !nameError.value && !introError.value && !catError.value && !submitting.value,
)

async function submit() {
  const p = props.picture
  if (!p?.id || !canSubmit.value) return
  submitting.value = true
  try {
    await editPictureUsingPost({
      // 雪花 ID 必须按字符串传，number 会丢精度
      id: String(p.id) as unknown as number,
      name: form.value.name.trim(),
      introduction: form.value.introduction.trim() || undefined,
      category: form.value.category.trim() || undefined,
      // 始终传数组：后端用 JSONUtil.toJsonStr 转成字符串入库，
      // 传 undefined 会存成 "null" 这种脏值
      tags: form.value.tags,
    })
    message.success(isAdmin.value ? '已保存' : '已保存，等待管理员审核')
    emit('saved')
    emit('update:show', false)
  } catch (e) {
    message.error((e as Error).message || '保存失败')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    title="编辑图片信息"
    class="edit-modal"
    :bordered="false"
    :mask-closable="!submitting"
    @update:show="emit('update:show', $event)"
  >
    <div class="fld">
      <label>
        名称
        <span class="cnt" :class="{ bad: !!nameError }">{{ nameLen }} / {{ LIMITS.name }}</span>
      </label>
      <n-input v-model:value="form.name" size="small" placeholder="图片名称" />
      <div v-if="nameError" class="err">{{ nameError }}</div>
    </div>

    <div class="fld">
      <label>
        简介
        <span class="cnt" :class="{ bad: !!introError }">{{ introLen }} / {{ LIMITS.introduction }}</span>
      </label>
      <n-input
        v-model:value="form.introduction"
        type="textarea"
        size="small"
        :autosize="{ minRows: 3, maxRows: 5 }"
        placeholder="选填"
      />
      <div v-if="introError" class="err">{{ introError }}</div>
    </div>

    <div class="fld">
      <label>分类</label>
      <n-select
        v-model:value="form.category"
        :options="categoryOptions"
        size="small"
        filterable
        tag
        clearable
        placeholder="可从建议中选择，也可直接输入新分类"
      />
      <div v-if="catError" class="err">{{ catError }}</div>
    </div>

    <div class="fld">
      <label>
        标签
        <span class="cnt">{{ form.tags.length }} 个</span>
      </label>
      <n-dynamic-tags v-model:value="form.tags" size="small" />
      <div v-if="tagSuggestions.length" class="sug">
        常用：
        <button
          v-for="t in tagSuggestions"
          :key="t"
          class="sug__b"
          :class="{ on: form.tags.includes(t) }"
          @click="form.tags.includes(t) ? (form.tags = form.tags.filter((x) => x !== t)) : form.tags.push(t)"
        >
          {{ t }}
        </button>
      </div>
    </div>

    <!-- 普通用户编辑会被重新置为待审核，图片将从画廊暂时消失 -->
    <div v-if="!isAdmin" class="notice">
      提交后该图片会重新进入<b>待审核</b>状态，审核通过前不会显示在画廊列表中。
    </div>

    <template #footer>
      <div class="foot">
        <n-button size="small" :disabled="submitting" @click="emit('update:show', false)">取消</n-button>
        <n-button size="small" type="primary" :disabled="!canSubmit" @click="submit">
          {{ submitting ? '保存中…' : '保存' }}
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.fld {
  margin-bottom: 16px;
}
.fld label {
  display: flex;
  align-items: center;
  font-size: 12.5px;
  color: var(--text-secondary);
  margin-bottom: 6px;
}
.cnt {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-tertiary);
}
.cnt.bad {
  color: var(--danger);
}
.err {
  margin-top: 5px;
  font-size: 11.5px;
  color: var(--danger);
}
.sug {
  margin-top: 8px;
  font-size: 11.5px;
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.sug__b {
  font-family: var(--font);
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 99px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.sug__b.on {
  background: var(--accent-soft);
  border-color: transparent;
  color: var(--accent);
}
.notice {
  padding: 9px 11px;
  border-radius: var(--r-sm);
  font-size: 12px;
  line-height: 1.7;
  background: rgba(255, 184, 107, 0.12);
  border: 1px solid rgba(255, 184, 107, 0.32);
  color: var(--text-primary);
}
.foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>

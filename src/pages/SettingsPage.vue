<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NInput, useMessage } from 'naive-ui'
import { exchangeVipUsingPost, getUserVoByIdUsingGet, updateUserUsingPost } from '@/api/userController'
import { uploadPictureUsingPost } from '@/api/pictureController'
import { useLoginUserStore } from '@/stores/useLoginUserStore'
import { canEditOwnProfile, isAdmin as isAdminUser } from '@/auth/permissions'
import { charLen, formatTime } from '@/utils/format'

const message = useMessage()
const loginUserStore = useLoginUserStore()

const me = computed(() => loginUserStore.loginUser)
const isAdmin = computed(() => isAdminUser(me.value))
/** 本人即可编辑自己的资料（角色不在这里改，也不由前端提交） */
const canEdit = computed(() => canEditOwnProfile(me.value))

/*
  登录态用的是 LoginUserVO，它**不含会员字段**（没有 vipExpireTime / vipNumber），
  所以会员信息必须另外通过 /user/get/vo 取 UserVO（那个才有）。
  这也是一处「不能凭想象用登录态里的字段」的例子。
*/
const vipInfo = ref<API.UserVO | null>(null)

async function loadVipInfo() {
  if (!me.value?.id) return
  try {
    const res = await getUserVoByIdUsingGet({ id: String(me.value.id) as unknown as number })
    vipInfo.value = res.data ?? null
  } catch {
    vipInfo.value = null
  }
}

/** 会员：靠 vipExpireTime 判断，不是靠角色 */
const isVip = computed(() => {
  const t = vipInfo.value?.vipExpireTime
  if (!t) return false
  return new Date(t).getTime() > Date.now()
})

const roleText = computed(() =>
  me.value?.userRole === 'admin' ? '管理员' : me.value?.userRole === 'vip' ? '会员' : '普通用户',
)

/* ---------- 修改资料 ---------- */
// 注意：这里**不暴露 userRole** —— 改角色属于用户管理的职责（管理台 → 用户管理）
const form = ref({ userName: '', userAvatar: '', userProfile: '' })
const saving = ref(false)

const nameLen = computed(() => charLen(form.value.userName))
const nameError = computed(() =>
  nameLen.value === 0 ? '昵称不能为空' : nameLen.value > 32 ? '昵称最多 32 字' : '',
)

function resetForm() {
  form.value = {
    userName: me.value?.userName ?? '',
    userAvatar: me.value?.userAvatar ?? '',
    userProfile: me.value?.userProfile ?? '',
  }
}

async function save() {
  if (!canEdit.value || nameError.value || !me.value?.id) return
  saving.value = true
  try {
    await updateUserUsingPost({
      id: String(me.value.id) as unknown as number,
      userName: form.value.userName.trim(),
      userAvatar: form.value.userAvatar.trim() || undefined,
      userProfile: form.value.userProfile.trim() || undefined,
    })
    await loginUserStore.fetchLoginUser()
    resetForm()
    message.success('已保存')
  } catch (e) {
    message.error((e as Error).message || '保存失败')
  } finally {
    saving.value = false
  }
}

/* ---------- 上传头像 ---------- */
/*
  没有专门的头像上传接口，复用图片上传（公共存储）：
  上传成功拿到 URL 回填表单，点「保存资料」才真正生效。
  管理员上传自动过审（图片会出现在公共图库）；普通用户本就改不了资料，看不到这个入口。
*/
const MAX_AVATAR_MB = 2
const AVATAR_TYPES = ['jpg', 'jpeg', 'png', 'webp']
const avatarInput = ref<HTMLInputElement | null>(null)
const uploadingAvatar = ref(false)

function pickAvatar() {
  avatarInput.value?.click()
}

async function onAvatarChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 允许连续选同一个文件
  if (!file) return

  const ext = (file.name.split('.').pop() || '').toLowerCase()
  if (!AVATAR_TYPES.includes(ext)) {
    message.error(`不支持该格式，仅限 ${AVATAR_TYPES.join(' / ')}`)
    return
  }
  if (file.size > MAX_AVATAR_MB * 1024 * 1024) {
    message.error(`图片不能超过 ${MAX_AVATAR_MB}MB`)
    return
  }

  uploadingAvatar.value = true
  try {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')
    const res = await uploadPictureUsingPost(
      {},
      { picName: `头像-${me.value?.userAccount || 'user'}-${stamp}` } as Record<string, unknown>,
      file,
    )
    const url = res.data?.url
    if (!url) throw new Error('上传结果里没有图片地址')
    form.value.userAvatar = url
    message.success('头像已上传，点击「保存资料」后生效')
  } catch (err) {
    message.error((err as Error).message || '上传失败')
  } finally {
    uploadingAvatar.value = false
  }
}

/* ---------- 兑换会员 ---------- */
const vipCode = ref('')
const exchanging = ref(false)

async function exchange() {
  const code = vipCode.value.trim()
  if (!code) {
    message.warning('请输入兑换码')
    return
  }
  exchanging.value = true
  try {
    await exchangeVipUsingPost({ vipCode: code })
    await loginUserStore.fetchLoginUser()
    await loadVipInfo()
    vipCode.value = ''
    message.success('兑换成功，有效期 1 年')
  } catch (e) {
    message.error((e as Error).message || '兑换失败')
  } finally {
    exchanging.value = false
  }
}

onMounted(async () => {
  if (!loginUserStore.fetched) await loginUserStore.fetchLoginUser()
  resetForm()
  await loadVipInfo()
})
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <h2>个人设置</h2>
    </div>

    <!-- 资料 -->
    <section class="cardx">
      <div class="cardx__h">账号资料</div>

      <div class="who">
        <img v-if="me?.userAvatar" class="who__av" :src="me.userAvatar" alt="" referrerpolicy="no-referrer" />
        <span v-else class="who__av who__av--ph">{{ (me?.userName || me?.userAccount || '?').slice(0, 1) }}</span>
        <div class="who__txt">
          <div class="who__n">
            {{ me?.userName || '未命名' }}
            <span class="role" :class="isAdmin ? 'role--admin' : isVip ? 'role--vip' : ''">{{ roleText }}</span>
            <span v-if="isVip" class="role role--vip">会员至 {{ formatTime(vipInfo?.vipExpireTime) }}</span>
          </div>
          <div class="who__s">账号 {{ me?.userAccount }}　ID {{ me?.id }}</div>
        </div>
      </div>

      <div v-if="canEdit" class="form">
        <div class="f">
          <label>
            昵称
            <span class="cnt" :class="{ bad: !!nameError }">{{ nameLen }} / 32</span>
          </label>
          <n-input v-model:value="form.userName" size="small" placeholder="昵称" />
          <div v-if="nameError" class="err">{{ nameError }}</div>
        </div>
        <div class="f">
          <label>头像</label>
          <div class="avrow">
            <img
              v-if="form.userAvatar"
              class="avprev"
              :src="form.userAvatar"
              alt=""
              referrerpolicy="no-referrer"
            />
            <span v-else class="avprev avprev--ph"></span>
            <n-input v-model:value="form.userAvatar" size="small" placeholder="图片 URL，选填" />
            <button class="ghost-btn" type="button" :disabled="uploadingAvatar" @click="pickAvatar">
              {{ uploadingAvatar ? '上传中…' : '上传头像' }}
            </button>
          </div>
          <input
            ref="avatarInput"
            type="file"
            accept="image/jpeg,image/png,image/jpg,image/webp"
            hidden
            @change="onAvatarChange"
          />
          <div class="hint-s">支持 JPG / PNG / WebP，不超过 2MB；上传后需点「保存资料」才生效。</div>
        </div>
        <div class="f">
          <label>个人简介</label>
          <n-input
            v-model:value="form.userProfile"
            type="textarea"
            size="small"
            :autosize="{ minRows: 2, maxRows: 4 }"
            placeholder="选填"
          />
        </div>
        <div class="acts">
          <button class="primary-btn" :disabled="saving || !!nameError" @click="save">
            {{ saving ? '保存中…' : '保存资料' }}
          </button>
          <button class="ghost-btn" :disabled="saving" @click="resetForm">重置</button>
        </div>
      </div>
    </section>

    <!-- 会员 -->
    <section class="cardx">
      <div class="cardx__h">会员兑换</div>

      <div class="vip">
        <div class="vip__state">
          <template v-if="isVip">
            当前状态：<b class="ok">会员有效</b>，到期时间 {{ formatTime(vipInfo?.vipExpireTime) }}
          </template>
          <template v-else>当前状态：<b>非会员</b>（未兑换或已过期）</template>
        </div>

        <div class="vip__row">
          <n-input
            v-model:value="vipCode"
            size="small"
            placeholder="输入兑换码，例如 A7b9C2dE"
            @keyup.enter="exchange"
          />
          <button class="primary-btn" :disabled="exchanging" @click="exchange">
            {{ exchanging ? '兑换中…' : '兑换' }}
          </button>
        </div>

        <div class="hint">
          兑换成功后有效期为 <b>1 年</b>，兑换码一次性使用，用过即失效。
        </div>

        <!--
          这里必须提醒：后端把「会员」和「角色」压在同一个 userRole 字段上，
          兑换时会把角色写成 vip。已修掉「管理员兑换后丢管理员身份」的问题，
          但两者共用一个字段这件事本身仍然别扭 —— 如实写出来。
        -->
        <div class="warn">
          <b>关于会员与身份：</b>本站的「会员」和「管理员」属于同一个身份维度，两者互斥 ——
          普通用户兑换后成为会员；<b>管理员兑换后仍保留管理员身份</b>，不会丢掉管理权限。
          如果你兑换后发现自己失去了管理入口，请联系管理员处理。
        </div>
      </div>
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
.cardx {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 16px 18px 18px;
  margin-bottom: 14px;
  max-width: 720px;
}
.cardx__h {
  font-size: 13.5px;
  font-weight: 600;
  margin-bottom: 14px;
}
.who {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 16px;
}
.who__av {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  object-fit: cover;
  flex: 0 0 52px;
  border: 1px solid var(--border);
}
.who__av--ph {
  display: grid;
  place-items: center;
  background: linear-gradient(140deg, #6c7bff, #35d0ba);
  color: #fff;
  font-size: 20px;
}
.who__n {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
}
.who__s {
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--text-tertiary);
}
.role {
  font-size: 10.5px;
  padding: 2px 8px;
  border-radius: 99px;
  border: 1px solid var(--border-strong);
  color: var(--text-secondary);
  font-weight: 400;
}
.role--admin {
  background: var(--accent-soft);
  border-color: transparent;
  color: var(--accent);
}
.role--vip {
  background: rgba(255, 184, 107, 0.16);
  border-color: transparent;
  color: var(--accent-warm);
}
.form .f {
  margin-bottom: 14px;
}
.form label {
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
.avrow {
  display: flex;
  align-items: center;
  gap: 10px;
}
.avprev {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  object-fit: cover;
  flex: 0 0 44px;
  border: 1px solid var(--border);
}
.avprev--ph {
  display: inline-block;
  background: repeating-conic-gradient(var(--border) 0 25%, transparent 0 50%) 0 0 / 12px 12px;
}
.hint-s {
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-tertiary);
}
.acts {
  display: flex;
  align-items: center;
  gap: 10px;
}
.vip__state {
  font-size: 12.5px;
  color: var(--text-secondary);
  margin-bottom: 12px;
}
.vip__state b {
  color: var(--text-primary);
}
.vip__state b.ok {
  color: var(--success);
}
.vip__row {
  display: flex;
  gap: 10px;
  max-width: 520px;
}
.hint {
  margin-top: 10px;
  font-size: 11.5px;
  line-height: 1.8;
  color: var(--text-tertiary);
}
.warn {
  margin-top: 14px;
  padding: 11px 13px;
  border-radius: var(--r-sm);
  background: rgba(255, 184, 107, 0.12);
  border: 1px solid rgba(255, 184, 107, 0.32);
  font-size: 11.5px;
  line-height: 1.85;
  color: var(--text-secondary);
}
.warn b {
  color: var(--text-primary);
}
.warn code {
  background: rgba(255, 255, 255, 0.1);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 11px;
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
.ghost-btn {
  height: 34px;
  padding: 0 16px;
  border-radius: 9px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-primary);
  font-family: var(--font);
  font-size: 12.5px;
  cursor: pointer;
  white-space: nowrap;
  flex: 0 0 auto;
}
</style>

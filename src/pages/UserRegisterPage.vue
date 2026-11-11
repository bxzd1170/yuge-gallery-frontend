<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { NButton, NInput, useMessage } from 'naive-ui'
import { userRegisterUsingPost } from '@/api/userController'
import { useTheme } from '@/theme/useTheme'

const router = useRouter()
const message = useMessage()
const { resolved, toggle } = useTheme()

const form = ref({ userAccount: '', userPassword: '', checkPassword: '' })
const loading = ref(false)

async function onSubmit() {
  // 幂等保护：表单 submit 与点击可能同时到达，loading 期间直接忽略后续调用
  if (loading.value) return
  const { userAccount, userPassword, checkPassword } = form.value
  if (!userAccount || !userPassword || !checkPassword) {
    message.warning('请填写完整的注册信息')
    return
  }
  if (userAccount.length < 4) {
    message.warning('账号长度不能少于 4 位')
    return
  }
  if (userPassword.length < 8) {
    message.warning('密码长度不能少于 8 位')
    return
  }
  if (userPassword !== checkPassword) {
    message.warning('两次输入的密码不一致')
    return
  }

  loading.value = true
  try {
    const res = await userRegisterUsingPost({ userAccount, userPassword, checkPassword })
    if (res.code === 0) {
      message.success('注册成功，请登录')
      router.replace('/login')
    } else {
      message.error(res.message || '注册失败')
    }
  } catch (e) {
    message.error((e as Error).message || '注册失败')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth">
    <button class="auth__theme" :title="resolved === 'dark' ? '切换到浅色' : '切换到深色'" @click="toggle">
      <svg v-if="resolved === 'dark'" viewBox="0 0 24 24">
        <path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" />
      </svg>
      <svg v-else viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
      </svg>
    </button>

    <div class="auth__card">
      <div class="auth__brand">
        <div class="auth__logo"><img src="/logo.png" alt="宇阁云图库" /></div>
        <div>
          <h1 class="auth__title">创建账号</h1>
          <p class="auth__sub">加入宇阁云图库</p>
        </div>
      </div>

      <form class="auth__form" @submit.prevent="onSubmit">
        <div class="field">
          <label for="account">账号</label>
          <n-input
            id="account"
            v-model:value="form.userAccount"
            placeholder="至少 4 位，登录时使用"
            size="large"
            :input-props="{ autocomplete: 'username' }"
          />
        </div>
        <div class="field">
          <label for="password">密码</label>
          <n-input
            id="password"
            v-model:value="form.userPassword"
            type="password"
            show-password-on="click"
            placeholder="至少 8 位"
            size="large"
            :input-props="{ autocomplete: 'new-password' }"
          />
        </div>
        <div class="field">
          <label for="checkPassword">确认密码</label>
          <n-input
            id="checkPassword"
            v-model:value="form.checkPassword"
            type="password"
            show-password-on="click"
            placeholder="再次输入密码"
            size="large"
            :input-props="{ autocomplete: 'new-password' }"
          />
        </div>

        <!--
          只保留一条提交路径：按钮是 type=submit，由表单 @submit 触发。
          之前同时写了 @click，导致一次点击发两次注册请求（第二次撞唯一索引 → 「系统错误」）。
          回车提交由表单原生行为处理，也不需要额外的 @keyup.enter。
        -->
        <n-button type="primary" size="large" block :loading="loading" attr-type="submit">
          注册
        </n-button>
      </form>

      <div class="auth__foot">
        已有账号？<RouterLink to="/login" class="auth__link">返回登录</RouterLink>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth {
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: 40px 20px;
  background: var(--bg-base);
}
.auth__theme {
  position: fixed;
  top: 20px;
  right: 22px;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  display: grid;
  place-items: center;
  cursor: pointer;
}
.auth__theme svg {
  width: 18px;
  height: 18px;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.auth__card {
  width: 380px;
  max-width: 100%;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: 32px 30px 26px;
  box-shadow: var(--shadow-pop);
}
.auth__brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 26px;
}
.auth__logo {
  width: 44px;
  height: 44px;
  border-radius: 13px;
  overflow: hidden;
  flex: 0 0 44px;
  background: #0c3572;
}
.auth__logo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.auth__title {
  margin: 0;
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.auth__sub {
  margin: 3px 0 0;
  font-size: 12.5px;
  color: var(--text-secondary);
}

.auth__form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.field label {
  font-size: 12.5px;
  color: var(--text-secondary);
}

.auth__foot {
  margin-top: 20px;
  text-align: center;
  font-size: 12.5px;
  color: var(--text-secondary);
}
.auth__link {
  color: var(--accent);
  font-weight: 500;
}
.auth__link:hover {
  text-decoration: underline;
}
</style>

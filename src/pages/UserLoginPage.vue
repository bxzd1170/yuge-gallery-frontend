<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { NButton, NInput, useMessage } from 'naive-ui'
import { userLoginUsingPost } from '@/api/userController'
import { clearSpacePermsCache } from '@/composables/useSpacePerms'
import { useLoginUserStore } from '@/stores/useLoginUserStore'
import { useTheme } from '@/theme/useTheme'

const router = useRouter()
const message = useMessage()
const store = useLoginUserStore()
const { resolved, toggle } = useTheme()

const form = ref({ userAccount: '', userPassword: '' })
const loading = ref(false)

async function onSubmit() {
  // 幂等保护：与注册页同因 —— submit 与 click 可能重复触发
  if (loading.value) return
  if (!form.value.userAccount || !form.value.userPassword) {
    message.warning('请输入账号和密码')
    return
  }
  loading.value = true
  try {
    const res = await userLoginUsingPost({
      userAccount: form.value.userAccount,
      userPassword: form.value.userPassword,
    })
    if (res.code === 0 && res.data) {
      // 换账号登录时也要清空间权限缓存（可能没走「退出登录」而是直接在登录页换号）
      clearSpacePermsCache()
      store.setLoginUser(res.data)
      message.success('登录成功')
      const redirect = (router.currentRoute.value.query.redirect as string) || '/'
      router.replace(redirect)
    } else {
      message.error(res.message || '登录失败')
    }
  } catch (e) {
    message.error((e as Error).message || '登录失败')
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
          <h1 class="auth__title">宇阁云图库</h1>
          <p class="auth__sub">多空间视觉资产管理系统</p>
        </div>
      </div>

      <form class="auth__form" @submit.prevent="onSubmit">
        <div class="field">
          <label for="account">账号</label>
          <n-input
            id="account"
            v-model:value="form.userAccount"
            placeholder="请输入账号"
            size="large"
            :input-props="{ autocomplete: 'username' }"
            @keyup.enter="onSubmit"
          />
        </div>
        <div class="field">
          <label for="password">密码</label>
          <n-input
            id="password"
            v-model:value="form.userPassword"
            type="password"
            show-password-on="click"
            placeholder="请输入密码"
            size="large"
            :input-props="{ autocomplete: 'current-password' }"
          />
        </div>

        <!-- 与注册页一致：只走表单 submit 一条路径，避免重复请求 -->
        <n-button type="primary" size="large" block :loading="loading" attr-type="submit">
          登录
        </n-button>
      </form>

      <div class="auth__foot">
        还没有账号？<RouterLink to="/register" class="auth__link">立即注册</RouterLink>
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

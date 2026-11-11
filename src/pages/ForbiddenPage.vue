<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useLoginUserStore } from '@/stores/useLoginUserStore'
import { isAdmin as isAdminUser } from '@/auth/permissions'

const route = useRoute()
const router = useRouter()
const loginUserStore = useLoginUserStore()

const roleText = computed(() => (isAdminUser(loginUserStore.loginUser) ? '管理员' : '普通用户'))
const target = computed(() => (route.query.from ? String(route.query.from) : ''))
</script>

<template>
  <div class="fb">
    <div class="fb__code">403</div>
    <h1 class="fb__t">该页面只对管理员开放</h1>
    <p class="fb__s">
      你当前的身份是<b>{{ roleText }}</b>。管理台（用户 / 图片 / 空间管理）内的数据只对管理员开放，
      即使打开页面也拿不到任何内容，所以入口和路由都直接拦掉了。
    </p>

    <div class="fb__box">
      <div class="fb__h">如果你确实需要这个能力</div>
      <ul class="fb__ul">
        <li>让管理员在<b>用户管理</b>里把你的角色改成管理员，重新登录后即可看到管理台入口</li>
        <li>普通账号本来就能用的：公共图库、我的空间、上传、搜索、自己空间的分析</li>
      </ul>
    </div>

    <div class="fb__acts">
      <button class="primary-btn" @click="router.push('/')">回到公共图库</button>
      <button v-if="target" class="ghost-btn" @click="router.push(target)">返回上一页</button>
    </div>
  </div>
</template>

<style scoped>
.fb {
  max-width: 640px;
  padding: 56px 8px;
}
.fb__code {
  font-size: 56px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.03em;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  margin-bottom: 14px;
}
.fb__t {
  margin: 0 0 12px;
  font-size: 21px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.fb__s {
  margin: 0 0 22px;
  font-size: 13px;
  line-height: 1.9;
  color: var(--text-secondary);
}
.fb__s b {
  color: var(--text-primary);
}
.fb__s code {
  background: var(--accent-soft);
  color: var(--accent);
  padding: 1px 6px;
  border-radius: 5px;
  font-size: 12px;
}
.fb__box {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 14px 16px;
  margin-bottom: 22px;
}
.fb__h {
  font-size: 12.5px;
  font-weight: 600;
  margin-bottom: 8px;
}
.fb__ul {
  margin: 0;
  padding-left: 18px;
  font-size: 12.5px;
  line-height: 1.9;
  color: var(--text-secondary);
}
.fb__ul b {
  color: var(--text-primary);
}
.fb__acts {
  display: flex;
  gap: 10px;
}
.primary-btn {
  height: 36px;
  padding: 0 18px;
  border-radius: 9px;
  border: 0;
  background: var(--accent);
  color: #fff;
  font-family: var(--font);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.ghost-btn {
  height: 36px;
  padding: 0 18px;
  border-radius: 9px;
  border: 1px solid var(--border);
  background: var(--surface, transparent);
  color: var(--text-primary);
  font-family: var(--font);
  font-size: 13px;
  cursor: pointer;
}
</style>

<script setup lang="ts">
/*
  管理台三个页面（图片 / 用户 / 空间）共用的切换条。
  之前只有侧栏一个「管理台」入口指向 /admin/pictures，另外两页只能靠命令面板或手输 URL 进入 ——
  页面和接口都在，缺的是可见入口。
*/
import { useRoute } from 'vue-router'

const route = useRoute()

const tabs = [
  { label: '图片管理', to: '/admin/pictures' },
  { label: '用户管理', to: '/admin/users' },
  { label: '空间管理', to: '/admin/spaces' },
]

const isActive = (to: string) => route.path === to
</script>

<template>
  <nav class="anav">
    <RouterLink
      v-for="t in tabs"
      :key="t.to"
      :to="t.to"
      class="anav__i"
      :class="{ 'is-on': isActive(t.to) }"
    >
      {{ t.label }}
    </RouterLink>
  </nav>
</template>

<style scoped>
.anav {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  margin-bottom: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-surface);
}
.anav__i {
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 12.5px;
  color: var(--text-secondary);
  text-decoration: none;
  white-space: nowrap;
  transition: background 0.15s ease, color 0.15s ease;
}
.anav__i:hover {
  color: var(--text-primary);
  background: var(--bg-base);
}
.anav__i.is-on {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 500;
}
</style>

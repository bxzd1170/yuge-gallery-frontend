<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const title = computed(() => (route.meta.title as string) || '页面')
const subtitle = computed(() => (route.meta.subtitle as string) || '')
</script>

<template>
  <div class="ph">
    <div class="ph__tag">第 1 期 · 骨架</div>
    <h1 class="ph__t">{{ title }}</h1>
    <p v-if="subtitle" class="ph__s">{{ subtitle }}</p>
    <p class="ph__note">布局与路由已就绪，该页面将在后续期次实现。</p>
  </div>
</template>

<style scoped>
.ph {
  padding: 72px 20px;
  text-align: center;
}
.ph__tag {
  display: inline-block;
  font-size: 11px;
  color: var(--accent);
  background: var(--accent-soft);
  padding: 4px 10px;
  border-radius: 99px;
  margin-bottom: 16px;
}
.ph__t {
  margin: 0 0 8px;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.ph__s {
  margin: 0 0 6px;
  font-size: 13px;
  color: var(--text-secondary);
}
.ph__note {
  margin: 18px 0 0;
  font-size: 12.5px;
  color: var(--text-tertiary);
}
</style>

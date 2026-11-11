<script setup lang="ts">
import { computed } from 'vue'
import { NConfigProvider, NDialogProvider, NMessageProvider, dateZhCN, zhCN } from 'naive-ui'
import { naiveOverrides, naiveTheme } from '@/theme/naiveTheme'
import { useTheme } from '@/theme/useTheme'

const { resolved } = useTheme()

const theme = computed(() => naiveTheme(resolved.value))
const themeOverrides = computed(() => naiveOverrides(resolved.value))

/*
  全局中文化。
  之前没设 locale，naive-ui 默认是英文 —— 影响的不只是日期选择器的
  「Start Date and Time」，还有 NSelect 空态、NEmpty、分页等所有内置文案。
  在这里设一次，比每个组件单独传 locale 更可靠。
*/
</script>

<template>
  <n-config-provider
    :theme="theme"
    :theme-overrides="themeOverrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
  >
    <n-message-provider>
      <n-dialog-provider>
        <router-view />
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
/*
  分享弹窗 —— 纯前端实现，零后端改动：
  · 分享链接就是图片详情页地址（深链路由 /picture/:id 本身公开），
    别人打开后由既有的详情接口自然取数，所以不需要任何"分享"服务端；
  · 二维码由 qrcode.vue 在客户端把链接当场编码成图案，同样不发请求。
  什么时候才需要后端：短链、分享计数、给无权限的人发临时令牌 —— 目前都不做。
*/
import { NButton, NModal } from 'naive-ui'
import QrcodeVue from 'qrcode.vue'
import { useMessage } from 'naive-ui'

const props = defineProps<{
  show: boolean
  /** 要分享的完整链接（由父组件用 location.origin 拼好） */
  link: string
  title?: string
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
}>()

const message = useMessage()
const close = () => emit('update:show', false)

async function copyLink() {
  const text = props.link
  try {
    await navigator.clipboard.writeText(text)
    message.success('链接已复制')
  } catch {
    // 非安全上下文（http 局域网 IP）下 clipboard API 不可用，退回老办法
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    if (ok) message.success('链接已复制')
    else message.error('复制失败，请手动选中链接复制')
  }
}
</script>

<template>
  <n-modal
    :show="props.show"
    preset="card"
    :title="props.title || '分享图片'"
    :style="{ width: '340px' }"
    :bordered="false"
    :mask-closable="true"
    @update:show="(v: boolean) => emit('update:show', v)"
    @after-leave="close"
  >
    <div class="sh">
      <div class="sh__t">复制分享链接</div>
      <div class="sh__row">
        <span class="sh__link" :title="props.link">{{ props.link }}</span>
        <n-button size="tiny" secondary @click="copyLink">复制</n-button>
      </div>

      <div class="sh__t sh__t--qr">手机扫码查看</div>
      <div class="sh__qrbox">
        <QrcodeVue :value="props.link" :size="148" level="M" :margin="2" render-as="canvas" />
      </div>
      <div class="sh__note">链接打开的是图片详情页，权限按访问者身份正常判断。</div>
    </div>
  </n-modal>
</template>

<style scoped>
.sh {
  display: flex;
  flex-direction: column;
}
.sh__t {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 8px;
}
.sh__t--qr {
  margin-top: 16px;
}
.sh__row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sh__link {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-family: var(--mono, monospace);
  color: var(--accent);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-base);
}
.sh__qrbox {
  align-self: center;
  padding: 10px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid var(--border);
}
.sh__note {
  margin-top: 12px;
  font-size: 11px;
  line-height: 1.7;
  color: var(--text-tertiary);
  text-align: center;
}
</style>

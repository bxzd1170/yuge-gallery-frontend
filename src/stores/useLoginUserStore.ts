import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getLoginUserUsingGet } from '@/api/userController'

/**
 * 登录用户状态
 * 后端通过 Sa-Token + Session 维持登录态（Cookie），前端只需拉取当前用户。
 */
export const useLoginUserStore = defineStore('loginUser', () => {
  const loginUser = ref<API.LoginUserVO>({})
  /** 是否已尝试过拉取登录态（用于路由守卫避免重复请求） */
  const fetched = ref(false)

  function setLoginUser(user: API.LoginUserVO | undefined) {
    loginUser.value = user ?? {}
  }

  async function fetchLoginUser() {
    try {
      const res = await getLoginUserUsingGet()
      if (res.code === 0 && res.data) {
        loginUser.value = res.data
      }
    } catch {
      // 未登录属于正常情况，静默处理
      loginUser.value = {}
    } finally {
      fetched.value = true
    }
  }

  return { loginUser, fetched, setLoginUser, fetchLoginUser }
})

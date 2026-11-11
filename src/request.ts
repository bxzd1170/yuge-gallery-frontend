import axios, { type AxiosError, type AxiosRequestConfig, type AxiosResponse } from 'axios'

/**
 * 统一请求实例
 * - dev 环境走 Vite 代理（/api → http://localhost:8123），因此 baseURL 留空，
 *   路径里已包含后端的 context-path /api
 * - 响应拦截器直接返回响应体，避免调用处反复 .data.data
 */

export interface BusinessError extends Error {
  /** 后端业务码，0 表示成功 */
  code?: number
  /** 是否为未登录 */
  isUnauthorized?: boolean
}

const instance = axios.create({
  baseURL: '',
  timeout: 30000,
  withCredentials: true,
})

instance.interceptors.response.use(
  (response: AxiosResponse) => {
    const body = response.data
    // 后端统一返回 { code, data, message }，code !== 0 视为业务失败
    if (body && typeof body.code === 'number' && body.code !== 0) {
      const err: BusinessError = new Error(body.message || '请求失败')
      err.code = body.code
      err.isUnauthorized = body.code === 40100
      return Promise.reject(err)
    }
    return body
  },
  (error: AxiosError) => {
    const status = error.response?.status
    const err: BusinessError = new Error(
      status === 404 ? '请求的内容不存在' : status ? `请求失败（${status}）` : '网络异常，请检查网络后重试',
    )
    err.code = status
    err.isUnauthorized = status === 401 || status === 403
    return Promise.reject(err)
  },
)

/**
 * 生成器（@umijs/openapi）产出的代码签名是 `request<T>(url, config): Promise<T>`，
 * 而在实际运行时拦截器已经把响应体解包返回，故此处做一次类型对齐。
 */
type Request = <T = unknown>(url: string, config?: AxiosRequestConfig) => Promise<T>

const request = instance as unknown as Request & typeof instance

export default request

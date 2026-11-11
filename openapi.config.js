import { generateService } from '@umijs/openapi'

/**
 * 从后端 Swagger 生成 API 客户端与类型定义
 * 运行前需保证后端已启动（http://localhost:8123）
 *
 * 用法：npm run openapi
 */
generateService({
  requestLibPath: "import request from '@/request'",
  schemaPath: 'http://localhost:8123/api/v2/api-docs',
  serversPath: './src',
})

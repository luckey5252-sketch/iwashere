import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
  test: {
    environment: 'node',
    setupFiles: [],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false, // DB 공유 테스트 — 직렬 실행으로 격리
  },
})

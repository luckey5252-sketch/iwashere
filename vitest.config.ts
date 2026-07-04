import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: [],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false, // DB 공유 테스트 — 직렬 실행으로 격리
  },
})

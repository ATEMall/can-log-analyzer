import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    // v4.0 / B1：测试文件增至 28 个后，按 CPU 核数全量并行 fork worker 会触发
    // 「Zone Allocation failed - process out of memory」。限制并发 fork 数后
    // 全量回归稳定通过（358/358），CI 与本机一致。
    poolOptions: {
      forks: { maxForks: 4, minForks: 1 }
    }
  }
});

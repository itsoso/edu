import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5060',
        changeOrigin: true,
      },
    },
  },
  build: {
    // 提高单 chunk 警告阈值, recharts vendor chunk 合理地会比 500kb 大
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // 只拆真正重型的可选 chunk (charts + markdown), 其他依赖留在 vendor 避免循环引用.
        manualChunks: {
          charts: ['recharts'],
          markdown: ['react-markdown', 'remark-gfm'],
        },
      },
    },
  },
})

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: '/',
  plugins: [vue()],
  root: 'dashboard/web',
  build: {
    outDir: '../../dist/dashboard/spa',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, '/')
          if (!normalized.includes('/node_modules/')) return undefined
          if (
            normalized.includes('/node_modules/vue/') ||
            normalized.includes('/node_modules/@vue/')
          ) return 'vue'
          if (
            normalized.includes('/node_modules/naive-ui/') ||
            normalized.includes('/node_modules/css-render/') ||
            normalized.includes('/node_modules/vueuc/') ||
            normalized.includes('/node_modules/vooks/') ||
            normalized.includes('/node_modules/seemly/')
          ) return 'naive-ui'
          return 'vendor'
        },
      },
    },
  },
})

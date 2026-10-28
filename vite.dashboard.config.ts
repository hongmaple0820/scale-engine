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
    // Vite 8 bundles with Rolldown: `rollupOptions`/`manualChunks` still work
    // as deprecated aliases, but `codeSplitting.groups` is the supported form.
    // `includeDependenciesRecursively: false` preserves the previous per-module
    // assignment (a module's dependencies are not dragged into its group).
    rolldownOptions: {
      output: {
        codeSplitting: {
          includeDependenciesRecursively: false,
          groups: [
            {
              name: 'vue',
              test: /[\\/]node_modules[\\/](vue|@vue)[\\/]/,
              priority: 20,
            },
            {
              name: 'naive-ui',
              test: /[\\/]node_modules[\\/](naive-ui|css-render|vueuc|vooks|seemly)[\\/]/,
              priority: 10,
            },
            {
              name: 'vendor',
              test: /[\\/]node_modules[\\/]/,
              priority: 0,
            },
          ],
        },
      },
    },
  },
})

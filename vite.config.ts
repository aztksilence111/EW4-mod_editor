import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: './',
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    proxy: { '/editor-api': 'http://127.0.0.1:' + (process.env.EW4_EDITOR_API_PORT || '5184') },
    watch: { ignored: ['**/.local/**', '**/bridge/**', '**/tests/runtime/bin/**', '**/tests/runtime/obj/**'] },
  },
  build: {
    chunkSizeWarningLimit: 3000,
  },
})

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Where the dev server forwards /api requests. Override with VITE_DEV_API_TARGET (for example in .env.local).
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_DEV_API_TARGET || 'http://127.0.0.1:8000'

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, './src') }
    },
    server: {
      // Same-origin /api in development, so the browser needs no CORS. Only the health check uses it today:
      // no Instagram data is ever sent to the backend.
      proxy: { '/api': { target: apiTarget, changeOrigin: true } }
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: false
    }
  }
})

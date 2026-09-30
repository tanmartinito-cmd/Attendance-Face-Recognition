import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backend = (env.VITE_API_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '')
  // Local copy of the Cloudflare Pages Function (frontend/functions/): only the token
  // endpoints go through the dev server, so the httpOnly refresh cookie is first-party.
  const authProxy = { target: backend, changeOrigin: true }

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api/token': authProxy,
        '/api/auth/logout': authProxy,
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.js',
      globals: true,
      css: false,
    },
  }
})

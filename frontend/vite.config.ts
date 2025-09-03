import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const apiBase = (env.VITE_API_BASE_URL || 'http://localhost:5000').replace(/\/+$/, '')

  return {
    plugins: [react()],
    resolve: {
      alias: { '@': '/src' }
    },
    server: {
      port: 5173,
      proxy: { '/api': { target: apiBase, changeOrigin: true } }
    },
    preview: {
      port: 5173,
      proxy: { '/api': { target: apiBase, changeOrigin: true } }
    }
  }
})

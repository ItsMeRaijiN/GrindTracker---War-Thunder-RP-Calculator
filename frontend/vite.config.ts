import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const api = env.VITE_API_BASE_URL || 'http://localhost:5000'
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: api,
          changeOrigin: true
        }
      }
    },
    resolve: {
      alias: { '@': '/src' }
    }
  }
})

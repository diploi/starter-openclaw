import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    hmr: {
      path: '/hmr'
    },
    port: 5173,
    proxy: {
      /*'/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
      '/healthz': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/dashboard': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
      '/openclaw': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },*/
    },
  },
})

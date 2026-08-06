import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('react') || id.includes('react-dom')) return 'vendor'
          if (id.includes('lucide-react') || id.includes('date-fns')) return 'ui'
          return undefined
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
  },
})

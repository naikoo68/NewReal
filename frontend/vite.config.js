import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Split heavy third-party libraries into their own cacheable chunks so a
    // page that doesn't use them (e.g. the home page) never downloads them.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('chart.js') || id.includes('react-chartjs-2')) return 'chart-vendor';
            if (id.includes('katex')) return 'katex-vendor';
            if (id.includes('react-router') || id.includes('/react-dom/') || id.includes('/react/')) return 'react-vendor';
            return 'vendor';
          }
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
})

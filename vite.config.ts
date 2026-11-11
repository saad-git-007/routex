import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, /api is served by `wrangler pages dev dist` on :8788.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8788' } },
  // MapLibre is large and changes rarely: its own chunk stays cached across app releases.
  build: { target: 'es2022', chunkSizeWarningLimit: 1100, rollupOptions: { output: { manualChunks: { maplibre: ['maplibre-gl'] } } } },
})

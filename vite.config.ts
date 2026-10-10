import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, /api is served by `wrangler pages dev dist` on :8788.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8788' } },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
})

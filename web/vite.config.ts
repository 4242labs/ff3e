import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// `base: './'` (relative) so one bundle works whether it's served at a domain
// root or mounted at a subpath. Output goes to ./dist, which the server picks
// up (see server/main.py, or WEB_DIST). Override `base` with VITE_BASE when a
// consumer mounts the SPA under a fixed absolute path (e.g. `/entropy/`) that
// relative `./` can't resolve for deep-linked routes.
//
// The dev proxy lets `npm run dev` talk to a server running on :8000. With no
// server up, the app falls back to the synthetic fixtures in src/fixtures/.
export default defineConfig({
  base: process.env.VITE_BASE || './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})

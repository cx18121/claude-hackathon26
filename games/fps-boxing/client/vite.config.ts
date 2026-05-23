import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(() => ({
  base: '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, '../../../shared'),
      // See mobile/vite.config.ts for the worker-chunk resolution story.
      '@mediapipe/tasks-vision': path.resolve(import.meta.dirname, 'node_modules/@mediapipe/tasks-vision'),
    },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    host: true,
    port: 5175,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
    // e2e/ is Playwright, not vitest — its imports of node:* fixtures crash vitest's bundler.
    exclude: ['e2e/**', 'node_modules/**', 'dist/**', 'dist-e2e/**'],
  },
}))

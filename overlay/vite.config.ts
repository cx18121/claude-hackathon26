import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: process.env.VERCEL ? '/' : command === 'build' ? '/overlay/' : '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, '../shared'),
    },
    // overlay does not use the pose worker, so the @mediapipe alias mobile
    // and fps need isn't required here. Kept dedupe for React.
    dedupe: ['react', 'react-dom'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // e2e/ is Playwright, not vitest — its imports of node:* fixtures crash vitest's bundler.
    exclude: ['e2e/**', 'node_modules/**', 'dist/**', 'dist-e2e/**'],
  },
}))

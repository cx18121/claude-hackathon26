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
    // shared/client/* lives outside this app's node_modules. `dedupe` forces
    // Vite to resolve these from THIS app's node_modules even when the import
    // originates from the shared tree.
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

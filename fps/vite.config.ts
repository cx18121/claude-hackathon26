import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ command }) => ({
  base: process.env.VERCEL ? '/' : command === 'build' ? '/fps/' : '/',
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
  server: {
    host: true,
    port: 5174,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
    // e2e/ is Playwright, not vitest — its imports of node:* fixtures crash vitest's bundler.
    exclude: ['e2e/**', 'node_modules/**', 'dist/**', 'dist-e2e/**'],
  },
}))

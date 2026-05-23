import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(() => ({
  base: '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, '../../../shared'),
      // Vite's worker-chunk bundler resolves bare imports from the importing
      // file's directory upward. Shared modules in `shared/client/` need this
      // app's node_modules to be reachable, but there is no node_modules at
      // the `shared/` level. Explicit aliases route shared-module bare
      // imports back to THIS app's node_modules at worker-bundle time.
      '@mediapipe/tasks-vision': path.resolve(import.meta.dirname, 'node_modules/@mediapipe/tasks-vision'),
      'pixi.js': path.resolve(import.meta.dirname, 'node_modules/pixi.js'),
      'react': path.resolve(import.meta.dirname, 'node_modules/react'),
      'react-dom': path.resolve(import.meta.dirname, 'node_modules/react-dom'),
    },
    // `dedupe` covers the main chunk; the explicit aliases above cover the
    // isolated worker-chunk pass where dedupe doesn't apply.
    dedupe: ['react', 'react-dom'],
  },
  server: {
    host: true,
    port: 5174,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
}))

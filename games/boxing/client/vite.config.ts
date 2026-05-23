import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [react()],
  resolve: {
    // Files imported from `@shared/client/*` live outside this project's
    // tree, so node_modules walk-up doesn't find runtime deps. Each
    // external used by a shared file needs an explicit alias here.
    alias: {
      '@shared': path.resolve(import.meta.dirname, '../../../shared'),
      '@mediapipe/tasks-vision': path.resolve(import.meta.dirname, 'node_modules/@mediapipe/tasks-vision'),
      'pixi.js': path.resolve(import.meta.dirname, 'node_modules/pixi.js'),
      'react': path.resolve(import.meta.dirname, 'node_modules/react'),
      'react-dom': path.resolve(import.meta.dirname, 'node_modules/react-dom'),
      '@testing-library/react': path.resolve(import.meta.dirname, 'node_modules/@testing-library/react'),
    },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    host: true,
    port: 5173,
    // Allow vitest (which uses the dev server) to load test files from
    // shared/client/ above this app's root.
    fs: {
      allow: [path.resolve(import.meta.dirname, '../../../')],
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Pick up the per-app tests AND the shared-client tests that live next
    // to the modules they exercise. Tests for shared modules used by only
    // some games (e.g. pixi-bound code) live alongside their source so
    // each consuming game discovers them.
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      '../../../shared/client/**/*.{test,spec}.{ts,tsx}',
    ],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
})

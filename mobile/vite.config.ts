import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: process.env.VERCEL ? '/' : command === 'build' ? '/mobile/' : '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, '../shared'),
    },
  },
  server: {
    // Listen on all interfaces so a phone on the same LAN can hit the dev
    // server when this app is running on a laptop.
    host: true,
    port: 5173,
  },
  // Match the `new Worker(..., { type: 'module' })` in usePose. Vite's default
  // worker format is 'iife', which emits `self.import(...)` calls to load
  // chunks — `self.import` doesn't exist, so the worker throws
  // "self.import is not a function" on first load in production builds.
  worker: {
    format: 'es',
  },
}))

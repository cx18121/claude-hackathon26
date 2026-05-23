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
    // shared/client/* lives outside this app's node_modules. `dedupe` forces
    // Vite to resolve these from THIS app's node_modules even when the import
    // originates from the shared tree, avoiding "Failed to resolve import" for
    // bare specifiers in shared modules.
    dedupe: ['react', 'react-dom'],
  },
  server: {
    // Listen on all interfaces so a phone on the same LAN can hit the dev
    // server when this app is running on a laptop.
    host: true,
    port: 5173,
  },
}))

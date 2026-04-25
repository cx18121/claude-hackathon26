import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/mobile/' : '/',
  plugins: [react()],
  server: {
    // Listen on all interfaces so a phone on the same LAN can hit the dev
    // server when this app is running on a laptop.
    host: true,
    port: 5173,
  },
}))

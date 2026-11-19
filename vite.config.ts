/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
  test: {
    // jsdom gives tests a browser-like DOMParser so the MusicXML parser
    // runs the same code path in tests as in the browser.
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
})

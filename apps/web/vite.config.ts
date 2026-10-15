import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const fromSrc = (dir: string) => fileURLToPath(new URL(`./src/${dir}`, import.meta.url));
const api = { target: process.env.API_ORIGIN ?? 'http://localhost:3000', changeOrigin: false };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@app': fromSrc('app'),
      '@data': fromSrc('data'),
      '@features': fromSrc('features'),
      '@shared': fromSrc('shared'),
      '@i18n': fromSrc('i18n'),
    },
  },
  server: { port: 5173, proxy: { '/api': api } },
  preview: { proxy: { '/api': api } },
  build: { sourcemap: 'hidden' },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Whole-app renders with user events need more than the 5 s default on a loaded machine.
    testTimeout: 15_000,
  },
});

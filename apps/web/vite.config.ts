import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

const fromSrc = (dir: string) => fileURLToPath(new URL(`./src/${dir}`, import.meta.url));
const api = { target: process.env.API_ORIGIN ?? 'http://localhost:3000', changeOrigin: false };

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // A new version waits until the user accepts the reload prompt (app/update-prompt.tsx).
      registerType: 'prompt',
      injectRegister: false,
      // Manifest icons and the manifest itself are precached by the plugin.
      includeAssets: ['apple-touch-icon.png', 'favicon.ico', 'favicon.svg'],
      manifest: {
        name: 'Spending',
        short_name: 'Spending',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        // --primary and --background from shared/styles.css, as hex for manifest support.
        theme_color: '#006944',
        background_color: '#fafaf9',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2}'],
        // pdf.js (~1.7 MB) loads only when someone opens a PDF, then stays cached for offline use.
        globIgnores: ['assets/pdf-*.js', 'assets/pdf.worker*.js'],
        navigateFallback: 'index.html',
        // API and auth responses are private and live: never served from or stored in the cache.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/pdf(-|\.worker).*\.js$/,
            handler: 'CacheFirst',
            // Hashed names: entries of older releases are evicted, not revalidated.
            options: { cacheName: 'pdfjs', expiration: { maxEntries: 6 } },
          },
        ],
      },
    }),
  ],
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

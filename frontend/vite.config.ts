import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Populated by deploy.sh as `{date}+{git short SHA}` before this build runs
// (see deploy.sh) — absent locally, hence the 'dev' fallback.
function readBuildVersion(): string {
  try {
    return readFileSync(resolve(__dirname, '../VERSION'), 'utf8').trim()
  } catch {
    return 'dev'
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(readBuildVersion()),
  },
  plugins: [
    react(),
    VitePWA({
      // 'prompt' (not autoUpdate) so the new SW waits for explicit confirmation —
      // the <NewVersionToast> in App.tsx surfaces the prompt as a bottom-left card
      // with a one-click reload. Avoids silent mid-session reloads, especially in
      // the grading flow where unsaved edits would be wiped.
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'ИСПУМ — Интеллектуальная Система Проверки и Подготовки Учебных Материалов',
        short_name: 'ИСПУМ',
        description: 'ИСПУМ — Интеллектуальная Система Проверки и Подготовки Учебных Материалов. Проверка студенческих работ с ИИ и подготовка лекций для преподавателей.',
        theme_color: '#C8860A',
        background_color: '#F7F5F0',
        display: 'standalone',
        start_url: '/',
        lang: 'ru',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icon.svg',     sizes: 'any',     type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // Cache Google Fonts
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: { maxEntries: 5, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // API calls — network first, fall back to cache
            urlPattern: /^http.*\/api\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 5 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})

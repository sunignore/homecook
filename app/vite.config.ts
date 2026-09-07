import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// The offline shell is a design constraint, not an optimization — see
// docs/design.md evidence E6. Nothing here may pull a runtime font or icon
// download; fonts are the system stack and icons are inlined SVG components.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'homecook',
        short_name: 'homecook',
        description: 'Personal home cooking — recipes, pantry and cook mode, offline.',
        lang: 'ko',
        theme_color: '#1f1a17',
        background_color: '#faf8f5',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell only. Recipe data and photos live in IndexedDB (ADR-0001),
        // so there is nothing here to cache at the network layer.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
});

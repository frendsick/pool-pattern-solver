import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Installable, fully-offline PWA. The whole app is static and the solver runs in
// the browser, so the service worker precaches every build asset and the app needs
// zero network after the one-time (local) install. See
// docs/adr/0007-installable-offline-pwa-no-hosting.md.
export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      },
      manifest: {
        name: '9-Ball Pattern Solver',
        short_name: 'Pattern Solver',
        description:
          'Random late-rack 9-ball layouts, solved for the best run-out pattern.',
        start_url: '/',
        display: 'standalone',
        orientation: 'any',
        theme_color: '#20242a',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
});

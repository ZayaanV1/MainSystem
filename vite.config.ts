/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),

    VitePWA({
      // The service worker is hand-written: it handles push, which a generated
      // worker cannot, and its caching rules are short enough not to justify a
      // Workbox dependency.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // The app registers the worker itself, in src/lib/sw.ts. The generated
      // helper silently failed to register anything on the deployed site, and
      // swallowed the reason — so nothing here should inject a registration.
      injectRegister: null,

      injectManifest: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg}'],
      },

      // Registering the worker in dev would serve a stale bundle after every
      // edit, which is a confusing way to lose an afternoon.
      devOptions: { enabled: false },

      manifest: {
        name: 'Planner',
        short_name: 'Planner',
        description: 'Personal planner',
        lang: 'en-CA',

        // No browser chrome once installed to the home screen.
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',

        // Matches --ink-900. The splash screen and status bar must not flash
        // white before the app paints; on a phone opened at 1am that flash is
        // genuinely unpleasant.
        background_color: '#15161D',
        theme_color: '#15161D',

        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],

  test: {
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'supabase/**/*.test.ts',
      // Structural guards over the source tree. They live outside src/ for
      // the same reason the migration tests do: they use Node APIs, and the
      // app's tsconfig deliberately has no Node types so that app code
      // cannot reach for them by accident.
      'tests/**/*.test.ts',
    ],
    // The host timezone is deliberately NOT pinned here. The time layer must be
    // correct regardless of the machine it runs on — the app runs in a browser
    // in Montreal and the digest runs on an edge server somewhere unknown.
    // `npm run test:tz` runs the suite under five hostile zones to prove it.
  },
});

/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * The ground colour, read from the token file rather than written here. The
 * manifest needs a literal (a manifest cannot hold a var()), and the literal
 * it held was the cool near-black from before Phase B, so the splash screen
 * and the installed app's status bar were a different black from the app for
 * a month. Reading --ink-900 means they cannot drift again. The first
 * declaration is the dark palette, which is the default.
 */
function inkGround(): string {
  const tokens = readFileSync(new URL('./src/styles/tokens.css', import.meta.url), 'utf8');
  const m = /--ink-900:\s*(#[0-9a-fA-F]{6})/u.exec(tokens);
  if (!m) throw new Error('tokens.css has no --ink-900; the manifest needs the ground colour');
  return m[1];
}

// Shown at the foot of Settings, so the phone can say which deploy it is on.
// Vercel provides the commit; a local build asks git.
function buildId(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (sha) return sha.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'local';
  }
}

export default defineConfig({
  resolve: {
    alias: {
      // supabase-js builds a storage client the app never uses; see the stub.
      '@supabase/storage-js': fileURLToPath(new URL('./src/lib/vendor/storage-stub.ts', import.meta.url)),
    },
  },
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
    __BUILD_TIME__: JSON.stringify(
      new Date().toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC',
    ),
  },
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

        // --ink-900. The splash screen and status bar must not flash white
        // before the app paints; on a phone opened at 1am that flash is
        // genuinely unpleasant.
        background_color: inkGround(),
        theme_color: inkGround(),

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

  /*
   * The dev server takes whatever port it is given.
   *
   * Nothing here depends on a fixed one: auth is email and password with no
   * OAuth callback to register, and the edge functions accept any localhost
   * origin rather than one hardcoded port. Pinning 5173 only ever produced a
   * collision with a server left running from an earlier session.
   */
  server: {
    port: Number(process.env.PORT) || 5173,
  },

  test: {
    environment: 'node',
    // Run supabase-js through Vite so the storage alias applies in tests as
    // it does in the build; left to Node, the real storage-js loads and the
    // test of the stub would pass without exercising it.
    server: { deps: { inline: ['@supabase/supabase-js'] } },
    // Pins the account timezone; see tests/setup.ts for why that is not the
    // same thing as pinning the host's.
    setupFiles: ['./tests/setup.ts'],
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

// Runs the real app with the Supabase client swapped for the in-memory sample
// in mock-supabase.ts. Used by Playwright (playwright.config.ts) and for
// looking at the app without an account:
//
//   npx vite --config e2e/harness/vite.config.ts      -> http://localhost:5199
import { fileURLToPath } from 'node:url';
import { mergeConfig, type Plugin } from 'vite';
import base from '../../vite.config.ts';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const MOCK = fileURLToPath(new URL('./mock-supabase.ts', import.meta.url));

// Swaps only the app's own src/lib/supabase.ts, wherever it is imported from.
const swap: Plugin = {
  name: 'sample-supabase',
  enforce: 'pre',
  async resolveId(source, importer, options) {
    if (!importer || importer === MOCK) return null;
    if (!/(^|\/)supabase$/.test(source) || source.includes('@supabase')) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    if (resolved?.id.endsWith('/src/lib/supabase.ts')) return MOCK;
    return null;
  },
};

// In development nothing builds src/sw.ts, so /sw.js would be answered with
// index.html and every page load would log a failed registration. A worker
// that does nothing keeps the console honest: the tests fail on any console
// error, and this one would only ever be noise from the harness.
const noopWorker: Plugin = {
  name: 'noop-service-worker',
  configureServer(server) {
    server.middlewares.use('/sw.js', (_req, res) => {
      res.setHeader('Content-Type', 'text/javascript');
      res.end("self.addEventListener('install', () => self.skipWaiting());");
    });
  },
};

export default mergeConfig(base, {
  root: REPO,
  plugins: [swap, noopWorker],
  server: { port: 5199, strictPort: true },
});

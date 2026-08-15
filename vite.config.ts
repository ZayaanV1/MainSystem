/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],

  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'supabase/**/*.test.ts'],
    // The host timezone is deliberately NOT pinned here. The time layer must be
    // correct regardless of the machine it runs on — the app runs in a browser
    // in Montreal and the digest runs on an edge server somewhere unknown.
    // `npm run test:tz` runs the suite under five hostile zones to prove it.
  },
});

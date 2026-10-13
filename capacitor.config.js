import { readFileSync } from 'node:fs';

/*
 * The ground colour, read from the token file rather than written here, for
 * the same reason vite.config.ts does it: the native shell paints this before
 * the web view does, so a second copy of the value is a flash of the wrong
 * black on every launch. The first --ink-900 in tokens.css is the dark palette.
 */
function inkGround() {
  const tokens = readFileSync(new URL('./src/styles/tokens.css', import.meta.url), 'utf8');
  const m = /--ink-900:\s*(#[0-9a-fA-F]{6})/u.exec(tokens);
  if (!m) throw new Error('tokens.css has no --ink-900; the native shell needs the ground colour');
  return m[1];
}

/*
 * The native shell around the same build Vercel serves. webDir is the Vite
 * output, so `npm run build && npx cap sync ios` is the whole release step.
 *
 * The app loads from the bundle (capacitor://localhost), not from the live
 * site, so it opens offline. Anything that checks a request's Origin must
 * therefore allow that scheme; see corsFor() in the edge functions.
 *
 * This is .js rather than .ts because the Capacitor 7 CLI loads a TypeScript
 * config through CommonJS, which fails in a "type": "module" package.
 *
 * @type {import('@capacitor/cli').CapacitorConfig}
 */
const config = {
  appId: 'com.zayaanvastani.planner',
  appName: 'Planner',
  webDir: 'dist',
  ios: {
    contentInset: 'never',
    backgroundColor: inkGround(),
  },
};

export { config as 'module.exports' };

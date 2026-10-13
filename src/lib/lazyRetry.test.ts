import { describe, expect, it } from 'vitest';
import { failedModuleUrl, isDownloadFailure } from './lazyRetry';

// The words each browser uses when a dynamic import's code cannot be fetched,
// and whether they name the file. The retry depends on the file's address,
// because importing the same address again fails without asking the network.
describe('reading a failed download', () => {
  it('Chrome names the file', () => {
    const e = new TypeError('Failed to fetch dynamically imported module: https://main-system-beta.vercel.app/assets/AssignmentEditor-Ck91_T6Y.js');
    expect(isDownloadFailure(e)).toBe(true);
    expect(failedModuleUrl(e)).toBe('https://main-system-beta.vercel.app/assets/AssignmentEditor-Ck91_T6Y.js');
  });

  it('Firefox names the file', () => {
    const e = new TypeError('error loading dynamically imported module: https://example.app/assets/Week-a1B2c3.js');
    expect(isDownloadFailure(e)).toBe(true);
    expect(failedModuleUrl(e)).toBe('https://example.app/assets/Week-a1B2c3.js');
  });

  it('Safari does not, so there is no address to retry', () => {
    const e = new TypeError('Importing a module script failed.');
    expect(isDownloadFailure(e)).toBe(true);
    expect(failedModuleUrl(e)).toBeNull();
  });

  it('drops a retry query already on the address', () => {
    const e = new TypeError('Failed to fetch dynamically imported module: http://localhost:5199/src/routes/AssignmentEditor.tsx?retry=1');
    expect(failedModuleUrl(e)).toBe('http://localhost:5199/src/routes/AssignmentEditor.tsx');
  });

  it('a stylesheet that failed to preload is not a module to import', () => {
    const e = new Error('Unable to preload CSS for /assets/Week-a1B2c3.css');
    expect(isDownloadFailure(e)).toBe(true);
    expect(failedModuleUrl(e)).toBeNull();
  });

  it('an ordinary render error is not a download failure', () => {
    expect(isDownloadFailure(new TypeError("Cannot read properties of undefined (reading 'title')"))).toBe(false);
  });
});

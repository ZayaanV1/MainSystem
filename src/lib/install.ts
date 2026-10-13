/**
 * Whether to suggest installing the app (the iPhone review, 12 Oct 2026).
 *
 * In Safari on an iPhone the app's tab bar floats over Safari's own toolbar,
 * and reminders cannot arrive at all: iOS delivers web push only to an app
 * added to the Home Screen. So in exactly that case, Today says so once, with
 * the two taps it takes, and never again once dismissed.
 *
 * Kept apart from notifications.ts so the first screen does not load the
 * push code to ask one question.
 */

const KEY = 'planner.installHint.dismissed';

/** An iPhone or iPad, including an iPad that reports itself as a Mac. */
export function isIos(nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> & { platform?: string } = navigator): boolean {
  if (/Android/u.test(nav.userAgent)) return false;
  return /iP(hone|od|ad)/u.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}

/** Running from the Home Screen rather than in a browser tab. */
export function isInstalled(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    // Safari's own flag, still the only reliable one on iOS.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function shouldHintInstall(): boolean {
  if (!isIos() || isInstalled()) return false;
  try {
    return localStorage.getItem(KEY) === null;
  } catch {
    // Storage refused (private browsing): say it, since it cannot be remembered as said.
    return true;
  }
}

export function dismissInstallHint(): void {
  try {
    localStorage.setItem(KEY, new Date().toISOString());
  } catch {
    // Not fatal: it stays dismissed for this visit.
  }
}

/** Marks <html> when running in iOS Safari, so the chrome can make room for Safari's bars. */
export function markBrowserChrome(): void {
  if (typeof document === 'undefined') return;
  if (isIos() && !isInstalled()) document.documentElement.dataset.iosBrowser = '';
}

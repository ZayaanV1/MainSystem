import { Component, lazy, useEffect, useState, type ComponentProps, type ComponentType, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useSheetPresence } from '../components/Sheet';

/**
 * lazy(), except that a failed download costs one attempt, not the session.
 *
 * React's lazy() keeps the promise it was given. If the download of a
 * screen's or a sheet's code fails once — a cold offline start before the
 * service worker has cached it, or the moment a new version activates and
 * clears the old cache — every later render throws that same failure again
 * until the page is reloaded. And it lands on the nearest error boundary,
 * which for a sheet opened from Today was Today's own: one tap on a piece of
 * work offline replaced the whole screen, capture box and all (BUG-002,
 * e2e/resilience.spec.ts).
 *
 * So each component made here carries its own boundary for download failures
 * only. It says what happened in a bar, offers Try again (a fresh download,
 * not the remembered failure) and, for a sheet, Close. Any other error is
 * thrown on, unchanged, to the boundary above.
 */
// Components take any props, as with React's lazy().
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyRetry<M, T extends ComponentType<any>>(
  load: () => Promise<M>,
  pick: (module: M) => T,
): ComponentType<ComponentProps<T>> {
  let tries = 0;
  let Current = lazy(() => load().then((m) => ({ default: pick(m) })));

  /*
   * A fresh download, which is not the same as calling load() again: the
   * browser remembers a module whose fetch failed, so importing the same
   * address again fails at once without asking the network (measured in
   * Chromium; e2e/resilience.spec.ts). The same file under a new query string
   * is a new module to the browser and is fetched. Chrome and Firefox name the
   * failed file in the error; Safari does not, so there the way to a fresh
   * download is a reload, and only while online, where it can succeed.
   */
  function retry(error: unknown): boolean {
    const url = failedModuleUrl(error);
    if (url) {
      tries += 1;
      const fresh = `${url}${url.includes('?') ? '&' : '?'}retry=${tries}`;
      Current = lazy(() => import(/* @vite-ignore */ fresh).then((m) => ({ default: pick(m as M) })));
      return true;
    }
    if (navigator.onLine) {
      window.location.reload();
      return false;
    }
    Current = lazy(() => load().then((m) => ({ default: pick(m) })));
    return true;
  }

  function Retrying(props: ComponentProps<T>) {
    const [attempt, setAttempt] = useState(0);
    return (
      <LoadBoundary
        key={attempt}
        onRetry={(error) => {
          if (retry(error)) setAttempt((n) => n + 1);
        }}
        onClose={(props as { onClose?: () => void }).onClose}
      >
        <Current {...props} />
      </LoadBoundary>
    );
  }
  return Retrying;
}

/** The address of the module that failed, when the browser says it. */
export function failedModuleUrl(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  if (/preload CSS/i.test(message)) return null;
  return /(https?:\/\/[^\s'"]+?\.(?:m?js|jsx|tsx?))(?:\?[^\s'"]*)?(?=[\s'"]|$)/.exec(message)?.[1] ?? null;
}

/** What each browser says when the code for a dynamic import cannot be had. */
const DOWNLOAD_FAILED =
  /dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading chunk \d+ failed/i;

export function isDownloadFailure(error: unknown): boolean {
  return DOWNLOAD_FAILED.test(error instanceof Error ? error.message : String(error));
}

class LoadBoundary extends Component<
  { children: ReactNode; onRetry: (error: unknown) => void; onClose?: () => void },
  { failed: unknown }
> {
  state = { failed: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { failed: error };
  }

  render() {
    const { failed } = this.state;
    if (failed === null) return this.props.children;
    // Not ours: a render error belongs to the boundary that explains it.
    if (!isDownloadFailure(failed)) throw failed;
    return <LoadFailed onRetry={() => this.props.onRetry(failed)} onClose={this.props.onClose} />;
  }
}

function LoadFailed({ onRetry, onClose }: { onRetry: () => void; onClose?: () => void }) {
  // Standing in for a sheet that never arrived: there is no exit to animate,
  // so let SheetPresence go as soon as the sheet is closed.
  const presence = useSheetPresence();
  useEffect(() => {
    if (presence?.closing) presence.done();
  }, [presence]);
  if (presence?.closing) return null;

  // Into the body, as the undo bar is, so a receding page cannot take it along.
  return createPortal(
    <div
      role="alert"
      className="undo-bar fixed inset-x-4 z-40 mx-auto flex max-w-[26rem] items-center gap-2 rounded-pill py-2 pr-2 pl-5"
    >
      <p className="min-w-0 flex-1 type-label text-text-hi">Couldn’t load this. Check the connection and try again.</p>
      <button type="button" onClick={onRetry} className="btn btn-quiet min-h-9 px-4 type-label">
        Try again
      </button>
      {onClose && (
        <button type="button" onClick={onClose} className="btn btn-quiet min-h-9 px-4 type-label">
          Close
        </button>
      )}
    </div>,
    document.body,
  );
}

import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * What the app shows when a screen throws while rendering.
 *
 * Without this, React's answer to any render error is to unmount the entire
 * tree — which is exactly what happened when WhatNow called a hook
 * conditionally: every screen, the navigation, the capture box, all gone, and
 * the only thing left was the page's background. Nothing on screen said an
 * error had happened at all, so it read as the app being empty rather than
 * the app being broken, and nothing offered a way out.
 *
 * TWO LAYERS, DELIBERATELY
 *
 * One wraps each screen, keyed on the screen, so a fault in Week leaves the
 * navigation working and moving to Today clears it. One wraps the whole app,
 * for a fault in the shell itself. Either way the person sees a sentence
 * saying what happened and a way to try again, never an empty ground.
 *
 * It also asks the service worker to look for a newer version the moment it
 * catches something. A render error in production is usually already fixed
 * in a later deploy — this crash was — and the reload button is only useful
 * if what it reloads is the fixed build rather than the cached broken one.
 */

interface Props {
  children: ReactNode;
  /** Short name of what failed, for the message: "This screen", "The app". */
  what?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[render error]', error, info.componentStack);
    void navigator.serviceWorker
      ?.getRegistration()
      .then((r) => r?.update())
      .catch(() => {});
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div role="alert" className="mx-auto flex max-w-160 flex-col gap-4 px-6 py-16">
        <h1 className="type-h1 text-text-hi">{this.props.what ?? 'This screen'} couldn’t be shown.</h1>
        <p className="type-body text-text-mid">
          Something went wrong while drawing it. Your data is safe — nothing is lost or changed by
          this. Reloading usually fixes it, and picks up any update that fixes it for good.
        </p>
        <div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex min-h-[var(--tap)] items-center justify-center rounded-pill border border-transparent bg-linear-to-b from-accent-lit via-accent to-accent-deep px-5 type-label text-on-accent shadow-[var(--shadow-ember)]"
          >
            Reload
          </button>
        </div>
        {/* The message itself, small, so a screenshot of this screen is a
            useful bug report rather than a picture of an apology. */}
        <p className="type-quote text-text-low">{error.message}</p>
      </div>
    );
  }
}

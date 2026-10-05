/**
 * History entries for things open over a screen.
 *
 * Every sheet takes one, so the back gesture closes the sheet instead of
 * leaving the app, and closing a sheet by its own control pops its entry so
 * Back never lands on a sheet that is already gone.
 *
 * The one subtlety: closing one sheet and opening another in the same tap
 * (Edit on the checklist opens the item's editor) would push the new entry
 * before the old one's Back had landed, and that Back would then pop the new
 * sheet's entry and close it. So a push waits for any Back in flight.
 */

let settling: Promise<void> = Promise.resolve();

/** Pop one entry, and make later pushes wait until it has landed. */
export function popEntry(): void {
  settling = new Promise((resolve) => {
    const done = () => resolve();
    window.addEventListener('popstate', done, { once: true });
    // A Back that never fires (no entry to pop) must not hold pushes forever.
    setTimeout(done, 400);
  });
  window.history.back();
}

/** Run after any Back in flight has landed. */
export function afterSettled(run: () => void): void {
  void settling.then(run);
}

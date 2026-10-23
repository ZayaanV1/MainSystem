/**
 * Getting a file out of the app: save it, share it, or print it.
 *
 * Three routes because no single one works everywhere. A download link is
 * right on a laptop and does nothing inside the iOS app's web view; the share
 * sheet is how a phone sends a file to Files, Mail or a printer; printing a
 * PDF means loading it into a frame and printing the frame. Each reports what
 * happened so the screen can say so, rather than failing quietly.
 */

export type ExportOutcome = 'saved' | 'shared' | 'cancelled' | 'failed';

/** Whether this device can hand a file to its share sheet. */
export function canShareFiles(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [new File([''], 'x.pdf', { type: 'application/pdf' })] });
  } catch {
    return false;
  }
}

/** Offer the file to the system share sheet. */
export async function shareFile(blob: Blob, filename: string): Promise<ExportOutcome> {
  const file = new File([blob], filename, { type: blob.type });
  try {
    await navigator.share({ files: [file], title: filename });
    return 'shared';
  } catch (e) {
    // Closing the sheet is a choice, not an error.
    return (e as Error).name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

/** Save the file through the browser's download. */
export function downloadFile(blob: Blob, filename: string): ExportOutcome {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return 'saved';
  } catch {
    return 'failed';
  }
}

/** A name safe to put on a file: letters, digits and single dashes. */
export function safeFilename(name: string, extension: string): string {
  const stem = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${stem || 'file'}.${extension}`;
}

/**
 * Print a PDF by loading it into a hidden frame. Where the browser will not
 * print from a frame (iOS Safari), the file opens in a tab instead, which has
 * its own print command.
 */
export function printPdf(blob: Blob): ExportOutcome {
  const url = URL.createObjectURL(blob);
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
  frame.src = url;

  const cleanup = () => {
    frame.remove();
    URL.revokeObjectURL(url);
  };

  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      window.setTimeout(cleanup, 60_000);
    } catch {
      cleanup();
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    }
  };
  document.body.append(frame);
  return 'saved';
}

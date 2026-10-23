import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Button } from './Button';
import { canShareFiles, downloadFile, printPdf, shareFile } from '../lib/exportFile';
import '../styles/work.css';

/**
 * A PDF, read in the app.
 *
 * pdf.js draws each page to a canvas, only as it nears the screen, and gives
 * the canvas back when it is far away, so a hundred-page reading does not hold
 * a hundred bitmaps. The library and its worker are loaded when a PDF is
 * opened and not before: they are most of a megabyte and nobody opening Today
 * should pay for them.
 *
 * What it does: scroll, zoom, jump to a page, find the pages a word is on,
 * save, share and print. What it does not: highlight the word on the page, or
 * select text. Search says which pages, and says that is all it does.
 */

const ZOOMS = [0.6, 0.8, 1, 1.25, 1.5, 2, 3];
const DEFAULT_ZOOM = 2; // index into ZOOMS: 1 = the width of the column

type Pdfjs = typeof import('pdfjs-dist');
let loading: Promise<Pdfjs> | null = null;

function loadPdfjs(): Promise<Pdfjs> {
  loading ??= (async () => {
    const [lib, worker] = await Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]);
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  })();
  // A failed load is retried on the next open rather than remembered.
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

function Page({
  doc,
  number,
  width,
  ratio,
}: {
  doc: PDFDocumentProxy;
  number: number;
  /** The CSS width of the page, already including zoom. */
  width: number;
  /** Height over width of the first page, used until this page's own is known. */
  ratio: number;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(number <= 2);
  const [own, setOwn] = useState<number | null>(null);

  useEffect(() => {
    const el = holder.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    // Against the viewport: the pages flow with the screen rather than scrolling
    // inside a box of their own.
    const io = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), {
      rootMargin: '900px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    if (!near) {
      // Give the bitmap back; the placeholder keeps the page's place.
      el.width = 0;
      el.height = 0;
      return;
    }
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    void (async () => {
      const page = await doc.getPage(number);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      setOwn(base.height / base.width);
      const scale = width / base.width;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: scale * dpr });
      el.width = Math.floor(viewport.width);
      el.height = Math.floor(viewport.height);
      const ctx = el.getContext('2d');
      if (!ctx) return;
      task = page.render({ canvas: el, canvasContext: ctx, viewport });
      try {
        await task.promise;
      } catch {
        // A cancelled render is the page being scrolled away or resized.
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, number, width, near]);

  return (
    <div
      ref={holder}
      className="pdf-page"
      data-page={number}
      style={{ width, height: width * (own ?? ratio) }}
    >
      <canvas ref={canvas} role="img" aria-label={`Page ${number}`} style={{ width, height: width * (own ?? ratio) }} />
    </div>
  );
}

export function PdfViewer({ bytes, filename }: { bytes: ArrayBuffer; filename: string }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [ratio, setRatio] = useState(1.3);
  const [zoomAt, setZoomAt] = useState(DEFAULT_ZOOM);
  const [column, setColumn] = useState(0);
  const [current, setCurrent] = useState(1);
  const [say, setSay] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [finding, setFinding] = useState(false);
  const blob = useMemo(() => new Blob([bytes], { type: 'application/pdf' }), [bytes]);

  useEffect(() => {
    let live = true;
    let opened: PDFDocumentProxy | null = null;
    setDoc(null);
    setProblem(null);
    void (async () => {
      try {
        const lib = await loadPdfjs();
        // Handed over as a copy: the worker takes ownership of what it is given,
        // and the bytes are still needed for saving and printing.
        const loadingTask = lib.getDocument({ data: new Uint8Array(bytes.slice(0)) });
        opened = await loadingTask.promise;
        if (!live) return void opened.destroy();
        const first = await opened.getPage(1);
        const v = first.getViewport({ scale: 1 });
        if (!live) return;
        setRatio(v.height / v.width);
        setDoc(opened);
      } catch (e) {
        if (!live) return;
        const name = (e as { name?: string }).name;
        setProblem(
          name === 'PasswordException'
            ? 'This PDF is password protected, so it can’t be shown here. Save it to open it elsewhere.'
            : 'This file couldn’t be shown. It may be damaged. You can still save it.',
        );
      }
    })();
    return () => {
      live = false;
      void opened?.destroy();
    };
  }, [bytes]);

  // The column's own width, so zoom 100% means "fits the screen".
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setColumn(Math.max(0, el.clientWidth - 24));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc]);

  const width = Math.round(column * ZOOMS[zoomAt]);
  const pages = doc?.numPages ?? 0;

  const jump = useCallback((n: number) => {
    const target = scroller.current?.querySelector<HTMLElement>(`[data-page="${n}"]`);
    if (!target) return;
    target.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
    setCurrent(n);
  }, []);

  // Which page is at the top, as the reader scrolls the screen.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !doc) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Just under the sticky toolbar.
        const line = (barRef.current?.getBoundingClientRect().bottom ?? 0) + 24;
        let best = 1;
        for (const p of el.querySelectorAll<HTMLElement>('[data-page]')) {
          if (p.getBoundingClientRect().top <= line) best = Number(p.dataset.page);
          else break;
        }
        setCurrent(best);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [doc]);

  /* ------------------------------------------------------------- search */
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ pages: number[]; at: number } | null>(null);
  const [searching, setSearching] = useState(false);
  const texts = useRef<Map<number, string>>(new Map());
  useEffect(() => {
    texts.current = new Map();
    setFound(null);
  }, [doc]);

  async function search(e: FormEvent) {
    e.preventDefault();
    const needle = query.trim().toLowerCase();
    if (!doc || !needle) return setFound(null);
    setSearching(true);
    const hits: number[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      let text = texts.current.get(n);
      if (text === undefined) {
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        text = content.items.map((i) => ('str' in i ? i.str : '')).join(' ').replace(/\s+/g, ' ').toLowerCase();
        texts.current.set(n, text);
      }
      if (text.includes(needle)) hits.push(n);
    }
    setSearching(false);
    setFound({ pages: hits, at: 0 });
    if (hits.length) jump(hits[0]);
  }

  function step(delta: 1 | -1) {
    if (!found || !found.pages.length) return;
    const at = (found.at + delta + found.pages.length) % found.pages.length;
    setFound({ ...found, at });
    jump(found.pages[at]);
  }

  /* ------------------------------------------------------------ exports */
  const announce = (outcome: string, done: string) => {
    if (outcome === 'failed') setSay('That didn’t work. Try Save instead.');
    else if (outcome !== 'cancelled') setSay(done);
    window.setTimeout(() => setSay(null), 4000);
  };

  return (
    <div className="pdf" aria-label={`PDF: ${filename}`}>
      <div className="pdf-bar" role="toolbar" aria-label="PDF tools" ref={barRef}>
        <div className="pdf-tools">
          <label className="pdf-page-jump">
            <span className="sr-only">Page</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={pages || 1}
              value={current}
              disabled={!doc}
              onChange={(e) => {
                const n = Math.min(pages, Math.max(1, Number(e.target.value) || 1));
                jump(n);
              }}
              className="pdf-input pdf-number"
              aria-label="Page number"
            />
            <span className="type-note text-text-low">of {pages || '–'}</span>
          </label>

          <div className="pdf-zoom" role="group" aria-label="Zoom">
            <Button size="sm" variant="quiet" aria-label="Zoom out" disabled={zoomAt === 0} onClick={() => setZoomAt((z) => Math.max(0, z - 1))}>
              −
            </Button>
            <span className="type-note text-text-mid" aria-live="polite">
              {Math.round(ZOOMS[zoomAt] * 100)}%
            </span>
            <Button size="sm" variant="quiet" aria-label="Zoom in" disabled={zoomAt === ZOOMS.length - 1} onClick={() => setZoomAt((z) => Math.min(ZOOMS.length - 1, z + 1))}>
              +
            </Button>
          </div>

          <div className="pdf-actions">
            <Button size="sm" variant="quiet" aria-expanded={finding} disabled={!doc} onClick={() => setFinding((f) => !f)}>
              Find
            </Button>
            {canShareFiles() && (
              <Button size="sm" variant="quiet" onClick={() => void shareFile(blob, filename).then((o) => announce(o, 'Shared.'))}>
                Share
              </Button>
            )}
            <Button size="sm" variant="quiet" onClick={() => announce(downloadFile(blob, filename), 'Saved to your downloads.')}>
              Save
            </Button>
            <Button size="sm" variant="quiet" onClick={() => announce(printPdf(blob), 'Opening the print dialog.')}>
              Print
            </Button>
          </div>
        </div>

        {finding && (
          <form className="pdf-find" onSubmit={(e) => void search(e)} role="search">
            <input
              type="search"
              className="pdf-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find in this PDF"
              aria-label="Find in this PDF"
              disabled={!doc}
              autoFocus
            />
            <Button type="submit" size="sm" variant="secondary" disabled={!doc || searching || !query.trim()}>
              {searching ? 'Looking' : 'Find'}
            </Button>
          </form>
        )}

        {found && finding && (
          <p className="pdf-found type-note text-text-mid" role="status">
            {found.pages.length === 0 ? (
              `Not found. Scanned pages can’t be searched.`
            ) : (
              <>
                {found.pages.length === 1 ? 'On page' : 'On pages'} {found.pages.join(', ')}. Showing page {found.pages[found.at]}.
                {found.pages.length > 1 && (
                  <>
                    {' '}
                    <button type="button" className="pdf-link" onClick={() => step(-1)}>
                      Previous
                    </button>{' '}
                    <button type="button" className="pdf-link" onClick={() => step(1)}>
                      Next
                    </button>
                  </>
                )}
              </>
            )}
          </p>
        )}
        {say && (
          <p className="pdf-found type-note text-text-mid" role="status">
            {say}
          </p>
        )}
      </div>

      <div className="pdf-scroll" ref={scroller} aria-label="Pages">
        {problem && (
          <p className="px-4 py-6 type-body text-text-mid" role="alert">
            {problem}
          </p>
        )}
        {!problem && !doc && <p className="px-4 py-6 type-note text-text-low">Opening the PDF.</p>}
        {doc &&
          width > 0 &&
          Array.from({ length: pages }, (_, i) => (
            <Page key={i + 1} doc={doc} number={i + 1} width={width} ratio={ratio} />
          ))}
      </div>
    </div>
  );
}

/**
 * Reading a barcode off a camera frame.
 *
 * Two decoders, chosen at runtime, because the platforms genuinely differ.
 *
 * Chrome and Android have BarcodeDetector built in: it is hardware-accelerated,
 * costs zero bytes, and is always the right choice where it exists. Safari has
 * never shipped it and still had not by August 2026, so every iPhone — which
 * is where this app actually lives — needs something else.
 *
 * That something else is a 447 KB WebAssembly build of ZXing, which is more
 * than twice the size of this entire application. It is therefore imported
 * dynamically and never on the path to Today: nothing downloads until someone
 * taps Scan, and after that the service worker has it. An app that must open
 * in under two seconds cannot pay half a megabyte for a feature most launches
 * never touch.
 *
 * Typing the digits stays available throughout. It needs no camera, no
 * permission and no download, and on a bad connection it is the only one of
 * the three that is certain to work.
 */

/** The formats a food package actually carries. Narrower is faster. */
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const;

export type ScanSupport = 'native' | 'wasm' | 'none';

/**
 * What this device can do, without downloading anything to find out.
 *
 * 'wasm' is a promise about capability, not a statement that it is loaded —
 * the binary is fetched on first use.
 */
export function scanSupport(): ScanSupport {
  if (typeof window === 'undefined') return 'none';
  if ('BarcodeDetector' in window) return 'native';
  // Everything that can run WebAssembly can run the fallback, which is every
  // browser this app supports.
  if (typeof WebAssembly === 'object') return 'wasm';
  return 'none';
}

export interface Decoder {
  /** Returns the digits found in a frame, or null. */
  decode(frame: ImageData): Promise<string | null>;
  /** Releases whatever the decoder holds. */
  close(): void;
}

/**
 * Builds a decoder, downloading one only if the platform needs it.
 *
 * Reports which route was taken so the interface can say "getting the scanner
 * ready" the first time rather than appearing to hang on a slow connection.
 */
export async function createDecoder(
  onProgress?: (stage: 'native' | 'downloading' | 'ready') => void,
): Promise<Decoder> {
  if (scanSupport() === 'native') {
    onProgress?.('native');

    // deno-lint-ignore no-explicit-any
    const Detector = (window as any).BarcodeDetector;
    const detector = new Detector({ formats: FORMATS });

    onProgress?.('ready');
    return {
      async decode(frame) {
        // Detected on a bitmap rather than the video element, so the caller
        // controls resolution and this stays testable without a camera.
        const bitmap = await createImageBitmap(frame);
        try {
          const found = await detector.detect(bitmap);
          return found[0]?.rawValue ?? null;
        } finally {
          bitmap.close();
        }
      },
      close() {},
    };
  }

  onProgress?.('downloading');

  // The only place this is imported. Dynamic, so it lands in its own chunk and
  // never touches the initial bundle.
  const { readBarcodes, prepareZXingModule } = await import('zxing-wasm/reader');

  /*
   * Served from our own origin, not the library's CDN.
   *
   * zxing-wasm defaults to fetching its binary from jsDelivr at runtime. That
   * would put a third-party network round trip in the middle of scanning a
   * packet — in a supermarket, on a bad signal, in an app that otherwise works
   * offline and queues its writes. It also means a CDN outage silently breaks
   * a feature that has nothing to do with them.
   *
   * The `?url` import makes Vite emit the binary as a hashed asset alongside
   * everything else, so it is same-origin, cacheable by the service worker,
   * and versioned with the build that expects it.
   */
  const { default: wasmUrl } = await import('zxing-wasm/reader/zxing_reader.wasm?url');
  prepareZXingModule({ overrides: { locateFile: () => wasmUrl } });

  onProgress?.('ready');

  return {
    async decode(frame) {
      const results = await readBarcodes(frame, {
        formats: ['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E'],
        // One is enough: a packet has a single barcode, and stopping at the
        // first keeps the decode inside a frame budget.
        maxNumberOfSymbols: 1,
        // Food barcodes are printed straight on and held straight up. Not
        // trying rotations is a large saving per frame.
        tryRotate: false,
        tryHarder: false,
      });

      const text = results[0]?.text?.trim();
      return text ? text : null;
    },
    close() {},
  };
}

/**
 * A check digit, so a misread is caught before it becomes a lookup.
 *
 * EAN-13 and UPC-A both end in a modulo-10 check digit over the preceding
 * ones. Verifying it locally turns a garbled frame into "keep looking" rather
 * than a confident request for a product that does not exist — and a decoder
 * under motion blur does occasionally return something well-formed and wrong.
 */
export function checkDigitValid(code: string): boolean {
  if (!/^\d{8}$|^\d{12,13}$/.test(code)) return false;

  const digits = code.split('').map(Number);
  const check = digits.pop() as number;

  // Weights alternate 3 and 1 from the rightmost body digit outwards.
  const sum = digits
    .reverse()
    .reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);

  return (10 - (sum % 10)) % 10 === check;
}

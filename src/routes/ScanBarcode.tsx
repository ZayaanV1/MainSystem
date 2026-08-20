import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/Button';
import { checkDigitValid, createDecoder, type Decoder } from '../lib/scanner';

/**
 * Point the camera at a barcode.
 *
 * The scanning loop is deliberately unhurried. Decoding every animation frame
 * would pin a phone's CPU and drain the battery for no gain, because a hand
 * holding a packet does not move meaningfully in 16ms. Roughly seven looks a
 * second finds the code as fast as a person can aim and costs a fraction of
 * the power.
 *
 * A frame is downscaled before decoding. A 1080p frame is four times the
 * pixels of what a barcode needs and four times the work per attempt; the
 * decode is the expensive part, so making it cheaper is what keeps this
 * smooth on an older phone.
 *
 * Nothing is accepted on one sighting. The same digits have to appear twice
 * running AND satisfy their check digit, because a decoder working from a
 * blurred frame occasionally returns something well-formed and wrong, and a
 * confident lookup for a product that does not exist is worse than a moment
 * more of aiming.
 */

/** ~7 attempts a second. Fast enough to feel instant, cheap enough to hold. */
const DECODE_INTERVAL_MS = 140;

/** The width a frame is reduced to before decoding. */
const DECODE_WIDTH = 640;

type Phase = 'starting' | 'downloading' | 'scanning' | 'blocked' | 'failed';

export function ScanBarcode({
  onFound,
  onCancel,
}: {
  onFound: (code: string) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>('starting');
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let decoder: Decoder | null = null;
    let timer: number | undefined;
    let live = true;

    // Two sightings of the same digits before it counts.
    let lastSeen: string | null = null;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    async function start() {
      try {
        // The rear camera, and a resolution request rather than a demand —
        // `ideal` lets a device that cannot manage it give what it has instead
        // of refusing outright.
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch (e) {
        if (!live) return;
        const name = (e as Error).name;
        // A refusal and an absence need different answers: one is a decision
        // the person can revisit, the other is not their fault at all.
        setPhase('blocked');
        setProblem(
          name === 'NotAllowedError'
            ? 'Camera access was declined. Allow it in your browser settings, or type the digits instead.'
            : name === 'NotFoundError'
              ? 'No camera found on this device. Type the digits instead.'
              : 'Could not start the camera. Type the digits instead.',
        );
        return;
      }

      if (!live) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        // iOS refuses to play an inline video without both of these, and
        // fails silently when they are missing.
        video.setAttribute('playsinline', 'true');
        video.muted = true;
        await video.play().catch(() => {});
      }

      try {
        decoder = await createDecoder((stage) => {
          if (!live) return;
          if (stage === 'downloading') setPhase('downloading');
        });
      } catch {
        if (!live) return;
        setPhase('failed');
        setProblem('Could not load the scanner. Type the digits instead.');
        return;
      }

      if (!live) return;
      setPhase('scanning');
      tick();
    }

    function tick() {
      timer = window.setTimeout(async () => {
        if (!live || !decoder || !ctx) return;

        const video = videoRef.current;
        if (video && video.readyState >= 2 && video.videoWidth > 0) {
          const scale = Math.min(1, DECODE_WIDTH / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          try {
            const code = await decoder.decode(
              ctx.getImageData(0, 0, canvas.width, canvas.height),
            );

            if (code && checkDigitValid(code)) {
              if (code === lastSeen) {
                live = false;
                onFound(code);
                return;
              }
              lastSeen = code;
            }
          } catch {
            // A frame that will not decode is the normal case, not an error.
          }
        }

        if (live) tick();
      }, DECODE_INTERVAL_MS);
    }

    void start();

    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      decoder?.close();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onFound]);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative overflow-hidden rounded-card bg-ink-900">
        <video
          ref={videoRef}
          playsInline
          muted
          className="aspect-[4/3] w-full object-cover"
        />

        {/* A window to aim through. Purely a guide — the decoder reads the
            whole frame, because cropping to this box would reject a barcode
            that is perfectly readable just outside it. */}
        {phase === 'scanning' && (
          <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-24 w-4/5 rounded-card border-2 border-text-hi/70" />
          </div>
        )}

        {phase !== 'scanning' && (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
            <p className="type-body text-text-mid">
              {phase === 'starting' && 'Starting the camera…'}
              {phase === 'downloading' && 'Getting the scanner ready. This happens once.'}
              {(phase === 'blocked' || phase === 'failed') && problem}
            </p>
          </div>
        )}
      </div>

      <p className="type-note text-text-low" role="status">
        {phase === 'scanning'
          ? 'Hold the barcode inside the box.'
          : phase === 'downloading'
            ? 'Downloading once, then it works offline.'
            : ''}
      </p>

      <div>
        <Button variant="quiet" onClick={onCancel}>
          Type it instead
        </Button>
      </div>
    </div>
  );
}

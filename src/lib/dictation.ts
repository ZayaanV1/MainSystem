import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Speaking a thought instead of typing it, through the browser's own
 * recogniser (Nov 2026, from NotchOwl's "just say it").
 *
 * The browser's, not a model's: it costs nothing, uses none of the shared AI
 * budget, and needs no new dependency. Chrome, Edge and Safari have it;
 * Firefox does not, and there the button is simply absent rather than a
 * control that explains it does not work (an inert control is worse than
 * none).
 *
 * The words land in the field, never straight in the database. Recognition
 * mishears, and rule 6 says nothing is written that was not on screen first:
 * Enter still sends, exactly as for typed text.
 */

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const dictationSupported = (): boolean => ctor() !== null;

/** What was typed, then what was said, with exactly one space between. */
export function appendSpoken(typed: string, spoken: string): string {
  const said = spoken.trim();
  if (!said) return typed;
  const base = typed.replace(/\s+$/, '');
  return base ? `${base} ${said}` : said;
}

export type DictationError = 'denied' | 'no-speech' | 'failed' | null;

/**
 * Listens once, until a pause. `onText` gets the field's whole new value
 * while words arrive, so what is being heard shows as it is heard.
 */
export function useDictation(value: string, onText: (next: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<DictationError>(null);
  const rec = useRef<Recognition | null>(null);
  // The field as it was when listening began; each result is laid onto it.
  const before = useRef('');
  const latest = useRef(onText);
  latest.current = onText;

  useEffect(() => () => rec.current?.stop(), []);

  const start = useCallback(() => {
    const Ctor = ctor();
    if (!Ctor || rec.current) return;
    const r = new Ctor();
    r.lang = navigator.language || 'en-CA';
    r.interimResults = true;
    r.continuous = false;
    before.current = value;
    setError(null);
    r.onresult = (e) => {
      let said = '';
      for (let i = 0; i < e.results.length; i++) said += e.results[i][0].transcript;
      latest.current(appendSpoken(before.current, said));
    };
    r.onerror = (e) => {
      setError(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'denied' : e.error === 'no-speech' ? 'no-speech' : 'failed');
    };
    r.onend = () => {
      rec.current = null;
      setListening(false);
    };
    rec.current = r;
    setListening(true);
    try {
      r.start();
    } catch {
      rec.current = null;
      setListening(false);
      setError('failed');
    }
  }, [value]);

  const stop = useCallback(() => rec.current?.stop(), []);

  return { supported: dictationSupported(), listening, error, start, stop };
}

/** The sentence for each failure: what happened and what to do. */
export function dictationMessage(error: DictationError): string | null {
  switch (error) {
    case 'denied':
      return 'Microphone access is off for this site. Allow it in the browser, or type instead.';
    case 'no-speech':
      return 'Nothing was heard. Try again, or type it.';
    case 'failed':
      return 'Speech did not work this time. Type it instead.';
    default:
      return null;
  }
}

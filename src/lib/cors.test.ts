import { describe, it, expect } from 'vitest';
import { corsFor } from '../../supabase/functions/_shared/cors';

const APP = 'https://planner.example.app';
const from = (origin?: string) => new Request('https://x.test/fn', { headers: origin ? { Origin: origin } : {} });

describe('corsFor', () => {
  it.each([
    APP,
    'https://my-branch-abc123.vercel.app',
    'http://localhost:5173',
    'http://127.0.0.1:5199',
    'capacitor://localhost',
  ])('lets %s call the function', (origin) => {
    expect(corsFor(from(origin), APP)['Access-Control-Allow-Origin']).toBe(origin);
  });

  it.each(['https://evil.example', 'https://vercel.app.evil.example', 'http://localhost.evil.example', 'null'])(
    'answers %s with the app’s own address, so its browser refuses',
    (origin) => {
      expect(corsFor(from(origin), APP)['Access-Control-Allow-Origin']).toBe(APP);
    },
  );

  it('says the same to a caller with no origin at all', () => {
    expect(corsFor(from(), APP)['Access-Control-Allow-Origin']).toBe(APP);
  });

  it('adds only the extra headers it is given', () => {
    expect(corsFor(from(APP), APP)['Access-Control-Allow-Headers']).toBe('authorization, apikey, content-type');
    expect(corsFor(from(APP), APP, 'x-cron-secret')['Access-Control-Allow-Headers']).toBe(
      'authorization, apikey, content-type, x-cron-secret',
    );
  });

  it('varies on origin, so a cache never hands one site another’s answer', () => {
    expect(corsFor(from(APP), APP).Vary).toBe('Origin');
  });
});

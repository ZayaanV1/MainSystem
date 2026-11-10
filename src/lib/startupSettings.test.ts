import { describe, it, expect, vi } from 'vitest';

const sent = vi.fn();
vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        // Like the real builder: every await sends the request again.
        limit: () => ({ then: (ok: (v: unknown) => void) => (sent(), ok({ data: [{}], error: null })) }),
      }),
    }),
  },
}));

describe('startupSettings', () => {
  it('sends one request for callers that ask together', async () => {
    const { startupSettings } = await import('./startupSettings');
    await Promise.all([startupSettings(), startupSettings(), startupSettings()]);
    await startupSettings();
    expect(sent).toHaveBeenCalledTimes(1);
  });
});

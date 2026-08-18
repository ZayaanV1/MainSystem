import { useCallback, useEffect, useState } from 'react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { useAuth } from '../lib/auth';
import { exportCsv, exportJson } from '../lib/export';
import { fetchDeliveryLog, type DeliveryRow } from '../lib/health';
import { pushStatus, subscribeToPush, type PushStatus } from '../lib/notifications';
import { subscribeSw, type SwState } from '../lib/sw';
import { supabase } from '../lib/supabase';
import { formatDay, formatTime, localDayKey } from '../lib/time';

/**
 * Settings.
 *
 * In Phase 0 this is mostly the proof surface: is the notification pipeline
 * alive, and can I get my data out. Both questions have to be answerable
 * without opening a database console.
 */

const PUSH_COPY: Record<PushStatus, string> = {
  unsupported: 'This browser cannot receive push notifications.',
  'needs-install': 'Add the app to your home screen first. iOS requires it for push.',
  'needs-permission': 'Push is not enabled on this device.',
  denied: 'Notifications are blocked. Change this in iOS Settings, then reload.',
  'no-service-worker':
    'The service worker has not started, so push cannot be set up. Close the app fully and reopen it.',
  'device-only':
    'This device is subscribed, but the server has no record of it — so nothing would be delivered. Register it again.',
  subscribed: 'Push is enabled, and the server knows about this device.',
};

export function Settings({ onBack }: { onBack: () => void }) {
  const { signOut } = useAuth();

  const [log, setLog] = useState<DeliveryRow[]>([]);
  const [push, setPush] = useState<PushStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sw, setSw] = useState<SwState>({ status: 'registering' });

  useEffect(() => subscribeSw(setSw), []);

  const reload = useCallback(async () => {
    const [rows, status] = await Promise.all([fetchDeliveryLog(), pushStatus()]);
    setLog(rows);
    setPush(status);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function sendTest() {
    setTesting(true);
    setMessage(null);

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Not signed in.');

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dispatch`, {
        method: 'POST',
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      const body = await res.json();

      setMessage(
        res.ok && body.delivered
          ? `Sent via ${body.channel}. Check your phone.`
          : `Couldn't send. ${body.errors?.join('; ') ?? `HTTP ${res.status}`}`,
      );
    } catch (e) {
      // Safari reports every blocked or failed request as "Load failed", which
      // tells you nothing. The overwhelmingly likely cause is that the server
      // does not recognise this origin, so say that instead of repeating it.
      const raw = (e as Error).message;
      setMessage(
        /load failed|failed to fetch|networkerror/i.test(raw)
          ? "Couldn't reach the server. If the app's address changed, run npm run set:url with the new one."
          : `Couldn't send. ${raw}`,
      );
    } finally {
      setTesting(false);
      void reload();
    }
  }

  async function enablePush() {
    setMessage(null);
    const result = await subscribeToPush();
    setMessage(result.ok ? 'Push enabled on this device.' : `Couldn't enable push. ${result.error}`);
    void reload();
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-160 flex-col px-4 pt-6">
      <header className="mb-6 flex items-baseline justify-between gap-4 px-4">
        <h1 className="type-h1 text-text-hi">Settings</h1>
        <button type="button" onClick={onBack} className="type-label text-text-mid">
          Today
        </button>
      </header>

      <section className="mb-8">
        <h2 className="type-h2 mb-3 px-4 text-text-hi">Notifications</h2>

        <Card className="p-4">
          <p className="type-body text-text-mid">{push ? PUSH_COPY[push] : 'Checking.'}</p>

          {/* The registration result, stated outright. This failed silently
              for two days: no registration, no error, and a status line
              confidently reporting success. */}
          {sw.status === 'failed' && (
            <p className="mt-2 type-caption text-t-overdue">
              Service worker did not register: {sw.error}
            </p>
          )}
          {sw.status === 'unsupported' && (
            <p className="mt-2 type-caption text-text-low">
              This browser has no service worker support.
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            <Button variant="primary" onClick={sendTest} disabled={testing}>
              {testing ? 'Sending' : 'Send test notification'}
            </Button>

            {/* Offered for every state a tap can actually fix. Hiding it when
                the browser claimed success is what let a half-registered
                device sit there looking fine. */}
            {(push === 'needs-permission' ||
              push === 'device-only' ||
              push === 'no-service-worker') && (
              <Button onClick={enablePush}>
                {push === 'device-only' ? 'Register this device' : 'Enable push here'}
              </Button>
            )}
          </div>

          {message && <p className="type-caption mt-4 text-text-mid">{message}</p>}
        </Card>
      </section>

      <section className="mb-8">
        <h2 className="type-h2 mb-3 px-4 text-text-hi">Delivery log</h2>

        {log.length === 0 ? (
          <EmptyState>No delivery attempts recorded yet.</EmptyState>
        ) : (
          <Card>
            {log.map((row) => (
              <div
                key={row.id}
                className="flex items-baseline gap-3 border-b border-ink-600 px-4 py-3 last:border-b-0"
              >
                <span
                  aria-hidden
                  className={[
                    'h-2 w-2 shrink-0 rounded-pill',
                    row.status === 'sent'
                      ? 'bg-t-done'
                      : row.status === 'failed'
                        ? 'bg-t-overdue'
                        : 'bg-text-low',
                  ].join(' ')}
                />

                <div className="flex-1">
                  {/* Status is written as well as coloured — colour is never
                      the only signal, including here. */}
                  <div className="type-label text-text-hi">
                    {row.status} &middot; {row.kind}
                    {row.channel ? ` · ${row.channel}` : ''}
                  </div>
                  {row.error && <div className="type-caption text-text-mid">{row.error}</div>}
                </div>

                <span className="type-caption shrink-0 text-text-low">
                  {formatDay(localDayKey(new Date(row.created_at)))}{' '}
                  {formatTime(new Date(row.created_at))}
                </span>
              </div>
            ))}
          </Card>
        )}
      </section>

      <section className="mb-8">
        <h2 className="type-h2 mb-3 px-4 text-text-hi">Your data</h2>
        <Card className="p-4">
          <p className="type-body mb-4 text-text-mid">
            Everything this app holds, in one file. You can leave whenever you want.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => void exportJson()}>Export JSON</Button>
            <Button onClick={() => void exportCsv()}>Export CSV</Button>
          </div>
        </Card>
      </section>

      <section className="mb-12">
        <Button variant="quiet" onClick={() => void signOut()}>
          Sign out
        </Button>
      </section>
    </main>
  );
}

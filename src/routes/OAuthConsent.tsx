import { useEffect, useState } from 'react';
import { Button } from '../components/Button';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

/**
 * Where an AI app asks to use the planner (Nov 2026; functions/mcp).
 *
 * Supabase Auth's OAuth server sends the browser here with an
 * authorization_id. The page says plainly who is asking and what they will
 * be able to do, including what they will not, and the account allows or
 * refuses. Either way the browser goes back to the app that asked.
 *
 * Reached only by that redirect, so it is outside the shell: no tab bar, no
 * onboarding, no Today underneath. A signed-out visitor sees the sign-in
 * screen first (App.tsx) and lands back here after it.
 */

type State =
  | { kind: 'loading' }
  | { kind: 'ask'; id: string; app: string; uri: string | null }
  | { kind: 'leaving' }
  | { kind: 'failed'; message: string };

const CAN = [
  'See your work, schedule, courses and inbox',
  'Add work, events and thoughts to your inbox',
  'Mark work done and move due dates',
];

const CANNOT = ['Delete anything', 'Read your conversations with Abood or what it remembers'];

export function OAuthConsent() {
  const { session } = useAuth();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const id = new URLSearchParams(location.search).get('authorization_id');

  useEffect(() => {
    if (!id) {
      setState({ kind: 'failed', message: 'This link is missing its request. Start connecting again from the app that sent you here.' });
      return;
    }
    let live = true;
    void supabase.auth.oauth.getAuthorizationDetails(id).then(({ data, error }) => {
      if (!live) return;
      if (error || !data) {
        setState({ kind: 'failed', message: `${error?.message ?? 'The request could not be read'}. Start connecting again from the app that sent you here.` });
      } else if ('authorization_id' in data) {
        setState({ kind: 'ask', id: data.authorization_id, app: data.client.name || 'An app', uri: hostOf(data.redirect_uri) });
      } else {
        // Already allowed once: straight back.
        setState({ kind: 'leaving' });
        location.href = data.redirect_url;
      }
    });
    return () => {
      live = false;
    };
  }, [id]);

  async function decide(allow: boolean) {
    if (state.kind !== 'ask') return;
    setBusy(true);
    const { data, error } = allow
      ? await supabase.auth.oauth.approveAuthorization(state.id, { skipBrowserRedirect: true })
      : await supabase.auth.oauth.denyAuthorization(state.id, { skipBrowserRedirect: true });
    if (error || !data) {
      setBusy(false);
      setState({ kind: 'failed', message: `${error?.message ?? 'That did not go through'}. Try again from the app that sent you here.` });
      return;
    }
    setState({ kind: 'leaving' });
    location.href = data.redirect_url;
  }

  return (
    <main className="signin">
      <div className="signin-brand">
        <h1 className="signin-word">{state.kind === 'ask' ? `Connect ${state.app}` : 'Connect an app'}</h1>
        {state.kind === 'ask' && (
          <p className="signin-line">
            {state.app} is asking to use your planner{state.uri ? `, and will return to ${state.uri}` : ''}.
          </p>
        )}
      </div>

      <div className="mat mat-raised signin-card" aria-live="polite">
        {state.kind === 'loading' && <p className="type-note text-text-mid">Reading the request</p>}
        {state.kind === 'leaving' && <p className="type-note text-text-mid">Going back to the app</p>}
        {state.kind === 'failed' && <p className="type-note text-text-hi">{state.message}</p>}
        {state.kind === 'ask' && (
          <>
            <h2 className="type-label">It will be able to</h2>
            <ul className="consent-list">
              {CAN.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <h2 className="type-label mt-4">It will not be able to</h2>
            <ul className="consent-list">
              {CANNOT.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <p className="type-note mt-4 text-text-mid">
              Its changes save right away. Each one can be undone, and the app disconnected, in Settings under Connected apps.
            </p>
            <p className="type-note mt-2 text-text-mid">Signed in as {session?.user.email}.</p>
            <div className="mt-5 flex gap-2">
              <Button variant="quiet" full disabled={busy} onClick={() => void decide(false)}>
                Don’t allow
              </Button>
              <Button variant="primary" full disabled={busy} onClick={() => void decide(true)}>
                Allow
              </Button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function hostOf(uri: string | undefined): string | null {
  try {
    return uri ? new URL(uri).host : null;
  } catch {
    return null;
  }
}

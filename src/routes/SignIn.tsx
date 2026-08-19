import { useState, type FormEvent } from 'react';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { useAuth } from '../lib/auth';

/**
 * Sign in, or start.
 *
 * One screen with a mode rather than two screens and a link between them. The
 * fields are identical, and moving someone to a second page to type the same
 * two things is friction bought for nothing.
 *
 * The error is whatever the server said, shown plainly. It does not apologise
 * and it does not translate a real cause into a friendly non-answer.
 */

type Mode = 'in' | 'up';

/**
 * Supabase's own floor. Checked here so the failure arrives while the cursor
 * is still in the box, rather than after a round trip.
 */
const MIN_PASSWORD = 6;

export function SignIn() {
  const { signIn, signUp } = useAuth();

  const [mode, setMode] = useState<Mode>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;

    setError(null);

    if (mode === 'up' && password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }

    setBusy(true);

    if (mode === 'in') {
      const result = await signIn(email, password);
      setBusy(false);
      if (result.error) setError(result.error);
      return;
    }

    const result = await signUp(email, password);
    setBusy(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    // Reported rather than hidden. Being told to check an inbox for an account
    // you already have would leave you waiting for an email that never comes.
    if (result.alreadyExists) {
      setError('That address already has an account. Sign in instead.');
      setMode('in');
      return;
    }

    if (result.confirmationSent) setSentTo(email);
  }

  if (sentTo) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-100 flex-col justify-center px-6">
        <h1 className="type-h1 mb-2 text-text-hi">Check your email</h1>
        <p className="type-body mb-6 text-text-mid">
          A confirmation link is on its way to {sentTo}. Open it and you are in.
        </p>
        <div>
          <Button
            variant="quiet"
            onClick={() => {
              setSentTo(null);
              setMode('in');
            }}
          >
            Back to sign in
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-100 flex-col justify-center px-6">
      <h1 className="type-h1 mb-2 text-text-hi">
        {mode === 'in' ? 'Planner' : 'Start a planner'}
      </h1>
      <p className="type-body mb-8 text-text-mid">
        {mode === 'in'
          ? 'Sign in to continue.'
          : 'Your work, your deadlines and your day, in one place.'}
      </p>

      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Field
          label="Password"
          type="password"
          // Tells a password manager which of the two this is, so it offers to
          // save a new one rather than autofilling an old one over the top.
          autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          hint={mode === 'up' ? `At least ${MIN_PASSWORD} characters.` : undefined}
          error={error}
        />

        <Button type="submit" variant="primary" full disabled={busy}>
          {busy ? 'Working' : mode === 'in' ? 'Sign in' : 'Create account'}
        </Button>
      </form>

      <div className="mt-6">
        <Button
          variant="quiet"
          onClick={() => {
            setMode(mode === 'in' ? 'up' : 'in');
            setError(null);
          }}
        >
          {mode === 'in' ? 'No account? Start one' : 'Already have an account? Sign in'}
        </Button>
      </div>
    </main>
  );
}

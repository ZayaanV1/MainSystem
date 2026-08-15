import { useState, type FormEvent } from 'react';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { useAuth } from '../lib/auth';

/**
 * Sign in.
 *
 * One account, so there is no sign-up link and no password reset flow to get
 * lost in — the account is created by setup, already confirmed. Sessions are
 * long-lived, so this screen should be seen roughly once per device.
 *
 * The error is whatever the server said, shown plainly. It does not apologise
 * and it does not say "oops".
 */
export function SignIn() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const result = await signIn(email, password);

    if (result.error) setError(result.error);
    setBusy(false);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-100 flex-col justify-center px-6">
      <h1 className="type-h1 mb-2 text-text-hi">Planner</h1>
      <p className="type-body mb-8 text-text-mid">Sign in to continue.</p>

      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        <Field
          label="Email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={error}
        />

        <Button type="submit" variant="primary" full disabled={busy}>
          {busy ? 'Signing in' : 'Sign in'}
        </Button>
      </form>
    </main>
  );
}

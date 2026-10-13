import { useState, type CSSProperties, type FormEvent } from 'react';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Segmented } from '../components/Segmented';
import { Sheet, SheetPresence } from '../components/Sheet';
import { useAuth } from '../lib/auth';

/**
 * Sign in, or start.
 *
 * The first screen anyone sees, so it says what the app is before a word is
 * read: three tickets in the app's own language, drifting. The form sits low,
 * in one card, where a phone held in one hand reaches every field.
 *
 * One screen with a switch rather than two screens and a link between them.
 * The fields are identical, and moving someone to a second page to type the
 * same two things is friction bought for nothing.
 *
 * The error is whatever the server said, shown plainly. It does not apologise
 * and it does not translate a real cause into a friendly non-answer.
 */

type Mode = 'in' | 'up';

const MODES = [
  { value: 'in', label: 'Sign in' },
  { value: 'up', label: 'New account' },
] as const;

/**
 * Supabase's own floor. Checked here so the failure arrives while the cursor
 * is still in the box, rather than after a round trip.
 */
const MIN_PASSWORD = 6;

export function SignIn() {
  const { signIn, signUp, linkError, dismissLinkError } = useAuth();

  const [mode, setMode] = useState<Mode>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  // Opened straight away when an expired reset link brought them here.
  const [resetting, setResetting] = useState(Boolean(linkError));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;

    setError(null);
    setEmailError(null);

    // Said here rather than by a greyed-out button, which gives no reason.
    if (!email.trim()) {
      setEmailError('Enter your email address.');
      return;
    }
    if (!password) {
      setError('Enter your password.');
      return;
    }

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
      <main className="signin">
        <Tickets />
        <div className="signin-brand">
          <h1 className="signin-word">Check your email</h1>
          <p className="signin-line">A confirmation link is on its way to {sentTo}. Open it on this device and you are in.</p>
        </div>
        <div className="mat mat-raised signin-card">
          <Button
            variant="quiet"
            full
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
    <main className="signin">
      <Tickets />

      <div className="signin-brand">
        <h1 className="signin-word">Planner</h1>
        <p className="signin-line">Your term, in order.</p>
      </div>

      <form onSubmit={onSubmit} className="mat mat-raised signin-card" noValidate>
        <Segmented
          label="Sign in or start"
          options={MODES}
          value={mode}
          fill
          onChange={(m) => {
            setMode(m);
            setError(null);
            setEmailError(null);
          }}
        />
        <Field
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@school.edu"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={emailError}
          required
        />
        <PasswordField
          // Tells a password manager which of the two this is, so it offers to
          // save a new one rather than autofilling an old one over the top.
          autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
          value={password}
          onChange={setPassword}
          hint={mode === 'up' ? `At least ${MIN_PASSWORD} characters.` : undefined}
          error={error}
        />

        <Button type="submit" variant="primary" full disabled={busy}>
          {busy ? 'Working' : mode === 'in' ? 'Sign in' : 'Create account'}
        </Button>
        {mode === 'in' && (
          <button type="button" className="signin-forgot" onClick={() => setResetting(true)}>
            Forgot your password?
          </button>
        )}
      </form>

      <SheetPresence>
        {resetting && (
          <ResetSheet
            initialEmail={email}
            linkError={linkError}
            onClose={() => {
              setResetting(false);
              dismissLinkError();
            }}
          />
        )}
      </SheetPresence>
    </main>
  );
}

/** A password well with Show, because typing one blind on a phone is the commonest failure. */
function PasswordField({
  label = 'Password',
  autoComplete,
  value,
  onChange,
  hint,
  error,
}: {
  label?: string;
  autoComplete: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  error?: string | null;
}) {
  const [shown, setShown] = useState(false);
  return (
    <Field
      label={label}
      type={shown ? 'text' : 'password'}
      autoComplete={autoComplete}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required
      hint={hint}
      error={error}
      trailing={
        <button
          type="button"
          className="signin-show"
          aria-pressed={shown}
          aria-label={shown ? 'Hide password' : 'Show password'}
          onClick={() => setShown((s) => !s)}
        >
          {shown ? 'Hide' : 'Show'}
        </button>
      }
    />
  );
}

function ResetSheet({
  initialEmail,
  linkError,
  onClose,
}: {
  initialEmail: string;
  linkError: string | null;
  onClose: () => void;
}) {
  const { requestReset } = useAuth();
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!email.trim()) {
      setError('Enter the address the account uses.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await requestReset(email);
    setBusy(false);
    if (result.error) setError(result.error);
    else setSent(email.trim());
  }

  return (
    <Sheet open title="Reset your password" onClose={onClose}>
      {sent ? (
        <div className="flex flex-col gap-4">
          <p className="type-body text-text-mid">
            If {sent} has an account, a link is on its way. Open it on this device and it brings you straight to a new password.
          </p>
          <Button variant="primary" full onClick={onClose}>
            Done
          </Button>
        </div>
      ) : (
        <form onSubmit={send} className="flex flex-col gap-4" noValidate>
          {linkError && <p className="type-note text-t-overdue">{linkError}</p>}
          <p className="type-body text-text-mid">An email with a link to set a new one. The link works once, for an hour.</p>
          <Field
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@school.edu"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={error}
          />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'Sending' : 'Send the link'}
            </Button>
            <Button variant="quiet" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Sheet>
  );
}

/**
 * Opened from a reset email: already signed in by the link, and asked for
 * the new password before anything else. Nothing behind it renders until
 * this is done or abandoned, because "signed in without knowing your
 * password" is a state worth leaving quickly.
 */
export function NewPassword() {
  const { setNewPassword, signOut, session } = useAuth();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await setNewPassword(password);
    setBusy(false);
    if (result.error) setError(result.error);
  }

  return (
    <main className="signin">
      <Tickets />
      <div className="signin-brand">
        <h1 className="signin-word">New password</h1>
        <p className="signin-line">For {session?.user.email ?? 'your account'}. Choose one and you are back in.</p>
      </div>
      <form onSubmit={save} className="mat mat-raised signin-card" noValidate>
        <PasswordField
          label="New password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          hint={`At least ${MIN_PASSWORD} characters.`}
          error={error}
        />
        <Button type="submit" variant="primary" full disabled={busy}>
          {busy ? 'Saving' : 'Save and open the planner'}
        </Button>
        <button type="button" className="signin-forgot" onClick={() => void signOut()}>
          Not now, sign out
        </button>
      </form>
    </main>
  );
}

/**
 * Three tickets, drifting: the app's own slips in miniature, so the screen
 * says what this is before the words do. Decorative, and hidden from screen
 * readers, which get the heading instead.
 */
export function Tickets() {
  const tickets: { n: string; u: string; title: string; meta: string; tone: string; c: number }[] = [
    { n: '11:59', u: 'p.m.', title: 'Lab 3 report', meta: 'COEN 212 · 5%', tone: '--t-critical', c: 1 },
    { n: '3', u: 'days', title: 'Problem set 4', meta: 'PHYS 205 · Wed', tone: '--t-urgent', c: 5 },
    { n: '9', u: 'days', title: 'Midterm', meta: 'COEN 231 · exam', tone: '--t-approaching', c: 3 },
  ];
  return (
    <div className="signin-hero" aria-hidden>
      {tickets.map((t, i) => (
        <div
          key={t.title}
          className={`mat signin-tk signin-tk-${i + 1}`}
          data-block
          style={{ '--b': `var(--c-${t.c}-rgb)` } as CSSProperties}
        >
          <span className="signin-stub" style={{ color: `var(${t.tone})` }}>
            <b>{t.n}</b>
            <i>{t.u}</i>
          </span>
          <span className="signin-tk-body">
            <b>{t.title}</b>
            <i>{t.meta}</i>
          </span>
          <span className="signin-ring" />
        </div>
      ))}
    </div>
  );
}

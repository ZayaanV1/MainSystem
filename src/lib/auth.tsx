import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { clearCache } from './readcache';
import { readAuthLink } from './authLink';

/**
 * Auth.
 *
 * Email and password. A forgotten password is reset by an emailed link,
 * which is rare enough for Supabase's built-in email. Not magic links: Supabase's built-in SMTP
 * is rate-limited to a handful of messages an hour, and being locked out of
 * your own planner because you signed in twice is precisely the kind of
 * friction this app cannot afford.
 *
 * `loading` starts true and is what stops the sign-in screen flashing on every
 * launch before the stored session is read back.
 */

interface AuthState {
  session: Session | null;
  loading: boolean;
  /**
   * Opened from a password-reset email: signed in by the link, and owed a
   * new password before anything else.
   */
  recovering: boolean;
  /** An email link that could not be used (expired, or used already). */
  linkError: string | null;
  signIn(email: string, password: string): Promise<{ error: string | null }>;
  requestReset(email: string): Promise<{ error: string | null }>;
  setNewPassword(password: string): Promise<{ error: string | null }>;
  dismissLinkError(): void;
  signUp(
    email: string,
    password: string,
  ): Promise<{ error: string | null; confirmationSent: boolean; alreadyExists: boolean }>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const start = async () => {
      // A link from an email (reset, or confirming a new account) signs in
      // here. The fragment is cleared first, so a reload or a shared
      // screenshot never carries the token.
      const link = readAuthLink(window.location.hash);
      if (link) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        if (link.tokens) {
          const { error } = await supabase.auth.setSession(link.tokens);
          if (error) setLinkError('That link has expired. Ask for a new one below.');
          else if (link.type === 'recovery') setRecovering(true);
        } else if (link.error) {
          setLinkError(/expired|invalid/i.test(link.error) ? 'That link has expired. Ask for a new one below.' : link.error);
        }
      }
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    };
    void start();

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      if (event === 'SIGNED_OUT') setRecovering(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    // Surfaced verbatim to the user, so the message says what happened rather
    // than apologising for it.
    return { error: error ? error.message : null };
  }, []);

  /**
   * Creates an account.
   *
   * The project requires email confirmation, so a successful call does NOT
   * produce a session — it produces an email. That distinction is returned
   * rather than hidden, because a form that appears to succeed and then leaves
   * you on the sign-in screen reads as a bug.
   *
   * Supabase deliberately does not say whether an address is already
   * registered, to avoid turning signup into a way to enumerate users. It
   * returns a normal-looking result with an empty identities array instead.
   * That is detected here and reported honestly as "this address already has
   * an account" — the person typing it is the one who owns it, and telling
   * them to check their email for an account they already have would strand
   * them.
   */
  const signUp = useCallback(async (email: string, password: string) => {
    // The confirmation link returns here, signed in. Without an explicit
    // address Supabase uses the project's Site URL, which still pointed at a
    // development port nobody runs, so every confirmation link went nowhere.
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/` },
    });

    if (error) return { error: error.message, confirmationSent: false, alreadyExists: false };

    const alreadyExists = (data.user?.identities?.length ?? 0) === 0;

    return {
      error: null,
      alreadyExists,
      // A session here means confirmation is switched off and they are in.
      confirmationSent: !alreadyExists && !data.session,
    };
  }, []);

  /**
   * Emails a link that opens the app signed in, straight to a new-password
   * screen. The address it returns to must be on the project's redirect
   * list, or Supabase sends people to the Site URL instead.
   *
   * Supabase answers the same whether or not the address has an account,
   * so nobody can use this to find out who does.
   */
  const requestReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/`,
    });
    if (!error) return { error: null };
    return {
      error: /rate limit|too many|seconds/i.test(error.message)
        ? 'Too many emails for now. Wait a few minutes and send it again.'
        : error.message,
    };
  }, []);

  const setNewPassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { error: error.message };
    setRecovering(false);
    return { error: null };
  }, []);

  const dismissLinkError = useCallback(() => setLinkError(null), []);

  const signOut = useCallback(async () => {
    /*
     * The read cache is dropped BEFORE the session ends, not after.
     *
     * A cache that outlived its session would show one account's day to
     * whoever signed in next on the same device — a data-crossing bug wearing
     * the costume of a performance feature, and exactly the kind that survives
     * review because the feature it hides inside is benign.
     *
     * Awaited, and first: signing out then clearing would leave a window where
     * a fast second sign-in reads the previous account's day.
     */
    await clearCache();
    await supabase.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({
      session,
      loading,
      recovering,
      linkError,
      signIn,
      signUp,
      signOut,
      requestReset,
      setNewPassword,
      dismissLinkError,
    }),
    [session, loading, recovering, linkError, signIn, signUp, signOut, requestReset, setNewPassword, dismissLinkError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

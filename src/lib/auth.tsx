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

/**
 * Auth.
 *
 * Email and password, one account. Not magic links: Supabase's built-in SMTP
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
  signIn(email: string, password: string): Promise<{ error: string | null }>;
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

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
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
    const { data, error } = await supabase.auth.signUp({ email, password });

    if (error) return { error: error.message, confirmationSent: false, alreadyExists: false };

    const alreadyExists = (data.user?.identities?.length ?? 0) === 0;

    return {
      error: null,
      alreadyExists,
      // A session here means confirmation is switched off and they are in.
      confirmationSent: !alreadyExists && !data.session,
    };
  }, []);

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
    () => ({ session, loading, signIn, signUp, signOut }),
    [session, loading, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

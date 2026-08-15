/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/**
 * Both values below are public by design and ship in the browser bundle. The
 * anon key grants access to nothing on its own — row level security is what
 * protects the data. The service role key is never referenced here, and must
 * never be.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_VAPID_PUBLIC_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

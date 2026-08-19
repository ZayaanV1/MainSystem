import { supabase } from './supabase';

/**
 * Web Push subscription management, client side.
 *
 * iOS has three constraints that shape everything here, and getting any of
 * them wrong produces a silent failure rather than an error:
 *
 *   1. Web Push only works in a PWA installed to the home screen. In a Safari
 *      tab there is no permission to grant, so the button must explain that
 *      rather than appearing broken.
 *   2. Permission must be requested from a real user gesture. Asking on load
 *      is silently ignored.
 *   3. Subscriptions rot. iOS invalidates them when it offloads the app, on
 *      some OS updates, and when the home screen icon is removed and re-added.
 *      Nothing tells you; the digest simply stops arriving. So the app
 *      re-subscribes on every launch and upserts, and the server deletes
 *      endpoints that come back 404 or 410.
 *
 * This is why Telegram proves the pipeline first. If Web Push fails its soak,
 * everything above is why, and the digest still arrives.
 */

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export type PushStatus =
  | 'unsupported'
  | 'needs-install'
  | 'needs-permission'
  | 'denied'
  | 'no-service-worker'
  /** The browser has a subscription the server has never been told about. */
  | 'device-only'
  | 'subscribed';

/** True when running as an installed PWA rather than in a browser tab. */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Safari's non-standard flag, still the only reliable signal on iOS.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/**
 * Is this device actually going to receive a digest?
 *
 * The browser's own answer is not sufficient, and assuming it was hid a real
 * failure: iOS had created a subscription, so the app reported "push is
 * enabled", while the server held no row and could send nothing. The only fact
 * that decides whether a notification arrives is whether the SERVER knows this
 * endpoint — so that is what gets checked.
 */
export async function pushStatus(): Promise<PushStatus> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  if (!isStandalone()) return 'needs-install';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'needs-permission';

  const reg = await serviceWorkerReady();
  if (!reg) return 'no-service-worker';

  const sub = await reg.pushManager.getSubscription();
  if (!sub) return 'needs-permission';

  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id')
    .eq('endpoint', sub.endpoint)
    .limit(1);

  // A failed lookup is not proof of absence, so it does not claim the device
  // is unregistered — but it must not claim success either.
  if (error) return 'device-only';

  return (data?.length ?? 0) > 0 ? 'subscribed' : 'device-only';
}

/**
 * How long to wait for the service worker before giving up on it.
 *
 * `navigator.serviceWorker.ready` does not reject — if registration never
 * completes it simply waits forever. Awaiting it directly meant tapping
 * "Enable push" could do nothing at all: no subscription, no error, no
 * message, and every reason to assume it had worked. Same failure shape as the
 * IndexedDB hang, and just as invisible.
 */
const SW_READY_TIMEOUT_MS = 8000;

async function serviceWorkerReady(): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), SW_READY_TIMEOUT_MS)),
  ]);
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = base64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((base64.length + 3) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Subscribes this device and stores the endpoint. Must be called from a user
 * gesture the first time, because that is when the permission prompt appears.
 */
export async function subscribeToPush(): Promise<{ ok: boolean; error?: string }> {
  if (!VAPID_PUBLIC_KEY) {
    // The user cannot fix a missing server key, so it does not ask them to.
    // It says what is true and stops.
    return { ok: false, error: 'Push notifications are not available yet.' };
  }
  if (!isStandalone()) {
    return { ok: false, error: 'Add the app to your home screen first. iOS requires it.' };
  }

  try {
    // Only ask when it has not already been answered. Calling this outside a
    // user gesture — which is what the launch-time refresh is — can be ignored
    // or throw on iOS.
    const permission =
      Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();

    if (permission !== 'granted') {
      return { ok: false, error: 'Notifications are blocked. Change this in iOS Settings.' };
    }

    const reg = await serviceWorkerReady();
    if (!reg) {
      return {
        ok: false,
        error: 'The service worker never started. Close the app fully and reopen it.',
      };
    }

    // Reuse the existing subscription when there is one; iOS hands back the
    // same endpoint and re-subscribing needlessly would churn the row.
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true, // Apple revokes subscriptions that push silently.
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      }));

    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh: string; auth: string } };
    if (!json.endpoint || !json.keys) {
      return { ok: false, error: 'The browser returned an incomplete subscription.' };
    }

    const { data: user } = await supabase.auth.getUser();
    if (!user?.user) return { ok: false, error: 'Not signed in.' };

    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: user.user.id,
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        user_agent: navigator.userAgent.slice(0, 200),
      },
      { onConflict: 'user_id,endpoint' },
    );

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Called on every launch. Cheap, and the only defence against a subscription
 * that iOS invalidated while the app was closed — which produces no error and
 * no symptom other than the digest quietly not arriving.
 */
export async function refreshSubscription(): Promise<void> {
  if (!isStandalone() || Notification.permission !== 'granted') return;
  await subscribeToPush();
}

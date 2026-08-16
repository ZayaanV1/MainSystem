# Setup

Twenty minutes, most of it waiting for Supabase to provision. You need three
accounts and one bot. Nothing here costs money, now or later.

---

## 1. Create the accounts

**Supabase** — <https://supabase.com/dashboard>. New project, region
`us-east-1` (closest to Montréal). Choose a database password and put it in
your password manager immediately; you need it in step 2 and resetting it is
annoying. Provisioning takes a couple of minutes.

**Telegram bot** — open Telegram, message
[@BotFather](https://t.me/BotFather), send `/newbot`, follow the two prompts.
It replies with a token like `1234567890:AAExample-TokenString`.

Then **send your new bot a message**. Anything — "hi" is fine. Setup finds
your chat ID from that message, and there is nothing to find until you do.

**GitHub** — an empty private repo. You need this for Vercel in step 4.

---

## 2. Fill in one file

```bash
cp .env.setup.example .env.setup
```

Open `.env.setup`. It asks for eight values and tells you where each one
lives in the Supabase dashboard. The two that people hunt for:

- **Project ref** — the subdomain in your dashboard URL,
  `https://supabase.com/dashboard/project/`**`abcdefghijklmnop`**
- **Access token** — <https://supabase.com/dashboard/account/tokens>, create
  one. This is what lets setup run without an interactive browser login.

`.env.setup` is gitignored and never committed.

You do **not** need to generate VAPID keys or a cron secret. Setup makes those
and stores them in `.env.generated`, also gitignored.

---

## 3. Run it

```bash
npm run setup
```

That single command links the project, applies both migrations, generates the
Web Push keypair and cron secret, deploys the edge function, creates your
account already confirmed so there is no verification email, finds your
Telegram chat, wires the 15-minute schedule, and writes `.env.local` for the
app.

It is safe to re-run. Keys are reused once generated, the account is created
only if absent, and the channel row is upserted. If it stops, it tells you
exactly which value is wrong and everything before that point stays done.

The scheduled run it performs at the end will almost certainly report
`too-early`. **That is correct.** It proves the cron path executes and the
digest logic made a real decision — it simply is not 07:00.

To prove delivery end to end right now:

```bash
npm run test:notify
```

Check your phone. If a Telegram message arrives, **Phase 0's hard requirement
is met** — a scheduled server job can reach you when the app is closed.

Then:

```bash
npm run dev
```

---

## 4. Deploy

Push the repo to GitHub, then import it at <https://vercel.com/new>. Framework
preset Vite; it needs no build configuration.

Add two environment variables in Vercel, copied from your local `.env.local`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_VAPID_PUBLIC_KEY`

Both Supabase values are public by design. The anon key ships in the browser
bundle and grants access to nothing on its own — row level security is what
protects the data, and there are tests proving one account cannot read
another's rows.

Once Vercel gives you a URL, point the backend at it so notification deep
links work:

```bash
npx supabase secrets set APP_URL=https://your-app.vercel.app
```

Then open that URL on your iPhone in Safari, Share → **Add to Home Screen**.

---

## What to watch for

**Supabase pauses free projects after 7 days of inactivity.** The 15-minute
scheduler is deliberately frequent partly to prevent that — a project that
pauses during a bad week takes the digest down exactly when it is load-bearing.
Worth confirming after a week that the project is still awake.

**Free tier limits I believe apply, all of which you should verify rather than
take from me:** 500K edge function invocations per month (the scheduler uses
about 2,900), 500MB database, 5GB egress. Vercel Hobby is non-commercial only,
which this is.

**The Supabase CLI is run through `npx`**, so there is nothing to install
globally and nothing to keep updated.

---

## If something breaks

Every send attempt is recorded in `delivery_log`, successful or not, with the
error text. That table is the first place to look when a notification does not
arrive — it distinguishes "nothing was due" from "the pipeline is dead", which
is otherwise impossible to tell apart from a phone that stayed quiet.

```sql
select created_at, kind, channel, status, error
from delivery_log
order by created_at desc
limit 20;
```

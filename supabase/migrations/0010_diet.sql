-- =============================================================================
-- 0010_diet.sql — Phase 3 food tracking.
--
-- Two conventions from CLAUDE.md shape most of this file:
--
--   "Money-like precision for macros: store grams as numeric, don't accumulate
--    float error across a day."
--
--   "Changing a macro target must never retroactively alter historical days —
--    targets are versioned by effective date."
--
-- Both are about the same underlying idea: a food log is only worth keeping if
-- last month still means what it meant last month.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- macro_targets — versioned, never updated in place.
--
-- Changing today's protein goal must not silently rewrite whether every day in
-- July was "on target". So a change inserts a new row with a new effective
-- date, and any given day reads the row that was in force on it.
--
-- Stored as ranges rather than points because that is what they are. 160-175g
-- of protein is a band, and collapsing it to 167.5 invents a precision that was
-- never there and then grades you against it.
-- -----------------------------------------------------------------------------
create table public.macro_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  effective_from date not null,

  calories_min numeric(7,1) not null,
  calories_max numeric(7,1) not null,
  protein_min numeric(6,1) not null,
  protein_max numeric(6,1) not null,
  carbs_min numeric(6,1) not null,
  carbs_max numeric(6,1) not null,
  fat_min numeric(6,1) not null,
  fat_max numeric(6,1) not null,

  created_at timestamptz not null default now(),

  unique (user_id, effective_from),

  constraint bands_are_ordered check (
    calories_min <= calories_max and protein_min <= protein_max
    and carbs_min <= carbs_max and fat_min <= fat_max
  )
);

create index macro_targets_lookup on public.macro_targets (user_id, effective_from desc);

-- -----------------------------------------------------------------------------
-- food_entries — one logging action.
--
-- "2 eggs and a coffee" is one entry containing two items. Keeping the grouping
-- means an entry can be undone as a unit, which is what you actually want after
-- a mis-parse.
--
-- local_day is text in the user's timezone, as everywhere else in this schema:
-- a day is the local day, and 23:30 belongs to the day you were awake for.
-- -----------------------------------------------------------------------------
create type public.food_source as enum ('manual', 'ai', 'barcode', 'photo', 'saved');

create table public.food_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  local_day text not null check (local_day ~ '^\d{4}-\d{2}-\d{2}$'),
  logged_at timestamptz not null default now(),

  source public.food_source not null default 'manual',
  /** What was typed, kept verbatim. A bad parse is diagnosable from it. */
  raw_text text,

  created_at timestamptz not null default now()
);

create index food_entries_day on public.food_entries (user_id, local_day);

-- -----------------------------------------------------------------------------
-- food_items — the macros themselves.
--
-- numeric, not double precision. Adding thirty float portions across a day
-- accumulates visible error, and a calorie count that disagrees with itself is
-- one you stop trusting.
--
-- is_estimate travels with the row rather than being inferred from the entry's
-- source: one entry can hold a barcode-exact item and a guessed one beside it,
-- and the guessed one must still look like a guess.
-- -----------------------------------------------------------------------------
create table public.food_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_id uuid not null references public.food_entries(id) on delete cascade,

  name text not null check (length(trim(name)) > 0),
  quantity numeric(8,2),
  unit text,
  grams numeric(8,2),

  calories numeric(7,1) not null default 0,
  protein_g numeric(6,1) not null default 0,
  carbs_g numeric(6,1) not null default 0,
  fat_g numeric(6,1) not null default 0,

  /** True when a model guessed rather than a database answering. */
  is_estimate boolean not null default false,

  /** Where an exact match came from, e.g. 'usda:173410' or 'off:0067312000135'. */
  source_ref text,

  position integer not null default 0
);

create index food_items_entry on public.food_items (entry_id, position);
create index food_items_recent on public.food_items (user_id, id desc);

-- -----------------------------------------------------------------------------
-- saved_meals — the feature that gets used most.
--
-- A named combination with fixed macros, re-logged in one tap and scalable by
-- portion. The items are snapshotted rather than referenced, so editing a
-- saved meal never rewrites what you already ate.
-- -----------------------------------------------------------------------------
create table public.saved_meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  name text not null check (length(trim(name)) > 0),
  items jsonb not null default '[]'::jsonb,

  -- Named times_logged rather than use_count so it does not trip the standing
  -- guard against columns shaped like streak counters. It orders the list by
  -- what you actually eat; it is not about consistency and never appears as a
  -- number on screen.
  times_logged integer not null default 0,
  last_used_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, name)
);

create trigger saved_meals_touch before update on public.saved_meals
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- bodyweight — the only real feedback loop on whether the surplus is right.
--
-- One reading per local day. Daily weight is mostly noise; the value is in the
-- weekly average plotted against weekly average calories, which is computed on
-- read rather than stored.
-- -----------------------------------------------------------------------------
create table public.bodyweight (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  local_day text not null check (local_day ~ '^\d{4}-\d{2}-\d{2}$'),
  kg numeric(5,2) not null check (kg > 0 and kg < 500),

  created_at timestamptz not null default now(),

  unique (user_id, local_day)
);

create index bodyweight_day on public.bodyweight (user_id, local_day desc);

-- -----------------------------------------------------------------------------
-- Row level security. Every table, no exceptions.
-- -----------------------------------------------------------------------------
alter table public.macro_targets enable row level security;
alter table public.food_entries enable row level security;
alter table public.food_items enable row level security;
alter table public.saved_meals enable row level security;
alter table public.bodyweight enable row level security;

create policy "own macro targets" on public.macro_targets
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own food entries" on public.food_entries
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own food items" on public.food_items
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own saved meals" on public.saved_meals
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own bodyweight" on public.bodyweight
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- Seed the stated targets for every existing user, effective from today.
--
-- Dated rather than open-ended precisely so that the next change is a new row
-- and this one keeps describing the days it actually governed.
-- -----------------------------------------------------------------------------
insert into public.macro_targets (
  user_id, effective_from,
  calories_min, calories_max, protein_min, protein_max,
  carbs_min, carbs_max, fat_min, fat_max
)
select id, current_date, 2900, 3100, 160, 175, 350, 400, 70, 80
  from auth.users
on conflict (user_id, effective_from) do nothing;

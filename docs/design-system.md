# Design system — Phase 0.5

Build this **before** Phase 1. Every later phase imports from it and introduces nothing new.

---

## Direction: "Instrument"

The app is a calm instrument panel for one person's day. It gets opened at 7am half-awake and at 1am half-defeated, and its only job is to make "what do I do next" cost nothing to find out.

That rules out two obvious directions. It is not a productivity dashboard — no dense stat grids, no charts competing for attention. And it is not cheerful — no confetti, no celebratory greens, no exclamation marks. Its register is **quiet competence**: a well-lit gauge cluster that tells you the truth without editorializing.

Dark mode is the primary mode and gets designed first. Light mode is derived from it.

**Signature element: the day dial.** The four macro rings render as one nested instrument rather than four separate widgets, and the same ring geometry is reused for daily-checklist completion. One visual idea, two uses, learned once.

---

## The colour law

This app has three things that want colour — time pressure, macros, and courses. If they share a vocabulary, colour stops meaning anything. They are separated by **temperature and by role**, and the separation is absolute:

| System | Family | May be used as |
|---|---|---|
| Time / urgency | warm earth | edge bars, text, icon tint |
| Macros | cool jewel | ring strokes only |
| Courses | desaturated pastel | 3px left edge or 6px dot only |

Consequences that follow from this and are not negotiable:

- **No pure red anywhere in the app.** Overdue is clay rose. A guilt interface is a closed app.
- **Macro colours never appear on a task**, and urgency colours never appear on a ring.
- **Course colours are never a fill.** They mark, they don't shade.
- **Colour is never the only signal.** Every urgency state carries a text label; every ring carries a written value. This is also the colourblind-safety answer, so it isn't a separate task.

### Tokens

```css
/* ---- ground ---- */
--ink-900: #15161D;   /* app background */
--ink-800: #1D1F28;   /* card surface */
--ink-700: #262935;   /* raised surface, sheets */
--ink-600: #333747;   /* borders, dividers */
--text-hi: #E9E9F0;
--text-mid: #9DA1B4;
--text-low: #6A6F84;

/* ---- time: warm, saturation rises with urgency ---- */
--t-distant:     #6A6F84;  /* 15+ days   */
--t-approaching: #C4A46A;  /* 6–14 days  */
--t-urgent:      #E0913F;  /* 3–5 days   */
--t-critical:    #E2703A;  /* under 48h  */
--t-overdue:     #C25A5A;  /* past due   */
--t-done:        #6F8F6B;  /* quiet, not celebratory */

/* ---- macros: cool, luminous ---- */
--m-calories: #7C6BD6;
--m-protein:  #2FA8A0;
--m-carbs:    #4A8FD4;
--m-fat:      #B0619C;

/* ---- courses: fixed set of 8, desaturated ---- */
--c-1: #8A9BB8;  --c-2: #9BB89A;  --c-3: #B8A08A;  --c-4: #A88AB8;
--c-5: #8AB8B4;  --c-6: #B89A9A;  --c-7: #A0A88A;  --c-8: #8A94B8;
```

Light mode inverts the ground to a cool paper (`#F5F6F8` / `#FFFFFF` / `#ECEEF2`) and darkens each accent by roughly 12% for contrast. The accent *hues* do not change between modes.

---

## Type

- **Space Grotesk** — headings and all numerals. Its mechanical, slightly squared figures suit an instrument panel, and it makes the macro numbers the most characterful thing on screen.
- **Public Sans** — body, labels, UI text.

Both are free on Google Fonts. Self-host the subsets; don't add a third family.

All numbers use `font-variant-numeric: tabular-nums`. Digits that jump width while a ring animates make the whole thing feel unstable.

```
display   32px / 700 / -0.02em   Space Grotesk   ring centre values
h1        24px / 600 / -0.01em   Space Grotesk   screen titles
h2        18px / 600            Space Grotesk   section headers
body      16px / 400 / 1.5      Public Sans     default
label     14px / 500            Public Sans     card titles, buttons
caption   12px / 500 / 0.02em   Public Sans     urgency labels, metadata (uppercase)
```

---

## Space, shape, motion

Spacing is a 4px scale: `4 · 8 · 12 · 16 · 24 · 32 · 48`. Nothing between.

Radii: cards 12px, sheets 20px top corners, chips and pills fully rounded, rings none.

Motion — `prefers-reduced-motion` is respected everywhere:

- state change / tap feedback: 150ms ease-out
- sheet in: 250ms
- **ring fill: 400ms ease-out** — this is the one place motion is doing real work. The ring visibly moving is the receipt that the entry landed.
- No looping or ambient animation anywhere. No skeleton shimmer; use a static dimmed state.

Tap targets are 44px minimum. Primary actions sit in the bottom third of the screen, reachable one-handed.

---

## Components to build in this phase

`Card` · `Chip` · `Ring` · `CheckRow` · `Sheet` · `EmptyState` · `Field` · `Button`

Nothing in Phase 1+ may introduce a new primitive without adding it here first.

### Ring

One component, driven by props, used for both macros and checklist completion. Supports a **target band** — a lighter arc showing the acceptable range — because macro targets are ranges, not points. Over-target renders as a second, thinner arc continuing past the band, in the same hue. Over is information, not failure, and must not turn red.

### CheckRow

44px, whole row is the tap target, completion is instant and optimistic, undo is a tap in the same place. No confirmation dialogs.

---

## Empty, error, and low states

This app is empty often. Design these first, not last.

- **Nothing due:** state it plainly and stop. "Nothing due this week." No praise, no emoji, no "great job!" — earned nothing, said nothing.
- **Inbox empty:** an invitation, not a void. "Capture anything here. Sort it later."
- **Errors** say what happened and what to do, in the interface's voice, and never apologize. "Couldn't sync. Retry." Not "Oops! Something went wrong."
- **Nothing logged today:** neutral. Empty rings are a starting state, not a deficit.

### Low-battery mode

Not a filtered list — a **global visual state**. Entering it desaturates the entire palette to ground plus `--t-done`, hides all urgency colour, and renders only two or three rows. The app should visibly get quieter. This is the design's one real risk and it's the one worth taking: on the days that decide whether this app survives, the interface itself should stop shouting.

---

## Quality floor

Responsive to 360px. Visible keyboard focus rings. Contrast ≥ 4.5:1 for text, ≥ 3:1 for UI. Every interactive element reachable by keyboard. Safe-area insets respected for iOS home-screen install.

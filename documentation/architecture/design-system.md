# Design System: Two-Mode Color Identity

## Goals

Mankunku has two functionally distinct practice modes that are increasingly diverging in how they work. Users need a clear, persistent visual signal of which mode they're in, without the app feeling like two unrelated products.

This spec defines:

1. A **three-domain color identity** (Ear Training / Lick Practice / Neutral)
2. The **specific colors** used in each domain
3. The **surfaces** where the domain color appears
4. A **single-variable implementation** that requires minimal changes to existing components

The guiding principle is **subtle but unmissable**. The color identity must be obvious within a glance at any page, but never overwhelming or decorative. Real estate is reserved for music, not chrome.

## Domains

### 1. Ear Training (blue)

Routes that belong to the ear-training domain:

- `/practice` — main ear-training session
- `/practice/settings` — settings specific to ear-training practice
- `/scales` — scale practice (ear-training subset)
- `/record` — recording mode for capturing user phrases
- `/progress` — session history & adaptive difficulty (currently fed only by ear-training; lick practice has its own report)

**Identity color**: blue. Same as today's `--color-accent`. No change.

| Mode | Token | Hex | Notes |
|---|---|---|---|
| Dark | `--color-accent` | `#3b82f6` | Tailwind blue-500 |
| Light | `--color-accent` | `#2563eb` | Tailwind blue-600 |
| Hover | `--color-accent-hover` | `#2563eb` / `#1d4ed8` | one shade darker |

### 2. Lick Practice (green)

Routes that belong to the lick-practice domain:

- `/lick-practice` — setup
- `/lick-practice/session` — running session

**Identity color**: green. Same hue as the existing `practice` tag in `LickCard.svelte:73` (`text-green-500` = `#22c55e`) and the existing `--color-success` token. The green is already a known-and-used color in the app, so it doesn't introduce a new hue.

| Mode | Token | Hex | Notes |
|---|---|---|---|
| Dark | `--color-accent` (overridden) | `#22c55e` | Tailwind green-500, matches `--color-success` |
| Light | `--color-accent` (overridden) | `#16a34a` | Tailwind green-600 |
| Hover | `--color-accent-hover` (overridden) | `#16a34a` / `#15803d` | one shade darker |

### 3. Neutral

Routes that belong to neither domain (or that serve both):

- `/` — home
- `/library`, `/library/[id]` — lick library (used by both modes)
- `/add-licks`, `/entry` — adding new licks (used by both modes)
- `/settings` — global app settings
- `/auth`, `/diagnostics` — utility pages

**Identity color**: slate / desaturated. The neutral domain has no strong accent — interactive elements use `--color-text-secondary` or a slate-500 neutral, and CTAs are styled with the existing `--color-bg-tertiary` background instead of an accent color.

| Mode | Token | Hex | Notes |
|---|---|---|---|
| Dark | `--color-accent` (overridden) | `#94a3b8` | Tailwind slate-400, matches `--color-text-secondary` |
| Light | `--color-accent` (overridden) | `#475569` | Tailwind slate-600, matches `--color-text-secondary` |
| Hover | `--color-accent-hover` (overridden) | `#cbd5e1` / `#334155` | one shade lighter/darker |

The neutral domain inherits the secondary text color as its accent so that nothing on a neutral page reads as "primary action color." Buttons and chips on neutral pages should also avoid solid `var(--color-accent)` fills — prefer `var(--color-bg-tertiary)` backgrounds with `var(--color-text)` text.

## Single-variable implementation

Existing components already use `var(--color-accent)` for almost every interactive surface. We can flip the entire visual identity of a page by overriding `--color-accent` (and `--color-accent-hover`) inside a scoped CSS rule keyed off the route. **No component code needs to change** for the basic shift — only the layout wrapper.

### Mechanism

In `src/routes/+layout.svelte`, derive a `dataDomain` value from the current pathname:

```ts
const dataDomain = $derived.by(() => {
    const path = page.url?.pathname ?? '/';
    if (path.startsWith('/lick-practice')) return 'lick-practice';
    if (
        path.startsWith('/practice') ||
        path.startsWith('/scales') ||
        path.startsWith('/record') ||
        path.startsWith('/progress')
    ) return 'ear-training';
    return 'neutral';
});
```

Apply it as a `data-domain` attribute on the layout's outermost element (the `<div class="min-h-screen ...">`).

### CSS

In `src/app.css`, add scoped overrides for the two non-default domains:

```css
/* Default (:root) keeps blue — ear-training is the historical default. */
:root {
    --color-accent: #3b82f6;
    --color-accent-hover: #2563eb;
    /* ... existing variables ... */
}

/* Lick Practice domain → green */
[data-domain='lick-practice'] {
    --color-accent: #22c55e;
    --color-accent-hover: #16a34a;
}

/* Neutral domain → slate (no strong accent) */
[data-domain='neutral'] {
    --color-accent: #94a3b8;
    --color-accent-hover: #cbd5e1;
}

/* Light-mode equivalents */
:root.light {
    --color-accent: #2563eb;
    --color-accent-hover: #1d4ed8;
    /* ... existing variables ... */
}
:root.light [data-domain='lick-practice'] {
    --color-accent: #16a34a;
    --color-accent-hover: #15803d;
}
:root.light [data-domain='neutral'] {
    --color-accent: #475569;
    --color-accent-hover: #334155;
}
```

### What automatically picks this up

Every component that uses `var(--color-accent)` already does the right thing. A non-exhaustive sample of what changes "for free":

- **Active navigation item** (`+layout.svelte:92`) — turns green on lick-practice routes, slate on neutral
- **Sign In link** in nav (`+layout.svelte:119`)
- **Primary CTA buttons** (`Start Session`, `New Session`, etc.) on `/practice/+page.svelte`, `/lick-practice/+page.svelte`, the session report on `/lick-practice/session/+page.svelte`
- **`KeyProgressRing`** (current key indicator)
- **`ChordChart`** (active cell highlight, beat dots, progress bar — `ChordChart.svelte:127, 132, 144, 155`)
- **`UpcomingKeysDisplay`** (the "Now"/"Listen" chip background, the recording-pulse box-shadow — `UpcomingKeysDisplay.svelte:124, 105`)
- **`SessionTimer`** progress bar fill
- **`LickCard`** play button (`LickCard.svelte:54`) and progression-tag chips (`LickCard.svelte:81`)
- **`PracticeSetup`** segmented control selected state
- **`CategoryFilter`** selected pill
- **`PhraseInfo`** highlighted bits
- All `border-l-[var(--color-accent)]` / `text-[var(--color-accent)]` / `bg-[var(--color-accent)]` usages elsewhere

This is the "subtle but unmissable" win: the user opens `/lick-practice` and the entire interactive vocabulary turns green, but the page layout is unchanged.

## What we deliberately don't change

To keep the design subtle, **none** of the following change between domains:

- **Backgrounds** — `--color-bg`, `--color-bg-secondary`, `--color-bg-tertiary` stay constant. No section gets a tinted page background.
- **Text colors** — body text, headings, secondary text all stay neutral (slate-50/slate-400 in dark mode).
- **Layout** — same nav bar, same max-width, same spacing scale, same border-radius scale.
- **Typography** — same fonts, same scale, same weight.
- **Component shapes** — buttons, cards, inputs all retain their current geometry.

The only thing that changes is the **accent color**, applied via the existing single CSS variable. Everything else stays put.

## Two extra subtle markers

The accent-color swap alone is already pretty obvious to anyone paying attention, but it can be missed if a page is mostly chord blocks and text. Two small additions reinforce the identity without becoming decorative:

### 1. Domain badge in the nav bar

Next to the "Mankunku" wordmark in `+layout.svelte:84`, render a small chip whose label and color reflect the current domain:

```svelte
{#if dataDomain !== 'neutral'}
    <span
        class="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider
               bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
    >
        {dataDomain === 'ear-training' ? 'Ear Training' : 'Lick Practice'}
    </span>
{/if}
```

The chip is visible at all times during a session, so the user always knows which mode they're in. On neutral pages it's hidden — there's no domain to advertise.

### 2. Top accent stripe

A 2-pixel-tall stripe at the very top of the page in the domain accent color, only on non-neutral pages:

```svelte
{#if dataDomain !== 'neutral'}
    <div class="h-0.5 w-full bg-[var(--color-accent)]"></div>
{/if}
```

Placed above the `<nav>` element. It's a peripheral cue — the eye registers it without dwelling on it. On neutral pages there's no stripe (the `border-b` on the nav is the only top edge).

## Edge cases and decisions to confirm

- **`/progress`** — currently classified as ear-training because it shows the global ear-training session history (`progress.svelte` is fed only by `recordAttempt`, which we removed from lick-practice in a prior session). If/when lick-practice gets its own progress page, we'd add a separate route.
- **`/library` and `/add-licks`** — explicitly classified as neutral in the user's brief. The neutral slate accent applies. The `practice` tag's green star icon on `LickCard` (`LickCard.svelte:73`) **stays green** even on neutral pages, because that icon's job is to identify a lick that's tagged for lick practice — it's a tag for the lick-practice domain, not for the page chrome.
- **`/diagnostics`** — neutral.
- **Light mode** — every override has a `:root.light [data-domain='…']` equivalent so themes stay coherent.

## Files affected

Implementing this spec touches only two files for the base behavior:

| File | Change |
|---|---|
| `src/app.css` | Add `[data-domain='lick-practice']` and `[data-domain='neutral']` rules (dark + light). Existing `:root` rules unchanged. |
| `src/routes/+layout.svelte` | Derive `dataDomain` from `page.url.pathname`. Add `data-domain={dataDomain}` to the outermost `<div>`. Optionally add the domain chip next to "Mankunku" and the top accent stripe. |

No component-level files need to change. Every existing `var(--color-accent)` usage automatically picks up the new color.

## Verification

After implementing, walk through these surfaces and confirm the accent is correct for each:

| Surface | Domain | Expected accent |
|---|---|---|
| `/` home page | neutral | slate-400 (dark) / slate-600 (light) |
| `/practice` (mid-session) | ear-training | blue-500 / blue-600 |
| `/practice/settings` | ear-training | blue |
| `/scales` | ear-training | blue |
| `/progress` | ear-training | blue |
| `/lick-practice` setup | lick-practice | green-500 / green-600 |
| `/lick-practice/session` mid-lick | lick-practice | green |
| `/library` | neutral | slate |
| `/library/[id]` | neutral | slate |
| `/add-licks` | neutral | slate |
| `/settings` | neutral | slate |
| `/auth` | neutral | slate |

For each, check:
1. The active nav item color
2. Primary CTA button color
3. Any current-state highlights (selected pill, current key chip, active beat indicator)
4. The domain chip is present on ear-training and lick-practice pages, hidden on neutral
5. The top accent stripe is present on ear-training and lick-practice, hidden on neutral

Light mode and dark mode should both be checked.

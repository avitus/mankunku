# Design System: Three-Domain Color Identity + Blue Note Chrome

## Goals

Mankunku has two functionally distinct practice modes that diverge in how they work. Users need a clear, persistent visual signal of which mode they're in, without the app feeling like two unrelated products. On top of that, the product wears a Blue Note Records / LP-sleeve visual identity — warm brass accents, a display serif, subtle film grain — so that the chrome feels like jazz reference material, not a generic dashboard.

This spec defines:

1. A **three-domain color identity** (Ear Training / Lick Practice / Neutral)
2. The **specific colors** used in each domain, plus the decorative brass palette
3. The **surfaces** where the domain color appears
4. A **single-variable implementation** that requires minimal changes to existing components
5. The **typography, rules, and grain utilities** that carry the Blue Note mood

The guiding principle is **subtle but unmissable**. The domain color must be obvious at a glance, but never overwhelming. Real estate is reserved for music, not chrome.

## Domains

### 1. Ear Training (peacock teal)

Routes that belong to the ear-training domain:

- `/practice` — main ear-training session
- `/practice/settings` — settings specific to ear-training practice
- `/scales` — scale practice (ear-training subset)
- `/record` — recording mode for capturing user phrases
- `/progress` — session history & adaptive difficulty

**Identity color**: peacock teal. This is the default `--color-accent` — ear-training owns the unadorned `:root` palette.

| Mode  | Token                  | Hex       | Notes                                      |
| ----- | ---------------------- | --------- | ------------------------------------------ |
| Dark  | `--color-accent`       | `#2e8b9e` | Blue Note peacock teal                     |
| Dark  | `--color-accent-hover` | `#1f6b7a` | one shade darker                           |
| Light | `--color-accent`       | `#15667a` | deeper teal for contrast on light bg       |
| Light | `--color-accent-hover` | `#0f4e5c` | one shade darker                           |

### 2. Lick Practice (warm terracotta)

Routes that belong to the lick-practice domain:

- `/lick-practice` — setup
- `/lick-practice/session` — running session

**Identity color**: warm terracotta / burnt sienna. This is the LP-sleeve counterpart to the ear-training teal — complementary in hue, same visual weight, reads as jazz-era rather than "success/error" signal.

| Mode  | Token                                | Hex       | Notes                                    |
| ----- | ------------------------------------ | --------- | ---------------------------------------- |
| Dark  | `--color-accent` (overridden)        | `#c96a3e` | Warm terracotta                          |
| Dark  | `--color-accent-hover` (overridden)  | `#a64f27` | one shade darker                         |
| Light | `--color-accent` (overridden)        | `#a84a26` | darkened for readability on light bg     |
| Light | `--color-accent-hover` (overridden)  | `#8a3b1c` | one shade darker                         |

### 3. Neutral

Routes that belong to neither domain (or that serve both):

- `/` — home
- `/library`, `/library/[id]` — lick library (used by both modes)
- `/add-licks`, `/entry` — adding new licks (used by both modes)
- `/settings` — global app settings
- `/auth`, `/diagnostics` — utility pages

**Identity color**: slate / desaturated. The neutral domain has no strong accent — interactive elements use `--color-text-secondary` or a slate neutral, and CTAs typically use `--color-bg-tertiary` backgrounds instead of an accent fill.

| Mode  | Token                                | Hex       | Notes                                         |
| ----- | ------------------------------------ | --------- | --------------------------------------------- |
| Dark  | `--color-accent` (overridden)        | `#94a3b8` | Tailwind slate-400, matches secondary text    |
| Dark  | `--color-accent-hover` (overridden)  | `#cbd5e1` | one shade lighter                             |
| Light | `--color-accent` (overridden)        | `#475569` | Tailwind slate-600, matches secondary text    |
| Light | `--color-accent-hover` (overridden)  | `#334155` | one shade darker                              |

The neutral domain inherits the secondary text color as its accent so that nothing on a neutral page reads as "primary action color." Buttons and chips on neutral pages should prefer `var(--color-bg-tertiary)` backgrounds with `var(--color-text)` text.

## Decorative brass palette

Alongside the functional domain accent, a second palette drawing from Blue Note Records cover art provides chrome and warmth. Brass tokens are **always decorative** — they never replace the functional domain accent or signal interactivity.

| Token                 | Dark hex  | Light hex | Usage                                                                      |
| --------------------- | --------- | --------- | -------------------------------------------------------------------------- |
| `--color-brass`       | `#c8923d` | `#8b6a2f` | Wordmark, jazz rules, active underlines, streak number, calendar heatmap   |
| `--color-brass-soft`  | `#e2b875` | `#a8853e` | Secondary brass (hover glows, softer chrome)                               |
| `--color-paper`       | `#1a1410` | `#f5efe3` | Warm paper-like backgrounds for LP-sleeve panels                           |

### On-air red

A vintage recording-booth red used for the active / stop state of the practice and record buttons. Intentionally desaturated compared to `--color-error` so it reads as jazz-era rather than alert red.

| Token                 | Dark hex  | Light hex | Usage                                                          |
| --------------------- | --------- | --------- | -------------------------------------------------------------- |
| `--color-onair`       | `#a8463a` | `#8a3328` | "Recording" / "stop" state on practice and record buttons      |
| `--color-onair-hover` | `#8a3428` | `#6a2418` | Hover                                                          |

### Feedback tokens

`--color-success`, `--color-warning`, `--color-error` are reserved for grade readouts, toasts, and validation. They are **never** used as domain accents.

## Typography

### Display serif — Fraunces

Self-hosted variable font (weight 300–800, Latin subset, `.woff2`, license SIL OFL 1.1). Used for:

- App wordmark (`MANKUNKU`)
- Page titles
- Key/grade readouts
- Lick names
- Primary nav labels for "Side A / Side B" practice modes

Apply via the `.font-display` utility:

```css
.font-display {
  font-family: Fraunces, ui-serif, Georgia, 'Times New Roman', serif;
  font-optical-sizing: auto;
  font-variation-settings: 'SOFT' 50, 'WONK' 0;
  letter-spacing: -0.01em;
}
```

### Body — system UI sans

Everything else uses the Tailwind default sans stack. No custom webfont for body text — keep the page light and legible.

### Tracked small caps

`.smallcaps` — liner-note credits, section labels, meta rows on cards.

```css
.smallcaps {
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-size: 0.7rem;
  font-weight: 600;
}
```

## Surface utilities

### Brass hairlines

`.jazz-rule` — decorative 1px line under titles and between sections. Gradient fades to transparent to feel engraved rather than ruled. `.jazz-rule-full` is the symmetric version for full-width section breaks.

### Film grain

`.grain-overlay` — subtle fractal-noise grain applied to the layout root. Inline SVG, no HTTP request. Low opacity (0.045 dark, 0.06 light, 0.03 under `prefers-reduced-motion`) and `mix-blend-mode: overlay` / `multiply` so it does not compete with scoring colors or notation.

### Peripheral accent stripe

A 0.5px-tall stripe at the top of non-neutral pages, rendered in `bg-[var(--color-accent)]`. It's a peripheral cue — the eye registers it without dwelling on it. On neutral pages there is no stripe.

## Single-variable implementation

Components use `var(--color-accent)` for almost every interactive surface. Flipping a page's identity means overriding `--color-accent` (and `--color-accent-hover`) inside a scoped CSS rule keyed off the route. **No component code changes** — only the layout wrapper.

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

It's applied as `data-domain={dataDomain}` on the layout's outermost element. The grain overlay and peripheral stripe both live on that same wrapper.

### CSS (actual, as in `src/app.css`)

```css
/* Default (:root) is ear-training: peacock teal. */
:root {
    --color-accent: #2e8b9e;
    --color-accent-hover: #1f6b7a;
    --color-brass: #c8923d;
    --color-brass-soft: #e2b875;
    --color-paper: #1a1410;
    --color-onair: #a8463a;
    --color-onair-hover: #8a3428;
    /* ... backgrounds, text, feedback tokens ... */
}

[data-domain='lick-practice'] {
    --color-accent: #c96a3e;
    --color-accent-hover: #a64f27;
}

[data-domain='neutral'] {
    --color-accent: #94a3b8;
    --color-accent-hover: #cbd5e1;
}

:root.light { /* light-mode equivalents */ }
:root.light [data-domain='lick-practice'] { ... }
:root.light [data-domain='neutral']       { ... }
```

### What automatically picks this up

Every component that uses `var(--color-accent)` flips for free when the domain changes. A non-exhaustive sample:

- **Active navigation underline** (`+layout.svelte`) — turns terracotta on lick-practice, slate on neutral
- **Sign In link** in nav
- **Primary CTA buttons** on `/practice`, `/lick-practice`, session reports
- **`KeyProgressRing`** (current key indicator)
- **`ChordChart`** (active cell highlight, beat dots, progress bar)
- **`UpcomingKeysDisplay`** ("Now"/"Listen" chip, recording-pulse shadow)
- **`SessionTimer`** progress bar fill
- **`LickCard`** play button and progression-tag chips
- **`PracticeSetup`** / `CategoryFilter` selected state
- All `border-l-[var(--color-accent)]` / `text-[var(--color-accent)]` / `bg-[var(--color-accent)]` usages

The user opens `/lick-practice` and the entire interactive vocabulary turns terracotta, but the page layout is unchanged.

## What we deliberately don't change

To keep the design subtle, **none** of the following change between domains:

- **Backgrounds** — `--color-bg`, `--color-bg-secondary`, `--color-bg-tertiary` stay constant.
- **Text colors** — body text, headings, secondary text.
- **Layout** — nav bar, max-width (`max-w-5xl`), spacing scale, border-radius scale.
- **Typography** — same fonts, same scale, same weight.
- **Component shapes** — buttons, cards, inputs retain their geometry.
- **Brass chrome** — wordmark color, jazz rules, on-air red are domain-invariant.

The only thing that changes per domain is the **accent color**, applied via the existing single CSS variable.

## Edge cases

- **`/progress`** — classified as ear-training because it shows the global ear-training session history. If lick-practice gets its own long-term progress page, that route can opt in separately.
- **`/library` and `/add-licks`** — neutral, even though `LickCard` may display a green-star "practice" tag. That tag identifies a lick's category, not the page chrome.
- **`/diagnostics`** — neutral.
- **Light mode** — every override has a `:root.light [data-domain='…']` equivalent so themes stay coherent.

## Files affected

The base behavior lives in just two files:

| File                         | Role                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `src/app.css`                | Defines the tokens, domain overrides, typography, and utility classes above.  |
| `src/routes/+layout.svelte`  | Derives `dataDomain`, applies `data-domain`, renders the peripheral stripe.   |

No component-level files need to change. Every existing `var(--color-accent)` usage automatically picks up the new color.

## Verification

After changes, walk through these surfaces and confirm the accent is correct:

| Surface                          | Domain        | Expected accent                     |
| -------------------------------- | ------------- | ----------------------------------- |
| `/` home                         | neutral       | slate                               |
| `/practice` (mid-session)        | ear-training  | peacock teal                        |
| `/practice/settings`             | ear-training  | peacock teal                        |
| `/scales`                        | ear-training  | peacock teal                        |
| `/progress`                      | ear-training  | peacock teal                        |
| `/lick-practice` setup           | lick-practice | terracotta                          |
| `/lick-practice/session`         | lick-practice | terracotta                          |
| `/library`, `/library/[id]`      | neutral       | slate                               |
| `/add-licks`, `/entry`           | neutral       | slate                               |
| `/settings`, `/auth`, `/diag…`   | neutral       | slate                               |

For each page confirm:

1. Active nav item underline color
2. Primary CTA button color
3. Current-state highlights (selected pill, current key chip, active beat)
4. The peripheral accent stripe is present on ear-training and lick-practice pages, hidden on neutral
5. Brass chrome (wordmark, jazz rules) is unchanged across domains
6. The on-air red only appears on active practice/record buttons

Check both light and dark modes.

# Mankunku Design System: Studio Desk, Music and Editing

## Goals

Mankunku has two functionally distinct practice modes that diverge in how they work. Users need a clear, persistent visual signal of which mode they're in, without the app feeling like two unrelated products. On top of that, the product wears a Blue Note Records / LP-sleeve visual identity — warm brass accents, a display serif, subtle film grain — so that the chrome feels like jazz reference material, not a generic dashboard.

This spec defines:

1. A **three-domain color identity** (Ear Training / Lick Practice / Neutral)
2. The **specific colors** used in each domain, plus the decorative brass palette
3. The **surfaces** where the domain color appears
4. A **single-variable implementation** that requires minimal changes to existing components
5. The **typography, rules, and grain utilities** that carry the Blue Note mood
6. Shared **notation, step-entry, playback and review contracts**
7. The approved **library, listening desk, editor and import patterns**

The guiding principle is **subtle but unmissable**. The domain color must be obvious at a glance, but never overwhelming. Real estate is reserved for music, not chrome.

## Domains

### 1. Ear Training (peacock teal)

Routes that belong to the ear-training domain:

- `/ear-training` — main ear-training session (`/practice` is a 308 redirect to it)
- `/scales` — scale practice (ear-training subset)
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
- `/lick-practice/cue-preview` — temporary listen/play cue design compare, unlinked from the nav (inherits the prefix)

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
- `/licks`, `/licks/[id]` — your lick book (used by both modes)
- `/licks/add`, `/licks/editor`, `/licks/record` — adding new licks (book-building, not practice)
- `/tunes` and its subroutes — the tune songbook, including the scored `/tunes/[id]/practice` session (a tune take is not a lick-practice session; it earns no domain accent)
- `/tricks`, `/tricks/[id]` — the melodic-device catalog and its mastery ladders (the *session* they launch runs under `/lick-practice`, which is where the terracotta appears)
- `/settings` — global app settings
- `/docs` and its subroutes — in-app documentation
- `/auth`, `/diagnostics`, `/admin` and their subroutes — utility pages

**Identity color**: slate / desaturated. The neutral domain has no strong accent — interactive elements use `--color-text-secondary` or a slate neutral, and CTAs typically use `--color-bg-tertiary` backgrounds instead of an accent fill.

| Mode  | Token                                | Hex       | Notes                                         |
| ----- | ------------------------------------ | --------- | --------------------------------------------- |
| Dark  | `--color-accent` (overridden)        | `#94a3b8` | Tailwind slate-400, matches secondary text    |
| Dark  | `--color-accent-hover` (overridden)  | `#cbd5e1` | one shade lighter                             |
| Light | `--color-accent` (overridden)        | `#475569` | Tailwind slate-600, matches secondary text    |
| Light | `--color-accent-hover` (overridden)  | `#334155` | one shade darker                              |

The neutral domain inherits the secondary text color as its accent so that nothing on a neutral page reads as "primary action color." Buttons and chips on neutral pages should prefer `var(--color-bg-tertiary)` backgrounds with `var(--color-text)` text.

## Decorative brass palette

Alongside the functional domain accent, a second palette drawing from Blue Note Records cover art provides chrome and warmth. Brass tokens are decorative — they never replace the functional domain accent or signal interactivity — with one semantic borrowing: the practice-phase alias `--color-phase-play` resolves to brass (see [Practice-phase colours](#practice-phase-colours)).

| Token                 | Dark hex  | Light hex | Usage                                                                      |
| --------------------- | --------- | --------- | -------------------------------------------------------------------------- |
| `--color-brass`       | `#c8923d` | `#8b6a2f` | Wordmark, jazz rules, active underlines, streak number, calendar heatmap   |
| `--color-brass-soft`  | `#e2b875` | `#a8853e` | Secondary brass (hover glows, softer chrome)                               |
| `--color-paper`       | `#1a1410` | `#f5efe3` | Warm paper-like backgrounds for LP-sleeve panels                           |

### On-air red

A vintage recording-booth red used for the active / stop state of the practice and record buttons, and the console rocker LED. The approved Listen design now uses orange instead; see the migration status below.

| Token                 | Dark hex  | Light hex | Usage                                                          |
| --------------------- | --------- | --------- | -------------------------------------------------------------- |
| `--color-onair`       | `#a8463a` | `#8a3328` | "Recording" / "stop" state on practice and record buttons      |
| `--color-onair-hover` | `#8a3428` | `#6a2418` | Hover                                                          |

### Practice-phase colours

Every listen/play indicator — the phase tab and its lamp on the lick-practice stack, the recording ring, the cue pill on record-a-lick, the ear-training status line, tune practice's head / your-turn captions and the open insertion window — reads two semantic aliases, never the palette tokens directly:

The approved design-system contract (2026-10-14) is **Listen = warm orange,
Play = brass**. This replaces the older red Listen direction: the user found
red too close to an error signal. Use separate phase aliases, even when their
palette hue is borrowed from an activity color.

| Meaning | Prototype token | Dark value / text | Native status |
| --- | --- | --- | --- |
| App demonstrates / Listen | `--mk-phase-listen`, `--mk-phase-listen-text` | `#c96a3e` / `#e09972` | Pending migration of `--color-phase-listen` |
| User's turn / Play | `--mk-phase-play` | brass / brass soft | Existing `--color-phase-play` |
| Stop / recording button | `--mk-onair` | `#a8463a` | Existing `--color-onair` |

**Implementation gap verified at `35eff0ec`:** `src/app.css` still maps
`--color-phase-listen` to `--color-onair`, and the existing token contract test
pins that legacy mapping. The design-system update changes the reference kit
and guidance, not those runtime files. Migrate the native phase alias and its
tests together, verifying text contrast and all phase surfaces in both themes;
do not claim that the orange direction is already delivered in Svelte. Use a
text-safe orange for small labels, not the lower-contrast fill hue. Keep stop /
record buttons and rocker LEDs on their separate on-air token. Phase text and
icons must remain understandable without color, with stable Listen/Play geometry.

### Feedback tokens

`--color-success`, `--color-warning`, `--color-error` are reserved for grade readouts, toasts, and validation. They are **never** used as domain accents.

`--color-error` is a **muted jazz-toned red** (`#c45b5b` dark / `#a12f35` light), desaturated from a bright alert red so it sits inside the Blue Note palette — used for negative feedback (a "Try Again" grade, a low score) as well as genuine errors. It stays distinct in hue from the warmer `--color-onair` brick.

`--color-error` and `--color-warning` are **fill** tokens (tuned for button/tint backgrounds, which carry white text). For feedback **text** — an error message, a warning label — use the text-safe variants `--color-error-text` / `--color-warning-text`, which lighten (error) or darken (warning) per theme so small text keeps ≥4.5:1 contrast on the page and card surfaces.

### Intonation poles

`--color-tune-sharp` (brass: `--color-brass-soft` dark, `--color-brass` light) and `--color-tune-flat` (blue: `#7aa7d9` dark, `#365f9e` light) colour the ear-training **Your tuning** fader bank (`TuningFaders`). They are never used raw: `tuningTone(cents)` (`src/lib/ui/tuning-tone.ts`) returns the text colour within ±5¢, steps to half strength the moment a note leaves that zone, and reaches the full pole at 12¢ (`ALERT_CENTS`), the offset the sharp/flat reminder speaks at. Warm-high / cool-low is the reading; blue against orange stays apart under the common colour-vision deficiencies. The exact cents are always printed beside the colour.

### Difficulty & Mastery ramps

Two 10-step ramps, both theme-aware (base in `:root`, re-stepped in `:root.light`), for the two things the app grades on a scale. **Never** hand-roll a green→red heatmap or hardcode these hues inline.

| Ramp | Tokens | Direction | Meaning | Where |
| --- | --- | --- | --- | --- |
| **Mastery** | `--mastery-1..10` | teal → brass | *Accomplishment* — high = brass you've earned | Tonal Mastery meter, scale-proficiency bars, lick phase bands (`difficulty/lick-phase.ts`) |
| **Difficulty** | `--difficulty-1..10` | muted green → amber → muted brick-red | *How hard the material is* — high = jazz-hot, not alarm | Lick/level difficulty badges, adaptive Level readout |

Access them via `masteryDisplay()` / `difficultyDisplay()` (`src/lib/difficulty/display.ts`), which return the band's `var(--…-N)` token — safe to drop into an inline `style`. **Proficiency always uses the mastery ramp, not the feedback tokens** (a low-proficiency key reads as low-teal, never danger-red).

### Accuracy medal scale

The counterpart to the Mastery ramp, for **performance scores** (poor → perfect) rather than long-term proficiency. Mastery is a smooth climb where high = accomplishment; accuracy must instead make it obvious **which keys/notes need work**, so it's **discrete** with breakpoints that match the `Grade` thresholds:

| Tier | Token | Band | Meaning |
| --- | --- | --- | --- |
| **Gold** | `--accuracy-gold` | ≥ 95% | Excellence |
| **Silver** | `--accuracy-silver` | 85–94% | Very good |
| **Bronze** | `--accuracy-bronze` | 70–84% | Decent |
| **Teal** | `--accuracy-teal` | 55–69% | Needs work |
| **Deep teal** | `--accuracy-deep` | < 55% | Rough |

Podium medals reward good takes; the two teal shades below "decent" keep the low end calm and encouraging (a rough key reads teal, never alarm-red). It stays in the app's teal↔gold family so it never fights the Mastery ramp, but where mastery is a 10-step gradient, accuracy is 5 crisp tiers. Access via `accuracyTier(score01)` (`src/lib/ui/score-colors.ts`), which returns the tier's `var(--accuracy-*)` token (`accuracyTierInfo` gives the whole tier). Used by: the lick-practice **key ring** + **per-key report chips**, the **progress per-key detail**, **grade readouts** (`GRADE_COLORS`), and **per-note pitch/rhythm** (`NoteComparison`). The exact % is always shown alongside, so precision within a tier isn't lost.

The three medal tiers are backed by theme-invariant **metal** tokens — `--metal-gold` / `--metal-silver` / `--metal-bronze`, literals, the single source of truth for each coin — which the dark `--accuracy-{gold,silver,bronze}` reference directly; `:root.light` re-points those `--accuracy-*` to darker, paper-legible text accents but leaves `--metal-*` untouched, so a light-theme coin stays metal. The lustre tokens (`--medal-<metal>-hi/mid/lo/label/rim`, `color-mix` over the tier colour) draw the key-ring dots' radial gradient and the report chips (`.lp-medal-chip`): a soft sheen in dark, an opaque struck coin in light.

### Progression identity palette

One muted hue per chord progression — `--prog-<ChordProgressionType>` (`--prog-minor-vamp` … `--prog-ii-V-I-major-long`), consumed only through `progressionColor(type)` in `src/lib/music/progression-display.ts` (an exhaustive `Record`, so a new progression won't type-check without a hue). It tints the library card's category pill and dots and carries into the lick-practice session header, so a lick reads as one thing across both. The hue encodes tonality as a cool→warm spectrum: minor progressions teal→indigo, the cyclic/bluesy turnarounds violet→rose, dominant and major terracotta→gold; `:root.light` re-steps them darker.

## Typography

### Display serif — Fraunces

Self-hosted variable font (weight 300–800, Latin subset, `.woff2`, license SIL OFL 1.1). Used for:

- App wordmark (`MANKUNKU`)
- Page titles
- Key/grade readouts
- Lick names
- Primary nav labels for "Side A / Side B" practice modes

The face is a token, `--font-display`, and the `.font-display` utility reads it:

```css
:root {
  --font-display: Fraunces, ui-serif, Georgia, 'Times New Roman', serif;
}

.font-display {
  font-family: var(--font-display);
  font-optical-sizing: auto;
  font-variation-settings: 'SOFT' 50, 'WONK' 0;
  letter-spacing: -0.01em;
}
```

Component-scoped CSS that cannot take a utility class reads the token directly — the `Knob` readout's `font-family: var(--font-display), Georgia, serif`. The token was once referenced without being defined, so every knob readout silently fell back to Georgia; the design-token test now sweeps `var(--font-*)` as well as `var(--color-*)`.

### Chord symbols — `--chord-font`

```css
:root {
  --chord-font: Fraunces, Edwin, ui-serif, Georgia, serif;
  --chord-font-weight: 500;
}
```

The ONE chord-symbol face, everywhere a chord is drawn: the lead-sheet SVG (`NotationDisplay`'s chord tspans), the practice `ChordChart`, and the HTML `ChordSymbolText`. Fraunces carries the letters; **Edwin** (MuseScore's engraved text face, self-hosted Roman + Bold, SIL OFL) fills the Δ ♭ ♯ glyphs Fraunces lacks. What is drawn in it is the app-wide pretty convention from `music/chord-layout.ts` (`chordDisplayModel`: root and the minor "-" on the baseline, everything after in superscript with real glyphs — ø7 / °7 / +7 — a single alteration parenthesized in the superscript run, two or more stacked in one tall paren pair). That model is **display-only**: `formatChordSymbol` and the ABC text stay canonical ASCII-plus-Δ. **MuseJazzText** (also from MuseScore) is abcjs's `infofont` for the boxed section marks.

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

A thin stripe (`h-0.5`, 2px = 0.125rem) at the top of non-neutral pages, rendered in `bg-[var(--color-accent)]`. It's a peripheral cue — the eye registers it without dwelling on it. On neutral pages there is no stripe.

### Console controls

Setup screens speak a mixing-console idiom instead of form controls. `app.css` carries the shared surfaces — `.console-panel` (brushed-slate faceplate, thin brass inner rim), `.console-engrave` (engraved `--color-brass-soft` label), and the LED dot `.led` with two lit states: `.led-on` in `--color-onair` and `.led-accent-on` in the domain accent. Three components in `src/lib/components/console/` use them:

| Component | Control | Colour |
|---|---|---|
| `Knob` | rotary value (drag, arrow keys), Fraunces readout via `--font-display` | value arc in `--color-accent`; brass body |
| `SelectorPad` | radio group of pads (`columns` for a grid; per-option `disabled` dims to a locked pad) | active pad and its LED in `--color-accent` |
| `RockerSwitch` | ON/OFF switch | brass cap; ON legend and LED in `--color-onair`, whatever the domain |

`Knob` and `RockerSwitch` take an optional `helpText`, rendered as a `TooltipHint` beside the engraved label; `RockerSwitch` also takes `disabled` (native disabled, housing dimmed to 0.45 like a locked `SelectorPad` option) for a setting the context cannot honour — tune practice's Head switch on a chords-only chart, where the plan's effective `playHead` is false anyway. Their copy lives in `src/lib/content/tooltips.ts`, one group per screen (`tooltips.lickPractice`, `tooltips.tunePractice`, `tooltips.settings`, …). The idiom covers the settings page, the lick-practice setup (`PracticeSetup`) and the tune-practice setup, all three with the songbook header (brass kicker, display title, jazz rule). The housing is pinned in px, not rem, because the sliding cap's geometry is px: a housing that scaled with the root font size would leave the cap short of the ON position.

## Single-variable implementation

Components use `var(--color-accent)` for almost every interactive surface. Flipping a page's identity means overriding `--color-accent` (and `--color-accent-hover`) inside a scoped CSS rule keyed off the route. **No component code changes** — only the layout wrapper.

### Mechanism

In `src/routes/+layout.svelte`, derive a `dataDomain` value from the current pathname:

```ts
const dataDomain = $derived.by(() => {
	const path = page.url?.pathname ?? '/';
	if (path.startsWith('/lick-practice')) return 'lick-practice';
	if (
		path.startsWith('/ear-training') ||
		path.startsWith('/scales') ||
		path.startsWith('/progress')
	) {
		return 'ear-training';
	}
	return 'neutral';
});
```

It's applied as `data-domain={dataDomain}` on the layout's outermost element. The grain overlay and peripheral stripe both live on that same wrapper. (`/practice` is not referenced in this client domain logic — it exists only as a server-side 308 redirect to `/ear-training`.)

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

- **Sign In link** in nav (desktop and mobile)
- **Primary CTA buttons** on `/ear-training`, `/lick-practice`, session reports
- **`LickHeader`** key readout in the lick-practice session
- **`ChordChart`** (active cell highlight, beat dots, progress bar)
- **`SessionTimer`** progress bar fill
- **`LickCard`** play button (progression-tag chips take their hue from the progression palette above, not the domain accent)
- **`PracticeSetup`** selected state, and the console controls' accent parts — the `Knob` value arc and the active `SelectorPad` pad + LED
- All `border-l-[var(--color-accent)]` / `text-[var(--color-accent)]` / `bg-[var(--color-accent)]` usages

The user opens `/lick-practice` and the entire interactive vocabulary turns terracotta, but the page layout is unchanged. What does *not* follow the domain, by design: the active-nav marker (a brass hairline under the desktop item, a brass left border in the mobile menu), the practice-phase indicators on `UpcomingKeysDisplay` / `PhaseCueBar` (the phase aliases), the `KeyProgressRing` (medal tokens for scored keys, a pulsing `--color-brass-soft` outline on the current key), and the `RockerSwitch`'s on-air legend and LED.

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
- **`/licks`, `/licks/add`, and `/licks/editor`** — neutral (no domain accent), even though `LickCard` renders per-lick metadata such as category, difficulty, and progression-tinted chips (`--prog-*`, not the domain accent). Those chips identify a lick's musical attributes, not the page chrome.
- **`/licks/record`** — neutral. Recording a phrase from the mic builds your book; it is not an ear-training session, so this route moved out of the blue ear-training domain when it became a licks subroute.
- **`/diagnostics`** — neutral.
- **Light mode** — every override has a `:root.light [data-domain='…']` equivalent so themes stay coherent.

## Files affected

The base behavior lives in just two files:

| File                         | Role                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `src/app.css`                | Defines the tokens, domain overrides, typography, and utility classes above.  |
| `src/routes/+layout.svelte`  | Derives `dataDomain`, applies `data-domain`, renders the peripheral stripe.   |

No component-level files need to change. Every existing `var(--color-accent)` usage automatically picks up the new color.

`tests/unit/ui/design-token-consistency.test.ts` pins the contract: every `var(--color-*)` and every `var(--font-*)` referenced under `src/` is defined in `app.css` (an undefined custom property fails silently — the property computes to nothing, or to the next font in the stack); solid coloured fills on text-bearing elements set explicit white text; the two phase aliases resolve to brass and on-air; the phase surfaces it sweeps — `UpcomingKeysDisplay`, `PhaseCueBar` and the cue-preview route's `CueStage` — never reach past the aliases to a raw `--color-brass` / `--color-onair` token (the other listen/play surfaces use the aliases by convention, unswept); and feedback *text* uses the `-text` variants, never the fill tokens.

## Verification

After changes, walk through these surfaces and confirm the accent is correct:

| Surface                          | Domain        | Expected accent                     |
| -------------------------------- | ------------- | ----------------------------------- |
| `/` home                         | neutral       | slate                               |
| `/ear-training` (mid-session)    | ear-training  | peacock teal                        |
| `/scales`                        | ear-training  | peacock teal                        |
| `/progress`                      | ear-training  | peacock teal                        |
| `/lick-practice` setup           | lick-practice | terracotta                          |
| `/lick-practice/session`         | lick-practice | terracotta                          |
| `/licks`, `/licks/[id]`          | neutral       | slate                               |
| `/licks/add`, `/licks/editor`    | neutral       | slate                               |
| `/licks/record`, `/tunes`        | neutral       | slate                               |
| `/tunes/[id]/practice`, `/tricks` | neutral      | slate                               |
| `/settings`, `/docs`, `/auth`, `/diag…` | neutral | slate                              |

For each page confirm:

1. Primary CTA button color
2. Current-state highlights (selected pill or pad, active chord cell and beat)
3. The peripheral accent stripe is present on ear-training and lick-practice pages, hidden on neutral
4. Brass chrome (wordmark, jazz rules, the active-nav marker) is unchanged across domains
5. Target: Listen uses orange phase tokens; Play uses brass. On-air red remains on stop/record buttons and rocker LEDs. Track the native Listen migration gap above explicitly.

Check both light and dark modes.


## Studio Desk migration

The approved MagicPath pages are implemented natively in Svelte 5 (migration started 2026-10-11).

| Page | Component | Approved revision |
|---|---|---|
| Home · Studio Desk | `460227723458142208` | `460231044206071808` |
| Settings · Studio Desk | `459540987434397696` | `460225985468596224` |
| Lick Practice · Studio Console | `459464126830383104` | `459511600479637504` |
| Licks · Studio Library | `460234239577821184` | `460236188301803520` |
| Tunes · Studio Library | `460237458806812672` | `460237458806812673` |
| Ear Training · Studio Console | `459411700509200384` | `460504190599458816` |
| Scale reference · Studio Desk | `459518760068452352` | `460511901051424768` |
| Progress · Studio Desk | `460507092273475584` | `460509079647965184` |
| Sign in · Studio Desk | `459519014817902592` | `460514824175128576` |
| Add Licks · Studio Desk | `459517917629935616` | `460936884772802560` |
| Lick Editor · Studio Desk | `459517965835059200` | `460811927849934848` |
| Landing · Studio Desk | `460241787924140032` | `460242697312145408` |

React prototype state and handlers are not shipped. `StudioPage` and `StudioPanel`
provide reusable structure; existing `Knob`, `SelectorPad`, and `RockerSwitch`
continue to control the real settings store and explicit saves.

Adoption is opt-in with `.studio-desk`. The `--studio-*` palette in `app.css`
provides slate panels, an inset well, restrained borders, readable text and
neutral controls, with explicit light-theme counterparts. Fraunces uses the
existing font asset. `.studio-action`, `.studio-label`, `.studio-caption`, and
`.studio-well` are shared building blocks. These tokens supplement the domain,
phase, mastery and accuracy tokens above; they do not replace their meanings.
`--studio-accent-text` is for text and `--studio-button` is for white-on-colour
controls. Activity overrides are scoped to the owning panel. Settings is neutral;
its tonality section is ear-training and its practice link is lick-practice.

Home/landing, Sign in, Settings, Ear Training, Progress, Scales, Lick Practice setup,
the running Lick Practice session (`/lick-practice/session`), Licks, Add Licks (`/licks/add`), the Lick Editor
(`/licks/editor`), Community Licks (`/licks/community`) and Tunes opt into
the layout's 1440px Studio Desk container. Tune Detail (`/tunes/[id]`) and Tune Editor (`/tunes/editor`) also use the
shared editor shell. Other nested import and session routes retain their
existing width and presentation. The setup summary
moves below the controls on tablet/mobile; instrument and scale banks reflow
using `--selector-columns`. Do not apply new chrome across all routes as a side
effect of migrating a single page.

Compact dial faces use 20px system-sans numerals in the SVG view box (16.8px
at the 84px dial size), with tabular figures and restrained tracking. Keep
Fraunces for headings and larger readouts. The dial marker sits near the rim
so it stays clear of four-character values such as `100%`. Swing is displayed
as 50–80% in 1% increments while its stored ratio and audio behaviour remain unchanged.

Backing and metronome controls stay mounted when switched off. Their dependent
knobs and selector bank are disabled, their values remain saved, and Rhythm &
band retains its dimensions. The summary is read-only. Account, tour, password
recovery, and destructive-action confirmation flows retain their existing logic.

Before adopting these components on another route, check both themes, desktop,
tablet and phone widths, keyboard navigation, persisted values and the route's
real workflows. The Settings E2E tests exercise that baseline, including the
backing-off layout regression and instrument/tempo summary updates.
The dial contract tests cover every volume, tempo and swing step, range limits,
displayed values, and persistence. Highest-note tests cover written-pitch labels
and saved concert pitches for all five instruments, including transposing horns.

The libraries default to compact rows with 20 entries per page; 40 and All, plus
an optional card view, support larger collections. Search, progression and
collection filters run before paging. Lick groups retain their existing order,
practice actions, audition and attribution; tunes retain written-key conversion
and detail navigation. The sidebar uses actual collection counts.

Home retains actual progress and practice-set data with aligned practice actions.
The landing page explains Ear Training and Vocabulary (Licks and Tricks); its
interactive previews are explicitly illustrative. Lick Practice keeps one duration
dial and a read-only summary that distinguishes the time budget from the planned
session length. Deep Practice and Tricks retain their original configuration logic.

### Focus on sound

Pages visible while playing prioritize listening over reading. Keep the musical
context, a single Listen/Play cue, transport and exact scores. Move explanatory
copy, tuning interpretation and attributed jazz quotes to paused moments or help.
Avoid repeated instructions, decorative motion and layout changes between Listen
and Play. Ear Training has no visible medal badge: its existing five accuracy
colours are applied to the actual overall, pitch and rhythm percentages; the grade
remains available to screen readers. The quote region is fixed in height, scrolls
for long existing captions, and is empty during a live run.

`EarTrainingConsole` is a presentation component: the route retains the audio,
recording, rescore, automatic progression and persistence lifecycle. `TuningFaders`
opts into console styling without changing transposition, medians, spread bands,
steadiness or A = 440 / personal-centre calculations. Prototype sample scores,
quotes and state controls are never shipped. Dark mode remains the default, with
existing semantic light-theme tokens respected.

Tour anchors stay on the actual controls inside `EarTrainingConsole`. The tour
registry test follows mounted, statically imported Svelte components, so extracting
presentation does not break validation or require duplicate route-level anchors.


### Progress overview

Progress uses the approved Studio Desk hierarchy: persistent all-time readouts,
a slim mastery meter, Tonal Mastery beside This Period, a full-width calendar,
then Scale Proficiency beside Keys & Scales and By Key. The trend/comparison panels stack below 1100px and the lower panels below 850px; the year calendar scrolls horizontally at small widths so its
daily cells remain legible. Both themes use the shared Studio Desk palette.

The route retains live history, mastery and unlock calculations, written-pitch
labels, expandable scale trends, session recordings and per-key note details.
Practice time still excludes unknown historical durations. Empty panels show
actual empty states, never the prototype's example data. Progress/Sessions tabs
and their session subtabs retain keyboard navigation. Reset remains behind its
existing confirmation. `TrendChart` and `PeriodCompare` opt into console styling
through their `studio` prop without changing their calculations or other callers.


### Scale reference

The Scale reference is a compact reference panel with a family index, names and
inset degree labels. Family links jump to their sections; the index wraps above
the panel on smaller screens. Content and counts come from `getMvpScales()` and
`SCALE_CATALOG`, preserving the existing selection and ordering. Flats and sharps
use musical glyphs visually while each formula retains its original accessible
label. It shares the ear-training domain and the existing dark/light tokens.


### Sign in

`/auth` uses one compact neutral Studio Desk panel, inset credential fields and a
password visibility toggle. Sign-in and registration share the same form, with
inline confirmation and error states and the existing resend action. The route
keeps SvelteKit form actions, progressive enhancement, autocomplete, registration
validation and non-enumerating confirmation copy. Both themes use shared tokens;
prototype state controls and sample responses are not shipped.

### Daily and Deep practice desk

The approved taller Studio Desk session uses the existing Svelte session engine,
with a recessed music area and a 220px key-progress rail on wide screens. Below
1050px the ring and End Session move below the music. Chord rows remain 128px;
notation rows are 204.8px (60% taller), with a 140.8px music frame, 10px inner
vertical padding and a separate 28px cue lane. The viewport reserves 460.8px so
notation appearing or disappearing between cycles does not move the controls.
Listen and Play share frame geometry, using semantic phase tokens (approved orange/brass; native orange migration pending);
the entrance frame stays dashed until recording is audible.

Production notation stays in abcjs, preserving real notes, accidentals, written
pitch and ledger lines. Adjacent chord rows follow the active staff's measured
bar boundaries when both cover the same full progression. A windowed excerpt of
a longer progression retains its own geometry. Resize measurements include the
SVG's actual scale; playback updates move only the highlight, never re-engrave.
The current bar has a restrained wash and thin underline. Ring keys retain tier
colours and current/pending outlines; percentages are available in accessible
key descriptions and session reports rather than tiny visible ring labels.

Daily/Deep/Focused transitions, reveal policy, three-pass scoring, recordings,
report actions and persistence remain owned by their existing state and audio
modules. In particular, the original rule hides notation at twelve unlocked keys.
Browser regression coverage includes the 11-key notation layout and 12-key ring,
mobile/desktop geometry, ledger-note clearance and the existing session flows.


### Lick Editor

The editor uses the approved score-first Studio Desk layout: title and real abcjs
notation above transport, the shared duration/pitch controls beneath, and a
compact Setup/Details inspector. The inspector stacks below the workspace at
900px; a narrow screen scrolls the score within its inset well. All surfaces
use the shared dark/light tokens. The global navigation remains the app's own.

The existing step-entry store owns pitches, rests, ties, duration choices,
key/mode conversion, the 1–4 bar range and written/concert transposition. Entry
still appends A–G/0; selection targets pitch/spelling changes and deletion.
Saving, duplicate-to-Steal handling, attribution suggestions, community privacy,
practice membership and edit identity retain the existing persistence paths.
Prototype example data, draft storage and unsupported tags/progression fields
are not shipped.

Undo/redo snapshots phrase content and setup, excluding selection, playback and
the saved lick's identity. History is bounded to 50 edits and resets on saves
and target changes. Clear removes only notes after confirmation and is undoable.
The preview tempo is local to this editor; it does not overwrite Settings. Loop
uses the real phrase playback engine, with one cancellation generation covering
sample loading and subsequent repeats. Per-note cursor events use that engine's
audio clock. Dialogs use native modal focus handling and suppress editor shortcuts.


### Add Licks

The entry uses a shared Studio Desk panel with Editor first and Record marked
Experimental. The two linked bays retain `/licks/editor` and `/licks/record`,
with the existing descriptions and decorative keyboard/microphone illustrations.
They stack below 600px and use the shared dark/light surfaces, focus treatment
and page shell. The global navigation and the editor/recorder behavior are unchanged.


### Community Licks listening desk

`/licks/community` shares the My Licks `StudioPage` and numbered `StudioPanel`.
Its compact index selects one phrase for a stable, dark reading desk rather than
expanding cards. Each 76px row shows a title, author and subtly tinted harmonic
category. `CommunityProgression` uses the shared progression palette; community
phrases use their declared category because they do not yet have the reader's
personal practice tags. Generic styles retain the neutral brass treatment.

The full score uses the existing `NotationDisplay` and lead-sheet adapter, with
four measures per staff and no phrase truncation. The desk reserves score space so
switching between two- and four-measure phrases does not move the action row.
On phones the index scrolls horizontally and dense notation scrolls within its
own region. Key and length metadata and length filters are omitted. Search,
style, author, difficulty, sorting, favorites and book membership use the existing
community services. Selecting another phrase or changing filters cancels the
current audition; the details link preserves access to the existing lick route.


### Tune Detail and Tune Editor

Tune Detail (`/tunes/[id]`) and Tune Editor (`/tunes/editor`) share the Lick
Editor Studio Desk shell, inset score, grouped transport/accompaniment and
right-hand Setup inspector. The approved reference is MagicPath component
`459518519676121088`, revision `461185056698941440`. Page headings own metadata;
`omitMasthead` avoids reserving duplicate engraving space. The score scrolls
inside its well on phones and the inspector stacks below the workspace.

`TuneTransport` uses production phrase playback with expanded repeats, local
tempo and loop, instrument samples, swing, metronome and backing controls.
Music edits, settings changes and navigation cancel pending or active preview.
Harmony overlays use conservative chord-role matching relative to the tune key;
unclassified harmony remains neutral, and the user can hide all colors.

The editor retains click-to-enter notes, inline chord editing, sections, pickup
bars, source-pitch conversion and imported-PDF review. Non-4/4 charts retain
chord and section editing without enabling unsupported melody entry. Bounded
undo/redo stores tune content and setup while preserving edit identity and
source-review data. Curated tunes open as unsaved personal copies; community
adoption, attribution and existing library actions keep their original paths.


## Shared musical interface contracts · Design System 1.3

The MagicPath reference is component `460231915702722560`, revision
`461202969724080128`. Its reusable `MusicKit.tsx` / `MusicKit.css` extends
`ConsoleKit` with `PhaseCue`, `ScoreWell`, `DurationGlyph`, `DurationBank`,
and a control-state transport example. The score is explicitly illustrative;
production continues to use the actual notation and audio engines. Prototype
files are independent copies, not live dependencies. Updating this reference
or its MagicPath skill does not update every existing page.

### Notation and score surfaces

- Reuse `NotationDisplay`, `ChordSymbolText`, `notation.ts` and
  `tune-notation.ts`; preserve the shared chord, enharmonic, written-pitch,
  pickup and repeat rules. Do not invent a second engraver in page components.
- Use the inset Studio Desk well with theme-aware ink. Render metadata once
  in the page header; retain an accessible score name when omitting a masthead.
- Render the complete phrase. Four-bar licks always occupy one system; reserve score height to align short
  and long phrases. Longer phrases may continue on subsequent four-bar systems. At phone
  widths, scroll inside the score region; do not shrink dense notation into
  illegibility or let it create page-wide overflow.
- Preserve the established engraving work: `c04600ea` groups straight eighths
  4 + 4 in 4/4 (four in 2/4), with sixteenth-note spans grouped per beat;
  `015b33eb` retains automatic pitch-based stem direction, including beam-group
  direction, by declaring the invisible chord voice `V:H stem=down`. Keep
  rhythmic spacing, shared chord typography and enharmonic spelling intact.
  Prototype scores must use output from the real renderer, never hand-drawn
  substitute noteheads, stems or beams.
- Preserve ledger lines, accidentals, rests, ties, beams and meter. Validate a
  four-measure phrase with 32 eighth notes, pickups and long chord labels.
- Keep selection, insertion position, playback cursor and review warnings
  distinct. Playback moves the highlight using the audio clock without
  re-engraving the score. Color is supplementary to labels and geometry.

### Shared editing controls

Lick Editor and Tune Editor use the same `DurationSelector`,
`PitchEntryPanel`, `EditorIcon` and step-entry store. Duration glyphs are SVG,
not platform-dependent emoji. Base durations are whole, half, quarter,
eighth and sixteenth. Dotted applies only to half/quarter/eighth; triplets
apply to whole/half/quarter/eighth. Disable unsupported modifiers. Preserve
existing shortcuts (1–5, A–G, 0 for rest), accidental, octave, tie and delete
behavior; suspend shortcuts in text inputs and dialogs. Keep selected,
focused and disabled states visibly distinct, with accessible control names.

The shared layout order is score, transport, note entry, then setup/details;
on wide screens the inspector sits at the right. The inspector stacks below
900px. Tune-specific sections, inline harmony, pickups and PDF review extend
that structure. Do not expose melody entry for unsupported meters. Undo/redo
tracks musical content and setup, not selection/playback or saved identity;
retain the bounded history and confirmation/undo behavior of Clear.

### Playback and accompaniment

Group tempo, swing, metronome and backing together with spacing between
transport and accompaniment. Use one editable control per setting. Preview
tempo is local to the editor. Keep dependent backing/metronome controls mounted
and disabled when off, preserving both dimensions and chosen values. Reuse
`TuneTransport` and the existing phrase audio lifecycle: pending sample loads,
loops and active sound cancel on edits, settings changes and navigation.
Visual Play/Stop and cursor state must reflect the real audio lifecycle.

### Two distinct harmonic color systems

| Signal | Source | Meaning |
| --- | --- | --- |
| Lick category identity | `progressionColor()` / `--prog-*` | Same progression hue in My Licks, Community and practice |
| Tune chord role | `tuneHarmonyMarkers()` / `--tune-*` | Optional subtle tonic, subdominant or dominant tint |

The complete progression palette remains in `app.css`, with dark/light pairs.
Community uses the declared category, not the reader's personal tags. Generic
or unknown categories retain a neutral treatment. Tune role colors are
`#9ab1ce` / `#8ab7aa` / `#d8b67b` in dark mode and `#42658b` / `#3b7c6b` /
`#966323` in light mode. Preserve conservative role matching; unclassified
harmony stays neutral. Never substitute either system for phase, error,
selection, difficulty or accuracy colors.

### Recent page patterns and status

| Pattern | Reference | Status |
| --- | --- | --- |
| Community Listening Desk | Component `461167035594973184` | Native Svelte; compact index, stable full score, no white cards, expansion, key or length labels/filters |
| Lick Editor | `459517965835059200` / `460811927849934848` | Native Svelte; shared score/input/inspector hierarchy |
| Tune Detail + Editor | `459518519676121088` / `461185056698941440` | Native Svelte; extends Lick Editor with tune operations |
| Add Licks | `459517917629935616` / `460936884772802560` | Native Svelte; Editor first, Record Experimental |
| PDF Import | `459518569684811776` / `461190228670046208` | Design prototype; Svelte conversion pending |

PDF Import reuses the editing workspace language: file input/source preview,
source-pitch and meter setup, optional OMR disclosure, cancellable recognition,
then source-aware review in the editor. Distinguish empty, selected, loading,
cancelled, error and review states. Uncertain notes remain visibly uncertain;
marking a passage reviewed does not silently correct it. Demo recognition and
sample music must remain labelled as examples until connected to real services.

The existing Home, Settings, Practice, Progress, Scales and Sign in patterns
above remain canonical. Retain real data, empty states, account actions and
musical behavior when adopting the visual system.

### Consistency review for every adoption

Check desktop, tablet and phone widths; both native themes; keyboard focus
and control semantics; empty/loading/error/review/disabled states; dense
notation and ledger-line clearance; stable geometry across phrase and phase
changes; persisted settings and playback cancellation. Keep the source,
reference component, MagicPath skill and native component map aligned. Record
prototype-only changes and native migration gaps instead of treating a visual
reference as proof of implementation or deployment.


### Individual lick detail · Studio Desk

`/licks/[id]` uses MagicPath component `461192586053427200`, revision
`461202782066741248`. The native Svelte page shares `StudioPage`, `StudioPanel`,
`CommunityProgression` and the existing notation renderer. Its score is primary,
with a written-key selector and Listen transport directly beside it. Practice
membership and fit-gated progression tags occupy the right inspector; details,
category editing and descriptive tags live in a disclosure. Personal progress
and reset sit below the score. Ownership restrictions and delete/reset
confirmation remain explicit, with cancellation.

The complete phrase uses four measures per system with reserved score space;
dense music scrolls within the well on phones. The inspector stacks below
900px. No length badge is shown. Key selection is a functional transposition
control, not redundant catalog metadata. Changing key, instrument or lick
cancels the previous audition. Existing async loading/not-found fencing, real
saved progress and Deep Practice handoff are retained. The prototype uses static SVG specimens exported from the native renderer in all
twelve written keys; its controls remain illustrative. The Svelte page uses actual
data and audio. The reference kit and prototype must preserve engraving geometry
when adapting color or surrounding controls.


Lick-detail progress markers name the unlocked key in written pitch using the
saved lick's entry key and the existing unlock order. The score's temporary
"Play in" selection does not change historical key labels. Small brass note-name
labels replace key-shaped icons; crowded events combine as `G+2`, with every
name retained in the tooltip and chart's accessible description. Progress
samples and expertise thresholds are unchanged. Shared trick charts without a
known lick entry key retain their existing count-based markers.

Lick progress graphs separate the tempo plot from the practice-stage guide.
Do not float stage names inside plot regions: New measures key coverage, while
Learning, Proficient and Expert require all twelve keys and follow tempo. Show
explicit requirements in a fixed ordered guide beneath the chart, mark the
current stage with text as well as color, and use numbered tempo gridlines.
Keep the guide readable in two columns on phones.

### Admin operations desk

`/admin` uses the neutral Studio Desk shell with a compact totals strip, a
searchable user list and a service/activity rail. Align account facts for
comparison; keep browser details and activity definitions in disclosures.
Content inspection stays with its user row in an inset well. Use the shared
notation renderer with four-bar systems and horizontal scrolling inside the
score well on phones. Keep admin-only access, adoption protection, typed
confirmations, pending actions, unavailable/partial data notices and current
server actions intact. Never substitute sample values for live account data.
The MagicPath reference uses explicitly fictional accounts and system data:
Admin · Operations Desk, component `461211093453402112`, revision
`461211093453402113`. The rail stacks below the user list at 900px.

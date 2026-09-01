# API Reference: Components

All Svelte components organized by domain. Each uses Svelte 5 `$props()` for inputs and `$derived`/`$effect` for reactivity.

**Source:** `src/lib/components/`

---

## Audio Components

### `MicStatus.svelte`

**Path:** `src/lib/components/audio/MicStatus.svelte`

Displays microphone status with an input level meter and permission request button.

| Prop | Type | Description |
|---|---|---|
| `permission` | `MicPermissionState` | Current mic permission state |
| `inputLevel` | `number` | Input level 0–1 |
| `onrequest` | `() => void` | Callback to request mic access |

**Behavior:**
- `granted` → Shows colored dot + "Mic active" + level meter bar (green/yellow/red)
- `prompt`/`denied` → Shows "Enable Mic" / "Retry Mic" button
- `unavailable` → Shows "No mic available"

### `PitchMeter.svelte`

**Path:** `src/lib/components/audio/PitchMeter.svelte`

Real-time pitch display with cents deviation meter and clarity bar.

| Prop | Type | Description |
|---|---|---|
| `midi` | `number \| null` | Current detected MIDI note |
| `cents` | `number` | Cents deviation (-50 to +50) |
| `clarity` | `number` | Detection clarity 0–1 |
| `active` | `boolean` | Whether detecting/recording |

**Display:**
- Note name in large text, colored by tuning accuracy
- Horizontal cents meter with center line and sliding indicator
- "flat" / "sharp" labels with numeric cents value
- Clarity progress bar (only when active)

**Tuning color thresholds:**
- <= 10 cents: green (success)
- <= 25 cents: yellow (warning)
- \> 25 cents: red (error)

### `TransportBar.svelte`

**Path:** `src/lib/components/audio/TransportBar.svelte`

Play/stop button, tempo slider, and metronome toggle.

| Prop | Type | Description |
|---|---|---|
| `isPlaying` | `boolean` | Playback active |
| `isLoading` | `boolean` | Instrument loading |
| `tempo` | `number` | Current BPM |
| `metronomeEnabled` | `boolean` | Metronome on/off |
| `onplay` | `() => void` | Play callback |
| `onstop` | `() => void` | Stop callback |
| `ontempochange` | `(tempo: number) => void` | Tempo change callback |
| `onmetronometoggle` | `() => void` | Metronome toggle callback |

**Tempo range:** 40–300 BPM. Disabled during playback.

---

## Notation Component

### `NotationDisplay.svelte`

**Path:** `src/lib/components/notation/NotationDisplay.svelte`

Renders either a single-phrase staff or a full multi-system tune chart, using [abcjs](https://paulrosen.github.io/abcjs/). One component serves the lick editor, the practice pages, the tune detail chart, and the tune-practice session.

| Prop | Type | Description |
|---|---|---|
| `phrase` | `Phrase \| null` | Single phrase to render |
| `tune` | `Tune \| null` | Full song form — chord symbols, section markers, multi-system reflow. **Takes precedence over `phrase`**; click/highlight indices then refer to `flattenTune(sheet).notes` order |
| `instrument` | `InstrumentConfig` | Optional; transposes to written pitch |
| `variant` | `'practice' \| 'print'` | House style. `print` uses light ink + the engraved Real Book masthead; `practice` keeps the dark interactive chrome. Default `practice` |
| `selectedIndex` | `number \| null` | Source-array index to highlight. Default `null` |
| `cursorIndex` | `number \| null` | Playback cursor, styled distinctly from `selectedIndex` |
| `rangeMarkers` | `RangeMarker[]` | Insertion-point bands (tune charts only) |
| `playheadStyle` | `PlayheadStyle` | Visual treatment for `status: 'playhead'` markers. Default `'under-bar'` |
| `autoScrollPlayhead` | `boolean` | Follow the playhead inside a clipped viewport. Default `false` so multi-chart pages don't fight over window scroll |
| `playheadBarFraction` | `number \| null` | Fractional absolute notation bar (e.g. `3.42`) for continuous follow-scroll; without it, scroll keys off the discrete playhead marker |
| `onSelect` | `(sourceIndex: number) => void` | Fires when the user clicks a pitched notehead |
| `onBarClick` | `(pos: { sectionIdx, bar }) => void` | Fires on a bar's empty space, a rest, or a chord symbol; enables the per-bar hit rects |
| `chordEditor` | `{ textAt, commit, clear }` | Inline on-chart chord editing. Enables per-beat hit rects above the staff; `commit` returning `false` flashes the input and keeps it open, blank input calls `clear` |
| `titleArea` | `Snippet` | Custom header rendered above the staff |
| `tuneOptions` | `TuneAbcOptions?` | Engraving options for the `tune` path — `mode` (minor prints `K:Dm` and the relative major's signature), `barsPerLine`, `stretchLast`, `measureNumbers` |
| `frameless` | `boolean?` | No chrome: drops the "Chart" liner, padding and panel background so the staff sits inside a host that owns its own frame (the lick-practice key stack) |
| `staffWidth` | `number?` | abcjs staff width in SVG units (default `CHART_STAFF_WIDTH`); a host that sizes the SVG by height asks for a wider staff so one system spans its row |

**Behavior:**
- Lazy-loads `abcjs` on mount.
- Phrases convert via `phraseToAbcWithMap()`; tunes via `tuneToAbcWithMap()`, which also returns bar and chord-slot anchors.
- Responsive rendering (`responsive: 'resize'`); dark-mode support overrides SVG path/text colors via CSS.
- Clicking a pitched notehead calls `onSelect` with the note's source-array index (resolved through the anchor map). Rests are not selectable.

**Re-render asymmetry — this is deliberate and load-bearing.** Changing `selectedIndex` re-renders the chart. Changing `cursorIndex` or a marker's `status` does **not**: a dedicated effect swaps a CSS class on the stashed anchors and a handful of overlay rects. That is what makes it safe to drive the cursor per-note and the bands per-window during playback without re-engraving a multi-system chart every frame.

Hit-zone geometry, the abcjs adapter, follow-scroll math, and ending alignment all live in `src/lib/notation/` as DOM-free, Node-testable modules — see [Tune System](../architecture/tune-system.md#engraving).

Shows "No phrase loaded" placeholder when both `phrase` and `tune` are null.

---

## Practice Components

### `PhraseInfo.svelte`

**Path:** `src/lib/components/practice/PhraseInfo.svelte`

Compact display of the phrase's key and chord symbols.

| Prop | Type | Description |
|---|---|---|
| `phrase` | `Phrase` | The phrase |
| `instrument` | `InstrumentConfig?` | When given, a key line shows the tonic in WRITTEN pitch with its mode ("Key: D minor", via `keyLabelLong` + `lickMode`) |

Shows a pipe-separated list of chord symbols derived from `phrase.harmony` (via `chordSymbol`), rendered only when at least one chord is present.

### `FeedbackPanel.svelte`

**Path:** `src/lib/components/practice/FeedbackPanel.svelte`

Post-attempt scoring feedback with grade display and action buttons.

| Prop | Type | Description |
|---|---|---|
| `score` | `Score` | Score from the attempt |
| `onrepeat` | `() => void` | "Try Again" callback |
| `onnext` | `() => void` | "Next Phrase" callback |

**Layout:**
1. Large grade label with color (e.g. "Perfect" in green)
2. Overall percentage
3. Notes hit count (e.g. "6/8 notes hit")
4. Pitch/Rhythm breakdown with progress bars
5. `NoteComparison` grid
6. "Try Again" and "Next Phrase" buttons

### `NoteComparison.svelte`

**Path:** `src/lib/components/practice/NoteComparison.svelte`

Per-note comparison grid showing expected vs played notes.

| Prop | Type | Description |
|---|---|---|
| `noteResults` | `NoteResult[]` | Per-note scoring results |
| `transpositionSemitones` | `number?` | Semitones added for written-pitch display (e.g. `14` for tenor sax). Defaults to `0`. |
| `displayKey` | `string?` | Written-pitch key (e.g. `"B"` for an A-concert tenor session); drives accidental spelling |
| `harmony` | `HarmonicSegment[]?` | The phrase's harmony (concert pitch) so each note is spelled against the chord that governed it — exactly what the chart showed. The progress page re-resolves it (`findPhraseForSession` for ear-training rows, the lick transposed to the key for lick-practice rows). |
| `displayScaleId` | `string?` | Fallback frame when no chord governs a note: the session's scale (e.g. `'blues.minor'`) rooted at `displayKey`. Without either, a key with no signature spells every black key sharp — a written-C blues listed its b7 as A#. |
| `displayMode` | `Mode?` | Major/minor reading of `displayKey` (the progression's mode for lick-practice rows, the re-resolved phrase's `lickMode` for ear-training rows); a minor session's notes are spelled against its relative major's signature. Default `'major'`. |
| `timing` | `TimingDiagnostics?` | Timing diagnostics from the scorer; drives the Offset column and footer |

Filters out extra notes (only shows matched and missed). Columns: index, expected note name, played note name (colored by accuracy), pitch %, rhythm %, and per-note timing offset in ms (colored by lateness/earliness). Names go through the shared enharmonic policy (`spellingContextAt` + `resolveUseFlats` in `music/notation.ts`); a played note is read against the chord of the expected note it answered. When `timing` is present, a footer below the grid also shows overall bias, spread, and latency correction.

### `ScoreStrip.svelte`

**Path:** `src/lib/components/practice/ScoreStrip.svelte`

Horizontal SVG strip of paired pitch/rhythm bars — one pair per matched note — used for compact score visualization.

| Prop | Type | Description |
|---|---|---|
| `noteResults` | `NoteResult[]` | Per-note scoring results |
| `transpositionSemitones` | `number?` | Semitones added for written-pitch display (e.g. `14` for tenor sax). Defaults to `0`. |

Extra notes are filtered out. Each matched note renders a pair of bars; bar **height** encodes the score (`pitchScore` / `rhythmScore` × `MAX_H`). **Color** is a fixed hue per metric — pitch bars use `var(--color-accent)`, rhythm bars use `var(--color-brass)`, matching the progress complexity meters. Missed notes render as a dashed "miss" outline instead of a bar.

---

## Licks Components

### `LickCard.svelte`

**Path:** `src/lib/components/licks/LickCard.svelte`

Card displaying a curated lick's metadata.

| Prop | Type | Description |
|---|---|---|
| `lick` | `Phrase` | The lick |
| `onclick` | `() => void` | Optional click handler |
| `onplay` | `() => void` | Optional; renders a play/stop button in the corner |
| `isPlaying` | `boolean` | Optional; toggles the play button to a stop button. Defaults to `false` |
| `authorName` | `string \| null` | Optional; renders a "by <name>" attribution (for stolen community licks). Defaults to `null` |
| `progress` | `LickPracticeProgress \| null` | Optional; per-lick practice progress. With `showStats`, drives the last-practiced line. Defaults to `null` |
| `showStats` | `boolean` | Optional; renders the last-practiced line (requires `progress`). Defaults to `false` |

Shows: name, optional author attribution (`authorName`, for stolen community licks), category label, difficulty name + level (color-coded), progression tags, up to 4 filtered tags, and an optional last-practiced line (when `showStats` + `progress` are provided).

**Difficulty colors** — the card calls `difficultyDisplay()` (which shares the band/color logic with `difficultyColor()`) in `src/lib/difficulty/display.ts`, mapping the 1-100 scale to 10 bands. Each band's color is the theme-aware CSS custom property `var(--difficulty-N)` (defined in app.css: muted green for easy → amber → muted brick-red for hard), not a literal hex — so the ramp re-steps automatically between the dark and light themes.

| Band | Range  | Name         | Color                 |
| ---- | ------ | ------------ | --------------------- |
| 1    | 1-10   | Beginner     | `var(--difficulty-1)`  |
| 2    | 11-20  | Elementary   | `var(--difficulty-2)`  |
| 3    | 21-30  | Easy         | `var(--difficulty-3)`  |
| 4    | 31-40  | Moderate     | `var(--difficulty-4)`  |
| 5    | 41-50  | Intermediate | `var(--difficulty-5)`  |
| 6    | 51-60  | Challenging  | `var(--difficulty-6)`  |
| 7    | 61-70  | Advanced     | `var(--difficulty-7)`  |
| 8    | 71-80  | Expert       | `var(--difficulty-8)`  |
| 9    | 81-90  | Master       | `var(--difficulty-9)`  |
| 10   | 91-100 | Virtuoso     | `var(--difficulty-10)` |

These are intentionally independent of the domain accent so a lick's difficulty reads the same in the ear-training and lick-practice views.

> **Related color helpers.** `difficultyColor()`/`masteryDisplay()` (`src/lib/difficulty/display.ts`) return theme-aware `var(--difficulty-N)` / `var(--mastery-N)` tokens for *how hard* / *how mastered*. For **performance scores** (poor → perfect) use `accuracyTier(score01)` (`src/lib/ui/score-colors.ts`), which returns the discrete medal tier (`var(--accuracy-*)`) — used by grade readouts, the lick key ring, per-key report chips, and per-note pitch/rhythm. See the Accuracy medal scale in `documentation/architecture/design-system.md`.

### `CategoryFilter.svelte`

**Path:** `src/lib/components/licks/CategoryFilter.svelte`

Horizontal pill buttons for filtering by category.

| Prop | Type | Description |
|---|---|---|
| `categories` | `{ category: PhraseCategory; count: number }[]` | Available categories |
| `selected` | `PhraseCategory \| null` | Currently selected (null = all) |
| `onselect` | `(category: PhraseCategory \| null) => void` | Selection callback |

Includes an "All (N)" button plus one pill per category with count.

---

## Lick Practice Components

Rendered by `/lick-practice` during multi-key lick drills.

### `PracticeSetup.svelte`

**Path:** `src/lib/components/lick-practice/PracticeSetup.svelte`

Pre-session configuration screen: chord progression, backing style, mode, duration, tempo increment.

| Prop | Type | Description |
|---|---|---|
| `config` | `LickPracticeConfig` | Current config |
| `availableLickCount` | `number` | Number of licks matching the progression filter |
| `onstart` | `() => void` | Start the session |
| `onupdate` | `(config: Partial<LickPracticeConfig>) => void` | Partial config update |

### `LickHeader.svelte`

**Path:** `src/lib/components/lick-practice/LickHeader.svelte`

Current-lick header: name, number in the session, key index, and progression label. The big key label is written pitch in the PROGRESSION's mode — a minor ii-V-i in D reads "Dm" (`keyLabel` + `progressionMode`).

| Prop | Type | Description |
|---|---|---|
| `phraseNumber` | `number` | 1-based index of the active lick in the session |
| `phraseName` | `string` | Display name |
| `currentKey` | `PitchClass` | Concert-pitch key (converted to written for display, labelled in the progression's mode) |
| `progressionType` | `ChordProgressionType` | Active progression |
| `keyIndex` | `number` | 0-based index of current key within the 12-key cycle |
| `totalKeys` | `number` | Usually 12 |

### `KeyProgressRing.svelte`

**Path:** `src/lib/components/lick-practice/KeyProgressRing.svelte`

Circular progress visualization of the 12-key cycle with passed/failed/current/pending dots.

| Prop | Type | Description |
|---|---|---|
| `keys` | `PitchClass[]` | Keys in playback order |
| `currentKeyIndex` | `number` | Active key index |
| `keyResults` | `LickPracticeKeyResult[]` | Results so far |
| `tempo` | `number` | Displayed at the centre of the ring |
| `mode` | `Mode?` | Major/minor reading of the dot labels (the progression's mode): "Dm" for a minor drill. Default `'major'`. |

### `ChordChart.svelte`

**Path:** `src/lib/components/lick-practice/ChordChart.svelte`

Chord chart for the current progression, with the active cell highlighted in time with playback.

| Prop | Type | Description |
|---|---|---|
| `harmony` | `HarmonicSegment[]` | Current progression |
| `currentBeat` | `number` | Active beat within the progression |
| `timeSignature` | `[number, number]` | From the phrase |
| `isPlaying` | `boolean` | Drives highlight |
| `instrument` | `InstrumentConfig?` | Transposes chord roots to written pitch when provided |
| `key` | `PitchClass?` | Concert-pitch key, drives sharp/flat chord spelling |
| `mode` | `Mode?` | Major/minor reading of `key` — minor keys spell roots against the relative major's signature. Default `'major'`. |
| `dotsOnly` | `boolean?` | Beat clock only: no "Changes" label and no chord names (kept for assistive tech) — the lead-sheet row engraves the chords above its staff and keeps this strip for the beat dots and cell progress |

Each cell prints its symbol MuseScore-Jazz style (`chordChartSymbol` in `ui/chord-chart-layout.ts` → `layoutChordParts`): root + quality on the baseline and alterations as a raised column to the right — "A7" with "b9" above-right for the minor templates' V — with the flat text ("A7b9") as the cell's `title`/`aria-label`.

### `UpcomingKeysDisplay.svelte`

**Path:** `src/lib/components/lick-practice/UpcomingKeysDisplay.svelte`

Stepped preview strip showing the previous, current, and upcoming key chord charts. The current row holds one slot below the top for its whole key (the just-played row and its score flash stay visible above it) and the stack steps by that row's height at each key change, eased by a CSS transition — it never drifts, because an engraved staff crawling a pixel per frame strobes. Row key labels read in each planned phrase's mode (`keyLabel(written, lickMode(pk.phrase))` — "Dm" on a minor drill) and the embedded `ChordChart` gets the same `mode`.

A row whose `PlannedKey.reveal` is set (the key's rolling score is under the floor) renders as a **lead-sheet row** (`data-testid="lead-sheet-row"`): `leadSheetTuneFor` (`music/lead-sheet.ts`) wraps the row's phrase as a one-section Tune for `NotationDisplay` (`frameless`, `staffWidth` 1000, `tuneOptions` from `leadSheetAbcOptions` — the phrase's mode, one stretched system, no bar number), the note at the current beat lit via `cursorIndex` (`noteIndexAtBeat`, `music/beat-cursor.ts`), a `dotsOnly` `ChordChart` beneath as the beat strip, and a caption *Sheet music while A is under 75%* (written pitch, percentage from `KEY_FLOOR_THRESHOLD`). Lead sheets are built once per stack so abcjs engraves each row once. Rows are fixed heights (105 px chord row, 196 px lead row; the staff box is clipped) and `keyStackLayout` (`ui/key-stack-layout.ts`) holds the active row one slot below the top for mixed heights and reserves the viewport for two tall rows so the ring below never moves.

| Prop | Type | Description |
|---|---|---|
| `plannedKeys` | `PlannedKey[]` | All keys for the current lick |
| `scrollFraction` | `number` | Continuous scroll position in "key units" (0 = first key, 1 = second key, …) |
| `currentBeat` | `number` | Active beat in the currently-playing key |
| `isPlaying` | `boolean` | Session running |
| `isRecording` | `boolean` | Current key's recording window is open |
| `cue` | `PhaseCue?` | Drives the phase tab on the active row (brass LISTEN / on-air PLAY with countdown + entry key / "Straight in" turnaround). Omit for no tab |
| `isArming` | `boolean?` | Lead-in bar before the recording window — dashes the active row's ring |
| `scoreFlash` | `{ key, score, at }?` | Tier-colored score chip flashed on the matching key's row |
| `instrument` | `InstrumentConfig` | Used for written-pitch chord and key labels |

### `PhaseCueBar.svelte`

**Path:** `src/lib/components/lick-practice/PhaseCueBar.svelte`

Standalone listen/play cue pill: a lamp, a speaker/microphone glyph, the phase label (*Count in* / *Listen* / *Play* / *Rest*), and a countdown during the lead-in bar. During a countdown into `listen`/`play` the bar tints toward its incoming phase (`--arm` strength `(5 − countdown)/5`, ramping across the 4-beat lead-in bar to 4/5 on the final beat) so the switch is felt before it is read; counting into a rest is deliberately not announced. Used by the cue-preview dev route and the record-a-lick page (`/licks/record`), where it carries the whole count-in → *Play in 4…1* → on-air sequence; the lick-practice session renders the same `PhaseCue` data as a tab pinned to the active `UpcomingKeysDisplay` row instead.

| Prop | Type | Description |
|---|---|---|
| `cue` | `PhaseCue` | From `phaseCueAt(transport.ticks, timeline, PPQ)` (`src/lib/state/lick-practice-phase.ts`) |

### `SessionTimer.svelte`

**Path:** `src/lib/components/lick-practice/SessionTimer.svelte`

Linear progress bar + `mm:ss` remaining time. Switches to error color and shows `+mm:ss` overtime when `elapsedSeconds > totalSeconds`.

| Prop | Type | Description |
|---|---|---|
| `elapsedSeconds` | `number` | |
| `totalSeconds` | `number` | Session budget |

---

## Progress Components

Rendered by the `/progress` dashboard. These components read directly from `history.svelte.ts` state — props are limited to what needs to be parameterized.

### `StreakDisplay.svelte`

**Path:** `src/lib/components/progress/StreakDisplay.svelte`

Current streak, longest streak, and a 30-day practice dot grid. No props — reads `progress.streakDays`, `progressMeta.longestStreak`, and `getLast30Days()` directly.

### `PracticeCalendar.svelte`

**Path:** `src/lib/components/progress/PracticeCalendar.svelte`

GitHub-style calendar heatmap of the last ~53 weeks, colored by average overall score and session count. No props — queries `getSummariesInRange()` for its date range.

### `TrendChart.svelte`

**Path:** `src/lib/components/progress/TrendChart.svelte`

Line chart of Tonal Mastery (average proficiency across 12 scales + 12 keys, 0-100 scale) over a selectable period (1w/1m/3m/6m/1y/all). Auto-scales the Y axis to the data with a floor.

| Prop | Type | Description |
|---|---|---|
| `summaries` | `DailySummary[]` | Typically `dailySummaries` from history state |

### `PeriodCompare.svelte`

**Path:** `src/lib/components/progress/PeriodCompare.svelte`

Week-over-week / month-over-month comparison of sessions, practice days, average score, pitch, and rhythm. No props — calls `comparePeriods()` with ranges from `getWeekRanges()` / `getMonthRanges()`.

---

## Step Entry Components

Rendered by `/licks/editor` and `/licks/add`. All three components read and mutate `stepEntry` state directly (no props).

### `EntryConfig.svelte`

**Path:** `src/lib/components/step-entry/EntryConfig.svelte`

Key (`stepEntry.phraseKey`, options labelled in the current mode — "Dm" when minor), a **Major | Minor** toggle (`setPhraseMode`; never moves notes), a **Read as {relative key}** button (`switchToRelativeKey` — F major ↔ D minor with the notes untouched), the "Move notes" checkbox for key changes, and the bar-count (1–4 via `setBarCount`) selector.

### `DurationSelector.svelte`

**Path:** `src/lib/components/step-entry/DurationSelector.svelte`

Duration picker (whole / half / quarter / eighth / sixteenth) with keyboard shortcuts `1`–`5`, a triplet toggle (`T`) and a dotted toggle (`.`).

A modifier the current base has no variant for is disabled and rendered inert — there is no sixteenth triplet and no dotted whole note in this vocabulary. `resolveDurationId()` in `src/lib/step-entry/durations.ts` is the single resolver for both the entered fraction and this component's label, so the two cannot disagree; `toggleTriplet`/`toggleDotted` refuse to switch an inapplicable modifier *on*, since the keyboard bypasses the disabled button.

### `PitchEntryPanel.svelte`

**Path:** `src/lib/components/step-entry/PitchEntryPanel.svelte`

Pitch-name buttons (`C`–`B`), accidental toggles (`[` flat, `]` sharp), octave adjust, rest, and delete-last. Calls `addNote()` / `addRest()` / `deleteLastNote()` / `setAccidental()` / `adjustOctave()`.

---

## Onboarding Component

### `Onboarding.svelte`

**Path:** `src/lib/components/onboarding/Onboarding.svelte`

Four-state first-run onboarding flow. The root layout mounts it **only on mic-driven practice routes** (`/ear-training`, `/lick-practice`, `/tricks`, `/licks/record`, `/tunes/<id>/practice`) and only **post-hydration** — everywhere else (`/`, `/docs`, `/licks`, `/tunes`, community pages) must render clean for a fresh profile, because crawlers render with empty localStorage and an unconditional overlay used to be the entire visible content of every URL on the site.

| Prop | Type | Description |
|---|---|---|
| `supabase` | `SupabaseClient<Database>?` | Optional; with `session` + `user`, enables cloud-data detection |
| `session` | `Session \| null` | Optional; part of the auth trio |
| `user` | `User \| null` | Optional; part of the auth trio |

When all three auth props are provided, the component checks Supabase for existing progress from another device and, if found, shows a Welcome Back / restore step. Otherwise it reads/writes `settings` state directly.

**States:**
1. **Restore** (Welcome Back) — shown only when cloud data is detected; offers "Restore My Progress" or "Start Fresh Instead"
2. **Instrument** — Select from all `INSTRUMENTS` entries (Concert Pitch, Soprano Saxophone, Tenor Saxophone, Alto Saxophone, Trumpet)
3. **Mic** — Request microphone permission (with "Skip for now" option)
4. **Ready** — Welcome message with "Start Practicing" and "Go to Dashboard" links

The progress-dot UI shows 4 dots when cloud data is detected, 3 otherwise. Completion sets `settings.onboardingComplete = true` and saves.

---

## Home & SEO Components

### `HomeLanding.svelte`

**Path:** `src/lib/components/home/HomeLanding.svelte`

Descriptive landing page rendered by `/` for **signed-out** visitors (signed-in users get the practice dashboard): what the app is, the practice modes, and sign-in/get-started calls to action. Exists so the home URL carries real crawlable content instead of an empty shell behind the onboarding overlay.

### `SeoHead.svelte`

**Path:** `src/lib/components/seo/SeoHead.svelte`

Per-page `<title>` + `meta description`, plus the matching OG/Twitter pairs. Canonical URL and `og:url` are **not** emitted here — the root layout derives them per route, and duplicating them would produce conflicting tags. `app.html` deliberately carries no title/description of its own: SSR output must contain exactly one of each, and first-in-document wins for crawlers (an e2e smoke test guards the single-title invariant).

| Prop | Type | Description |
|---|---|---|
| `title` | `string` | Page title |
| `description` | `string` | Meta description |

---

## Tune Components

**Path:** `src/lib/components/tunes/`

### `TuneCard.svelte`

Book-shelf card for a tune.

| Prop | Type | Description |
|---|---|---|
| `sheet` | `Tune` | The tune |
| `authorName` | `string \| null` | Attribution line for adopted community sheets |
| `badge` | `string` | Origin badge — `'Curated'`, `'Adopted'`; empty string hides it |
| `onclick` | `() => void` | Open handler |

Shows total bars (summed across sections) and the key **in the player's written pitch**, not concert.

### `CommunityTuneCard.svelte`

Browse card for `/tunes/community`.

| Prop | Type | Description |
|---|---|---|
| `item` | `CommunityTune` | Sheet plus its community metadata |
| `isOwnSheet` | `boolean` | Suppresses adopt actions on your own publications |
| `onclick` / `onfavorite` / `onadopt` / `onreturn` | `() => void` | Row actions |

### `ImportResultList.svelte`

Review list shown by every importer before anything is saved.

| Prop | Type | Description |
|---|---|---|
| `sheets` | `Tune[]` | Parsed sheets (a playlist import yields many) |
| `warnings` | `string[]` | Parser warnings; import warnings name the printed bar they refer to |
| `onreview` | `(sheet: Tune) => void` | Load into the editor for correction before saving |
| `onadd` | `(sheet: Tune) => string` | Save directly, returning the new id. **Omit to force review.** |

### `SourceTranspositionSelect.svelte`

"Chart written for" selector — declares what pitch the source chart is in so the importer can shift to concert.

| Prop | Type | Description |
|---|---|---|
| `value` | `SourceTransposition` | Current selection |
| `onchange` | `(value) => void` | Change handler |
| `hint` | `string` | Optional method-specific guidance |

---

## Tune Practice Components

**Path:** `src/lib/components/tune-practice/`

### `SuggestionPickCard.svelte`

Points-mode pick card for the next insertion point.

| Prop | Type | Description |
|---|---|---|
| `entries` | `PickEntry[]` | Ranked suggestions |
| `picked` | `number` | Selected index |
| `onPick` | `(index: number) => void` | Selection handler |
| `disabled` | `boolean` | Locked once the window opens — the take scores the pick made *before* it |

Each row shows a mastery tier (Known / Learning / New) in the tier's colour.

### `LickCelebration.svelte`

Freestyle applause card raised when the recognizer identifies a known lick.

| Prop | Type | Description |
|---|---|---|
| `celebration` | `{ name: string; score: number } \| null` | The recognized lick, or `null` when nothing is celebrating |
| `onDismiss` | `() => void` | Dismiss handler |

Captions are chosen by hashing the lick name — stable per lick, varied across licks, no RNG, so replays feel intentional. The component carries copy only; the confidence gate lives in the recognizer.

---

## Tune Entry Component

### `SectionConfigPanel.svelte`

**Path:** `src/lib/components/tune-entry/SectionConfigPanel.svelte`

Section-list editor for the tune editor: add / remove sections, set label, bar count, repeat flags, and volta ending. Reads and mutates `tuneEntry` state directly (no props).

---

## Trick Components

**Path:** `src/lib/components/tricks/`

The melodic-device ("trick") practice surface at `/tricks` and `/tricks/[id]`. See [Trick Scoring](../architecture/trick-scoring.md) for the domain model.

### `TrickCard.svelte`

Catalog tile for one device on `/tricks`, showing its name, description, and an unlocked-of-total variant count.

| Prop | Type | Description |
|---|---|---|
| `trick` | `Trick` | The device from the `TRICKS` catalog |
| `onclick` | `() => void` | Optional activation handler |

### `TrickMasteryTree.svelte`

The variant ladder on `/tricks/[id]`: unlocked variants, the next locked ones, and each one's total pass count against its prerequisite.

| Prop | Type | Description |
|---|---|---|
| `trickId` | `string` | Which ladder to render |
| `selectedKey` | `string?` | Variant key highlighted as the parent's current selection |
| `onSelect` | `(variantKey: string) => void` | Called when an **unlocked** row is clicked |
| `version` | `number` | Bumped by the parent after a practice-state change to force a re-read |

`version` exists because persisted progress isn't reactive — the tree re-reads `loadTrickUnlockContext()` inside a `$derived.by` that touches `version`. It is SSR-safe: storage reads return `null` on the server, so it renders the empty-progress state rather than throwing.

---

## Diagnostics Components

**Path:** `src/lib/components/diagnostics/`

Used only by `/diagnostics/backing-mixer`, the backing-track listening lab. The protocol they serve is [Backing-track listening](../contributing/backing-listening.md).

### `BlindAbPlayer.svelte`

Blind A/B between the current engine's bounce and a reference WAV the user loads. On "Start blind comparison" the two are shuffled behind neutral X/Y labels and the verdict (`X` / `Y` / `tie`) is recorded **before** the mapping is revealed — which is the entire point: it keeps the author's expectations out of the judgment.

| Prop | Type | Description |
|---|---|---|
| `currentUrl` | `string \| null` | Object URL of the current bounce; changing or clearing it resets any open comparison |
| `currentLabel` | `string` | Label shown after the reveal (default `'Current bounce'`) |

### `ListeningChecklist.svelte`

Renders `LISTENING_CHECKLIST` from `$lib/audio/backing-listening-checklist` — the single source of truth, so the lab UI and the protocol doc cannot drift. Each item cycles blank → ✅ → ❌ → ➖; "Copy report" emits the markdown block pasted into the PR and the listening log.

| Prop | Type | Description |
|---|---|---|
| `presetLabel` | `string` | Stamped into the report header |
| `style` | `string` | Backing style under test |
| `tempo` | `number` | Tempo under test |
| `seed` | `number` | Variation seed under test |

---

## Console Components

**Path:** `src/lib/components/console/`

The Settings page is styled as a studio console rather than a form. These three are the primitives; each carries the same keyboard and screen-reader behaviour as the plain input it replaces.

### `Knob.svelte`

| Prop | Type | Description |
|---|---|---|
| `value` / `min` / `max` / `step` | `number` | Range (step defaults to `0.01`) |
| `label` | `string` | Engraved caption |
| `displayValue` | `string` | Optional readout override |
| `helpText` | `string` | Tooltip hint text |
| `size` | `'sm' \| 'md' \| 'lg'` | Default `'md'` |
| `ariaLabel` | `string` | Accessible name |
| `onInput` | `(v: number) => void` | Live change |
| `onCommit` | `() => void` | Fires on release — persist here, not on every frame |

### `RockerSwitch.svelte`

| Prop | Type | Description |
|---|---|---|
| `checked` | `boolean` | State |
| `label` | `string` | Caption |
| `ariaLabel` | `string` | Accessible name |
| `onChange` | `(checked: boolean) => void` | Toggle handler |

### `SelectorPad.svelte`

Multi-option pad (instrument, theme, backing style).

| Prop | Type | Description |
|---|---|---|
| `options` | `Option[]` | Choices |
| `value` | `T` | Current value |
| `ariaLabel` | `string` | Accessible name |
| `size` | `'sm' \| 'md'` | Default `'md'` |
| `columns` | `number` | Optional grid column count |
| `onChange` | `(v: T) => void` | Change handler |

---

## Tour Components

**Path:** `src/lib/components/ui/`

Guided tours run on [driver.js](https://driverjs.com), configured in `src/lib/tour/driver-config.ts` and defined as step arrays in `src/lib/tour/tours/`. Completion state lives in [`tour.svelte.ts`](./state.md#toursveltets).

### `Tour.svelte`

Declarative driver. Bind `active` to start and stop a tour imperatively; it flips back to `false` on close.

| Prop | Type | Description |
|---|---|---|
| `tourId` | `string` | Stable id recorded in `tourState` |
| `steps` | `DriveStep[]` | Step definitions |
| `active` | `boolean` (bindable) | Drive control |
| `onComplete` / `onClose` | `() => void` | Lifecycle hooks |
| `config` | `Partial<Config>` | driver.js overrides |

### `TourBanner.svelte`

First-run prompt. Offers the tour, or a Skip that records an explicit dismissal.

### `TourTrigger.svelte`

Inline "Need help? Take the tour" link.

| Prop | Type | Description |
|---|---|---|
| `tourId` | `string` | Tour to run |
| `steps` | `DriveStep[]` | Step definitions |
| `label` | `string` | Link text |
| `hideIfSeen` | `boolean` | Hide once completed or dismissed. Default `true` |

> **Completion semantics.** `runTour` marks a tour complete **only** on natural completion (clicking Done on the last step). Closing early — Esc, the X, an overlay click — is "not finished yet", so the banner reappears. Explicit dismissal goes through `TourBanner`'s Skip button, never through driver.js.
>
> **Adding a tour:** write the steps in `src/lib/tour/tours/<name>.ts`, add `data-tour="…"` anchors to the route, and register the tour in `TOURS` (`src/lib/tour/tours/index.ts`) with the path it `startsAt`. Registration is all Settings → *Tours & Help* needs — it navigates to `startsAt`, waits for every step selector to mount, and drives.

---

## Other Components

| Component | Path | Purpose |
|---|---|---|
| `LickProgressChart.svelte` | `licks/` | One SVG tempo panel over an x-axis **scaled by real elapsed time**, so a months-long gap reads wider than a same-day one. Washed with the lick's [phase bands](../../src/lib/difficulty/lick-phase.ts) — horizontal for the tempo phases, a vertical era for `new` (key-count-driven, so it precedes them) — and marked with a key glyph at each unlock, collapsing when they'd overlap. Takes `points: LickProgressPoint[]` |
| `CommunityLickCard.svelte` | `licks/` | Browse card for `/licks/community` |
| `LickBreatherCard.svelte` | `lick-practice/` | The inter-lick score-hold card: finished lick's name, percentage in its accuracy-tier colour, and the next lick. Presentational only — the session page snapshots its content when the last key scores |
| `LickKeyDetail.svelte` | `progress/` | Expandable per-key detail on the progress page, with per-note comparison and replay; takes `harmony` and `displayMode` (the progression's mode) so the note list spells as the session chart did |
| `PrivacyDisclosure.svelte` | `community/` | One-time acknowledgement that saved licks appear in the community browse |
| `SuggestionCard.svelte` | `step-entry/` | Attribution name suggestions in the lick editor, from `lick-suggestions` state |
| `BrassPlayGlyph.svelte` | `jazz/` | Decorative brass play glyph |
| `Tooltip.svelte`, `TooltipHint.svelte`, `InfoIcon.svelte`, `HelpLink.svelte` | `ui/` | Shared help affordances |

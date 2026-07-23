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

Renders sheet music from a `Phrase` using [abcjs](https://paulrosen.github.io/abcjs/).

| Prop | Type | Description |
|---|---|---|
| `phrase` | `Phrase \| null` | Phrase to render |
| `instrument` | `InstrumentConfig` | Optional; transposes to written pitch |
| `selectedIndex` | `number \| null` | Optional; source-array index of the note to highlight (`null` = none). Defaults to `null` |
| `onSelect` | `(sourceIndex: number) => void` | Optional; fires when the user clicks a pitched notehead, with the note's source-array index |
| `titleArea` | `Snippet` | Optional; custom header rendered above the staff |

**Behavior:**
- Lazy-loads `abcjs` on mount
- Converts phrase to ABC notation via `phraseToAbcWithMap()` (which also returns per-note click anchors)
- Renders to SVG with `abcjs.renderAbc()`
- Responsive rendering (`responsive: 'resize'`)
- Dark mode support: overrides SVG path/text colors via CSS
- Registers an abcjs `clickListener`: clicking a pitched notehead calls `onSelect` with the note's source-array index (resolved through the anchor map); `selectedIndex` highlights that notehead (colored notehead + stem). Rests are not selectable. Used by the `/entry` staff for click-to-select editing.

Shows "No phrase loaded" placeholder when `phrase` is null.

---

## Practice Components

### `PhraseInfo.svelte`

**Path:** `src/lib/components/practice/PhraseInfo.svelte`

Compact display of the phrase's chord symbols.

| Prop | Type | Description |
|---|---|---|
| `phrase` | `Phrase` | The phrase |

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
| `timing` | `TimingDiagnostics?` | Timing diagnostics from the scorer; drives the Offset column and footer |

Filters out extra notes (only shows matched and missed). Columns: index, expected note name, played note name (colored by accuracy), pitch %, rhythm %, and per-note timing offset in ms (colored by lateness/earliness). When `timing` is present, a footer below the grid also shows overall bias, spread, and latency correction.

### `ScoreStrip.svelte`

**Path:** `src/lib/components/practice/ScoreStrip.svelte`

Horizontal SVG strip of paired pitch/rhythm bars — one pair per matched note — used for compact score visualization.

| Prop | Type | Description |
|---|---|---|
| `noteResults` | `NoteResult[]` | Per-note scoring results |
| `transpositionSemitones` | `number?` | Semitones added for written-pitch display (e.g. `14` for tenor sax). Defaults to `0`. |

Extra notes are filtered out. Each matched note renders a pair of bars; bar **height** encodes the score (`pitchScore` / `rhythmScore` × `MAX_H`). **Color** is a fixed hue per metric — pitch bars use `var(--color-accent)`, rhythm bars use `var(--color-brass)`, matching the progress complexity meters. Missed notes render as a dashed "miss" outline instead of a bar.

---

## Library Components

### `LickCard.svelte`

**Path:** `src/lib/components/library/LickCard.svelte`

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

**Path:** `src/lib/components/library/CategoryFilter.svelte`

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

Current-lick header: name, number in the session, key index, and progression label.

| Prop | Type | Description |
|---|---|---|
| `phraseNumber` | `number` | 1-based index of the active lick in the session |
| `phraseName` | `string` | Display name |
| `currentKey` | `PitchClass` | Concert-pitch key (converted to written for display) |
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

### `UpcomingKeysDisplay.svelte`

**Path:** `src/lib/components/lick-practice/UpcomingKeysDisplay.svelte`

Scrolling preview strip showing the current, next, and upcoming key chord charts. Scrolls continuously in sync with transport position.

| Prop | Type | Description |
|---|---|---|
| `plannedKeys` | `PlannedKey[]` | All keys for the current lick |
| `scrollFraction` | `number` | Continuous scroll position in "key units" (0 = first key, 1 = second key, …) |
| `currentBeat` | `number` | Active beat in the currently-playing key |
| `isPlaying` | `boolean` | Session running |
| `isRecording` | `boolean` | Current key's recording window is open |
| `isDemoing` | `boolean?` | Continuous-mode demo active — swaps the "Now" chip for "Listen" |
| `instrument` | `InstrumentConfig` | Used for written-pitch chord labels |

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

Rendered by `/entry` and `/add-licks`. All three components read and mutate `stepEntry` state directly (no props).

### `EntryConfig.svelte`

**Path:** `src/lib/components/step-entry/EntryConfig.svelte`

Key (`stepEntry.phraseKey`) and bar-count (1–4 via `setBarCount`) selectors.

### `DurationSelector.svelte`

**Path:** `src/lib/components/step-entry/DurationSelector.svelte`

Duration picker (whole / half / quarter / eighth) with keyboard shortcuts `1`–`4` and a triplet toggle (`T`).

### `PitchEntryPanel.svelte`

**Path:** `src/lib/components/step-entry/PitchEntryPanel.svelte`

Pitch-name buttons (`C`–`B`), accidental toggles (`[` flat, `]` sharp), octave adjust, rest, and delete-last. Calls `addNote()` / `addRest()` / `deleteLastNote()` / `setAccidental()` / `adjustOctave()`.

---

## Onboarding Component

### `Onboarding.svelte`

**Path:** `src/lib/components/onboarding/Onboarding.svelte`

Four-state first-run onboarding flow.

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

# State Management

Mankunku uses **Svelte 5 runes** for reactive state management with localStorage persistence. There are seven state modules, each a `.svelte.ts` file.

## State Modules

### Session State (`src/lib/state/session.svelte.ts`)

Holds the current practice session. **Not persisted** — resets on page reload.

```typescript
export const session = $state<{
  phrase: Phrase | null;
  engineState: AudioEngineState;
  tempo: number;
  isLoadingInstrument: boolean;
  micPermission: MicPermissionState;
  inputLevel: number;
  currentPitchMidi: number | null;
  currentPitchCents: number;
  currentClarity: number;
  isDetecting: boolean;
  isRecording: boolean;
  recordedNotes: DetectedNote[];
  lastScore: Score | null;
}>();
```

This module is purely a reactive container — no persistence, no methods. UI components and the practice page read/write fields directly.

### Settings State (`src/lib/state/settings.svelte.ts`)

User preferences. **Persisted** to localStorage under key `mankunku:settings`.

```typescript
const defaultSettings = {
  instrumentId: 'tenor-sax',
  defaultTempo: 100,
  metronomeEnabled: true,
  metronomeVolume: 0.7,
  swing: 0.5,
  theme: 'dark' as 'dark' | 'light',
  onboardingComplete: false,
  tonalityOverride: null             // Tonality | null
};
export const settings = $state(loadSettings());
```

**Key functions:**
- `saveSettings()` — Serialize to localStorage
- `getInstrument()` — Returns the `InstrumentConfig` for the current `instrumentId`
- `applyTheme()` — Toggles `.light` class on `<html>` based on `settings.theme`

Settings are loaded on module initialization with a merge strategy: saved values override defaults, but new default keys are preserved for forward compatibility.

### Progress State (`src/lib/state/progress.svelte.ts`)

Session history, adaptive difficulty, and per-category/per-key stats. **Persisted** to localStorage under key `mankunku:progress`.

```typescript
export const progress = $state<UserProgress>(loadProgress());
```

**Key functions:**
- `recordAttempt(phraseId, phraseName, category, key, tempo, level, score, scaleType)` — Records a session, updates adaptive state, category/key progress, and streak. Auto-saves.
- `getRecentSessions(count)` — Returns most recent sessions
- `getCategoryStats()` — Returns category progress sorted by attempt count
- `resetProgress()` — Destructive reset to initial state

Session history is bounded to 200 entries (oldest trimmed on insert).

**Streak tracking:** Compares `lastPracticeDate` to today's ISO date string. If yesterday → increment streak; if not today and not yesterday → reset to 1.

### Library State (`src/lib/state/library.svelte.ts`)

Filter state for the lick library browser. **Not persisted.**

```typescript
export const library = $state<{
  categoryFilter: PhraseCategory | null;
  difficultyFilter: number | null;
  searchQuery: string;
  selectedKey: PitchClass;
}>();
```

### History State (`src/lib/state/history.svelte.ts`)

Long-term daily progress summaries that survive the 200-session pruning window in `progress.svelte.ts`. **Persisted** to localStorage under keys `mankunku:daily-summaries` and `mankunku:progress-meta`.

```typescript
export const dailySummaries = $state<DailySummary[]>(loaded.summaries);
export const progressMeta = $state<ProgressMeta>(loaded.meta);
```

**Key functions:**
- `aggregateSession(session, pitchComplexity?, rhythmComplexity?)` — Folds a new `SessionResult` into today's daily summary (creating the day if needed), bumps the all-time session counter, and recomputes longest streak. Called from `recordAttempt()`.
- `rebuildHistoryIfNeeded()` — Re-derives daily summaries from `progress.sessions` after cloud hydration writes; only replaces state when summaries differ.
- `getSummariesInRange(start, end)` — Inclusive date range query for charts.
- `comparePeriods(currentStart, currentEnd, previousStart, previousEnd)` — Returns `{ current, previous, delta }` for week-over-week / month-over-month comparisons.
- `getYearHeatmap()` — `Map<date, { sessionCount, avgOverall }>` sized to the last 365 days for the calendar heatmap.
- `getLast30Days()` — `Map<date, hasPractice>` for streak displays.
- `getWeekRanges()`, `getMonthRanges()` — Convenience date-range builders.
- `clearHistory()` — Destructive reset (called from `resetProgress()`).

On first load the module self-migrates: if no v2 meta is found in localStorage, it aggregates all existing `progress.sessions` into summaries and persists them.

### Lick Practice State (`src/lib/state/lick-practice.svelte.ts`)

Active state for the multi-key lick-practice flow: configuration, session plan, per-key results, and tempo adjustments. The reactive `$state` object is ephemeral (resets on reload), but cumulative per-lick/per-key progress is persisted via `persistence/lick-practice-store.ts` under `mankunku:lick-practice-progress`.

```typescript
export const lickPractice = $state<{
  config: LickPracticeConfig;
  phase: LickPracticePhase;            // 'setup' | 'count-in' | 'playing' | 'inter-lick-rest' | 'complete'
  plan: LickPracticePlanItem[];         // Ordered licks + planned keys (12 per lick)
  currentLickIndex: number;
  currentKeyIndex: number;
  currentTempo: number;
  keyResults: LickPracticeKeyResult[];
  allAttempts: LickPracticeKeyResult[][];
  startTime: number;
  elapsedSeconds: number;
  progress: LickPracticeProgress;       // Cumulative per-lick per-key data
}>( /* defaults */ );
```

**Key functions:**
- `hydrateLickPracticeProgress(supabase?)` — Async: pulls cloud metadata when signed in, loads persisted progress, backfills legacy practice tags.
- `getPracticeLicks()` — All licks tagged `practice` that match the current progression (by category or user-assigned progression tag).
- `buildSessionPlan()` — Sorts licks by least-recently-practiced and packs the time budget. Called by `startSession()`.
- `startSession()` — Transitions to `count-in`, resets indices, stamps `startTime`.
- `getCurrentPlanItem()`, `getCurrentKey()`, `getCurrentPhrase()`, `getCurrentHarmony()` — Cursor accessors for the active lick/key.
- `getPhraseFor(lickIdx, keyIdx)` — Pure variant used when scoring a key that has just finished.
- `getPlannedKey(offset)`, `getUpcomingKeys()`, `getPlannedKeysForLick(lickIdx)` — Lookahead accessors for the preview strip and scroll animation.
- `buildLickSuperPhrase(lickIdx)` — Concatenates all 12 keys (plus an optional demo in continuous mode) into one phrase so the whole lick can be scheduled in a single Tone.js pass.
- `recordKeyAttempt(score)` — Appends a `LickPracticeKeyResult`; persists key progress on pass (≥ 80%).
- `advance()` — Moves to the next key within the current lick; returns `'end-of-lick'` when out.
- `startInterLickTransition()` — Archives results, applies auto-tempo or all-keys-pass tempo bump, advances to the next lick or marks `'complete'`.
- `updateElapsedTime()`, `resetSession()`, `getSessionReport()`.

### Step Entry State (`src/lib/state/step-entry.svelte.ts`)

UI state for manual lick entry (the `/entry` and `/add-licks` routes). **Not persisted** — the draft resets when the route unmounts; completed phrases are exported via `getCurrentPhrase()` and saved through `persistence/user-licks.ts`.

```typescript
export const stepEntry = $state({
  currentDuration: 'quarter' as BaseDurationId,
  tripletMode: false,
  selectedOctave: 4,
  accidental: 'natural' as 'sharp' | 'flat' | 'natural',
  enteredNotes: [] as Note[],
  barCount: 2,
  phraseKey: 'C' as PitchClass,
  phraseName: '',
  category: 'user' as PhraseCategory,
  practiceTag: false
});
```

The user enters notes in their instrument's **written** pitch (what they see on their chart). Validation happens in written space (range `Bb3`–`F6`) and notes are converted to concert pitch at storage time using `instrument.transpositionSemitones`, keeping the canonical storage contract.

**Key functions:**
- `addNote(pitchClass, octave, accidental)` — Validates the duration fits, applies key-signature accidentals (when explicit accidental is `'natural'`), picks the nearest octave to the previous note, converts written → concert, appends.
- `addRest()`, `deleteLastNote()`, `adjustLastNotePitch(semitones)`.
- `getCurrentPhrase()` — Builds a `Phrase` with `user-entered` source and optional `practice` tag for export.
- `getCurrentCursorOffset()`, `getRemainingCapacity()`, `canAddDuration(duration)`, `getCurrentBarAndBeat()` — Cursor helpers.
- `getPaddedNotes()` — Pads entered notes with a final rest so partial bars render cleanly in notation.
- `setBarCount(n)` (1–4, trims overflow), `setDuration(id)`, `toggleTriplet()`, `setAccidental(acc)`, `adjustOctave(delta)`, `reset()`.

## Persistence Layer (`src/lib/persistence/storage.ts`)

Thin wrapper around `localStorage` with JSON serialization:

- All keys prefixed with `mankunku:` to avoid collisions
- `save<T>(key, value)` — `JSON.stringify` + `setItem`
- `load<T>(key)` — `getItem` + `JSON.parse`, returns `null` on missing/invalid
- `remove(key)` — Remove a single key
- `listKeys()` — All mankunku-prefixed keys
- `clearAll()` — Remove all mankunku data

Error handling: `save` warns on failure (e.g., quota exceeded), `load` returns `null` on parse errors.

## Pattern: Reactive State + Manual Save

Unlike auto-saving stores, Mankunku uses **explicit save calls**. This avoids excessive writes during rapid state changes (e.g., real-time pitch detection updating `session.currentPitchMidi` at 60fps).

- **Session**: Never persisted (ephemeral per-visit data)
- **Settings**: Saved on each user action (e.g., changing instrument, toggling metronome)
- **Progress**: Saved after each completed attempt via `recordAttempt()`
- **History**: Saved from `aggregateSession()` (invoked by `recordAttempt`) and on cloud-hydration rebuild
- **Library**: Never persisted (filter state resets on navigation)
- **Lick Practice**: Live session state is ephemeral; per-lick/per-key progress is persisted by `persistence/lick-practice-store.ts` after each passed key, tempo adjustment, and session end
- **Step Entry**: Never persisted — drafts are exported to `persistence/user-licks.ts` when the user saves

## Svelte 5 Runes Pattern

All state uses the `$state` rune at module scope:

```typescript
// Module-level reactive state
export const myState = $state({ count: 0 });

// Components can read and write directly
myState.count++;  // triggers reactivity
```

Components use `$derived` for computed values:

```typescript
const displayLevel = $derived(averageProficiencyLevel(progress));
```

And `$props` for component inputs:

```typescript
interface Props { phrase: Phrase; }
let { phrase }: Props = $props();
```

This is simpler than Svelte 4's writable/derived stores and provides fine-grained reactivity without subscriptions.

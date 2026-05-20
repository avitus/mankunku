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

Session history is bounded to 100 entries (oldest trimmed on insert).

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

Long-term daily progress summaries that survive the 100-session pruning window in `progress.svelte.ts`. **Persisted** to localStorage under keys `mankunku:daily-summaries` and `mankunku:progress-meta`.

```typescript
export const dailySummaries = $state<DailySummary[]>(loaded.summaries);
export const progressMeta = $state<ProgressMeta>(loaded.meta);
```

Daily summaries are a **pure derivation** of two source-of-truth tables: `progress.sessions` (ear-training) and `lick-practice-sessions` (lick-practice log). Every write that touches either source calls `recomputeAllDailySummaries`, which re-derives summaries for all dates present in the sources. The persisted blob serves as a cache for past days whose source rows have aged out of the 100-session window — those days survive untouched until cloud merge brings in newer data. Replaying a write is a no-op and divergence self-corrects on the next recompute.

**Key functions:**
- `recomputeAllDailySummaries(complexitySnapshots?)` — Primary write path. Re-derives every day present in either source and persists. Called from `recordAttempt()` (ear-training) and from the lick-practice session writer after each round completes.
- `recomputeDailySummary(date, complexitySnapshot?)` — Hot-path variant of the above filtered to a single day.
- `deriveDailySummary(date, sessions, lickSessions, complexitySnapshot?)` — Pure helper that builds a `DailySummary` from the source rows for one day, without persisting.
- `mergeCloudSummaries(cloudSummaries)` — Merges cloud summaries with the local cache after cloud hydration.
- `getSummariesInRange(start, end)` — Inclusive date range query for charts.
- `comparePeriods(currentStart, currentEnd, previousStart, previousEnd)` — Returns `{ current, previous, delta }` for week-over-week / month-over-month comparisons.
- `getYearHeatmap()` — `Map<date, { sessionCount, avgOverall }>` sized to the last 365 days for the calendar heatmap.
- `getLast30Days()` — `Map<date, hasPractice>` for streak displays.
- `getWeekRanges()`, `getMonthRanges()` — Convenience date-range builders.
- `clearHistory()` — Destructive reset (called from `resetProgress()`).

On first load the module self-migrates: if no v2 meta is found in localStorage, the next `recomputeAllDailySummaries` call rebuilds summaries from `progress.sessions` + `lick-practice-sessions` and persists them.

### Lick Practice State (`src/lib/state/lick-practice.svelte.ts`)

Active state for the multi-key lick-practice flow: configuration, session plan, per-key results, and tempo adjustments. Each lick's key rotation expands gradually — a brand-new lick starts with just one unlocked key (its entry key) and earns each next key as alternating sharp/flat-side neighbours of the entry key on the circle of fifths (see `planUnlockedKeys` in `src/lib/music/key-ordering.ts`). The unlock gate requires both a strong session (avg score ≥ `UNLOCK_AVG_THRESHOLD` = 0.90) and consolidation on the newest-unlocked key (`passCount ≥ UNLOCK_PASSES_REQUIRED` = 2); see `shouldUnlockNextKey`. Tempo bumps run on a separate, looser gate (avg ≥ 0.85 for +2 BPM) so users keep accelerating on the keys they have without the rotation growing every passable session. Once a lick has earned all 12 keys, `planLickKeys` takes over for staged variety. The reactive `$state` object is ephemeral (resets on reload), but cumulative per-lick/per-key progress (including unlock counts and `passCount`) is persisted via `persistence/lick-practice-store.ts` under `mankunku:lick-practice-progress` and `mankunku:lick-unlock-count`.

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

A practice-tagged lick is only eligible for a session if it also carries an explicit `prog:<progressionType>` tag for that progression. Those tags are added automatically when the lick's curated category matches the progression (e.g. `ii-V-I-major` licks get `prog:ii-V-I-major`), and the user can add/remove them by hand to drill a lick over a non-default progression.

**Key functions:**
- `hydrateLickPracticeProgress(supabase?)` — Async: pulls cloud metadata when signed in, loads persisted progress, backfills legacy practice tags.
- `getPracticeLicks()` — All licks tagged `practice` that *also* carry the active progression's `prog:*` tag.
- `getDailyPracticeLicks()` — All practice-tagged licks with at least one `prog:*` tag, regardless of progression. Powers Daily Practice mode.
- `buildSessionPlan()` — Standard mode. Sorts licks by least-recently-practiced and packs the time budget. Each lick's planned key list is the first N keys of the alternating sharp/flat ramp where N is its current unlock count (capped at 12, then handed off to `planLickKeys` for staged variety). Called by `startSession()`.
- `buildDailyPracticePlan()` — Daily Practice mode. Pools every lick from `getDailyPracticeLicks()`, sorts least-recently-practiced first, picks each lick's least-recently-practiced compatible progression via `pickProgressionForLick`, and packs the duration budget. Each plan item carries its own `progressionType` instead of inheriting from config.
- `startSession()`, `startDailyPracticeSession()`, `startSingleLickSession(lickId, tempoBumpBpm?)` — The three entry points; all converge on the same playback engine.
- `getCurrentPlanItem()`, `getCurrentKey()`, `getCurrentPhrase()`, `getCurrentHarmony()` — Cursor accessors for the active lick/key.
- `getPhraseFor(lickIdx, keyIdx)` — Pure variant used when scoring a key that has just finished.
- `getPlannedKey(offset)`, `getUpcomingKeys()`, `getPlannedKeysForLick(lickIdx)` — Lookahead accessors for the preview strip and scroll animation.
- `buildLickSuperPhrase(lickIdx)` — Concatenates all 12 keys (plus an optional demo in continuous mode) into one phrase so the whole lick can be scheduled in a single Tone.js pass.
- `recordKeyAttempt(score)` — Appends a `LickPracticeKeyResult`; persists key progress on pass (≥ 80%).
- `advance()` — Moves to the next key within the current lick; returns `'end-of-lick'` when out.
- `startInterLickTransition()` — Archives results, applies the score-weighted tempo delta (independent of the unlock gate), decides whether to bump the unlock count via `shouldUnlockNextKey({ avgScore, newestKeyPassCount, unlockedCount })`, and advances to the next lick or marks `'complete'`.
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
- **History**: Saved by `recomputeAllDailySummaries` after every write to `progress.sessions` or `lick-practice-sessions` (derive-on-write), plus on cloud-hydration rebuild
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

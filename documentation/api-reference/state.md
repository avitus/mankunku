# API Reference: State

Seven reactive state modules using Svelte 5 `$state` rune at module scope.

**Source:** `src/lib/state/`, `src/lib/persistence/`

---

## session.svelte.ts

Current practice session state. **Not persisted** — resets on page reload.

### `session`

```typescript
export const session = $state<{
  phrase: Phrase | null;               // Current phrase being practiced
  engineState: AudioEngineState;      // 'uninitialized' | 'ready' | 'loading' | 'playing' | 'recording' | 'error'
  tempo: number;                       // Current BPM
  isLoadingInstrument: boolean;        // SoundFont loading in progress
  micPermission: MicPermissionState;   // 'prompt' | 'granted' | 'denied' | 'unavailable'
  inputLevel: number;                  // Mic input level 0-1
  currentPitchMidi: number | null;     // Real-time detected MIDI note
  currentPitchCents: number;           // Real-time cents deviation
  currentClarity: number;              // Real-time detection clarity
  isDetecting: boolean;                // Pitch detection active
  isRecording: boolean;                // Recording in progress
  recordedNotes: DetectedNote[];       // Notes captured in current recording
  lastScore: Score | null;             // Score from most recent attempt
  bleedFilterLog: BleedFilterLog | null; // Diagnostic: notes filtered as backing-track bleed
}>();
```

`BleedFilterLog` is exported from the same module and captures before/after scoring when the bleed filter removes notes.

No exported functions — components read/write fields directly.

---

## settings.svelte.ts

User preferences. **Persisted** to localStorage under key `mankunku:settings`.

### `settings`

```typescript
export const settings = $state({
  instrumentId: 'tenor-sax',                  // 'tenor-sax' | 'alto-sax' | 'trumpet'
  defaultTempo: 100,                          // BPM
  masterVolume: 0.8,                          // 0-1
  metronomeEnabled: true,
  metronomeVolume: 0.7,                       // 0-1
  backingTrackEnabled: true,
  backingInstrument: 'piano' as BackingInstrument,
  backingTrackVolume: 0.6,                    // 0-1
  backingStyle: 'swing' as BackingStyle,      // 'swing' | 'bossa-nova' | 'ballad' | 'straight'
  swing: 0.5,                                 // Swing ratio (0.5 = straight, 0.8 = heavy)
  theme: 'dark' as 'dark' | 'light',
  onboardingComplete: false,
  tonalityOverride: null as Tonality | null,  // override for daily tonality
  highestNote: null as number | null,         // concert-pitch MIDI ceiling; null = instrument default
  bleedFilterEnabled: false                   // A/B toggle for bleed-filtered scoring
});
```

### `saveSettings(supabase?): void`

Serialize current settings to localStorage. Call after any user-initiated change. When a Supabase client is supplied, also fire-and-forgets a cloud sync.

### `loadSettingsFromCloud(supabase): Promise<void>`

Fetch authenticated-user settings from Supabase, merge with defaults (clamping swing / tempo / backing style), write into the reactive `settings` object, persist to localStorage, and re-apply the theme.

### `getInstrument(): InstrumentConfig`

Returns the `InstrumentConfig` for the current `instrumentId`. Falls back to tenor sax.

### `getEffectiveHighestNote(): number`

Returns `settings.highestNote` when set, otherwise `instrument.concertRangeHigh - 1` (e.g. tenor sax → 75, concert Eb5).

### `applyTheme(): void`

Toggles `.light` class on `<html>` based on `settings.theme`. No-op in SSR.

---

## progress.svelte.ts

Session history and adaptive difficulty. **Persisted** to localStorage under key `mankunku:progress`.

### `progress`

```typescript
export const progress = $state<UserProgress>({
  adaptive: AdaptiveState;                                              // Adaptive difficulty state
  sessions: SessionResult[];                                            // Session history (max 200)
  categoryProgress: Record<string, CategoryProgress>;
  keyProgress: Partial<Record<PitchClass, {
    attempts: number;
    averageScore: number;
  }>>;
  scaleProficiency: Partial<Record<ScaleType, ScaleProficiency>>;       // Per-scale level (1-100)
  keyProficiency: Partial<Record<PitchClass, KeyProficiency>>;          // Per-key level (1-100)
  lickProgress: Partial<Record<string, LickProgress>>;                  // Keyed by phraseId
  totalPracticeTime: number;
  streakDays: number;
  lastPracticeDate: string;                                             // ISO date string
});
```

### `recordAttempt(phraseId, phraseName, category, key, tempo, difficultyLevel, score, scaleType?, supabase?, source?): void`

Record a completed attempt. `source` defaults to `'ear-training'`; pass `'lick-practice'` for lick-practice runs (those contribute to per-lick progress but skip the ear-training key stats). When a Supabase client is supplied, fire-and-forgets a cloud sync after persisting locally. This single function:
1. Creates a `SessionResult` and prepends to `sessions` (bounded to 200)
2. Updates adaptive state via `processAttempt()`
3. Updates per-scale proficiency (ear-training only)
4. Updates category progress (running average, best score)
5. Updates per-lick progress
6. Updates per-key proficiency + key progress (ear-training only)
7. Updates streak (compares to yesterday's date)
8. Aggregates into the daily summary via `aggregateSession()`
9. Auto-saves to localStorage (+ optional cloud sync)

### `initFromCloud(supabase): Promise<void>`

Fetch cloud progress for an authenticated user and merge with local. Cloud-takes-precedence when the cloud session count is ≥ the local count; otherwise local wins. Re-derives daily summaries via `rebuildHistoryIfNeeded()` afterward.

### `getRecentSessions(count?): SessionResult[]`

Returns the most recent `count` sessions (default 10), newest first.

### `getCategoryStats(): CategoryProgress[]`

Returns category progress sorted by attempt count (descending).

### `getUnlockContext(): UnlockContext`

Builds the `UnlockContext` used by the tonality / unlock model from current `scaleProficiency` and `keyProficiency`.

### `getPrimaryLevel(): number`

Returns `progress.adaptive.currentLevel` — the 1-100 player level shown in UI.

### `resetProgress(supabase?): void`

Destructive reset to initial state. Saves immediately. When a Supabase client is supplied, also clears cloud data.

### `saveProgress(): void`

Manual save to localStorage.

---

## library.svelte.ts

Filter state for the lick library browser. **Not persisted** — resets on navigation.

### `library`

```typescript
export const library = $state<{
  categoryFilter: PhraseCategory | null;  // null = show all
  difficultyFilter: number | null;        // null = show all
  searchQuery: string;
  selectedKey: PitchClass;                // Default 'C'
}>();
```

No exported functions — library page reads/writes fields directly.

---

## history.svelte.ts

Long-term daily progress summaries that survive the 200-session prune window in `progress.svelte.ts`. **Persisted** to localStorage under keys `mankunku:daily-summaries` and `mankunku:progress-meta`.

### `dailySummaries`, `progressMeta`

```typescript
export const dailySummaries = $state<DailySummary[]>(/* loaded from localStorage */);
export const progressMeta = $state<ProgressMeta>(/* loaded from localStorage */);
```

`DailySummary` holds per-day aggregates (session count, avg/best scores, practice minutes, grade distribution, category counts). `ProgressMeta` holds `{ version, lastAggregationTimestamp, longestStreak, longestStreakEndDate, allTimeSessionCount }`.

### `aggregateSession(session, pitchComplexity?, rhythmComplexity?): void`

Fold a new `SessionResult` into today's summary (creating the day if needed), bump all-time counters, recompute longest streak, save. Called from `recordAttempt()`.

### `updateLongestStreak(): void`

Recompute longest streak from all daily summaries and update `progressMeta` if a new record was set.

### `rebuildHistoryIfNeeded(): void`

Re-derive summaries from `progress.sessions` after cloud hydration. Replaces in-memory state only if length or any per-day sessionCount differs. Limited to the 200-session sync window.

### `getSummariesInRange(start, end): DailySummary[]`

Inclusive date range query (`'YYYY-MM-DD'` strings, local time).

### `comparePeriods(currentStart, currentEnd, previousStart, previousEnd): PeriodComparison`

Returns `{ current, previous, delta }` — aggregate `PeriodStats` for each range plus a `PeriodDelta`.

### `getYearHeatmap(): Map<string, { sessionCount: number; avgOverall: number }>`

Last 365 days of practice data for calendar heatmap rendering.

### `getLast30Days(): Map<string, boolean>`

For each of the last 30 local dates, whether a practice session occurred.

### `getWeekRanges(): { currentStart; currentEnd; previousStart; previousEnd }`

This-Monday-through-now vs the prior Monday-through-Sunday (for week-over-week comparisons).

### `getMonthRanges(): { currentStart; currentEnd; previousStart; previousEnd }`

This-month-start-through-now vs the previous calendar month.

### `clearHistory(): void`

Destructive reset — clears in-memory arrays and removes both storage keys. Called from `resetProgress()`.

### `localDateStr(d: Date): string`

Helper exported from this module: `'YYYY-MM-DD'` in local time (used anywhere daily keys are needed).

---

## lick-practice.svelte.ts

Active state for the multi-key lick-practice flow. The live session is ephemeral (resets on reload). Per-lick/per-key cumulative progress is persisted via `persistence/lick-practice-store.ts` under `mankunku:lick-practice-progress`.

### `lickPractice`

```typescript
export const lickPractice = $state<{
  config: LickPracticeConfig;          // progressionType, durationMinutes, practiceMode, backingStyle
  phase: LickPracticePhase;            // 'setup' | 'count-in' | 'playing' | 'inter-lick-rest' | 'complete'
  plan: LickPracticePlanItem[];         // Ordered licks + planned keys (12 per lick)
  currentLickIndex: number;
  currentKeyIndex: number;
  currentTempo: number;
  keyResults: LickPracticeKeyResult[];  // Results for the current lick
  allAttempts: LickPracticeKeyResult[][]; // Archived results per lick
  startTime: number;
  elapsedSeconds: number;
  progress: LickPracticeProgress;       // Persisted per-lick per-key data
}>();
```

### `PlannedKey` interface

```typescript
export interface PlannedKey {
  lickIndex: number;
  keyIndex: number;
  key: PitchClass;
  phrase: Phrase;
  harmony: HarmonicSegment[];
  lickName: string;
  lickId: string;
}
```

### Hydration

- `hydrateLickPracticeProgress(supabase?)` — Async: pulls cloud lick metadata (best-effort), loads persisted progress, backfills legacy practice tags.

### Plan building

- `getPracticeLicks(): Phrase[]` — All `practice`-tagged licks matching the configured progression (by category or progression tag).
- `buildSessionPlan(): void` — Sorts licks by least-recently-practiced, packs into `durationMinutes` budget.
- `startSession(): void` — Transitions to `count-in`, resets indices, stamps `startTime`, resolves first-lick tempo.

### Cursor accessors

- `getCurrentPlanItem(): LickPracticePlanItem | null`
- `getCurrentKey(): PitchClass | null`
- `getCurrentPhrase(): Phrase | null` — Current lick transposed to the current key with progression harmony substituted.
- `getCurrentHarmony(): HarmonicSegment[]` — Progression template transposed to current key.
- `getPhraseFor(lickIdx, keyIdx): Phrase | null` — Pure variant for scoring keys that have already advanced.
- `getPlannedKey(offset): PlannedKey | null` — Lookahead across lick boundaries.
- `getUpcomingKeys(): { current; next; afterNext }` — Three-row preview helper.
- `getPlannedKeysForLick(lickIdx): PlannedKey[]` — Every planned key for a lick (used by the continuous-scroll preview).

### Phrase assembly

- `buildLickSuperPhrase(lickIdx): Phrase | null` — Concatenates all 12 keys (plus an optional continuous-mode demo) into a single `Phrase`, so a lick's entire backing track can be scheduled in one Tone.js pass.
- `getKeyBars(): number` — Bars per key for the current mode (progression bars, doubled in call-and-response).
- `getProgressionBars(): number` — Bars in one chord-progression cycle.

### Session control

- `recordKeyAttempt(score): void` — Append a key result; persist per-key progress and bump pass count on score ≥ 0.80.
- `advance(): 'next-key' | 'end-of-lick'` — Move to the next key; returns `'end-of-lick'` when the current lick's keys are exhausted.
- `startInterLickTransition(): 'next-lick' | 'complete'` — Archive results, apply the always-on score-weighted tempo adjustment (average score across attempted keys → signed delta via `computeAutoTempoAdjustment`, clamped and persisted to every key in the lick), then move to the next lick or mark session complete.
- `updateElapsedTime(): void`
- `resetSession(): void`
- `getSessionReport(): SessionReport` — Build the end-of-session report from archived attempts, including any in-progress lick.

---

## step-entry.svelte.ts

UI state for manual lick entry (`/entry`, `/add-licks`). **Not persisted** — drafts reset when the route unmounts; completed phrases are exported via `getCurrentPhrase()` and saved through `persistence/user-licks.ts`. The user enters notes in their instrument's **written** pitch; storage is canonical **concert** pitch.

### `stepEntry`

```typescript
export const stepEntry = $state({
  currentDuration: 'quarter' as BaseDurationId,
  tripletMode: false,
  selectedOctave: 4,
  accidental: 'natural' as 'sharp' | 'flat' | 'natural',
  enteredNotes: [] as Note[],
  barCount: 2,                                    // 1–4
  phraseKey: 'C' as PitchClass,                   // Written key for the user's instrument
  phraseName: '',
  category: 'user' as PhraseCategory,
  practiceTag: false
});
```

### Note input

- `addNote(pitchClass, octave, accidental): boolean` — Validates that the duration fits, applies key-signature accidentals when `accidental === 'natural'`, picks the octave nearest to the previous pitched note, converts written → concert, appends. Written-pitch range is Bb3–F6.
- `addRest(): boolean`
- `deleteLastNote(): void`
- `adjustLastNotePitch(semitones): void` — Clamped to written-pitch range.

### Cursor helpers

- `getCurrentCursorOffset(): Fraction`
- `getMaxCapacity(): Fraction` — `[barCount, 1]`
- `getRemainingCapacity(): Fraction`
- `canAddDuration(duration): boolean`
- `getCurrentBarAndBeat(): { bar: number; beat: number }`
- `getPaddedNotes(): Note[]` — Pads the tail with a rest so partial bars render cleanly.

### Settings / lifecycle

- `setBarCount(n): void` — Clamped to 1–4; trims overflow notes.
- `setDuration(id): void`
- `toggleTriplet(): void`
- `setAccidental(acc): void` — Toggles off if already set.
- `adjustOctave(delta): void` — Clamped to 1–8.
- `reset(): void`

### Export

- `getCurrentPhrase(): Phrase` — Builds a `Phrase` in concert pitch with `source: 'user-entered'` and `'user-entered'` / `'practice'` tags, ready to persist.

---

## storage.ts

Thin localStorage wrapper with JSON serialization.

**Source:** `src/lib/persistence/storage.ts`

All keys are prefixed with `mankunku:` to avoid collisions.

| Function | Signature | Description |
|---|---|---|
| `save<T>` | `(key, value) → void` | `JSON.stringify` + `setItem`. Warns on failure (e.g. quota exceeded). |
| `load<T>` | `(key) → T \| null` | `getItem` + `JSON.parse`. Returns `null` on missing/invalid. |
| `remove` | `(key) → void` | Remove a single key |
| `listKeys` | `() → string[]` | All mankunku-prefixed keys (without prefix) |
| `clearAll` | `() → void` | Remove all mankunku data |

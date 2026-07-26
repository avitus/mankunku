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
  instrumentId: 'tenor-sax',                  // 'soprano-sax' | 'tenor-sax' | 'alto-sax' | 'trumpet'
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
  sessions: SessionResult[];                                            // Session history (max 100)
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
1. Creates a `SessionResult` and prepends to `sessions` (bounded to 100)
2. Updates adaptive state via `processAttempt()`
3. Updates per-scale proficiency (ear-training only)
4. Updates category progress (running average, best score)
5. Updates per-lick progress
6. Updates per-key proficiency + key progress (ear-training only)
7. Updates streak (compares to yesterday's date)
8. Re-derives daily summaries via `recomputeAllDailySummaries()` (pulls in lick-practice rows as well)
9. Auto-saves to localStorage (+ optional cloud sync)

### `initFromCloud(supabase): Promise<void>`

Fetch cloud progress for an authenticated user and merge with local. Cloud-takes-precedence when the cloud session count is ≥ the local count; otherwise local wins. The root layout (`+layout.ts`) then calls `recomputeAllDailySummaries()` and `mergeCloudSummaries()` to re-derive history from the merged source tables.

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

## licks.svelte.ts

Filter state for the Licks page (the user's book). **Not persisted** — resets on navigation.

### `licks`

```typescript
export const licks = $state<{
  searchQuery: string;
  progressionFilter: ChordProgressionType | null;  // null = show all; matches explicit prog:* tags only
}>();
```

No exported functions — the Licks page reads/writes fields directly.

---

## history.svelte.ts

Long-term daily progress summaries that survive the 100-session prune window in `progress.svelte.ts`. **Persisted** to localStorage under keys `mankunku:daily-summaries` and `mankunku:progress-meta`.

Daily summaries are a **pure derivation** of two source-of-truth tables: `progress.sessions` (ear-training) and `lick-practice-sessions` (lick-practice log). Every write that touches either source calls `recomputeAllDailySummaries`, which re-derives summaries for every date present in the sources. The persisted blob serves as a cache for past days whose source rows have aged out of the 100-session window.

### `dailySummaries`, `progressMeta`

```typescript
export const dailySummaries = $state<DailySummary[]>(/* loaded from localStorage */);
export const progressMeta = $state<ProgressMeta>(/* loaded from localStorage */);
```

`DailySummary` holds per-day aggregates (session count, avg/best scores, practice minutes, grade distribution, category counts). `ProgressMeta` holds `{ version, lastAggregationTimestamp, longestStreak, longestStreakEndDate, allTimeSessionCount }`.

### `recomputeAllDailySummaries(complexitySnapshots?): DailySummary[]`

Primary write path. Reads the two source-of-truth tables (`progress.sessions` and `lick-practice-sessions`) from localStorage, re-derives summaries for every date that has rows, updates `progressMeta.allTimeSessionCount` + longest streak, and persists. Optional `complexitySnapshots` map lets the caller override pitch/rhythm complexity per date (used by `recordAttempt` to stamp the adaptive snapshot from memory before persistence has flushed). Returns the array of summaries it touched. Called from `recordAttempt()`, from `persistence/lick-practice-sessions.ts` after each lick round, and from `+layout.ts` after cloud hydration.

### `recomputeDailySummary(date, complexitySnapshot?): DailySummary | null`

Single-day variant — useful when only one date is dirty.

### `deriveDailySummary(date, sessions, lickSessions, complexitySnapshot?): DailySummary | null`

Pure helper that builds a `DailySummary` from the source rows for one day, without persisting. Returns `null` if no rows fall on that date.

### `mergeCloudSummaries(cloudSummaries): DailySummary[]`

Merge cloud-side summaries into the local cache during hydration. Cloud rows replace local for dates the cloud knows about; local-only dates (e.g. older than the cloud's window) survive.

### `updateLongestStreak(): void`

Recompute longest streak from all daily summaries and update `progressMeta` if a new record was set.

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

Active state for the multi-key lick-practice flow. The live session is ephemeral (resets on reload). Per-lick/per-key cumulative progress is persisted via `persistence/lick-practice-store.ts` under `mankunku:lick-practice-progress`. Completed sessions are appended to `mankunku:lick-practice-sessions` via `persistence/lick-practice-sessions.ts` so history can derive from them.

A practice-tagged lick is only eligible for a session if it also carries an explicit `prog:<progressionType>` tag. Tags are added automatically when a lick's curated category matches a progression and can be added/removed by hand to drill a lick over an alternative progression. Practice-tagged licks with **no** `prog:*` tags are "stranded" and excluded from both standard and Daily Practice plans.

### `lickPractice`

```typescript
export const lickPractice = $state<{
  config: LickPracticeConfig;          // progressionType, durationMinutes, practiceMode, backingStyle,
                                       //   enableSubstitutions?, singleLickMode?, singleLickId?, tempoBumpBpm?
  phase: LickPracticePhase;            // 'setup' | 'count-in' | 'playing' | 'inter-lick-rest' | 'complete'
  plan: LickPracticePlanItem[];         // Ordered licks + planned keys
  currentLickIndex: number;
  currentKeyIndex: number;
  currentTempo: number;
  keyResults: LickPracticeKeyResult[];  // Results for the current lick
  allAttempts: LickPracticeKeyResult[][]; // Archived results per lick
  startTime: number;
  elapsedSeconds: number;
  progress: LickPracticeProgress;       // Persisted per-lick per-key data
  // Single-lick-mode only:
  roundNumber: number;                  // Completed full cycles
  masteredThisRound: PitchClass[];      // Keys cleared at ≥ 0.95 in the current round
  roundHistory: SingleLickRoundEntry[]; // Per-round summary (tempo + which keys cleared)
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

- `getPracticeLicks(): Phrase[]` — All `practice`-tagged licks that *also* carry the active progression's `prog:*` tag.
- `getDailyPracticeLicks(): Phrase[]` — All `practice`-tagged licks with at least one `prog:*` tag, regardless of progression.
- `buildSessionPlan(): void` — Standard mode. Sorts licks by least-recently-practiced, packs into the `durationMinutes` budget.
- `buildDailyPracticePlan(): void` — Daily Practice mode. Pools every Daily-eligible lick, assigns each its own least-recently-practiced compatible progression, and packs the budget. Each plan item carries its own `progressionType` instead of inheriting from config.
- `buildSingleLickPlan(lickId, instrument): void` — Single-lick mode. Builds a per-lick cycle through the lick's *currently-unlocked* keys (via `unlockedCircleFrom`), not all 12 — Deep Practice respects the same gradual-unlock ramp as standard sessions.
- `startSession(): void` — Standard entry: transitions to `count-in`, resets indices, stamps `startTime`, resolves first-lick tempo.
- `startDailyPracticeSession(): void` — Daily-Practice entry. Clears `singleLickMode`, calls `buildDailyPracticePlan`, then starts.
- `startSingleLickSession(lickId, tempoBumpBpm?): void` — Single-lick entry. Sets `singleLickMode`, builds the per-lick unlocked-key plan, then starts. Mastered keys (score ≥ 0.95) drop from the next round; tempo bumps by `tempoBumpBpm` (default 5) once every unlocked key clears and the rotation refills.

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

- `recordKeyAttempt(score): void` — Append a key result; persist per-key progress and bump pass count on score ≥ `KEY_PROFICIENT_THRESHOLD` (0.90, green tier). Yellow 0.75–0.89 is recorded but doesn't increment `passCount`. Below `KEY_FLOOR_THRESHOLD` (0.75) is red and blocks tempo increases + unlocks at session end.
- `resetLickProgress(lickId, supabase?): void` — Wipe one lick's per-key scores, `passCount`, and unlock count. Tags (`practice`, `prog:*`) are preserved. Cloud is synced when a client is supplied. Surfaced from the post-session report (gated on try-again-band scores) and the book detail page (gated on `hasLickProgress`).
- `advance(): 'next-key' | 'end-of-lick'` — Move to the next key; returns `'end-of-lick'` when the current lick's keys are exhausted.
- `startInterLickTransition(): 'next-lick' | 'complete'` — Archive results, apply the score-weighted tempo adjustment (+5 BPM at ≥ 95%, +2 at ≥ 90%, -1 in the 75–89% yellow band, -3 below 75% — and any single key below `KEY_FLOOR_THRESHOLD` clamps the delta to ≤ 0 regardless of average), then move to the next lick or mark session complete.
- `updateElapsedTime(): void`
- `resetSession(): void`
- `getSessionReport(): SessionReport` — Build the end-of-session report from archived attempts, including any in-progress lick.

---

## step-entry.svelte.ts

UI state for manual lick entry in the editor (`/licks/editor`, `/licks/add`). **Not persisted** — drafts reset when the route unmounts; completed phrases are exported via `getCurrentPhrase()` and saved through `persistence/user-licks.ts`. The user enters notes in their instrument's **written** pitch; storage is canonical **concert** pitch.

### `stepEntry`

```typescript
export const stepEntry = $state({
  currentDuration: 'eighth' as BaseDurationId,
  tripletMode: false,
  dottedMode: false,
  selectedOctave: 4,
  accidental: 'natural' as 'sharp' | 'flat' | 'natural',
  enteredNotes: [] as Note[],
  barCount: 2,                                    // 1–4
  phraseKey: 'C' as PitchClass,                   // Written key for the user's instrument
  phraseName: '',
  category: 'user' as PhraseCategory,
  practiceTag: false,
  // Index of the user-selected pitched note in `enteredNotes`; `null` = no explicit
  // selection (selected-note operations fall back to the last pitched note).
  selectedNoteIndex: null as number | null,
  // Edit-mode metadata (non-null when re-opening an existing user-entered lick).
  editingId: null as string | null,
  editingSource: null as string | null,
  editingTags: null as string[] | null,
  editingCategory: null as PhraseCategory | null
});
```

### Note input

- `addNote(pitchClass, octave, accidental): boolean` — Validates that the duration fits, applies key-signature accidentals when `accidental === 'natural'`, picks the octave nearest to the previous pitched note, converts written → concert, appends. Written-pitch range is Bb3–F6.
- `addRest(): boolean`
- `enterTiedNote(): boolean` — MuseScore-style tie: mark the previous note tied and append a same-pitch duplicate of the current duration (no-op if the last note is a rest).
- `selectNote(index): void` — Set the user-selected note (`null` clears; non-pitched indices are ignored). Backs click-to-select a notehead on the entry staff.
- `selectPrev(): void` / `selectNext(): void` — Step the selection to the previous / next pitched note, skipping rests (bound to ←/→).
- `deleteSelectedNote(): void` — Delete the selected note (or the last pitched note when nothing is selected), shifting later note offsets left and repairing straddling ties. Backward-compat alias: `deleteLastNote`.
- `adjustSelectedNotePitch(semitones): void` — Shift the selected note (or last pitched note) by `semitones`, clamped to the written-pitch range. Backward-compat alias: `adjustLastNotePitch`.
- `flipSelectedNoteSpelling(): void` — Toggle the enharmonic spelling of the selected note (or last pitched note). Backward-compat alias: `flipLastNoteSpelling`.

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
- `toggleDotted(): void`
- `setAccidental(acc): void` — Toggles off if already set.
- `adjustOctave(delta): void` — Clamped to 1–8.
- `reset(): void`

### Export

- `getCurrentPhrase(): Phrase` — Builds a `Phrase` in concert pitch with `source: 'user-entered'` and `'user-entered'` / `'practice'` tags, ready to persist. In edit mode (`editingId` set), preserves the original lick id, source, and non-practice tags.

### Edit mode

- `loadFromPhrase(lick): void` — Hydrate the editor from an existing lick: pulls the notes back into written-pitch space, restores key/bar count/name/category, and sets `editingId` / `editingSource` / `editingTags` / `editingCategory`. The `/licks/editor` route branches on `editingId !== null` to swap the Save button label to **Update**, skip the duplicate-detection self-match, route category writes through `updateLickCategory` (so `prog:*` seeding stays consistent with the book detail page), and redirect to `/licks/<id>` after saving.

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

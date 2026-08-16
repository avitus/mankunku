# API Reference: State

Reactive state modules using the Svelte 5 `$state` rune at module scope, plus the plain (non-rune) logic modules that sit beneath them.

The recurring pattern: a `.svelte.ts` module owns the rune and bridges UI to logic, while the testable planning/selection logic lives in a plain `.ts` module beside it — `lick-practice.svelte.ts` / `lick-practice-picker.ts` / `lick-practice-rotation.ts`, and `tune-practice.svelte.ts` / `tune-practice-plan.ts`. Routes own audio orchestration; state modules never do.

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
  metronomeVolume: 0.5,                       // 0-1 mix position; METRONOME_TRIM (0.6) applies underneath
  backingTrackEnabled: true,
  backingInstrument: 'piano' as BackingInstrument,
  backingTrackVolume: 0.6,                    // 0-1
  backingStyle: 'swing' as BackingStyle,      // 'swing' | 'bossa-nova' | 'ballad' | 'straight'
  swing: 0.62,                                // Swing ratio (0.5 = straight, 0.8 = heavy). Default is a
                                              // moderate jazz swing, not straight; exactly 0.50 is also
                                              // resolveBackingSwing's "band follows the tempo curve" sentinel
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
8. Re-derives today's daily summary via `recomputeDailySummary(today, {...})`, passing in the live adaptive snapshot (pitch/rhythm complexity + tonal mastery) that isn't reachable from `SessionResult`. This reads back from the source tables (`progress.sessions` + `lick-practice-sessions`), so lick-practice rows for that day are included.
9. Auto-saves to localStorage (+ optional cloud sync)

### `initFromCloud(supabase): Promise<void>`

Fetch cloud progress for an authenticated user and merge with local. Merges each field independently rather than choosing a whole side: sessions are unioned by id (local wins same-id ties, e.g. in-flight rescores), then sorted newest-first and capped at `MAX_SESSIONS`; adaptive state comes from whichever side has the most recent session timestamp; category/key lifetime counters merge per-key (keep the side with more attempts, folding in the other side's higher `bestScore` / newer `lastAttempt`), proficiency maps merge per entry, and `totalPracticeTime` / `streakDays` / `lastPracticeDate` take the max/newer of the two. The root layout (`+layout.ts`) then calls `recomputeAllDailySummaries()` and `reconcileCloudSummaries()` to re-derive history from the merged source tables.

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

Filter state for the Licks page (the user's book: own + adopted community licks). **Not persisted** — resets on navigation.

The Licks page now lists only the user's own (and adopted community) licks, so the old curated-archive browse filters (category, difficulty, key) were removed. What remains is a search box plus a progression filter that matches on each lick's explicit `prog:*` tags.

### `licks`

```typescript
import type { ChordProgressionType } from '$lib/types/lick-practice';

export const licks = $state<{
  searchQuery: string;
  progressionFilter: ChordProgressionType | null;  // null = show all; matches lick's explicit prog:* tags
}>();
```

No exported functions — the Licks page binds `licks.searchQuery` and `licks.progressionFilter` directly.

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

### `reconcileCloudSummaries(cloudSummaries): DailySummary[]`

Reconcile cloud-side summaries with the local cache during hydration / outbox flush. Every cloud date — DERIVABLE from local source rows or AGED-OUT — is combined with local via a monotonic per-counter MAX merge (`mergeWithExisting`): cloud values win on any counter where the local re-derivation is incomplete (e.g. a boundary date whose older sessions aged out of the 100-session window and re-derives to a partial count), while the unioned-sessions re-derivation wins where it is larger — fixing the equal-count / undercount deadlock. Returns the dates the cloud must be told about (derivable dates, local-only days, and dates where the merged local result now exceeds cloud on any counter) for pushing back via `syncAllDailySummariesToCloud`.

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
  config: LickPracticeConfig;          // sessionType, progressionType, durationMinutes, practiceMode,
                                       //   backingStyle, enableSubstitutions?, singleLickId?, tempoBumpPercent?,
                                       //   trickId?, trickParameters?
  phase: LickPracticePhase;            // 'setup' | 'count-in' | 'lick-running' | 'inter-lick-rest' | 'complete'
  plan: LickPracticePlanItem[];         // Ordered licks + planned keys
  currentLickIndex: number;
  currentKeyIndex: number;
  currentTempo: number;
  keyResults: LickPracticeKeyResult[];  // Results for the current lick (cleared each cycle)
  allAttempts: LickPracticeKeyResult[][]; // Archived results per lick
  startTime: number;
  elapsedSeconds: number;
  progress: LickPracticeProgress;       // Persisted per-lick per-key data
  mode: 'standard' | 'single-lick';     // 'standard' = multi-lick rotation; 'single-lick' = endless deep practice
  // Single-lick-mode only:
  roundNumber: number;                  // Completed full cycles (also drives the trick demo-style rotation)
  masteredThisRound: PitchClass[];      // Keys cleared at ≥ 0.95 in the current round
  roundHistory: SingleLickRoundEntry[]; // Per-round summary (tempo + which keys cleared)
  demoNextCycle: boolean;               // Whether the next cycle opens with a demo (see "Continuous cycles")
  latestKeyResults: Partial<Record<PitchClass, LickPracticeKeyResult>>;  // Session-long, for the ring
  sessionKeys: PitchClass[];            // Stable circle-of-4ths key set, for the ring
}>();
```

`config.sessionType` is `'daily' | 'focused' | 'deep' | 'trick'` — the setup-page
picker, which also decides which start function the page dispatches to.

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

- `hydrateLickPracticeProgress(supabase?, session?)` — Async: pulls cloud lick metadata (best-effort), loads persisted progress, backfills legacy practice tags. Cloud-backed hydration only runs when BOTH a Supabase client and an authenticated `session` are passed; without a session (anonymous users) it forces the local-only path.

### Plan building

- `getPracticeLicks(): Phrase[]` — All `practice`-tagged licks that *also* carry the active progression's `prog:*` tag.
- `getDailyPracticeLicks(): Phrase[]` — All `practice`-tagged licks with at least one `prog:*` tag, regardless of progression.
- `buildSessionPlan(): void` — Standard mode. Sorts licks by least-recently-practiced, packs into the `durationMinutes` budget.
- `buildDailyPracticePlan(): void` — Daily Practice mode. Pools every Daily-eligible lick, assigns each its own least-recently-practiced compatible progression, and packs the budget. Each plan item carries its own `progressionType` instead of inheriting from config.
- `startSession(): void` — Standard entry: sets `mode` to `'standard'`, transitions to `count-in`, resets indices, stamps `startTime`, resolves first-lick tempo.
- `startDailyPracticeSession(): void` — Daily-Practice entry. Clears `config.singleLickId`, calls `buildDailyPracticePlan`, sets `mode` to `'standard'`, then starts.
- `startSingleLickSession(lickOrId: string | Phrase, tempoBumpPercent = 1): boolean` — Single-lick entry. Accepts a `Phrase` or a lick id; returns `false` if the lick can't be resolved. Builds the per-lick plan inline: cycles the lick through its *currently-unlocked* keys via `unlockedCircleFrom(lick.key, unlockedCount)` (not all 12), derives the backing progression from the lick's own `prog:*` tags via `resolveSingleLickProgression`, sets `mode` to `'single-lick'`, seeds `sessionKeys` with the **unsorted** circle while the plan item's `keys` get the worst-first sort, and transitions to `count-in`. Mastered keys (score ≥ 0.95) drop from the next round; tempo bumps by `tempoBumpPercent` (default 1%, rounded up to a whole BPM) once every unlocked key clears and the rotation refills.

  **The tempo is session-local.** The session opens at `deepPracticeStartTempo(resolveLickTempo(...))` — 2% under the lick's stored tempo, applied here rather than inside the shared `resolveLickTempo` so it can't leak into Daily/Focused — and nothing on the deep path writes `LickPracticeKeyProgress.currentTempo` or appends a progress-history sample. `recordKeyAttempt` detects the mode and persists the lick's *baseline* (the key's existing tempo, or `resolveLickTempo` for a first-ever entry) instead of the ramped session value; it cannot simply omit the field, because `updateKeyProgress` merges over `getKeyProgress`'s 100-BPM default. Rolling score, `passCount` and `lastPracticedAt` are still written normally.
- `startTrickSession(): boolean` — Trick entry, driven by `config.trickId` + `config.trickParameters`. Resolves the device from the `TRICKS` catalog, picks its practice bed (`trick.practiceBed?.(params) ?? 'major-vamp'`), builds a C-rooted `TrickContext` from that vamp's first harmony segment, and generates the round-1 example phrase. The plan item is a single `kind: 'trick'` entry whose `phraseId` **is the composite variant key** — `getLickById` misses on it by design and every helper falls back to the item's `phrase`. Trick items always demo, are never re-sorted worst-first, and never write to the lick store.

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

- `buildLickSuperPhrase(lickIdx): Phrase | null` — Concatenates the plan item's keys (plus an optional continuous-mode demo) into a single `Phrase`, so a lick's entire backing track can be scheduled in one Tone.js pass.
- `getDemoBars(lickIdx): number` — Bars the demo occupies, or `0`. The **single source** for both super-phrase layout and window scheduling, so a skipped demo shortens the audio and the recording windows in lockstep. Returns `0` outside continuous mode; in single-lick mode a non-trick item also returns `0` when `demoNextCycle` is false.
- `getKeyBars(): number` — Bars per key for the current mode (progression bars, doubled in call-and-response).
- `getProgressionBars(): number` — Bars in one chord-progression cycle.

### Continuous deep-practice cycles

Single-lick (Deep Practice) sessions do **not** stop between cycles: there are no rest bars and no per-round card. `scheduleLickWindows` returns early for `mode === 'single-lick'` before it would schedule an inter-lick rest, and `closeAndScoreWindow` skips the breather overlay for it. The last key's close event runs the cycle boundary **synchronously**, in this order:

1. `advanceSingleLickRound()` — drop keys mastered at ≥ 0.95, archive the round, re-sort the rotation worst-first, decide `demoNextCycle`, and on a full clear bump tempo by `tempoBumpPercent` (via `nextCycleTempo`) and refill. The two branches differ on persistence by design: the trick branch writes the bumped tempo to the trick store because clearing the rotation *is* the trick unlock, while the lick branch writes nothing at all.
2. `resolveNextCycleStart(...)` — pick the next downbeat, a whole bar at a time, so a stalled main thread stretches the turnaround instead of scheduling audio in the past.
3. Schedule the next cycle's audio and windows.
4. Schedule the ii-V turnaround into the **last bar before** that downbeat.

It has to be synchronous because the final score must already be folded into `rollingScore` before the worst-first sort runs, and because the turnaround's target key — the next cycle's first key — is only knowable after the sort.

The rotation policy itself is pure and lives in [`lick-practice-rotation.ts`](#lick-practice-rotationts). The turnaround bar is built by `audio/turnaround-bar.ts` and played through `playBackingHitsNow` as standalone transport events rather than a `Tone.Part` — `scheduleNextPhrase`'s deferred `disposeBackingParts()` would destroy Part-scheduled events at exactly the moment the turnaround should sound.

### Session control

- `recordKeyAttempt(score, sessionId?): void` — Append a key result and persist per-key progress. `passCount` increments only on score ≥ `KEY_PROFICIENT_THRESHOLD` (0.90, green tier); yellow 0.75–0.89 is recorded but doesn't earn, and below `KEY_FLOOR_THRESHOLD` (0.75) is red and blocks tempo increases + unlocks at session end. `rollingScore` and `lastPracticedAt`, by contrast, are written on **every** attempt including failures — always with an explicit `currentTempo`, because the store's 100-BPM default would otherwise leak into a brand-new lick whose first attempt failed and pin it via `getLickTempo`'s `Math.min`. Trick items never touch the lick store: they write to `persistence/trick-practice-store.ts`, and only on a pass.
- `resetLick(phraseId): void` — Full-reset one lick's per-key scores, `passCount`, and unlock count back to never-practiced (tempo → 60, `passCount`s → 0, one unlocked key). Reassigns the reactive `progress` rune. `phraseId` must be the base lick id. Tags (`practice`, `prog:*`) are preserved. Local-only via `resetLickPersistence`; there is no `supabase?` parameter and reset performs no explicit cloud sync. Surfaced from the post-session report (gated on try-again-band scores) and the book detail page (gated on `hasLickProgress`).
- `advance(): 'next-key' | 'end-of-lick'` — Move to the next key; returns `'end-of-lick'` when the current lick's keys are exhausted.
- `startInterLickTransition(): 'next-lick' | 'complete'` — Archive results, apply the score-weighted tempo adjustment (+2 BPM at ≥ 95%, +1 at ≥ 90%, -1 in the 75–89% yellow band, -3 below 75% — and any single key below `KEY_FLOOR_THRESHOLD` clamps the delta to ≤ 0 regardless of average), then move to the next lick or mark session complete.
- `updateElapsedTime(): void`
- `resetSession(): void`
- `getSessionReport(): SessionReport` — Build the end-of-session report from archived attempts, including any in-progress lick.

---

## lick-practice-rotation.ts

Pure cycle policy behind single-lick Deep Practice. Plain module (no rune, no state imports), so it is unit-testable in Node — the same split as `lick-practice-picker.ts`.

**Source:** `src/lib/state/lick-practice-rotation.ts`

| Export | Signature | Policy |
|---|---|---|
| `sortKeysWorstFirst` | `(keys, rollingFor) → PitchClass[]` | Ascending by rolling score, with an **unknown score coerced to −1** so a never-practiced key sorts worst and gets demoed. Copies the input; relies on a stable sort, so ties keep incoming circle-of-4ths order. |
| `shouldDemoHeadKey` | `(headRolling, threshold = KEY_PROFICIENT_THRESHOLD) → boolean` | Demo while the head key is unknown or **strictly below** 0.90. At 0.90+ the demo is skipped — the user answers in the struggling key immediately. |
| `resolveNextCycleStart` | `(idealStartTick, currentTick, ticksPerBar, minLeadTicks) → number` | Pushes the start forward **by whole bars** until it is at least `minLeadTicks` ahead. A late callback stretches the turnaround; it never schedules audio in the past and never leaves the bar grid. |
| `planCycleWindows` | `({ audioStartTick, demoBars, keyBars, ticksPerBar, keyCount, userBarsOffsetTicks }) → CycleWindowPlan` | Per-key recording `opens[]` / `closes[]` plus `cycleEndTick`. `userBarsOffsetTicks` is non-zero only in call-and-response, where the app plays the first half of each key slot. |

## tricks.svelte.ts

Which trick variants the user has starred for practice. **Persisted** through `persistence/trick-practice-store.ts` (localStorage key `trick-selected-variants`), cloud-synced inside the `user_settings.trick_state` blob.

**Source:** `src/lib/state/tricks.svelte.ts`

```typescript
export const trickState = $state({
  selectedVariants: new SvelteSet<string>()   // composite `${trickId}:${paramSignature}` keys
});
```

`SvelteSet`, not a plain `Set`, so `.add()` / `.delete()` drive the selection UI reactively.

### Functions

- `isVariantSelected(variantKey): boolean`
- `setVariantSelected(variantKey, selected): void` — Local save first, then enqueue an outbox push.
- `toggleVariantSelected(variantKey): boolean` — Returns the new state.
- `hydrateTrickStateFromCloud(supabase): Promise<void>` — Delegates the pull-merge to `initTrickStateFromCloud`, then **re-seeds** the reactive set from the merged local store. Deliberately not a union with the live set: selection is last-writer-wins, and a union would resurrect variants deselected on another device. It also does not re-save, which would stamp a fresh selection mtime and make this device "newest" without a real user edit. Guarded by the scope generation so a mid-flight user switch can't write the previous user's state.

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

- `loadFromPhrase(lick: Phrase, instrument: InstrumentConfig): void` — Hydrate the editor from an existing lick: copies the notes straight across in concert pitch, converts the lick's key back to written pitch via `concertKeyToWritten` (using the `instrument` arg) for the `phraseKey` dropdown, restores bar count/name/category, and sets `editingId` / `editingSource` / `editingTags` / `editingCategory`. The `/licks/editor` route branches on `editingId !== null` to swap the Save button label to **Update**, skip the duplicate-detection self-match, route category writes through `updateLickCategory` (so `prog:*` seeding stays consistent with the book detail page), and redirect to `/licks/<id>` after saving.

---

## tune-entry.svelte.ts

Long-form tune entry, built ON TOP of the shared `stepEntry` buffer: the section list (`tuneEntry.sections`) is authoritative and melody is edited one ≤4-bar PAGE at a time through step-entry, so `PitchEntryPanel` / `DurationSelector` / keyboard entry work unmodified. **Not persisted.**

**Source:** `src/lib/state/tune-entry.svelte.ts`

### `tuneEntry`

```typescript
export const tuneEntry = $state({
  title: string,
  composer: string,
  style: string,
  writtenKey: PitchClass,                  // WRITTEN key at the SOURCE's pitch
  sourceTransposition: SourceTransposition, // what pitch the copied chart is written in
  timeSignature: [number, number],          // manual entry is 4/4-only
  tags: string[],
  sections: TuneSection[],                  // authoritative section list (CONCERT pitch)
  currentSection: number,
  currentPage: number,
  entryCursor: Fraction | null,             // page-local click-to-edit insertion offset
  editingId: string | null,
  editingSource: string | null,
  editingPdfUrl: string | null,
  reviewHandoff: boolean,                   // import flows hand a draft to the editor
  importReview: { warnings: string[]; suspectBars: number[] } | null
});
```

### Key functions

- `initNewTune()` / `resetTuneEntry()` — Fresh single-section draft seeded from the user's instrument.
- `loadFromTune(sheet, instrument)` — Hydrate for edit mode (concert storage → written-pitch editing surface); the PDF flow reuses it with a pre-assigned id so the stored PDF stays linked.
- `loadDraftForReview(sheet, instrument)` / `setImportReview(...)` — Hydrate an unsaved import draft in create mode with review warnings/suspect bars.
- `buildDraftTune(): Tune` — Assemble the concert-pitch `Tune` for save/preview.
- `commitBuffer()` / `suspendEntryBuffer()` / `resumeEntryBuffer()` — Page buffer lifecycle; the buffer commits on page/section navigation and is suspended on route exit so `/licks/editor` never sees tune content.
- `loadPage`, `advanceToNextPage`, `retreatToPrevPage`, `cursorToBar`, `cursorToFlattened`, `selectNextAcrossPages`, `selectPrevAcrossPages` — Chart-position navigation that maps clicks to (section, page) and moves the buffer along.
- `tuneAddNote`, `tuneAddRest`, `tuneEnterTiedNote`, `clearEntryCursor` — Melody entry (gated by `melodyEditingSupported()`: only 4/4 sheets are melody-editable).
- `addSection`, `removeSection`, `updateSectionMeta`, `setSectionBars` — Section list management.
- `setChord(sectionIdx, bar, beat, symbolText)`, `removeChord`, `chordTextAt` — Chords typed as written-pitch text (`parseChordSymbol`), stored concert with re-derived change-point durations.
- `setSheetWrittenKey(newKey, moveNotes)`, `setSourceTransposition(source)`, `entryTranspositionSemitones()` — Whole-sheet key/transposition control.

---

## tune-community.svelte.ts

Filter state for the `/tunes/community` browse page. Global rune module so the filters survive navigation away and back. **Not persisted.**

**Source:** `src/lib/state/tune-community.svelte.ts`

### `tuneCommunity`

```typescript
export const tuneCommunity = $state<{
  searchQuery: string;
  authorQuery: string;
  sort: TuneCommunitySort;  // 'popular' | 'newest'
}>();
```

No exported functions — the community page reads/writes fields directly.

---

## tune-practice.svelte.ts

Scored tune-practice session state — a thin Svelte-5 runes wrapper over the pure logic in `tune-practice-plan.ts`, following the lick-practice split (state module bridges; plain modules carry the testable logic; the route owns audio orchestration). **Not persisted** — see [The Practice Modes](../architecture/overview.md) for why.

**Source:** `src/lib/state/tune-practice.svelte.ts`

### `tunePractice`

```typescript
export const tunePractice = $state<{
  config: TunePracticeConfig;      // mode, strictness, tempo, concertKey, backingStyle, playHead
  phase: TunePracticePhase;        // 'setup' | 'count-in' | 'head' | 'running' | 'complete'
  tuneId: string | null;
  tuneTitle: string;
  plan: InsertionPoint[];
  uncategorizedCount: number;      // Untagged user licks — needs-setup hint on the setup screen
  currentIndex: number;            // Next-or-open insertion point
  windowOpen: boolean;
  results: InsertionResult[];
  totalPoints: number;
  streak: number;
  bestStreak: number;
  pickedSuggestion: Record<string, number>;  // Points mode: insertion id → suggestion index
  freestyleMatches: FreestyleMatch[];
  celebration: { name: string; score: number } | null;
  startTime: number;
  elapsedSeconds: number;
}>();
```

### Session lifecycle

- `initTunePractice(sheet): void` — Enter the setup phase (idempotent per tune; resets `config.concertKey` to the sheet's key on a tune change).
- `previewSessionPlan(sheet, playHead): SessionPreview` — Detect progressions and count insertion points *without* starting audio. Drives the setup screen's "6 insertion points: 3× Short ii-V-I (Maj)…" summary and the preview chart markers.
- `startTunePracticeSession(sheet, ppq): TunePracticeAudioPlan` — Build the plan and return everything the route's audio layer needs: the transposed session `sheet`, the melody-cleared `changesSheet`, the `playedPhrase`, both flattens (`flat` playback-order, `notationFlat` notation-order), `leadBars`, `duplicatedForm`, and the **effective** `playHead`.
- `markHead()`, `markRunning()`, `markWindowOpen(index)`, `recordWindowResult(...)`, `completeTunePracticeSession()`, `resetTunePractice()`.

> **Read `TunePracticeAudioPlan.playHead`, not `config.playHead`.** The former is `config.playHead && hasMelody`; the latter ignores that a melody-less chart never plays a head chorus.

### Windows and suggestions

- `expectedForWindow(...)` — The expected note sequence a closed window is scored against.
- `pickSuggestion(insertionId, index)` / `suggestionNameFor(ip)` — Points-mode pick card.
- `updateElapsedTime()`, `clearCelebration()`.

### Freestyle

- `buildFreestyleBook(ppq): FreestyleBook` — Index only licks the user actually knows (practice set + anything with practice progress + their own/adopted licks). Never the whole curated catalog.
- `recordFreestyleMatch(match): void` — Append the match and raise the applause card.

---

## tune-practice-plan.ts

Pure planning + accumulation logic behind the runes wrapper above. Plain module (no `.svelte.ts`), so it is unit-testable in Node — the same split as `lick-practice-picker.ts`.

**Source:** `src/lib/state/tune-practice-plan.ts`

| Export | Purpose |
|---|---|
| `buildSessionPlan(deps)` | Detected progressions → `InsertionPoint[]`, carrying both timelines, transport open/close ticks, ranked suggestions, and a `markerKey` grouping repeat occurrences |
| `headBarsForFlat(flat)` | The jazz form rule — decides head length from the **expanded section map**, never raw repeat markers |
| `buildSessionPhrase(args)` | Head chorus (melody once) + melody-free solo material; appends a duplicate chorus on repeat-free charts |
| `assignSuggestRotation(plan)` | Least-used-first lick rotation per progression type |
| `strictnessKnobs(strictness, userBleedFilterEnabled)` | Maps strictness onto existing pipeline knobs only — the grading scale never changes |
| `resolvePickedSuggestion(suggestions, pickedIndex)` | The user's pick, else the top rank, else null |
| `applyInsertionResult(tally, …)` | Points = `round(overall * 100)`, doubled when this and the previous window both clear `KEY_PROFICIENT_THRESHOLD` |
| `indexResultsByInsertion(results)` | Keyed lookup — a skipped window contributes no result, so array-position lookup misaligns everything after a gap |
| `insertionMarkerCleared(args)` | Whether a chart marker's every playback window has been cleared |
| `notationBarForPlaybackBar(...)` | Project a playback bar onto its chart bar via `sectionMap` |

Types: `TunePracticeMode` (`'suggest' | 'points' | 'freestyle'`), `TunePracticeStrictness` (`'guided' | 'standard' | 'solo'`), `TunePracticePhase`, `InsertionPoint`, `InsertionResult`, `StrictnessKnobs`, `ResultTally`.

See [Tune System](../architecture/tune-system.md#session-planning) for the design rationale behind each.

---

## community.svelte.ts

Filters and sort for the `/licks/community` browse view. **Not persisted** — resets on navigation.

### `community`

```typescript
export const community = $state<{
  searchQuery: string;
  categoryFilter: PhraseCategory | null;  // null = show all
  difficultyFilter: number | null;        // null = show all
  authorQuery: string;
  sort: CommunitySort;                     // 'popular' | 'newest'
}>();
```

No exported functions — the community page reads/writes fields directly.

---

## lick-suggestions.svelte.ts

Attribution-suggestion state for the `/licks/editor` page. Holds the locally-computed descriptive fallback name plus the server-returned attribution candidates. **Not persisted.**

### `suggestions`

```typescript
export const suggestions = $state<{
  fallbackName: string;               // Deterministic local fallback; always populated
  matches: SuggestionMatch[];         // Async attribution candidates (may be empty)
  loading: boolean;
  pickedFromSuggestion: string | null; // Name the user picked from a suggestion
}>();
```

### Functions

- `requestMatches(phrase): void` — Update the fallback name synchronously, clear stale matches, then debounce (600ms) a `/api/lick-match` request. Skips the network call for phrases with fewer than 6 pitched notes. Cancels any pending debounce / in-flight fetch first.
- `clearSuggestions(): void` — Cancel timers/requests and reset all fields.
- `markPickedFromSuggestion(label): void` — Record that the user adopted a suggested name.
- `clearPickedFromSuggestion(): void` — Clear the picked-name marker.

---

## tour.svelte.ts

Guided-tour completion / dismissal state. **Persisted** to localStorage under key `mankunku:tour-state` (with optional cloud sync).

### `tourState`

```typescript
export const tourState = $state({
  completedTours: SvelteSet<string>,   // Tours finished naturally (clicked Done)
  dismissedTours: SvelteSet<string>,   // Tours closed before finishing
  tourInProgress: null as string | null // Tour ID currently driving the page
});
```

### Functions

- `saveTourState(supabase?): void` — Persist locally; fire-and-forget cloud sync when a client is supplied.
- `loadTourStateFromCloud(supabase): Promise<void>` — Merge cloud completion/dismissal into local (cloud wins for completion so a finished tour never replays).
- `hasSeen(tourId): boolean` — True when the tour was completed **or** dismissed.
- `markComplete(tourId, supabase?): void` — Mark completed (promotes from dismissed if present) and persist.
- `markDismissed(tourId, supabase?): void` — Mark dismissed (no-op if already completed) and persist.
- `resetTours(supabase?): void` — Wipe completion + dismissal history (Settings → "Reset tours"); clears the cloud row rather than unioning.

---

## storage.ts

Thin localStorage wrapper with JSON serialization.

**Source:** `src/lib/persistence/storage.ts`

Keys are namespaced under the active user via `namespace.ts` as `mankunku:u:<uid>:<key>` (with an anonymous bucket for signed-out use), except for a handful of GLOBAL control keys (`__active`, `__schema`, `__lastUserId`) stored as plain `mankunku:<key>`. This isolates each account on a shared browser, so switching users needs no destructive wipe.

`save` / `load` / `remove` / `listKeys` operate on the active user's namespace; `saveGlobal` / `loadGlobal` read and write the non-namespaced control keys.

| Function | Signature | Description |
|---|---|---|
| `save<T>` | `(key, value, syncCallback?) → void` | `JSON.stringify` + `setItem` in the active namespace. Warns on failure (e.g. quota exceeded). |
| `load<T>` | `(key) → T \| null` | `getItem` + `JSON.parse` from the active namespace. Returns `null` on missing/invalid. |
| `remove` | `(key) → void` | Remove a single key from the active namespace |
| `saveGlobal<T>` | `(key, value) → void` | Write a global (non-namespaced) control value |
| `loadGlobal<T>` | `(key) → T \| null` | Read a global (non-namespaced) control value |
| `listKeys` | `() → string[]` | All logical keys in the active namespace (prefix stripped); excludes global control keys |
| `clearAll` | `() → void` | Remove all keys in the ACTIVE user's namespace only. Does NOT touch other users' buckets or the global control keys. |

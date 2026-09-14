# API Reference: State

Reactive state modules using the Svelte 5 `$state` rune at module scope, plus the plain (non-rune) logic modules that sit beneath them.

The recurring pattern: a `.svelte.ts` module owns the rune and bridges UI to logic, while the testable planning/selection logic lives in a plain `.ts` module beside it — `lick-practice.svelte.ts` / `lick-practice-picker.ts` / `lick-practice-rotation.ts`, and `tune-practice.svelte.ts` / `tune-practice-plan.ts`. Routes own audio orchestration; state modules never do.

**Source:** `src/lib/state/`, plus `src/lib/persistence/storage.ts` (the rest of `persistence/` is covered in [State Management](../architecture/state-management.md) and [Data Model](../architecture/data-model.md))

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

`BleedFilterLog` (from `$lib/types/scoring`) captures before/after scoring when the bleed filter removes notes.

No exported functions — components read/write fields directly.

---

## settings.svelte.ts

User preferences. **Persisted** to localStorage under the logical key `settings` (namespaced per user — see [storage.ts](#storagets)).

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

Swing is clamped to `STRAIGHT_SWING`–`MAX_SWING` (0.5–0.8) and an unknown `backingStyle` falls back to `'swing'` on every load, local or cloud.

### `saveSettings(supabase?): void`

Serialize current settings to localStorage and bump a persisted local-edit revision. Call after any user-initiated change. When a Supabase client is supplied, also enqueues a durable outbox push (`'settings'`).

### `flushSettingsToCloud(supabase): Promise<void>`

The outbox flush handler. Throws — so the outbox retries — when the cloud row was never successfully read this session or the push fails; on success it records the pushed revision.

### `loadSettingsFromCloud(supabase): Promise<void>`

Tri-state cloud read. On an **error** local is kept untouched and the push gate stays closed, so a later edit can't clobber the cloud row with stale or default settings. On an **empty** row the local settings are pushed up. When local has **unsynced edits** (local revision ahead of the last pushed one — both persisted, so a pending edit survives a reload) local wins and is re-queued rather than reverted by a whole-blob read. Otherwise cloud values merge over the defaults (same clamps), are written into the rune in place, persisted, and the theme re-applied. Bails if the user scope changed mid-flight.

### `getInstrument(): InstrumentConfig`

Returns the `InstrumentConfig` for the current `instrumentId`. Falls back to tenor sax.

### `getEffectiveHighestNote(): number`

Returns `settings.highestNote` when set, otherwise `instrument.concertRangeHigh - 1` (e.g. tenor sax → 75, concert Eb5).

### `applyTheme(): void`

Toggles `.light` class on `<html>` based on `settings.theme`. No-op in SSR.

---

## progress.svelte.ts

Session history and per-scale/per-key proficiency. **Persisted** to localStorage under the logical key `progress`.

### `progress`

```typescript
export const progress = $state<UserProgress>({
  adaptive: AdaptiveState;                                              // FROZEN legacy state (ratchet retired 2026-08-31; kept for sync compat)
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

Record a completed attempt. `source` defaults to `'ear-training'`; pass `'lick-practice'` for lick-practice runs (those contribute to per-lick progress but skip the ear-training key and scale stats). When a Supabase client is supplied, enqueues durable outbox pushes (`'progress'`, plus `'dailySummaries'` when a summary was touched) after persisting locally. This single function:
1. Creates a `SessionResult` and prepends to `sessions` (bounded to 100)
2. Updates per-scale proficiency (ear-training only)
3. Updates category progress (running average, best score)
4. Updates per-lick progress
5. Updates per-key proficiency + key progress (ear-training only)
6. Updates streak (compares to yesterday's date)
7. Saves to localStorage — before the recompute, which reads the sources back from storage
8. Re-derives today's daily summary via `recomputeDailySummary(today, {...})`, passing in the snapshot values (tonal mastery + per-scale levels, plus the frozen legacy pitch/rhythm complexity kept for sync compatibility) that aren't reachable from `SessionResult`. This reads back from the source tables (`progress.sessions` + `lick-practice-sessions`), so lick-practice rows for that day are included.

### `initFromCloud(supabase): Promise<void>`

Fetch cloud progress for an authenticated user and merge with local. The read is **tri-state**: an error leaves local intact AND keeps the cloud-push gate closed (writing an un-hydrated aggregate over the cloud row is the 2026-07-13 incident class); an empty row makes local authoritative and pushes it; otherwise the merge runs and the merged superset is pushed back so the cloud converges. It merges each field independently rather than choosing a whole side: sessions are unioned by id (local wins same-id ties, e.g. in-flight rescores), then sorted newest-first and capped at `MAX_SESSIONS`; adaptive state comes from whichever side has the most recent session timestamp; category/key lifetime counters merge per-key (keep the side with more attempts, folding in the other side's higher `bestScore` / newer `lastAttempt`), proficiency maps merge per entry, and `totalPracticeTime` / `streakDays` / `lastPracticeDate` take the max/newer of the two. The root layout (`+layout.ts`) then calls `recomputeAllDailySummaries()` and `reconcileCloudSummaries()` to re-derive history from the merged source tables.

### `getRecentSessions(count?): SessionResult[]`

Returns the most recent `count` sessions (default 10), newest first.

### `getCategoryStats(): CategoryProgress[]`

Returns category progress sorted by attempt count (descending).

### `updateSessionScore(sessionId, score, supabase?): void`

Overwrite the score fields of a recorded session with the authoritative post-hoc rescore (ear training records the provisional live score first, then rescores the saved blob ~200–500 ms later). Re-derives that session's day, because the summary is derive-on-write; proficiency and category aggregates deliberately keep their provisional inputs.

### `bumpStreakForToday(supabase?): void`

Advance the streak for today; idempotent within a day (`lastPracticeDate` guard). Lick practice's session-log write path calls it directly.

### `flushProgressToCloud(supabase): Promise<void>`

The outbox flush handler for `'progress'`: throws (so the outbox retries) until a hydration has succeeded, or when the push fails.

### `getTonalMastery(): TonalMastery`

The headline "Tonal Mastery" metric: average proficiency across all 12 scales and all 12 keys, never-attempted slots counting as 0.

### `getUnlockContext(): UnlockContext`

Builds the `UnlockContext` used by the tonality / unlock model from current `scaleProficiency` and `keyProficiency`.

### `resetProgress(supabase?): void`

Destructive reset to initial state; also clears history. Saves immediately. When a Supabase client is supplied, queues the empty push and deletes the cloud detail rows and daily summaries the push would skip. The app-wide reset is `resetAllPracticeData` (reset.ts), which calls this.

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

Long-term daily progress summaries that survive the 100-session prune window in `progress.svelte.ts`. **Persisted** to localStorage under the logical keys `daily-summaries` and `progress-meta`.

Daily summaries are a **pure derivation** of two source-of-truth tables: `progress.sessions` (ear-training) and `lick-practice-sessions` (lick-practice log). **Derive-on-write:** every write to either source calls `recomputeDailySummary(date)` for the day it touched, so divergence is impossible and replaying a write is a no-op; hydration re-derives every date with `recomputeAllDailySummaries`. The persisted blob serves as a cache for past days whose source rows have aged out of the 100-session window.

The exception is the `ComplexitySnapshot` fields (`pitchComplexity`, `rhythmComplexity`, `tonalMastery`, `scaleLevels`) — point-in-time values NOT derivable from the sources, supplied only by ear-training's `recordAttempt`. Every recompute without a fresh snapshot preserves the stored ones, and the merge keeps a defined value over an absent one, because a cloud row mapped from NULL columns carries them present-but-undefined and a plain spread would erase them.

### `dailySummaries`, `progressMeta`

```typescript
export const dailySummaries = $state<DailySummary[]>(/* loaded from localStorage */);
export const progressMeta = $state<ProgressMeta>(/* loaded from localStorage */);
```

`DailySummary` holds per-day aggregates (session count, avg/best scores, practice minutes, grade distribution, category counts) plus the snapshot fields above. `ProgressMeta` holds `{ version, lastAggregationTimestamp, longestStreak, longestStreakEndDate, allTimeSessionCount }`.

### `recomputeAllDailySummaries(complexitySnapshots?): DailySummary[]`

Whole-table re-derivation. Reads the two source-of-truth tables (`progress.sessions` and `lick-practice-sessions`) from localStorage, re-derives summaries for every date that has rows, updates `progressMeta.allTimeSessionCount` + longest streak, and persists. The optional `Map<date, ComplexitySnapshot>` overrides the snapshot per date; without one each date keeps its stored snapshot. Returns the summaries it touched. Called from `+layout.ts` after cloud hydration.

### `recomputeDailySummary(date, complexitySnapshot?): DailySummary | null`

Single-day variant — the per-write path. Called by `recordAttempt` (with a fresh snapshot), `updateSessionScore` (without, so the stored snapshot survives) and the lick-practice session route after each session-log write.

### `deriveDailySummary(date, earSessions, lickEntries, preservedComplexity?): DailySummary | null`

Pure helper that builds a `DailySummary` from the source rows for one day, without persisting. Returns `null` if no rows fall on that date.

### `reconcileCloudSummaries(cloudSummaries): DailySummary[]`

Reconcile cloud-side summaries with the local cache during hydration / outbox flush. Every cloud date — DERIVABLE from local source rows or AGED-OUT — is combined with local via a monotonic per-counter MAX merge (`mergeWithExisting`): cloud values win on any counter where the local re-derivation is incomplete (e.g. a boundary date whose older sessions aged out of the 100-session window and re-derives to a partial count), while the unioned-sessions re-derivation wins where it is larger — fixing the equal-count / undercount deadlock. Returns the dates the cloud must be told about (derivable dates, local-only days, and dates where the merged local result now exceeds cloud on any counter) for pushing back via `syncAllDailySummariesToCloud`.

### `flushDailySummariesToCloud(supabase): Promise<void>`

The outbox flush handler for `'dailySummaries'`: reads the cloud rows (throws on a failed read, so it retries), runs `reconcileCloudSummaries`, and pushes what it returns.

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

Re-exported from `$lib/util/local-date`: `'YYYY-MM-DD'` in local time (used anywhere daily keys are needed).

---

## lick-practice.svelte.ts

Active state for the multi-key lick-practice flow. The live session is ephemeral (resets on reload). Per-lick/per-key cumulative progress is persisted via `persistence/lick-practice-store.ts` under the logical key `lick-practice-progress` (the store also owns `KEY_PROFICIENT_THRESHOLD`, `KEY_FLOOR_THRESHOLD`, `UNLOCK_PASSES_REQUIRED` and the tempo rules). Completed sessions are appended to `lick-practice-sessions` via `persistence/lick-practice-sessions.ts` so history can derive from them.

A practice-tagged lick is only eligible for a session if it also carries an explicit `prog:<progressionType>` tag that its own harmony FITS. `progressionFitsLick(lick, type, opts?) → { fits: true } | { fits: false, reason }` (in `data/progressions.ts`) is the one rule: a 1|1|1-bar ii-V-i fits the long template only, never the half-bar short one and never a vamp; harmony-less editor licks need a native entry long enough; chord-quality licks need their chord family in the slot; everything else honours the tag. Tags seed on category writes (`updateLickCategory`) for the templates the lick fits, are never inferred on hydrate (a user-removed tag stays removed), and misfits are pruned on every successful hydrate; the same rule greys the detail-page pills and re-filters `getPracticeLicks` / `pickProgressionForLick` at read time. Practice-tagged licks with **no** `prog:*` tags are "stranded" and excluded from every plan.

### `lickPractice`

```typescript
export const lickPractice = $state<{
  config: LickPracticeConfig;          // sessionType, progressionType, durationMinutes, practiceMode,
                                       //   backingStyle, enableSubstitutions?, singleLickId?, tempoBumpPercent?,
                                       //   trickId?, trickParameters?
  phase: LickPracticePhase;            // 'setup' | 'count-in' | 'lick-running' | 'inter-lick-rest' | 'complete'
  plan: LickPracticePlanItem[];         // Ordered licks + planned keys
  plannedSeconds: number;               // The in-session countdown's total — the PLAN's length, not durationMinutes; 0 for deep/trick
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
  ramp: FocusRamp | null;               // Focus ramp when launched from the report's weak-key step; null otherwise
}>();
```

`config.sessionType` is `'daily' | 'focused' | 'deep' | 'trick'` — the setup-page
picker, which also decides which start function the page dispatches to. The "standard" `mode` covers both multi-lick types (Daily and Focused); `'single-lick'` covers deep and trick.

`LickBreatherInfo` (`{ lickName, scorePct, next: LickBreatherNext }`, `next` = `{ kind: 'next', name } | { kind: 'done' }`) is the snapshot the inter-lick breather card shows, captured when the last key scores so it stays stable while the state advances. Standard/Daily only — deep practice has no breather.

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
  /** Engrave this row as a lead sheet: the key is the lick's most recently
   *  unlocked one (never at 12/12) AND its persisted rolling score is defined
   *  and under KEY_FLOOR_THRESHOLD (never for trick items). Decided once per
   *  rotation, so a row's height cannot change mid-cycle. */
  reveal: boolean;
  /** Consecutive play windows this row gets: LEAD_SHEET_PASSES (3) for a
   *  revealed row in continuous mode, else 1. */
  passes: number;
}
```

### Hydration

- `hydrateLickPracticeProgress(supabase?, session?)` — Async: pulls cloud lick metadata (best-effort), loads persisted progress, then — only when the cloud pull succeeded (`cloudOk`) — migrates legacy `practice` markers (`backfillPracticeTags`), prunes `prog:*` tags the lick doesn't fit (`pruneIncompatibleProgressionTags`, idempotent, write-on-change) and seeds the progress-history graph from the session log. The gate matters: those writes trigger a whole-column push, and running them over a store that failed to hydrate would sync a partial blob over the intact cloud row (the 2026-07-13 incident class). Cloud-backed hydration only runs when BOTH a Supabase client and an authenticated `session` are passed; without a session (anonymous users) it forces the local-only path, where the maintenance always runs. Finishes by setting `config.progressionType` via `untrack(pickInitialProgression)` so the write can't re-trigger the calling `$effect`.

### Plan building

- `getPracticeLicks(): Phrase[]` — All `practice`-tagged licks that *also* carry the active progression's `prog:*` tag AND fit it (`progressionFitsLick`, re-checked at read time so a tag resurrected by an old-code device is inert), or whose category is a substitution source when `enableSubstitutions` is on.
- `getDailyPracticeLicks(): Phrase[]` — All `practice`-tagged licks with at least one `prog:*` tag, regardless of progression.
- `getStrandedPracticeLicks(): Phrase[]` — Practice-tagged licks with no `prog:*` tag, surfaced on the setup screen so the user can finish configuring them.
- `getUpcomingLicks(): UpcomingLickEntry[]` — The session-complete screen's "Upcoming Licks" list (wraps `buildUpcomingLicks`).
- `getNextStep(report): NextStep | null` — The report's single recommendation (wraps `buildNextStep` with the still-intact plan and the written-pitch key formatter). Takes the report the caller already built so the card can't disagree with the numbers beside it.
- `pickInitialProgression(): ChordProgressionType` — The setup screen's pre-selected progression (wraps `selectInitialProgression`); `DEFAULT_PROGRESSION` when nothing is tagged.
- `resolveLickTempo(progress, phraseId): number` — Session-start tempo: 60 for a never-practiced lick, else the minimum stored tempo across its keys, clamped. Shared by every session type — the deep-practice discount is applied at its call site, never here.
- `computeSessionPlan(): LickPracticePlanItem[]` / `buildSessionPlan(): void` — Focused mode. Sorts licks by least-recently-practiced and packs them into the `durationMinutes` budget; `compute…` is pure with respect to session state (so the setup screen can price a session), `build…` installs the result.
- `computeDailyPracticePlan()` / `buildDailyPracticePlan(): void` — Daily Practice mode. Pools every Daily-eligible lick, assigns each its own least-recently-practiced compatible progression (`pickProgressionForLick`), and packs the budget. Each plan item carries its own `progressionType` instead of inheriting from config.
- `estimatePlanSeconds(plan): number` — THE session estimate: a standard session plays its plan once and stops, so the plan — usually capped by how many licks are tagged, not by the budget — decides the length. Costed with the same helpers the planners budget against (`lick-practice-duration.ts`, including the lead-sheet passes and pause).
- `previewSessionSeconds(): { lickCount, seconds }` — What a session of `config.sessionType` would cost right now, without touching session state; what the setup screen shows instead of the duration knob. Zero for deep and trick.
- `startSession(): void` — Focused entry: sets `mode` to `'standard'`, transitions to `count-in`, resets indices, stamps `startTime`, resolves first-lick tempo.
- `startDailyPracticeSession(): void` — Daily-Practice entry. Clears `config.singleLickId`, calls `buildDailyPracticePlan`, sets `mode` to `'standard'`, then starts.
- `startSingleLickSession(lickOrId: string | Phrase, options?: SingleLickSessionOptions): boolean` — Single-lick entry; `SingleLickSessionOptions` is `{ tempoBumpPercent?, focusKey? }`. Accepts a `Phrase` or a lick id; returns `false` if the lick can't be resolved. An omitted `tempoBumpPercent` falls back to `config.tempoBumpPercent`, then `DEFAULT_TEMPO_BUMP_PERCENT` (1), so a caller that doesn't know about the knob doesn't reset it. Builds the per-lick plan inline: cycles the lick through its *currently-unlocked* keys via `unlockedCircleFrom(lick.key, unlockedCount)` (not all 12), derives the backing progression from the lick's own `prog:*` tags via `resolveSingleLickProgression`, sets `mode` to `'single-lick'`, seeds `sessionKeys` with the **unsorted** circle while the plan item's `keys` get the worst-first sort, and transitions to `count-in`. Mastered keys (score ≥ 0.95) drop from the next round; tempo bumps by `tempoBumpPercent` (default 1%, rounded up to a whole BPM) once every unlocked key clears and the rotation refills.

  **The tempo is session-local.** The session opens at `deepPracticeStartTempo(resolveLickTempo(...))` — 2% under the lick's stored tempo, applied here rather than inside the shared `resolveLickTempo` so it can't leak into Daily/Focused — and nothing on the deep path writes `LickPracticeKeyProgress.currentTempo` or appends a progress-history sample. `recordKeyAttempt` detects the mode and persists the lick's *baseline* (the key's existing tempo, or `resolveLickTempo` for a first-ever entry) instead of the ramped session value; it cannot simply omit the field, because `updateKeyProgress` merges over `getKeyProgress`'s 100-BPM default. Rolling score, `passCount` and `lastPracticedAt` are still written normally.

  **Focus ramp.** With `options.focusKey` (set only by the report's `drill-weak-key` next step) the plan's rotation is that key ALONE, `lickPractice.ramp` is `planFocusRamp(circle, focusKey, savedTempo, rollingFor)` (every other unlocked key queued worst-first) and the session opens at `focusStartTempo(savedTempo)` — 10% under. `advanceSingleLickRound` then routes the lick branch through `resolveRampCycle` while `ramp.phase !== 'complete'`: focus staircase (clear → `nextCycleTempo`; sub-floor → `focusStepDownTempo`; else hold) until a clear lands at or above `targetTempo` — that clear is clamped to the target, so rebuild holds at exactly the saved tempo — then one-key-per-clear rebuild at a held tempo, then the ordinary rule. `sessionKeys` is still the full circle. A focus key the lick hasn't unlocked is ignored (ordinary start). The report carries a `ramp` summary (`FocusRampSummary`: focus key, target, lowest tempo, the up-to-speed and rebuilt rounds), which `splitReportByProgression` preserves.

- `startTrickSession(): boolean` — Trick entry, driven by `config.trickId` + `config.trickParameters`. Resolves the device from the `TRICKS` catalog, picks its practice bed (`trickPracticeBed` — the device's `practiceBed` hook, else `'major-vamp'`: altered/whole-tone triad pairs drill over `'dominant-vamp'`, the melodic-minor family over `'minor-vamp'`, each enclosure type over its own vamp), builds a C-rooted `TrickContext` (`trickContextFor`, shared with the trick page's preview so the two can't drift), and generates the round-1 example in `exampleStyleForRound(trick, 1)`. The key rotation grows from `trickEntryKey(instrument)` — the player's **written C** in concert pitch (concert Bb on tenor) — through the variant's unlocked count, while the generation context stays concert C and transposes per key. The plan item is a single `kind: 'trick'` entry whose `phraseId` **is the composite variant key** — `getLickById` misses on it by design and every helper falls back to the item's `phrase`. Trick items demo on the first cycle and then only on rounds whose example style is new to the session (`trickRoundIntroducesStyle`), are never re-sorted worst-first, and never write to the lick store.

### Cursor accessors

- `getCurrentPlanItem(): LickPracticePlanItem | null`
- `getCurrentProgressionType(): ChordProgressionType` — The active plan item's progression; Daily sessions mix progressions across items, so the header, substitution detection and chord chart read this rather than `config.progressionType` (the fallback before a plan exists).
- `getCurrentKey(): PitchClass | null`
- `getCurrentPhrase(): Phrase | null` — Current lick transposed to the current key with progression harmony substituted.
- `getCurrentHarmony(): HarmonicSegment[]` — Progression template transposed to current key.
- `getPhraseFor(lickIdx, keyIdx): Phrase | null` — Pure variant for scoring keys that have already advanced.
- `getPlannedKey(offset): PlannedKey | null` — Lookahead across lick boundaries.
- `getUpcomingKeys(): { current; next; afterNext }` — Three-row preview helper.
- `getPlannedKeysForLick(lickIdx): PlannedKey[]` — Every planned key for a lick (used by the continuous-scroll preview). Each `PlannedKey` carries `reveal` — the key is the most recently unlocked one and its persisted rolling score is defined and under `KEY_FLOOR_THRESHOLD` (`shouldRevealNotation`; unknown → false; never at 12/12; never for trick items) — and `passes`, decided when the stack is built so a row's height never changes mid-scroll — the stack engraves a revealed row as a lead sheet and holds it for its passes.
- `getKeyPasses(lickIdx): number[]` — Play windows per rotation slot (indexed like `item.keys`, not like the planned rows, which skip a key whose phrase fails to build): `LEAD_SHEET_PASSES` for a revealed key in continuous mode, else 1 (call-response windows already replay the app's half). The single source `buildLickSuperPhrase` and the session page's window scheduler share, as `getDemoBars` is for the demo block. Only a key's **final** pass is the attempt of record — `recordKeyAttempt`, the session-log upsert, `advance()` and the standard score hold run on it alone; a rehearsal pass is scored and flashed on the row and keeps no recording.
- `getKeyPauses(lickIdx): number[]` — Bars of reading pause before each rotation slot's first window (same indexing): `LEAD_SHEET_PAUSE_BARS` for a revealed key in continuous mode unless it opens a cycle that demos (slot 0 follows the demo, which is its herald; on a no-demo refill cycle slot 0 pauses too), else 0. `buildLickSuperPhrase` fills those bars with `turnaroundHarmony(progressionType, key, beatsPerBar)` (`data/progressions.ts` — one bar of ii-V into the key, mode-matched to the progression, repeated so the band vamps) and the scheduler passes them to `planCycleWindows` as `pauses`; `buildPhaseTimeline` turns them into a `read` phase.

### Phrase assembly

- `buildLickSuperPhrase(lickIdx): Phrase | null` — Concatenates the plan item's keys (plus an optional continuous-mode demo) into a single `Phrase`, so a lick's entire backing track can be scheduled in one Tone.js pass.
- `getDemoBars(lickIdx): number` — Bars the demo occupies, or `0`. The **single source** for both super-phrase layout and window scheduling, so a skipped demo shortens the audio and the recording windows in lockstep. Returns `0` outside continuous mode; in single-lick mode a non-trick item also returns `0` when `demoNextCycle` is false.
- `getLickBars(lick, progressionType, enableSubstitutions): number` — Bars one cycle of a lick occupies: the progression's bars for a lick that fits inside the cycle, else extended to `alignmentBars + lengthBars` so the resolution note fits (the final chord is sustained through the tail).
- `getKeyBars(): number` — Bars per key for the current mode: the head lick's `getLickBars` (≥ progression bars), doubled in call-and-response (app half + user half).
- `getProgressionBars(): number` — Bars in one chord-progression cycle; call-response's offset between the app's bars and the user's.

### Continuous deep-practice cycles

Single-lick (Deep Practice) sessions do **not** stop between cycles: there are no rest bars and no per-round card. `scheduleLickWindows` returns early for `mode === 'single-lick'` before it would schedule an inter-lick rest, and `closeAndScoreWindow` skips the breather overlay for it. The last key's close event runs the cycle boundary **synchronously**, in this order:

1. `advanceSingleLickRound()` — drop keys mastered at ≥ 0.95, archive the round, re-sort the rotation worst-first, decide `demoNextCycle` (lick items: continuous mode only, never on a refill cycle — any rotation rebuilt after a full clear, the plain bump-and-refill and the focus ramp's step-up and admission cycles alike, since the EWMA lags the clear — else while `shouldDemoHeadKey` holds; trick items: only when `trickRoundIntroducesStyle` says the next round's example style is new), and on a full clear bump tempo by `tempoBumpPercent` (via `nextCycleTempo`) and refill. The two branches differ on persistence by design: the trick branch writes the bumped tempo to the trick store because clearing the rotation *is* the trick unlock, while the lick branch writes nothing at all. A lick session with a live focus ramp takes a third arm — `resolveRampCycle` sets the next rotation and tempo — and writes nothing itself — `recordKeyAttempt` has already recorded the attempt's rolling score, pass count and recency as in any session, the tempo is never written, and the report's `FocusRampSummary` is logged with the session as every report field is.
2. `resolveNextCycleStart(...)` — pick the next downbeat, a whole bar at a time, so a stalled main thread stretches the turnaround instead of scheduling audio in the past.
3. Schedule the next cycle's audio and windows.
4. Schedule the ii-V turnaround into the **last bar before** that downbeat.

It has to be synchronous because the final score must already be folded into `rollingScore` before the worst-first sort runs, and because the turnaround's target key — the next cycle's first key — is only knowable after the sort.

The rotation policy itself is pure and lives in [`lick-practice-rotation.ts`](#lick-practice-rotationts). The turnaround bar is built by `audio/turnaround-bar.ts` and played through `playBackingHitsNow` as standalone transport events rather than a `Tone.Part` — `scheduleNextPhrase`'s deferred `disposeBackingParts()` would destroy Part-scheduled events at exactly the moment the turnaround should sound.

### Session control

- `recordKeyAttempt(score, sessionId?): void` — Append a key result and persist per-key progress. `passCount` increments only on score ≥ `KEY_PROFICIENT_THRESHOLD` (0.90, green tier); yellow 0.75–0.89 is recorded but doesn't earn, and below `KEY_FLOOR_THRESHOLD` (0.75) is red and blocks tempo increases + unlocks at session end. `rollingScore` and `lastPracticedAt`, by contrast, are written on **every** attempt including failures — always with an explicit `currentTempo`, because the store's 100-BPM default would otherwise leak into a brand-new lick whose first attempt failed and pin it via `getLickTempo`'s `Math.min`. Trick items never touch the lick store: they write to `persistence/trick-practice-store.ts`, and only on a pass.
- `resetLick(phraseId): void` — Full-reset one lick's per-key scores, `passCount`, and unlock count back to never-practiced (tempo → 60, `passCount`s → 0, one unlocked key). Reassigns the reactive `progress` rune. `phraseId` must be the base lick id. Tags (`practice`, `prog:*`) are preserved. Local-only via `resetLickPersistence`; there is no `supabase?` parameter and reset performs no explicit cloud sync. Surfaced from the post-session report (gated on try-again-band scores) and the book detail page (gated on `hasLickProgress`).
- `advance(): 'next-key' | 'end-of-lick'` — Move to the next key; returns `'end-of-lick'` when the current lick's keys are exhausted.
- `startInterLickTransition(): 'next-lick' | 'complete'` — Archive results, apply the score-weighted tempo adjustment (`computeAutoTempoAdjustment`: +2 BPM at ≥ 95%, +1 at ≥ 90%, −1 in the 75–89% yellow band, −3 below 75% — and any single key below `KEY_FLOOR_THRESHOLD` clamps the delta to ≤ 0 regardless of average), write the new tempo to every key of the lick plus a progress-history sample, then move to the next lick or mark the session complete. **Key unlock** happens here too: it needs avg ≥ 0.90 AND the newest key's `passCount` ≥ `UNLOCK_PASSES_REQUIRED` (3) AND no floor breach; an unlock session skips the delta and drops the tempo 10% instead (`tempoAfterKeyUnlock`, rounded, clamped at `MIN_TEMPO`), because the gate only opens on strong sessions and the new key would otherwise arrive faster than the tempo that earned it. A lick with no scored keys leaves the tempo alone. The thresholds and tempo rules live in `persistence/lick-practice-store.ts`.
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
| `shouldDemoHeadKey` | `(headRolling, threshold = KEY_PROFICIENT_THRESHOLD) → boolean` | Demo while the head key is unknown or **strictly below** 0.90. At 0.90+ the demo is skipped — the user answers in the struggling key immediately. The score half of the rule only: `advanceSingleLickRound` vetoes the demo outright on a refill cycle. |
| `newestUnlockedKey` | `(entryKey, unlockedCount) → PitchClass \| null` | The key being learned: the last entry of the `planUnlockedKeys` ramp for the lick's unlock count (count 1 → the entry key). `null` at `MAX_UNLOCKED_KEYS` — nothing is "newest" once every key is unlocked. |
| `shouldRevealNotation` | `(input: NotationRevealInput, floor = KEY_FLOOR_THRESHOLD) → boolean` — input `{ key, entryKey, unlockedCount, rolling }` | Show the sheet music for `key` only when it IS the newest unlocked key AND its rolling score is **defined and strictly below** 0.75. Unknown → `false` (the first attempt is by ear) — the one deliberate inversion of `shouldDemoHeadKey`'s unknown rule; earlier keys and a fully unlocked lick → `false`. Same rule both ways, so the sheet withdraws once the EWMA recovers. |
| `LEAD_SHEET_PASSES` | `3` | Consecutive play windows a revealed key gets in one cycle: read it, read it again, then from memory. |
| `LEAD_SHEET_PAUSE_BARS` | `2` | Bars of band-only reading pause before a revealed key's first pass when it does not open a cycle that demos — the herald of the switch from memory to reading (the previous window closes, the sheet steps in, the band vamps a ii-V, the tab counts the entrance). Two bars, like the inter-lick rest and record-a-lick's count-in — the one-bar turnaround is for a key change in the same mode. |
| `resolveNextCycleStart` | `(idealStartTick, currentTick, ticksPerBar, minLeadTicks) → number` | Pushes the start forward **by whole bars** until it is at least `minLeadTicks` ahead. A late callback stretches the turnaround; it never schedules audio in the past and never leaves the bar grid. |
| `planCycleWindows` | `({ audioStartTick, demoBars, keyBars, ticksPerBar, keyCount, passes?, pauses?, userBarsOffsetTicks }) → CycleWindowPlan` | Per-WINDOW recording `opens[]` / `closes[]` with parallel `keyIndex[]` (rotation slot), `finalPass[]` (the key's last window — the attempt of record) and `pauseTicks[]` (the reading pause laid before this window's slot — non-zero only on a revealed key's first window), plus `cycleEndTick` (the last window's close). `passes` gives windows per key and `pauses` bars of pause before each key's first window (both default to none, both must match `keyCount`); a revealed key's passes abut in its own slot behind its pause. Where pauses go is the caller's policy (`getKeyPauses`). `userBarsOffsetTicks` is non-zero only in call-and-response, where the app plays the first half of each window. |
| `cyclePositionAt` | `(tick, args: CyclePositionArgs) → CyclePosition` — args `{ audioStartTick, demoBars, keyBars, ticksPerBar, ticksPerBeat, loopBeats, windows }` | The display's position read off the SAME plan: `segment` (`lead` before the audio, `demo`, `pause`, `play`, `done`), `keyFraction` (slot + progress through the key's passes — exactly the integer through its pause; the key count past the end) and `beat` (within the chart loop, restarting at every slot start; −1 through a pause and past the cycle end; 0 before the audio). Replaces the route's uniform-slot modulo, which a pause of any length would have skewed. |
| `deepPracticeStartTempo` | `(persisted) → number` | Deep practice's opening tempo: 2% under the saved tempo, rounded, **always at least 1 BPM down**, clamped at `MIN_TEMPO`. |
| `nextCycleTempo` | `(current, percent) → number` | Tempo after a cleared rotation: `current + ceil(current × percent/100)`, clamped at `MAX_TEMPO`. Rounded UP so a 1% bump under 100 BPM can never round to a no-op. |
| `focusStartTempo` | `(persisted) → number` | Focus ramp's opening tempo: `FOCUS_START_DISCOUNT` (10%, the unlock dip) under the saved tempo, same ≥ 1 BPM guard and `MIN_TEMPO` clamp. |
| `focusStepDownTempo` | `(current, percent) → number` | Tempo after a sub-floor attempt in the focus phase: down by `FOCUS_STEP_DOWN_MULTIPLIER` (3) × the bump percent, rounded up, clamped at `MIN_TEMPO`. Mirrors the standard rule's −3/+1 asymmetry. |
| `DEEP_PRACTICE_START_DISCOUNT` / `DEFAULT_TEMPO_BUMP_PERCENT` / `FOCUS_START_DISCOUNT` / `FOCUS_STEP_DOWN_MULTIPLIER` | `0.02` / `1` / `0.1` / `3` | The ramp constants above. `FOCUS_START_DISCOUNT` is the same dip a key unlock applies (`tempoAfterKeyUnlock`): a key that just failed is, for drilling, a new key. |
| `planFocusRamp` | `(circle, focusKey, targetTempo, rollingFor) → FocusRamp \| null` | Opening ramp state: `admitted = [focusKey]`, `queue` = every other unlocked key worst-first, phase `focus`. `null` when the focus key isn't in the circle (caller falls back to an ordinary start). |
| `resolveRampCycle` | `(input: RampCycleInput) → RampCycleOutput` — `{ ramp, survivors, tempo, bumpPercent, focusScore, round }` → `{ ramp, rotation, tempo }` | One cycle boundary, pure and non-mutating. Focus: cleared → step up, and at/above `targetTempo` clamp to the target, leave focus and admit the first queued key (stamping `upToSpeedRound`; complete outright if nothing is queued); not cleared → step down on a sub-floor `focusScore`, hold otherwise. Rebuild: cleared → admit next (the last admission completes, stamping `rebuiltRound`); not cleared → survivors. Tempo held outside focus. `rotation` comes back unsorted — the caller applies worst-first. |

---

## lick-practice-picker.ts

Pure progression-selection helpers behind the setup screen, Daily Practice and the report's "Upcoming Licks" — no runes, so they are Node-testable. The runes module wraps each with its live dependencies.

| Export | Signature | Policy |
|---|---|---|
| `DEFAULT_PROGRESSION` | `'ii-V-I-major'` | The fallback when nothing is tagged |
| `pickProgressionForLick` | `({ lickId, progressionTags, sessionLog, lick? }) → ChordProgressionType \| null` | Among the lick's own `prog:*` tags, the one least recently practiced in the session log; ties go to `PROGRESSION_TEMPLATES` order (the on-screen pill row). With `lick`, tags the lick doesn't FIT (`progressionFitsLick`) are skipped. `null` with no tags — Daily Practice skips the lick, the setup picker falls back to the default |
| `selectInitialProgression` | `({ candidates, progress, sessionLog, getProgressionTags }) → ChordProgressionType` | Finds the least-recently-practiced candidate and delegates to `pickProgressionForLick`. Stranded candidates are excluded — one would otherwise hold the most-neglected slot forever (its `lastPracticedAt` stays 0) and force the default every session |
| `buildUpcomingLicks` | `({ candidates, progress, getProgressionTags }) → UpcomingLickEntry[]` | `{ lick, lastPracticedAt, progressions }` for each lick with at least one `prog:*` tag, oldest first. Substitutions are excluded — they are an opt-in toggle, not a one-click action |
| `findStrandedLicks` | `({ candidates, getProgressionTags }) → Phrase[]` | Practice-tagged licks with no `prog:*` tag — they can never appear in a session, so they exist only to be surfaced for fixing |

---

## lick-practice-duration.ts

The session-duration cost model — the single source both the planner and the setup screen read. A standard / Daily session plays its plan exactly once, so its length is a pure function of the plan and usually shorter than the duration knob (a budget the plan fills only when enough licks are tagged).

| Export | Purpose |
|---|---|
| `INTER_LICK_REST_BARS` (2), `SCORE_HOLD_BARS` (1), `SESSION_COUNT_IN_BARS` (1) | The transport layout: a count-in before the first lick, a two-bar rest between licks (a score-hold bar, then the ii-V cue bar at the next lick's tempo), a score hold after the last. Because rest = count-in + hold, charging every lick one lead-in bar and one hold bar reproduces the layout exactly. Deep practice uses none of it — its cycles join over one turnaround bar |
| `lickAudioBars({ keyCount, lickBars, mode, extraWindows?, pauseBars? })` | Bars of audio one lick contributes — the layout `buildLickSuperPhrase` builds: a `lickBars` demo plus one window per key in continuous mode, doubled windows and no demo in call-response. `extraWindows` (the lead-sheet passes beyond one) and `pauseBars` (the reading pause) charge what a revealed key plays |
| `lickSlotBars(audioBars)` | Audio plus the lead-in and score-hold bars |
| `barsToSeconds(bars, beatsPerBar, tempo)`, `estimateLickSeconds(spec)`, `estimateSessionSeconds(specs)` | Seconds, each lick costed at its own tempo and meter. `LickTimingSpec` is `{ audioBars, beatsPerBar, tempo }`. Human overhead (instrument load, mic open, the report screen) is excluded — it is not on the transport clock the in-session timer counts |

---

## lick-practice-phase.ts

Listen / read / play signalling, derived from the SAME window plan the recorder is scheduled against so the cue and the microphone can never disagree. Pure.

| Export | Purpose |
|---|---|
| `PracticePhase` | `'count-in' \| 'listen' \| 'read' \| 'play' \| 'transition' \| 'idle'` |
| `buildPhaseTimeline({ audioStartTick, windows, ticksPerBar, countInBars?, trailingBars? }) → PhaseSegment[]` | Folds a `CycleWindowPlan` into contiguous `{ phase, startTick, endTick }` segments: every open window is `play`, every gap inside the cycle (the demo, call-response's app half) is `listen`, a reading pause (`pauseTicks`) is `read` — the band vamps, the sheet is up, the player must not play yet. Count-in in front, turnaround / rest (`transition`) behind. Adjacent same-phase segments merge, so continuous mode yields one long play block rather than a countdown at every key boundary |
| `buildOpenEndedTimeline({ audioStartTick, ticksPerBar, countInBars })` | A count-in straight into one open-ended play window (`OPEN_ENDED_TICK` = `Number.MAX_SAFE_INTEGER`) — record-a-lick, where recording runs until the user stops. Built through `buildPhaseTimeline`, so there is one construction path |
| `phaseCueAt(tick, timeline, ticksPerBeat, leadBeats = PHASE_LEAD_BEATS) → PhaseCue` | `{ phase, next, beatsUntilNext, countdown }` — the countdown numeral runs `PHASE_LEAD_BEATS` (4) down to 1 before a switch, else 0. Anticipation beats notification: "play in 2" keeps the flow, "play" on the downbeat has already missed it. Before the timeline reads `transition` (the turnaround bar); past it, `idle` |
| `phaseTabView(cue, keyLabel) → PhaseTabView` | The on-chart tab: `{ kind, text, count }`, `kind` one of `listen`, `listen-in`, `read`, `play-in`, `play`, `rest`, `hidden`. A countdown into `play` from a transition or count-in reads **"Straight in — <key>"** — the skipped-demo turnaround, the one entrance the timeline can't express as a listen block; the last bar of a reading pause is an ordinary "Play <key> in". An open play window always reads `play`: countdowns warn the user to START, never to stop |

---

## lick-practice-next-steps.ts

The report's single next-step recommendation — deliberately one suggestion or none. Pure; nothing persisted (a derivation of the report the caller already has).

### `buildNextStep({ report, plan, formatKey? }): NextStep | null`

Three outcomes, in order: **rest** (`kind: 'rest'`) — a sub-floor average over at least `REST_MIN_ATTEMPTS` (8) keys, exclusive of everything else, because more reps in the same sitting is the one thing that makes it worse; **the one recommendation** — the weakest key under the floor (`'drill-weak-key'`, handed over as a `focusKey` so Deep Practice opens on it alone — the focus ramp) or, with no key under the floor, the lowest-averaging lick (`'drill-weak-lick'`, no key: deep practice already sorts worst-first and demos the head key); **done** — every lick at or above `KEY_PROFICIENT_THRESHOLD`. The weak-key reason names timing when the key's rhythm trails its pitch by more than `RHYTHM_GAP` (0.15). `NextStep` is `{ kind, headline, reason, action }`; `action` (`NextStepAction`, `{ kind: 'deep', lickId, phrase?, focusKey?, label }`) is null for rest and done. `formatKey` renders keys in written pitch to match the chips beside the card. Trick entries are never targeted — their `lickId` is a composite variant key that must not reach a lick start path.


---

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
  phraseKey: 'C' as PitchClass,                   // Written key for the user's instrument (the TONIC)
  phraseMode: 'major' as Mode,                    // Major/minor reading; follows the category until touched
  modeTouched: false,
  phraseName: '',
  category: 'user' as PhraseCategory,
  practiceTag: false,
  // Index of the user-selected element — note OR rest — in `enteredNotes`; `null` =
  // no explicit selection (delete falls back to the last element of any kind,
  // pitch operations to the last pitched note).
  selectedNoteIndex: null as number | null,
  // Edit-mode metadata (non-null when re-opening an existing user-entered lick).
  editingId: null as string | null,
  editingSource: null as string | null,
  editingTags: null as string[] | null,
  editingCategory: null as PhraseCategory | null,
  // Non-null: typed pitches are read as written for a SOURCE chart with this
  // transposition instead of the user's instrument (the tune editor's "chart
  // written for" selector; 0 = concert book). null = follow the instrument.
  transpositionOverride: null as number | null
});
```

### Note input

- `resolveEntryPitch(pitchClass, octave, accidental, referenceConcertPitch): number | null` — The pure half of `addNote`: a typed letter → CONCERT midi. A natural takes the DRAWN key signature (`phraseKey` + `phraseMode`), the octave is the one nearest `referenceConcertPitch` (null = the typed octave literally), the transposition is `transpositionOverride` or the instrument's, and anything outside the written range Bb3–F6 returns null. Reads `stepEntry` config, never mutates.
- `addNote(pitchClass, octave, accidental): boolean` — Validates that the duration fits, resolves the pitch against the last pitched note via `resolveEntryPitch`, appends, selects the new note and resets the accidental.
- `addRest(): boolean`
- `enterTiedNote(): boolean` — MuseScore-style tie: mark the previous note tied and append a same-pitch duplicate of the current duration (no-op if the last note is a rest).
- `selectNote(index): void` — Set the selected element, note or rest (`null` clears; out-of-range indices are ignored). Backs click-to-select a notehead or rest glyph on the entry staff.
- `selectPrev(): void` / `selectNext(): void` — Step the selection to the previous / next element, stopping on rests MuseScore-style (bound to ←/→).
- `deleteSelectedNote(): void` — Delete the selected element, note or rest (nothing selected → the last element of any kind), shifting later offsets left and repairing straddling ties; selection moves to a neighbour, or clears after a delete from the end so append entry resumes. Backward-compat alias: `deleteLastNote`.
- `adjustSelectedNotePitch(semitones): void` — Shift the selected note (nothing selected → the last pitched note) by `semitones`, clamped to the written-pitch range. A selected **rest** is a hard no-op — never a silent retarget. Backward-compat alias: `adjustLastNotePitch`.
- `flipSelectedNoteSpelling(): void` — Toggle the enharmonic spelling of the selected note (same targeting and rest rule; white keys are no-ops). Backward-compat alias: `flipLastNoteSpelling`.

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
- `toggleTriplet(): void` / `toggleDotted(): void` — Mutually exclusive. Turning one ON is refused when the current base has no such variant (no sixteenth triplet, no dotted whole note) — the refusal lives here rather than in the button's `disabled` because both editors bind `t` / `.` straight to these. Turning one OFF is always allowed. The duration id itself resolves through `resolveDurationId` (step-entry/durations.ts).
- `setAccidental(acc): void` — Toggles off if already set.
- `adjustOctave(delta): void` — Clamped to 1–8.
- `reset(): void`

### Export

- `getCurrentPhrase(): Phrase` — Builds a `Phrase` in concert pitch (4/4, key converted from the written `phraseKey`, `mode` always stamped) with `source: 'user-entered'` and `'user-entered'` / `'practice'` tags and an empty id, ready to persist. In edit mode the `/licks/editor` route overwrites id, source and non-practice tags from the `editing*` fields before saving.

### Edit mode

- `setPhraseMode(mode)` — Major/minor reading of `phraseKey`; never moves notes; stops category-follow. `setCategory(category)` — sets the save category and, until the mode control is touched, the mode follows it (minor categories → minor). `switchToRelativeKey()` — relabels F major ↔ D minor (`relativeMinor`/`relativeMajor`) with the notes untouched: the one-click path for licks entered in the relative major when the editor's key signature was major-only. Typed naturals take the DRAWN signature (`signatureAccidentalsFor(phraseKey, phraseMode)`: D minor gives Bb, not C#), and `getCurrentPhrase()` stamps `mode` on every saved lick.
- `loadFromPhrase(lick: Phrase, instrument: InstrumentConfig): void` — Hydrate the editor from an existing lick (`phraseMode = lickMode(lick)`; an explicitly stored mode hydrates as touched, an inferred one keeps following the category): copies the notes straight across in concert pitch, converts the lick's key back to written pitch via `concertKeyToWritten` (using the `instrument` arg) for the `phraseKey` dropdown, restores bar count/name/category, and sets `editingId` / `editingSource` / `editingTags` / `editingCategory`. The `/licks/editor` route branches on `editingId !== null` to swap the Save button label to **Update**, skip the duplicate-detection self-match, route category writes through `updateLickCategory` (so `prog:*` seeding stays consistent with the book detail page), and redirect to `/licks/<id>` after saving.

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
- `commitBuffer()` / `suspendEntryBuffer()` / `resumeEntryBuffer()` — Page buffer lifecycle; the buffer commits on page/section navigation and is suspended (committed + emptied) on route exit so `/licks/editor` never sees tune content.
- `PAGE_BARS` (4 — step-entry's maximum capacity), `currentSectionPageCount()` — Pages are ≤ 4-bar windows of a section; the last may be short.
- `loadPage`, `advanceToNextPage`, `retreatToPrevPage`, `cursorToBar`, `cursorToFlattened`, `selectNextAcrossPages`, `selectPrevAcrossPages` — Chart-position navigation that maps clicks to (section, page) and moves the buffer along. `cursorToFlattened` commits first (the flattened → section mapping is only trustworthy post-commit) and selects by page-local OFFSET, never index arithmetic, because page extraction synthesizes gap rests; `nextPagePosition` / `prevPagePosition` are the pure page steppers behind it, crossing section boundaries.
- `flattenedBufferBase()` — Flattened-note index of the buffer's first note, mapping step-entry's selection onto the full-sheet preview's anchors. `entryCursorPosition()` — where the next note will land (section, bar, beat), or null on a non-4/4 sheet.
- `tuneAddNote`, `tuneAddRest`, `tuneEnterTiedNote`, `clearEntryCursor` — Melody entry (gated by `melodyEditingSupported()`: only 4/4 sheets are melody-editable).
- `addSection`, `removeSection`, `updateSectionMeta`, `setSectionBars` — Section list management (a sheet always keeps one section).
- `tunePickupLength(): Fraction | null` / `hasPickupSection(): boolean` / `setTunePickup(length | null)` — The opening anacrusis, read through the same `resolvePickupLength` the chart uses (explicit field or legacy inference). A NEW pickup gets its own blank-labelled one-bar section in front of the form, with the silent lead-in stored as a rest so the user's sections keep their bar counts and step entry lands the first note on the pickup's beat; an EXISTING pickup is resized where it lives (its own section or the first bar of a labelled one), dropping anything that would now start inside the silent prefix; clearing removes a pickup-only section, while an embedded pickup just loses the field.
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
- `markHead()`, `markRunning()`, `markWindowOpen(index)`, `recordWindowResult(insertionId, lickName, score)`, `completeTunePracticeSession()`, `resetTunePractice()`.

`SessionPreview` is `{ total, byType, uncategorizedCount, markers }`, the markers deduped by `markerKey` and carrying a whole-note `timeRange` for mid-bar band clipping. The module re-exports `emptyResultTally` and the plan types (`InsertionPoint`, `InsertionResult`, `TunePracticeMode`, `TunePracticePhase`, `TunePracticeStrictness`) so routes import the session vocabulary from one place.

> **Read `TunePracticeAudioPlan.playHead`, not `config.playHead`.** The former is `config.playHead && hasMelody`; the latter ignores that a melody-less chart never plays a head chorus.

### Windows and suggestions

- `candidatesForWindow(ip, cueLevel): WindowCandidate[]` — The answers a window is scored against, resolved ONCE at window open so a pick made after the downbeat can't change them: the named lick alone at `'lick'`, every fitting suggestion at `'progression'` / `'none'`. The route scores the take against each and keeps the best (`bestCandidateResult`).
- `expectedForSuggestion(ip, suggestion): { phrase, lickName } | null` — One suggestion's window-aligned expected notes (transposed to its target key, offsets shifted by its alignment inside the window).
- `trickForSuggestion(ip, suggestion): { trick, parameters, context, shift } | null` — That suggestion's trick parts when it is a trick variant; such candidates score through Fluency instead of the exact-phrase pipeline, with the played onsets rebased by `shift` (the window opens at the progression start, the trick lands on a later bar).
- `pickSuggestion(insertionId, index)` / `suggestionNameFor(ip)` — Points-mode pick card.
- `updateElapsedTime()`, `clearCelebration()`.

### Freestyle

- `buildFreestyleBook(ppq): FreestyleBook` — Index only licks the user actually knows (practice set + anything with practice progress + their own/adopted licks), via `buildBookIndex` (`matching/book-index.ts`). Never the whole curated catalog. Recognition searches it with the matcher's default `pitchWeight` (0.6).
- `recordFreestyleMatch(match): void` — Append the match and raise the applause card.

---

## tune-practice-plan.ts

Pure planning + accumulation logic behind the runes wrapper above. Plain module (no `.svelte.ts`), so it is unit-testable in Node — the same split as `lick-practice-picker.ts`.

**Source:** `src/lib/state/tune-practice-plan.ts`

| Export | Purpose |
|---|---|
| `buildSessionPlan(deps: BuildPlanDeps)` | Detected progressions → `InsertionPoint[]`, carrying both timelines, transport open/close ticks, ranked suggestions, and a `markerKey` grouping repeat occurrences |
| `headBarsForFlat(flat) → { headBars, formRepeats }` | The jazz form rule — decides head length from the **expanded section map**, never raw repeat markers, which imports express inconsistently; an internal repeat like `\|: A :\| B A` is not a form outline |
| `buildSessionPhrase(args)` | Head chorus (melody once) + melody-free solo material; appends a duplicate chorus on repeat-free charts |
| `assignSuggestRotation(plan)` | Least-used-first lick rotation per progression type |
| `strictnessKnobs(strictness)` | Maps strictness onto existing pipeline knobs only — listening is identical at every level; only `cueLevel` differs |
| `windowCandidates(suggestions, pickedIndex, cueLevel)` | The answers a window accepts: the named lick alone at `'lick'`, every fitting suggestion otherwise |
| `insertionLabel(args)` | Band text: the lick, the progression, or nothing — never in freestyle |
| `bestCandidateResult(results)` | The candidate the take matched best; unscorable ranks below scored |
| `resolvePickedSuggestion(suggestions, pickedIndex)` | The user's pick, else the top rank, else null |
| `emptyResultTally()` / `applyInsertionResult(tally, insertionId, lickName, score, mode)` | A fresh `ResultTally`; then points = `round(overall * 100)`, doubled when this and the previous window both clear `KEY_PROFICIENT_THRESHOLD` |
| `indexResultsByInsertion(results)` | Keyed lookup — a skipped window contributes no result, so array-position lookup misaligns everything after a gap |
| `insertionMarkerCleared(args)` | Whether a chart marker's every playback window has been cleared |
| `notationBarForPlaybackBar(...)` | Project a playback bar onto its chart bar via `sectionMap` |

Types: `TunePracticeMode` (`'suggest' | 'points' | 'freestyle'`), `TunePracticeStrictness` (`'guided' | 'standard' | 'solo'`), `CueLevel` (`'lick' | 'progression' | 'none'`), `TunePracticePhase`, `InsertionPoint`, `InsertionResult`, `StrictnessKnobs`, `CandidateResult`, `ResultTally`.

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

- `requestMatches(phrase): void` — Update the fallback name synchronously, clear stale matches, then debounce (600ms) a `/api/lick-match` request. Skips the network call for phrases with fewer than 6 pitched notes. Cancels any pending debounce / in-flight fetch first. The endpoint scores against the WJazzD attribution corpus with the shared n-gram matcher (`searchMatches` in `matching/search.ts`), passing `pitchWeight: 0.7` explicitly; the matcher's default of 0.6 is what tune practice's freestyle recognition uses.
- `clearSuggestions(): void` — Cancel timers/requests and reset all fields.
- `markPickedFromSuggestion(label): void` — Record that the user adopted a suggested name.
- `clearPickedFromSuggestion(): void` — Clear the picked-name marker.

---

## tour.svelte.ts

Guided-tour completion / dismissal state. **Persisted** to localStorage under the logical key `tour-state` (with optional cloud sync).

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
- `loadTourStateFromCloud(supabase): Promise<void>` — Union cloud completion/dismissal into local (cloud wins for completion so a finished tour never replays on another device); bails on a user-scope change mid-flight.
- `hasSeen(tourId): boolean` — True when the tour was completed **or** dismissed.
- `markComplete(tourId, supabase?): void` — Mark completed (promotes from dismissed if present) and persist.
- `markDismissed(tourId, supabase?): void` — Mark dismissed (no-op if already completed) and persist.
- `resetTours(supabase?): void` — Wipe completion + dismissal history (Settings → "Reset tours"). Bypasses `saveTourState` — its cloud sync UNIONS with the remote row, so a cleared set would be re-added — and clears the cloud row explicitly instead.

---

## Small plain modules

| Module · export | Purpose |
|---|---|
| `ear-training-flow.ts` · `decideNext({ scoreOverall, failCount, passThreshold }) → NextDecision` | `{ action: 'advance' \| 'retry', nextFailCount }`: a pass always advances; a miss retries the same phrase exactly once, and a second consecutive miss advances anyway so the user is never stuck. Pass the *authoritative* (post-replay-rescore) score, or the retry won't match the score on screen |
| `ear-training-flow.ts` · `resolveBoundPhrase({ looping, current, licks, index }) → BoundPhraseResult` | Which phrase the session binds: frozen while `looping` (a practice loop, including the gap before a pending retry) so a reshuffle can't swap it mid-retry; otherwise `licks[index]`, an out-of-range index clamping to 0; an empty list leaves the current phrase |
| `hydration.ts` · `setHydrationPromise(p)` / `whenHydrated()` / `awaitHydration(timeoutMs = 2000)` | The root layout's fire-and-forget cloud hydration, shared. Most routes read hydrated state reactively; the few that snapshot it once at mount (ear training pins the day's key, tempo and roster) await it, bounded at 2 s so a slow connection degrades to local state. Defaults to resolved and never rejects, so anonymous / offline / SSR loads never block |
| `onboarding-routes.ts` · `ONBOARDING_ROUTE_PREFIXES`, `isOnboardingRoute(pathname)` | The onboarding overlay mounts only on mic-driven practice routes — `/ear-training`, `/lick-practice`, `/tricks`, `/licks/record` (whole-segment prefixes: `/licks/record` matches, the browsable `/licks` does not) plus `/tunes/<id>/practice`. Everywhere else renders clean for a fresh profile, because crawlers render with empty localStorage |
| `reset.ts` · `resetAllPracticeData(supabase?): Promise<void>` | The one "reset everything" flow, shared by Settings and Progress so they can't drift: `resetProgress`, then the lick session log (cleared BEFORE anything can re-derive summaries from it and re-push them into the emptied cloud), the tonality override, local recordings and cloud audio |
| `scale-trend.ts` · `buildScaleLevelSeries({ scaleType, sessions, summaries, currentLevel, today }) → ScaleTrendPoint[]` | The per-scale proficiency series for the /progress trend panel: `DailySummary.scaleLevels` snapshots from the first snapshot date on; before that, the surviving ear-training sessions replayed through `processScaleAttempt` and **anchor-shifted** so the replay ends at the first known real level (sessions are pruned at 100, proficiency accumulates forever, so an unanchored replay from level 1 would understate everything). Always ends at `(today, currentLevel)` so the chart agrees with the "Lv" number beside it |

---

## storage.ts

Thin localStorage wrapper with JSON serialization.

**Source:** `src/lib/persistence/storage.ts`

Keys are namespaced under the active user via `namespace.ts` as `mankunku:u:<uid>:<key>` (with an anonymous bucket for signed-out use), except for a handful of GLOBAL control keys (`__active`, `__schema`, `__lastUserId`) stored as plain `mankunku:<key>`. This isolates each account on a shared browser, so switching users needs no destructive wipe.

`save` / `load` / `remove` / `listKeys` / `clearAll` operate on the active user's namespace only; the global control keys belong to `namespace.ts` (`setActiveUid`, `getActiveUid`, the anon-bucket trust and adoption helpers), and the one-time key-namespacing upgrade runs on module load before the first read or write.

| Function | Signature | Description |
|---|---|---|
| `save<T>` | `(key, value, syncCallback?) → void` | `JSON.stringify` + `setItem` in the active namespace, then runs `syncCallback` (its errors are caught). The first anonymous write in a tab-session marks the anon bucket as authored here, which is what lets a later sign-in adopt it. Warns on failure (e.g. quota exceeded). |
| `load<T>` | `(key) → T \| null` | `getItem` + `JSON.parse` from the active namespace. Returns `null` on missing/invalid. |
| `remove` | `(key) → void` | Remove a single key from the active namespace |
| `listKeys` | `() → string[]` | All logical keys in the active namespace (prefix stripped); excludes global control keys |
| `clearAll` | `() → void` | Remove all keys in the ACTIVE user's namespace only. Does NOT touch other users' buckets or the global control keys. |

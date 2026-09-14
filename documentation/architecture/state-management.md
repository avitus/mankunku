# State Management

Mankunku uses **Svelte 5 runes** for reactive state management with localStorage persistence. There are fourteen state modules, each a `.svelte.ts` file, plus the plain (non-rune) logic modules that sit beside them and stay Node-testable precisely because they own no rune: beneath lick practice, `lick-practice-picker.ts` (progression choice, upcoming/stranded licks), `lick-practice-rotation.ts` (deep-practice cycle policy, tempo ramps, lead-sheet reveal, window planning), `lick-practice-phase.ts` (listen/read/play cue timeline), `lick-practice-duration.ts` (bar-count cost model) and `lick-practice-next-steps.ts` (report recommendations); beneath tune practice, `tune-practice-plan.ts`; and the small cross-cutting ones — `ear-training-flow.ts`, `hydration.ts` (`whenHydrated`/`awaitHydration`, the promise the layout resolves once cloud hydration settles), `reset.ts`, `scale-trend.ts`, `onboarding-routes.ts`.

**Hydration gates.** Every module that syncs a whole blob to the cloud keeps a "did the cloud read verifiably complete" flag and refuses to push until it is set — `settingsHydrationOk` (settings), `progressHydrationOk` (progress), `cloudOk` (lick practice), the tri-state read in the trick store. A failed read leaves the flag false, so a later local edit cannot push stale or default local state over an intact cloud row. That is the 2026-07-13 incident class, and the gate is the structural fix for it; each module also bails when the scope generation (`getScopeGeneration()`, `persistence/user-scope.ts`) changed mid-flight, so a user switch during a fetch can never write the previous user's state.

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
  bleedFilterLog: BleedFilterLog | null;   // A/B comparison for /diagnostics
}>();
```

This module is purely a reactive container — no persistence, no methods. UI components and the practice page read/write fields directly.

### Settings State (`src/lib/state/settings.svelte.ts`)

User preferences. **Persisted** to localStorage under the logical key `settings` (every key below is namespaced per user by the persistence layer — see [Persistence Layer](#persistence-layer-srclibpersistencestoragets)).

```typescript
const defaultSettings = {
  instrumentId: 'tenor-sax',
  defaultTempo: 100,
  masterVolume: 0.8,
  metronomeEnabled: true,
  metronomeVolume: 0.5,      // mix position — METRONOME_TRIM (0.6) applies underneath
  backingTrackEnabled: true,
  backingInstrument: 'piano' as BackingInstrument,
  backingTrackVolume: 0.6,
  backingStyle: 'swing' as BackingStyle,
  swing: 0.62,               // moderate jazz swing out of the box; exactly 0.50 doubles as
                             // resolveBackingSwing's "band follows the tempo curve" sentinel
  theme: 'dark' as 'dark' | 'light',
  onboardingComplete: false,
  tonalityOverride: null as Tonality | null,   // null = auto-selected daily tonality
  highestNote: null as number | null,          // null = instrument default
  bleedFilterEnabled: false                     // A/B toggle for bleed-filtered scoring
};
export const settings = $state(loadSettings());
```

**Key functions:**
- `saveSettings(supabase?)` — Persists settings to localStorage, increments the persisted local revision counter (`settings-local-rev`), and (when a Supabase client is passed) enqueues a durable cloud sync via the outbox
- `flushSettingsToCloud(supabase)` — The outbox handler; throws (so the outbox retries) while `settingsHydrationOk` is false, and records the pushed revision (`settings-synced-rev`) on success
- `loadSettingsFromCloud(supabase)` — Cloud hydration. An errored read keeps local untouched and leaves the push gate closed; an affirmatively empty row pushes local up; unsynced local edits (`localRev > syncedRev`) outrank a whole-blob cloud read, so a re-hydration racing the outbox cannot revert an edit
- `getInstrument()` — Returns the `InstrumentConfig` for the current `instrumentId`
- `getEffectiveHighestNote()` — `settings.highestNote`, else the instrument's `concertRangeHigh − 1`
- `applyTheme()` — Toggles the `.light` class on `<html>` based on `settings.theme`

Settings are loaded on module initialization with a merge strategy: saved values override defaults, new default keys are preserved for forward compatibility, `swing` is clamped to `[STRAIGHT_SWING, MAX_SWING]` (0.5–0.8) and an unknown `backingStyle` falls back to `'swing'`.

### Progress State (`src/lib/state/progress.svelte.ts`)

Session history, per-scale / per-key proficiency, and per-category/per-key stats. **Persisted** to localStorage under the logical key `progress`.

```typescript
export const progress = $state<UserProgress>(loadProgress());
```

**Key functions:**
- `recordAttempt(phraseId, phraseName, category, key, tempo, difficultyLevel, score, scaleType?, supabase?, source = 'ear-training')` — Records a session, advances the scale and key proficiencies (`processScaleAttempt` / `processKeyAttempt`), updates category/key stats and the streak, saves, then re-derives today's daily summary with a fresh `ComplexitySnapshot` (see History below) and queues the cloud push.
- `updateSessionScore(...)` — Replaces a session's score after the authoritative blob rescore; recomputes the day's summary WITHOUT a snapshot, so the stored one is preserved.
- `bumpStreakForToday(supabase?)`, `getUnlockContext()`, `getTonalMastery()` — Streak and proficiency readers used by tonality unlocking and the Tonal Mastery meter.
- `initFromCloud(supabase)` / `flushProgressToCloud(supabase)` — Hydration and the outbox handler, gated by `progressHydrationOk`. The merge unions sessions by id (local wins a same-id collision, newest `MAX_SESSIONS` kept); per scale / per key, the proficiency with more `totalAttempts` wins (a tie goes to the higher level); per-category and per-key stats keep the side with more attempts but fold in the other side's better `bestScore` and later `lastAttempt`; totals and the streak take the max, `lastPracticeDate` the later; and the frozen `adaptive` blob comes whole from whichever device practiced most recently.
- `getRecentSessions(count)`, `getCategoryStats()`, `resetProgress(supabase?)`.

Session history is bounded to 100 entries (`MAX_SESSIONS`, `persistence/limits.ts`; oldest trimmed on insert). `progress.adaptive` is **frozen**: its ratchet (`processAttempt`) was retired 2026-08-31, but the field still round-trips hydrate, the cloud merge and the `adaptive_state` column, and `recordAttempt` still reads its (static) pitch/rhythm values into the daily snapshot for row compatibility — see [Data Model](./data-model.md#adaptivestate).

**Streak tracking:** Compares `lastPracticeDate` to today's ISO date string. If yesterday → increment streak; if not today and not yesterday → reset to 1.

### Licks State (`src/lib/state/licks.svelte.ts`)

Filter state for the Licks page (the user's book: own + adopted community licks). **Not persisted.**

```typescript
import type { ChordProgressionType } from '$lib/types/lick-practice';

export const licks = $state<{
  searchQuery: string;
  progressionFilter: ChordProgressionType | null;
}>({
  searchQuery: '',
  progressionFilter: null
});
```

The curated-archive browse filters (category, difficulty, selected key) were retired when the library refocused on the user's own book. `progressionFilter` matches on a lick's explicit `prog:*` tags only.

### History State (`src/lib/state/history.svelte.ts`)

Long-term daily progress summaries that survive the 100-session pruning window in `progress.svelte.ts`. **Persisted** to localStorage under the logical keys `daily-summaries` and `progress-meta`.

```typescript
export const dailySummaries = $state<DailySummary[]>(loaded.summaries);
export const progressMeta = $state<ProgressMeta>(loaded.meta);
```

Daily summaries are a **pure derivation** of two source-of-truth tables: `progress.sessions` (ear-training) and `lick-practice-sessions` (lick-practice log). **Derive-on-write:** every write that touches either source calls `recomputeDailySummary(date)` for the day it touched — `recordAttempt` and `updateSessionScore` in progress state, and the lick-practice session route after each `upsertLickPracticeSession` — so divergence is impossible and replaying a write is a no-op; `recomputeAllDailySummaries` is the full rebuild the layout runs on hydration. The persisted blob serves as a cache for past days whose source rows have aged out of the 100-session window — those days survive untouched until cloud merge brings in newer data.

The exception to "pure derivation" is the **`ComplexitySnapshot`** (`pitch`, `rhythm`, `tonalMastery`, `scaleLevels`) — point-in-time values not derivable from the sources, supplied only by ear-training's `recordAttempt`. Every recompute without a fresh snapshot preserves the stored one, and `mergeWithExisting` keeps a **defined value over an absent one** (`derived.x ?? existing.x`) because a cloud row mapped from NULL columns carries the fields as present-but-undefined, which a plain spread would erase; `scaleLevels` is unioned by key, since each device only snapshots the scales it practiced. Counters merge by per-counter max (a session can't be undone), and notes/averages follow the side with more attempts on record.

**Key functions:**
- `recomputeDailySummary(date, complexitySnapshot?)` — Primary write path: re-derives ONE day from the source tables, merges over the cached row, persists, and returns the summary (the caller enqueues the `dailySummaries` outbox kind).
- `recomputeAllDailySummaries(complexitySnapshots?)` — Re-derives every day present in either source; the hydration-time rebuild.
- `deriveDailySummary(date, sessions, lickSessions, preservedComplexity?)` — Pure helper that builds a `DailySummary` from the source rows for one day, without persisting.
- `reconcileCloudSummaries(cloudSummaries: DailySummary[]): DailySummary[]` — Reconciles cloud summaries into the local cache after cloud hydration via the same `mergeWithExisting` rule applied to every cloud date (derivable or aged-out). Returns the dates the cloud must be told about; `flushDailySummariesToCloud` is the outbox handler.
- `updateLongestStreak()` — Maintains `progressMeta.longestStreak` from the summary set.
- `getSummariesInRange(start, end)` — Inclusive date range query for charts.
- `comparePeriods(currentStart, currentEnd, previousStart, previousEnd)` — Returns `{ current, previous, delta }` for week-over-week / month-over-month comparisons.
- `getYearHeatmap()` — `Map<date, { sessionCount, avgOverall }>` sized to the last 365 days for the calendar heatmap.
- `getLast30Days()` — `Map<date, hasPractice>` for streak displays.
- `getWeekRanges()`, `getMonthRanges()` — Convenience date-range builders.
- `clearHistory()` — Destructive reset (called from `resetProgress()`).

On first load the module self-migrates: if no v2 meta is found in localStorage, the next `recomputeAllDailySummaries` call rebuilds summaries from `progress.sessions` + `lick-practice-sessions` and persists them.

### Lick Practice State (`src/lib/state/lick-practice.svelte.ts`)

Active state for the multi-key lick-practice flow: configuration, session plan, per-key results, and tempo adjustments. Each lick's key rotation expands gradually — a brand-new lick starts with just one unlocked key (its entry key) and earns each next key as alternating sharp/flat-side neighbours of the entry key on the circle of fifths (see `planUnlockedKeys` in `src/lib/music/key-ordering.ts`). Each key is graded on a green/yellow/red scale against two thresholds in `persistence/lick-practice-store.ts`: `KEY_PROFICIENT_THRESHOLD = 0.90` (green) and `KEY_FLOOR_THRESHOLD = 0.75`. The unlock gate requires (1) average session score ≥ `UNLOCK_AVG_THRESHOLD` (= `KEY_PROFICIENT_THRESHOLD`, 0.90), (2) `passCount ≥ UNLOCK_PASSES_REQUIRED` = 3 on the newest-unlocked key — only green attempts of record (≥ 0.90) increment `passCount`, which is once per key per lick in a Daily/Focused session — and (3) no red key in the session (any key below the floor blocks the unlock). Tempo delta (`computeAutoTempoAdjustment`): +2 BPM at ≥ 95%, +1 at ≥ 90%, -1 in the 75–89% yellow band, -3 below 75% — and a single red key clamps the delta to ≤ 0 regardless of average. **A session that unlocks a key skips the delta and drops the tempo 10% instead** (`tempoAfterKeyUnlock`, rounded, clamped at `MIN_TEMPO`): the gate only opens on a strong session, so the brand-new key would otherwise arrive faster than the tempo that earned it. Once a lick has earned all 12 keys, `planLickKeys` takes over for staged variety. The reactive `$state` object is ephemeral (resets on reload), but cumulative per-lick/per-key progress (including unlock counts and `passCount`) is persisted via `persistence/lick-practice-store.ts` under the logical keys `lick-practice-progress` and `lick-unlock-count` (plus `lick-progress-history`, `lick-tag-overrides`, `lick-category-overrides`, `lick-merge-meta`).

```typescript
export const lickPractice = $state<{
  config: LickPracticeConfig;
  phase: LickPracticePhase;            // 'setup' | 'count-in' | 'lick-running' | 'inter-lick-rest' | 'complete'
  plan: LickPracticePlanItem[];         // Ordered licks + planned keys
  plannedSeconds: number;               // The in-session countdown's total (0 for endless deep/trick sessions)
  currentLickIndex: number;
  currentKeyIndex: number;
  currentTempo: number;
  keyResults: LickPracticeKeyResult[];
  allAttempts: LickPracticeKeyResult[][];
  startTime: number;
  elapsedSeconds: number;
  progress: LickPracticeProgress;       // Cumulative per-lick per-key data
  mode: 'standard' | 'single-lick';
  roundNumber: number;                  // Deep practice: 1-based cycle counter
  masteredThisRound: PitchClass[];      // Deep practice: keys cleared at ≥ 0.95 this cycle
  roundHistory: SingleLickRoundEntry[]; // Deep practice: per-round log for the report
  demoNextCycle: boolean;               // Deep practice: does the next cycle open with a demo?
  latestKeyResults: Partial<Record<PitchClass, LickPracticeKeyResult>>;
  sessionKeys: PitchClass[];
  ramp: FocusRamp | null;               // Deep practice: the focus ramp when launched from the report's weak-key step; null in every other session
}>( /* defaults */ );
```

**Continuous cycles (Deep Practice).** Single-lick sessions never stop between cycles — no rest bars, no per-round card. The last key's close event runs the cycle boundary synchronously: advance the round, re-sort the rotation **worst-first**, schedule the next cycle a bar out, and drop a 1-bar full-rhythm-section ii-V turnaround into the gap, targeting the key the next cycle opens on. It must be synchronous because the final score has to be in `rollingScore` before the sort, and the turnaround's target is only known after it.

Worst-first ordering comes from a per-key `rollingScore` — an EWMA (alpha 0.4) over **every** scored attempt, passes and failures alike, persisted in `LickPracticeKeyProgress`. An absent score counts as unknown and sorts worst, so an unfamiliar key still gets demoed. The demo itself is **skipped** once the head key's rolling score reaches 0.90: the point of a demo is the key you can't play yet. It is also skipped on every **refill cycle** — a rotation rebuilt after a full clear (the plain bump-and-refill, and the focus ramp's step-up and admission cycles alike): the user just played every key in it at this tempo, and a rolling score that lags the clear (a 0.95 from a 0.7 history lands at 0.8) is no reason to replay the line. `advanceSingleLickRound` applies that veto (`survivors.length > 0`); `shouldDemoHeadKey` is only the score half of the rule. Tricks demo only when the round's example style is new to the session (`trickRoundIntroducesStyle`: enclosures once, triad pairs once per style — a regenerated realization of the same figure is not new to the ear), standard sessions always demo, and the first cycle of any session always demos as a reminder of the lick.

The same rolling score drives the in-session **sheet-music reveal** — for ONE key per lick: the key being learned. When the key stack is built (`getPlannedKeysForLick` — at the top of the session route's `initializeSession`, before the mic, worklet, samples and detector load, so the rows and the sheet are on screen while the instrument's 307 samples decode; then again at each lick or cycle start, the keyed rows keeping their DOM) every `PlannedKey` is stamped `reveal` and `passes`: the key is the **most recently unlocked** one (`newestUnlockedKey(entryKey, unlockedCount)` — the last entry of the pure `planUnlockedKeys` ramp, derivable from the per-lick unlock count with no timestamp; null at 12/12, so a fully unlocked lick never reveals) AND its rolling score is defined and below `KEY_FLOOR_THRESHOLD` (0.75) — `shouldRevealNotation` in `state/lick-practice-rotation.ts`, which unlike `shouldDemoHeadKey` treats an unknown score as *no* reveal, so the first attempt in any key is by ear. Earlier keys never reveal however they score: they were learned before the next one arrived. Decided once per stack (`revealDecisionsFor`, one unlock-count read per rotation) and never re-derived mid-cycle, because a revealed row is TALLER and a row's height must not change while the stack scrolls. The rule is the same in both directions: the row engraves after a sub-floor attempt and returns to chord blocks once the EWMA recovers, in every session type (Daily, Focused, Deep; the focus ramp reveals only when its focus key is the newest). A revealed key runs **`LEAD_SHEET_PASSES` (3) consecutive play windows** in continuous mode (`passes`; call-response keeps one — its windows already replay the app's half): `getKeyPasses(lickIdx)` is the single source `buildLickSuperPhrase` lays the backing out from and the session page schedules windows from (`planCycleWindows` with `passes` → per-window `opens`/`closes` plus `keyIndex`/`finalPass`), exactly as `getDemoBars` is for the demo block; the plan-time cost model charges the extra windows through `lickAudioBars.extraWindows`. Only the key's **final pass is the attempt of record** — `recordKeyAttempt`, the session-log upsert, `advance()` and (standard mode) the score hold run on it alone; a rehearsal pass is scored and flashed on the row and nothing else, and keeps no recording. **The sheet waits its turn, behind a reading pause.** A revealed key that does not open the cycle gets `LEAD_SHEET_PAUSE_BARS` (2) bars of band-only pause before its first pass — `getKeyPauses(lickIdx)`, indexed like `getKeyPasses` — during which `buildLickSuperPhrase` lays the cycle-join turnaround harmony (`turnaroundHarmony`, `data/progressions.ts`: a bar of ii-V into the key) once per bar, so the band vamps into the new key; `planCycleWindows` takes the same list as `pauses` and reports it per window as `pauseTicks`, which `buildPhaseTimeline` turns into a `read` segment (tab: READ, then the usual "Play G in 4·3·2·1"); the cost model charges it through `lickAudioBars.pauseBars`. A revealed key at slot 0 gets none when the cycle demos — the demo is its herald, with the sheet up while the line plays — but on a no-demo cycle (a refill whose head key is still under the floor) it gets the pause in the demo's place, so the sheet is never sprung on the downbeat the mic opens; `cycleDemos()` in the state module is the one source `demoBarsForItem` and `pauseBarsFor` both read, and from the turnaround bar the tab reads REST into READ, never "Straight in". The stack holds the revealed row still through its pause and all its passes: the route reads its position each frame off the scheduled plan with `cyclePositionAt` (rotation module) — row, pass and beat, the beat restarting at each slot so a pause of any length leaves every later key aligned, −1 through the pause — and the component keeps the engraved staff `visibility: hidden` under a chord-chart placeholder until the row is current, i.e. from the start of its pause, when the stack steps (if there is a row above to step past — row 0 parks at the top of the viewport, so a two-row stack stands still) and the chart cross-fades into the staff. Read-ahead parking (2026-09-03, morning) — the row before the sheet at the top so the sheet sat lit a key early — was withdrawn the same day: the sheet must not appear until the previous key has been played. — in a Daily session the newest key is the LAST row, and without this the sheet arrived half-clipped and dimmed on the very tick the mic opened. `UpcomingKeysDisplay` renders a revealed row as a **lead-sheet row**: `leadSheetTuneFor` (`music/lead-sheet.ts`) wraps the row's phrase as a one-section `Tune` for `NotationDisplay tune=` (`frameless`, `staffWidth` 640 with the SVG sized by width so that number is the zoom, and `tuneOptions` — the phrase's mode, one stretched system, no bar number — through `tuneToAbc`, which engraves the chords), the current bar marked ON the staff via a `playhead` `rangeMarker` drawn from abcjs's own bar geometry (so the marker's bars align with the engraved bars by construction — the old equal-width beat strip could not), the PLAY tab counting the pass; no caption, by decision.

`latestKeyResults` and `sessionKeys` exist for the progress ring specifically. `keyResults` is cleared every cycle and the plan item's `keys` array shrinks and reorders as keys master out — a ring bound to either would lose dots and jump around. `sessionKeys` holds the stable circle-of-4ths key set; `latestKeyResults` holds the newest result per key for the whole session.

**Focus ramp.** The report's weak-key recommendation (`drill-weak-key` in `lick-practice-next-steps.ts`) launches Deep Practice with a `focusKey`, and the session runs a three-phase ramp instead of the clear-bump-refill rule — `lickPractice.ramp: FocusRamp`. *Focus*: the rotation is that key alone, opened `focusStartTempo` under the saved tempo (10%, the unlock dip), staircased at every cycle boundary (a one-key rotation, so a cycle is one attempt) — clear → `nextCycleTempo`, sub-floor → `focusStepDownTempo` (three times the bump), in between → hold — until a clear lands at or above the saved tempo. *Rebuild*: each full clear admits the next queued key (worst-first by rolling score), tempo held, until the queue drains. *Complete*: the ordinary rule resumes. `sessionKeys` stays the full circle so the ring shows the not-yet-admitted keys as empty dots; `LickHeader` shows the phase in place of "Key n/N". Same persistence contract as the rest of deep practice: the live ramp state, the session tempo and the rotation are never written and the lick's stored **tempo** is untouched — `recordKeyAttempt` still records each key's rolling score, pass count and `lastPracticedAt` on every attempt, exactly as in any session — and the report keeps its usual fields plus the derived `FocusRampSummary`, logged with the session like any other report field. The setup page and the lick detail page still start on the full worst-first rotation.

The pure policy — `sortKeysWorstFirst`, `shouldDemoHeadKey`, `newestUnlockedKey`, `shouldRevealNotation`, `resolveNextCycleStart`, `planCycleWindows`, and the focus ramp's `focusStartTempo`, `focusStepDownTempo`, `planFocusRamp`, `resolveRampCycle` — lives in `state/lick-practice-rotation.ts` so it can be tested without a transport.

A practice-tagged lick is only eligible for a session if it also carries an explicit `prog:<progressionType>` tag for that progression. Those tags are added automatically when the lick's category is set — for the templates the lick's own harmony FITS (`progressionFitsLick` in `data/progressions.ts`: a 1|1|1-bar ii-V-I gets the long template only, a ½|½|1 one the short; cadence licks never fit a vamp) — and the user can add/remove them by hand; the detail page greys pills the lick can't play over (a tagged-but-unfit pill stays removable), the picker and `getPracticeLicks` skip unfit tags at read time, and `pruneIncompatibleProgressionTags` drops misfits on every successful hydrate. The minor templates are ii-7b5 · V7b9 · i-7 (`MINOR_CADENCE`).

**Key functions:**
- `hydrateLickPracticeProgress(supabase?, session?)` — Async: pulls cloud lick metadata when signed in (`initLickMetadataFromCloud`, which reports success rather than throwing), then loads persisted progress. Three maintenance passes run **only inside the `cloudOk` gate** — `backfillPracticeTags` (migrates legacy `practice` markers out of `lick.tags`/tag overrides), `pruneIncompatibleProgressionTags` (drops `prog:*` tags the lick's own harmony doesn't fit) and the one-time `seedProgressHistoryFromSessions` — because writing over a store that failed to hydrate would push a partial blob over the intact cloud row. Nothing here infers tags from categories on hydrate; that backfill was removed and must not return. The initial progression is picked under `untrack` so the write can't re-trigger the `$effect` that called it.
- `getPracticeLicks()` — All licks tagged `practice` that *also* carry the active progression's `prog:*` tag (fit re-checked at read time), plus — with `enableSubstitutions` on — licks whose category is a substitution source for the progression. `getStrandedPracticeLicks()` (practice-tagged, no progression at all) backs the setup page's needs-attention list and the library's flag; `getUpcomingLicks()` backs the session-complete screen's Upcoming Licks list.
- `getNextStep(report)` — The report's recommendation (`lick-practice-next-steps.ts`): the `drill-weak-key` step is what launches the focus ramp.
- `resolveLickTempo(progress, phraseId)` — The lick's stored tempo (`NEW_LICK_DEFAULT_TEMPO` = 60 for a fresh lick); every session type reads it, and the deep-practice discount is applied at the `startSingleLickSession` call site, never inside it.
- `getDailyPracticeLicks()` — All practice-tagged licks with at least one `prog:*` tag, regardless of progression. Powers Daily Practice mode.
- `buildSessionPlan()` — Focused sessions. Installs `computeSessionPlan()`, which sorts licks by least-recently-practiced and packs the time budget, costing each lick before it is appended on the same model `estimatePlanSeconds` reports (a lone lick that outruns the budget is still planned rather than leaving Start a no-op). Each lick's planned key list is the first N keys of the alternating sharp/flat ramp where N is its current unlock count (capped at 12, then handed off to `planLickKeys` for staged variety). Called by `startSession()`.
- `buildDailyPracticePlan()` — Daily Practice mode, installing `computeDailyPracticePlan()`. Pools every lick from `getDailyPracticeLicks()`, sorts least-recently-practiced first, picks each lick's least-recently-practiced compatible progression via `pickProgressionForLick`, and packs the duration budget. Each plan item carries its own `progressionType` instead of inheriting from config. When the session ends, the writer in `persistence/lick-practice-sessions.ts` calls `splitReportByProgression` to log one session entry per progression — the picker's least-recently-practiced lookup stays accurate even when a single Daily Practice run touched several progressions.
- `startSession()`, `startDailyPracticeSession()`, `startSingleLickSession(lickOrId: string | Phrase, options: SingleLickSessionOptions = {}): boolean` (options: `{ tempoBumpPercent?: number; focusKey?: PitchClass }`), `startTrickSession()` — The four entry points; all converge on the same playback engine. **Three tempo rules, one per start path:** standard and Daily sessions open at the lick's stored tempo and move it once per lick per session by the score-weighted delta (or the unlock drop) in `startInterLickTransition`; single-lick Deep Practice cycles only the lick's currently-unlocked keys and runs a **session-local tempo ramp that is never persisted** — opens at `deepPracticeStartTempo` (2% under the stored tempo, `Math.min(t − 1, …)` so rounding can't make the ease-in a no-op), climbs by `nextCycleTempo` per cleared rotation (`config.tempoBumpPercent` of the *current* tempo, 1% by default, 0.5–5% from the setup knob, rounded UP because 1% below 100 BPM would floor to zero; an omitted `tempoBumpPercent` keeps the knob rather than resetting it), with `focusKey` runs the focus ramp described above, and **derives its progression from the chosen lick's own `prog:*` tags** (least-recently-practiced fitting tag, as Daily does; else the first template the lick fits, `getProgressionsForLick`; else `DEFAULT_PROGRESSION`) rather than `config.progressionType` — fixes the case where a major lick gets stuck over a minor vamp because the setup screen was set that way. `startTrickSession` rides the same round loop with a single `kind: 'trick'` plan item whose phrase is regenerated every round; see [Trick Scoring](./trick-scoring.md).
- `getCurrentPlanItem()`, `getCurrentKey()`, `getCurrentPhrase()`, `getCurrentHarmony()`, `getCurrentProgressionType()` — Cursor accessors for the active lick/key.
- `getPhraseFor(lickIdx, keyIdx)` — Pure variant used when scoring a key that has just finished.
- `getPlannedKey(offset)`, `getUpcomingKeys()`, `getPlannedKeysForLick(lickIdx)` — Lookahead accessors for the key stack; the stack for the first lick is built at the top of the route's `initializeSession`, before any audio loads (see the lead-sheet paragraph above), and a refused microphone clears the prebuilt rows and shows the microphone banner in their place (`micError`, `data-testid="mic-error"`) rather than leaving a populated, silent stack.
- `buildLickSuperPhrase(lickIdx)` — Concatenates the plan item's keys (plus an optional demo in continuous mode, extra passes and reading pauses for a revealed key) into one phrase so the whole lick can be scheduled in a single Tone.js pass. `getDemoBars(lickIdx)`, `getKeyPasses(lickIdx)` and `getKeyPauses(lickIdx)` are the single sources for the demo's length and the per-key passes/pauses, read by both this layout and the route's window scheduling, so a skipped demo shortens the audio and the recording windows together. `getLickBars` / `getKeyBars` / `getProgressionBars` give the per-lick cycle length (see [Lick Alignment](./lick-alignment.md)).
- `recordKeyAttempt(score, sessionId?)` — Appends a `LickPracticeKeyResult` and **persists key progress on every attempt** (`rollingScore` must see failures; recency counts an attempt as practice), incrementing `passCount` only on green attempts (≥ `KEY_PROFICIENT_THRESHOLD` = 0.90). `currentTempo` is written explicitly because `updateKeyProgress` merges over `getKeyProgress`'s 100-BPM default — and in single-lick mode it writes the key's **baseline** (`prev?.currentTempo ?? resolveLickTempo(...)`), never the ramped session tempo, so deep practice can't ratchet the stored tempo. Trick items go to the trick store instead, only on a pass.
- `resetLick(phraseId)` — Wipes one lick's per-key scores, `passCount`, and unlock count (tempo back to `NEW_LICK_DEFAULT_TEMPO` = 60, one unlocked key) via `resetLickPersistence`, which also stamps a reset tombstone in the merge meta so a stale device's older practice can't resurrect it. Tags (`practice`, `prog:*`) are preserved. Surfaced from the post-session report (gated on try-again-band score) and the book detail page (gated on `hasLickProgress`).
- `advance()` — Moves to the next key within the current lick; returns `'end-of-lick'` when out.
- `startInterLickTransition()` — Standard/Daily only. Archives results, computes the score-weighted delta (clamped to ≤ 0 when any key fell below `KEY_FLOOR_THRESHOLD`), decides the unlock as `!floorBreached && shouldUnlockNextKey({ avgScore, newestKeyPassCount, unlockedCount })`, writes either `tempoAfterKeyUnlock(currentTempo)` (an unlock) or `clampTempo(currentTempo + delta)` to every key of the lick, appends a `LickProgressPoint` sample, and advances to the next lick or marks `'complete'`.
- `advanceSingleLickRound()` — Deep practice's cycle boundary (see above): re-sorts worst-first, applies the ramp or the bump-and-refill rule, decides `demoNextCycle`. The lick branch persists **neither** a per-key tempo nor a history sample (a point at an unheld BPM would promote the lick across `lick-phase.ts`'s display thresholds while Daily still runs it slower); the trick branch deliberately still persists, because clearing the rotation IS the trick unlock and tricks have no daily-session return path.
- `updateElapsedTime()`, `resetSession()`, `getSessionReport()`, and `estimatePlanSeconds(plan)` / `previewSessionSeconds()` — the latter prices a Daily or Focused session from the pure planners without starting one, since the plan (usually capped by how many licks are tagged) rather than the duration knob decides how long it runs; `plannedSeconds` is the in-session countdown's total, 0 for the endless deep and trick sessions.

### Step Entry State (`src/lib/state/step-entry.svelte.ts`)

UI state for manual lick entry in the editor (the `/licks/editor` and `/licks/add` routes). **Not persisted** — the draft resets when the route unmounts; completed phrases are exported via `getCurrentPhrase()` and saved through `persistence/user-licks.ts`.

```typescript
export const stepEntry = $state({
  currentDuration: 'eighth' as BaseDurationId,
  tripletMode: false,
  dottedMode: false,
  selectedOctave: 4,
  accidental: 'natural' as 'sharp' | 'flat' | 'natural',
  enteredNotes: [] as Note[],
  barCount: 2,
  phraseKey: 'C' as PitchClass,          // WRITTEN key
  phraseMode: 'major' as Mode,           // follows the category until the user touches the mode control
  modeTouched: false,
  phraseName: '',
  category: 'user' as PhraseCategory,
  practiceTag: false,
  // Index into `enteredNotes` of the user-selected element — note OR rest;
  // `null` = no explicit selection (delete falls back to the last element,
  // pitch operations to the last pitched note)
  selectedNoteIndex: null as number | null,
  // Edit-mode metadata (non-null when re-opening an existing user-entered lick)
  editingId: null as string | null,
  editingSource: null as string | null,
  editingTags: null as string[] | null,
  editingCategory: null as PhraseCategory | null,
  // Lead-sheet editor only: interpret typed pitches as written for a SOURCE
  // chart with this transposition (0 = concert book); null = follow the instrument
  transpositionOverride: null as number | null
});
```

The user enters notes in their instrument's **written** pitch (what they see on their chart). Validation happens in written space (`ENTRY_RANGE_LOW`/`HIGH` = written `Bb3`–`F6`) and notes are converted to concert pitch at storage time using `instrument.transpositionSemitones` (or `transpositionOverride`), keeping the canonical storage contract. Typed naturals take the **drawn** signature: with `phraseMode: 'minor'` a D-minor lick gives Bb, not C#.

**Key functions:**
- `addNote(pitchClass, octave, accidental)` — Validates the duration fits, applies key-signature accidentals for the drawn key + mode (when the explicit accidental is `'natural'`; `resolveEntryPitch` is the pure resolver), picks the nearest octave to the previous note, converts written → concert, appends.
- `addRest()`, `enterTiedNote()` (tie the last note into the current one).
- `selectNote(index)`, `selectPrev()`, `selectNext()` — Set/move the selection (click a notehead or rest glyph, or step with ←/→, which stop on rests, MuseScore-style).
- `deleteSelectedNote()` — Deletes the selected element (note or rest; nothing selected → the last element of any kind), shifting later offsets left and repairing straddling ties. `adjustSelectedNotePitch(semitones)`, `flipSelectedNoteSpelling()` — Pitched notes only: a selected rest is a hard no-op, never a silent retarget; nothing selected → the last pitched note. `deleteLastNote` / `adjustLastNotePitch` / `flipLastNoteSpelling` remain as aliases.
- `setCategory(category)` / `setPhraseMode(mode)` — The mode follows the chosen category until the user touches the Major|Minor control (`modeTouched`); `switchToRelativeKey()` relabels F major ↔ D minor without moving a note.
- `getCurrentPhrase()` — Builds a `Phrase` with `user-entered` source, the WRITTEN key converted to concert, `mode` stamped, and the optional `practice` tag, for export.
- `getCurrentCursorOffset()`, `getMaxCapacity()`, `getRemainingCapacity()`, `canAddDuration(duration)`, `getCurrentBarAndBeat()` — Cursor helpers.
- `getPaddedNotes()` — Pads entered notes with a final rest so partial bars render cleanly in notation.
- `setBarCount(n)` (1–4, trims overflow; clears the selection if it now points past the end), `setDuration(id)`, `toggleTriplet()`, `toggleDotted()` (these two refuse to switch an inapplicable modifier ON — there is no sixteenth triplet and no dotted whole — because both editors bind `t`/`.` straight to them; see `step-entry/durations.ts`), `setAccidental(acc)`, `adjustOctave(delta)`, `reset()`.
- `loadFromPhrase(lick, instrument)` — Edit mode entry point. Hydrates the state from an existing lick (converts concert pitches back to written using the given instrument's transposition, restores key/mode/bar count/name/category) and stamps `editingId` / `editingSource` / `editingTags` / `editingCategory`. The `/licks/editor` route branches on `editingId !== null` to swap the Save → Update label, skip duplicate-detection self-match, route category changes through `updateLickCategory` (preserving `prog:*` seeding), and redirect to `/licks/<id>` on save. Mic-recorded licks are not editable — only `source === 'user-entered'`.

### Community State (`src/lib/state/community.svelte.ts`)

Filter and sort state for the `/licks/community` browse view. **Not persisted.**

```typescript
export const community = $state<{
  searchQuery: string;
  categoryFilter: PhraseCategory | null;
  difficultyFilter: number | null;
  authorQuery: string;
  sort: CommunitySort;                 // 'popular' | 'newest'
}>( /* defaults */ );
```

### Trick State (`src/lib/state/tricks.svelte.ts`)

Which melodic-device variants the user has starred for practice. **Persisted** through `persistence/trick-practice-store.ts` and cloud-synced as part of the single `user_settings.trick_state` JSONB blob.

```typescript
export const trickState = $state({
  selectedVariants: new SvelteSet<string>()   // composite `${trickId}:${paramSignature}` keys
});
```

Trick progress lives in its **own** storage keys, never in the lick store — a composite variant key inside a lick blob would look like a lick id to everything downstream, and there are explicit guards in the report-reset and history-seed paths against it leaking there.

**Key functions:** `isVariantSelected(key)`, `setVariantSelected(key, selected)`, `toggleVariantSelected(key)` — each mutation saves locally first and the store enqueues the `trickState` outbox push; `hydrateTrickStateFromCloud(supabase)`.

Selection merges last-writer-wins by `selectedUpdatedAt` rather than by union, because a union would resurrect variants the user un-starred on another device. `hydrateTrickStateFromCloud` therefore delegates the whole pull-merge to `initTrickStateFromCloud`, then **re-seeds** the reactive set from the merged local store instead of adding to it, and deliberately does not re-save (which would stamp a fresh mtime and make this device "newest" without a real user edit). It bails on a scope-generation change, and runs the one-time local migrations (`runLocalTrickMigrations` — `enclosure-type-v1` re-keys pre-`type` enclosure variants onto the major chain) **only after a successful hydrate**: a failed cloud read leaves local truth unknown, and rewriting + pushing over it is the 2026-07-13 incident class. (A signed-out session has no cloud to wait for, so the layout runs them directly.) The same migration also runs on both sides of every cloud merge (`persistence/trick-state-migrations.ts`), because the merge unions variant keys and a stale row would otherwise resurrect legacy keys forever.

### Tour State (`src/lib/state/tour.svelte.ts`)

Guided-tour progress: which tours the user has finished, dismissed, or is currently running. **Persisted** to localStorage under the logical key `tour-state` (completed + dismissed IDs), with optional cloud sync (`user_settings.tour_state`).

```typescript
export const tourState = $state({
  completedTours: new SvelteSet<string>(),  // finished naturally (clicked Done)
  dismissedTours: new SvelteSet<string>(),  // closed before finishing
  tourInProgress: null as string | null     // tour ID currently driving
});
```

`completedTours` / `dismissedTours` use `SvelteSet` (not a plain `Set`) so `.add()` / `.delete()` / `.clear()` trigger reactivity for `hasSeen`-driven UI.

**Key functions:**
- `markComplete(tourId, supabase?)` / `markDismissed(tourId, supabase?)` — Completion promotes from dismissed and takes precedence over a later dismissal; both call `saveTourState`.
- `saveTourState(supabase?)` — Persists the completed/dismissed snapshot and syncs to the cloud when a client is passed. The cloud write **unions** with the remote row.
- `loadTourStateFromCloud(supabase)` — Cloud wins for completion: every remote completed id is added locally (a finished tour never replays on another device); remote dismissals are added unless the tour is completed.
- `resetTours(supabase?)` — Clears both sets and `tourInProgress`, then writes the cleared snapshot **directly** and calls `clearTourStateInCloud` — deliberately bypassing `saveTourState`, whose union sync would re-add the cleared ids.
- `hasSeen(tourId)`.

### Lick Suggestions State (`src/lib/state/lick-suggestions.svelte.ts`)

Descriptive fallback name plus server-returned attribution candidates for the lick editor (`/licks/editor`). **Not persisted.**

```typescript
export const suggestions = $state<SuggestionsState>({
  fallbackName: '',                    // computed locally, always populated
  matches: [],                         // arrive asynchronously, may be empty
  loading: false,
  pickedFromSuggestion: null           // name the user picked; cleared on reset
});
```

The fallback name is computed locally from the entered phrase (`fallback-name.ts`); the `matches` (quote / wjazzd attribution candidates from `/api/lick-match`) arrive asynchronously via `requestMatches(phrase)` and may be empty. `clearSuggestions()`, `markPickedFromSuggestion(label)`, `clearPickedFromSuggestion()`.

### Tune Entry State (`src/lib/state/tune-entry.svelte.ts`)

Long-form tune entry, built **on top of** the shared `stepEntry` buffer rather than beside it. The section list is authoritative; melody is edited one ≤4-bar *page* (`PAGE_BARS`) at a time through step-entry, so `PitchEntryPanel` / `DurationSelector` / keyboard entry all work unmodified. The buffer commits on page and section navigation (`commitBuffer`), and is suspended (committed + emptied) on route exit (`suspendEntryBuffer` / `resumeEntryBuffer`) so `/licks/editor` never sees tune content. **Not persisted.**

Exports the `tuneEntry` rune plus `initNewTune` / `resetTuneEntry`, `loadFromTune`, `buildDraftTune`, `loadDraftForReview` (hydrating an unsaved import draft in create mode; the PDF flow uses `loadFromTune` with a pre-assigned id so the stored PDF stays linked) and `setImportReview` (the warnings panel). Section editing: `addSection` / `removeSection` / `updateSectionMeta` / `setSectionBars`; chords: `setChord` / `removeChord` / `chordTextAt`; key and source pitch: `setSheetWrittenKey(newKey, moveNotes)`, `setSourceTransposition`.

**Pickup bars** (`setTunePickup(length | null)`, `tunePickupLength()`, `hasPickupSection()`): a NEW pickup becomes its own unlabeled one-bar section in front of the form — so the user's sections keep their bar counts — with the silent lead-in stored as a rest, which is what makes step entry land the first typed note on the pickup's beat. An EXISTING pickup (its own section, or embedded in a labelled section an importer wrote) is resized in place, never doubled; clearing removes a pickup-only section, while an embedded pickup just loses the field. All three read the same resolver the chart does (`music/pickup.ts`, `resolvePickupLength` / `isPickupOnlySection`).

Chords are typed as written-pitch text (`parseChordSymbol`) and stored concert with re-derived change-point durations. Manual entry is 4/4-only (`melodyEditingSupported`); imported charts in other meters keep their meter with melody editing gated off, since the 4/4 buffer would corrupt them.

### Tune Practice State (`src/lib/state/tune-practice.svelte.ts`)

Scored tune-practice session state. A thin runes wrapper over the pure logic in `tune-practice-plan.ts` — the same split as `lick-practice.svelte.ts` / `lick-practice-picker.ts`, with the route owning audio orchestration. **Not persisted**, deliberately: tune takes don't move the streak, the adaptive level, or per-lick key scores.

```typescript
export const tunePractice = $state<{
  config: TunePracticeConfig;   // mode ('suggest' | 'points' | 'freestyle'), strictness ('guided' | 'standard' | 'solo'),
                                // tempo, concertKey, backingStyle, playHead
  phase: TunePracticePhase;     // 'setup' | 'count-in' | 'head' | 'running' | 'complete'
  tuneId: string | null; tuneTitle: string;
  plan: InsertionPoint[];
  uncategorizedCount: number;   // needs-setup hint on the setup screen
  currentIndex: number; windowOpen: boolean;
  results: InsertionResult[];
  totalPoints: number; streak: number; bestStreak: number;
  pickedSuggestion: Record<string, number>;   // points mode: insertion id → chosen suggestion index
  freestyleMatches: FreestyleMatch[];
  celebration: { name: string; score: number } | null;
  startTime: number; elapsedSeconds: number;
}>( /* defaults */ );
```

Exports: `initTunePractice(sheet)`, `previewSessionPlan(sheet, playHead)`, `startTunePracticeSession(sheet, ppq) → TunePracticeAudioPlan`, the phase transitions (`markHead`, `markRunning`, `markWindowOpen`, `completeTunePracticeSession`), `candidatesForWindow` (what a window is scored against — the named lick, or every fitting one), `pickSuggestion` / `suggestionNameFor`, `recordWindowResult`, `buildFreestyleBook(ppq)`, `recordFreestyleMatch`, `clearCelebration`, `updateElapsedTime`, `resetTunePractice`. See [Tune System](./tune-system.md#session-planning) and [API Reference: State](../api-reference/state.md#tune-practicesveltets).

### Tune Community State (`src/lib/state/tune-community.svelte.ts`)

Filter and sort state for the `/tunes/community` browse view. Global rune module so filters survive navigating away and back. **Not persisted.**

```typescript
export const tuneCommunity = $state<{
  searchQuery: string;
  authorQuery: string;
  sort: TuneCommunitySort;             // 'popular' | 'newest'
}>( /* defaults */ );
```

## Persistence Layer (`src/lib/persistence/storage.ts`)

Thin wrapper around `localStorage` with JSON serialization:

**Which bucket a page uses.** Storage modules read the active namespace when they are first evaluated, so a page must never hydrate under the wrong user. The server writes its verdict into the document head — `<meta name="mankunku-auth">` holding only the verified uid and the `degraded` flag (`persistence/auth-verdict.ts`, written by `authVerdictHandle` in `hooks.server.ts`, which resolves the session once per request) — and the client's `init` hook (`hooks.client.ts`) runs `reconcileBeforeHydration` before SvelteKit imports a single route node. If the bucket is wrong it re-stamps the pointer and reloads once the old page has settled (`util/document-settled.ts`: the `load` event plus fonts, capped at 5 s), returning a promise that never settles so hydration never starts; Sentry starts only on pages that will boot. A `sessionStorage` guard (`mankunku:reload-target`) declines a second reload to the same target, so a broken verdict runs stale rather than looping. The root `+layout.ts` keeps the same call for client-side re-runs `init` never sees (sign-in through `use:enhance`, `invalidate('supabase:auth')`), and once it issues a reload it never settles either — returning data there let SvelteKit render the previous user's in-memory state over the new user's storage. Until 2026-09-11 the decision lived only in `+layout.ts`, whose reload aborted the in-flight route imports and ran the error handler during teardown.

- All keys carry the outer `mankunku:` prefix. User data is namespaced under the active user by `namespace.ts` — `mankunku:u:<uid>:<key>` for a signed-in user, the bare legacy path `mankunku:<key>` for the anonymous bucket — so switching accounts needs no destructive wipe. The GLOBAL control keys (`__active`, the bucket this device homed to; `__schema`, the one-time namespace-upgrade marker; the legacy `__lastUserId`) are read and written only inside `namespace.ts`.
- `save<T>(key, value, syncCallback?)` — `JSON.stringify` + `setItem` into the ACTIVE user's namespace; invokes `syncCallback` after a successful local write. The first anonymous write in a tab marks the anon bucket as authored, which is what lets a later sign-in adopt it.
- `load<T>(key)` — `getItem` + `JSON.parse` from the active user's namespace, returns `null` on missing/invalid
- `remove(key)` — Remove a single key from the active user's namespace
- `listKeys()` — Logical keys in the ACTIVE user's namespace only (prefix stripped; global keys excluded)
- `clearAll()` — Clears only the active user's namespace; does NOT touch other users' buckets or the global control keys

Importing the module runs `runNamespaceUpgradeIfNeeded()` once, before the first read or write in the realm.

Error handling: `save` warns on failure (e.g., quota exceeded), `load` returns `null` on parse errors.

## Pattern: Reactive State + Manual Save

Unlike auto-saving stores, Mankunku uses **explicit save calls**. This avoids excessive writes during rapid state changes (e.g., real-time pitch detection updating `session.currentPitchMidi` at 60fps).

- **Session**: Never persisted (ephemeral per-visit data)
- **Settings**: Saved on each user action (e.g., changing instrument, toggling metronome)
- **Progress**: Saved after each completed attempt via `recordAttempt()`
- **History**: Saved by `recomputeDailySummary(date)` after every write to `progress.sessions` or `lick-practice-sessions` (derive-on-write), plus the `recomputeAllDailySummaries` rebuild on cloud hydration
- **Licks**: Never persisted (filter state resets on navigation)
- **Lick Practice**: Live session state is ephemeral; per-lick/per-key progress is persisted by `persistence/lick-practice-store.ts` after **every** scored key (the rolling score needs failures too), plus each standard-session tempo adjustment and session end. Deep practice's session tempo, rotation and ramp are never written.
- **Tricks**: Selection saved on every toggle via `persistence/trick-practice-store.ts`, which enqueues an outbox push; per-variant progress written on each pass
- **Step Entry** / **Tune Entry**: Never persisted — drafts are exported to `persistence/user-licks.ts` / `persistence/user-tunes.ts` when the user saves
- **Community** / **Tune Community**: Never persisted (browse filter/sort state resets on navigation)
- **Tour**: Saved via `saveTourState()` whenever a tour is completed or dismissed; cloud-synced when signed in; `resetTours` writes directly and clears the cloud row
- **Tune Practice**: Never persisted, by decision — no streak, no proficiency movement, no per-key lick writes
- **Lick Suggestions**: Never persisted (per-draft suggestion state, cleared on reset)

Cloud pushes go through the durable **outbox** (`persistence/outbox.ts`): intents coalesce by kind — `progress`, `settings`, `dailySummaries`, `trickState`, `lickMeta`, `userLicks`, `tunes` (`OutboxKind`) — and are drained against the *current* local state, so rapid edits collapse into one push and a push that throws is retried. The layout drains it once cloud hydration settles, which is also when anything queued offline or in an earlier session goes up. Tour state is the exception: `saveTourState` syncs directly, not through the outbox.

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

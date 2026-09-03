# State Management

Mankunku uses **Svelte 5 runes** for reactive state management with localStorage persistence. There are fourteen state modules, each a `.svelte.ts` file, plus the plain (non-rune) logic modules that sit beneath the two practice flows — `lick-practice-picker.ts`, `lick-practice-rotation.ts`, `tune-practice-plan.ts` — which stay Node-testable precisely because they own no rune.

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
- `saveSettings(supabase?)` — Persists settings to localStorage, increments the local revision counter, and (when a Supabase client is passed) enqueues a durable cloud sync via the outbox
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
- `reconcileCloudSummaries(cloudSummaries: DailySummary[]): DailySummary[]` — Reconciles cloud summaries into the local cache after cloud hydration via a per-counter MAX-merge applied to every cloud date (derivable or aged-out): cloud wins on any counter where the local re-derivation is incomplete, local wins where it is larger. Returns the dates the cloud must be told about for `syncAllDailySummariesToCloud`.
- `getSummariesInRange(start, end)` — Inclusive date range query for charts.
- `comparePeriods(currentStart, currentEnd, previousStart, previousEnd)` — Returns `{ current, previous, delta }` for week-over-week / month-over-month comparisons.
- `getYearHeatmap()` — `Map<date, { sessionCount, avgOverall }>` sized to the last 365 days for the calendar heatmap.
- `getLast30Days()` — `Map<date, hasPractice>` for streak displays.
- `getWeekRanges()`, `getMonthRanges()` — Convenience date-range builders.
- `clearHistory()` — Destructive reset (called from `resetProgress()`).

On first load the module self-migrates: if no v2 meta is found in localStorage, the next `recomputeAllDailySummaries` call rebuilds summaries from `progress.sessions` + `lick-practice-sessions` and persists them.

### Lick Practice State (`src/lib/state/lick-practice.svelte.ts`)

Active state for the multi-key lick-practice flow: configuration, session plan, per-key results, and tempo adjustments. Each lick's key rotation expands gradually — a brand-new lick starts with just one unlocked key (its entry key) and earns each next key as alternating sharp/flat-side neighbours of the entry key on the circle of fifths (see `planUnlockedKeys` in `src/lib/music/key-ordering.ts`). Each key is graded on a green/yellow/red scale against two thresholds in `persistence/lick-practice-store.ts`: `KEY_PROFICIENT_THRESHOLD = 0.90` (green) and `KEY_FLOOR_THRESHOLD = 0.75`. The unlock gate requires (1) average session score ≥ `UNLOCK_AVG_THRESHOLD` = 0.90, (2) `passCount ≥ UNLOCK_PASSES_REQUIRED` = 3 on the newest-unlocked key — only green attempts (≥ 0.90) increment `passCount`, at most once per session — and (3) no red key in the session (any key below the floor blocks the unlock). Tempo delta: +2 BPM at ≥ 95%, +1 at ≥ 90%, -1 in the 75–89% yellow band, -3 below 75% — and a single red key clamps the delta to ≤ 0 regardless of average. Once a lick has earned all 12 keys, `planLickKeys` takes over for staged variety. The reactive `$state` object is ephemeral (resets on reload), but cumulative per-lick/per-key progress (including unlock counts and `passCount`) is persisted via `persistence/lick-practice-store.ts` under `mankunku:lick-practice-progress` and `mankunku:lick-unlock-count`.

```typescript
export const lickPractice = $state<{
  config: LickPracticeConfig;
  phase: LickPracticePhase;            // 'setup' | 'count-in' | 'lick-running' | 'inter-lick-rest' | 'complete'
  plan: LickPracticePlanItem[];         // Ordered licks + planned keys
  currentLickIndex: number;
  currentKeyIndex: number;
  currentTempo: number;
  keyResults: LickPracticeKeyResult[];
  allAttempts: LickPracticeKeyResult[][];
  startTime: number;
  elapsedSeconds: number;
  progress: LickPracticeProgress;       // Cumulative per-lick per-key data
  mode: 'standard' | 'single-lick';
  demoNextCycle: boolean;               // Deep practice: does the next cycle open with a demo?
  latestKeyResults: Partial<Record<PitchClass, LickPracticeKeyResult>>;
  sessionKeys: PitchClass[];
  ramp: FocusRamp | null;               // Deep practice: the focus ramp when launched from the report's weak-key step; null in every other session
}>( /* defaults */ );
```

**Continuous cycles (Deep Practice).** Single-lick sessions never stop between cycles — no rest bars, no per-round card. The last key's close event runs the cycle boundary synchronously: advance the round, re-sort the rotation **worst-first**, schedule the next cycle a bar out, and drop a 1-bar full-rhythm-section ii-V turnaround into the gap, targeting the key the next cycle opens on. It must be synchronous because the final score has to be in `rollingScore` before the sort, and the turnaround's target is only known after it.

Worst-first ordering comes from a per-key `rollingScore` — an EWMA (alpha 0.4) over **every** scored attempt, passes and failures alike, persisted in `LickPracticeKeyProgress`. An absent score counts as unknown and sorts worst, so an unfamiliar key still gets demoed. The demo itself is **skipped** once the head key's rolling score reaches 0.90: the point of a demo is the key you can't play yet. Tricks demo only when the round's example style is new to the session (`trickRoundIntroducesStyle`: enclosures once, triad pairs once per style — a regenerated realization of the same figure is not new to the ear), standard sessions always demo, and the first cycle of any session always demos as a reminder of the lick.

The same rolling score drives the in-session **sheet-music reveal** — for ONE key per lick: the key being learned. When the key stack is built (`getPlannedKeysForLick`, at lick or cycle start) every `PlannedKey` is stamped `reveal` and `passes`: the key is the **most recently unlocked** one (`newestUnlockedKey(entryKey, unlockedCount)` — the last entry of the pure `planUnlockedKeys` ramp, derivable from the per-lick unlock count with no timestamp; null at 12/12, so a fully unlocked lick never reveals) AND its rolling score is defined and below `KEY_FLOOR_THRESHOLD` (0.75) — `shouldRevealNotation` in `state/lick-practice-rotation.ts`, which unlike `shouldDemoHeadKey` treats an unknown score as *no* reveal, so the first attempt in any key is by ear. Earlier keys never reveal however they score: they were learned before the next one arrived. Decided once per stack (`revealDecisionsFor`, one unlock-count read per rotation) and never re-derived mid-cycle, because a revealed row is TALLER and a row's height must not change while the stack scrolls. The rule is the same in both directions: the row engraves after a sub-floor attempt and returns to chord blocks once the EWMA recovers, in every session type (Daily, Focused, Deep; the focus ramp reveals only when its focus key is the newest). A revealed key runs **`LEAD_SHEET_PASSES` (3) consecutive play windows** in continuous mode (`passes`; call-response keeps one — its windows already replay the app's half): `getKeyPasses(lickIdx)` is the single source `buildLickSuperPhrase` lays the backing out from and the session page schedules windows from (`planCycleWindows` with `passes` → per-window `opens`/`closes` plus `keyIndex`/`finalPass`), exactly as `getDemoBars` is for the demo block; the plan-time cost model charges the extra windows through `lickAudioBars.extraWindows`. Only the key's **final pass is the attempt of record** — `recordKeyAttempt`, the session-log upsert, `advance()` and (standard mode) the score hold run on it alone; a rehearsal pass is scored and flashed on the row and nothing else, and keeps no recording. The stack holds the revealed row still through all its passes: the route maps the transport's slot-unit scroll onto rows with `rowScrollFraction` (`ui/key-stack-layout.ts`) before `keyStackLayout` sees it, and `keyStackLayout` parks the row BEFORE the sheet at the top (read-ahead) so the sheet is wholly on screen, lit, for the whole preceding key and does not move at its own downbeat — in a Daily session the newest key is the LAST row, and without this the sheet arrived half-clipped and dimmed on the very tick the mic opened. `UpcomingKeysDisplay` renders a revealed row as a **lead-sheet row**: `leadSheetTuneFor` (`music/lead-sheet.ts`) wraps the row's phrase as a one-section `Tune` for `NotationDisplay tune=` (`frameless`, `staffWidth` 640 with the SVG sized by width so that number is the zoom, and `tuneOptions` — the phrase's mode, one stretched system, no bar number — through `tuneToAbc`, which engraves the chords), the current bar marked ON the staff via a `playhead` `rangeMarker` drawn from abcjs's own bar geometry (so the marker's bars align with the engraved bars by construction — the old equal-width beat strip could not), the PLAY tab counting the pass; no caption, by decision.

`latestKeyResults` and `sessionKeys` exist for the progress ring specifically. `keyResults` is cleared every cycle and the plan item's `keys` array shrinks and reorders as keys master out — a ring bound to either would lose dots and jump around. `sessionKeys` holds the stable circle-of-4ths key set; `latestKeyResults` holds the newest result per key for the whole session.

**Focus ramp.** The report's weak-key recommendation (`drill-weak-key` in `lick-practice-next-steps.ts`) launches Deep Practice with a `focusKey`, and the session runs a three-phase ramp instead of the clear-bump-refill rule — `lickPractice.ramp: FocusRamp`. *Focus*: the rotation is that key alone, opened `focusStartTempo` under the saved tempo (10%, the unlock dip), staircased at every cycle boundary (a one-key rotation, so a cycle is one attempt) — clear → `nextCycleTempo`, sub-floor → `focusStepDownTempo` (three times the bump), in between → hold — until a clear lands at or above the saved tempo. *Rebuild*: each full clear admits the next queued key (worst-first by rolling score), tempo held, until the queue drains. *Complete*: the ordinary rule resumes. `sessionKeys` stays the full circle so the ring shows the not-yet-admitted keys as empty dots; `LickHeader` shows the phase in place of "Key n/N". Same persistence contract as the rest of deep practice: the live ramp state, the session tempo and the rotation are never written and the lick's stored **tempo** is untouched — `recordKeyAttempt` still records each key's rolling score, pass count and `lastPracticedAt` on every attempt, exactly as in any session — and the report keeps its usual fields plus the derived `FocusRampSummary`, logged with the session like any other report field. The setup page and the lick detail page still start on the full worst-first rotation.

The pure policy — `sortKeysWorstFirst`, `shouldDemoHeadKey`, `newestUnlockedKey`, `shouldRevealNotation`, `resolveNextCycleStart`, `planCycleWindows`, and the focus ramp's `focusStartTempo`, `focusStepDownTempo`, `planFocusRamp`, `resolveRampCycle` — lives in `state/lick-practice-rotation.ts` so it can be tested without a transport.

A practice-tagged lick is only eligible for a session if it also carries an explicit `prog:<progressionType>` tag for that progression. Those tags are added automatically when the lick's category is set — for the templates the lick's own harmony FITS (`progressionFitsLick` in `data/progressions.ts`: a 1|1|1-bar ii-V-I gets the long template only, a ½|½|1 one the short; cadence licks never fit a vamp) — and the user can add/remove them by hand; the detail page greys pills the lick can't play over (a tagged-but-unfit pill stays removable), the picker and `getPracticeLicks` skip unfit tags at read time, and `pruneIncompatibleProgressionTags` drops misfits on every successful hydrate. The minor templates are ii-7b5 · V7b9 · i-7 (`MINOR_CADENCE`).

**Key functions:**
- `hydrateLickPracticeProgress(supabase?)` — Async: pulls cloud metadata when signed in, loads persisted progress, backfills legacy practice tags.
- `getPracticeLicks()` — All licks tagged `practice` that *also* carry the active progression's `prog:*` tag.
- `getDailyPracticeLicks()` — All practice-tagged licks with at least one `prog:*` tag, regardless of progression. Powers Daily Practice mode.
- `buildSessionPlan()` — Standard mode. Sorts licks by least-recently-practiced and packs the time budget. Each lick's planned key list is the first N keys of the alternating sharp/flat ramp where N is its current unlock count (capped at 12, then handed off to `planLickKeys` for staged variety). Called by `startSession()`.
- `buildDailyPracticePlan()` — Daily Practice mode. Pools every lick from `getDailyPracticeLicks()`, sorts least-recently-practiced first, picks each lick's least-recently-practiced compatible progression via `pickProgressionForLick`, and packs the duration budget. Each plan item carries its own `progressionType` instead of inheriting from config. When the session ends, the writer in `persistence/lick-practice-sessions.ts` calls `splitReportByProgression` to log one session entry per progression — the picker's least-recently-practiced lookup stays accurate even when a single Daily Practice run touched several progressions.
- `startSession()`, `startDailyPracticeSession()`, `startSingleLickSession(lickOrId: string | Phrase, options: SingleLickSessionOptions = {}): boolean` (options: `{ tempoBumpPercent?: number; focusKey?: PitchClass }`), `startTrickSession()` — The four entry points; all converge on the same playback engine. Single-lick (Deep Practice) cycles only the lick's currently-unlocked keys, runs a **session-local tempo ramp that is never persisted** (opens 2% under the stored tempo, climbs by `config.tempoBumpPercent` per cleared rotation — 1% by default, 0.5–5% from the setup knob; an omitted `tempoBumpPercent` keeps the knob rather than resetting it), with `focusKey` runs the focus ramp described above, and **derives its progression from the chosen lick's own `prog:*` tags** rather than `config.progressionType` — fixes the case where a major lick gets stuck over a minor vamp because the setup screen was set that way. `startTrickSession` rides the same round loop with a single `kind: 'trick'` plan item whose phrase is regenerated every round; see [Trick Scoring](./trick-scoring.md).
- `getCurrentPlanItem()`, `getCurrentKey()`, `getCurrentPhrase()`, `getCurrentHarmony()` — Cursor accessors for the active lick/key.
- `getPhraseFor(lickIdx, keyIdx)` — Pure variant used when scoring a key that has just finished.
- `getPlannedKey(offset)`, `getUpcomingKeys()`, `getPlannedKeysForLick(lickIdx)` — Lookahead accessors for the preview strip and scroll animation.
- `buildLickSuperPhrase(lickIdx)` — Concatenates the plan item's keys (plus an optional demo in continuous mode) into one phrase so the whole lick can be scheduled in a single Tone.js pass. `getDemoBars(lickIdx)` is the single source for the demo's length, used by both this layout and the route's window scheduling, so a skipped demo shortens the audio and the recording windows together.
- `recordKeyAttempt(score)` — Appends a `LickPracticeKeyResult`; persists key progress and increments `passCount` only on green attempts (≥ `KEY_PROFICIENT_THRESHOLD` = 0.90).
- `resetLick(phraseId)` — Wipes one lick's per-key scores, `passCount`, and unlock count (tempo → 60, one unlocked key) via `resetLickPersistence`, reassigning the reactive `progress` rune. Tags (`practice`, `prog:*`) are preserved. Local-only — no cloud sync. Surfaced from the post-session report (gated on try-again-band score) and the book detail page (gated on `hasLickProgress`).
- `advance()` — Moves to the next key within the current lick; returns `'end-of-lick'` when out.
- `startInterLickTransition()` — Archives results, applies the score-weighted tempo delta (and clamps the delta to ≤ 0 when any key in the session fell below `KEY_FLOOR_THRESHOLD`), decides whether to bump the unlock count via `shouldUnlockNextKey({ avgScore, newestKeyPassCount, unlockedCount, floorHit })`, and advances to the next lick or marks `'complete'`.
- `updateElapsedTime()`, `resetSession()`, `getSessionReport()`.

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
  phraseKey: 'C' as PitchClass,
  phraseName: '',
  category: 'user' as PhraseCategory,
  practiceTag: false,
  // Index into `enteredNotes` of the user-selected pitched note; `null` falls back
  // to the last pitched note for pitch-shift / delete / spell-flip operations
  selectedNoteIndex: null as number | null,
  // Edit-mode metadata (non-null when re-opening an existing user-entered lick)
  editingId: null as string | null,
  editingSource: null as string | null,
  editingTags: null as string[] | null,
  editingCategory: null as PhraseCategory | null
});
```

The user enters notes in their instrument's **written** pitch (what they see on their chart). Validation happens in written space (range `Bb3`–`F6`) and notes are converted to concert pitch at storage time using `instrument.transpositionSemitones`, keeping the canonical storage contract.

**Key functions:**
- `addNote(pitchClass, octave, accidental)` — Validates the duration fits, applies key-signature accidentals (when explicit accidental is `'natural'`), picks the nearest octave to the previous note, converts written → concert, appends.
- `addRest()`, `enterTiedNote()` (tie the last note into the current one).
- `selectNote(index)`, `selectPrev()`, `selectNext()` — Set/move the selected note (click a notehead or step with ←/→).
- `deleteSelectedNote()`, `adjustSelectedNotePitch(semitones)`, `flipSelectedNoteSpelling()` — Act on the selected note, falling back to the last pitched note when nothing is selected; delete shifts later offsets left and repairs straddling ties. `deleteLastNote` / `adjustLastNotePitch` / `flipLastNoteSpelling` remain as backward-compat aliases.
- `getCurrentPhrase()` — Builds a `Phrase` with `user-entered` source and optional `practice` tag for export.
- `getCurrentCursorOffset()`, `getRemainingCapacity()`, `canAddDuration(duration)`, `getCurrentBarAndBeat()` — Cursor helpers.
- `getPaddedNotes()` — Pads entered notes with a final rest so partial bars render cleanly in notation.
- `setBarCount(n)` (1–4, trims overflow; clears the selection if it now points past the end), `setDuration(id)`, `toggleTriplet()`, `toggleDotted()`, `setAccidental(acc)`, `adjustOctave(delta)`, `reset()`.
- `loadFromPhrase(lick, instrument)` — Edit mode entry point. Hydrates the state from an existing lick (converts concert pitches back to written using the given instrument's transposition, restores key/bar count/name/category) and stamps `editingId` / `editingSource` / `editingTags` / `editingCategory`. The `/licks/editor` route branches on `editingId !== null` to swap the Save → Update label, skip duplicate-detection self-match, route category changes through `updateLickCategory` (preserving `prog:*` seeding), and redirect to `/licks/<id>` on save. Mic-recorded licks are not editable — only `source === 'user-entered'`.

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

Selection merges last-writer-wins by `selectedUpdatedAt` rather than by union, because a union would resurrect variants the user un-starred on another device. `hydrateTrickStateFromCloud` therefore re-seeds the reactive set from the merged local store instead of adding to it, and deliberately does not re-save (which would stamp a fresh mtime and make this device "newest" without a real user edit).

### Tour State (`src/lib/state/tour.svelte.ts`)

Guided-tour progress: which tours the user has finished, dismissed, or is currently running. **Persisted** to localStorage under key `mankunku:tour-state` (completed + dismissed IDs), with optional cloud sync.

```typescript
export const tourState = $state({
  completedTours: new SvelteSet<string>(),  // finished naturally (clicked Done)
  dismissedTours: new SvelteSet<string>(),  // closed before finishing
  tourInProgress: null as string | null     // tour ID currently driving
});
```

`completedTours` / `dismissedTours` use `SvelteSet` (not a plain `Set`) so `.add()` / `.delete()` / `.clear()` trigger reactivity for `hasSeen`-driven UI. `saveTourState(supabase?)` persists the completed/dismissed snapshot and enqueues a cloud sync when a client is passed.

### Lick Suggestions State (`src/lib/state/lick-suggestions.svelte.ts`)

Descriptive fallback name plus server-returned attribution candidates for the `/entry` page. **Not persisted.**

```typescript
export const suggestions = $state<SuggestionsState>({
  fallbackName: '',                    // computed locally, always populated
  matches: [],                         // arrive asynchronously, may be empty
  loading: false,
  pickedFromSuggestion: null           // name the user picked; cleared on reset
});
```

The fallback name is computed locally from the entered phrase; the `matches` (quote / wjazzd attribution candidates) arrive asynchronously from the server and may be empty.

### Tune Entry State (`src/lib/state/tune-entry.svelte.ts`)

Long-form tune entry, built **on top of** the shared `stepEntry` buffer rather than beside it. The section list is authoritative; melody is edited one ≤4-bar *page* at a time through step-entry, so `PitchEntryPanel` / `DurationSelector` / keyboard entry all work unmodified. The buffer commits on page and section navigation, and is suspended (committed + emptied) on route exit so `/licks/editor` never sees tune content. **Not persisted.**

Exports the `tuneEntry` rune plus `initNewTune` / `resetTuneEntry`, `loadFromTune`, `buildDraftTune`, and `loadDraftForReview` (hydrating an unsaved import draft in create mode; the PDF flow uses `loadFromTune` with a pre-assigned id so the stored PDF stays linked).

Chords are typed as written-pitch text (`parseChordSymbol`) and stored concert with re-derived change-point durations. Manual entry is 4/4-only (`melodyEditingSupported`); imported charts in other meters keep their meter with melody editing gated off, since the 4/4 buffer would corrupt them.

### Tune Practice State (`src/lib/state/tune-practice.svelte.ts`)

Scored tune-practice session state. A thin runes wrapper over the pure logic in `tune-practice-plan.ts` — the same split as `lick-practice.svelte.ts` / `lick-practice-picker.ts`, with the route owning audio orchestration. **Not persisted**, deliberately: tune takes don't move the streak, the adaptive level, or per-lick key scores.

```typescript
export const tunePractice = $state<{
  config: TunePracticeConfig;   // mode, strictness, tempo, concertKey, backingStyle, playHead
  phase: TunePracticePhase;     // 'setup' | 'count-in' | 'head' | 'running' | 'complete'
  plan: InsertionPoint[];
  results: InsertionResult[];
  totalPoints: number; streak: number; bestStreak: number;
  freestyleMatches: FreestyleMatch[];
  /* … */
}>( /* defaults */ );
```

See [Tune System](./tune-system.md#session-planning) and [API Reference: State](../api-reference/state.md#tune-practicesveltets).

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

- All keys carry the outer `mankunku:` prefix. All user data is additionally namespaced under the active user via `namespace.ts` as `mankunku:u:<uid>:<key>` (with a separate anonymous bucket), so switching accounts needs no destructive wipe. A handful of GLOBAL control keys (`__active`, `__schema`, `__lastUserId`) keep the bare `mankunku:` prefix.
- `save<T>(key, value, syncCallback?)` — `JSON.stringify` + `setItem` into the ACTIVE user's namespace; invokes `syncCallback` after a successful local write
- `load<T>(key)` — `getItem` + `JSON.parse` from the active user's namespace, returns `null` on missing/invalid
- `remove(key)` — Remove a single key from the active user's namespace
- `saveGlobal<T>(key, value)` / `loadGlobal<T>(key)` — Read/write the bare-prefixed GLOBAL control keys (not for user data)
- `listKeys()` — Logical keys in the ACTIVE user's namespace only (prefix stripped; global keys excluded)
- `clearAll()` — Clears only the active user's namespace; does NOT touch other users' buckets or the global control keys

Error handling: `save` warns on failure (e.g., quota exceeded), `load` returns `null` on parse errors.

## Pattern: Reactive State + Manual Save

Unlike auto-saving stores, Mankunku uses **explicit save calls**. This avoids excessive writes during rapid state changes (e.g., real-time pitch detection updating `session.currentPitchMidi` at 60fps).

- **Session**: Never persisted (ephemeral per-visit data)
- **Settings**: Saved on each user action (e.g., changing instrument, toggling metronome)
- **Progress**: Saved after each completed attempt via `recordAttempt()`
- **History**: Saved by `recomputeAllDailySummaries` after every write to `progress.sessions` or `lick-practice-sessions` (derive-on-write), plus on cloud-hydration rebuild
- **Licks**: Never persisted (filter state resets on navigation)
- **Lick Practice**: Live session state is ephemeral; per-lick/per-key progress is persisted by `persistence/lick-practice-store.ts` after **every** scored key (the rolling score needs failures too), plus each tempo adjustment and session end
- **Tricks**: Selection saved on every toggle via `persistence/trick-practice-store.ts`, which enqueues an outbox push; per-variant progress written on each pass
- **Step Entry**: Never persisted — drafts are exported to `persistence/user-licks.ts` when the user saves
- **Community**: Never persisted (browse filter/sort state resets on navigation)
- **Tour**: Saved via `saveTourState()` whenever a tour is completed or dismissed; cloud-synced when signed in
- **Lick Suggestions**: Never persisted (per-draft suggestion state, cleared on reset)

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

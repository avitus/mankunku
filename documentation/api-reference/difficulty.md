# API Reference: Difficulty

Adaptive difficulty algorithm and difficulty level profiles.

**Source:** `src/lib/difficulty/`

---

## adaptive.ts

Adaptive difficulty algorithm that adjusts musical complexity based on performance.

### Constants

| Constant | Value | Description |
|---|---|---|
| `WINDOW_SIZE` | 25 | Number of recent scores per dimension |
| `ADVANCE_THRESHOLD` | 0.85 | Average score to advance |
| `RETREAT_THRESHOLD` | 0.50 | Average score to retreat |
| `MIN_ATTEMPTS_BETWEEN_CHANGES` | 10 | Cooldown between difficulty adjustments (per dimension) |
| `MAX_LEVEL` | 100 | Maximum player level |

### `createInitialAdaptiveState(): AdaptiveState`

Returns a fresh state with all values at their defaults (level 1, no scores).

```typescript
interface AdaptiveState {
  currentLevel: number;                // Average of pitch + rhythm complexity (1-100)
  pitchComplexity: number;             // Pitch difficulty (1-100)
  rhythmComplexity: number;            // Rhythm difficulty (1-100)
  recentScores: number[];              // Circular buffer of last 25 overall scores
  recentPitchScores: number[];         // Circular buffer of last 25 pitch accuracy scores
  recentRhythmScores: number[];        // Circular buffer of last 25 rhythm accuracy scores
  attemptsAtLevel: number;             // Total attempts at current level
  attemptsSinceChange: number;         // Min of pitch/rhythm cooldowns
  pitchAttemptsSinceChange: number;    // Attempts since last pitch complexity change
  rhythmAttemptsSinceChange: number;   // Attempts since last rhythm complexity change
}
```

### `processAttempt(state, overall, pitchAccuracy, rhythmAccuracy): AdaptiveState`

Process a new attempt and return updated state.

Pitch and rhythm are adjusted **independently** — each dimension has its own score window and cooldown (minimum 10 attempts between changes per dimension):

1. **Pitch**: If pitch accuracy window average ≥ 85% → `pitchComplexity++`; if < 50% → `pitchComplexity--`
2. **Rhythm**: If rhythm accuracy window average ≥ 85% → `rhythmComplexity++`; if < 50% → `rhythmComplexity--`
3. **Hold** (50–85%): No change for that dimension
4. `currentLevel = Math.round((pitchComplexity + rhythmComplexity) / 2)`

### `getAdaptiveSummary(state): string`

Human-readable summary using the current difficulty band name. E.g. `"Beginner 3 (Pitch: 3, Rhythm: 2) — Avg: 78%"`.

### Per-scale / per-key proficiency

Shared single-dimension advancement is also exposed for scale- and key-specific proficiency tracking (see `src/lib/types/progress.ts`).

| Function | Signature | Description |
|---|---|---|
| `createInitialScaleProficiency` | `() → ScaleProficiency` | Fresh scale proficiency state (level 1, empty window) |
| `createInitialKeyProficiency` | `() → KeyProficiency` | Fresh key proficiency state (level 1, empty window) |
| `processScaleAttempt` | `(state, overall) → ScaleProficiency` | Same window + cooldown algorithm as `processAttempt`, single dimension |
| `processKeyAttempt` | `(state, overall) → KeyProficiency` | Same as `processScaleAttempt`, for per-key tracking |

---

## params.ts

Difficulty level profiles defining what musical elements are available at each level.

### `DifficultyProfile` interface

```typescript
interface DifficultyProfile {
  level: number;
  name: string;
  scaleTypes: ScaleFamily[];
  maxInterval: number;
  rhythmTypes: ('whole' | 'half' | 'quarter' | 'eighth' | 'triplet' | 'sixteenth')[];
  swing: boolean;
  syncopation: boolean;
  barsRange: [number, number];
  tempoRange: [number, number];
  keys: PitchClass[];
}
```

### `DIFFICULTY_PROFILES: DifficultyProfile[]`

10 profiles (levels 1–10).

| Level | Name | Scale Families | Rhythm | Tempo | Keys |
|---|---|---|---|---|---|
| 1 | Roots & 5ths | major | quarter | 60–80 | C, F, G |
| 2 | Full Pentatonic | major, pentatonic | quarter | 60–90 | C, D, F, G, Bb |
| 3 | Swing 8ths | major, pentatonic | quarter, eighth | 70–100 | 7 keys |
| 4 | Diatonic Lines | +blues | quarter, eighth | 80–120 | all 12 |
| 5 | Approach Notes | +bebop | +triplet | 90–140 | all 12 |
| 6 | Enclosures | +melodic-minor | +triplet | 100–160 | all 12 |
| 7 | Bebop Lines | +harmonic-minor | +sixteenth | 120–180 | all 12 |
| 8 | Altered Harmony | +symmetric | +sixteenth | 140–200 | all 12 |
| 9 | Complex Rhythm | same as 8 | same as 8 | 160–240 | all 12 |
| 10 | No Limits | same as 8 | all | 180–300 | all 12 |

### `levelToContentTier(playerLevel): number`

Maps player levels 1-100 to content tiers 1-10. E.g., levels 1-5 → tier 1, levels 91-100 → tier 10.

### `getProfile(level): DifficultyProfile`

Returns the profile for a level. Accepts both content tiers (1-10) and player levels (1-100, auto-mapped via `levelToContentTier`). Throws if the level is invalid.

---

## calculate.ts

Static difficulty calculator for a finished lick. Used when persisting curated and user-entered licks, and by the combinatorial lick generator.

### `calculateDifficulty(phrase): DifficultyMetadata`

Compute a `{ level, pitchComplexity, rhythmComplexity, lengthBars }` summary (all values clamped to 1–100 except `lengthBars`). Scores four dimensions and combines them:

**Pitch complexity (raw 0–~65):**
- **Note count** (≤ 25 pts) — 2 notes ≈ trivial, ≥ 14 demanding
- **Intervals** (≤ 30 pts) — average + max interval + share of leaps > P5
- **Chromaticism** (≤ 25 pts) — share of non-diatonic pitch classes + length of chromatic runs
- **Range** (≤ 10 pts) — pitch spread in semitones

**Rhythm complexity (raw 0–~65):**
- **Density** (≤ 25 pts) — notes per bar
- **Fastest subdivision** (≤ 30 pts) — sixteenths 30 / triplet-8ths 21 / 8ths 10 / 4ths 3
- **Off-beat notes** (≤ 25 pts) — fraction of notes not on a quarter-note grid
- **Variety** (≤ 15 pts) — distinct duration values
- **Rests** (≤ 5 pts)

Raw sub-scores are multiplied by a **1.5× scaling factor** to stretch into the usable 1–70 range so the adaptive system has room to progress. Overall level is weighted 55% pitch / 45% rhythm.

---

## lick-phase.ts

Phases of expertise for a **single lick** — the four-step ladder shown on the
lick detail page's progress chart. Everything here is a pure derivation over a
lick's `LickProgressPoint[]` series; nothing in this module gates practice,
unlocks a key, or moves tempo (those rules live in
`state/lick-practice.svelte.ts`).

### `LickPhase` and its thresholds

```typescript
type LickPhase = 'new' | 'learning' | 'proficient' | 'expert';

export const ALL_KEYS = 12;
export const PROFICIENT_BPM = 120;
export const EXPERT_BPM = 150;
```

| Phase | Condition |
|---|---|
| `new` | fewer than `ALL_KEYS` keys unlocked — **however fast** the lick is played |
| `learning` | all 12 keys, below `PROFICIENT_BPM` |
| `proficient` | all 12 keys, `PROFICIENT_BPM` up to `EXPERT_BPM` |
| `expert` | all 12 keys, at or above `EXPERT_BPM` |

Reaching a threshold promotes (`>=`, not `>`), so a 5-BPM bump landing exactly
on 120 is the promotion it feels like. The first phase is decided by
*coverage*, the rest by *tempo* — a lick played fast in three keys is still
new.

| Function | Signature | Description |
|---|---|---|
| `lickPhase` | `(bpm, keys) → LickPhase` | The rule table above |
| `currentLickPhase` | `(points) → LickPhase \| null` | Phase implied by the newest sample; `null` for an empty series |
| `phaseDisplay` | `(phase) → LickPhaseDisplay` | `{ phase, label, color }`; colour is a `var(--mastery-N)` band, **not** the difficulty ramp — a phase is accomplishment earned, not material hardness |
| `allKeysUnlockedAt` | `(points) → number \| null` | Timestamp the series first reached 12 keys |
| `unlockEvents` | `(points) → UnlockEvent[]` | Every `from → to` key-count jump in the series |
| `collapseUnlockMarkers` | `(...) → UnlockMarker[]` | Merges unlock events that would overplot into one marker |
| `unlockMarkerLabel` | `(marker) → string` | Tooltip text — one key by ordinal, several as a range |
| `bpmAxisRange` | `(values) → { lo, hi }` | Y-range for the BPM panel, widened so a nearby threshold stays on screen |
| `bpmBandSlices` | `(lo, hi) → BpmBandSlice[]` | The visible slice of each tempo band, for the shaded backdrop |

---

## level-signal.ts

Tiny presentation helper for level-change feedback.

### `levelSignalDirection(prevPrimary, nextPrimary, prevScale, nextScale): LevelSignalDirection | null`

`'up'` if either the primary level or the scale level rose, `'down'` if either
fell (up wins ties), else `null`. Lets the UI animate a level move without
re-deriving it from adaptive state.

---

## display.ts

Difficulty display utilities — maps 1-100 values to 10 color-coded bands (1–10, 11–20, …, 91–100).

### `DifficultyDisplay` interface

```typescript
interface DifficultyDisplay {
  band: number;   // 1–10
  label: string;  // e.g. "21-30"
  color: string;  // CSS var(--difficulty-N), green → red ramp
  name: string;   // Band name
}
```

### `difficultyBand(difficulty): number`

Returns the **1–10 band index** for a difficulty value (1–100). Clamped to the valid range.

### `difficultyColor(difficulty): string`

Returns the display color as a `var(--difficulty-N)` CSS custom property (N = 1–10 band), safe to drop into an inline `style` attribute. The actual hex ramp — muted green (easy) through amber to muted brick-red (hard) — is defined by theme-aware `--difficulty-N` properties in `app.css` and resolved at render time; the function never returns a literal hex string.

### `difficultyDisplay(difficulty): DifficultyDisplay`

Returns `{ band, label, color, name }` for a difficulty value.

### `masteryDisplay(value): DifficultyDisplay`

Returns `{ band, label, color, name }` for a proficiency / mastery value (0-100), using the `var(--mastery-N)` teal→brass ramp (high reads as *accomplishment*) instead of the green→red `var(--difficulty-N)` ramp. Used on the home and progress pages for mastery / proficiency displays.

| Band | Range | Name |
|---|---|---|
| 1 | 1–10 | Beginner |
| 2 | 11–20 | Elementary |
| 3 | 21–30 | Easy |
| 4 | 31–40 | Moderate |
| 5 | 41–50 | Intermediate |
| 6 | 51–60 | Challenging |
| 7 | 61–70 | Advanced |
| 8 | 71–80 | Expert |
| 9 | 81–90 | Master |
| 10 | 91–100 | Virtuoso |

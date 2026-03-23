# API Reference: Difficulty

Adaptive difficulty algorithm and difficulty level profiles.

**Source:** `src/lib/difficulty/`

---

## adaptive.ts

Adaptive difficulty algorithm that adjusts musical complexity based on performance.

### Constants

| Constant | Value | Description |
|---|---|---|
| `WINDOW_SIZE` | 10 | Number of recent scores to consider |
| `ADVANCE_THRESHOLD` | 0.85 | Average score to advance |
| `RETREAT_THRESHOLD` | 0.50 | Average score to retreat |
| `MIN_ATTEMPTS_BETWEEN_CHANGES` | 5 | Cooldown between difficulty adjustments |
| `MAX_LEVEL` | 100 | Maximum player level |

### `createInitialAdaptiveState(): AdaptiveState`

Returns a fresh state with all values at their defaults (level 1, no scores, 0 XP).

```typescript
interface AdaptiveState {
  currentLevel: number;        // Content difficulty tier (1-10)
  pitchComplexity: number;     // Pitch difficulty, adjusted independently (1-10)
  rhythmComplexity: number;    // Rhythm difficulty, adjusted independently (1-10)
  recentScores: number[];      // Circular buffer of last 10 overall scores
  attemptsAtLevel: number;     // Total attempts at current level
  attemptsSinceChange: number; // Attempts since last difficulty change
  xp: number;                  // Total experience points (drives 1-100 display level)
}
```

### `processAttempt(state, overall, pitchAccuracy, rhythmAccuracy, grade): AdaptiveState`

Process a new attempt and return updated state.

**Adjustment logic** (requires >= 5 attempts since last change and >= 5 scores in window):

1. **Advance** (average >= 85%): Increase the *weaker* parameter first
   - `pitchComplexity <= rhythmComplexity` → increase pitch
   - Otherwise → increase rhythm
2. **Retreat** (average < 50%): Decrease the parameter with lower accuracy
   - `pitchAccuracy <= rhythmAccuracy` → decrease pitch
   - Otherwise → decrease rhythm
3. **Hold** (50–85%): No change
4. `currentLevel = max(pitchComplexity, rhythmComplexity)`

### XP functions

| Function | Signature | Description |
|---|---|---|
| `xpForLevel` | `(level) → number` | XP needed for a single level: `50 + 0.5 * level²` |
| `totalXpForLevel` | `(level) → number` | Cumulative XP needed to reach a given level |
| `xpToDisplayLevel` | `(xp) → number` | Player level 1-100 from total XP |
| `xpProgress` | `(xp) → number` | Progress within current level (0–1, returns 1 at max) |

**XP per grade:**

| Grade | XP |
|---|---|
| `perfect` | 100 |
| `great` | 75 |
| `good` | 50 |
| `fair` | 25 |
| `try-again` | 10 |

### `getAdaptiveSummary(state): string`

Human-readable summary. E.g. `"Level 3 (Pitch: 3, Rhythm: 2) — Avg: 78%"`.

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
| 9 | Complex Rhythm | same as 8 | all | 160–240 | all 12 |
| 10 | No Limits | same as 8 | all | 180–300 | all 12 |

### `levelToContentTier(playerLevel): number`

Maps player levels 1-100 to content tiers 1-10. E.g., levels 1-5 → tier 1, levels 91-100 → tier 10.

### `getProfile(level): DifficultyProfile`

Returns the profile for a level. Accepts both content tiers (1-10) and player levels (1-100, auto-mapped via `levelToContentTier`). Throws if the level is invalid.

---

## display.ts

Difficulty display utilities — maps 1-100 values to 10 color-coded bands.

### `difficultyBand(level): string`

Returns the band name for a difficulty level.

| Range | Name |
|---|---|
| 1–10 | Beginner |
| 11–20 | Elementary |
| 21–30 | Intermediate |
| 31–40 | Upper Intermediate |
| 41–50 | Advanced |
| 51–60 | Upper Advanced |
| 61–70 | Pre-Professional |
| 71–80 | Professional |
| 81–90 | Expert |
| 91–100 | Virtuoso |

### `difficultyColor(level): string`

Returns a CSS color string for the difficulty level. Colors range from green (Beginner) through teal, blue, indigo, purple, magenta, orange to deep red (Virtuoso).

### `difficultyDisplay(level): { band: string, color: string }`

Convenience function returning both band name and color.

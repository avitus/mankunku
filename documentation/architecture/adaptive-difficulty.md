# Adaptive Difficulty

The adaptive difficulty system automatically adjusts musical complexity based on the player's recent performance.

**Source files:** `src/lib/difficulty/adaptive.ts`, `src/lib/difficulty/params.ts`

## Algorithm (`adaptive.ts`)

### Core Parameters

| Parameter | Value |
|---|---|
| Window size | 25 attempts (per dimension) |
| Advance threshold | >= 85% average |
| Retreat threshold | < 50% average |
| Min attempts between changes | 10 (per dimension) |
| Max level | 100 |

### State

The `AdaptiveState` tracks:
- `currentLevel` — Rounded average of pitchComplexity and rhythmComplexity (1-100)
- `pitchComplexity` — Pitch difficulty (1-100), adjusted independently
- `rhythmComplexity` — Rhythm difficulty (1-100), adjusted independently
- `recentScores` — Circular buffer of last 25 overall scores (for display)
- `recentPitchScores` — Circular buffer of last 25 pitch accuracy scores
- `recentRhythmScores` — Circular buffer of last 25 rhythm accuracy scores
- `attemptsAtLevel` — Total attempts at current rounded level
- `attemptsSinceChange` — Min of pitch/rhythm cooldowns
- `pitchAttemptsSinceChange` — Attempts since last pitch complexity change
- `rhythmAttemptsSinceChange` — Attempts since last rhythm complexity change

### Adjustment Logic

Pitch and rhythm are adjusted **independently** — each dimension has its own score window and cooldown counter. On each attempt, for each dimension (after at least 10 attempts since that dimension's last change):

1. **Pitch**: If pitch accuracy window average ≥ 85% → `pitchComplexity++`; if < 50% → `pitchComplexity--`
2. **Rhythm**: If rhythm accuracy window average ≥ 85% → `rhythmComplexity++`; if < 50% → `rhythmComplexity--`
3. **Hold** (50-85%): No change for that dimension
4. `currentLevel = Math.round((pitchComplexity + rhythmComplexity) / 2)`

Note: `currentLevel` maps to content tiers via `levelToContentTier()` (levels 1-5 = tier 1, levels 91-100 = tier 10).

## Difficulty Profiles (`params.ts`)

Each level defines what musical elements are available:

### Level 1: Roots & 5ths
- Scales: major modes only
- Max interval: 4 semitones
- Rhythm: quarter notes only
- No swing, no syncopation
- 1 bar, tempo 60-80 BPM
- Keys: C, F, G

### Level 2: Full Pentatonic
- Scales: major + pentatonic
- Max interval: 5 semitones
- Rhythm: quarter notes
- 1 bar, tempo 60-90 BPM
- Keys: C, D, F, G, Bb

### Level 3: Swing 8ths
- Scales: major + pentatonic
- Max interval: 7 semitones
- Rhythm: quarter + eighth notes
- Swing enabled
- 1-2 bars, tempo 70-100 BPM
- Keys: C, D, Eb, F, G, A, Bb

### Level 4: Diatonic Lines
- Scales: major + pentatonic + blues
- Rhythm: quarter + eighth notes
- Swing + syncopation
- 1-2 bars, tempo 80-120 BPM
- All 12 keys

### Level 5: Approach Notes
- Scales: + bebop scales
- Max interval: 8 semitones
- Rhythm: + triplets
- 2 bars, tempo 90-140 BPM

### Level 6: Enclosures
- Scales: + melodic minor modes
- Max interval: 12 semitones
- 2 bars, tempo 100-160 BPM

### Level 7: Bebop Lines
- Scales: + harmonic minor modes
- Max interval: 14 semitones
- Rhythm: + sixteenths
- 2-4 bars, tempo 120-180 BPM

### Level 8: Altered Harmony
- Scales: + symmetric scales
- Max interval: 16 semitones
- Rhythm: Q, 8th, Triplet, 16th
- 2-4 bars, tempo 140-200 BPM

### Level 9: Complex Rhythm
- Same scales as Level 8
- Max interval: 19 semitones
- Rhythm: Q, 8th, Triplet, 16th
- 2-4 bars, tempo 160-240 BPM

### Level 10: No Limits
- Same scales as Level 8
- Max interval: 24 semitones
- Rhythm: All (whole through 16th)
- 4 bars, tempo 180-300 BPM

### Player Levels vs Content Tiers

The system has two separate level concepts:

- **Player Level (1-100)**: Cosmetic, derived from average per-scale proficiency. Displayed in the UI as "Lvl 42". Drives tonality unlocking.
- **Content Tier (1-10)**: Functional, based on performance. Determines which musical elements (scales, rhythms, tempos) appear in generated phrases. Player levels map to content tiers via `levelToContentTier()` (e.g., player level 35 → content tier 4).

## How Profiles Affect Generation

When the phrase generator runs at a given difficulty level:
1. `getProfile(level)` returns the `DifficultyProfile`
2. Available scale families, max interval, and rhythm types constrain what notes and rhythms can appear
3. `rulesForDifficulty(level)` from the validator sets contour constraints
4. The profile's tempo range and key set guide the session settings page

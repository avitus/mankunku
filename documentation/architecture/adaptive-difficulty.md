# Adaptive Difficulty

The adaptive difficulty system automatically adjusts musical complexity based on the player's recent performance.

**Source files:** `src/lib/difficulty/adaptive.ts`, `src/lib/difficulty/params.ts`

## Algorithm (`adaptive.ts`)

### Core Parameters

| Parameter | Value |
|---|---|
| Window size | 10 attempts |
| Advance threshold | >= 85% average |
| Retreat threshold | < 50% average |
| Min attempts between changes | 5 |
| Max level | 100 |

### State

The `AdaptiveState` tracks:
- `currentLevel` — Content difficulty tier (1-10, maps to difficulty profiles)
- `pitchComplexity` — Pitch difficulty, adjusted independently (1-10)
- `rhythmComplexity` — Rhythm difficulty, adjusted independently (1-10)
- `recentScores` — Circular buffer of last 10 overall scores
- `attemptsAtLevel` — Total attempts at current level
- `attemptsSinceChange` — Attempts since last difficulty change
- `xp` — Total experience points (drives the 1-100 display level)

### Adjustment Logic

On each attempt, after at least 5 attempts since the last change:

1. **Compute window average** from the last 10 scores
2. **Advance** (average >= 85%): Increase the *weaker* parameter first
   - If `pitchComplexity <= rhythmComplexity` → increase pitch
   - Otherwise → increase rhythm
   - `currentLevel = max(pitchComplexity, rhythmComplexity)`
3. **Retreat** (average < 50%): Decrease the parameter causing more errors
   - If latest `pitchAccuracy <= rhythmAccuracy` → decrease pitch
   - Otherwise → decrease rhythm
   - `currentLevel = max(pitchComplexity, rhythmComplexity)`
4. **Hold** (50-85%): No change, keep practicing

### XP System

XP is awarded per attempt based on grade:

| Grade | XP |
|---|---|
| Perfect | 100 |
| Great | 75 |
| Good | 50 |
| Fair | 25 |
| Try Again | 10 |

Display level is computed from total XP using a quadratic curve:
- Level N requires `50 + 0.5 * N²` XP (early levels need ~50 XP, level 100 needs ~5050 XP)
- `xpToDisplayLevel(xp)` — Player level 1-100 from total XP
- `xpProgress(xp)` — Progress within current level (0-1)
- `totalXpForLevel(level)` — Cumulative XP needed to reach a given level

Note: Display level (1-100, cosmetic, based on total XP) is separate from content difficulty tier (1-10, functional, based on performance). The `levelToContentTier()` function maps player levels 1-100 to the 10 content tiers (levels 1-5 = tier 1, levels 91-100 = tier 10).

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

### Levels 8-10
Include symmetric scales, wider intervals, and faster tempos up to 300 BPM.

### Player Levels vs Content Tiers

The system has two separate level concepts:

- **Player Level (1-100)**: Cosmetic, earned via XP. Displayed in the UI as "Lvl 42". Drives tonality unlocking.
- **Content Tier (1-10)**: Functional, based on performance. Determines which musical elements (scales, rhythms, tempos) appear in generated phrases. Player levels map to content tiers via `levelToContentTier()` (e.g., player level 35 → content tier 4).

## How Profiles Affect Generation

When the phrase generator runs at a given difficulty level:
1. `getProfile(level)` returns the `DifficultyProfile`
2. Available scale families, max interval, and rhythm types constrain what notes and rhythms can appear
3. `rulesForDifficulty(level)` from the validator sets contour constraints
4. The profile's tempo range and key set guide the session settings page

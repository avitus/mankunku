# Phrase System

The phrase system provides two sources of musical content: a curated library of 62 hand-written licks and an algorithmic generator for infinite variety.

**Source files:** `src/lib/phrases/`, `src/lib/data/licks/`

## Curated Library

### Storage Format

All curated licks are stored in **concert C** as TypeScript arrays in `src/lib/data/licks/`:

| File | Category | Count |
|---|---|---|
| `ii-V-I-major.ts` | ii-V-I Major | 20 |
| `blues.ts` | Blues | 15 |
| `bebop-lines.ts` | Bebop Lines | 15 |
| `ii-V-I-minor.ts` | ii-V-I Minor | 12 |
| **Total** | | **62** |

`index.ts` re-exports all arrays as `ALL_CURATED_LICKS`.

### Library Loader (`library-loader.ts`)

Indexes licks on module load with `Map` data structures for fast querying:

- **`getAllLicks()`** — Returns all 62 licks
- **`getLickById(id)`** — O(1) lookup
- **`getLicksByCategory(category)`** — Pre-built category index
- **`getCategories()`** — Category counts, sorted by count descending
- **`queryLicks(query)`** — Filter by category, difficulty range, tags, text search
- **`transposeLick(lick, targetKey)`** — Shifts all MIDI pitches and harmony roots by the interval from C to the target key
- **`pickRandomLick(query, key)`** — Random selection with optional transposition

### Transposition

Since all licks are stored in C, transposition is a simple semitone shift:

```typescript
semitones = PITCH_CLASSES.indexOf(targetKey)
note.pitch = note.pitch + semitones
chord.root = PITCH_CLASSES[(indexOf(chord.root) + semitones) % 12]
```

## Algorithmic Generator (`generator.ts`)

A 5-stage pipeline that creates new phrases matching specified parameters.

### Stage 1: Target Note Selection

Places chord tones on strong beats (every 2 beats). For each beat position:
1. Find the active `HarmonicSegment`
2. Get chord tones for that segment's chord
3. Voice-lead: pick the chord tone closest to the previous target (checking multiple octaves)
4. Constrain to instrument range (MIDI 44–76 for tenor sax)

### Stage 2: Approach Patterns

Fills gaps between target notes using one of three strategies (selected by difficulty + randomness):

- **Scale run** (easy/common): Diatonic notes between the two targets
- **Chromatic approach** (medium): 1-2 chromatic notes approaching the target
- **Arpeggio fill** (harder): Chord tones between the two targets

### Stage 3: Rhythm Cell Selection

Assigns durations based on the difficulty profile's allowed rhythm types:

| Rhythm Type | Duration (Fraction) | Available From |
|---|---|---|
| quarter | `[1, 4]` | Level 1 |
| eighth | `[1, 8]` | Level 3 |
| triplet | `[1, 12]` | Level 5 |
| sixteenth | `[1, 16]` | Level 7 |

The last note gets a longer duration. Target notes (from Stage 1) get higher velocity (100 vs 80).

### Stage 4: (Reserved)

Stage 4 is skipped in the current implementation. Future use for contour refinement.

### Stage 5: Articulation

At difficulty >= 4, adds articulation markings:
- **Accent** (30% chance) on target notes with velocity >= 100
- **Ghost note** (20% chance) on weak-beat passing tones
- **Legato** (30% chance) on consecutive stepwise motion (interval <= 2 semitones)

### Validation and Retry

After generation, the phrase is validated against contour rules (see Validator below). If validation fails, the pipeline retries up to 5 times. If all attempts fail, a simple scale fragment is generated as a fallback.

### Default Harmony Templates

`getDefaultHarmony(category, key)` provides standard harmonic progressions:

| Category | Progression |
|---|---|
| ii-V-I Major | Dm7 → G7 → Cmaj7 (in C) |
| ii-V-I Minor | Dm7b5 → G7alt → Cm7 (in C) |
| Blues | C7 (static) |
| Bebop Lines | Cmaj7 (static) |

## Mutator (`mutator.ts`)

Transforms existing licks to create variations:

| Mutation | Description |
|---|---|
| **Rhythmic displacement** | Shifts all note onsets forward by an 8th note, creating syncopation |
| **Octave displacement** | Randomly shifts ~25% of notes up/down an octave (skipping first and last) |
| **Truncation** | Keeps the first ~60% of notes for a shorter practice fragment |
| **Retrograde** | Reverses the pitch sequence while keeping rhythm intact |

Each mutation is validated before being returned. Invalid mutations return `null`.

## Validator (`validator.ts`)

Enforces musical constraints to keep generated/mutated phrases sounding idiomatic:

### Rules

| Rule | Default | Description |
|---|---|---|
| `maxInterval` | 14 | Maximum semitone leap between consecutive notes |
| `maxConsecutiveLeaps` | 3 | Max consecutive intervals > 2 semitones |
| `minStepRatio` | 0.3 | Minimum ratio of steps (<=2 semitones) to total intervals |
| `range` | [44, 84] | MIDI range bounds |
| `leapRecovery` | true | After a large leap, require stepwise motion in the opposite direction |
| `leapRecoveryThreshold` | 7 | Semitones above which leap recovery is enforced |
| `minDirectionChanges` | 1 | Minimum number of melodic direction changes |

### Difficulty-Scaled Rules

`rulesForDifficulty(level)` returns relaxed or tightened rules:

| Level | maxInterval | maxConsecutiveLeaps | minStepRatio |
|---|---|---|---|
| 1-2 | 5 | 1 | 0.5 |
| 3-4 | 7 | 2 | 0.4 |
| 5-6 | 12 | 3 | 0.3 |
| 7+ | 14 | 3 | 0.25 |

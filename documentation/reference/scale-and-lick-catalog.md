# Scale & Lick Catalog

Complete reference of all scales and curated licks in Mankunku.

## Scale Catalog (35 scales)

**Source:** `src/lib/music/scales.ts`

### Major Modes (7)

| ID | Name | Intervals | Degrees | Chord Applications |
|---|---|---|---|---|
| `major.ionian` | Ionian (Major) | 2-2-1-2-2-2-1 | 1 2 3 4 5 6 7 | maj7, maj6 |
| `major.dorian` | Dorian | 2-1-2-2-2-1-2 | 1 2 b3 4 5 6 b7 | min7, min6 |
| `major.phrygian` | Phrygian | 1-2-2-2-1-2-2 | 1 b2 b3 4 5 b6 b7 | min7 |
| `major.lydian` | Lydian | 2-2-2-1-2-2-1 | 1 2 3 #4 5 6 7 | maj7 |
| `major.mixolydian` | Mixolydian | 2-2-1-2-2-1-2 | 1 2 3 4 5 6 b7 | 7, sus4 |
| `major.aeolian` | Aeolian (Natural Minor) | 2-1-2-2-1-2-2 | 1 2 b3 4 5 b6 b7 | min7 |
| `major.locrian` | Locrian | 1-2-2-1-2-2-2 | 1 b2 b3 4 b5 b6 b7 | min7b5 |

### Melodic Minor Modes (7)

| ID | Name | Intervals | Degrees | Chord Applications |
|---|---|---|---|---|
| `melodic-minor.melodic-minor` | Melodic Minor | 2-1-2-2-2-2-1 | 1 2 b3 4 5 6 7 | minMaj7 |
| `melodic-minor.dorian-b2` | Dorian b2 | 1-2-2-2-2-1-2 | 1 b2 b3 4 5 6 b7 | sus4, min7 |
| `melodic-minor.lydian-augmented` | Lydian Augmented | 2-2-2-2-1-2-1 | 1 2 3 #4 #5 6 7 | maj7, aug |
| `melodic-minor.lydian-dominant` | Lydian Dominant | 2-2-2-1-2-1-2 | 1 2 3 #4 5 6 b7 | 7, 7#11 |
| `melodic-minor.mixolydian-b6` | Mixolydian b6 | 2-2-1-2-1-2-2 | 1 2 3 4 5 b6 b7 | 7, 7b13 |
| `melodic-minor.locrian-nat2` | Locrian Natural 2 | 2-1-2-1-2-2-2 | 1 2 b3 4 b5 b6 b7 | min7b5 |
| `melodic-minor.altered` | Altered (Super Locrian) | 1-2-1-2-2-2-2 | 1 b2 b3 b4 b5 b6 b7 | 7alt, 7#9, 7b9 |

### Harmonic Minor Modes (7)

| ID | Name | Intervals | Degrees | Chord Applications |
|---|---|---|---|---|
| `harmonic-minor.harmonic-minor` | Harmonic Minor | 2-1-2-2-1-3-1 | 1 2 b3 4 5 b6 7 | minMaj7 |
| `harmonic-minor.locrian-sharp6` | Locrian #6 | 1-2-2-1-3-1-2 | 1 b2 b3 4 b5 6 b7 | min7b5 |
| `harmonic-minor.ionian-augmented` | Ionian Augmented | 2-2-1-3-1-2-1 | 1 2 3 4 #5 6 7 | maj7, aug |
| `harmonic-minor.dorian-sharp4` | Dorian #4 | 2-1-3-1-2-1-2 | 1 2 b3 #4 5 6 b7 | min7 |
| `harmonic-minor.phrygian-dominant` | Phrygian Dominant | 1-3-1-2-1-2-2 | 1 b2 3 4 5 b6 b7 | 7, 7b9 |
| `harmonic-minor.lydian-sharp2` | Lydian #2 | 3-1-2-1-2-2-1 | 1 #2 3 #4 5 6 7 | maj7 |
| `harmonic-minor.super-locrian-bb7` | Super Locrian bb7 | 1-2-1-2-2-1-3 | 1 b2 b3 b4 b5 b6 bb7 | dim7 |

### Symmetric (4)

| ID | Name | Intervals | Degrees | Chord Applications |
|---|---|---|---|---|
| `symmetric.whole-half-dim` | Whole-Half Diminished | 2-1-2-1-2-1-2-1 | 1 2 b3 4 b5 b6 6 7 | dim7 |
| `symmetric.half-whole-dim` | Half-Whole Diminished | 1-2-1-2-1-2-1-2 | 1 b2 b3 3 #4 5 6 b7 | 7, 7b9, 7#9 |
| `symmetric.whole-tone` | Whole Tone | 2-2-2-2-2-2 | 1 2 3 #4 #5 b7 | aug7, aug |
| `symmetric.chromatic` | Chromatic | 1×12 | All 12 | maj7, min7, 7, dim7 |

### Pentatonic (2)

| ID | Name | Intervals | Degrees | Chord Applications |
|---|---|---|---|---|
| `pentatonic.minor` | Minor Pentatonic | 3-2-2-3-2 | 1 b3 4 5 b7 | min7 |
| `pentatonic.major` | Major Pentatonic | 2-2-3-2-3 | 1 2 3 5 6 | maj7, maj6, 7 |

### Blues (2)

| ID | Name | Intervals | Degrees | Chord Applications |
|---|---|---|---|---|
| `blues.minor` | Minor Blues | 3-2-1-1-3-2 | 1 b3 4 b5 5 b7 | min7, 7 |
| `blues.major` | Major Blues | 2-1-1-3-2-3 | 1 2 b3 3 5 6 | 7, maj7, maj6 |

### Bebop (4)

| ID | Name | Intervals | Degrees | Chord Applications |
|---|---|---|---|---|
| `bebop.dominant` | Bebop Dominant | 2-2-1-2-2-1-1-1 | 1 2 3 4 5 6 b7 7 | 7 |
| `bebop.dorian` | Bebop Dorian | 2-1-1-1-2-2-1-2 | 1 2 b3 3 4 5 6 b7 | min7 |
| `bebop.major` | Bebop Major | 2-2-1-2-1-1-2-1 | 1 2 3 4 5 b6 6 7 | maj7, maj6 |
| `bebop.melodic-minor` | Bebop Melodic Minor | 2-1-2-2-1-1-2-1 | 1 2 b3 4 5 b6 6 7 | minMaj7 |

---

## MVP Scales (20)

The following scales are included in the MVP and shown on the Scales reference page:

**Must-have (12):** Ionian, Dorian, Mixolydian, Aeolian, Lydian, Minor Pentatonic, Major Pentatonic, Minor Blues, Bebop Dominant, Bebop Dorian, Melodic Minor, Altered

**Should-have (8):** Lydian Dominant, Locrian Natural 2, Harmonic Minor, Phrygian Dominant, Half-Whole Diminished, Whole Tone, Major Blues, Whole-Half Diminished

---

## Curated Lick Library (113 licks)

**Source:** `src/lib/data/licks/`

All licks are stored in **concert C** and transposed to other keys at query time. Transposition includes **octave centering** — notes are shifted to stay within the central instrument range (MIDI 60–84, C4–C6).

### ii-V-I Major (24 licks)

**File:** `src/lib/data/licks/ii-V-I-major.ts`

**Harmony:** Dm7 → G7 → Cmaj7 (scales: Dorian → Mixolydian → Ionian)

Variants include full-bar and half-bar (Dm7 2 beats → G7 2 beats → Cmaj7 1 bar) harmonic rhythms.

| ID Range | Difficulty | Bars | Description |
|---|---|---|---|
| `ii-V-I-major-1` to `ii-V-I-major-5` | 10–25 | 2 | Basic diatonic resolutions |
| `ii-V-I-major-6` to `ii-V-I-major-10` | 25–40 | 2 | Eighth note lines, approach notes |
| `ii-V-I-major-11` to `ii-V-I-major-15` | 40–55 | 2 | Chromatic approaches, enclosures |
| `ii-V-I-major-16` to `ii-V-I-major-24` | 55–75 | 2–3 | Extended lines, bebop vocabulary (incl. Dexter Gordon, Cannonball Adderley, Sonny Stitt style) |

### Blues (20 licks)

**File:** `src/lib/data/licks/blues.ts`

**Harmony:** C7 (Minor Blues scale) with some I-IV variants (C7 → F7).

| ID Range | Difficulty | Bars | Description |
|---|---|---|---|
| `blues-1` to `blues-5` | 10–25 | 1–2 | Basic blues scale patterns |
| `blues-6` to `blues-10` | 25–40 | 1–2 | Blue note bends, call-and-response |
| `blues-11` to `blues-20` | 40–65 | 2 | Extended blues vocabulary, chromatic, T-Bone Walker, Grant Green, Freddie Hubbard style |

### Bebop Lines (20 licks)

**File:** `src/lib/data/licks/bebop-lines.ts`

**Harmony:** Various — Cmaj7 (Ionian), C7 (Bebop Dominant), ii-V patterns.

| ID Range | Difficulty | Bars | Description |
|---|---|---|---|
| `bebop-1` to `bebop-5` | 25–40 | 2 | Bebop scale patterns, passing tones |
| `bebop-6` to `bebop-10` | 40–55 | 2 | Enclosures, chromatic approaches |
| `bebop-11` to `bebop-20` | 55–75 | 2 | Extended bebop lines, arpeggios, Parker turnaround, Dizzy high register, Ornithology fragment |

### ii-V-I Minor (15 licks)

**File:** `src/lib/data/licks/ii-V-I-minor.ts`

**Harmony:** Dm7b5 → G7alt → Cm7 (scales: Locrian Natural 2 → Altered → Aeolian)

| ID Range | Difficulty | Bars | Description |
|---|---|---|---|
| `ii-V-I-minor-1` to `ii-V-I-minor-4` | 25–40 | 2 | Basic minor ii-V resolutions |
| `ii-V-I-minor-5` to `ii-V-I-minor-8` | 40–55 | 2 | Altered scale vocabulary |
| `ii-V-I-minor-9` to `ii-V-I-minor-15` | 55–75 | 2 | Advanced lines, Woody Shaw, Joe Henderson style |

### Pentatonic (10 licks) — NEW

**File:** `src/lib/data/licks/pentatonic.ts`

**Harmony:** Various — Cmaj7 (Ionian), C7 (Mixolydian), Cm7 (Dorian).

| ID Range | Difficulty | Bars | Description |
|---|---|---|---|
| `pentatonic-1` to `pentatonic-5` | 8–20 | 1–2 | Basic major/minor pentatonic patterns, sequences |
| `pentatonic-6` to `pentatonic-10` | 20–45 | 2 | McCoy Tyner fourths, Wes Montgomery style, Herbie Hancock funky patterns, superimposition |

### Modal (10 licks) — NEW

**File:** `src/lib/data/licks/modal.ts`

**Harmony:** Various modal contexts — Dorian, Lydian, Mixolydian, Phrygian.

| ID Range | Difficulty | Bars | Description |
|---|---|---|---|
| `modal-1` to `modal-5` | 15–35 | 2 | So What motif, Dorian characteristic 6th, Coltrane Dorian, Lydian float |
| `modal-6` to `modal-10` | 35–55 | 2 | Wayne Shorter angular lines, Impressions motif, Phrygian mystery, Herbie Hancock dorian vamp |

### Rhythm Changes (7 licks) — NEW

**File:** `src/lib/data/licks/rhythm-changes.ts`

**Harmony:** I-vi-ii-V and bridge dominant cycles (rhythm changes form).

| ID Range | Difficulty | Bars | Description |
|---|---|---|---|
| `rhythm-changes-1` to `rhythm-changes-7` | 30–65 | 2 | A section arpeggios, bridge dominant cycles, turnaround patterns, Oleo, Anthropology excerpts |

### Ballad (7 licks) — NEW

**File:** `src/lib/data/licks/ballad.ts`

**Harmony:** Various — rich ii-V-I progressions, chromatic harmony.

| ID Range | Difficulty | Bars | Description |
|---|---|---|---|
| `ballad-1` to `ballad-7` | 25–55 | 2 | Body and Soul, Misty, Round Midnight fragments, Chet Baker space, ornamental turns, Lush Life |

---

## Lick Metadata

Each curated lick includes:

| Field | Description |
|---|---|
| `id` | Unique identifier (e.g. `'blues-7'`) |
| `name` | Descriptive name |
| `key` | Always `'C'` (canonical) |
| `timeSignature` | Always `[4, 4]` |
| `category` | One of: `'ii-V-I-major'`, `'ii-V-I-minor'`, `'blues'`, `'bebop-lines'`, `'pentatonic'`, `'modal'`, `'rhythm-changes'`, `'ballad'` |
| `difficulty.level` | 1–100 (see Difficulty Bands below) |
| `difficulty.pitchComplexity` | Independent pitch rating (1–100) |
| `difficulty.rhythmComplexity` | Independent rhythm rating (1–100) |
| `difficulty.lengthBars` | Number of bars |
| `tags` | Searchable keywords (e.g. `['diatonic', 'ascending', 'resolution']`) |
| `source` | Always `'curated'` |
| `harmony` | Chord progression with scale IDs |

### Difficulty Bands (1–100)

Difficulty is displayed as 10 color-coded bands:

| Range | Band Name | Color |
|---|---|---|
| 1–10 | Beginner | Green |
| 11–20 | Elementary | Light green |
| 21–30 | Intermediate | Teal |
| 31–40 | Upper Intermediate | Blue |
| 41–50 | Advanced | Indigo |
| 51–60 | Upper Advanced | Purple |
| 61–70 | Pre-Professional | Magenta |
| 71–80 | Professional | Orange |
| 81–90 | Expert | Red-orange |
| 91–100 | Virtuoso | Deep red |

Utility functions: `difficultyBand(level)`, `difficultyColor(level)`, `difficultyDisplay(level)` in `src/lib/difficulty/display.ts`.

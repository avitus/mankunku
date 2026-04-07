# Tonality System

The tonality system manages daily key/scale selection and progressive unlocking of tonalities as the player advances.

**Source files:** `src/lib/tonality/tonality.ts`, `src/lib/tonality/scale-compatibility.ts`

## Concepts

A **tonality** is a combination of a key (pitch class) and a scale type (e.g., "D Dorian", "Bb Blues"). Practice sessions focus on a single tonality per day — all licks are transposed to the day's key.

## Progressive Unlocking

Tonalities unlock based on the player's proficiency levels, with keys and scale types unlocking independently.

### Key Unlock Order (Circle of Fifths)

| Order | Key | Unlock Condition |
|---|---|---|
| 1 | C | 0 (free) |
| 2 | G | Key proficiency prerequisites met |
| 3 | F | Key proficiency prerequisites met |
| 4 | D | Key proficiency prerequisites met |
| 5 | Bb | Key proficiency prerequisites met |
| 6 | A | Key proficiency prerequisites met |
| 7 | Eb | Key proficiency prerequisites met |
| 8 | E | Key proficiency prerequisites met |
| 9 | Ab | Key proficiency prerequisites met |
| 10 | B | Key proficiency prerequisites met |
| 11 | Db | Key proficiency prerequisites met |
| 12 | Gb | Key proficiency prerequisites met |

### Scale Type Unlock Order

| Order | Scale Type | Unlock Condition |
|---|---|---|
| 1 | Major Pentatonic | 0 (free) |
| 2 | Major | 0 (free) |
| 3 | Blues | 0 (free) |
| 4 | Dorian | Scale proficiency prerequisites met |
| 5 | Mixolydian | Scale proficiency prerequisites met |
| 6 | Minor (Aeolian) | Scale proficiency prerequisites met |
| 7 | Lydian | Scale proficiency prerequisites met |
| 8 | Melodic Minor | Scale proficiency prerequisites met |
| 9 | Altered | Scale proficiency prerequisites met |
| 10 | Lydian Dominant | Scale proficiency prerequisites met |
| 11 | Bebop Dominant | Scale proficiency prerequisites met |

### Cross-Product

Available tonalities = unlocked keys × unlocked scale types. Initially, the player has 3 tonalities (C Major Pentatonic, C Major, C Blues). As they build proficiency, the combinatorial space grows quickly.

## Daily Tonality Selection

The daily tonality is selected deterministically from the set of unlocked tonalities using an FNV-1a hash of the date string. This ensures:

- Same tonality all day for a given player
- Different tonality each day (assuming > 1 unlocked)
- Even distribution across unlocked tonalities over time
- Deterministic — no server state needed

```
hash = fnv1a(dateString)  // e.g., "2026-03-19"
index = hash % unlockedTonalities.length
dailyTonality = unlockedTonalities[index]
```

## Settings Override

Players can override the daily tonality in Practice Settings:

- **Key selector**: Circle-of-fifths layout. Locked keys shown disabled with lock icon and proficiency requirements tooltip.
- **Scale type selector**: Locked scales shown similarly.
- **Reset to daily**: Button to restore automatic selection.

The override persists to `localStorage` via the settings state module (`tonalityOverride: Tonality | null`).

## Integration with Practice

The practice page derives the active tonality from either the override or the daily pick:

```typescript
const activeTonality = settings.tonalityOverride ?? getDailyTonality(today, unlockContext)
```

All licks in a session are transposed to `activeTonality.key` using `transposeLickForTonality()`. When the tonality changes (e.g., override selected), the current phrase is re-transposed via a `$derived`.

The practice page also displays the note count for the active scale (e.g., "5 notes" for pentatonic, "7 notes" for major) to help beginners understand what scale they're working with.

## Scale-Aware Lick Filtering

**Source file:** `src/lib/tonality/scale-compatibility.ts`

Not all licks are appropriate for every scale type. A 7-note major lick that gets snapped down to 5 notes sounds awkward in a pentatonic session. The scale compatibility system filters licks by their native scale before presenting them to the player.

### Design Decision

Pentatonic and blues scales are treated as **first-class scales**, not subsets of major. A pentatonic lick CAN appear in a major session (since pentatonic pitch classes are a subset of major), but a 7-note major lick should NOT appear in a pentatonic session.

### Compatibility Rules

The rules are based on pitch-class subset relationships:

| Lick's Native Scale | Compatible ScaleTypes |
|---|---|
| `pentatonic.major` (C D E G A) | `major-pentatonic`, `major`, `lydian`, `mixolydian` |
| `pentatonic.minor` (C Eb F G Bb) | `minor`, `dorian` |
| `blues.minor` (C Eb F Gb G Bb) | `blues`, `dorian`, `minor` |
| `major.ionian` (7-note major) | `major`, `lydian`, `mixolydian`, `bebop-dominant` |
| `major.dorian` | `dorian`, `minor` |
| `major.mixolydian` | `mixolydian`, `major`, `bebop-dominant` |
| `major.lydian` | `lydian`, `major` |
| `major.aeolian` | `minor`, `dorian` |
| `bebop.dominant` | `bebop-dominant`, `mixolydian`, `major` |
| `melodic-minor.*` | `melodic-minor`, `altered`, `lydian-dominant` |

For multi-chord progression categories (`ii-V-I-major`, `ii-V-I-minor`, `turnarounds`, `rhythm-changes`), compatibility is broader because the lick uses parent-key transposition:

| Category | Compatible ScaleTypes |
|---|---|
| `ii-V-I-major` | `major`, `dorian`, `mixolydian`, `lydian` |
| `ii-V-I-minor` | `minor`, `dorian`, `melodic-minor`, `altered` |
| `turnarounds` | `major`, `mixolydian` |
| `rhythm-changes` | `major`, `mixolydian` |

### Resolution Order

`getCompatibleScaleTypes(lick)` resolves compatibility in this order:

1. If `lick.source === 'user'` → compatible with all ScaleTypes (user-recorded licks always pass)
2. Check `lick.category` for progression categories → use category-level mapping
3. Inspect `lick.harmony[0]?.scaleId` → use scale-level mapping
4. Fallback → compatible with all ScaleTypes (safe for unknown licks)

### Fallback Behavior

If scale filtering leaves fewer than 3 licks at the player's difficulty level, the practice page widens to all licks at that difficulty level. This prevents empty sessions for rare scale type / difficulty level combinations.

## API

### Types

```typescript
interface Tonality {
  key: PitchClass;
  scaleType: string;  // e.g., 'major', 'blues', 'dorian'
}
```

### Functions

| Function | Signature | Description |
|---|---|---|
| `getDailyTonality` | `(date, ctx: UnlockContext) → Tonality` | Deterministic daily pick from unlocked set |
| `getUnlockedKeys` | `(ctx: UnlockContext) → PitchClass[]` | Keys unlocked at given proficiency |
| `getUnlockedScaleTypes` | `(ctx: UnlockContext) → ScaleType[]` | Scale types unlocked at given proficiency |
| `getUnlockedTonalities` | `(ctx: UnlockContext) → Tonality[]` | All unlocked key × scale combinations |
| `formatTonality` | `(tonality) → string` | Display string, e.g., "D Dorian" |

### Scale Compatibility Functions (`scale-compatibility.ts`)

| Function | Signature | Description |
|---|---|---|
| `getCompatibleScaleTypes` | `(lick: Phrase) → ScaleType[]` | Derive which ScaleTypes a lick works with |
| `isLickCompatible` | `(lick: Phrase, scaleType: ScaleType) → boolean` | Check if a lick is compatible with a given ScaleType |

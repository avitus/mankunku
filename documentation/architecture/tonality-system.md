# Tonality System

The tonality system manages daily key/scale selection and progressive unlocking of tonalities as the player advances.

**Source file:** `src/lib/tonality/tonality.ts`

## Concepts

A **tonality** is a combination of a key (pitch class) and a scale type (e.g., "D Dorian", "Bb Blues"). Practice sessions focus on a single tonality per day — all licks are transposed to the day's key.

## Progressive Unlocking

Tonalities unlock based on the player's XP, with keys and scale types unlocking independently.

### Key Unlock Order (Circle of Fifths)

| Order | Key | XP Threshold |
|---|---|---|
| 1 | C | 0 (free) |
| 2 | G | varies |
| 3 | F | varies |
| 4 | D | varies |
| 5 | Bb | varies |
| 6 | A | varies |
| 7 | Eb | varies |
| 8 | E | varies |
| 9 | Ab | varies |
| 10 | B | varies |
| 11 | Db | varies |
| 12 | Gb | varies |

### Scale Type Unlock Order

| Order | Scale Type | XP Threshold |
|---|---|---|
| 1 | Major | 0 (free) |
| 2 | Blues | 0 (free) |
| 3 | Dorian | varies |
| 4 | Mixolydian | varies |
| 5 | Minor (Aeolian) | varies |
| 6 | Lydian | varies |
| 7 | Melodic Minor | varies |
| 8 | Altered | varies |
| 9 | Lydian Dominant | varies |
| 10 | Bebop Dominant | varies |

### Cross-Product

Available tonalities = unlocked keys × unlocked scale types. At 0 XP, the player has 2 tonalities (C Major, C Blues). As they progress, the combinatorial space grows quickly.

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

- **Key selector**: Circle-of-fifths layout. Locked keys shown disabled with lock icon and XP tooltip.
- **Scale type selector**: Locked scales shown similarly.
- **Reset to daily**: Button to restore automatic selection.

The override persists to `localStorage` via the settings state module (`tonalityOverride: Tonality | null`).

## Integration with Practice

The practice page derives the active tonality from either the override or the daily pick:

```typescript
const activeTonality = settings.tonalityOverride ?? getDailyTonality(today, xp)
```

All licks in a session are transposed to `activeTonality.key` using `transposeLick()`. When the tonality changes (e.g., override selected), the current phrase is re-transposed via a `$effect`.

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
| `getDailyTonality` | `(date, xp) → Tonality` | Deterministic daily pick from unlocked set |
| `getUnlockedKeys` | `(xp) → PitchClass[]` | Keys unlocked at given XP |
| `getUnlockedScaleTypes` | `(xp) → string[]` | Scale types unlocked at given XP |
| `getUnlockedTonalities` | `(xp) → Tonality[]` | All unlocked key × scale combinations |
| `formatTonality` | `(tonality) → string` | Display string, e.g., "D Dorian" |

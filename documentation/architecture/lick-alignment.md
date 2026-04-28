# Lick Alignment

How a lick gets placed inside a chord progression cycle, and how that placement adapts when the lick doesn't fit the cycle's bar count cleanly.

**Source files:** `src/lib/data/progressions.ts`, `src/lib/state/lick-practice.svelte.ts`

## The problem

A "lick" carries melody + duration. A "progression" carries chord harmony spanning N bars. To practice a lick over a progression we need to answer two questions:

1. **Where in the progression cycle does the lick start?** (alignment)
2. **What if the lick doesn't fit inside the progression cycle?** (extension)

The answers depend on the lick's category (`major-chord`, `ii-V-I-major`, `V-I-major`, etc.), the progression type (`major-vamp`, `ii-V-I-major`, `ii-V-I-major-long`, etc.), and any per-lick metadata (`pickupBars`).

## Categories vs. progressions

Categories are a *role*, not a *bar count*. A `major-chord` lick is a 1-bar (or 2-, 3-bar) phrase that lives over a major-7 chord. The category describes the harmonic context the lick *expects*, not the progression it must run inside.

`PROGRESSION_LICK_CATEGORIES` (in `progressions.ts`) maps each progression to the categories it can host, plus the bar offset where each category lands. For example, on `ii-V-I-major` (a 2-bar | ii V | I | progression), the `major-chord` category is offset to bar 1 — so a 1-bar major-chord lick plays over the I chord, not over the ii-V.

```
ii-V-I-major  (2 bars)
├── major-chord    offset [1, 1]   // I (maj7) on bar 1
├── ii-V-I-major   offset [0, 1]   // full progression starts at bar 0
└── short-ii-V-I-major offset [0, 1]
```

## Alignment math

Given a session:
- **`progressionType`** — picks one of `PROGRESSION_TEMPLATES`
- **`lick.category`** — picks an entry from `PROGRESSION_LICK_CATEGORIES[progressionType]`
- **`lick.difficulty.lengthBars`** — how many whole bars the lick occupies
- **`lick.difficulty.pickupBars`** *(optional)* — how many of those bars are anacrusis preceding the bulk downbeat

The engine computes:

```
baseAlignment   = PROGRESSION_LICK_CATEGORIES[progressionType][lick.category].offset
shiftedAlign    = applyPickupBarShift(baseAlignment, pickupBars)        // pulls back, clamped at [0, 1]
alignmentBars   = ceil(shiftedAlign[0] / shiftedAlign[1])
lickBars        = max(template.bars, alignmentBars + lengthBars)        // per-lick cycle length
extension       = lickBars - template.bars                              // bars to sustain final chord
```

Notes are placed at `original_offset + shiftedAlign`. The progression's last harmony segment has `extension` bars added to its `duration` (via `extendHarmonyTail`).

The result: a single per-lick cycle whose length is *just enough* to host the lick. Other licks in the same session keep their own cycle lengths — the stretch is computed per lick, not per session.

### Two alignments, not one

`buildPhraseFor` and `buildLickSuperPhrase` actually compute *two* alignments:

- **`alignmentOffset`** (pickup-shifted) — applied to note offsets so the pickup falls on the right chord
- **`bodyAlignment`** (un-shifted) — passed to `resolveTransposeTarget` so chord-quality licks transpose to their *body* chord (the I), not the chord under the pickup (the V)

Without this split, a chord-quality `major-chord` lick with `pickupBars: 1` on long ii-V-I would transpose to G7 (the V) instead of Cmaj7 (the I), shifting every note up a fifth.

## Worked example

The 3-bar `major-chord-pickup-001` lick (triplet pickup → bulk → resolution, `lengthBars: 3`, `pickupBars: 1`):

| Progression | template.bars | base | shifted | alignmentBars | lickBars | extension |
|---|---|---|---|---|---|---|
| `major-vamp` | 2 | `[0,1]` | `[0,1]` (clamp) | 0 | `max(2,3)=3` | 1 |
| `ii-V-I-major` | 2 | `[1,1]` | `[0,1]` | 0 | `max(2,3)=3` | 1 |
| `ii-V-I-major-long` | 4 | `[2,1]` | `[1,1]` | 1 | `max(4,4)=4` | 0 |

The `pickupBars` shift puts the anacrusis on V wherever V exists; the bulk lands on I; the resolution sits on the (sometimes-extended) I.

## Auto-inference of `pickupBars`

User-entered and community-stolen licks created before the field existed have no way to declare anacrusis: `calculateDifficulty` only emits `{ level, pitchComplexity, rhythmComplexity, lengthBars }`. To keep those licks working without a forced re-save, `resolveAlignedLickOffset` falls back to `detectPickupBars(lick.notes)` when `difficulty.pickupBars` is absent.

```
pickupBars = lick.difficulty.pickupBars ?? detectPickupBars(lick.notes)
```

`detectPickupBars` is conservative:

1. Filter out rest events (`pitch === null`) — step-entry fills empty beats with explicit rests, and including them would force `firstOffset = 0` and disable detection on the very licks it's meant to fix.
2. Find the smallest sounded-note offset (`firstOffset`).
3. Find the smallest sounded-note offset that's exactly on an integer downbeat (`firstDownbeatBar`).
4. Return `floor(firstDownbeatBar)` only when `firstOffset < firstDownbeatBar` (i.e. there's anacrusis before the first clean downbeat). Otherwise return 0.

Existing curated multi-bar licks all start on `[0, 1]`, so detection returns 0 and behavior is unchanged. Explicit `pickupBars` always wins over auto-detection.

## File map

| File | Purpose |
|---|---|
| `src/lib/data/progressions.ts` | `PROGRESSION_LICK_CATEGORIES`, `applyPickupBarShift`, `extendHarmonyTail`, `detectPickupBars`, `resolveLickAlignmentOffset`, `resolveTransposeTarget` |
| `src/lib/state/lick-practice.svelte.ts` | `resolveAlignedLickOffset` (private), `getLickBars` (exported), `harmonyForLick`, `buildPhraseFor`, `buildLickSuperPhrase` |
| `src/routes/lick-practice/session/+page.svelte` | Routes per-lick `lickBars` through `scheduleLickWindows` so transport ticks stretch with the lick |

## Tests

- `tests/unit/lick-practice/progressions.test.ts` — `applyPickupBarShift`, `extendHarmonyTail`, `detectPickupBars`, `resolveLickAlignmentOffset`
- `tests/unit/lick-practice/super-phrase.test.ts` — full-cycle integration: `getKeyBars`, `buildLickSuperPhrase`, transposition split, auto-detection fallback

---

# Future challenges

Three alignment problems we'll almost certainly hit, with the cheapest viable fix for each.

## 1. Mid-bar pickups (anacrusis < 1 bar)

**The problem.** A 2-bar lick with an eighth-note pickup that starts at offset `[7, 8]` (last eighth of bar 0) leading into a downbeat at `[1, 1]`. `detectPickupBars` returns 1 (because `firstDownbeatBar = 1.0` and `firstOffset = 0.875 < 1.0`), and the alignment shifts the *whole* anacrusis bar back. On short ii-V-I (`major-chord` base alignment `[1, 1]`), that pulls the bulk to `[0, 1]` — but the pickup is now buried at `[7, 8]` of the ii-V bar, where it should ideally sit on the V chord's last beat.

For short ii-V-I where ii and V are half-bars, this *happens* to land the pickup on V (which spans `[1/2, 1]`) — fine. But on long ii-V-I where V is a full bar `[1, 2]`, the pickup at `[7, 8]` sits on the *ii*, not the V. Aesthetically wrong.

**Plan.**
- Generalize `pickupBars: number` → `pickupOffset: Fraction` ("the offset where the bulk downbeat sits, relative to the lick's start"). `pickupBars: 1` becomes `pickupOffset: [1, 1]`. `applyPickupBarShift` becomes `applyPickupOffsetShift(baseAlignment, pickupOffset)`.
- `detectPickupBars` becomes `detectPickupOffset`: returns `firstSoundedDownbeat` (in fractional bars), not just `floor` of it.
- Alignment subtracts the *exact* fraction from the base: e.g. on long ii-V-I, base `[2, 1]` − `[1, 8]` (eighth pickup) = `[15, 8]` — the pickup sits one eighth before bar 2 (bar 1 last eighth, on V's last eighth) and the bulk on bar 2. Substraction is fraction arithmetic via `addFractions(base, negate(pickupOffset))`.
- Migration: existing `pickupBars: N` licks read as `pickupOffset: [N, 1]`. No data change.

**Test plan.** New test cases in `progressions.test.ts` for half-bar and eighth-bar pickups; integration tests in `super-phrase.test.ts` covering long ii-V-I with eighth-pickup placement.

## 2. Multi-chord licks that span an unusual bar boundary

**The problem.** A 2-bar `V-I-major` lick is currently aligned via `PROGRESSION_LICK_CATEGORIES['ii-V-I-major-long'].V-I-major.offset = [1, 1]` — V starts on bar 1, I on bar 2. But suppose someone authors a `V-I-minor` lick where the V occupies a *half* bar (the lick implies a quick V→I resolution), or a 3-bar `iii-VI-ii-V-I` lick that crosses two existing progression-template boundaries. There's no machinery to express "this lick spans these specific chord roles in this specific bar pattern."

The current model is one-dimensional: a single offset places the whole lick. For multi-chord licks whose internal harmony layout is *different* from the progression's, we silently let the lick's intrinsic harmony get discarded (`buildPhraseFor` always replaces it with `progressionHarmony`) — which is fine for chord-quality licks but fails for licks whose melody is engineered around a specific internal harmonic rhythm.

**Plan.**
- Detect mismatches: compute "harmonic checksum" (chord-quality sequence + per-segment bar count) for both the lick's intrinsic harmony and the target progression's harmony at the lick's window. If they diverge beyond a threshold, refuse the placement (or warn at lick-add time).
- For the *legitimate* case (lick's harmonic rhythm matches but the *bar offsets* differ), introduce `lick.alignment` as a per-progression override map:
  ```ts
  alignment?: Partial<Record<ChordProgressionType, Fraction>>
  ```
  This lets a curated lick declare "on long ii-V-I I want offset `[1, 1]` (V starts bar 1)" or "on rhythm changes I want offset `[3, 1]`." The resolver consults `lick.alignment[progressionType]` before falling back to `PROGRESSION_LICK_CATEGORIES`.
- Tests: a synthetic 3-bar `iii-VI-ii-V` lick placed on rhythm changes; verify the override wins over the category default and the harmony chart matches.

## 3. Substitutions + pickups interaction (untested invariant)

**The problem.** With `enableSubstitutions: true`, the engine maps a `minor-chord` lick onto a dominant chord via the minor-over-dominant rule (lick transposes a semitone above the dominant root). The substitution alignment is computed in `getSubstitutionAlignmentOffset`. Per the current code, `resolveLickAlignmentOffset` returns the substitution offset and `resolveAlignedLickOffset` then applies `applyPickupBarShift` to it — so on paper, `pickupBars` is honored on substituted alignments. But this isn't covered by any test. The first time someone authors a `minor-chord` lick *with* `pickupBars: 1` (e.g. an Am7 lick with a triplet pickup) and substitutes it onto a G7 on long ii-V-I, we'll find out whether the invariant actually holds — and won't get a regression alarm if a future refactor breaks it.

**Plan.**
- Add an integration test: synthetic `minor-chord` lick with `pickupBars: 1` + `enableSubstitutions: true` + long ii-V-I; assert (a) `getLickBars` reflects the pickup shift, (b) the pickup falls on the bar *before* the V, not on the V's downbeat, (c) the substitution still transposes the lick a semitone above the V's root (Ab over G7).
- Add a parallel test for the auto-detected pickup case (lick with no explicit `pickupBars`, anacrusis pattern in notes, substitutions enabled).
- Cross-link from the substitution rules section to this alignment doc so the invariant is discoverable.

**Out of scope.** Cross-rule pickup composition (e.g. minor-over-dominant *and* tritone-sub stacked) — the substitution engine only supports one rule per lick today.

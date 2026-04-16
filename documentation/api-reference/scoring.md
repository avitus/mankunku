# API Reference: Scoring

The scoring system aligns detected notes to expected notes and produces per-note pitch and rhythm accuracy scores.

**Source:** `src/lib/scoring/`

---

## alignment.ts

Dynamic Time Warping (DTW) alignment of detected notes to expected notes.

### `alignNotes(expected, detected, tempo, swing?): AlignmentPair[]`

Find the minimum-cost alignment between two note sequences.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `expected` | `Note[]` | — | Notes from the phrase (rests are filtered out internally) |
| `detected` | `DetectedNote[]` | — | Notes captured from microphone |
| `tempo` | `number` | — | BPM for converting offsets to seconds |
| `swing` | `number` | `0.5` | Swing ratio; shifts expected off-beat 8ths in the cost function to match swing playback |

**Returns:** `AlignmentPair[]` where each pair is one of:
- `{ expectedIndex, detectedIndex, cost }` — matched pair
- `{ expectedIndex, detectedIndex: null, cost }` — missed note
- `{ expectedIndex: null, detectedIndex, cost }` — extra note

**Cost function:**

| Match type | Cost |
|---|---|
| Same MIDI note | `0.0` pitch + rhythm distance |
| 1 semitone off | `0.5` pitch |
| 2+ semitones off | `1.0` pitch (capped) |
| Skip (missed/extra) | `2.0` flat penalty |
| Rhythm | `\|expectedOnset - detectedOnset\| / beatDuration` (capped at 1.0) |

---

## pitch-scoring.ts

Per-note pitch accuracy scoring.

### `scorePitch(expected, detected): number`

| Case | Score |
|---|---|
| Rest | `1.0` |
| Wrong MIDI note | `0.0` |
| Correct MIDI note | `1.0 + intonation bonus` |

**Intonation bonus:** `0.1 * max(0, 1 - |cents| / 50)`
- 0 cents: +0.10 (total 1.10)
- 25 cents: +0.05 (total 1.05)
- 50 cents: +0.00 (total 1.00)

The bonus is clamped to 1.0 at the composite score level.

---

## rhythm-scoring.ts

Per-note rhythm accuracy scoring.

### `scoreRhythm(expected, detected, tempo, swing?): number`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `expected` | `Note` | — | Expected note from phrase |
| `detected` | `DetectedNote` | — | Detected note from mic |
| `tempo` | `number` | — | BPM for timing conversion |
| `swing` | `number` | `0.5` | Swing ratio (0.5 = straight, 0.67 = triplet, 0.8 = heavy) |

```
timingError = |detectedOnset - expectedOnset| / beatDuration
penalty     = min(1.0, 0.5 + tempo / 300)
rhythmScore = max(0, 1.0 - timingError * penalty)
```

The penalty is **tempo-scaled**: gentler at slow tempos (where a given absolute timing error is a smaller fraction of a beat) and tighter at fast tempos.

| Tempo | Penalty | 0-score threshold |
|---|---|---|
| 60 BPM | 0.70 | ~1.43 beats off (~1430 ms) |
| 100 BPM | 0.83 | ~1.20 beats off (~720 ms) |
| 200 BPM | 1.00 | 1.00 beat off (300 ms) |

**Swing awareness:** When `swing > 0.5` and the expected note falls on an off-beat eighth, the expected onset is adjusted to match swing playback timing.

**Rests:** If `expected.pitch` is `null`, the score is `1.0`.

---

## scorer.ts

Orchestrates the full scoring pipeline.

### `scoreAttempt(phrase, detected, tempo, transportSeconds?, swing?): Score`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `phrase` | `Phrase` | — | The expected phrase |
| `detected` | `DetectedNote[]` | — | Detected notes from mic |
| `tempo` | `number` | — | BPM used during the attempt |
| `transportSeconds` | `number` | `0` | Transport position when recording started |
| `swing` | `number` | `0.5` | Swing ratio for rhythm scoring adjustment |

**Pipeline:**

1. **Grid anchoring** — Snap detected onsets to the nearest bar downbeat using Transport position
2. **DTW alignment** — `alignNotes()` matches detected to expected
3. **Latency correction** — Compute median timing offset of matched pairs and subtract from all detected onsets (absorbs ~100–300ms constant delay)
4. **Per-note scoring** — `scorePitch()` and `scoreRhythm()` for each matched pair
5. **Composite score** — `overall = pitchAccuracy * 0.6 + rhythmAccuracy * 0.4`
6. **Grade assignment** — `scoreToGrade(overall)`

**Returns:** `Score` object:

```typescript
{
  pitchAccuracy: number;       // 0-1, average of pitch scores
  rhythmAccuracy: number;      // 0-1, average of rhythm scores
  overall: number;             // 0-1, weighted composite
  grade: Grade;                // 'perfect' | 'great' | 'good' | 'fair' | 'try-again'
  noteResults: NoteResult[];   // Per-note breakdown
  notesHit: number;            // Count of correct pitches
  notesTotal: number;          // Total expected notes
  timing: TimingDiagnostics;   // Offset statistics after latency correction
}
```

`TimingDiagnostics`:

```typescript
interface TimingDiagnostics {
  meanOffsetMs: number;                // Average signed offset after correction
  medianOffsetMs: number;
  stdDevMs: number;                    // Rhythmic consistency
  latencyCorrectionMs: number;         // Median offset that was subtracted
  perNoteOffsetMs: (number | null)[];  // null = missed / extra
}
```

---

## grades.ts

Score-to-grade mapping and display constants.

### `scoreToGrade(overall): Grade`

| Grade | Threshold |
|---|---|
| `'perfect'` | >= 95% |
| `'great'` | >= 85% |
| `'good'` | >= 70% |
| `'fair'` | >= 55% |
| `'try-again'` | < 55% |

### `GRADE_LABELS: Record<Grade, string>`

Display labels: `'Perfect'`, `'Great'`, `'Good'`, `'Fair'`, `'Try Again'`.

### `GRADE_COLORS: Record<Grade, string>`

CSS color variables: `perfect`/`great` → `--color-success`, `good` → `--color-accent`, `fair` → `--color-warning`, `try-again` → `--color-error`.

# Tune System

Everything that turns a full song form into something the app can render, play, and score against. Licks are the app's original unit; tunes were added on top **without** forking the playback, scoring, or notation engines — the design constraint throughout was "bridge into the existing `Phrase` pipeline rather than build a parallel one."

Source lives in `src/lib/tunes/` (domain + importers), `src/lib/music/tune-notation.ts` + the layout modules (engraving), `src/lib/notation/` (DOM-adjacent geometry), `src/lib/matching/` (melodic recognition), and `src/lib/state/tune-*.ts` (UI state).

## The data model

```typescript
interface Tune {
  id: string;
  title: string;
  composer?: string;
  key: PitchClass;              // CONCERT — unlike licks, which are all stored in C
  timeSignature: [number, number];
  style?: string;               // 'Medium Swing', 'Ballad', …
  tags: string[];
  sections: TuneSection[];
  source: TuneSource;           // 'curated' | 'user' | 'imported-ireal' | 'imported-biab' | 'imported-pdf' | …
  difficulty?: DifficultyMetadata;
  pdfUrl?: string;              // storage path of the original PDF, when imported that way
}

interface TuneSection {
  label: string;                // 'A', 'B', 'Intro', 'Coda', …
  bars: number;                 // authoritative even when melody is sparse or absent
  repeatStart?: boolean;        // |:
  repeatEnd?: boolean;          // :|
  ending?: 1 | 2;               // numbered volta
  notes: Note[];                // SECTION-LOCAL offsets, starting at [0,1]
  harmony: HarmonicSegment[];   // SECTION-LOCAL offsets
}
```

Two decisions carry most of the weight:

**Tunes store their real concert key.** A lick is stored in C and transposed to wherever it's needed. A tune in F is stored in F — transposing a whole chart on save would throw away the composer's spelling. `transposeTune` (book-loader) shifts to any target key at query time, and `HarmonicSegment.symbol` carries the raw chord text so display never loses the chart's own fidelity.

**Section offsets are section-local.** Sections are self-contained, which is what makes repeat expansion and section reordering tractable. Nothing downstream consumes sections directly — everything goes through the flatten.

## Flattening: two timelines

`flattenTune(sheet, options)` (`tunes/flatten.ts`) concatenates sections into one continuous melody + harmony timeline. It produces **two different timelines depending on one flag**, and confusing them is the single most common source of bugs in this subsystem:

| | `expandRepeats: false` (default) | `expandRepeats: true` |
|---|---|---|
| Called the | **notation timeline** | **playback timeline** |
| Order | sections once, in written order | repeats written out (body, ending 1, body, ending 2) |
| Consumed by | the chart renderer, chart markers | the backing-track scheduler, session windows |

`FlattenedTune` carries the bridge between them:

- `noteSourceIndices[i]` / `segmentSourceIndices[i]` — playback-timeline index → notation-timeline index. Identity when unexpanded; on an expanded timeline both passes of a repeated section map back to the *same* notation index, which is what lets one chart marker light up on both passes.
- `sectionMap[]` — one entry per emitted section in this timeline's order: which authored section it came from, and its bar offset here.
- `totalBars`.

`notationBarForPlaybackBar` (tune-practice-plan) is the helper that walks `sectionMap` to project a playback bar onto its chart bar.

## Bridging into the Phrase pipeline

`tuneToPhraseWithFlat(sheet, options)` (`tunes/to-phrase.ts`) wraps a flatten in a `Phrase` (`source: 'tune'`, `category: 'user'`), so `playback.ts`, `backing-track.ts`, and the scorer consume a tune with zero new orchestration. It returns the flatten alongside the phrase deliberately — consumers that need provenance take this form so phrase and provenance cannot diverge. `tuneToPhrase` is the convenience wrapper for callers that don't.

## The book

`tunes/book-loader.ts` mirrors `phrases/library-loader.ts`:

- `getAllTunes()` — curated + user-created + community-adopted, deduped by id, earlier source winning (curated > user > adopted).
- `isCuratedTuneId(id)`, `getTuneById(id)`.
- `transposeTune(sheet, targetKey, rangeLow, highestNote)` — whole-sheet transposition: melody shifted with octave centring against the player's range, chord roots shifted, and `symbol` text re-spelled via `transposeChordSymbol`.

## Importers

All five add-paths converge on the same `Tune` shape. Two shared modules do the converging:

- **`segment-from-symbol.ts`** — the one place chord text becomes a `HarmonicSegment`. Maps the open-ended written symbol onto the closed `ChordQuality` enum, picks a default scale context, and stamps the raw concert text into `symbol`. Manual entry and every importer route through it, so a `C7b9` typed by hand and a `C7b9` read off a PDF produce identical data.
- **`section-builder.ts`** — the one place a flat bar-by-bar structural reading (rehearsal marks, repeat barlines, voltas, pickup flags) plus absolute-offset events becomes `TuneSection[]`. Both score importers feed it, so equivalent structural readings produce identical forms *by construction*. Its rules were grown against real charts: split at marks / `|:` / after `:|` / at volta-membership changes; a flagged anacrusis stays unlabeled and outside repeats; an orphan `:|` synthesizes a repeat from the top; unmarked sections take the next unused letter; ending sections inherit their body's label; the in-effect chord restates across boundaries.

| Module | Input | Notes |
|---|---|---|
| `import/ireal.ts` | `irealbook://` and `irealb://` URLs | Includes the 50-char-chunk unscrambler for the `irealb://` variant (the transform is an involution). Playlists yield many sheets. Harmony only — iReal charts have no melody. |
| `import/biab.ts` | `.SGU`/`.MGU` binary, or BIAB MusicXML | Binary reader follows MuseScore's `importexport/bb` layout (version byte, pascal title, style/key/tempo, RLE chord-extension streams over a 255-bar × 4-beat grid). MusicXML is the recommended fallback when the binary read comes out wrong. Harmony only. |
| `import/musescore.ts` | `.mscz` / `.mscx` | The richest and only **lossless** import. Reads staff 1 voice 1 as melody, `<Harmony>` as changes. Resolves both pitch conventions exactly: `<Note><pitch>` is already concert; `<Harmony>` roots are written-pitch and get shifted back by `<transposeChromatic>`; `<KeySig><concertKey>` gives the concert key directly. |
| `import/claude-pdf.ts` + `import/pdf-*.ts` | A PDF, via `/api/tune-parse` | Geometry detection (staves, barlines, chord text, noteheads) feeds Claude's transcription; `claudeJsonToTune` converts the returned JSON. `extractionConsistencyScore` counts structural warnings (resyncs, bar-count mismatches, overview disagreements) and the route retries once when it's high. Output always lands in a review panel — warnings name the *printed bar* they refer to. |

`source-transposition.ts` handles a question every add-path has to ask: the chart in front of the user may be a written-pitch part (a Bb book page, an Eb alto edition). Every add method lets the user declare the source pitch, and this module shifts to concert on the way in.

`adopted-tune-validator.ts` structurally validates foreign payloads (community adoptions, PDF conversions) against caps — `MAX_SECTIONS_PER_ADOPTED_TUNE`, `MAX_BARS_PER_SECTION`, `MAX_NOTES_PER_ADOPTED_TUNE`.

## Engraving

`music/tune-notation.ts` renders a `Tune` to ABC. It is a **separate entry point from `phraseToAbc`** — the lick renderer is untouched by any of this.

- `tuneToAbc(sheet, options)` and `tuneToAbcWithMap(...)`. The `WithMap` form additionally returns `BarAnchor[]` and `ChordSlotAnchor[]`: char-span anchors into the emitted ABC that the hit-zone layer maps onto rendered geometry.
- Chords, repeat barlines, numbered endings, section letters, and multi-system reflow are all handled here.

Layout policy lives in pure modules beside it:

- **`chart-layout.ts`** — density-aware reflow (`suggestBarsPerLine`, 3–6 bars per system, 4 by default), jazz slash notation for melody-silent bars, multi-rest runs, `CHART_STAFF_WIDTH`.
- **`chord-layout.ts`** — MuseScore Jazz–style chord stacking: root + quality on the baseline, alterations in a column to the *right* of the quality (never over the root), slash bass hanging below. Emits `ChordTspanSpec[]` for the renderer.
- **`ending-layout.ts`** — first/second-ending (volta) policy following Sibelius / Real Book convention: `[1]` continues the approach system when there's room; `[2]` always opens a fresh system with **no musical pad bars**, aligned under `[1]` by a post-render indent. Stacked `[2]` glyphs are *repositioned*, never horizontally scaled — scaling was the original source of squashed noteheads and "2"/chord collisions.
- **`chord-symbol.ts`** — the canonical chord model. `ChordSymbol` preserves what the lead sheet actually says (base quality, stacked extension, alterations, slash bass) independent of the closed `ChordQuality` enum the audio layer voices. `parseChordSymbol` / `formatChordSymbol` / `transposeChordSymbol` / `chordSymbolToQuality`.

`src/lib/notation/` holds the DOM-adjacent half, all of it DOM-free and unit-testable:

- **`chart-geometry.ts`** — turns ABC char-span anchors plus a reduced view of abcjs' rendered layout into hit rectangles (bar zones, per-beat chord zones) and beat-advance logic.
- **`abcjs-adapter.ts`** — adapts abcjs' returned `visualObj` onto those pure shapes. abcjs types are deliberately *not* imported; the interfaces structurally describe only what's consumed.
- **`follow-scroll.ts`** — teleprompter math: fractional bar position → translateY, keeping the music near a fixed reading line.
- **`ending-align-dom.ts`** — applies the ending-layout transform to rendered SVG.

`NotationDisplay.svelte` is the single component behind all of it, taking either `phrase` or `tune`, with `variant: 'print' | 'practice'`, `cursorIndex`, `rangeMarkers`, `autoScrollPlayhead` + `playheadBarFraction`, and optional `onSelect` / `onBarClick` / `chordEditor` wiring for the editor. Note the deliberate asymmetry: changing `selectedIndex` re-renders, changing `cursorIndex` or a marker's status only swaps CSS classes and overlay rects — so playback can drive them per-note without re-engraving the chart.

## Progression detection

`tunes/progression-detector.ts` finds known progression shapes (`PROGRESSION_SHAPES`) inside a flattened tune's harmony. It's **timeline-agnostic**: pass the notation flatten for chart annotations or the expanded flatten for playback scheduling, and the returned `segmentIndices` refer to whichever harmony array was scanned.

```typescript
interface DetectedProgression {
  type: ChordProgressionType;
  slots: DetectedSlot[];          // one per shape slot, in order
  segmentIndices: number[];
  localKey: PitchClass;           // concert local tonic (Bb inside an F tune)
  tuneKeyDegree: ScaleDegree;     // localKey labelled against the tune's key ('4' = the IV key)
  startOffset: Fraction;
  duration: Fraction;
  startBar: number;
  endBarExclusive: number;
  wrapsAround: boolean;           // trailing slots matched by wrapping to the top of the form
}
```

`detectProgressions` is cyclic by default (a form loops, so a turnaround's resolution can live at offset 0). `selectNonOverlapping` resolves competing matches by `SHAPE_PRIORITY` — most specific shape first, so a long ii-V-I isn't shredded into a short one plus a stray.

## Lick matching

`tunes/lick-matcher.ts` turns detected progressions into ranked, **mastery-aware** suggestions. Pure core over injected `LickMatcherDeps`; `buildLickMatcherDeps` is the *only* function that touches persistence, and it imports loaders exclusively — never the store's setters, which enqueue cloud pushes.

Eligibility keys off `prog:*` tags first. Category *overrides* are write-only at read time, so a user's re-categorization survives only as the auto-seeded prog tags; a lick's inline `category` remains a valid secondary signal for curated licks. Category-`user` licks with no prog tags land in an `uncategorized` bucket so they surface as needs-setup rather than silently failing to match.

Each `LickSuggestion` carries the target key, the insertion offset and bar, the template alignment offset, the match source (`prog-tag` | `category` | `substitution`), and a `masteryTier` (`known` | `learning` | `unknown`) derived from the lick's unlocked-key count and practice history — which is what stops the app suggesting a line in a key the player hasn't earned.

## Session planning

The lick-practice split is mirrored exactly: pure logic in a plain module, a thin runes wrapper, and the route owning audio orchestration.

**`state/tune-practice-plan.ts`** (pure):

- `buildSessionPlan(deps)` → `InsertionPoint[]`. Each point carries both timelines (playback bar range + notation segment indices/bar range/time range), absolute transport open/close ticks, its suggestions, and a `markerKey` grouping repeat occurrences so one chart marker maps to N playback windows.
- `headBarsForFlat(flat)` — the **jazz form rule**, implemented against the *expanded section map*, never raw repeat markers (imported charts express those inconsistently). A whole-form outline is a repeat where, once the second pass begins, the replayed body runs to the end with only new tail sections after it. An internal repeat (`|: A :| B A` in an AABA chart) interleaves new material with replayed material and is an ordinary play-twice repeat, not a form outline.
- `buildSessionPhrase({flat, timeSignature, playHead})` — head chorus (melody once) plus melody-free solo material. On a whole-form-repeat chart the expanded timeline *already* holds head pass + solo pass, so only the second pass's melody is dropped; on a repeat-free chart the practice chorus is an appended duplicate of the changes. Melody notes stay a prefix of `flat.notes` so `PlaybackEvent.sourceIndex` provenance stays valid.
- `assignSuggestRotation(plan)` — least-used-first rotation per progression type, so a tune with four ii-Vs drills four different licks rather than the same favourite four times. A positional index-modulo would not work: each point's eligible list differs in order and length because the target key varies.
- `strictnessKnobs(strictness, userBleedFilterEnabled)` — maps onto **existing** pipeline knobs only; the grading scale never changes. Guided/standard mirror continuous lick practice (octave-insensitive, bleed filter on); solo mirrors call-and-response strictness and respects the user's own bleed preference.
- `applyInsertionResult(...)` — points = `round(overall * 100)`, doubled when this window *and* the previous one both clear `KEY_PROFICIENT_THRESHOLD` (0.90 — the existing pass bar, not a new threshold). A null score is a skipped window: no points, streak resets.
- `indexResultsByInsertion(results)` — keyed lookup, not array position. Results accrue in play order and a skipped window contributes none, so `results[i]` would map every later plan point to the wrong result after any gap.

**`state/tune-practice.svelte.ts`** (runes wrapper) exposes the `tunePractice` rune, `previewSessionPlan`, `startTunePracticeSession` → `TunePracticeAudioPlan`, the phase transitions (`setup` → `count-in` → `head` → `running` → `complete`), window bookkeeping, and `buildFreestyleBook`.

Consumers must read `TunePracticeAudioPlan.playHead` — the *effective* decision (`config.playHead && hasMelody`) — rather than `config.playHead`, which ignores that a melody-less chart never plays a head.

**Session results are not persisted.** No `recordAttempt`, no per-key lick writes, no adaptive movement. This is a product decision, not an omission — see [The Practice Modes](./overview.md).

## Freestyle recognition

`src/lib/matching/` is an n-gram inverted-index melodic matcher, shared between the server-side `/api/lick-match` attribution endpoint and client-side freestyle recognition.

- `encode.ts` / `live-feature.ts` — encode a `Phrase` (notated fractions) or a live `DetectedNote[]` stream (mic-time seconds, tempo-quantized to 16th-note ticks) into the same transposition-invariant `LickFeature`: semitone intervals + inter-onset intervals.
- `search.ts` — builds an interval 5-gram index (`DEFAULT_NGRAM_SIZE`), then for each query n-gram finds hits, groups by `(phraseIndex, offset)`, and scores each alignment. `pitchWeight` defaults to **0.6**, matching the project's 60/40 pitch-rhythm convention; `/api/lick-match` passes 0.7 explicitly because its tuned WJazzD-attribution weighting is the exception, not the rule.
- `book-index.ts` — `buildBookIndex` over the user's *own* licks. The server index is the WJazzD attribution corpus, which is the wrong corpus for "did the user just play a lick they know."
- `freestyle.ts` — the stateful debounced live recognizer (silence guard, per-lick cooldowns; create one per session). Fires at ≥ 0.9 confidence, reusing the `/api/lick-match` "quote" cutoff rather than inventing a bar; a minimum-length single-n-gram match needs 0.95, because its pitch side carries no discrimination.
- `fallback-name.ts` — descriptive names when no attribution matches ("C ii-V-I (Maj) — scalar eighths, 2 bars").

`buildFreestyleBook` restricts the pool to licks the user actually knows: practice-set members, anything with practice progress, and their own or adopted licks — never the whole curated catalog, since celebrating a lick the user has never seen is noise, not feedback.

## Editor state

`state/tune-entry.svelte.ts` builds long-form entry **on top of** the shared `stepEntry` buffer rather than beside it. The section list is authoritative; melody is edited one ≤4-bar *page* at a time through step-entry, so `PitchEntryPanel` / `DurationSelector` / keyboard entry all work unmodified. The buffer commits on page and section navigation, and is suspended (committed + emptied) on route exit so `/licks/editor` never sees tune content.

Manual entry is 4/4-only (`melodyEditingSupported`). Imported charts in other meters keep their meter with melody editing gated off — the 4/4 buffer would corrupt them. Chords are typed as written-pitch text and stored concert with re-derived change-point durations.

## Related

- [Data Model](./data-model.md) — full type reference.
- [The Practice Modes](./overview.md) — how tune practice relates to Side A and Side B.
- [Your Tunes](../tunes.md) / [Playing Over Tunes](../tune-practice.md) — the player-facing view of all this.

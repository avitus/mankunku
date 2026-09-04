# Mankunku Documentation

Mankunku is a jazz ear training web app built around **call and response**: the app plays a phrase, you play it back on your instrument, and it scores your pitch and rhythm accuracy.

Named after [Winston "Mankunku" Ngozi's](https://en.wikipedia.org/wiki/Winston_Mankunku_Ngozi) iconic 1968 album *Yakhal' Inkomo*, this app targets jazz musicians practicing ear training, transcription, and improvisation vocabulary.

> **2026-09-03** — **the sheet waits its turn, and a reading pause heralds it.** The lead-sheet row no longer shows a key early: while the previous key plays, its row is that key's chord chart (the staff is engraved underneath but hidden), and when the previous window closes the band drops into a **two-bar reading pause** — a ii-V vamp into the new key, a new `read` phase on the tab (READ, then *Play G in 4·3·2·1*) — while the row steps into place and the chart cross-fades into the staff. Only then does the first pass open. A revealed key that opens the cycle needs no pause: its demo is the herald. The read-ahead parking from earlier today is withdrawn; the stack is back to one rule. Display position (row, pass, beat) is now read off the scheduled window plan (`cyclePositionAt`), which is what keeps every key's beat aligned across a pause of any length (`LEAD_SHEET_PAUSE_BARS`, `getKeyPauses`, `planCycleWindows.pauses`, `lickAudioBars.pauseBars`) — [User Guide](./user-guide.md#what-happens-during-a-session), [State Management](./architecture/state-management.md), [state API](./api-reference/state.md), [Components](./api-reference/components.md).
>
> **2026-09-03** — **notation engine fetched during session setup.** abcjs (~125 KB brotli, the second-largest chunk) stays a dynamic import, but it now has ONE memoised loader (`notation/abcjs-loader.ts`) that `NotationDisplay` reads from and the lick-practice session calls at mount, alongside the mic/sample/detector setup. Before, the first lead-sheet row issued the fetch from its own mount — the moment the count-in starts — so a cold Daily session downloaded the engine during the bars before the sheet had to be read — [Components](./api-reference/components.md#notationdisplaysvelte), [Tune System](./architecture/tune-system.md).
>
> **2026-09-03** — **lead sheet readable a key ahead** (superseded the same day by the reading pause above). The key stack parked the row BEFORE the lead-sheet row at the top, so the whole sheet was on screen and lit for the preceding key. It fixed the real problem — a row only came fully into view on the tick its play window opened, and in Daily/Focused sessions the key being learned is always the LAST row, so the sheet arrived half-clipped and dimmed as the mic opened — but by showing the sheet a whole key early, while the player was still working from memory.
>
> **2026-09-01** — **lead-sheet row, round two.** The in-session sheet music now shows for ONE key per lick — the one being learned (most recently unlocked; never once all 12 are unlocked) — while it is under 75%, and in continuous mode that key plays **three passes** in a row with the sheet held still (only the third counts; the first two are rehearsals, flashed but never persisted; call-and-response keeps its single window). The staff is ~1.5× larger (sized by width) and the playback marker is drawn on the staff from abcjs's own bar geometry, so it aligns with the engraved bars; the beat strip is gone (`newestUnlockedKey`, `shouldRevealNotation`, `LEAD_SHEET_PASSES`, `getKeyPasses`, `planCycleWindows.passes`, `rowScrollFraction`) — [User Guide](./user-guide.md#what-happens-during-a-session), [State Management](./architecture/state-management.md), [state API](./api-reference/state.md), [Components](./api-reference/components.md).
>
> **2026-09-01** — **practice-phase colours swapped.** The player now PLAYS in brass and LISTENS in on-air red (red reads as "stop"), app-wide through two semantic aliases `--color-phase-play` / `--color-phase-listen`; stop/record buttons keep the red — [Design System › Practice-phase colours](./architecture/design-system.md#practice-phase-colours).
>
> **2026-09-01** — **sheet music when a key is beating you.** In lick-practice sessions (Daily, Focused, Deep) a key whose rolling score is under 75% gets a taller **lead-sheet row** in the scrolling chord stack — the line engraved with its changes above the staff, the current note lit, beat dots beneath — and goes back to chord blocks once it recovers; never on a first attempt, never for tricks, no setting (`PlannedKey.reveal` / `shouldRevealNotation`, `leadSheetTuneFor`, `keyStackLayout`) — [User Guide](./user-guide.md#what-happens-during-a-session), [State Management](./architecture/state-management.md), [Components](./api-reference/components.md), [music API](./api-reference/music.md).
>
> **2026-08-22** — **minor keys for licks.** A lick now carries `mode` (major/minor) beside its tonic key: minor licks are entered, stored, labelled and engraved as minor (D minor shows one flat and `K:Dm`; pills read *Dm*; the editor's typed naturals follow the drawn signature; "Read as relative minor" relabels a relative-major lick without moving notes) — [Data Model](./architecture/data-model.md), [Phrase System](./architecture/phrase-system.md), [music API](./api-reference/music.md), [state API](./api-reference/state.md). The minor ii-V-i templates play **ii-7b5 → V7(b9) → i-7**, a lick is offered/seeded/served only over progressions its own chord shape fits (greyed pills with a reason, picker and hydrate-time prune) — [Lick Alignment › Fit](./architecture/lick-alignment.md) — and minor cadence licks transpose tonic → tonality root in ear training — [Tonality System](./architecture/tonality-system.md).
>
> **Last major docs update: 2026-08-16** — synced the docs to the record-a-lick, swing, and enclosure-type work. **Record-a-lick** (`/licks/record`) got a real studio flow: a two-bar woodblock count-in with a phase-cue countdown, the kit entering on the bar-3 downbeat as the audible entrance cue, a scheduled-entrance capture (`rebaseToAnchor` — the new [capture-window](./api-reference/audio.md) section) and the same segmentation pipeline as ear training; the **quantizer** was rewritten around per-beat swing classification (swung eighths notate straight; a bar can mix swung pairs with a genuine triplet) and review playback follows the Swing knob, which now **defaults to 0.62**. The **metronome** sits under the music (`METRONOME_TRIM` 0.6 beneath the knob; knob default 0.5). **Ear training** reveals only the definitive replay score — the provisional live score no longer flashes first. **Enclosures** gained a chord-type axis (major/minor/dominant — three parallel mastery chains, per-type beds and tune-alignment qualities) and a real 5-bar drill figure with a pickup — [Trick Scoring](./architecture/trick-scoring.md), [Practicing Tricks](./tricks.md). Plus the SEO pass: a signed-out landing page, per-page titles/descriptions via `SeoHead`, a content sitemap, and the onboarding overlay confined to practice routes.
>
> **2026-08-08** — synced the developer docs to the ~160 commits since the tune pass. The big ones: the **backing-track engine** grew four styles at parity (swing, bossa nova, ballad, straight), a composed drum vocabulary with six classic jazz fills, an ensemble intensity arc, per-role microtiming and tempo-dependent swing, and a real signal path (split-kit panning, glue compressor, convolution room, offline bounce) — see [Audio](./api-reference/audio.md) and [Backing-track listening](./contributing/backing-listening.md). **Tricks** (parameterized melodic devices) landed with their own conformance/fluency scoring, an 8-stage triad-pair family ladder and quality-aware tune suggestions — [Trick Scoring](./architecture/trick-scoring.md). **Deep Practice** became continuous: worst-first key rotation by rolling score, a skipped demo once a key is proficient, and a ii-V turnaround joining the cycles — [State Management](./architecture/state-management.md). And the **deploy path** was rebuilt around an on-server release script with shared dependencies, self-cleaning failures, and an `/api/health` release-id check — [Tech Stack](./architecture/tech-stack.md).
>
> **2026-08-01** — synced docs to the **tune half of the app**, which had grown without documentation since the 2026-07-26 pass. New player-facing pages [Your Tunes](./tunes.md) and [Playing Over Tunes](./tune-practice.md) (both surfaced in `/docs` and bundled into the docs assistant's context); new [Tune System](./architecture/tune-system.md) developer doc covering flatten's two timelines, the five importers, engraving, progression detection, mastery-aware lick matching, and session planning. Also: `overview.md` reframed around three practice surfaces rather than two; the audio pipeline's five-tier re-articulation detection and band-limited metronome-bleed handling written up (user-facing and in the audio API reference); `PitchReading`'s four envelope/timbre fields documented; Tune and lick-practice types added to the data model; tune, tune-practice, console, and tour components added to the component reference; `tuneToAbc` and the chart/chord/ending layout modules added to the music reference; new guided tours for Tunes and Tune Practice. Corrected two stale claims: the app is installable but has **no service worker** (so no offline page loads), and the bleed filter has **no Settings toggle**.
>
> **2026-07-26** — the Tunes / Licks restructure (routes, storage, and nomenclature moved off "lead sheets"), the tune editor's entry rail, and the deploy/PWA overhaul.
>
> **2026-07-14** — entry-staff note selection (click a notehead or step with ←/→, then ↑/↓ / Backspace / `\`); the Side B end-of-lick score-hold + ii-V transition cue.
>
> **2026-06-23** — soprano sax as a first-class instrument; the Licks-page refocus on the user's own book; per-lick **Reset progress**; tighter Side B advancement gates (green ≥ 0.90, yellow 0.75–0.89, red < 0.75); Daily Practice mode; explicit `prog:*` opt-in; in-editor lick editing; history derive-on-write. Previous major update was 2026-05-09 (the rewrite-for-musicians pass).

## Quick Links

| Section | Description |
|---|---|
| [Getting Started](./getting-started.md) | For players: what the app does, what you need, your first session |
| [User Guide](./user-guide.md) | How to use the app: practice, your licks, progress, settings |
| [Your Tunes](./tunes.md) | For players: building a songbook — charting, importing, adopting |
| [Playing Over Tunes](./tune-practice.md) | For players: the scored session over a real form |
| [Practicing Tricks](./tricks.md) | For players: drilling melodic devices for fluency, not reproduction |
| [Development Setup](./contributing/contributing.md#development-setup) | For developers: prerequisites, install, first run, local Supabase stack |

### Architecture

| Document | Description |
|---|---|
| [Overview](./architecture/overview.md) | The three practice surfaces and how a phrase travels through the app |
| [Tech Stack](./architecture/tech-stack.md) | Technology choices and rationale |
| [Data Model](./architecture/data-model.md) | Core TypeScript types with field documentation |
| [Audio Pipeline](./architecture/audio-pipeline.md) | Playback, capture, detection, segmentation, re-articulation tiers |
| [Scoring Algorithm](./architecture/scoring-algorithm.md) | DTW alignment, pitch/rhythm scoring, grading |
| [Trick Scoring](./architecture/trick-scoring.md) | Conformance tiers, fluency weighting, per-device slot philosophy |
| [Phrase System](./architecture/phrase-system.md) | Catalog, generation, mutation, validation |
| [Tune System](./architecture/tune-system.md) | Tune model, flatten timelines, importers, engraving, progression detection, lick matching, session planning |
| [Lick Alignment](./architecture/lick-alignment.md) | Per-progression placement, `pickupBars`, tail extension, auto-inference |
| [Adaptive Difficulty](./architecture/adaptive-difficulty.md) | Algorithm, leveling (1-100), difficulty profiles |
| [Tonality System](./architecture/tonality-system.md) | Daily key/scale selection, progressive unlocking |
| [State Management](./architecture/state-management.md) | Svelte 5 runes, state modules, persistence |
| [Design System](./architecture/design-system.md) | Colour, type, domain accents, shared UI recipes |

### API Reference

| Document | Description |
|---|---|
| [Audio](./api-reference/audio.md) | audio-context, playback, capture, capture-window (pre-armed capture trims), pitch-detector/pitch-frame, onset-detector, note-segmenter, quantizer, metronome, and the whole backing-track engine (generation, styles, drum vocabulary, timing, mix/bus, bounce) |
| [Scoring](./api-reference/scoring.md) | alignment, pitch-scoring, rhythm-scoring, scorer, score-pipeline, fluency, grades |
| [Music](./api-reference/music.md) | scales, chords, keys, intervals, notation, tune-notation, chart/chord/ending layout, chord-symbol, transposition |
| [Phrases](./api-reference/phrases.md) | combiner, validator, library-loader, duplicate-detection, adopted-phrase-validator |
| [Difficulty](./api-reference/difficulty.md) | adaptive, params, lick-phase, level-signal, calculate, display |
| [State](./api-reference/state.md) | session, settings, progress, history, licks, lick-practice (+ rotation), tricks, step-entry, tune-entry, tune-community, tune-practice, tour state modules |
| [Components](./api-reference/components.md) | All Svelte components, by domain |

### Contributing

| Document | Description |
|---|---|
| [Contributing Guide](./contributing/contributing.md) | Workflow, branch naming, PR process, code style |
| [Adding Licks](./contributing/adding-licks.md) | Step-by-step guide to adding curated licks |
| [Adding Scales](./contributing/adding-scales.md) | Extending the scale catalog |
| [Testing Guide](./contributing/testing-guide.md) | The four suites, test patterns, mocking audio, writing new tests |
| [Backing-track Listening](./contributing/backing-listening.md) | The listening lab, milestone protocol, and committed engine artifacts |

### Reference

| Document | Description |
|---|---|
| [Glossary](./reference/glossary.md) | Jazz, audio, and technical terminology |
| [Algorithm Details](./reference/algorithm-details.md) | DTW math, spectral flux, McLeod pitch method |
| [Browser Compatibility](./reference/browser-compatibility.md) | Web Audio API support, PWA, mobile caveats |
| [Scale & Lick Catalog](./reference/scale-and-lick-catalog.md) | All 33 scales + ~538 lick catalog (452 curated + ~86 combinatorial) with metadata |

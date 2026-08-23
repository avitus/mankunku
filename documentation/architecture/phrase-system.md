# The Lick Catalog

Mankunku ships with a catalog of about 920 jazz phrases, spread across many harmonic categories. This page covers what's in the catalog, where each piece comes from, what the categories mean musically, and how the catalog handles transposition so a lick stays on your horn no matter what key the day is in.

## What's in the catalog

There are three sources of musical content:

- **Hand-written licks (452 of them).** Curated phrases, written for the app, organized by category. These are the bulk of what you encounter on Side A.
- **Combinatorial licks (~470).** Built by pairing a set of *scale patterns* (pitch sequences like "ascending pentatonic 5-note") with a set of *rhythm templates* (durations like "syncopated eighth-note run"). See [the combinatorial generator](#the-combinatorial-generator) below.
- **Your own licks.** Anything you write in the editor (`/licks/editor`) or record (`/licks/record`) joins your book tagged as user content. They behave the same as curated licks — searchable, tag-able for Side B, transposable to any key.

Every phrase Side A plays comes from this one catalog — there is no separate runtime generator to choose between.

## The categories

Each lick belongs to one harmonic category. Categories tell the app what context the lick *expects* — what chord or progression it's designed to fit over. They also tell you, the player, what kind of vocabulary you're drilling.

The counts below are aggregate totals across the whole curated set (`ALL_CURATED_LICKS`), so they include the combinatorial licks, which carry the category of the melodic shape they were built from rather than a category of their own.

| Category | What it is | Approximate count |
|---|---|---|
| **Blues** | 12-bar blues vocabulary. Major-blues and minor-blues licks, blue notes (the b5), call-and-response shapes. | 257 |
| **Pentatonic** | Pentatonic-based vocabulary that works over multiple harmonic contexts. | 160 |
| **ii-V-I Major** | The signature jazz cadence (Dm7 → G7 → Cmaj7 in C). Different rhythmic shapes, different melodic strategies — chord-tone arpeggios, scale runs, enclosures. | 120 |
| **ii-V-I Minor** | The minor counterpart (Dm7b5 → G7alt → Cm7 in C minor — keyed by the TONIC, `mode: 'minor'`; the lick-practice template plays the V as G7b9). Altered-dominant lines, melodic-minor color. | 83 |
| **Bebop Lines** | Long lines in the bebop vocabulary. Bebop scale runs, chromatic approaches, characteristic shapes from Bird, Dizzy, Bud Powell. | 79 |
| **Short ii-V-I Major** | Compact two-bar ii-V-I major cells. | 60 |
| **Short ii-V-I Minor** | Compact two-bar ii-V-I minor cells. | 57 |
| **Digital Patterns** | Numbered-pattern vocabulary (1-2-3-5, etc.) that sequences through the changes. | 28 |
| **Modal** | Sustained-mode vocabulary (Dorian, Mixolydian, Lydian) for static-harmony tunes — *So What*, *Impressions*, *Maiden Voyage* territory. | 27 |
| **Major Chord** | Single-chord major vocabulary — arpeggios and scale color over one maj7 chord. | 14 |
| **Enclosures** | Chromatic enclosure figures that wrap a target chord tone from above and below. Written-out examples; to drill the *device* rather than a fixed figure, see [Tricks](../tricks.md). | 11 |
| **Rhythm Changes** | The Gershwin "I Got Rhythm" cycle — I-vi-ii-V repeating. The bebop test for technical command at speed. | 7 |
| **Ballad** | Slower, more lyrical phrases with sustained notes and space. | 7 |
| **V-I Major** | Dominant-to-tonic resolutions in major. | 3 |
| **Dominant Chord** | Single-chord dominant vocabulary over one 7 chord. | 3 |
| **Minor Chord** | Single-chord minor vocabulary over one min7 chord. | 3 |
| **V-I Minor** | Dominant-to-tonic resolutions in minor. | 2 |
| **Diminished Chord** | Single-chord diminished vocabulary over one dim7 chord. | 2 |

Counts are approximate and will drift as licks are added.

The **beginner cells** aren't a category of their own. They're an on-ramp subset — 55 two- and three-note minimal cells for difficulty levels 1–5 (pentatonic intervals, blues fragments, neighbor-tone patterns) — filed under the existing **Pentatonic** (45) and **Blues** (10) categories, and already included in the totals above.

On top of the curated set there's **user** content (yours), filed under the `user` category (labeled "Uncategorized") rather than one of the harmonic categories above, and carrying a `user-entered` or `user-recorded` source.

The category label drives two things: which Side B progression types the lick can run over (a `ii-V-I-major` lick fits ii-V-I major progressions naturally), and which Side A filter the lick shows up under.

## How the catalog knows everything is in C

This is a quiet but important design decision: every curated lick in the catalog is stored in **concert C**. The Cmaj7 lick is written with the root on a literal C; the Dorian lick is written starting on a literal D over a Dm7 context that's actually D Dorian (the second mode of C major). When you practice in F or Eb or B, the app **transposes** the lick at runtime to your active key.

Storing in C makes a few things much easier:

- **There's only one version of each lick.** Adding a new lick means writing it once in C, not twelve times.
- **Transposition is a single operation.** Shift every note's MIDI number by the interval from C to your target key, shift the chord roots by the same interval, and the lick is in your target key.
- **Octave centering** can keep the result on your horn (more on this below).

"Stored in C" means stored on the TONIC: minor licks are C minor (`mode: 'minor'`), never Eb major. User-entered licks are the exception — they keep the concert key (and mode) they were entered in. The rule also applies to the combinatorial generator. It works in C and the same transposition pipeline carries the result to your active key.

## Octave centering — keeping licks on the horn

Naive transposition has a problem: a C lick that sits comfortably between G4 and G5 will, when transposed to B, sit between F#5 and F#6 — too high for many tenors. Transposed to F# instead it sits between C#4 and C#5, near the bottom of the range.

The app handles this with **octave centering**. After transposing to the target key, the app evaluates octave shifts (-3 to +3) and picks the one that:

1. **Maximizes notes inside the comfortable range** (MIDI 60–75, roughly C4 to Eb5 — the heart of tenor sax range).
2. **Tiebreaker:** keeps the average pitch closest to the middle of that range.

The result: a lick transposed to B doesn't end up in stratospheric tenor territory. It's pulled down an octave automatically. The same logic on the other end keeps a lick from dropping into the basement when transposed to F#.

You can override the comfortable range in Settings ("Highest note") so the app respects your actual range — useful if you're playing alto or trumpet, both of which sit higher than tenor.

## Tonality-aware transposition

For practice sessions, the transposition logic gets one more layer of nuance. Different scale types have different parent-key relationships:

- **Major modes with multi-chord progressions** (ii-V-I, turnarounds, rhythm changes) transpose to the **parent major key**. So an A Dorian ii-V-I doesn't transpose so the lick literally starts on A — it transposes to G major, the parent of A Dorian, so the chord progression Am7 → D7 → Gmaj7 still works as a real ii-V-I.
- **Minor cadence licks** (`lickMode` minor + a progression category — the curated ii-V-i, short ii-V, V-i minor files) are keyed by their TONIC, not the parent major, so they transpose **tonic → tonality root** under any minor tonality (minor, Dorian, melodic minor) and are never snapped: the lick's own harmony is the context. Before this rule a C-minor ii-V-i under a "D minor" daily tonality was hopped to F minor (parent F major) and labelled D.
- **Major modes with single-chord licks** transpose directly to the modal root. A Dorian lick over Dm7 transposes so it starts on D.
- **Non-major scales** (blues, pentatonic, melodic minor, harmonic minor) transpose to the key, then **snap any out-of-scale notes to the nearest scale tone**, preferring flats when equidistant. This handles the case where a chromatic passing tone in the original would land on a sharp seventh in the new key — the snap nudges it to the actual scale member.

You don't have to think about any of this while you play. It happens automatically when the daily key changes or when you switch scale types in settings.

## The combinatorial generator

Most of the catalog is built rather than hand-written. A **scale pattern** is a melodic shape written as scale degrees — "1-3-5", "5-4-3-2-1", the descending bebop dominant scale — and a **rhythm template** is a bar of timing slots with no pitches. Pair one of each and you get a phrase.

The pairing rules are what keep the results musical:

- **The shape must fill the bar exactly.** A shape either matches the template's note count, or it fits a whole number of times (twice or three times) and is laid end-to-end. A partial fit is refused — truncating or padding a melodic idea reads worse than emitting nothing.
- **Repetitions may be sequenced.** When a shape repeats, each pass can sit a scale step above or below the last. That's the ordinary jazz sequence — "1-2-3, 2-3-4" — and it's what makes a listener hear a repeat as musical rather than as padding. Three passes is the cap; past that the bar is a drill, not a lick.
- **Scale families must be compatible.** A pentatonic shape won't be realized against a bebop scale, so you never get a shape stretched over a pool it wasn't written for.
- **Sequences that run off the end of the MIDI realization pool (36–96) are dropped**, not clamped. Fitting the result to your horn is octave centering's job, further down.

Difficulty is then computed from the finished phrase, so a generated lick sits in the same difficulty scale as a hand-written one and is gated the same way.

Every category Side A can draw from is required to have melodic shapes backing it — a test asserts that join, because a category with no shapes produces a session that silently falls through to a wider pool.

## Adding your own licks

Two ways to add licks to your book:

**The editor** at `/licks/editor`. Pick a duration (whole, half, quarter, eighth, sixteenth, with triplet and dotted toggles), pick a pitch (with sharp/flat/natural), and the cursor advances. Add rests, set the bar count (1–4 bars), pick a name and a category. Any already-entered note can be selected — click its notehead or arrow-key to it (←/→) — and pitch-shifted (↑/↓), deleted (Backspace/Delete), or re-spelled (`\`) in place without retyping the rest. Notes are entered in your **written** pitch — what you'd see on your chart — and the app converts to concert pitch internally on save.

**Record** at `/licks/record`. Play a phrase on your horn, the app captures the audio, runs the pitch detector and onset detector across it, and produces a transcription. Useful for capturing something you just figured out by ear.

Either way, your lick:

- Joins your book with a `user` source.
- Can be tagged for Side B's 12-key drill.
- Can be transposed to any key like any curated lick.
- Counts toward your progress when you practice it.
- Stays on your local device (in `localStorage`), and syncs to the cloud if you're signed in.

## How licks are written under the hood (a peek)

If you're curious: each lick is a structured object with the following pieces:

- **Notes** — a sequence of pitches and rhythms. Pitches are MIDI numbers; rhythms are *fractions* like `[1, 8]` (eighth note) or `[1, 12]` (triplet eighth). Using fractions instead of decimals avoids the floating-point errors that show up when you try to express a triplet as `0.0833...`.
- **Harmony** — a sequence of chord segments, each with a chord (root + quality like `min7`, `7`, `maj7`) and a scale (like `major.dorian`).
- **Difficulty** — a level number, plus separate pitch-complexity and rhythm-complexity ratings.
- **Category, tags, name, key** — the metadata that helps the app organize and surface the lick.

You don't need to know any of this to use the app. It only matters if you're contributing licks at the source-code level (which is a developer task, not a user task).

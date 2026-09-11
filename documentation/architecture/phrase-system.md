# The Lick Catalog

Mankunku ships with a catalog of about 920 jazz phrases, spread across many harmonic categories. This page covers what's in the catalog, where each piece comes from, what the categories mean musically, and how the catalog handles transposition so a lick stays on your horn no matter what key the day is in.

## What's in the catalog

There are three sources of musical content:

- **Hand-written licks (452 of them).** Curated phrases, written for the app, organized by category — just under half of what Side A can play you.
- **Combinatorial licks (471).** Built by pairing a set of *scale patterns* (pitch sequences like "ascending pentatonic 5-note") with a set of *rhythm templates* (durations like "syncopated eighth-note run"). See [the combinatorial generator](#the-combinatorial-generator) below.
- **Your own licks.** Anything you write in the editor (`/licks/editor`) or record (`/licks/record`) joins your book tagged as user content. They behave the same as curated licks — searchable, tag-able for Side B, transposable to any key.

Every phrase Side A plays comes from this catalog or your own book (licks you wrote, recorded or adopted) — there is no separate runtime generator to choose between.

## The categories

Each lick belongs to one harmonic category. Categories tell the app what context the lick *expects* — what chord or progression it's designed to fit over. They also tell you, the player, what kind of vocabulary you're drilling.

The counts below are totals across the whole catalog, so they include the combinatorial licks, which carry the category of the melodic shape they were built from rather than a category of their own. Categories marked *(minor)* are minor-key vocabulary: those licks are stored in C minor and labelled as minor keys (*Dm*, *Gm* …) wherever they appear.

| Category | What it is | Approximate count |
|---|---|---|
| **Blues** | 12-bar blues vocabulary. Major-blues and minor-blues licks, blue notes (the b5), call-and-response shapes. | 257 |
| **Pentatonic** | Pentatonic-based vocabulary that works over multiple harmonic contexts. | 160 |
| **ii-V-I Major** | The signature jazz cadence (Dm7 → G7 → Cmaj7 in C). Different rhythmic shapes, different melodic strategies — chord-tone arpeggios, scale runs, enclosures. | 120 |
| **ii-V-I Minor** *(minor)* | The minor counterpart (Dø7 → G7alt → C-7 in C minor; the Lick Practice backing plays the V as G7♭9). Altered-dominant lines, melodic-minor color. | 83 |
| **Bebop Lines** | Long lines in the bebop vocabulary. Bebop scale runs, chromatic approaches, characteristic shapes from Bird, Dizzy, Bud Powell. | 79 |
| **Short ii-V-I Major** | Compact two-bar ii-V-I major cells. | 60 |
| **Short ii-V-I Minor** *(minor)* | Compact two-bar ii-V-I minor cells. | 57 |
| **Digital Patterns** | Numbered-pattern vocabulary (1-2-3-5, etc.) that sequences through the changes. | 28 |
| **Modal** | Sustained-mode vocabulary (Dorian, Mixolydian, Lydian) for static-harmony tunes — *So What*, *Impressions*, *Maiden Voyage* territory. | 27 |
| **Major Chord** | Single-chord major vocabulary — arpeggios and scale color over one maj7 chord. | 14 |
| **Enclosures** | Chromatic enclosure figures that wrap a target chord tone from above and below — fixed figures, all built by the combinatorial generator. To drill the *device* rather than a fixed figure, see [Tricks](../tricks.md). | 11 |
| **Rhythm Changes** | The Gershwin "I Got Rhythm" cycle — I-vi-ii-V repeating. The bebop test for technical command at speed. | 7 |
| **Ballad** | Slower, more lyrical phrases with sustained notes and space. | 7 |
| **V-I Major** | Dominant-to-tonic resolutions in major. | 3 |
| **Dominant Chord** | Single-chord dominant vocabulary over one 7 chord. | 3 |
| **Minor Chord** *(minor)* | Single-chord minor vocabulary over one min7 chord. | 3 |
| **V-I Minor** *(minor)* | Dominant-to-tonic resolutions in minor. | 2 |
| **Diminished Chord** | Single-chord diminished vocabulary over one dim7 chord. | 2 |

Counts are as of this writing (923 in all: 452 hand-written, 471 combinatorial) and will drift as licks are added. Minor vocabulary isn't confined to the marked categories: most of the Modal licks (the Dorian and Aeolian lines) and some Pentatonic ones sit over a minor chord and read as minor too.

The **beginner cells** aren't a category of their own. They're an on-ramp subset — 55 two- and three-note minimal cells for difficulty levels 1–5 (pentatonic intervals, blues fragments, neighbor-tone patterns) — filed under the existing **Pentatonic** (45) and **Blues** (10) categories, and already included in the totals above.

On top of the catalog there's your own content: a recorded lick starts out as *Uncategorized*, and one written in the editor is Uncategorized until you pick one of the categories above in its Details.

The category label drives two things: which Side B progressions a lick is tagged for when you set its category (a ii-V-I Major lick gets the ii-V-I major progressions its own changes fit), and which Side A sessions the lick shows up in.

## How the catalog knows everything is in C

This is a quiet but important design decision: every curated lick in the catalog is stored in **concert C**. The Cmaj7 lick is written with the root on a literal C; the Dorian lick is written starting on a literal D over a Dm7 context that's actually D Dorian (the second mode of C major). When you practice in F or Eb or B, the app **transposes** the lick at runtime to your active key.

Storing in C makes a few things much easier:

- **There's only one version of each lick.** Adding a new lick means writing it once in C, not twelve times.
- **Transposition is a single operation.** Shift every note's MIDI number by the interval from C to your target key, shift the chord roots by the same interval, and the lick is in your target key.
- **Octave centering** can keep the result on your horn (more on this below).

"Stored in C" means stored on the tonic: minor licks are C minor, never E♭ major. Your own licks are the exception — they keep the key (and the Major | Minor reading) they were entered in. The rule also applies to the combinatorial generator. It works in C and the same transposition pipeline carries the result to your active key.

## Octave centering — keeping licks on the horn

Naive transposition has a problem: a lick that sits comfortably in the middle of your horn, moved up by a seventh to reach a new key, lands a seventh higher — up where many players can't go. Moved the other way it can drop to the bottom of the range.

The app handles this with **octave centering**. After transposing to the target key, the app tries shifting the whole lick up or down by octaves (up to three either way) and picks the placement that:

1. **Fits the most notes inside your range** — from your instrument's lowest note up to the **Highest** note set on the Settings page.
2. **Tiebreaker:** keeps the average pitch closest to the middle of that range.

The result: a lick moved to a high key doesn't end up in stratospheric territory — it's pulled down an octave automatically — and the same logic on the other end keeps a lick from dropping into the basement. Any single note still above your Highest note after that is dropped an octave on its own.

Set **Highest** to the top note you actually play and the app respects it; lower it for a beginner, raise it if you have altissimo.

## Tonality-aware transposition

For practice sessions, the transposition logic gets one more layer of nuance. Different scale types have different parent-key relationships:

- **Major modes with multi-chord progressions** (ii-V-I, turnarounds, rhythm changes) transpose to the **parent major key**. So an A Dorian ii-V-I doesn't transpose so the lick literally starts on A — it transposes to G major, the parent of A Dorian, so the chord progression Am7 → D7 → Gmaj7 still works as a real ii-V-I.
- **Minor cadence licks** (the ii-V-i, short ii-V-i and V-i minor vocabulary) are written from their tonic, not the parent major, so they move **tonic → the session's root** under any minor-flavoured tonality (minor, Dorian, melodic minor) and are never snapped: the lick's own harmony is the context. A C-minor ii-V-i in a D minor session is played in D minor.
- **Major modes with single-chord licks** transpose directly to the modal root, then snap any note that falls outside the mode to the nearest scale tone. A Dorian lick over Dm7 transposes so it starts on D.
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

**The editor** at `/licks/editor`. Pick a duration (whole, half, quarter, eighth, sixteenth, with triplet and dotted toggles), pick a pitch (with sharp/flat/natural), and the cursor advances. Add rests, set the key, Major or Minor, and the bar count (1–4 bars), pick a name and a category. Any already-entered note can be selected — click its notehead or arrow-key to it (←/→) — and pitch-shifted (↑/↓), deleted (Backspace/Delete), or re-spelled (`\`) in place without retyping the rest. Notes are entered in your **written** pitch — what you'd see on your chart — and the app converts to concert pitch internally on save.

**Record** at `/licks/record`. Play a phrase on your horn, the app captures the audio, runs the pitch detector and onset detector across it, and produces a transcription. Useful for capturing something you just figured out by ear.

Either way, your lick:

- Joins your book (the Licks page), marked as yours.
- Can be tagged for Side B's 12-key drill.
- Can be transposed to any key like any curated lick.
- Counts toward your progress when you practice it.
- Stays on your local device (in `localStorage`), and syncs to the cloud if you're signed in — which also shares it with other players under *Browse Community*.

## How licks are written under the hood (a peek)

If you're curious: each lick is a structured object with the following pieces:

- **Notes** — a sequence of pitches and rhythms. Pitches are MIDI numbers; rhythms are *fractions* like `[1, 8]` (eighth note) or `[1, 12]` (triplet eighth). Using fractions instead of decimals avoids the floating-point errors that show up when you try to express a triplet as `0.0833...`.
- **Harmony** — a sequence of chord segments, each with a chord (root + quality like `min7`, `7`, `maj7`) and a scale (like `major.dorian`).
- **Difficulty** — a level number, plus separate pitch-complexity and rhythm-complexity ratings.
- **Category, tags, name, key** — the metadata that helps the app organize and surface the lick.

You don't need to know any of this to use the app. It only matters if you're contributing licks at the source-code level (which is a developer task, not a user task).

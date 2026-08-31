# Levels & Difficulty

Mankunku tracks difficulty on a 1–100 scale — but not as one global number. Your level is tracked **per scale type and per key**: a proficiency in Blues, a proficiency in Dorian, a proficiency in the key of Eb, and so on. Those proficiencies are what decide which licks the app feeds you and which keys and scales unlock next.

This page explains how a proficiency climbs, what it gates, and what each tier of the difficulty curve actually adds musically.

## How a proficiency adjusts

The app keeps a rolling window of your last 25 attempts in each scale type (and separately in each key). After each ear-training attempt:

- **If your average accuracy across those 25 attempts is ≥ 85%**, that proficiency ticks up by 1.
- **If your average accuracy is < 50%**, it ticks down by 1.
- **Between 50% and 85%**, it holds. The app has decided you're at the right level for now.

There's a 10-attempt cooldown between adjustments — once a proficiency moves, it can't move again until you've played 10 more phrases. This prevents the level from oscillating on a noisy day.

The window of 25 is long enough to smooth out lucky guesses and unlucky stumbles. A single Try Again won't drop your level; a string of them across two or three sessions will.

When a proficiency moves, a small cue flashes under the ear-training status line: *↑ Blues · Lv 23*. That's the system telling you it's noticed.

## What proficiency gates

Three things, all of them the real levers of difficulty:

1. **The phrase pool.** Ear training admits licks whose difficulty rating is at or below your proficiency in the active scale, then filters for scale fit and shuffles. As your Blues proficiency climbs, harder blues licks surface.
2. **Key unlocks.** New keys open around the circle of fifths when their prerequisite key reaches a set level — G and F need C at 10; the last keys (Db, F#) need their neighbours at 15. See [The Daily Key](./tonality-system.md).
3. **Scale unlocks.** New scale types open when their prerequisites are met — Dorian needs Minor Pentatonic at 20, Altered needs Melodic Minor at 40, and so on.

The **Keys & Scales** card on the Progress page shows this frontier directly: how many of the 12 keys and 12 scale types you've unlocked, and exactly what the next unlock requires.

## Lick ratings and content tiers

Every lick carries its own difficulty rating (1–100), computed from its pitch demands (chromaticism, range, interval leaps) and rhythm demands (density, syncopation, tuplets). The app groups these ratings into ten **content tiers** describing how difficulty opens up — which scale families come into play, which rhythms, what tempos and keys, and how many notes a phrase may run to.

How that reaches you differs by mode. On **Side A**, the tier table is a description rather than a selector: harder material surfaces as your proficiency climbs, but nothing consults the tier directly. **Tricks** do read the tier — the profile for your level sets the rhythms, interval span and note counts a generated example may use.

Roughly:

| Tier | Levels | What's in it |
|---|---|---|
| **1** | 1–5 | Major modes only. Quarter notes, no swing, no syncopation. 1-bar phrases at 60–80 BPM. Keys: C, F, G. Roots and 5ths only — small interval leaps. |
| **2** | 6–12 | Adds pentatonic. Still quarter notes. 1 bar, 60–90 BPM. Adds D and Bb. Slightly wider intervals. |
| **3** | 13–20 | Adds eighth notes and swing. 1–2 bars, 70–100 BPM. Adds Eb, A. |
| **4** | 21–30 | Adds blues. Syncopation enters. 1–2 bars, 80–120 BPM. All 12 keys. |
| **5** | 31–40 | Adds bebop scales and approach notes. Triplets enter. 2 bars, 90–140 BPM. |
| **6** | 41–52 | Adds melodic minor modes. Wider intervals (up to an octave). 2 bars, 100–160 BPM. |
| **7** | 53–65 | Adds harmonic minor modes. Sixteenth notes enter. 2–4 bars, 120–180 BPM. Bebop lines proper. |
| **8** | 66–78 | Adds symmetric scales (whole-tone, diminished). Mixed durations across the bar. 2–4 bars, 140–200 BPM. |
| **9** | 79–90 | Same scale palette as tier 8. Wider intervals (up to a major tenth). 2–4 bars, 160–240 BPM. |
| **10** | 91–100 | All limits relaxed. 4 bars at 180–300 BPM. Two-octave leaps possible. The vocabulary of advanced bebop and post-bop. |

Every tier above tier 1 also raises the **interval ceiling** — the largest leap allowed between two consecutive notes — and the **rhythm density**, which controls how many notes fit per bar. So tier 4 isn't just "tier 1 plus syncopation"; the average note count per bar goes up, the average interval goes up, and the tempo range opens.

## What you'll see on the Progress page

- **Tonal Mastery** — your average proficiency across all 12 scale types and all 12 keys, with never-attempted slots counted as zero. It climbs slowly by design: ground you've never covered counts against the average until you cover it. The trend chart plots this single line over time. Snapshots are forward-filled, so a lick-practice-only day inherits the prior day's value rather than dropping to zero.
- **Scale Proficiency** — your level in each scale you've practiced. Tap a scale to expand its level-over-time chart.
- **Keys & Scales** — the unlock frontier: keys and scales unlocked out of 12, plus what the next unlock requires.

Watch the slope, not the noise. Single sessions vary; the rolling window smooths most of that out, but a bad night can still nudge the line. The trend over a week is the reliable signal.

## A note on the old "level" number

Earlier versions showed a single global level — the average of a "pitch complexity" and a "rhythm complexity" that ratcheted up as you practiced accurately. That system was retired: nothing consumed its output once phrase selection moved to per-scale proficiency, so the number could only climb to 100 and sit there, telling you how much you'd practiced rather than how well you play. Per-scale and per-key proficiency — which can fall as well as rise, and which actually gate content and unlocks — are the numbers that mean something.

# Levels & Difficulty

Mankunku has a level system that runs from 1 to 100. The number you see on your dashboard reflects how complex the material the app is currently feeding you is — not how good a musician you are in any absolute sense, just where the practice is meeting you on the difficulty curve.

This page explains what the level represents, how it climbs as you improve, and what each tier of the curve actually adds musically.

## What the level number means

Your level is the average of two underlying numbers, both also on a 1–100 scale:

- **Pitch complexity** — how chromatic, how wide-ranging, and how pitch-demanding the lines you're working on are.
- **Rhythm complexity** — how dense, how syncopated, and how rhythmically demanding the lines are.

A pitch-complexity of 35 paired with a rhythm-complexity of 35 gives you a level of 35. Strong rhythm but weak pitch (rhythm 60, pitch 20) gives you a level of 40 — and importantly, the underlying numbers stay separate. The next phrase the app generates can keep the rhythm at level 60 while pitching the melody at level 20, so you keep getting clean wins in pitch while the rhythm keeps challenging you.

This is the central design choice: pitch and rhythm advance **independently**. If you've been a strong rhythm player your whole life but you're working on hearing fast bebop lines, the rhythm complexity stays high while the pitch complexity climbs at its own pace. The reverse holds too.

## How the level adjusts

The app keeps a rolling window of your last 25 attempts in each dimension. After each attempt:

- **If your average pitch accuracy across those 25 attempts is ≥ 85%**, pitch complexity ticks up by 1.
- **If your average pitch accuracy is < 50%**, pitch complexity ticks down by 1.
- **Between 50% and 85%**, pitch complexity holds. The app has decided you're at the right level for now.
- **The same logic runs independently** for rhythm complexity.

There's a 10-attempt cooldown between adjustments per dimension — so once pitch complexity moves, it can't move again until you've played 10 more phrases. This prevents the level from oscillating on a noisy day.

The window of 25 is long enough to smooth out lucky guesses and unlucky stumbles. A single Try Again won't drop your level; a string of them across two or three sessions will.

## What each level tier adds musically

The app groups levels into ten **content tiers**. Each tier expands what's available — what scales the algorithmic generator can use, what rhythms it can produce, what tempos it'll target, what keys it'll choose. Curated licks from the library are stamped with their own complexity rating, so as your level climbs, more challenging library material starts showing up.

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

## Why pitch and rhythm should diverge — but often don't

In theory, pitch and rhythm complexity are independent dimensions. In practice, they tend to climb together. Here's why, and what to do about it:

- **The current scoring algorithm penalizes missed and extra notes equally in both dimensions.** A note you skipped becomes a 0 in pitch *and* a 0 in rhythm, even though it's really a timing-and-detection failure. So two scores tend to move together more than they would if the underlying problem were really pitch-specific or rhythm-specific.
- **Curated phrases don't deliberately stress one dimension.** A lick at level 50 has a single difficulty number, copied to both pitch and rhythm complexity for the generator and used as the cap for library filtering. The library doesn't say "this lick has hard pitch but easy rhythm" or vice versa, so the inputs to your two accuracy windows are correlated.
- **The cap is the same on both sides** (≥ 85% advances, < 50% retreats), so even when the inputs *are* slightly different, the advancement rule treats them the same way.

If you inspect your pitch and rhythm complexity numbers and they track nearly together, that's the reason. The system *will* let them diverge — there's a worked example below — but in normal usage they don't pull apart by much.

The takeaway: **the level number is your best single summary of where you are**, but the two underlying numbers are useful when they *do* diverge. If you see your rhythm complexity climbing faster than your pitch complexity, the app is telling you to spend more practice time on hearing pitch (slow tonal exercises, scale work, transcription). If pitch is outpacing rhythm, focus on the metronome.

## A worked example of divergence

Suppose you can play perfect time but you've never trained your ear: you respond to every phrase with a single note (C, all eighth notes, perfectly in time, regardless of what the app played). Over many attempts:

- Your pitch accuracy hovers near 25% (you happen to be right when the phrase starts and ends on C, wrong otherwise).
- Your rhythm accuracy is near 100% (you're playing perfect eighth notes — the alignment finds rhythmic matches even when pitches are wrong).

The system reads this correctly: rhythm complexity climbs steadily while pitch complexity stays at 1. The displayed level rises slowly as the average of (1, climbing rhythm). Over the course of hundreds of attempts, the rhythm number could end up at 100 while the pitch number is still floored at 1.

Real practice doesn't usually look this extreme — but the machinery is built to handle it.

## What you'll see on the Progress page

The trend chart on the Progress page plots a single line — **Tonal Mastery**, your average proficiency across the 12 scale types and 12 keys (0–100). Snapshots are forward-filled, so a lick-practice-only day inherits the prior day's value rather than dropping to zero.

Pitch and rhythm complexity are deliberately *not* plotted here. They measure how hard the generated material is, not how well you play — they move on their own schedule and would read as progress when they aren't.

Watch the slope, not the noise. Single sessions vary; the rolling window smooths most of that out, but a bad night can still nudge the line. The trend over a week is the reliable signal.

The chart is daily for short periods and grouped by week or month for longer ranges. Each point is a point-in-time snapshot, not an average of the period.

## The relationship between level and proficiency

A subtle distinction worth knowing:

- **Level (1–100)** is a content-difficulty number. It controls what the app feeds you.
- **Per-key proficiency** and **per-scale proficiency** are separate trackers used by the unlocking system in [The Daily Key](./tonality-system.md). They count attempts and accuracy *per key* and *per scale type*.

Your level can be 50 while your D Mixolydian proficiency is much lower (you just unlocked Mixolydian and haven't played in D Mix yet). Conversely, your overall level can be modest while your C Major proficiency is high (you've put a lot of clean reps into C Major specifically). The two systems live alongside each other — level steers difficulty, proficiency steers unlocks.

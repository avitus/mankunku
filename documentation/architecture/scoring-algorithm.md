# How Scoring Works

After every phrase you play back, the app gives you a percentage and a grade. This page explains what the score actually measures, what gets rewarded, what gets forgiven, and where the boundaries of "Great" and "Try Again" sit.

## The headline numbers

| Number | What it measures |
|---|---|
| **Pitch accuracy** | How many of the right notes you played, with a small bonus for being in tune. |
| **Rhythm accuracy** | How close to the written rhythm your notes landed. |
| **Overall** | `pitch × 0.60 + rhythm × 0.40`. |
| **Grade** | A label assigned from the overall percentage. |

Pitch is weighted more heavily than rhythm — 60/40 — because in practice it's harder to hit the right note than the right beat. Most beginners can rush a beat and still play the right pitch; getting the wrong pitch (especially on a fast line over changing harmony) is the larger ear-training challenge. The 60/40 split is also what most reasonable jazz teachers would say if you asked them to grade a transcription.

## The grades

| Grade | Threshold | What it means |
|---|---|---|
| **Perfect** | ≥ 95% | Right in the pocket. Move on. |
| **Great** | ≥ 85% | Cookin'. The phrase is solidly in your ear. |
| **Good** | ≥ 70% | Swinging along. You passed — the next phrase is queued up. |
| **Fair** | ≥ 55% | Off the changes here and there. The same phrase will retry. |
| **Try Again** | < 55% | Take it again from the top. |

The pass line is **70%**. At that threshold the app moves you on. Below it, the same phrase replays so you can take another swing. The grades themselves don't gate anything — the threshold for moving on is fixed.

Each grade picks one of about ten captions from a pool, mixing Blue Note one-liners with quotes from the giants of the genre — so the feedback stays fresh across a session.

## How the app aligns what you played with what was written

Your playback won't be note-for-note identical to the original. You might be a beat behind. You might drop a note. You might add an extra one. You might play the whole thing slightly late (which is normal — there's a fraction of a second of human reaction time built into the loop).

The app handles this with a flexible alignment. The expected notes and the detected notes are paired up the way two transcribers would compare takes: each note in the original is matched to the closest detected note in time and pitch, allowing for missed notes (you didn't play it) and extra notes (you played something not in the original). The math behind it is called Dynamic Time Warping — it's the same idea used in speech recognition to match words against an audio file when the speaker pauses or rushes.

What this means for you, in plain terms:

- **You can be a little late.** A beat or so off and the alignment still finds the match.
- **You can be a little early.** Same.
- **You can play in a different octave** if "octave-insensitive" is on (it's on for Side B's continuous mode, which assumes you might transpose a lick to keep it on the horn). Side A is strict about the octave.
- **Missed notes don't ruin everything else.** If you skip note 3, the app still tries to match notes 4, 5, and 6 against their counterparts. It just docks you for the missed one.
- **Extra notes don't ruin everything else.** If you add an extra grace note, the alignment treats it as an extra and grades the rest against the original.

## Pitch accuracy, note by note

Each note in the original gets a pitch score:

- **Right pitch** → 1.0 (with a small in-tune bonus, up to about +0.10, that maxes out at zero cents off).
- **Wrong pitch** → 0.
- **Rest** → 1.0 automatically (you correctly played silence).
- **Missed note** (the alignment found nothing matching it) → 0.

The bonus for tuning is small on purpose — it tips ties on otherwise correct notes, but a slightly out-of-tune correct note still beats a perfectly-tuned wrong note by a wide margin.

The pitch accuracy you see is the average across all the original notes.

## Rhythm accuracy, note by note

Each note's rhythm score depends on how close to the written beat it landed, scaled by the tempo.

- Land on the beat → score near 1.0.
- The further off, the lower the score.
- Rests → 1.0 automatically.
- The tolerance is **looser at slow tempos and tighter at fast ones**: at 60 BPM the score doesn't fall to zero until you're more than a full beat off; at 200 BPM the same fraction of a beat is a much tighter window in absolute time, so the curve is steeper. This is intentional — the same fraction-of-a-beat error feels "tight" at 200 BPM and "very loose" at 60.

### Latency correction

Every player — and every microphone — has a fraction of a second of constant delay. The app measures the median offset across all your matched notes and subtracts it before scoring. So if you played the whole phrase 80 ms late, the app absorbs the 80 ms and only judges your *relative* timing between notes. You don't get docked for reaction time.

### Swing

If the metronome is set to swing and the original phrase has off-beat eighth notes, the expected position of those off-beats shifts to match a triplet feel. You won't get rhythmically dinged for swinging when you're supposed to swing.

## Why missing or adding a note hurts both pitch *and* rhythm

This is worth knowing because it explains some "harsh" scores.

When the alignment marks a note as **missed** or **extra**, the app counts it as a zero in *both* pitch accuracy and rhythm accuracy — for that one note. The reasoning is mechanical (a missed note has no pitch and no timing to score), but the effect is that drops and additions punch a bigger hole in your overall percentage than a wrong-note-played-on-time does.

The practical takeaway: it's better to play *every note* of a 4-note phrase, even if one is wrong, than to skip a note. A 4-note phrase with one wrong pitch on time is `(3 × 1.0 + 0) / 4 = 0.75` pitch accuracy and full rhythm — a Good. A 4-note phrase where you played 3 in time and dropped the last one is `0.75` pitch but only `0.75` rhythm — also Good, but with less margin and a worse rhythm component.

## A worked example

Suppose the original is a four-note phrase at 120 BPM: C–E–G–C. You play:

| Beat | Original | You played | Pitch | Rhythm |
|---|---|---|---|---|
| 1 | C | C, 10 ms late | 1.0 | ~0.98 |
| 2 | E | E, 20 ms late | 1.0 | ~0.96 |
| 3 | G | A♭ (semitone off), on time | 0 | 1.0 |
| 4 | C | (missed) | 0 | 0 |

- Pitch accuracy: `(1 + 1 + 0 + 0) / 4 = 0.50`
- Rhythm accuracy: `(0.98 + 0.96 + 1.0 + 0) / 4 ≈ 0.74`
- Overall: `0.50 × 0.6 + 0.74 × 0.4 ≈ 0.59`
- Grade: **Fair**

The two notes you played correctly carry most of the credit. The wrong-pitch G drags pitch accuracy down. The missed last C drags both. To get to a Good, fix either the wrong pitch (overall jumps to ~0.74, **Good**) or play the last note on time (overall jumps to ~0.69, just under **Good**).

## What the app *doesn't* score

A few things deliberately stay out of the score:

- **Tone, dynamics, and articulation.** The pitch detector hears the fundamental frequency, not your sound. A breathy ghost note and a fortissimo accent score the same as long as the pitch and timing land.
- **Vibrato and bends.** The pitch detector takes a median across each note's duration, so a bend that resolves to the right pitch is counted as the right pitch.
- **Phrasing nuance** like swing degree or laid-back feel. Beyond the swing-aware scoring of off-beat eighths, the app doesn't try to read your phrasing. If you're playing the right notes at roughly the right times, you'll pass.

The score is a tool for tracking your accuracy on the *content* of the phrase. Once you're consistently passing at a given level, the practicing of *sound* is on you — the app is happy to call a clean attempt with no tone a Perfect, but a real teacher wouldn't, and you shouldn't either.

## Bleed filtering

If you don't use headphones, your microphone may pick up the playback or the backing track and mistake it for notes you played. To prevent that, the app runs a bleed filter on the detected notes before scoring: notes that line up with active backing-track pitches are dropped if the signal is weak. The filter is conservative — it only drops what looks like room bleed, not what looks like you playing the same note as the backing track.

You can toggle the bleed filter in Settings. Leave it on unless you're investigating an unexpected score.

## When the score doesn't match how it felt

Two situations commonly cause the score to disagree with your gut:

- **You played it cleanly but the score is low.** Usually a microphone problem — the room is noisy, the mic is far from the bell, or the input level is too low and the pitch detector is losing clarity. Watch the clarity dot on the pitch meter while you play; if it's flickering, that's why.
- **You stumbled but the score is high.** Usually because you stopped playing instead of finishing the phrase wrong. The app stops listening after about two seconds of silence; if you cut yourself off, the missed notes don't get logged because the alignment never sees them. This rounds in your favor in the short term, but it doesn't help your ear, so finishing through a stumble is the right move even when it costs a few points.

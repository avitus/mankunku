# Two Practice Modes

Mankunku splits practice into two modes — Side A and Side B — that solve different problems. Side A trains your ear; Side B drills a line into your fingers. They share the lick library, the difficulty system, and the progress tracking, but they ask different things of you in the room.

## Side A — Ear Training

The classical exercise: someone plays a phrase, you play it back. Side A is that, automated.

- The app picks a phrase that fits today's key, your current level, and any filters you've set.
- It plays the phrase through your speakers (or headphones) over a metronome.
- It listens through your microphone while you play it back.
- It scores how close you got on pitch and rhythm, and either advances you or hands you a retry.

Side A is **breadth-first**. You hear a different phrase each time. Some you'll nail; some will catch you off guard. The point isn't memorizing the licks — it's getting faster at hearing a melodic shape and converting it to a fingering. The library is large enough that licks rarely repeat in a single session.

**Use Side A when** you want to build the listen → play reflex, work on tuning, get used to a new scale, or warm up at the start of a practice session.

## Side B — Lick Practice

The opposite exercise: you already know what you want to play; the app helps you own it in every key over a backing track.

- You **tag** licks from the library (or your own user-entered ones) as "practice" licks.
- Side B picks one of your tagged licks and rotates it through all 12 keys over a chord progression — bass, comping, drums.
- Each key, you play the lick once per cycle. Pass it cleanly (≥ 80%) and the next cycle moves to the next key. Tempo bumps up +5 BPM after every clean key; it backs off when you stumble.
- Once you've passed all 12 keys, the session moves to the next tagged lick.

Side B is **depth-first**. It assumes the line is already in your ear and your job is to wire it to your fingers across the cycle of fifths. The progress tracking is per-lick, per-key — you can see exactly which keys still trip you up on a given line, and which are clean.

**Use Side B when** there's a specific line you want to internalize — a Bird quote, a turnaround, a ii-V-I lick from your transcription book, a phrase you stole from a record. Stagger Side B sessions across the week and you'll have the line in every key in a month or so.

## What they share

Both modes pull from the same lick library and the same daily key system, and both contribute to your overall progress.

- **The library** is the same in both modes. Side A queries it for variety; Side B picks specific licks from it that you've tagged.
- **The daily key** rotates once per day (more on this in [The Daily Key](./tonality-system.md)). Side A defaults to today's key but lets you override; Side B always cycles through all 12 keys regardless of the daily pick.
- **Difficulty** climbs from your performance in either mode. Pitch complexity and rhythm complexity rise (or fall) on the same scale — see [Levels & Difficulty](./adaptive-difficulty.md).
- **Scoring** uses the same algorithm: pitch accuracy at 60%, rhythm accuracy at 40%, with timing tolerances that loosen at slow tempos and tighten at fast ones. The full breakdown is in [How Scoring Works](./scoring-algorithm.md).
- **Progress and history** roll up across both modes — your streak counts a Side B session the same as a Side A session.

## How a phrase travels through the app

Whether you're on Side A or Side B, a single attempt follows the same path under the hood. You don't need to think about any of this while you play — but it helps to know what the app is doing on your behalf:

1. The app picks (or generates) a phrase. On Side A, it's drawn from the library or made on the fly. On Side B, it's the current tagged lick transposed into the current key.
2. The phrase plays through speakers or headphones, with the metronome and (on Side B) the rhythm section.
3. After the phrase ends, the metronome keeps going. The app starts listening through your microphone.
4. As you play, a real-time pitch detector picks up each note. After about two seconds of silence — or as soon as you complete a Side B cycle — the recording closes.
5. The detected notes get matched against the expected ones. The match isn't note-for-note: a flexible alignment lets you be a little late or a little early, lets you drop a note, lets you add an extra one. Each note gets a pitch score and a rhythm score; the two are combined into an overall percentage and a grade.
6. The result lands in your progress: today's date gets logged, the streak ticks (or holds), the level adjusts, and per-category and per-key averages update.

The deeper details — why the alignment is forgiving, what the grades mean, why pitch counts more than rhythm — are in [How Scoring Works](./scoring-algorithm.md).

## A note on the design choice

The two modes exist because two very different kinds of practice both happen on a horn:

- **Reading a melody you've never heard before** and reproducing it. Sight-singing for instrumentalists. This is Side A's job.
- **Internalizing a memorized line** so it's available in any key under any tempo. The "vocabulary" half of jazz practice. This is Side B's job.

Trying to do both in one mode means picking which one to half-do. Splitting them lets the app commit fully to each — the listen-and-play loop on Side A doesn't need a backing track or a key cycle; the 12-key drill on Side B doesn't need to surprise you with new content.

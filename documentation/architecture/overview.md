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

- You **tag** licks from the library (or your own user-entered ones) as "practice" licks, and each tagged lick carries one or more progression tags (`prog:ii-V-I-major`, `prog:blues`, etc.) that say which backing tracks it plays cleanly over.
- Side B picks one of your tagged licks and drills it over a chord progression — bass, comping, drums. A lick starts in a single key and earns more keys over successive sessions until it reaches all 12, working outward from its entry key along the circle of fifths.
- Each session, you play the lick once per currently-unlocked key. Pass a key cleanly (≥ 90%) and it counts toward advancement; a key below the 75% floor blocks any tempo increase or new-key unlock until you bring it back up. Clear the whole set well — session average high enough, the newest key consolidated over a couple of passes, and no key under the floor — and the next session unlocks one more key.
- Tempo adjusts once per lick, from your average across the keys you played that session: +5 BPM at ≥ 95%, +2 at ≥ 90%, easing down by 1 in the 75–89% band, and −3 below 75%. (In single-lick Deep Practice it bumps a fixed +5 BPM only once you clear every currently-unlocked key in a round.)
- A lick moves on to the next tagged one once you've played all of its currently-unlocked keys this session — you build a lick toward its full 12-key range one key at a time across many sessions, not all at once. (The session's time budget bounds the whole session, not each lick.)
- A **Daily Practice** start button rotates across every progression you have tagged licks for, sized to the same time budget — useful as a daily warm-up that touches every line in your book.
- A **Practice** button on any lick's detail page in the Library launches **Deep Practice** on that single lick — a focused round through just that lick's currently-unlocked keys, with the rotation refilling and tempo bumping each time all keys are mastered.

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

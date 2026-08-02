# The Practice Modes

Mankunku splits practice into two scored modes — Side A and Side B — that solve different problems, plus a third surface where you apply what they teach you. Side A trains your ear; Side B drills a line into your fingers; Tune Practice puts those lines into a real song form. Side A and Side B share the difficulty system and the progress tracking, but they ask different things of you in the room.

## Side A — Ear Training

The classical exercise: someone plays a phrase, you play it back. Side A is that, automated.

- The app picks a phrase that fits today's key, your current level, and any filters you've set.
- It plays the phrase through your speakers (or headphones) over a metronome.
- It listens through your microphone while you play it back.
- It scores how close you got on pitch and rhythm, and either advances you or hands you a retry.

Side A is **breadth-first**. You hear a different phrase each time. Some you'll nail; some will catch you off guard. The point isn't memorizing the licks — it's getting faster at hearing a melodic shape and converting it to a fingering. The catalog is large enough that licks rarely repeat in a single session.

**Use Side A when** you want to build the listen → play reflex, work on tuning, get used to a new scale, or warm up at the start of a practice session.

## Side B — Lick Practice

The opposite exercise: you already know what you want to play; the app helps you own it in every key over a backing track.

- You **tag** licks from your book (stolen from the community, or recorded/written yourself) as "practice" licks, and each tagged lick carries one or more progression tags (`prog:ii-V-I-major`, `prog:blues`, etc.) that say which backing tracks it plays cleanly over.
- Side B picks one of your tagged licks and drills it over a chord progression — bass, comping, drums. A lick starts in a single key and earns more keys over successive sessions until it reaches all 12, working outward from its entry key along the circle of fifths.
- Each session, you play the lick once per currently-unlocked key. Pass a key cleanly (≥ 90%) and it counts toward advancement; a key below the 75% floor blocks any tempo increase or new-key unlock until you bring it back up. Clear the whole set well — session average high enough, the newest key consolidated over three passes, and no key under the floor — and the next session unlocks one more key.
- Tempo adjusts once per lick, from your average across the keys you played that session: +2 BPM at ≥ 95%, +1 at ≥ 90%, easing down by 1 in the 75–89% band, and −3 below 75%. (In single-lick Deep Practice it bumps a fixed +5 BPM only once you clear every currently-unlocked key in a round.)
- A lick moves on to the next tagged one once you've played all of its currently-unlocked keys this session — you build a lick toward its full 12-key range one key at a time across many sessions, not all at once. (The session's time budget bounds the whole session, not each lick.)
- A **Daily Practice** start button rotates across every progression you have tagged licks for, sized to the same time budget — useful as a daily warm-up that touches every line in your book.
- A **Practice** button on any lick's detail page in your book launches **Deep Practice** on that single lick — a focused round through just that lick's currently-unlocked keys, with the rotation refilling and tempo bumping each time all keys are mastered.

Side B is **depth-first**. It assumes the line is already in your ear and your job is to wire it to your fingers across the cycle of fifths. The progress tracking is per-lick, per-key — you can see exactly which keys still trip you up on a given line, and which are clean.

**Use Side B when** there's a specific line you want to internalize — a Bird quote, a turnaround, a ii-V-I lick from your transcription book, a phrase you stole from a record. Stagger Side B sessions across the week and you'll have the line in every key in a month or so.

## Tune Practice — applying it

The third surface, reached from **Practice licks** on any tune in your book. It isn't a fourth kind of drill; it's the place the other two pay off.

- The app reads a tune's changes and **detects the progressions it knows** inside them — short and long ii-V-Is, turnarounds, iii-VI-ii-V-I, vamps, blues. Each match becomes an **insertion point**: a window in the form, in a specific local key.
- The rhythm section plays the form. The head plays **once** (jazz form rule), then the staff clears and the chorus is yours.
- At each insertion point the app suggests licks from *your* practice set that fit that progression in that key — ranked by what you've actually unlocked and drilled, so it never asks for a key you haven't earned.
- Three modes: **Suggest** (the lick is named for you), **Points** (you pick, and consecutive clean insertions score double), and **Freestyle** (no windows — just solo, and the app applauds the licks it recognises).

Tune Practice is **context-first**. It answers the question neither scored mode can: *can you find this line when a real form goes by at tempo?*

**Use Tune Practice when** you've got vocabulary banked and want to test whether it's actually available — or when learning a new standard and you want to know which of your lines fit where.

Its takes are deliberately **not written into progress**: no streak, no adaptive-level movement, no per-key lick scores. Scoring it would turn the applying-it room into another drilling room. See [Playing Over Tunes](../tune-practice.md).

## What they share

Both modes use the same daily key system and contribute to the same progress tracking.

- **The licks are shared.** Side A queries the catalog for variety; Side B picks the specific licks you've tagged in your book.
- **The daily key** rotates once per day (more on this in [The Daily Key](./tonality-system.md)). Side A defaults to today's key but lets you override; Side B ignores the daily pick and drills each lick through its currently-unlocked keys, earning more keys toward the full 12 across successive sessions.
- **Difficulty** climbs from your performance in either mode. Pitch complexity and rhythm complexity rise (or fall) on the same scale — see [Levels & Difficulty](./adaptive-difficulty.md).
- **Scoring** uses the same algorithm: pitch accuracy at 60%, rhythm accuracy at 40%, with timing tolerances that loosen at slow tempos and tighten at fast ones. The full breakdown is in [How Scoring Works](./scoring-algorithm.md).
- **Progress and history** roll up across both modes — your streak counts a Side B session the same as a Side A session.

## How a phrase travels through the app

Whether you're on Side A or Side B, a single attempt follows the same path under the hood. You don't need to think about any of this while you play — but it helps to know what the app is doing on your behalf:

1. The app picks (or generates) a phrase. On Side A, it's drawn from the catalog or made on the fly. On Side B, it's the current tagged lick transposed into the current key.
2. The phrase plays through speakers or headphones, with the metronome and (on Side B) the rhythm section.
3. After the phrase ends, the metronome keeps going. The app starts listening through your microphone.
4. As you play, a real-time pitch detector picks up each note. After about two seconds of silence — or as soon as you complete a Side B cycle — the recording closes.
5. The detected notes get matched against the expected ones. The match isn't note-for-note: a flexible alignment lets you be a little late or a little early, lets you drop a note, lets you add an extra one. Each note gets a pitch score and a rhythm score; the two are combined into an overall percentage and a grade.
6. The result lands in your progress: today's date gets logged, the streak ticks (or holds), the level adjusts, and per-category and per-key averages update.

The deeper details — why the alignment is forgiving, what the grades mean, why pitch counts more than rhythm — are in [How Scoring Works](./scoring-algorithm.md).

## A note on the design choice

The modes exist because three very different kinds of practice all happen on a horn:

- **Reading a melody you've never heard before** and reproducing it. Sight-singing for instrumentalists. This is Side A's job.
- **Internalizing a memorized line** so it's available in any key under any tempo. The "vocabulary" half of jazz practice. This is Side B's job.
- **Retrieving the right line at the right moment** while a form goes by. The part that only ever happened on a bandstand. This is Tune Practice's job.

Trying to do them in one mode means picking which one to half-do. Splitting them lets the app commit fully to each — the listen-and-play loop on Side A doesn't need a backing track or a key cycle; the 12-key drill on Side B doesn't need to surprise you with new content; and the tune session doesn't need a grade book, because the two drilling modes already have one.

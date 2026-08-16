# The Practice Modes

Mankunku splits practice into three scored modes — Side A, Side B, and Tricks — that solve different problems, plus a fourth surface where you apply what they teach you. Side A trains your ear; Side B drills a line into your fingers; Tricks drills the *formulas* that generate lines; Tune Practice puts all of it into a real song form. They share the scoring machinery and the progress tracking, but they ask very different things of you in the room.

## Side A — Ear Training

The classical exercise: someone plays a phrase, you play it back. Side A is that, automated.

- The app picks a phrase that fits today's key and your proficiency in today's scale.
- It plays the phrase through your speakers (or headphones) over a metronome.
- It listens through your microphone while you play it back.
- It scores how close you got on pitch and rhythm, and either advances you or hands you a retry.

Side A is **breadth-first**. You hear a different phrase each time. Some you'll nail; some will catch you off guard. The point isn't memorizing the licks — it's getting faster at hearing a melodic shape and converting it to a fingering. The catalog is large enough that licks rarely repeat in a single session.

**Use Side A when** you want to build the listen → play reflex, work on tuning, get used to a new scale, or warm up at the start of a practice session.

## Side B — Lick Practice

The opposite exercise: you already know what you want to play; the app helps you own it in every key over a backing track.

- You **tag** licks from your book (stolen from the community, or recorded/written yourself) as "practice" licks, and each tagged lick carries one or more progression tags — ii-V-I major, blues, and so on — that say which backing tracks it plays cleanly over.
- Side B picks one of your tagged licks and drills it over a chord progression — bass, comping, drums. A lick starts in a single key and earns more keys over successive sessions until it reaches all 12, working outward from its entry key along the circle of fifths.
- Each session, you play the lick once per currently-unlocked key. Pass a key cleanly (≥ 90%) and it counts toward advancement; a key below the 75% floor blocks any tempo increase or new-key unlock until you bring it back up. Clear the whole set well — session average ≥ 90%, the newest key consolidated over three passes, and no key under the floor — and the next session unlocks one more key.
- Tempo adjusts once per lick, from your average across the keys you played that session: +2 BPM at ≥ 95%, +1 at ≥ 90%, easing down by 1 in the 75–89% band, and −3 below 75%. (Single-lick Deep Practice runs its own rule instead: it opens 2% below the lick's saved tempo, bumps 1% only once you clear every currently-unlocked key in a round, and saves none of it.)
- A lick moves on to the next tagged one once you've played all of its currently-unlocked keys this session — you build a lick toward its full 12-key range one key at a time across many sessions, not all at once. (The session's time budget bounds the whole session, not each lick.)
- A **Daily Practice** start button rotates across every progression you have tagged licks for, sized to the same time budget — useful as a daily warm-up that touches every line in your book.
- A **Practice** button on any lick's detail page in your book launches **Deep Practice** on that single lick — a focused, *continuous* round through just that lick's currently-unlocked keys. No rest bars, no round card: a one-bar ii-V turnaround joins each cycle to the next, the rotation is re-sorted so your worst key comes up first, keys you clear at 95% drop out, and the app stops demonstrating the lick to you once you're holding 90% on the key at the top. It opens 2% below the lick's saved tempo; clear the whole rotation and it bumps 1% and refills. The ramp is session-local — Daily Practice still finds the lick at the tempo it was graded at.

Side B is **depth-first**. It assumes the line is already in your ear and your job is to wire it to your fingers across the cycle of fifths. The progress tracking is per-lick, per-key — you can see exactly which keys still trip you up on a given line, and which are clean.

**Use Side B when** there's a specific line you want to internalize — a Bird quote, a turnaround, a ii-V-I lick from your transcription book, a phrase you stole from a record. Stagger Side B sessions across the week and you'll have the line in every key in a month or so.

## Tricks — the devices behind the lines

The third scored mode, in the nav under **Tricks**. It drills a *formula* rather than a phrase: enclosures and triad pairs, the two devices that generate most of what a bebop player actually improvises.

- Each device has a **mastery ladder** — for enclosures, eight rungs from a single chromatic approach to a double-chromatic wrap landing off the beat, run as three parallel ladders (one per chord type: major, minor, dominant); for triad pairs, eight families from diatonic neighbours through the altered colours to whole tone. A rung opens once you've cleared 3 attempts at ≥ 90% on its prerequisite.
- A drill runs like Deep Practice: continuous cycles over a two-bar vamp (major, dominant, or minor, whichever the variant wants), starting in C at 60 BPM and earning keys and tempo as you clear them.
- It plays you an example every round — but **you are not being asked to play the example back**. You're being asked to play the device. Score it and the app checks whether your notes belong to the formula, not whether they match the demo. Triad pairs go further: play the pair as the demo cell, as alternating triplets, or as four eighths per triad, and the app takes the best of the three readings.

Tricks is **generative**. Side B gives you one line you can play anywhere; a trick gives you a shape you can apply to a chord you've never seen before.

**Use Tricks when** your solos sound like a chain of quotes, or when you can hear the device on a record and can't produce it on demand. Full detail in [Practicing Tricks](../tricks.md).

## Tune Practice — applying it

The fourth surface, reached from **Practice licks** on any tune in your book. It isn't another kind of drill; it's the place the other three pay off.

- The app reads a tune's changes and **detects the progressions it knows** inside them — short and long ii-V-Is, turnarounds, iii-VI-ii-V-I, vamps, blues. Each match becomes an **insertion point**: a window in the form, in a specific local key.
- The rhythm section plays the form. The head plays **once** (jazz form rule), then the staff clears and the chorus is yours.
- At each insertion point the app suggests licks from *your* practice set that fit that progression in that key — ranked by what you've actually unlocked and drilled, so it never asks for a key you haven't earned. Trick variants you've starred join the same list over vamps and ii-V-Is, ranked below the licks written for the spot.
- Three modes: **Suggest** (the lick is named for you), **Points** (you pick, and consecutive clean insertions score double), and **Freestyle** (no windows — just solo, and the app applauds the licks it recognises).

Tune Practice is **context-first**. It answers the question none of the drilling modes can: *can you find this line when a real form goes by at tempo?*

**Use Tune Practice when** you've got vocabulary banked and want to test whether it's actually available — or when learning a new standard and you want to know which of your lines fit where.

Its takes are deliberately **not written into progress**: no streak, no adaptive-level movement, no per-key lick scores. Scoring it would turn the applying-it room into another drilling room. See [Playing Over Tunes](../tune-practice.md).

## What they share

- **The licks are shared.** Side A queries the catalog for variety; Side B picks the specific licks you've tagged in your book.
- **The daily key** rotates once per day (more on this in [The Daily Key](./tonality-system.md)). Side A defaults to today's key but lets you override; Side B and Tricks ignore the daily pick and run their own per-item key ladders, earning more keys toward the full 12 across successive sessions.
- **Difficulty** climbs from your performance on Side A and Side B. Pitch complexity and rhythm complexity rise (or fall) on the same scale — see [Levels & Difficulty](./adaptive-difficulty.md).
- **Scoring** shares the machinery: the same forgiving alignment, the same latency correction, the same grade boundaries. Only the weighting differs — a lick is pitch at 60% and rhythm at 40%; a trick is formula-conformance at 70% and rhythm at 30%. The full breakdown is in [How Scoring Works](./scoring-algorithm.md).
- **Progress and history** roll up across all three drilling modes — your streak counts a Side B or Tricks session the same as a Side A session.
- **The band is shared** too: Side B, Tricks, and Tune Practice all use the same generated rhythm section, in whichever of the four styles you pick.

## How a phrase travels through the app

Whichever mode you're in, a single attempt follows the same path under the hood. You don't need to think about any of this while you play — but it helps to know what the app is doing on your behalf:

1. The app picks (or generates) a phrase. On Side A, it's drawn from the catalog or made on the fly. On Side B, it's the current tagged lick transposed into the current key. On Tricks, it's a fresh realization of the device's formula.
2. The phrase plays through speakers or headphones, with a count-in and (everywhere but Side A) the rhythm section.
3. After the phrase ends, the beat keeps going. The app starts listening through your microphone.
4. As you play, a real-time pitch detector picks up each note. On Side A the recording closes after about two seconds of silence; in the continuous modes it closes on the bar where your window ends.
5. The detected notes get matched against the expected ones. The match isn't note-for-note: a flexible alignment lets you be a little late or a little early, lets you drop a note, lets you add an extra one. Each note gets a pitch (or conformance) score and a rhythm score; the two are combined into an overall percentage and a grade.
6. The result lands in your progress: today's date gets logged, the streak ticks (or holds), and the relevant per-key and per-category averages update. (Tune practice is the exception — it scores you but writes nothing.)

The deeper details — why the alignment is forgiving, what the grades mean, why pitch counts more than rhythm — are in [How Scoring Works](./scoring-algorithm.md).

## A note on the design choice

The modes exist because four very different kinds of practice all happen on a horn:

- **Hearing a melody you've never heard before** and reproducing it. Sight-singing for instrumentalists. This is Side A's job.
- **Internalizing a memorized line** so it's available in any key under any tempo. The "vocabulary" half of jazz practice. This is Side B's job.
- **Owning a device** — a shape you can apply to a chord you've never played over, without recalling a specific line. This is Tricks' job.
- **Retrieving the right thing at the right moment** while a form goes by. The part that only ever happened on a bandstand. This is Tune Practice's job.

Trying to do them in one mode means picking which one to half-do. Splitting them lets the app commit fully to each — the listen-and-play loop on Side A doesn't need a backing track or a key cycle; the 12-key drill on Side B doesn't need to surprise you with new content; Tricks can score you for *not* copying the demo, which would be a bug anywhere else; and the tune session doesn't need a grade book, because the drilling modes already have one.

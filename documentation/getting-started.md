# Welcome to Mankunku

Mankunku is a jazz ear-training app built for one purpose: to make you faster at hearing a phrase and playing it back. You put on your headphones, pick up your horn, and the app drills you the way a teacher would — except it never gets tired, never moves on too fast, and stays out of your way once it knows your level.

The name is a tribute to [Winston "Mankunku" Ngozi](https://en.wikipedia.org/wiki/Winston_Mankunku_Ngozi), the South African tenor player whose 1968 record *Yakhal' Inkomo* still sounds like a way out. The app is built around the same instinct that drives that record: the only way through is by ear.

## What's inside

The app has two practice modes, set up like the two sides of an LP.

**Side A — Ear Training.** The app plays a short phrase. You play it back on your horn. It listens through your microphone, scores how close you got on pitch and rhythm, and either moves you on or gives you a retry. Phrases come from a curated library of about 450 jazz licks, plus an algorithmic generator for variety. The difficulty rises as you do.

**Side B — Lick Practice.** Pick a lick you want to own. The app cycles it through all 12 keys over a backing track — bass, comping, drums — and scores each pass. Get clean takes and the tempo bumps up by 5 BPM. Stumble and it eases off. This is the practice room version of working a line through the cycle of fifths.

Around those two modes are the supporting rooms: a **library** of every lick the app knows, sorted by harmonic context (ii-V-I major, blues, bebop lines, modal, ballad, and more); a **progress** view where you can see your streak, a calendar heatmap of practice days, and trend graphs of pitch and rhythm complexity over time; a **scales** reference; and tools for **adding licks** of your own — either by step-entering them note by note, or by recording a phrase from your horn and letting the app transcribe it.

## What you'll need

- A modern browser (the app is a PWA — install it like a native app if you want).
- A microphone the app can hear your horn through. A laptop's built-in mic works for most monophonic instruments. A USB condenser is better.
- Headphones, ideally. The app plays a phrase out of your speakers, then listens; if your speakers are loud enough that the mic re-hears the phrase, the score gets confused. There is a "bleed filter" that helps, but headphones make life simpler.
- A quiet room. Not silent — but the pitch detector listens for one note at a time, so a clattering dishwasher next door will trip it up.

## Your first session

The first time you open the app it asks two questions:

1. **What do you play?** Pick your instrument — Concert Pitch (for C instruments like flute or piano), soprano sax, tenor sax, alto sax, or trumpet. This sets the transposition (your sheet music will read in the right key for your horn) and tells the app what range to expect.
2. **Can it use your microphone?** Grant access. You can skip and turn this on later, but without it nothing gets scored.

After that you land on the dashboard. Hit **Side A** to drop into ear training, or **Side B** if you've already tagged some licks for the 12-key drill.

The first phrase you hear will be in **today's key**. The app picks one new key + scale combination per day — same one for everybody who opens the app on the same date — and rotates it the next morning. Today might be C Major Pentatonic; tomorrow could be F Blues; next week, A Dorian. As your accuracy climbs, more keys and more scale types unlock and join the rotation.

## A note on starting low

Every player who's tried this app has the same instinct: start at level 50 because "I'm not a beginner." Resist it. The early levels are designed to give you wins — short cells, three or four notes, slow tempos — and the adaptive system needs a few sessions to figure out where you actually live. Stumble through ten ambitious sessions and the level *drops*; play five clean sessions at a comfortable level and it starts pushing you up. Either way you end up in roughly the same place, but the second route doesn't sour the first ten minutes.

## Where to go from here

- **[How to Practice](./user-guide.md)** — the practice loop, the buttons, the settings.
- **[Two Practice Modes](./architecture/overview.md)** — when Side A vs Side B is the right tool.
- **[How Scoring Works](./architecture/scoring-algorithm.md)** — what the app rewards and what it forgives.
- **[The Daily Key](./architecture/tonality-system.md)** — why the key changes every day, and how new ones unlock.
- **[Glossary](./reference/glossary.md)** — jazz terms used throughout the app.

Building the app rather than practising with it? See **[Development Setup](./contributing/contributing.md#development-setup)**.

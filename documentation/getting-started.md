# Welcome to Mankunku

Mankunku is a jazz ear-training app built for one purpose: to make you faster at hearing a phrase and playing it back. You put on your headphones, pick up your horn, and the app drills you the way a teacher would — except it never gets tired, never moves on too fast, and stays out of your way once it knows your level.

The name is a tribute to [Winston "Mankunku" Ngozi](https://en.wikipedia.org/wiki/Winston_Mankunku_Ngozi), the South African tenor player whose 1968 record *Yakhal' Inkomo* still sounds like a way out. The app is built around the same instinct that drives that record: the only way through is by ear.

## What's inside

The app has two core practice modes, set up like the two sides of an LP.

**Side A — Ear Training.** The app plays a short phrase. You play it back on your horn. It listens through your microphone, scores how close you got on pitch and rhythm, and either moves you on or gives you a retry. Phrases come from a catalog of about 920 jazz licks — roughly half hand-written, half built by pairing melodic shapes with rhythm templates — plus any licks you add yourself. The difficulty rises as you do.

**Side B — Lick Practice.** Pick a lick you want to own. The app cycles it through its currently-unlocked keys over a backing track — bass, comping, drums — scores each pass, and gradually expands the rotation toward all 12 keys as you earn them. Get clean takes and the tempo edges up 1–2 BPM. Stumble and it eases off. This is the practice room version of working a line through the cycle of fifths.

Alongside them is a third drill: **Tricks.** Not lines but *devices* — enclosures and triad pairs, the formulas that generate lines. The app plays you an example, but it isn't asking for the example back; it's asking for the device, laid out however you choose, and it scores whether what you played obeys the formula. Each device is a ladder of variants that unlock as you earn them — eight triad-pair families, and eight enclosure rungs per chord type (major, minor, dominant). See [Practicing Tricks](./tricks.md).

Then there's the room where all of it meets: **Tune Practice.** Open a full song form from your book and the app plays the rhythm section through it, finds the ii-Vs and turnarounds and vamps inside the changes, and hands you those spots to fill with the licks you've been drilling. Score them, chain them together for bonus points, or just take a solo and let the app tell you which of your lines it recognised. See [Playing Over Tunes](./tune-practice.md).

Around those are the supporting rooms: a **Licks** page holding your personal book of lines; a **[Tunes](./tunes.md)** page for full song forms — hand-charted, imported from iReal Pro / Band-in-a-Box / MuseScore / a PDF, or adopted from the community; a **progress** view with your streak, a calendar heatmap of practice days, and trend graphs over time; a **scales** reference; tools for **adding licks** of your own — either by writing them note by note in the editor, or by recording a phrase from your horn and letting the app transcribe it; and these **docs**, with an assistant you can ask questions of.

## What you'll need

- A modern browser. The app is installable — add it to your home screen or dock and it opens in its own window — but it isn't an offline app: loading a page still needs the network. Your practice data is written to *this device* first and works without an account; clearing your browser storage while signed out loses it. Sign in (**Sign In**, top right — an email and a password; *Create Account* is on the same page) and it also syncs to the cloud, so it follows you between devices and survives a browser wipe. Signing in also shares the licks and tunes you save with other players — see [Sharing and adopting](./tunes.md#sharing-and-adopting).
- A microphone the app can hear your horn through. A laptop's built-in mic works for most monophonic instruments. A USB condenser is better.
- Headphones, ideally. The app plays a phrase out of your speakers, then listens; if your speakers are loud enough that the mic re-hears the phrase, the score gets confused. The app knows exactly what the click and the band played and discounts them where it can, but headphones make life simpler.
- A quiet room. Not silent — but the pitch detector listens for one note at a time, so a clattering dishwasher next door will trip it up.

## Your first session

The first time you open one of the rooms that listens — Ear Training, Lick Practice, Tricks, Record a lick, or a tune's practice session — the app asks two questions before it starts:

1. **What do you play?** Pick your instrument — Concert Pitch (for C instruments like flute or piano), soprano sax, tenor sax, alto sax, or trumpet. This sets the transposition (your sheet music will read in the right key for your horn) and tells the app what range to expect.
2. **Can it use your microphone?** Tap *Allow Microphone*. You can skip and turn this on later in your browser, but without it nothing gets scored.

(Signed in on a new device? If your account already holds practice data, the app first offers to restore it — *Restore My Progress* or *Start Fresh Instead*.)

The browsing pages — the dashboard, your books, the docs — never ask. From the dashboard, hit **Side A** to drop into ear training, or **Side B** if you've already tagged some licks for the 12-key drill.

The first phrase you hear will be in **today's key**. The app picks one key + scale combination at a time and rotates it: every two or three days while you have only a few unlocked, every day once you have seven or more, so a new key has time to settle in your ear. The pick comes from the date and what you've unlocked, so it's the same on all your devices. Today might be C Major Pentatonic; next week, F Blues; later, A Dorian. As your accuracy climbs, more keys and more scale types unlock and join the rotation.

## A note on starting low

There is no level to set. Every player starts at level 1 in every scale — short cells, three or four notes, slow tempos — and the app moves you from there on your accuracy over the last twenty-five attempts: hold 85% and the level ticks up, fall under 50% and it ticks down. The only lever you have is playing clean. That's deliberate: the first ten minutes are meant to be wins, and the system needs a few sessions to find out where you actually live. Play a session of clean takes and it starts pushing you up on its own; the daily key and the scale types open up as it does.

## Where to go from here

- **[How to Practice](./user-guide.md)** — the practice loop, the buttons, the settings.
- **[The Practice Modes](./architecture/overview.md)** — when Side A, Side B, Tricks, or a tune is the right tool.
- **[Practicing Tricks](./tricks.md)** — enclosures and triad pairs, drilled for fluency.
- **[Your Tunes](./tunes.md)** — building a songbook: charting, importing, adopting.
- **[Playing Over Tunes](./tune-practice.md)** — putting your vocabulary into a real form.
- **[How Scoring Works](./architecture/scoring-algorithm.md)** — what the app rewards and what it forgives.
- **[The Daily Key](./architecture/tonality-system.md)** — why the key rotates, and how new ones unlock.
- **[Glossary](./reference/glossary.md)** — jazz terms used throughout the app.

Building the app rather than practising with it? See **[Development Setup](./contributing/contributing.md#development-setup)**.

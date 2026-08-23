# Your Tunes

The **Tunes** page is your songbook. Where the Licks page holds one- and two-bar lines, the Tunes page holds whole song forms — melody, changes, sections, repeats, endings — the things you'd otherwise be flipping through a Real Book to find.

A tune in Mankunku is a chart you can read, hear, transpose to any key, and then *practice over* — the app plays the rhythm section through the form and hands you the spots where your licks fit. That last part gets its own page: [Playing Over Tunes](./tune-practice.md).

## The book

Open **Tunes** in the nav and you get two shelves:

- **Your book** — everything you charted by hand, imported, or adopted from the community. Adopted charts carry an **Adopted** badge and the name of the player who shared them.
- **Curated tunes** — charts that ship with the app, badged **Curated**.

One search box filters both shelves at once, matching on title, composer, style, or tag. Two buttons sit at the top right: **Browse Community** (charts other players have shared) and **+ Add a tune**.

If your book is empty the page says so and points you at the two places to start.

## Five ways to add a tune

Tap **+ Add a tune** and you land on a chooser with five routes in. They all end in the same place — a chart in your book — but they start from very different material.

| Route | Start from | Good for |
|---|---|---|
| **Editor** | Nothing — a blank chart | A tune you know, or one you're writing. Full control over sections, melody, and changes. |
| **PDF Upload** | A scanned or exported PDF chart | Anything you already have as a printed page. The AI reads it; you review and correct. |
| **iReal Pro** | An iReal Pro share link | The fastest route for changes-only charts. Handles single tunes *and* whole playlists. |
| **Band-in-a-Box** | A `.SGU` / `.MGU` song, or a BIAB MusicXML export | An existing BIAB library. |
| **MuseScore** | A `.mscz` / `.mscx` score | A chart you (or someone else) engraved properly — melody, changes, and form all come across. |

### What each importer actually reads

- **iReal Pro** gives you *changes only* — iReal charts carry no melody. You get sections, repeats, endings, the key, and the style label. Paste a link containing several tunes and you get a review list; pick which ones to keep.
- **Band-in-a-Box** reads the binary song file directly, and falls back to MusicXML if you exported one. Changes and form come across; melody comes across when the file has one.
- **MuseScore** is the richest source: melody, chord symbols, key signature, note spellings, glissandi, and the section/repeat structure. Chord shorthand typed the MuseScore way (`t` for Δ, `0` for ø) is normalised on the way in.
- **PDF Upload** is the fallback for everything else — a photo of a page, a Real Book scan, a chart someone emailed you. The app sends the pages to Claude, which reads staves, barlines, chord symbols, and noteheads. It shows real progress as it works ("Reading pages…", "Transcribing system 3 of 6…") rather than an open-ended spinner. **It is not perfect and it does not pretend to be**: the import lands in a review panel where anything the reader was unsure about is flagged with the bar it printed in, so you can fix it before saving. The original PDF stays attached to the tune.
- **PDF + OMR transcription** (optional, for the technically inclined): if you run the local OMR tool on the chart first (from the repository root: `cd omr && uv run python -m omr transcribe ../path/to/chart.pdf` — see `docs/omr/` in the repository), you can attach the resulting `.omr.json` above the PDF picker. Lines the transcription covers get their melody from a dedicated music-reading model — measurably more accurate than the AI reader on typeset charts — and skip the AI call entirely; chord symbols still come from the page's own text. Lines it can't cover fall back to the AI as usual.

Whatever route you take, the chart is stored in its **real concert key** — unlike curated licks, which are all stored in C (C minor for minor licks); licks you enter yourself keep the key — and the major/minor reading — you gave them. A tune in F stays a tune in F, and the key selector transposes it for reading.

## Reading a chart

Tap any tune to open it. You get:

- The **title, composer, style, and time signature** across the top.
- A **Key** selector in *your written pitch* — the same key you'd read off the page on your horn. Tap a key and the chart re-engraves there. (Under the hood the app converts to concert pitch; you never have to do that arithmetic.)
- The **chart itself**, engraved Real Book style: masthead title block, jazz chord symbols above the staff at the height MuseScore puts them, section letters, repeat barlines, and stacked first/second endings.
- **Play** — hear the tune with the rhythm section, melody and all.
- **Practice licks** — drop into a scored practice session over the form. See [Playing Over Tunes](./tune-practice.md).
- **Edit** and **Delete** on charts you own; **Return to community** on charts you adopted.

## The editor

`/tunes/editor` charts a tune by hand. It's built on the same step-entry machinery as the lick editor, so the note-entry controls behave identically — but the unit of work is a *section*, not a phrase.

The workflow:

1. **Set up the tune** — title, composer, style, key, time signature.
2. **Build the section list** — A, B, Intro, Coda, and so on. Each section has a bar count, and optional repeat-start / repeat-end markers and numbered endings. The section list is the authoritative form; this is the thing that makes an AABA chart an AABA chart.
3. **Enter the changes.** Type chord symbols in *written* pitch — the same text you'd write on the page. Click a slot on the chart to edit it in place.
4. **Enter the melody**, one page of up to four bars at a time. The entry rail on the left (a dock at the bottom on mobile) holds the duration picker, the pitch pad, and the accidental toggles. Pages commit as you navigate, so moving between pages or sections never loses work.

Manual melody entry is **4/4 only**. Imported charts in other meters keep their meter and their melody, but melody *editing* is switched off for them — the 4/4 entry buffer would corrupt a 3/4 or 5/4 chart, so the app declines rather than mangling it. Changes and section structure stay editable in any meter.

## Sharing and adopting

**Browse Community** shows charts other players have shared. Adopt one and it lands in your book with an *Adopted* badge and the original author's name — you can read it, transpose it, and practice over it, but it's still theirs; **Return to community** removes your copy.

There is **no publish button**, and this is worth knowing before you chart anything you'd rather keep to yourself: if you're signed in, every tune you save syncs to your account and appears in other players' Browse Community list under your display name. Sharing is the default, not a step. (The same is true of licks you write or record — the lick editor says so the first time.)

## Where tunes fit in your practice

- **Reading** — pull up a chart in your key and read the head down.
- **Hearing** — hit Play and let the rhythm section walk you through the form.
- **Applying vocabulary** — this is the real payoff. [Playing Over Tunes](./tune-practice.md) finds the ii-Vs, turnarounds, and vamps inside the tune you're looking at, and asks you to put the licks you've been drilling on Side B into an actual song. That's the bridge between the practice room and the bandstand.

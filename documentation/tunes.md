# Your Tunes

The **Tunes** page is your songbook. Where the Licks page holds one- and two-bar lines, the Tunes page holds whole song forms — melody, changes, sections, repeats, endings — the things you'd otherwise be flipping through a Real Book to find.

A tune in Mankunku is a chart you can read, hear, transpose to any key, and then *practice over* — the app plays the rhythm section through the form and hands you the spots where your licks fit. That last part gets its own page: [Playing Over Tunes](./tune-practice.md).

## The book

Open **Tunes** in the nav and you get two shelves:

- **Your book** — everything you charted by hand, imported, or adopted from the community. Adopted charts carry an **Adopted** badge and *shared by* the player who shared them.
- **Curated tunes** — the charts that ship with the app (*When the Saints Go Marching In*, *Amazing Grace*, *Mankunku Blues*); their pages carry a **Curated** badge.

One search box filters both shelves at once, matching on title, composer, style, or tag. The buttons at the top right: **Browse Community** (charts other players have shared), **+ Add a tune**, a *How your songbook works* tour link, and a docs link.

If your book is empty the page says so and points you at the two places to start.

## Five ways to add a tune

Tap **+ Add a tune** and you land on a chooser with five routes in. They all end in the same place — a chart in your book — but they start from very different material.

| Route | Start from | Good for |
|---|---|---|
| **Editor** | Nothing — a blank chart | A tune you know, or one you're writing. Full control over sections, melody, and changes. |
| **PDF Upload** | A scanned or exported PDF chart | Anything you already have as a printed page. The AI reads it; you review and correct. |
| **iReal Pro** | An iReal Pro share link | The fastest route for changes-only charts. Handles single tunes *and* whole playlists. |
| **Band-in-a-Box** | A `.SGU` / `.MGU` song, or a BIAB MusicXML export | An existing BIAB library (changes only). |
| **MuseScore** | A `.mscz` / `.mscx` score | A chart you (or someone else) engraved properly — melody, changes, and form all come across. |

### What each importer actually reads

Every import page has a **Chart written for** selector first: *C — Concert*, *B♭ — Tenor Sax / Trumpet*, or *E♭ — Alto Sax* — whichever the source was written out for. iReal Pro and Band-in-a-Box files are concert by nature, so leave it alone unless you know yours was built at written pitch. For a PDF, set it before you upload. On the MuseScore page it starts on your own instrument (horn players often type a written-pitch chart into a non-transposing part), and a score with a real transposing part switches it to Concert on its own. The editor has the same control, for a chart you're typing in from a written-pitch page. The three file-and-link importers (iReal Pro, Band-in-a-Box, MuseScore) end on a result list: each chart it found — key (in your written pitch), meter, bar count, style — with any *Import notes* above, and two buttons — **Add to book** puts it straight in your book (then *✓ Added — view*), **Review & edit** opens it in the editor first.

- **iReal Pro** gives you *changes only* — iReal charts carry no melody. In iReal Pro use *Share → Copy*, paste the `irealb://` link, and tap **Read link**. You get sections, repeats, endings, the key, and the style label. Paste a link containing several tunes (a whole playlist) and you get them all in the list; pick which ones to keep.
- **Band-in-a-Box** reads the song file (`.SGU` / `.MGU`) directly — a best-effort read — or a MusicXML export from BIAB, which is the more faithful route when the song file comes out wrong. Either way you get *changes only*: the melody is left for you to enter afterwards.
- **MuseScore** is the richest source: melody, chord symbols, key signature, note spellings, glissandi, and the section/repeat structure. A score with several parts gives you the one that matches your instrument. Chord shorthand typed the MuseScore way (`t` for Δ, `0` for ø) is normalised on the way in. A **pickup bar** comes across as a short partial bar when the score marks it as one — tick *Exclude from measure count* in the pickup bar's Measure Properties before exporting; a short first bar without that flag is imported as a full bar, and the import tells you so.
- **PDF Upload** is the fallback for everything else — a photo of a page, a Real Book scan, a chart someone emailed you (under 10 MB). **Pick the time signature before you upload** — 4/4, 3/4, 2/2, 2/4, 6/8, 5/4 or 12/8 — because the reader needs to know how many beats make a bar before it reads the first one; if the page turns out to say otherwise, the import tells you so you can re-import with the right meter. The app then sends the pages to Claude, which reads staves, barlines, chord symbols, and noteheads. It shows real progress as it works rather than an open-ended spinner — *Reading the page — staves, barlines, chords, noteheads*, then *Transcribing 3 of 6 lines* with a clock and a line-by-line list (*read*, *reading — second try*, *couldn't read — left blank for you*) — and it's slow by design: a dense chart can take a couple of minutes. **Cancel import** stops it. A line the reader can't manage is left blank for you rather than sinking the whole import. **It is not perfect and it does not pretend to be**: nothing is saved until you've checked it. The draft always opens in the editor, under a banner naming the bars the import wasn't sure of (*Review bars 5, 12 — the import wasn't certain there*), with the details folded underneath; fix what's wrong and save. A pickup comes across as a short first bar when the reader spots one. The original PDF stays attached to the tune. (If the server has no AI key, the page says so and offers the editor instead — or an import from an OMR file alone, below.)
- **PDF + OMR transcription** (optional, for the technically inclined): if you run the local OMR tool on the chart first (from the repository root: `cd omr && uv run python -m omr transcribe ../path/to/chart.pdf` — see `docs/omr/` in the repository), you can attach the resulting `.omr.json` above the PDF picker. Lines the transcription covers get their melody from a dedicated music-reading model — measurably more accurate than the AI reader on typeset charts — and skip the AI call entirely; chord symbols still come from the page's own text. Lines it can't cover fall back to the AI as usual. A pickup bar comes across either way the model writes it: as a short first measure (right-aligned into the bar and engraved short) or as a full measure behind a leading rest (the app reads the late entry as the pickup).

Whatever route you take, the chart is stored in its **real concert key** — unlike curated licks, which are all stored in C (C minor for minor licks); licks you enter yourself keep the key — and the major/minor reading — you gave them. A tune in F stays a tune in F, and the key selector transposes it for reading.

## Reading a chart

Tap any tune to open it. You get:

- The **title, composer, style, and time signature** across the top (plus *shared by* on an adopted chart and a **Curated** badge on the ones that ship with the app).
- A **Key** selector in *your written pitch* — the same key you'd read off the page on your horn. Tap a key and the chart re-engraves there. (Under the hood the app converts to concert pitch; you never have to do that arithmetic.)
- The **chart itself**, engraved Real Book style: masthead title block, jazz chord symbols above the staff at the height MuseScore puts them, section letters, repeat barlines, stacked first/second endings, and a pickup bar drawn short at the front of the first line (bar numbers count from the first full bar, and the section letter sits over it). The tune's tags sit underneath.
- **Play** — hear the melody, repeats taken, at your Settings tempo and swing. It's the tune on its own, no band — the rhythm section comes in when you practice. (A changes-only chart has nothing to play here.)
- **Practice licks** — drop into a practice session over the form, with the rhythm section. See [Playing Over Tunes](./tune-practice.md).
- **Edit** and **Delete** on charts you own (Delete asks you to confirm); **Return to community** on charts you adopted.

## The editor

`/tunes/editor` charts a tune by hand. It's built on the same step-entry machinery as the lick editor, so the note-entry controls behave identically — but the unit of work is a *section*, not a phrase.

The workflow:

1. **Set up the tune** — type the title on the chart itself; the **Setup** bar under the chart (it reads *Key … · N sections*; tap *Edit* to open it) holds the composer, the style, *Chart written for*, and the key (with a *Move notes with key* switch once there's melody, so changing the key can either transpose the notes or just relabel them). There's no time-signature control: a chart you start here is in 4/4 (see below).
2. **Build the section list** (also in Setup) — A, B, Intro, Coda, and so on, with **+ Add section** and *Remove*. Each section has a label, a bar count, and optional repeat-start (`|:`) / repeat-end (`:|`) markers and a 1st or 2nd ending. The section list is the authoritative form; this is the thing that makes an AABA chart an AABA chart. A **Pickup** control above the list adds an anacrusis (½ to 3½ beats in 4/4, in half-beat steps): the app puts a short unlabeled bar in front of the form with its lead-in already filled, so the first note you enter in it lands on the pickup's beat and your sections keep their bar counts. On the chart the pickup engraves as a short first bar, bar numbers start from the first full bar, and the section letter sits over that bar.
3. **Enter the changes.** Type chord symbols in *written* pitch — the same text you'd write on the page. Click a slot on the chart (or press `K`) to edit it in place.
4. **Enter the melody**, one page of up to four bars at a time. The entry rail on the left (a dock at the bottom on mobile) shows where the next note lands (*Section A · Bar 3, Beat 2*) and holds the duration picker, the pitch pad, and the accidental toggles, with **Play** (the melody at your Settings tempo), **Save** (*Update* when editing) and **Clear** (*Cancel*) under them and a *Keyboard shortcuts* list — the same keys as the lick editor, plus `K` for a chord. Pages commit as you navigate, so moving between pages or sections never loses work.

Manual melody entry is **4/4 only**. Imported charts in other meters keep their meter and their melody, but melody *editing* is switched off for them — the 4/4 entry buffer would corrupt a 3/4 or 5/4 chart, so the app declines rather than mangling it. Changes and section structure stay editable in any meter.

## Sharing and adopting

**Browse Community** (you'll need to be signed in) shows charts other players have shared. Search by title, composer or tag, narrow by author, sort by *Popular* or *Newest*, and tap the heart to favourite one. **+ Add to my book** adopts it: it lands in your book with an *Adopted* badge and the original author's name — you can read it, transpose it, and practice over it, but it's still theirs. The card then reads *✓ In my book*; tapping that, or **Return to community** on the tune's page, removes your copy. Your own shared charts show as *My sheet*.

There is **no publish button**, and this is worth knowing before you chart anything you'd rather keep to yourself: if you're signed in, every tune you save syncs to your account and appears in other players' Browse Community list under your display name. Sharing is the default, not a step. (The same is true of licks you write or record — the lick editor says so the first time.)

## Where tunes fit in your practice

- **Reading** — pull up a chart in your key and read the head down.
- **Hearing** — hit Play for the melody; for the rhythm section walking the form, start a practice session (Freestyle is the band with nothing scored).
- **Applying vocabulary** — this is the real payoff. [Playing Over Tunes](./tune-practice.md) finds the ii-Vs, turnarounds, and vamps inside the tune you're looking at, and asks you to put the licks you've been drilling on Side B into an actual song. That's the bridge between the practice room and the bandstand.

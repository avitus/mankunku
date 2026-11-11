# Lick recorder baseline

## Estimated editing effort

- 12 logical corrections across 150 reference notes (0.8 edits per 10 notes).
- Median: 1 edits per lick. Ready as recorded: 6/14.

| Lick | Total edits | Whole-line shift (semitones) | Repitch | Resize | Insert | Remove |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Apple Jump | 0 | — | 0 | 0 | 0 | 0 |
| Art Pepper — Stardust | 1 | -17 | 0 | 0 | 0 | 0 |
| Basis of Everything | 1 | — | 0 | 1 | 0 | 0 |
| Blue Monk | 2 | -5 | 0 | 1 | 0 | 0 |
| Chromatic Below Chord Tones | 0 | — | 0 | 0 | 0 | 0 |
| Cry Me a River | 0 | — | 0 | 0 | 0 | 0 |
| Dexter Gordon - Go Chromatic | 0 | — | 0 | 0 | 0 | 0 |
| Do Nothing Till You Hear From Me | 2 | -7 | 0 | 1 | 0 | 0 |
| Eric Alexander Chord Tone Lick | 1 | -5 | 0 | 0 | 0 | 0 |
| Fats Navarro - Wail | 2 | 7 | 0 | 1 | 0 | 0 |
| Honeysuckle Rose | 0 | — | 0 | 0 | 0 | 0 |
| Sharp 9 Flat 9 Dom | 1 | 8 | 0 | 0 | 0 | 0 |
| Sonny Stitt - Indiana | 0 | — | 0 | 0 | 0 | 0 |
| Wouldn't It Be Loverly | 2 | -5 | 0 | 1 | 0 | 0 |

Drafts exceeding the recorder editor’s four-bar limit: none.

## Comparing recorder versions

With the previous acoustic recorder, these takes need 24 edits. Updating just the tonic guess gives 20. Adding octave evidence gives 16. Recovering short passing notes and joining sustained endings gives 12. The comparison page uses the 16-edit recorder as its previous version.

Previous is the first phrase-level release (59 edits). Clock only is the older beat-local quantizer given that release’s clock offset. Current also considers acoustic support for each boundary. A grid collision and an optional acoustic boundary are counted separately.

Of 150 reference notes, the original beat-local algorithm required 143 edits. Current automatic recognition omits 13 acoustically uncertain boundaries. With the correct written key supplied separately, 7 edits remain before charging for key selection. This last number uses user input and is excluded from the automatic result.

| Set | Previous edits | Clock only | Current edits | Previous resizes | Current resizes | Previous collisions | Current collisions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Development | 49 | 46 | 8 | 25 | 3 | 2 | 0 |
| Reserved licks | 10 | 12 | 4 | 4 | 2 | 0 | 0 |
| All | 59 | 58 | 12 | 29 | 5 | 2 | 0 |

| Lick | Reserved | Previous edits | Clock only | Current edits | Clock offset (ms) | Collisions before → after |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Apple Jump |  | 3 | 6 | 0 | 205 | 0 → 0 |
| Art Pepper — Stardust |  | 3 | 4 | 1 | 222 | 0 → 0 |
| Basis of Everything |  | 5 | 7 | 1 | 168 | 0 → 0 |
| Blue Monk |  | 4 | 3 | 2 | 144 | 0 → 0 |
| Chromatic Below Chord Tones |  | 1 | 1 | 0 | 167 | 0 → 0 |
| Cry Me a River | Yes | 0 | 0 | 0 | 139 | 0 → 0 |
| Dexter Gordon - Go Chromatic | Yes | 1 | 1 | 0 | 128 | 0 → 0 |
| Do Nothing Till You Hear From Me |  | 6 | 6 | 2 | 150 | 1 → 0 |
| Eric Alexander Chord Tone Lick |  | 1 | 1 | 1 | 164 | 0 → 0 |
| Fats Navarro - Wail | Yes | 4 | 4 | 2 | 150 | 0 → 0 |
| Honeysuckle Rose |  | 3 | 4 | 0 | 235 | 0 → 0 |
| Sharp 9 Flat 9 Dom |  | 5 | 5 | 1 | 160 | 0 → 0 |
| Sonny Stitt - Indiana |  | 18 | 9 | 0 | 200 | 1 → 0 |
| Wouldn't It Be Loverly | Yes | 5 | 7 | 2 | 250 | 0 → 0 |

## Note agreement

- In-order pitch-class recall: 150/150 (100.0%).
- In-order pitch-class precision: 150/150 (100.0%).
- In-order pitch recall, including octave: 135/150 (90.0%).
- Notated onset present: 150/150 (100.0%).
- Notated onset and duration present: 145/150 (96.7%).
- Onset and duration relative to the first note: 145/150 (96.7%).
- Inferred key equals practice key: 7/14 (50.0%).
- Saved notes matching normalized MIDI, onset and duration: 73/150 (48.7%).

| Take | Best archived practice score | BPM | Written practice → inferred key | Expected | Emitted | Pitch class | MIDI | Onset | Onset + duration | Relative rhythm | Exact saved |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| [Apple Jump](2026-10-06-apple-jump-6bc44e.wav) | 98.76% | 110 | Db → Db | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 |
| [Art Pepper — Stardust](2026-10-06-art-pepper-stardust-bada94.wav) | 99.01% | 79 | A → E | 6 | 6 | 6 | 0 | 6 | 6 | 6 | 0 |
| [Basis of Everything](2026-11-04-basis-of-everything-2d1dd1.wav) | 99.02% | 179 | F → F | 7 | 7 | 7 | 7 | 7 | 6 | 6 | 6 |
| [Blue Monk](2026-10-06-blue-monk-a0ada5.wav) | 99.23% | 52 | Bb → F | 8 | 8 | 8 | 8 | 8 | 7 | 7 | 0 |
| [Chromatic Below Chord Tones](2026-10-06-chromatic-below-chord-tones-4fe32e.wav) | 99.25% | 60 | Ab → Ab | 13 | 13 | 13 | 13 | 13 | 13 | 13 | 13 |
| [Cry Me a River](2026-10-06-cry-me-a-river-00014d.wav) | 99.29% | 126 | Eb → Eb | 6 | 6 | 6 | 6 | 6 | 6 | 6 | 6 |
| [Dexter Gordon - Go Chromatic](2026-11-05-dexter-gordon-go-chromatic-03fa32.wav) | 99.23% | 78 | F → F | 12 | 12 | 12 | 12 | 12 | 12 | 12 | 12 |
| [Do Nothing Till You Hear From Me](2026-11-04-do-nothing-till-you-hear-from-me-01095d.wav) | 99.12% | 50 | F → Bb | 11 | 11 | 11 | 2 | 11 | 10 | 10 | 0 |
| [Eric Alexander Chord Tone Lick](2026-11-02-eric-alexander-chord-tone-lick-ef3e65.wav) | 99.38% | 61 | A → E | 16 | 16 | 16 | 16 | 16 | 16 | 16 | 0 |
| [Fats Navarro - Wail](2026-10-06-fats-navarro-wail-beba69.wav) | 99.31% | 50 | Eb → Bb | 16 | 16 | 16 | 16 | 16 | 15 | 15 | 0 |
| [Honeysuckle Rose](2026-11-05-honeysuckle-rose-e827e3.wav) | 98.87% | 170 | Ab → Ab | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 |
| [Sharp 9 Flat 9 Dom](2026-10-06-sharp-9-flat-9-dom-c36a96.wav) | 99.13% | 141 | D → Bb | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 0 |
| [Sonny Stitt - Indiana](2026-11-04-sonny-stitt-indiana-a6b07e.wav) | 99.37% | 50 | C → C | 22 | 22 | 22 | 22 | 22 | 22 | 22 | 22 |
| [Wouldn't It Be Loverly](2026-10-06-wouldn-t-it-be-loverly-c49eeb.wav) | 98.15% | 150 | Db → Ab | 10 | 10 | 10 | 10 | 10 | 9 | 9 | 0 |

## Note-level comparison

Each note shows its written instrument pitch, offset, and duration. Both fractions use whole notes. The two lines are shown as played.

### Apple Jump

- Reference: Gb5@0/1 (1/8), Eb5@1/8 (1/8), Db5@1/4 (1/8), B4@3/8 (1/8), C5@1/2 (1/8), A5@5/8 (1/8), Ab5@3/4 (1/8), Gb5@7/8 (1/8), Db5@1/1 (1/2)
- Replay: Gb5@0/1 (1/8), Eb5@1/8 (1/8), Db5@1/4 (1/8), B4@3/8 (1/8), C5@1/2 (1/8), A5@5/8 (1/8), Ab5@3/4 (1/8), Gb5@7/8 (1/8), Db5@1/1 (1/2)

### Art Pepper — Stardust

- Reference: A4@0/1 (1/8), G#4@1/8 (1/8), G4@1/4 (1/8), B4@3/8 (1/8), F#4@1/2 (1/8), E4@5/8 (1/4)
- Replay: A5@0/1 (1/8), G#5@1/8 (1/8), G5@1/4 (1/8), B5@3/8 (1/8), F#5@1/2 (1/8), E5@5/8 (1/4)

### Basis of Everything

- Reference: G4@0/1 (1/8), Bb4@1/8 (1/8), D5@1/4 (1/8), F5@3/8 (1/8), E5@1/2 (1/4), C5@3/4 (1/4), A4@1/1 (1/1)
- Replay: G4@0/1 (1/8), Bb4@1/8 (1/8), D5@1/4 (1/8), F5@3/8 (1/8), E5@1/2 (1/4), C5@3/4 (1/4), A4@1/1 (1/2)

### Blue Monk

- Reference: F5@0/1 (1/8), G5@1/8 (1/8), F5@1/4 (1/8), E5@3/8 (1/8), Eb5@1/2 (1/8), F4@5/8 (1/8), Db5@3/4 (1/8), D5@7/8 (5/8)
- Replay: F5@0/1 (1/8), G5@1/8 (1/8), F5@1/4 (1/8), E5@3/8 (1/8), Eb5@1/2 (1/8), F4@5/8 (1/8), Db5@3/4 (1/8), D5@7/8 (1/4)

### Chromatic Below Chord Tones

- Reference: Eb4@0/1 (1/8), D4@1/8 (1/8), Eb4@1/4 (1/8), Ab4@3/8 (1/8), G4@1/2 (1/8), Ab4@5/8 (1/8), C5@3/4 (1/8), B4@7/8 (1/8), C5@1/1 (1/8), Eb5@9/8 (1/8), D5@5/4 (1/8), Eb5@11/8 (1/8), Ab5@3/2 (1/8)
- Replay: Eb4@0/1 (1/8), D4@1/8 (1/8), Eb4@1/4 (1/8), Ab4@3/8 (1/8), G4@1/2 (1/8), Ab4@5/8 (1/8), C5@3/4 (1/8), B4@7/8 (1/8), C5@1/1 (1/8), Eb5@9/8 (1/8), D5@5/4 (1/8), Eb5@11/8 (1/8), Ab5@3/2 (1/8)

### Cry Me a River

- Reference: F5@0/1 (1/8), Eb5@1/8 (1/8), Bb4@1/4 (1/8), Gb4@3/8 (1/8), F4@1/2 (1/8), Eb4@5/8 (3/8)
- Replay: F5@0/1 (1/8), Eb5@1/8 (1/8), Bb4@1/4 (1/8), Gb4@3/8 (1/8), F4@1/2 (1/8), Eb4@5/8 (3/8)

### Dexter Gordon - Go Chromatic

- Reference: C4@3/4 (1/12), D4@5/6 (1/12), F4@11/12 (1/12), Ab4@1/1 (1/8), A4@9/8 (1/8), Bb4@5/4 (1/8), B4@11/8 (1/8), C5@3/2 (1/8), A4@13/8 (1/8), Bb4@7/4 (1/8), Ab4@15/8 (1/8), A4@2/1 (1/4)
- Replay: C4@3/4 (1/12), D4@5/6 (1/12), F4@11/12 (1/12), Ab4@1/1 (1/8), A4@9/8 (1/8), Bb4@5/4 (1/8), B4@11/8 (1/8), C5@3/2 (1/8), A4@13/8 (1/8), Bb4@7/4 (1/8), Ab4@15/8 (1/8), A4@2/1 (1/4)

### Do Nothing Till You Hear From Me

- Reference: Bb4@1/8 (1/8), G4@1/4 (1/8), Ab4@3/8 (1/8), A4@1/2 (1/8), C5@5/8 (1/8), Bb4@3/4 (1/8), G4@7/8 (1/8), A4@1/1 (1/8), F4@9/8 (1/8), C4@5/4 (1/8), Bb3@11/8 (5/8)
- Replay: Bb5@1/8 (1/8), G5@1/4 (1/8), Ab5@3/8 (1/8), A5@1/2 (1/8), C6@5/8 (1/8), Bb5@3/4 (1/8), G5@7/8 (1/8), A5@1/1 (1/8), F5@9/8 (1/8), C5@5/4 (1/8), Bb4@11/8 (1/4)

### Eric Alexander Chord Tone Lick

- Reference: G#5@0/1 (1/8), A5@1/8 (1/8), B5@1/4 (1/8), G#5@3/8 (1/8), E5@1/2 (1/8), F#5@5/8 (1/8), G#5@3/4 (1/8), E5@7/8 (1/8), C#5@1/1 (1/8), D5@9/8 (1/8), E5@5/4 (1/8), C#5@11/8 (1/8), G#4@3/2 (1/8), A4@13/8 (1/8), B4@7/4 (1/8), G#4@15/8 (1/8)
- Replay: G#5@0/1 (1/8), A5@1/8 (1/8), B5@1/4 (1/8), G#5@3/8 (1/8), E5@1/2 (1/8), F#5@5/8 (1/8), G#5@3/4 (1/8), E5@7/8 (1/8), C#5@1/1 (1/8), D5@9/8 (1/8), E5@5/4 (1/8), C#5@11/8 (1/8), G#4@3/2 (1/8), A4@13/8 (1/8), B4@7/4 (1/8), G#4@15/8 (1/8)

### Fats Navarro - Wail

- Reference: Bb4@0/1 (1/8), G4@1/8 (1/8), Ab4@1/4 (1/8), Bb4@3/8 (1/8), C5@1/2 (1/8), Eb5@5/8 (1/8), G5@3/4 (1/8), F5@7/8 (1/8), E5@1/1 (1/8), D5@9/8 (1/8), Gb4@5/4 (1/8), A4@11/8 (1/8), Db5@3/2 (1/4), B4@7/4 (1/8), A4@15/8 (1/8), Bb4@2/1 (1/2)
- Replay: Bb4@0/1 (1/8), G4@1/8 (1/8), Ab4@1/4 (1/8), Bb4@3/8 (1/8), C5@1/2 (1/8), Eb5@5/8 (1/8), G5@3/4 (1/8), F5@7/8 (1/8), E5@1/1 (1/8), D5@9/8 (1/8), Gb4@5/4 (1/8), A4@11/8 (1/8), Db5@3/2 (1/4), B4@7/4 (1/8), A4@15/8 (1/8), Bb4@2/1 (1/4)

### Honeysuckle Rose

- Reference: Eb5@0/1 (1/8), Db5@1/8 (1/8), F4@1/4 (1/8), Ab4@3/8 (1/8), C5@1/2 (1/2)
- Replay: Eb5@0/1 (1/8), Db5@1/8 (1/8), F4@1/4 (1/8), Ab4@3/8 (1/8), C5@1/2 (1/2)

### Sharp 9 Flat 9 Dom

- Reference: C5@0/1 (1/8), A#4@1/8 (1/8), C5@1/4 (1/8), A#4@3/8 (1/8), C5@1/2 (1/8), A#4@5/8 (1/8), A4@3/4 (1/8), G4@7/8 (1/8), F#4@1/1 (1/2)
- Replay: C5@0/1 (1/8), Bb4@1/8 (1/8), C5@1/4 (1/8), Bb4@3/8 (1/8), C5@1/2 (1/8), Bb4@5/8 (1/8), A4@3/4 (1/8), G4@7/8 (1/8), Gb4@1/1 (1/2)

### Sonny Stitt - Indiana

- Reference: E5@0/1 (1/4), C5@1/4 (1/8), A4@3/8 (1/8), E4@1/2 (1/8), A4@5/8 (1/8), C5@3/4 (1/8), E5@7/8 (1/8), D5@1/1 (1/8), C5@9/8 (1/8), B4@5/4 (1/8), A4@11/8 (1/8), G#4@3/2 (1/8), B4@13/8 (1/8), D5@7/4 (1/8), F5@15/8 (1/8), E5@2/1 (1/8), C5@17/8 (1/8), D5@9/4 (1/8), B4@19/8 (1/8), C5@5/2 (1/8), B4@21/8 (1/8), A4@11/4 (1/8)
- Replay: E5@0/1 (1/4), C5@1/4 (1/8), A4@3/8 (1/8), E4@1/2 (1/8), A4@5/8 (1/8), C5@3/4 (1/8), E5@7/8 (1/8), D5@1/1 (1/8), C5@9/8 (1/8), B4@5/4 (1/8), A4@11/8 (1/8), G#4@3/2 (1/8), B4@13/8 (1/8), D5@7/4 (1/8), F5@15/8 (1/8), E5@2/1 (1/8), C5@17/8 (1/8), D5@9/4 (1/8), B4@19/8 (1/8), C5@5/2 (1/8), B4@21/8 (1/8), A4@11/4 (1/8)

### Wouldn't It Be Loverly

- Reference: Ab4@0/1 (1/12), Bb4@1/12 (1/12), Ab4@1/6 (1/12), G4@1/4 (1/8), Ab4@3/8 (1/8), C5@1/2 (1/8), Bb4@5/8 (1/8), Ab4@3/4 (1/8), Gb4@7/8 (1/8), F4@1/1 (1/2)
- Replay: Ab4@0/1 (1/12), Bb4@1/12 (1/12), Ab4@1/6 (1/12), G4@1/4 (1/8), Ab4@3/8 (1/8), C5@1/2 (1/8), Bb4@5/8 (1/8), Ab4@3/4 (1/8), Gb4@7/8 (1/8), F4@1/1 (3/8)

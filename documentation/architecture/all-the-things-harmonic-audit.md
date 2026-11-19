# All the Things You Are — key-center audit

Chorus bar 1 is the first Fm7. The stored production arrangement has one intro
measure and four further measures without chord symbols before the 36-bar
chorus. The table uses concert pitch. For tenor sax, the five major centers
A♭, C, E♭, G and E read B♭, D, F, A and F♯.

The comparison uses the chords and durations read from production and the
analyzer on dev at `f72ddb13`. It is a proposed musical reading from the
changes. Human listening acceptance remains open. A comma separates bars in
the changes column. A slash between chord names divides a bar.

| Chorus bars | Production changes | Preferred reading | Analyzer on dev before this change |
| --- | --- | --- | --- |
| Intro + four measures | No written chords | Leave open | No center |
| 1–5 | Fm7, B♭m7, E♭7, A♭maj7, D♭maj7 | A♭ major. The ii–V–I establishes the opening Fm7 as vi and D♭maj7 as IV. | A♭ major throughout |
| 6–8 | G7, Cmaj7, Cmaj7 | C major from G7 through the held tonic | C major throughout |
| 9–13 | Cm7, Fm7, B♭7, E♭maj7, A♭maj7 | E♭ major. The opening pattern repeats a fourth lower. | E♭ major throughout |
| 14–15 | Aø7 / D7, Gmaj7 | Borrowed minor iiø–V into G major. Gmaj7 specifies the arrival mode. | G minor in bar 14, with G major overlapping from beat 3 |
| 16 | Gmaj7 / E7♯5 | G major. E7♯5 leads to Am7 as V/ii. | G major until beat 3, then a gap |
| 17–20 | Am7, D7, Gmaj7, Gmaj7 | G major through the confirmed ii–V–I | G major throughout |
| 21–23 | F♯m7, B7, Emaj7 | E major from its ii–V–I | E major throughout |
| 24 | C7♯5 | V of the coming Fm7. Looking ahead, V/vi of A♭ is plausible. | No center |
| 25–29 | Fm7, B♭m7, E♭7, A♭maj7, D♭maj7 | A♭ major returns, ending this phrase on IV | A♭ major throughout |
| 30–32 | D♭m7, Cm7, B°7 | A♭ major continues. IV becomes borrowed iv, iii follows, then the bass descends C–B–B♭ into ii. | Three-bar gap between two A♭ spans |
| 33–35 | B♭m7, E♭7, A♭maj7 | ii–V–I confirms A♭ | A♭ major throughout |
| 36 | Gø7 / C7♭9 | Turnaround toward Fm7 on a repeat. Gø7 also fits the outgoing A♭ collection. | A♭ on beat 1, then no center on the finite form |

## First change

Bars 25–35 now share one A♭ rail. The two A♭ cadences supply the evidence
on either side of the descent. The borrowed iv and the passing diminished
seventh explain the two chromatic chords. Cm7 is diatonic throughout.

The rule works in all twelve keys. It can recognize either device on its own.
It requires a contiguous passage of up to four bars, with each chromatic chord
lasting at most one bar. A borrowed minor iv follows major IV and moves to I or
iii. A fully diminished seventh sits one semitone from each flanking diatonic
root in the same direction of travel. Section changes, silence, unknown
symbols and contradictory cadences interrupt the inference. The chart exposes
this reading while the lick planner uses strict chord compatibility and
cornerstone reservations.

The source fixture gives each chord in bar 36 half a bar. Production gives
Gø7 one beat and C7♭9 three. Tests cover both timings. The proposed rule ends
its contribution at the start of bar 33, where the existing cadenced reading
resumes, so each arrangement retains its own turnaround boundary.

## Next comparison

Bar 14 is the clearest remaining mode disagreement. Use the actual major
resolution to distinguish a borrowed iiø–V from an arrival in minor. Pair
that case with the same approach resolving to Gm7. Bars 16 and 24 then offer
two tests for altered dominants, one inside an established key and one at a
key change. Track three outcomes separately in future audits: an unsupported
key change, a missing stretch of a supported center, and a genuine modulation
lost through excessive smoothing.

import { describe, it, expect } from 'vitest';
import { parseMscx, parseMuseScoreFile } from '$lib/leadsheets/import/musescore';

/**
 * Hand-written MuseScore 4 XML covering the parsing surface: metadata,
 * concert key, transposing-part harmony roots (TPC, written pitch),
 * dotted/plain durations, rests (incl. full-measure), ties, tuplets,
 * rehearsal-mark sections, repeat barlines, and slash-chord basses.
 */
function mscx({
	transposeChromatic = 0,
	staves = ''
}: { transposeChromatic?: number; staves?: string } = {}): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<museScore version="4.70">
  <programVersion>4.7.4</programVersion>
  <Score>
    <metaTag name="workTitle">Unit Tune</metaTag>
    <metaTag name="composer">A. Tester</metaTag>
    <Part id="1">
      <Staff></Staff>
      <trackName>Horn</trackName>
      <Instrument>
        <transposeChromatic>${transposeChromatic}</transposeChromatic>
      </Instrument>
    </Part>
    ${staves}
  </Score>
</museScore>`;
}

const CHORD = (pitch: number, durationType: string, extra = ''): string => `
          <Chord>
            ${extra}
            <durationType>${durationType}</durationType>
            <Note>
              <pitch>${pitch}</pitch>
              <tpc>14</tpc>
            </Note>
          </Chord>`;

const HARMONY = (root: number, name: string, bass = ''): string => `
          <Harmony>
            <harmonyInfo>
              <name>${name}</name>
              <root>${root}</root>
              ${bass}
            </harmonyInfo>
          </Harmony>`;

describe('parseMscx — basics', () => {
	it('reads metadata, concert key, meter, and melody at concert pitch', () => {
		const { sheets, warnings } = parseMscx(mscx({
			staves: `
    <Staff id="1">
      <Measure>
        <voice>
          <KeySig><concertKey>-1</concertKey><actualKey>1</actualKey></KeySig>
          <TimeSig><sigN>3</sigN><sigD>4</sigD></TimeSig>
          ${HARMONY(13, 'm7')}
          ${CHORD(60, 'quarter', '<dots>1</dots>')}
          ${CHORD(62, 'eighth')}
          <Rest><durationType>quarter</durationType></Rest>
        </voice>
      </Measure>
      <Measure>
        <voice>
          <Rest><durationType>measure</durationType><duration>3/4</duration></Rest>
        </voice>
      </Measure>
    </Staff>`
		}));
		expect(warnings).toEqual([]);
		expect(sheets).toHaveLength(1);
		const sheet = sheets[0];
		expect(sheet.title).toBe('Unit Tune');
		expect(sheet.composer).toBe('A. Tester');
		expect(sheet.key).toBe('F'); // concertKey -1 = one flat
		expect(sheet.timeSignature).toEqual([3, 4]);
		expect(sheet.source).toBe('imported-musescore');
		expect(sheet.sections).toHaveLength(1);
		expect(sheet.sections[0].bars).toBe(2);
		expect(sheet.sections[0].notes).toEqual([
			{ pitch: 60, duration: [3, 8], offset: [0, 1] },
			{ pitch: 62, duration: [1, 8], offset: [3, 8] }
		]);
		// Harmony: root TPC 13 = F (no transposition), anchored at the cursor.
		expect(sheet.sections[0].harmony).toHaveLength(1);
		expect(sheet.sections[0].harmony[0].symbol).toBe('F-7');
		expect(sheet.sections[0].harmony[0].startOffset).toEqual([0, 1]);
	});

	it('transposes written harmony roots to concert for transposing parts', () => {
		const { sheets } = parseMscx(mscx({
			transposeChromatic: -14, // tenor: concert = written - 14
			staves: `
    <Staff id="1">
      <Measure>
        <voice>
          <TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          ${HARMONY(19, 'm7')}
          ${CHORD(60, 'whole')}
        </voice>
      </Measure>
    </Staff>`
		}));
		// Written Bm7 on a tenor part is concert Am7; melody pitch is stored
		// concert already and must pass through untouched.
		const sec = sheets[0].sections[0];
		expect(sec.harmony[0].chord.root).toBe('A');
		expect(sec.harmony[0].symbol).toBe('A-7');
		expect(sec.notes[0].pitch).toBe(60);
	});

	it('parses slash-chord basses', () => {
		const { sheets } = parseMscx(mscx({
			staves: `
    <Staff id="1">
      <Measure>
        <voice>
          <TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          ${HARMONY(14, 'maj7', '<bass>18</bass>')}
          ${CHORD(64, 'whole')}
        </voice>
      </Measure>
    </Staff>`
		}));
		const seg = sheets[0].sections[0].harmony[0];
		expect(seg.symbol).toBe('CΔ7/E');
		expect(seg.chord.bass).toBe('E');
	});

	it('marks ties and takes the top note of multi-note chords', () => {
		const { sheets } = parseMscx(mscx({
			staves: `
    <Staff id="1">
      <Measure>
        <voice>
          <TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          <Chord>
            <durationType>half</durationType>
            <Note>
              <Spanner type="Tie"><next><location><fractions>1/2</fractions></location></next></Spanner>
              <pitch>67</pitch>
            </Note>
            <Note><pitch>60</pitch></Note>
          </Chord>
          <Chord>
            <durationType>half</durationType>
            <Note>
              <Spanner type="Tie"><prev><location><fractions>-1/2</fractions></location></prev></Spanner>
              <pitch>67</pitch>
            </Note>
          </Chord>
        </voice>
      </Measure>
    </Staff>`
		}));
		const notes = sheets[0].sections[0].notes;
		expect(notes).toHaveLength(2);
		expect(notes[0]).toMatchObject({ pitch: 67, tied: true });
		expect(notes[1].pitch).toBe(67);
		expect(notes[1].tied).toBeUndefined();
	});

	it('ignores voice-level spanner location addressing (no phantom time jumps)', () => {
		// Slurs, text lines, hairpins etc. sit at VOICE level and carry
		// <next>/<prev><location><fractions> — spanner ADDRESSING, not time.
		// Consuming those as cursor jumps shifted every later note in the bar
		// (the "extra rest before the whole note" bug).
		const { sheets, warnings } = parseMscx(mscx({
			staves: `
    <Staff id="1">
      <Measure>
        <voice>
          <TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          ${HARMONY(15, '-7')}
          <Spanner type="TextLine">
            <TextLine>
              <lineWidth>8</lineWidth>
              </TextLine>
            <next>
              <location>
                <measures>5</measures>
                <fractions>1/4</fractions>
                </location>
              </next>
            </Spanner>
          ${CHORD(70, 'whole')}
        </voice>
      </Measure>
      <Measure>
        <voice>
          <Spanner type="Slur">
            <next><location><fractions>1/8</fractions></location></next>
            </Spanner>
          ${CHORD(62, 'half')}
          <Spanner type="Slur">
            <prev><location><fractions>-1/8</fractions></location></prev>
            </Spanner>
          ${CHORD(63, 'half')}
        </voice>
      </Measure>
    </Staff>`
		}));
		expect(warnings).toEqual([]);
		const sec = sheets[0].sections[0];
		expect(sec.notes.map((n) => n.offset)).toEqual([
			[0, 1],
			[1, 1],
			[3, 2]
		]);
		expect(sec.harmony[0].symbol).toBe('G-7');
		expect(sec.harmony[0].startOffset).toEqual([0, 1]);
	});

	it('scales tuplet members by the tuplet ratio', () => {
		const { sheets } = parseMscx(mscx({
			staves: `
    <Staff id="1">
      <Measure>
        <voice>
          <TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          <Tuplet>
            <normalNotes>2</normalNotes>
            <actualNotes>3</actualNotes>
            <baseNote>eighth</baseNote>
          </Tuplet>
          ${CHORD(60, 'eighth')}
          ${CHORD(62, 'eighth')}
          ${CHORD(64, 'eighth')}
          <endTuplet/>
          ${CHORD(65, 'quarter')}
          <Rest><durationType>half</durationType></Rest>
        </voice>
      </Measure>
    </Staff>`
		}));
		const notes = sheets[0].sections[0].notes;
		expect(notes.map((n) => n.duration)).toEqual([
			[1, 12], [1, 12], [1, 12], [1, 4]
		]);
		expect(notes[3].offset).toEqual([1, 4]);
	});
});

describe('parseMscx — pickup bars', () => {
	it('right-aligns an anacrusis in the first bar and gives it its own section', () => {
		const { sheets, warnings } = parseMscx(mscx({
			staves: `
    <Staff id="1">
      <Measure len="1/4">
        <irregular>1</irregular>
        <voice>
          <TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          ${CHORD(55, 'eighth')}
          ${CHORD(57, 'eighth')}
        </voice>
      </Measure>
      <Measure>
        <voice>
          <RehearsalMark><text>A</text></RehearsalMark>
          ${HARMONY(14, 'maj7')}
          ${CHORD(60, 'whole')}
        </voice>
      </Measure>
    </Staff>`
		}));
		expect(warnings).toEqual([]);
		const sheet = sheets[0];
		expect(sheet.sections.map((s) => [s.label, s.bars])).toEqual([
			['Pickup', 1],
			['A', 1]
		]);
		// The two pickup eighths lead INTO bar 2's downbeat: beats 4 and 4-and.
		expect(sheet.sections[0].notes).toEqual([
			{ pitch: 55, duration: [1, 8], offset: [3, 4] },
			{ pitch: 57, duration: [1, 8], offset: [7, 8] }
		]);
		expect(sheet.sections[1].notes[0].offset).toEqual([0, 1]);
	});

	it('right-aligns a pickup inside a single unmarked section too', () => {
		const { sheets, warnings } = parseMscx(mscx({
			staves: `
    <Staff id="1">
      <Measure len="1/4">
        <irregular>1</irregular>
        <voice>
          <TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          ${CHORD(55, 'quarter')}
        </voice>
      </Measure>
      <Measure>
        <voice>
          ${CHORD(60, 'whole')}
        </voice>
      </Measure>
    </Staff>`
		}));
		expect(warnings).toEqual([]);
		const sec = sheets[0].sections[0];
		expect(sec.bars).toBe(2);
		expect(sec.label).toBe('A'); // no split point — no special label
		expect(sec.notes).toEqual([
			{ pitch: 55, duration: [1, 4], offset: [3, 4] },
			{ pitch: 60, duration: [1, 1], offset: [1, 1] }
		]);
	});

	it('pads the pickup against the actual meter, not an assumed 4/4', () => {
		const { sheets, warnings } = parseMscx(mscx({
			staves: `
    <Staff id="1">
      <Measure len="1/8">
        <irregular>1</irregular>
        <voice>
          <TimeSig><sigN>3</sigN><sigD>4</sigD></TimeSig>
          ${CHORD(55, 'eighth')}
        </voice>
      </Measure>
      <Measure>
        <voice>
          ${CHORD(60, 'half', '<dots>1</dots>')}
        </voice>
      </Measure>
    </Staff>`
		}));
		expect(warnings).toEqual([]);
		expect(sheets[0].sections[0].notes[0].offset).toEqual([5, 8]); // 3/4 bar − 1/8
	});

	it('anchors pickup harmony at the padded position', () => {
		const { sheets } = parseMscx(mscx({
			staves: `
    <Staff id="1">
      <Measure len="1/4">
        <irregular>1</irregular>
        <voice>
          <TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          ${HARMONY(15, '7')}
          ${CHORD(55, 'quarter')}
        </voice>
      </Measure>
      <Measure>
        <voice>
          ${CHORD(60, 'whole')}
        </voice>
      </Measure>
    </Staff>`
		}));
		const seg = sheets[0].sections[0].harmony[0];
		expect(seg.symbol).toBe('G7');
		expect(seg.startOffset).toEqual([3, 4]);
	});

	it('respects an explicit rehearsal mark on the pickup measure itself', () => {
		const { sheets } = parseMscx(mscx({
			staves: `
    <Staff id="1">
      <Measure len="1/4">
        <irregular>1</irregular>
        <voice>
          <TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          <RehearsalMark><text>Intro</text></RehearsalMark>
          ${CHORD(55, 'quarter')}
        </voice>
      </Measure>
      <Measure>
        <voice>
          <RehearsalMark><text>A</text></RehearsalMark>
          ${CHORD(60, 'whole')}
        </voice>
      </Measure>
    </Staff>`
		}));
		expect(sheets[0].sections.map((s) => s.label)).toEqual(['Intro', 'A']);
	});

	it('does NOT treat a split first bar as a pickup (no exclude-from-count flag)', () => {
		// MuseScore writes len= on any irregular measure, including the halves
		// of a split bar 1 — but only true anacruses carry the <irregular>
		// (exclude from measure count) flag. A flagless short first bar stays
		// left-aligned with a warning instead of being silently right-aligned.
		const { sheets, warnings } = parseMscx(mscx({
			staves: `
    <Staff id="1">
      <Measure len="2/4">
        <voice>
          <TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          ${CHORD(60, 'quarter')}
          ${CHORD(62, 'quarter')}
        </voice>
      </Measure>
      <Measure len="2/4">
        <voice>
          ${CHORD(64, 'quarter')}
          ${CHORD(65, 'quarter')}
        </voice>
      </Measure>
    </Staff>`
		}));
		expect(warnings.some((w) => /pickup/i.test(w))).toBe(true);
		expect(sheets[0].sections[0].notes.slice(0, 2).map((n) => n.offset)).toEqual([
			[0, 1],
			[1, 4]
		]);
	});

	it('snaps a sub-beat pickup chord onto the beat grid so it stays editable', () => {
		// An eighth-note pickup pads to 7/8; a chord anchored there would be
		// invisible to the beat-granular chord editor. It snaps to beat 4.
		const { sheets, warnings } = parseMscx(mscx({
			staves: `
    <Staff id="1">
      <Measure len="1/8">
        <irregular>1</irregular>
        <voice>
          <TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          ${HARMONY(15, '7')}
          ${CHORD(55, 'eighth')}
        </voice>
      </Measure>
      <Measure>
        <voice>
          ${CHORD(60, 'whole')}
        </voice>
      </Measure>
    </Staff>`
		}));
		expect(warnings).toEqual([]);
		const sec = sheets[0].sections[0];
		expect(sec.notes[0].offset).toEqual([7, 8]); // the note keeps its true spot
		expect(sec.harmony[0].startOffset).toEqual([3, 4]); // the chord sits on beat 4
	});

	it('keeps pickup content when a later time-signature change shrinks the bar', () => {
		const { sheets } = parseMscx(mscx({
			staves: `
    <Staff id="1">
      <Measure len="1/4">
        <irregular>1</irregular>
        <voice>
          <TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          ${CHORD(55, 'quarter')}
        </voice>
      </Measure>
      <Measure>
        <voice>
          <RehearsalMark><text>A</text></RehearsalMark>
          ${CHORD(60, 'whole')}
        </voice>
      </Measure>
      <Measure>
        <voice>
          <TimeSig><sigN>3</sigN><sigD>4</sigD></TimeSig>
          ${CHORD(62, 'half', '<dots>1</dots>')}
        </voice>
      </Measure>
    </Staff>`
		}));
		// The pickup bar's tail belongs to ITS OWN 4/4 length, not the final 3/4.
		expect(sheets[0].sections[0].notes).toEqual([
			{ pitch: 55, duration: [1, 4], offset: [3, 4] }
		]);
	});

	it('does not claim "mid-piece" for an oversized first measure', () => {
		const { warnings } = parseMscx(mscx({
			staves: `
    <Staff id="1">
      <Measure len="6/4">
        <voice>
          <TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          ${CHORD(60, 'whole')}
          ${CHORD(62, 'half')}
        </voice>
      </Measure>
    </Staff>`
		}));
		expect(warnings.length).toBeGreaterThan(0);
		expect(warnings.some((w) => /mid-piece/.test(w))).toBe(false);
	});

	it('falls back to a warning when a flagged pickup declares no meter', () => {
		const { sheets, warnings } = parseMscx(mscx({
			staves: `
    <Staff id="1">
      <Measure len="1/4">
        <irregular>1</irregular>
        <voice>
          ${CHORD(55, 'quarter')}
        </voice>
      </Measure>
      <Measure>
        <voice>
          ${CHORD(60, 'whole')}
        </voice>
      </Measure>
    </Staff>`
		}));
		expect(warnings.length).toBeGreaterThan(0);
		expect(sheets[0].sections[0].notes[0].offset).toEqual([0, 1]); // left-aligned
	});

	it('still warns for irregular measures mid-piece and keeps them left-aligned', () => {
		const { sheets, warnings } = parseMscx(mscx({
			staves: `
    <Staff id="1">
      <Measure>
        <voice>
          <TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          ${CHORD(60, 'whole')}
        </voice>
      </Measure>
      <Measure len="1/2">
        <voice>
          ${CHORD(62, 'half')}
        </voice>
      </Measure>
    </Staff>`
		}));
		expect(warnings.some((w) => /irregular measure/i.test(w))).toBe(true);
		expect(sheets[0].sections[0].notes[1]).toEqual({ pitch: 62, duration: [1, 2], offset: [1, 1] });
	});
});

describe('parseMscx — structure', () => {
	it('splits sections at rehearsal marks and applies repeat barlines', () => {
		const measure = (content: string): string => `
      <Measure>
        <voice>
          ${content}
        </voice>
      </Measure>`;
		const { sheets, warnings } = parseMscx(mscx({
			staves: `
    <Staff id="1">
      ${measure(`<TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          <RehearsalMark><text>A</text></RehearsalMark>
          <startRepeat/>
          ${HARMONY(14, '')}
          ${CHORD(60, 'whole')}`)}
      ${measure(CHORD(62, 'whole'))}
      <Measure>
        <endRepeat>2</endRepeat>
        <voice>
          <RehearsalMark><text>B</text></RehearsalMark>
          ${CHORD(64, 'whole')}
        </voice>
      </Measure>
      ${measure(CHORD(65, 'whole'))}
    </Staff>`
		}));
		expect(warnings).toEqual([]);
		const sheet = sheets[0];
		// The :| after B's first bar splits B — repeats are always kept, with
		// sections cut to fit them.
		expect(sheet.sections.map((s) => [s.label, s.bars])).toEqual([
			['A', 2],
			['B', 1],
			['C', 1]
		]);
		expect(sheet.sections[0].repeatStart).toBe(true);
		expect(sheet.sections[1].repeatEnd).toBe(true);
		expect(sheet.sections[1].notes[0].pitch).toBe(64);
		expect(sheet.sections[2].notes[0].pitch).toBe(65);
	});

	it('splits an unmarked chart at repeat barlines so a simple repeat survives', () => {
		const measure = (content: string, attrs = ''): string => `
      <Measure${attrs}>
        <voice>
          ${content}
        </voice>
      </Measure>`;
		const { sheets, warnings } = parseMscx(mscx({
			staves: `
    <Staff id="1">
      ${measure(`<TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          ${CHORD(60, 'whole')}`)}
      <Measure>
        <startRepeat/>
        <voice>
          ${CHORD(62, 'whole')}
        </voice>
      </Measure>
      ${measure(CHORD(64, 'whole'))}
      <Measure>
        <endRepeat>2</endRepeat>
        <voice>
          ${CHORD(65, 'whole')}
        </voice>
      </Measure>
      ${measure(CHORD(67, 'whole'))}
    </Staff>`
		}));
		expect(warnings).toEqual([]);
		const sheet = sheets[0];
		expect(sheet.sections.map((s) => [s.label, s.bars, s.repeatStart ?? false, s.repeatEnd ?? false])).toEqual([
			['A', 1, false, false],
			['B', 3, true, true],
			['C', 1, false, false]
		]);
		// Content lands in the right sections with section-local offsets.
		expect(sheet.sections[1].notes.map((n) => [n.pitch, n.offset])).toEqual([
			[62, [0, 1]],
			[64, [1, 1]],
			[65, [2, 1]]
		]);
	});

	it('carries the in-effect chord across a repeat-barline split', () => {
		// A chord stated once before a |: must still govern the repeated span
		// and everything after — a section cut cannot silence the backing.
		const measure = (content: string): string => `
      <Measure>
        <voice>
          ${content}
        </voice>
      </Measure>`;
		const { sheets } = parseMscx(mscx({
			staves: `
    <Staff id="1">
      ${measure(`<TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          ${HARMONY(14, 'maj7')}
          ${CHORD(60, 'whole')}`)}
      <Measure>
        <startRepeat/>
        <voice>
          ${CHORD(62, 'whole')}
        </voice>
      </Measure>
      <Measure>
        <endRepeat>2</endRepeat>
        <voice>
          ${CHORD(64, 'whole')}
        </voice>
      </Measure>
      ${measure(CHORD(65, 'whole'))}
    </Staff>`
		}));
		const [a, b, c] = sheets[0].sections;
		expect(a.harmony.map((h) => [h.symbol, h.startOffset, h.duration])).toEqual([
			['CΔ7', [0, 1], [1, 1]]
		]);
		expect(b.harmony.map((h) => [h.symbol, h.startOffset, h.duration])).toEqual([
			['CΔ7', [0, 1], [2, 1]]
		]);
		expect(c.harmony.map((h) => [h.symbol, h.startOffset, h.duration])).toEqual([
			['CΔ7', [0, 1], [1, 1]]
		]);
	});

	it('auto letters skip labels taken by real rehearsal marks', () => {
		const measure = (content: string): string => `
      <Measure>
        <voice>
          ${content}
        </voice>
      </Measure>`;
		const { sheets } = parseMscx(mscx({
			staves: `
    <Staff id="1">
      ${measure(`<TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          ${CHORD(60, 'whole')}`)}
      <Measure>
        <startRepeat/>
        <voice>
          ${CHORD(62, 'whole')}
        </voice>
      </Measure>
      <Measure>
        <endRepeat>2</endRepeat>
        <voice>
          ${CHORD(64, 'whole')}
        </voice>
      </Measure>
      ${measure(`<RehearsalMark><text>B</text></RehearsalMark>
          ${CHORD(65, 'whole')}`)}
    </Staff>`
		}));
		// The repeated span must not steal the user's real 'B' — duplicate
		// labels also collapse in the notation's part-label suppression.
		expect(sheets[0].sections.map((s) => s.label)).toEqual(['A', 'C', 'B']);
	});

	it('a pickup ahead of a repeat still leaves the form starting at A', () => {
		const { sheets } = parseMscx(mscx({
			staves: `
    <Staff id="1">
      <Measure len="1/4">
        <irregular>1</irregular>
        <voice>
          <TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          ${CHORD(55, 'quarter')}
        </voice>
      </Measure>
      <Measure>
        <startRepeat/>
        <voice>
          ${CHORD(60, 'whole')}
        </voice>
      </Measure>
      <Measure>
        <endRepeat>2</endRepeat>
        <voice>
          ${CHORD(62, 'whole')}
        </voice>
      </Measure>
    </Staff>`
		}));
		expect(sheets[0].sections.map((s) => s.label)).toEqual(['Pickup', 'A']);
	});

	it('an orphan :| repeats from the top, as MuseScore plays it', () => {
		const measure = (content: string): string => `
      <Measure>
        <voice>
          ${content}
        </voice>
      </Measure>`;
		const { sheets, warnings } = parseMscx(mscx({
			staves: `
    <Staff id="1">
      ${measure(`<TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          ${CHORD(60, 'whole')}`)}
      <Measure>
        <endRepeat>2</endRepeat>
        <voice>
          ${CHORD(62, 'whole')}
        </voice>
      </Measure>
      ${measure(CHORD(64, 'whole'))}
    </Staff>`
		}));
		expect(warnings).toEqual([]);
		const [a, b] = sheets[0].sections;
		// A lone :| with no |: means "repeat from the top" — synthesize the
		// opening so playback honors what the barline shows.
		expect(a.repeatStart).toBe(true);
		expect(a.repeatEnd).toBe(true);
		expect(b.repeatStart).toBeUndefined();
		expect(b.repeatEnd).toBeUndefined();
	});

	it('an orphan :| after a pickup repeats the form, not the pickup', () => {
		const { sheets } = parseMscx(mscx({
			staves: `
    <Staff id="1">
      <Measure len="1/4">
        <irregular>1</irregular>
        <voice>
          <TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          ${CHORD(55, 'quarter')}
        </voice>
      </Measure>
      <Measure>
        <voice>
          <RehearsalMark><text>A</text></RehearsalMark>
          ${CHORD(60, 'whole')}
        </voice>
      </Measure>
      <Measure>
        <endRepeat>2</endRepeat>
        <voice>
          ${CHORD(62, 'whole')}
        </voice>
      </Measure>
    </Staff>`
		}));
		const [pickup, a] = sheets[0].sections;
		expect(pickup.label).toBe('Pickup');
		expect(pickup.repeatStart).toBeUndefined();
		expect(a.repeatStart).toBe(true);
		expect(a.repeatEnd).toBe(true);
	});

	it('takes only the first staff of a multi-staff score', () => {
		const { sheets } = parseMscx(mscx({
			staves: `
    <Staff id="1">
      <Measure>
        <voice>
          <TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          ${CHORD(72, 'whole')}
        </voice>
      </Measure>
    </Staff>
    <Staff id="2">
      <Measure>
        <voice>
          <TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          ${CHORD(36, 'whole')}
        </voice>
      </Measure>
    </Staff>`
		}));
		expect(sheets[0].sections[0].notes).toHaveLength(1);
		expect(sheets[0].sections[0].notes[0].pitch).toBe(72);
	});
});

describe('parseMuseScoreFile dispatch', () => {
	it('parses raw .mscx bytes', async () => {
		const xml = mscx({
			staves: `
    <Staff id="1">
      <Measure>
        <voice>
          <TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          ${CHORD(60, 'whole')}
        </voice>
      </Measure>
    </Staff>`
		});
		const result = await parseMuseScoreFile({
			name: 'tune.mscx',
			bytes: new TextEncoder().encode(xml)
		});
		expect(result.sheets).toHaveLength(1);
		expect(result.sheets[0].title).toBe('Unit Tune');
	});

	it('rejects unsupported extensions', async () => {
		const result = await parseMuseScoreFile({ name: 'tune.pdf', bytes: new Uint8Array() });
		expect(result.sheets).toEqual([]);
		expect(result.warnings.length).toBeGreaterThan(0);
	});
});

describe('declared transposition reporting', () => {
	it('reports the melody part\'s declared transposition', () => {
		const transposing = parseMscx(mscx({
			transposeChromatic: -14,
			staves: `
    <Staff id="1">
      <Measure>
        <voice>
          <TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          ${CHORD(60, 'whole')}
        </voice>
      </Measure>
    </Staff>`
		}));
		expect(transposing.declaredTransposition).toBe(-14);

		const concert = parseMscx(mscx({
			staves: `
    <Staff id="1">
      <Measure>
        <voice>
          <TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          ${CHORD(60, 'whole')}
        </voice>
      </Measure>
    </Staff>`
		}));
		expect(concert.declaredTransposition).toBe(0);
	});
});

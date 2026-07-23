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

describe('parseMscx — structure', () => {
	it('splits sections at rehearsal marks and applies repeat barlines', () => {
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
		const sheet = sheets[0];
		expect(sheet.sections.map((s) => [s.label, s.bars])).toEqual([
			['A', 2],
			['B', 2]
		]);
		expect(sheet.sections[0].repeatStart).toBe(true);
		// The endRepeat sits on the B section's first bar — it cannot land on
		// a section boundary here, so it is reported rather than misplaced.
		expect(sheet.sections[1].notes[0].pitch).toBe(64);
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

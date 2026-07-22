import { describe, it, expect } from 'vitest';
import { parseBiabFile, parseBiabMusicXml, importBandInABox } from '$lib/leadsheets/import/biab';

/**
 * Synthetic .SGU built byte-for-byte from the published layout
 * (MuseScore's importexport/bb importer): version, pascal title, 2 pad
 * bytes, style byte (1-based), key byte, u16le tempo, then three RLE
 * streams (bar types, chord extension ids, chord roots) over a 255-bar ×
 * 4-beat grid, then chorus markers.
 */
function syntheticSgu(): Uint8Array {
	const bytes: number[] = [];
	bytes.push(0x44); // version
	const title = 'Test Song';
	bytes.push(title.length);
	for (const ch of title) bytes.push(ch.charCodeAt(0));
	bytes.push(0x00, 0x00); // pad
	bytes.push(0x01); // style 1 = Jazz Swing (4/4)
	bytes.push(0x04); // key 4 = Eb major
	bytes.push(0x8c, 0x00); // tempo 140

	// Bar types: start at bar 1, then skip 254 → done.
	bytes.push(0x01, 0x00, 0xfe);

	// Chord extensions: Maj7 (6) at beat 0, 7 (64) at beats 4 and 8.
	bytes.push(6);
	bytes.push(0x00, 0x03);
	bytes.push(64);
	bytes.push(0x00, 0x03);
	bytes.push(64);
	bytes.push(0x00, 0xff, 0x00, 0xff, 0x00, 0xff, 0x00, 0xf6); // to 1020

	// Roots: C (1) at beat 0, F (6) at beat 4, F/C (240) at beat 8.
	bytes.push(1);
	bytes.push(0x00, 0x03);
	bytes.push(6);
	bytes.push(0x00, 0x03);
	bytes.push(240);
	bytes.push(0x00, 0xff, 0x00, 0xff, 0x00, 0xff, 0x00, 0xf6);

	// Optional pad byte + chorus start/end/repeats.
	bytes.push(0x01, 0x01, 0x03, 0x01);
	return new Uint8Array(bytes);
}

describe('parseBiabFile', () => {
	it('extracts title, key, style, and chords from the binary layout', () => {
		const { sheets, warnings } = parseBiabFile(syntheticSgu());
		expect(sheets).toHaveLength(1);
		const sheet = sheets[0];
		expect(sheet.title).toBe('Test Song');
		expect(sheet.key).toBe('Eb');
		expect(sheet.timeSignature).toEqual([4, 4]);
		expect(sheet.style).toBe('Jazz Swing');
		expect(sheet.source).toBe('imported-biab');
		expect(sheet.sections).toHaveLength(1);
		expect(sheet.sections[0].bars).toBe(3);
		expect(sheet.sections[0].notes).toEqual([]);
		expect(sheet.sections[0].harmony.map((h) => h.symbol)).toEqual(['CΔ7', 'F7', 'F7/C']);
		expect(sheet.sections[0].harmony[1].startOffset).toEqual([1, 1]);
		expect(warnings).toEqual([]);
	});

	it('reads waltz styles as 3/4', () => {
		const bytes = syntheticSgu();
		// Offset 13 = style byte (version + len + 9-char title + 2 pad bytes).
		bytes[13] = 0x08; // style 8 = Waltz
		const { sheets } = parseBiabFile(bytes);
		expect(sheets[0].timeSignature).toEqual([3, 4]);
	});

	it('rejects unknown versions gracefully', () => {
		const bytes = syntheticSgu();
		bytes[0] = 0x99;
		const { sheets, warnings } = parseBiabFile(bytes);
		expect(sheets).toEqual([]);
		expect(warnings.length).toBeGreaterThan(0);
	});
});

const MUSIC_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <work><work-title>Exported Tune</work-title></work>
  <identification><creator type="composer">B. Box</creator></identification>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>-1</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <harmony><root><root-step>D</root-step></root><kind>minor-seventh</kind></harmony>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>8</duration></note>
      <harmony><root><root-step>G</root-step></root><kind>dominant</kind></harmony>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>8</duration></note>
    </measure>
    <measure number="2">
      <harmony>
        <root><root-step>C</root-step></root>
        <kind>major-seventh</kind>
        <bass><bass-step>E</bass-step></bass>
      </harmony>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration></note>
    </measure>
    <measure number="3">
      <harmony><root><root-step>B</root-step><root-alter>-1</root-alter></root><kind>half-diminished</kind></harmony>
    </measure>
  </part>
</score-partwise>`;

describe('parseBiabMusicXml', () => {
	it('extracts metadata, chords, and time signature', () => {
		const { sheets, warnings } = parseBiabMusicXml(MUSIC_XML);
		expect(warnings).toEqual([]);
		expect(sheets).toHaveLength(1);
		const sheet = sheets[0];
		expect(sheet.title).toBe('Exported Tune');
		expect(sheet.composer).toBe('B. Box');
		expect(sheet.timeSignature).toEqual([4, 4]);
		expect(sheet.source).toBe('imported-biab');
		expect(sheet.sections[0].bars).toBe(3);
		expect(sheet.sections[0].harmony.map((h) => h.symbol)).toEqual([
			'D-7',
			'G7',
			'CΔ7/E',
			'Bb-7b5'
		]);
		// Two chords in bar 1 split it evenly.
		expect(sheet.sections[0].harmony[1].startOffset).toEqual([1, 2]);
	});
});

describe('importBandInABox dispatch', () => {
	it('routes .sgu bytes to the binary parser', () => {
		const result = importBandInABox({ name: 'song.SGU', bytes: syntheticSgu() });
		expect(result.sheets[0].title).toBe('Test Song');
	});

	it('routes .xml text to the MusicXML parser', () => {
		const result = importBandInABox({ name: 'song.musicxml', text: MUSIC_XML });
		expect(result.sheets[0].title).toBe('Exported Tune');
	});

	it('warns on unsupported inputs', () => {
		const result = importBandInABox({ name: 'song.pdf' });
		expect(result.sheets).toEqual([]);
		expect(result.warnings.length).toBeGreaterThan(0);
	});
});

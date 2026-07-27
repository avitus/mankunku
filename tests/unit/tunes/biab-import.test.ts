import { describe, it, expect } from 'vitest';
import { parseBiabFile, parseBiabMusicXml, importBandInABox } from '$lib/tunes/import/biab';

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
		expect(sheet.sections[0].harmony.map((h) => h.symbol)).toEqual(['Cmaj7', 'F7', 'F7/C']);
		expect(sheet.sections[0].harmony[1].startOffset).toEqual([1, 1]);
		expect(warnings).toEqual([]);
	});

	it('stores the bare root (+bass) for unmapped extension ids and names the id in a warning', () => {
		const bytes = syntheticSgu();
		// Offset 20 = first chord-extension byte (17-byte header + 3-byte bar
		// stream). 45 is absent from BIAB_CHORD_SUFFIX.
		bytes[20] = 45;
		const { sheets, warnings } = parseBiabFile(bytes);
		const symbols = sheets[0].sections[0].harmony.map((h) => h.symbol);
		// No synthetic `?45` token leaks into the displayed symbol…
		expect(symbols[0]).toBe('C');
		expect(symbols.some((s) => s?.includes('?'))).toBe(false);
		// …and the unknown id is still surfaced in the approximation warning.
		expect(warnings.some((w) => w.includes('Chord type 45'))).toBe(true);
	});

	it('does not add a trailing empty bar when the last chord sits mid-bar', () => {
		// Same layout as syntheticSgu but the last chord lands on beat cell 9
		// (cell 1 of bar 3): the form is still 3 bars, not 4.
		const bytes: number[] = [];
		bytes.push(0x44);
		const title = 'Test Song';
		bytes.push(title.length);
		for (const ch of title) bytes.push(ch.charCodeAt(0));
		bytes.push(0x00, 0x00);
		bytes.push(0x01); // Jazz Swing (4/4)
		bytes.push(0x04); // Eb
		bytes.push(0x8c, 0x00);
		bytes.push(0x01, 0x00, 0xfe); // bar types
		// Extensions at beats 0, 4, 9.
		bytes.push(6);
		bytes.push(0x00, 0x03);
		bytes.push(64);
		bytes.push(0x00, 0x04);
		bytes.push(64);
		bytes.push(0x00, 0xff, 0x00, 0xff, 0x00, 0xff, 0x00, 0xf5); // to 1020
		// Roots at beats 0, 4, 9.
		bytes.push(1);
		bytes.push(0x00, 0x03);
		bytes.push(6);
		bytes.push(0x00, 0x04);
		bytes.push(240);
		bytes.push(0x00, 0xff, 0x00, 0xff, 0x00, 0xff, 0x00, 0xf5);
		bytes.push(0x01, 0x01, 0x03, 0x01); // pad + chorus 1..3 ×1
		const { sheets, warnings } = parseBiabFile(new Uint8Array(bytes));
		expect(warnings).toEqual([]);
		expect(sheets[0].sections[0].bars).toBe(3);
	});

	it('warns once, not per beat cell, when the root/extension streams disagree', () => {
		const bytes = syntheticSgu();
		// Root-stream skip counts sit at offsets 37 and 40 (after the 15-byte
		// extension stream). Shift the 2nd/3rd roots to beats 3 and 8 while
		// the extensions stay on 4 and 8 → two mismatching cells.
		bytes[37] = 0x02;
		bytes[40] = 0x04;
		const { warnings } = parseBiabFile(bytes);
		expect(warnings.filter((w) => w.includes('disagree'))).toHaveLength(1);
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
			'Dm7',
			'G7',
			'Cmaj7/E',
			'Bbm7b5'
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

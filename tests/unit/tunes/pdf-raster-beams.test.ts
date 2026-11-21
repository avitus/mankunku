import { describe, expect, it } from 'vitest';
import { readRasterBeams } from '$lib/tunes/import/pdf-raster-beams';
import type { NoteEvent } from '$lib/tunes/import/pdf-noteheads';
import type { SystemGeometry } from '$lib/tunes/import/pdf-geometry';
import { assembleClaudeDoc } from '$lib/tunes/import/pdf-system-assemble';
import { retainWholePdfBeams } from '$lib/tunes/import/pdf-layout';
import { claudeJsonToTune } from '$lib/tunes/import/claude-pdf';

const geometry: SystemGeometry = {
	band: { top: 50, bottom: 90, lines: [50, 60, 70, 80, 90] }, interline: 10,
	firstBarLeft: 0, barlines: [160], repeatDots: [{ left: false, right: false }]
};

/** Four up-stems; the middle two share a sloped beam and the outside stems are unjoined. */
function scan() {
	const width = 161, height = 120;
	const data = new Uint8ClampedArray(width * height * 4).fill(255);
	function ink(x: number, y: number) {
		data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
	}
	for (const y of geometry.band.lines) for (let x = 0; x < width; x++) ink(x, y);
	const stems = [[20, 39], [55, 39], [90, 33], [125, 39]];
	for (const [x, top] of stems) for (let y = top; y <= 80; y++) ink(x, y);
	for (let x = 55; x <= 90; x++) {
		const top = Math.round(39 - (x - 55) * 6 / 35);
		for (let y = top; y < top + 5; y++) ink(x, y);
	}
	const heads: NoteEvent[] = stems.map(([anchorX]) => ({ x: anchorX - 4, anchorX, position: 2, kind: 'stemmed' }));
	readRasterBeams(heads, { width, height, data }, geometry);
	return heads;
}

describe('printed primary beams', () => {
	it('finds a sloping beam and does not connect isolated flags through a staff rule', () => {
		expect(scan().map(h => h.beamFromPrevious)).toEqual([undefined, 'break', 'join', 'break']);
	});

	it('repairs the whole-page reader’s beat-boundary split only when every written pitch agrees', () => {
		const doc = {
			title: 'Beam review', key: 'C', timeSignature: [4, 4],
			sections: [{ label: '', bars: 1, chords: [], melody: [0, 0.5, 1, 1.5].map(beat => ({
				bar: 0, beat, durationBeats: 0.5, pitch: 'G4'
			})) }]
		};
		const sheet = claudeJsonToTune(doc).sheet!;
		const notes = sheet.sections[0].notes;
		notes[2].beamFromPrevious = 'break';
		const systems = [{ geometry, noteEvents: scan() }];
		notes[0].pitch = 69;
		retainWholePdfBeams(sheet, systems);
		expect(notes[2].beamFromPrevious).toBe('break');
		notes[0].pitch = 67;
		retainWholePdfBeams(sheet, systems);
		expect(notes[2].beamFromPrevious).toBe('join');
	});

	it('transfers connections to short notes only when the full measured bar matches', () => {
		function connections(secondPitch: string) {
			const doc = assembleClaudeDoc([{
				geometry, texts: { chords: [], marks: [], endings: [], barNumber: null }, noteEvents: scan(),
				model: { fifths: 0, clef: 'treble', bars: [{
					pickup: false, startRepeat: false, endRepeat: false, ending: null,
					melody: [[0, 0.5, 'G4'], [0.5, 0.5, secondPitch], [1, 0.5, 'G4'], [1.5, 0.5, 'G4'], [2, 2, 'rest']]
				}] }
			}], { title: 'Flags and beams', timeSignature: [4, 4] });
			return claudeJsonToTune(doc).sheet!.sections[0].notes.map(n => n.beamFromPrevious);
		}
		expect(connections('G4')).toEqual([undefined, 'break', 'join', 'break']);
		expect(connections('A4')).toEqual([undefined, undefined, undefined, undefined]);
	});
});

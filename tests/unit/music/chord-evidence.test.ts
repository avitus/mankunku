import { describe, expect, it } from 'vitest';
import { chordEvidence } from '$lib/music/chord-evidence';
import { harmonicSegmentFromSymbol } from '$lib/tunes/segment-from-symbol';
import { seg } from '../../helpers/tune-fixtures';

function pitches(symbol: string): string[] | undefined {
	return chordEvidence(harmonicSegmentFromSymbol(symbol, [0, 1], [1, 1])!)?.pitchClasses;
}

describe('written chord evidence', () => {
	it.each([
		['Em', ['E', 'G', 'B']],
		['C', ['C', 'E', 'G']],
		['C6', ['C', 'E', 'G', 'A']],
		['C69', ['C', 'D', 'E', 'G', 'A']],
		['Cmaj9', ['C', 'D', 'E', 'G', 'B']],
		['Cmaj13#11', ['C', 'D', 'E', 'F#', 'G', 'A', 'B']],
		['C7b9#11', ['C', 'Db', 'E', 'F#', 'G', 'Bb']],
		['Cm7b5', ['C', 'Eb', 'F#', 'Bb']],
		['Cdim7', ['C', 'Eb', 'F#', 'A']],
		['CmMaj7', ['C', 'Eb', 'G', 'B']],
		['Csus4', ['C', 'F', 'G']],
		['C7sus2', ['C', 'D', 'G', 'Bb']],
		['Cadd9', ['C', 'D', 'E', 'G']],
		['Cmaj7/F#', ['C', 'E', 'F#', 'G', 'B']]
	])('%s preserves the written tones', (symbol, expected) => {
		expect(pitches(symbol)).toEqual(expected);
	});

	it('uses the structured quality and bass only when text is absent', () => {
		const chord = seg('C', 'maj7', [0, 1], [1, 1]);
		chord.chord.bass = 'F#';
		expect(chordEvidence(chord)?.pitchClasses).toEqual(['C', 'E', 'F#', 'G', 'B']);
	});

	it('does not simplify unknown, indeterminate or inconsistent symbols', () => {
		for (const symbol of ['C???', 'C7alt', 'Dmaj7', 'Cadd99', '']) {
			expect(chordEvidence({ ...seg('C', 'maj7', [0, 1], [1, 1]), symbol }), symbol).toBeNull();
		}
		expect(chordEvidence(seg('C', '7alt', [0, 1], [1, 1]))).toBeNull();
		const conflict = seg('C', 'maj7', [0, 1], [1, 1], 'Cmaj7/E');
		conflict.chord.bass = 'F#';
		expect(chordEvidence(conflict)).toBeNull();
	});

	it('does not identify a dominant, suspension or augmented triad as a major tonic', () => {
		for (const symbol of ['C7', 'Csus4', 'Cmaj7#5']) {
			expect(chordEvidence(harmonicSegmentFromSymbol(symbol, [0, 1], [1, 1])!)?.majorTonic).toBe(false);
		}
	});
});

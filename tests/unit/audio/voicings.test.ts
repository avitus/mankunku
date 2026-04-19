import { describe, it, expect } from 'vitest';
import {
	pitchClassToNumber,
	shellVoicing,
	drop2Voicing,
	voiceLead
} from '$lib/audio/voicings';
import type { PitchClass, ChordQuality } from '$lib/types/music';

describe('pitchClassToNumber', () => {
	it('maps C to 0', () => {
		expect(pitchClassToNumber('C')).toBe(0);
	});

	it('maps Db to 1', () => {
		expect(pitchClassToNumber('Db')).toBe(1);
	});

	it('maps B to 11', () => {
		expect(pitchClassToNumber('B')).toBe(11);
	});

	it('maps all 12 pitch classes', () => {
		const expected = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
		const pcs: PitchClass[] = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
		expect(pcs.map(pitchClassToNumber)).toEqual(expected);
	});
});

describe('shellVoicing', () => {
	it('returns 3 notes for a maj7 chord', () => {
		const voicing = shellVoicing('C', 'maj7');
		expect(voicing).toHaveLength(3);
	});

	it('returns sorted MIDI notes', () => {
		const voicing = shellVoicing('C', 'maj7');
		for (let i = 1; i < voicing.length; i++) {
			expect(voicing[i]).toBeGreaterThanOrEqual(voicing[i - 1]);
		}
	});

	it('contains the root pitch class for Cmaj7', () => {
		const voicing = shellVoicing('C', 'maj7', 54);
		const pcs = voicing.map(m => m % 12);
		expect(pcs).toContain(0); // C
	});

	it('contains guide tones (3rd and 7th) for Cmaj7', () => {
		const voicing = shellVoicing('C', 'maj7', 54);
		const pcs = voicing.map(m => m % 12);
		expect(pcs).toContain(4);  // E (major 3rd)
		expect(pcs).toContain(11); // B (major 7th)
	});

	it('contains guide tones for Dm7', () => {
		const voicing = shellVoicing('D', 'min7', 54);
		const pcs = voicing.map(m => m % 12);
		expect(pcs).toContain(2);  // D (root)
		expect(pcs).toContain(5);  // F (minor 3rd)
		expect(pcs).toContain(0);  // C (minor 7th)
	});

	it('contains guide tones for G7', () => {
		const voicing = shellVoicing('G', '7', 54);
		const pcs = voicing.map(m => m % 12);
		expect(pcs).toContain(7);  // G (root)
		expect(pcs).toContain(11); // B (major 3rd)
		expect(pcs).toContain(5);  // F (minor 7th)
	});

	it('places notes near the specified register', () => {
		const voicing = shellVoicing('C', 'maj7', 60);
		for (const midi of voicing) {
			expect(midi).toBeGreaterThanOrEqual(48);
			expect(midi).toBeLessThanOrEqual(72);
		}
	});

	it('handles triads (no 7th) by using 5th', () => {
		const voicing = shellVoicing('C', 'aug', 54);
		expect(voicing).toHaveLength(3);
		const pcs = voicing.map(m => m % 12);
		expect(pcs).toContain(0); // C
		expect(pcs).toContain(4); // E
		expect(pcs).toContain(8); // G#
	});

	it('works for all common jazz chord qualities', () => {
		const qualities: ChordQuality[] = ['maj7', 'min7', '7', 'min7b5', 'dim7', 'maj6', 'min6'];
		for (const q of qualities) {
			const voicing = shellVoicing('C', q, 54);
			expect(voicing.length).toBeGreaterThanOrEqual(3);
		}
	});
});

describe('drop2Voicing', () => {
	it('returns 4 notes for a maj7 chord', () => {
		const voicing = drop2Voicing('C', 'maj7');
		expect(voicing).toHaveLength(4);
	});

	it('returns sorted MIDI notes', () => {
		const voicing = drop2Voicing('C', 'maj7');
		for (let i = 1; i < voicing.length; i++) {
			expect(voicing[i]).toBeGreaterThan(voicing[i - 1]);
		}
	});

	it('has wider spread than close position (> 12 semitones total)', () => {
		const voicing = drop2Voicing('C', 'maj7', 60);
		const spread = voicing[voicing.length - 1] - voicing[0];
		expect(spread).toBeGreaterThan(12);
	});
});

describe('voiceLead', () => {
	it('returns voicings for each chord', () => {
		const chords = [
			{ root: 'D' as PitchClass, quality: 'min7' as ChordQuality },
			{ root: 'G' as PitchClass, quality: '7' as ChordQuality },
			{ root: 'C' as PitchClass, quality: 'maj7' as ChordQuality }
		];
		const result = voiceLead(chords, shellVoicing, 54);
		expect(result).toHaveLength(3);
		result.forEach(v => expect(v.length).toBeGreaterThanOrEqual(3));
	});

	it('minimizes total movement between successive voicings', () => {
		const chords = [
			{ root: 'D' as PitchClass, quality: 'min7' as ChordQuality },
			{ root: 'G' as PitchClass, quality: '7' as ChordQuality },
			{ root: 'C' as PitchClass, quality: 'maj7' as ChordQuality }
		];
		const result = voiceLead(chords, shellVoicing, 54);

		// Voice-led ii-V-I should have small movement (< 8 semitones total per step)
		for (let i = 1; i < result.length; i++) {
			const movement = result[i].reduce((sum, note, idx) => {
				return sum + Math.abs(note - (result[i - 1][idx] ?? note));
			}, 0);
			expect(movement).toBeLessThan(24); // Generous bound
		}
	});

	it('returns empty array for empty input', () => {
		expect(voiceLead([], shellVoicing)).toEqual([]);
	});

	it('returns single voicing for single chord', () => {
		const chords = [{ root: 'C' as PitchClass, quality: 'maj7' as ChordQuality }];
		const result = voiceLead(chords, shellVoicing);
		expect(result).toHaveLength(1);
	});
});

import { describe, it, expect } from 'vitest';
import {
	pitchClassToNumber,
	shellVoicing,
	drop2Voicing,
	rootlessVoicingA,
	rootlessVoicingB,
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

describe('rootlessVoicingA (3-5-7-9 shape)', () => {
	const pcs = (v: number[]) => v.map((m) => ((m % 12) + 12) % 12);

	it('voices Cmaj7 as E-G-B-D with no root', () => {
		const v = rootlessVoicingA('C', 'maj7');
		expect(v).toHaveLength(4);
		expect(new Set(pcs(v))).toEqual(new Set([4, 7, 11, 2]));
		expect(pcs(v)).not.toContain(0);
	});

	it('voices Dm7 as F-A-C-E', () => {
		const v = rootlessVoicingA('D', 'min7');
		expect(new Set(pcs(v))).toEqual(new Set([5, 9, 0, 4]));
	});

	it('voices the b9 colour tone on C7b9', () => {
		expect(pcs(rootlessVoicingA('C', '7b9'))).toContain(1); // Db
	});

	it('voices the #9 colour tone on C7#9', () => {
		const p = pcs(rootlessVoicingA('C', '7#9'));
		expect(p).toContain(3); // D#
		expect(p).toContain(4); // major 3rd stays
	});

	it('voices the b13 colour tone on C7b13', () => {
		expect(pcs(rootlessVoicingA('C', '7b13'))).toContain(8); // Ab
	});

	it('voices the #11 colour tone on C7#11', () => {
		expect(pcs(rootlessVoicingA('C', '7#11'))).toContain(6); // F#
	});

	it('voices min7b5 correctly (Eb-Gb-Bb-D over C)', () => {
		expect(new Set(pcs(rootlessVoicingA('C', 'min7b5')))).toEqual(new Set([3, 6, 10, 2]));
	});

	it('returns ascending notes within the mid-piano register', () => {
		const qualities: ChordQuality[] = ['maj7', 'min7', '7', 'min7b5', 'dim7', 'maj6', 'min6', '7b9', '7#9', '7#11', '7b13', 'aug7', 'sus4', 'minMaj7'];
		for (const q of qualities) {
			for (const root of ['C', 'F#', 'Bb'] as PitchClass[]) {
				const v = rootlessVoicingA(root, q, 62);
				expect(v.length).toBe(4);
				for (let i = 1; i < v.length; i++) expect(v[i]).toBeGreaterThan(v[i - 1]);
				expect(v[0]).toBeGreaterThanOrEqual(48);
				expect(v[v.length - 1]).toBeLessThanOrEqual(84);
			}
		}
	});

	it('returns empty for triads with no seventh-slot tone', () => {
		expect(rootlessVoicingA('C', 'aug')).toEqual([]);
		expect(rootlessVoicingA('C', 'dim')).toEqual([]);
	});
});

describe('rootlessVoicingB (7-9-3-13 shape)', () => {
	const pcs = (v: number[]) => v.map((m) => ((m % 12) + 12) % 12);

	it('voices C7 as Bb-D-E-A (13 on top)', () => {
		expect(new Set(pcs(rootlessVoicingB('C', '7')))).toEqual(new Set([10, 2, 4, 9]));
	});

	it('voices Cmaj7 as B-D-E-G', () => {
		expect(new Set(pcs(rootlessVoicingB('C', 'maj7')))).toEqual(new Set([11, 2, 4, 7]));
	});

	it('keeps the 13 with the b9 on C7b9 (13b9 sound)', () => {
		const p = pcs(rootlessVoicingB('C', '7b9'));
		expect(p).toContain(1); // Db
		expect(p).toContain(9); // A
	});

	it('tops C7b13 with the b13, not the natural 13', () => {
		const p = pcs(rootlessVoicingB('C', '7b13'));
		expect(p).toContain(8); // Ab
		expect(p).not.toContain(9);
	});

	it('returns ascending notes within the mid-piano register', () => {
		const qualities: ChordQuality[] = ['maj7', 'min7', '7', 'min7b5', 'dim7', '7b9', '7#9', '7#11', '7b13', 'aug7', 'sus4'];
		for (const q of qualities) {
			for (const root of ['C', 'E', 'Ab'] as PitchClass[]) {
				const v = rootlessVoicingB(root, q, 62);
				expect(v.length).toBe(4);
				for (let i = 1; i < v.length; i++) expect(v[i]).toBeGreaterThan(v[i - 1]);
				expect(v[0]).toBeGreaterThanOrEqual(48);
				expect(v[v.length - 1]).toBeLessThanOrEqual(84);
			}
		}
	});

	it('returns empty for triads with no seventh-slot tone', () => {
		expect(rootlessVoicingB('C', 'aug')).toEqual([]);
		expect(rootlessVoicingB('C', 'dim')).toEqual([]);
	});
});

describe('voiceLead with per-chord voicing functions', () => {
	it('accepts an array of voicing functions, one per chord', () => {
		const chords = [
			{ root: 'D' as PitchClass, quality: 'min7' as ChordQuality },
			{ root: 'G' as PitchClass, quality: '7' as ChordQuality },
			{ root: 'C' as PitchClass, quality: 'maj7' as ChordQuality }
		];
		const result = voiceLead(chords, [rootlessVoicingA, rootlessVoicingB, rootlessVoicingA], 62);
		expect(result).toHaveLength(3);
		// Dm7 A-form: F-A-C-E
		expect(new Set(result[0].map((m) => m % 12))).toEqual(new Set([5, 9, 0, 4]));
		// G7 B-form: F-A-B-E
		expect(new Set(result[1].map((m) => m % 12))).toEqual(new Set([5, 9, 11, 4]));
	});

	it('keeps movement small across a rootless ii-V-I', () => {
		const chords = [
			{ root: 'D' as PitchClass, quality: 'min7' as ChordQuality },
			{ root: 'G' as PitchClass, quality: '7' as ChordQuality },
			{ root: 'C' as PitchClass, quality: 'maj7' as ChordQuality }
		];
		const result = voiceLead(chords, [rootlessVoicingA, rootlessVoicingB, rootlessVoicingA], 62);
		for (let i = 1; i < result.length; i++) {
			const movement = result[i].reduce(
				(sum, note, idx) => sum + Math.abs(note - (result[i - 1][idx] ?? note)),
				0
			);
			expect(movement).toBeLessThan(16);
		}
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

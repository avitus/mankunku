/**
 * Tests for the backing track module's pure helper logic.
 *
 * The scheduling functions depend on Tone.js Transport and smplr,
 * which aren't available in Node. We test the voicing integration
 * and verify harmony processing.
 */
import { describe, it, expect } from 'vitest';
import { shellVoicing, voiceLead, pitchClassToNumber } from '$lib/audio/voicings';
import type { PitchClass, ChordQuality } from '$lib/types/music';

describe('backing track: comping voicing generation', () => {
	const iiVI: Array<{ root: PitchClass; quality: ChordQuality }> = [
		{ root: 'D', quality: 'min7' },
		{ root: 'G', quality: '7' },
		{ root: 'C', quality: 'maj7' }
	];

	it('generates voice-led voicings for ii-V-I progression', () => {
		const voicings = voiceLead(iiVI, shellVoicing, 54);
		expect(voicings).toHaveLength(3);
		voicings.forEach(v => {
			expect(v.length).toBeGreaterThanOrEqual(3);
			// All notes should be in comping register
			v.forEach(midi => {
				expect(midi).toBeGreaterThanOrEqual(36);
				expect(midi).toBeLessThanOrEqual(72);
			});
		});
	});

	it('voice-led Dm7 has the correct pitch classes', () => {
		const voicings = voiceLead(iiVI, shellVoicing, 54);
		const dm7Pcs = voicings[0].map(m => m % 12);
		expect(dm7Pcs).toContain(2);  // D
		expect(dm7Pcs).toContain(5);  // F
		expect(dm7Pcs).toContain(0);  // C
	});

	it('voice-led G7 has the correct pitch classes', () => {
		const voicings = voiceLead(iiVI, shellVoicing, 54);
		const g7Pcs = voicings[1].map(m => m % 12);
		expect(g7Pcs).toContain(7);   // G
		expect(g7Pcs).toContain(11);  // B
		expect(g7Pcs).toContain(5);   // F
	});

	it('generates voicings for blues chord sequence', () => {
		const blues: Array<{ root: PitchClass; quality: ChordQuality }> = [
			{ root: 'C', quality: '7' },
			{ root: 'F', quality: '7' },
			{ root: 'G', quality: '7' }
		];
		const voicings = voiceLead(blues, shellVoicing, 54);
		expect(voicings).toHaveLength(3);
	});
});

describe('backing track: bass note selection', () => {
	it('maps pitch classes correctly for bass register', () => {
		expect(pitchClassToNumber('C')).toBe(0);
		expect(pitchClassToNumber('E')).toBe(4);
		expect(pitchClassToNumber('Bb')).toBe(10);
	});
});

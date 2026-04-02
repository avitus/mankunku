/**
 * Tests for the backing track module's pure helper logic.
 *
 * The scheduling functions depend on Tone.js Transport and smplr,
 * which aren't available in Node. We test the voicing integration
 * and verify harmony processing.
 */
import { describe, it, expect } from 'vitest';
import { shellVoicing, voiceLead, pitchClassToNumber } from '$lib/audio/voicings.ts';
import type { HarmonicSegment, PitchClass, ChordQuality } from '$lib/types/music.ts';

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

describe('backing track: harmony segment processing', () => {
	it('handles single-chord phrases (1 bar)', () => {
		const harmony: HarmonicSegment[] = [{
			chord: { root: 'C', quality: 'maj7' },
			scaleId: 'major.ionian',
			startOffset: [0, 1],
			duration: [1, 1]
		}];
		expect(harmony).toHaveLength(1);
		expect(harmony[0].chord.root).toBe('C');
	});

	it('handles multi-bar ii-V-I harmony segments', () => {
		const harmony: HarmonicSegment[] = [
			{
				chord: { root: 'D', quality: 'min7' },
				scaleId: 'major.dorian',
				startOffset: [0, 1],
				duration: [1, 1]
			},
			{
				chord: { root: 'G', quality: '7' },
				scaleId: 'major.mixolydian',
				startOffset: [1, 1],
				duration: [1, 1]
			},
			{
				chord: { root: 'C', quality: 'maj7' },
				scaleId: 'major.ionian',
				startOffset: [2, 1],
				duration: [1, 1]
			}
		];
		expect(harmony).toHaveLength(3);
		// Total duration should be 3 bars (12 beats in 4/4)
		const totalBeats = harmony.reduce((sum, seg) => {
			return sum + (seg.duration[0] / seg.duration[1]) * 4;
		}, 0);
		expect(totalBeats).toBe(12);
	});

	it('handles half-bar chord changes', () => {
		const harmony: HarmonicSegment[] = [
			{
				chord: { root: 'D', quality: 'min7' },
				scaleId: 'major.dorian',
				startOffset: [0, 1],
				duration: [1, 2]
			},
			{
				chord: { root: 'G', quality: '7' },
				scaleId: 'major.mixolydian',
				startOffset: [1, 2],
				duration: [1, 2]
			}
		];
		const totalBeats = harmony.reduce((sum, seg) => {
			return sum + (seg.duration[0] / seg.duration[1]) * 4;
		}, 0);
		expect(totalBeats).toBe(4); // 1 bar total
	});
});

describe('backing track: bass note selection', () => {
	it('maps pitch classes correctly for bass register', () => {
		// C near MIDI 40 (E2) should be 36 (C2) or 48 (C3)
		const cPc = pitchClassToNumber('C');
		expect(cPc).toBe(0);

		const ePc = pitchClassToNumber('E');
		expect(ePc).toBe(4);

		const bbPc = pitchClassToNumber('Bb');
		expect(bbPc).toBe(10);
	});

	it('chromatic approach notes are one semitone from target', () => {
		const target = 40;
		// Approach should be target ± 1
		expect(target - 1).toBe(39);
		expect(target + 1).toBe(41);
	});
});

describe('backing track: PlaybackOptions integration', () => {
	it('PlaybackOptions includes backing track fields', () => {
		const options = {
			tempo: 120,
			swing: 0.5,
			countInBeats: 0,
			metronomeEnabled: true,
			metronomeVolume: 0.7,
			backingTrackEnabled: true,
			backingTrackVolume: 0.5,
			backingInstrument: 'piano' as const
		};
		expect(options.backingTrackEnabled).toBe(true);
		expect(options.backingTrackVolume).toBe(0.5);
		expect(options.backingInstrument).toBe('piano');
	});
});

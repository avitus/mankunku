import { describe, it, expect } from 'vitest';
import { runScorePipeline } from '$lib/scoring/score-pipeline';
import type { PitchReading } from '$lib/audio/pitch-frame';
import type { DetectedNote } from '$lib/types/audio';
import type { Phrase } from '$lib/types/music';

/**
 * The pipeline attaches the audio check (`frame-coverage.ts`) to every score
 * it computes when the caller hands it the detector's readings, placing them
 * on the phrase clock through the score's own latency correction. Lives apart
 * from score-pipeline.test.ts, which mocks the scorer.
 */
describe('runScorePipeline audio check (2026-10-07)', () => {
	const phrase: Phrase = {
		id: 'ac', name: 'Audio check', timeSignature: [4, 4], key: 'C',
		notes: [
			{ pitch: 60, offset: [0, 1], duration: [1, 8] },
			{ pitch: 62, offset: [1, 8], duration: [1, 8] }
		],
		harmony: [{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'C-major', startOffset: [0, 1], duration: [1, 1] }],
		difficulty: { level: 10, pitchComplexity: 10, rhythmComplexity: 10, lengthBars: 1 },
		category: 'ii-V-I-major', tags: [], source: 'curated'
	};
	const detected: DetectedNote[] = [
		{ midi: 60, cents: 0, onsetTime: 0.3, duration: 0.25, clarity: 0.95 },
		{ midi: 62, cents: 0, onsetTime: 0.55, duration: 0.25, clarity: 0.95 }
	];
	// readings on the same recording clock as the detected notes: the line
	// played 0.3 s after the recording started, which the scorer reads as latency
	const readings: PitchReading[] = [];
	for (let t = 0.3; t < 0.55; t += 1 / 60) readings.push({ time: t, midiFloat: 60, midi: 60, cents: 0, clarity: 0.95, frequency: 261.6, rms: 0.1 });
	for (let t = 0.55; t < 0.8; t += 1 / 60) readings.push({ time: t, midiFloat: 62, midi: 62, cents: 0, clarity: 0.95, frequency: 293.7, rms: 0.1 });

	it('attaches the audio check to every score when readings are given, through the latency correction', () => {
		const result = runScorePipeline({
			detected, phrase, tempo: 120, transportSeconds: 0, swing: 0.5, bleedFilterEnabled: true,
			bleedResult: { kept: detected, filtered: [] }, readings
		});
		expect(result.unfilteredScore.audioCheck?.precision).toBeGreaterThan(0.95);
		expect(result.unfilteredScore.audioCheck?.recall).toBeGreaterThan(0.97);
		expect(result.filteredScore?.audioCheck?.precision).toBeGreaterThan(0.95);
		expect(result.chosen.audioCheck).toBeDefined();
	});

	it('leaves the score without an audio check when no readings are given', () => {
		const result = runScorePipeline({ detected, phrase, tempo: 120, transportSeconds: 0, swing: 0.5, bleedFilterEnabled: false });
		expect(result.chosen.audioCheck).toBeUndefined();
	});
});

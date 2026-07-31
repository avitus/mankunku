import { describe, it, expect } from 'vitest';
import type { DetectedNote } from '$lib/types/audio';
import type { Phrase } from '$lib/types/music';
import { runScorePipeline } from '$lib/scoring/score-pipeline';
import { transposeLick } from '$lib/phrases/library-loader';
import { fractionToFloat } from '$lib/music/intervals';
import { makePhrase } from '../helpers/lick-builders';

/**
 * Tune-practice window scoring, end to end through the real pipeline: the
 * expected phrase is a lick transposed to the insertion point's target key
 * (exactly what `expectedForWindow` produces), and the detected notes are
 * synthetic mic captures in window-local time (exactly what the route's
 * close handler feeds `runScorePipeline` after rebasing).
 */

const TEMPO = 100;

/** Simulate a clean take of `phrase`: window-local onsets + a constant mic latency. */
function detectedFromPhrase(phrase: Phrase, latencySec: number): DetectedNote[] {
	const secondsPerWhole = 4 * (60 / TEMPO);
	const out: DetectedNote[] = [];
	for (const note of phrase.notes) {
		if (note.pitch === null) continue;
		out.push({
			midi: note.pitch,
			cents: 0,
			onsetTime: fractionToFloat(note.offset) * secondsPerWhole + latencySec,
			duration: fractionToFloat(note.duration) * secondsPerWhole * 0.9,
			clarity: 0.95
		});
	}
	return out;
}

function scoreTake(expected: Phrase, detected: DetectedNote[]) {
	return runScorePipeline({
		detected,
		phrase: expected,
		tempo: TEMPO,
		transportSeconds: 0,
		swing: 0.5,
		bleedFilterEnabled: false,
		bleedResult: null,
		octaveInsensitive: true
	});
}

describe('tune-practice window scoring', () => {
	const lick = makePhrase({ id: 'window-lick', name: 'Window Lick' });

	it('scores a clean take of the transposition-target phrase high', () => {
		const expected = transposeLick(lick, 'Bb');
		const result = scoreTake(expected, detectedFromPhrase(expected, 0.08));
		expect(result.chosen.pitchAccuracy).toBeGreaterThan(0.9);
		expect(result.chosen.overall).toBeGreaterThan(0.85);
	});

	it('playing the untransposed lick against the transposed target tanks pitch accuracy', () => {
		const expected = transposeLick(lick, 'Bb');
		// The user plays the lick in its stored key (C) instead of the spot's Bb.
		const wrongKeyTake = detectedFromPhrase(lick, 0.08);
		const result = scoreTake(expected, wrongKeyTake);
		expect(result.chosen.pitchAccuracy).toBeLessThan(0.5);
	});

	it('absorbs a constant window-open latency via the scorer median correction', () => {
		const expected = transposeLick(lick, 'F');
		const lateTake = detectedFromPhrase(expected, 0.35);
		const result = scoreTake(expected, lateTake);
		expect(result.chosen.rhythmAccuracy).toBeGreaterThan(0.85);
		expect(result.chosen.overall).toBeGreaterThan(0.85);
	});
});

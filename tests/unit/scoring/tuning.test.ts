import { describe, expect, it } from 'vitest';
import { createTuningMonitor } from '$lib/scoring/tuning';
import { runScorePipeline } from '$lib/scoring/score-pipeline';
import type { DetectedNote } from '$lib/types/audio';
import type { Phrase } from '$lib/types/music';
import type { NoteResult } from '$lib/types/scoring';

/** Build a matched note, allowing tests to vary the reliability of its detection. */
function note(pitch: number, cents: number, overrides: Partial<DetectedNote> = {}): NoteResult {
	return {
		expected: { pitch, offset: [0, 1], duration: [1, 4] },
		detected: { midi: pitch, cents, onsetTime: 0, duration: 0.4, clarity: 0.98, ...overrides },
		pitchScore: 1, rhythmScore: 1, missed: false, extra: false
	};
}

/** Distribute cents offsets across a repeatable set of concert pitches. */
function take(cents: number[], pitches = [60, 62, 64]): { noteResults: NoteResult[] } {
	return { noteResults: cents.map((c, i) => note(pitches[i % pitches.length], c)) };
}

describe('ear-training tuning feedback', () => {
	it.each([1, -1])('waits for three takes, then reports a consistent offset (sign %s)', sign => {
		const monitor = createTuningMonitor();
		const score = take([18, 20, 22].map(c => c * sign));
		expect(monitor.record(score)).toBeNull();
		expect(monitor.record(score)).toBeNull();
		expect(monitor.record(score)).toEqual({ direction: sign > 0 ? 'sharp' : 'flat', cents: 20 * sign });
	});

	it('accumulates different pitches across short phrases', () => {
		const monitor = createTuningMonitor();
		expect(monitor.record(take([20, 21], [60]))).toBeNull();
		expect(monitor.record(take([22, 23], [62]))).toBeNull();
		expect(monitor.record(take([24, 25], [64]))).toMatchObject({ direction: 'sharp' });
	});

	it.each([
		['in tune', [0, -3, 4]],
		['below the threshold', [14, 14, 14]],
		['opposing deviations', [-25, 25, -20, 20]],
		['one bent note', [0, 0, 35]],
		['scattered sharp intonation', [10, 25, 48]]
	])('stays quiet for %s', (_label, offsets) => {
		const monitor = createTuningMonitor();
		for (let i = 0; i < 5; i++) expect(monitor.record(take(offsets as number[]))).toBeNull();
	});

	it.each([15, -15])('includes the alert boundary at %s cents', cents => {
		const monitor = createTuningMonitor();
		monitor.record(take([cents, cents, cents]));
		monitor.record(take([cents, cents, cents]));
		expect(monitor.record(take([cents, cents, cents]))).toMatchObject({ cents });
	});

	it('does not mistake repetitions or octaves of one note for scale-wide tuning', () => {
		const monitor = createTuningMonitor();
		for (let i = 0; i < 5; i++) {
			expect(monitor.record(take([22, 22, 22, 22], [60, 72, 84]))).toBeNull();
		}
	});

	it('does not let one often-repeated sharp note outweigh other in-tune pitches', () => {
		const monitor = createTuningMonitor();
		const score = { noteResults: [...Array.from({ length: 20 }, () => note(60, 25)), note(62, 0), note(64, 0)] };
		for (let i = 0; i < 5; i++) expect(monitor.record(score)).toBeNull();
	});

	it('does not let one long sharp take outweigh two in-tune takes', () => {
		const monitor = createTuningMonitor();
		monitor.record(take([0, 0]));
		monitor.record(take([0, 0]));
		expect(monitor.record(take(Array(30).fill(22)))).toBeNull();
	});

	it.each([
		{ clarity: 0.8 }, { duration: 0.05 }, { ghost: true as const },
		{ cents: NaN }, { cents: Infinity }, { cents: 51 },
		{ clarity: NaN }, { duration: NaN }, { midi: 61 }
	])('excludes unreliable or wrong-pitch evidence: %j', overrides => {
		const monitor = createTuningMonitor();
		const score = { noteResults: [note(60, 22), note(62, 22), note(64, 22, overrides)] };
		for (let i = 0; i < 5; i++) expect(monitor.record(score)).toBeNull();
	});

	it('excludes rests, extras and missed notes', () => {
		const monitor = createTuningMonitor();
		const score = { noteResults: [
			note(60, 22), note(62, 22),
			{ ...note(64, 22), extra: true },
			{ ...note(65, 22), missed: true, detected: null },
			{ ...note(67, 22), expected: { pitch: null, offset: [0, 1] as [number, number], duration: [1, 4] as [number, number] } }
		] };
		for (let i = 0; i < 5; i++) expect(monitor.record(score)).toBeNull();
	});

	it.each([
		['in-tune', take([0, 2, -2])],
		['opposite direction', take([-22, -22, -22])],
		['silent', { noteResults: [] }],
		['insufficient', take([22])]
	])('clears stale advice on the next %s take', (_label, score) => {
		const monitor = createTuningMonitor();
		for (let i = 0; i < 3; i++) monitor.record(take([22, 22, 22]));
		expect(monitor.record(score)).toBeNull();
	});

	it('ages out earlier tuning and can detect an offset in the opposite direction', () => {
		const monitor = createTuningMonitor();
		for (let i = 0; i < 5; i++) monitor.record(take([22, 22, 22]));
		for (let i = 0; i < 5; i++) monitor.record(take([-22, -22, -22]));
		expect(monitor.record(take([-22, -22, -22]))).toEqual({ direction: 'flat', cents: -22 });
	});

	it('does not carry tuning evidence into a restarted run', () => {
		const monitor = createTuningMonitor();
		for (let i = 0; i < 3; i++) monitor.record(take([22, 22, 22]));
		monitor.reset();
		expect(monitor.record(take([22, 22, 22]))).toBeNull();
	});

	it('uses the final bleed-filtered score without changing scores or note data', () => {
		const phrase: Phrase = {
			id: 'tuning-test', name: 'Tuning test', key: 'C', category: 'blues', harmony: [], tags: [], source: 'curated',
			timeSignature: [4, 4],
			difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
			notes: [60, 62, 64].map((pitch, i) => ({ pitch, offset: [i, 4], duration: [1, 4] }))
		};
		const detected = phrase.notes.map((n, i) => ({ ...note(n.pitch!, 22).detected!, onsetTime: i * 0.5 }));
		const result = runScorePipeline({
			phrase, detected, tempo: 120, transportSeconds: 0, swing: 0.5,
			bleedFilterEnabled: true, bleedResult: { kept: detected, filtered: [] }
		});
		const snapshot = structuredClone(result);
		const monitor = createTuningMonitor();
		monitor.record(result.chosen);
		monitor.record(result.chosen);
		expect(monitor.record(result.chosen)).toEqual({ direction: 'sharp', cents: 22 });
		expect(result).toEqual(snapshot);
		expect(result.chosen.pitchAccuracy).toBe(1);
	});
});

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
		['below the threshold', [11, 11, 11]],
		['opposing deviations', [-25, 25, -20, 20]],
		['one bent note', [0, 0, 35]],
		['scattered sharp intonation', [10, 25, 48]]
	])('stays quiet for %s', (_label, offsets) => {
		const monitor = createTuningMonitor();
		for (let i = 0; i < 5; i++) expect(monitor.record(take(offsets as number[]))).toBeNull();
	});

	it.each([12, -12])('includes the alert boundary at %s cents', cents => {
		const monitor = createTuningMonitor();
		monitor.record(take([cents, cents, cents]));
		monitor.record(take([cents, cents, cents]));
		expect(monitor.record(take([cents, cents, cents]))).toMatchObject({ cents });
	});

	it('2026-10-06 Eb run: takes that scatter around a sharp centre still earn the cue', () => {
		// Every fader on pause read 14-25 ¢ sharp, yet no take alone cleared the
		// old per-take gate: take medians sit ±5 ¢ around the run's centre, so a
		// player centred at the threshold fails half his takes by definition.
		const monitor = createTuningMonitor();
		expect(monitor.record(take([18, 12, 9]))).toBeNull();
		expect(monitor.record(take([14, 8, 16]))).toBeNull();
		expect(monitor.record(take([11, 17, 13]))).toEqual({ direction: 'sharp', cents: 13 });
	});

	it('a take under the threshold does not veto a window centred above it', () => {
		const monitor = createTuningMonitor();
		monitor.record(take([16, 16, 16]));
		monitor.record(take([9, 9, 9]));
		monitor.record(take([16, 16, 16]));
		monitor.record(take([9, 9, 9]));
		expect(monitor.record(take([16, 16, 16]))).toEqual({ direction: 'sharp', cents: 16 });
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
	])('clears stale advice on the next %s take', (_label, score) => {
		const monitor = createTuningMonitor();
		for (let i = 0; i < 3; i++) monitor.record(take([22, 22, 22]));
		expect(monitor.record(score)).toBeNull();
	});

	// 2026-10-20 (Andy's pick): a take with fewer than two clean notes says
	// nothing about tuning, so it keeps the cue as it was. On 2026-10-15 eight
	// one-note takes switched the cue off in a run centred 14 ¢ sharp.
	it.each([
		['silent', { noteResults: [] }],
		['one-note', take([2])]
	])('carries the cue through a %s take', (_label, score) => {
		const monitor = createTuningMonitor();
		monitor.record(take([14, 18, 12]));
		monitor.record(take([16, 11, 19]));
		const on = monitor.record(take([13, 17, 15]));
		expect(on).toEqual({ direction: 'sharp', cents: 15 });
		expect(monitor.record(score)).toEqual(on);
		expect(monitor.record(score)).toEqual(on);
	});

	it('a short take never turns the cue on', () => {
		const monitor = createTuningMonitor();
		monitor.record(take([14, 18, 12]));
		monitor.record(take([16, 11, 19]));
		expect(monitor.record(take([1, 0, -2]))).toBeNull();
		expect(monitor.record(take([30]))).toBeNull();
		expect(monitor.record({ noteResults: [] })).toBeNull();
	});

	describe('hysteresis: on at ALERT_CENTS, held down to HOLD_CENTS (2026-10-20)', () => {
		// Scattered on purpose: take medians wander around the centre, as on
		// Andy's 2026-10-15 run (window centre 9.3-18 ¢ with the faders at 14).
		const rise = [[14, 18, 12], [16, 11, 19], [13, 17, 15]];
		const drift = [[9, 11, 10], [12, 10, 8], [10, 9, 12], [11, 12, 9], [10, 11, 11]];

		it('stays on while the window centre drifts under the alert offset', () => {
			const monitor = createTuningMonitor();
			const verdicts = [...rise, ...drift].map(t => monitor.record(take(t)));
			expect(verdicts.slice(0, 2)).toEqual([null, null]);
			expect(verdicts[2]).toEqual({ direction: 'sharp', cents: 15 });
			// The window now holds only the drift, centred 10 ¢.
			expect(verdicts.at(-1)).toEqual({ direction: 'sharp', cents: 10 });
		});

		it('the same takes do not turn the cue ON', () => {
			const monitor = createTuningMonitor();
			for (const t of drift) expect(monitor.record(take(t))).toBeNull();
		});

		it('clears once the window centre falls under the hold offset', () => {
			const monitor = createTuningMonitor();
			for (const t of [...rise, ...drift, [7, 9, 6]]) monitor.record(take(t));
			expect(monitor.record(take([6, 8, 5]))).toEqual({ direction: 'sharp', cents: 9 });
			// Centre 7 ¢ while every take still leans sharp: the hold floor clears it.
			expect(monitor.record(take([5, 7, 6]))).toBeNull();
		});

		it('holds only in the direction the cue was on', () => {
			const monitor = createTuningMonitor();
			for (const t of rise) monitor.record(take(t));
			for (let i = 0; i < 4; i++) monitor.record(take([-9, -11, -10]));
			expect(monitor.record(take([-11, -9, -10]))).toBeNull();
		});
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

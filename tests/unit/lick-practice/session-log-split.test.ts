/**
 * Unit tests for `splitReportByProgression` — the helper that turns one
 * SessionReport into per-progression slices so the persisted session log
 * can record each progression actually practiced.
 *
 * Before this helper, Daily Practice sessions collapsed the entire session
 * under one `config.progressionType` entry, which broke the picker's
 * "least-recently-practiced progression" lookup across mixed sessions.
 */

import { describe, it, expect } from 'vitest';
import { splitReportByProgression } from '$lib/persistence/lick-practice-sessions';
import type {
	LickPracticePlanItem,
	LickReport,
	SessionReport
} from '$lib/types/lick-practice';
import type { PitchClass } from '$lib/types/music';

function makeLickReport(
	lickId: string,
	keys: { key: PitchClass; score: number; passed: boolean }[]
): LickReport {
	const total = keys.reduce((sum, k) => sum + k.score, 0);
	return {
		lickId,
		lickName: lickId,
		tempo: 100,
		newTempo: null,
		keys: keys.map((k) => ({
			key: k.key,
			score: k.score,
			pitchAccuracy: k.score,
			rhythmAccuracy: k.score,
			passed: k.passed
		})),
		averageScore: keys.length > 0 ? total / keys.length : 0,
		passedCount: keys.filter((k) => k.passed).length
	};
}

function makePlanItem(
	phraseId: string,
	progressionType: LickPracticePlanItem['progressionType']
): LickPracticePlanItem {
	return {
		phraseId,
		phraseName: phraseId,
		phraseNumber: 1,
		category: 'ii-V-I-major',
		keys: ['C'],
		progressionType
	};
}

describe('splitReportByProgression', () => {
	it('returns a single slice when all plan items share one progressionType', () => {
		const plan: LickPracticePlanItem[] = [
			makePlanItem('lick-a', 'ii-V-I-major'),
			makePlanItem('lick-b', 'ii-V-I-major')
		];
		const report: SessionReport = {
			licks: [
				makeLickReport('lick-a', [{ key: 'C', score: 0.9, passed: true }]),
				makeLickReport('lick-b', [{ key: 'D', score: 0.7, passed: false }])
			],
			overallAverage: 0.8,
			totalAttempts: 2,
			totalPassed: 1,
			elapsedMinutes: 5
		};

		const slices = splitReportByProgression(report, plan);

		expect(slices).toHaveLength(1);
		expect(slices[0].progressionType).toBe('ii-V-I-major');
		expect(slices[0].report.licks.map((l) => l.lickId)).toEqual(['lick-a', 'lick-b']);
		expect(slices[0].report.totalAttempts).toBe(2);
		expect(slices[0].report.totalPassed).toBe(1);
		expect(slices[0].report.overallAverage).toBeCloseTo(0.8, 5);
		expect(slices[0].report.elapsedMinutes).toBe(5);
	});

	it('emits one slice per distinct progressionType and routes each lick to its plan item', () => {
		const plan: LickPracticePlanItem[] = [
			makePlanItem('lick-a', 'ii-V-I-major'),
			makePlanItem('lick-b', 'blues'),
			makePlanItem('lick-c', 'minor-vamp')
		];
		const report: SessionReport = {
			licks: [
				makeLickReport('lick-a', [{ key: 'C', score: 0.9, passed: true }]),
				makeLickReport('lick-b', [
					{ key: 'C', score: 0.6, passed: false },
					{ key: 'F', score: 0.8, passed: true }
				]),
				makeLickReport('lick-c', [{ key: 'C', score: 1.0, passed: true }])
			],
			overallAverage: (0.9 + 0.6 + 0.8 + 1.0) / 4,
			totalAttempts: 4,
			totalPassed: 3,
			elapsedMinutes: 12
		};

		const slices = splitReportByProgression(report, plan);

		expect(slices.map((s) => s.progressionType)).toEqual([
			'ii-V-I-major',
			'blues',
			'minor-vamp'
		]);

		const major = slices.find((s) => s.progressionType === 'ii-V-I-major')!;
		expect(major.report.licks.map((l) => l.lickId)).toEqual(['lick-a']);
		expect(major.report.totalAttempts).toBe(1);
		expect(major.report.totalPassed).toBe(1);
		expect(major.report.overallAverage).toBeCloseTo(0.9, 5);

		const blues = slices.find((s) => s.progressionType === 'blues')!;
		expect(blues.report.licks.map((l) => l.lickId)).toEqual(['lick-b']);
		expect(blues.report.totalAttempts).toBe(2);
		expect(blues.report.totalPassed).toBe(1);
		expect(blues.report.overallAverage).toBeCloseTo(0.7, 5);

		const minor = slices.find((s) => s.progressionType === 'minor-vamp')!;
		expect(minor.report.licks.map((l) => l.lickId)).toEqual(['lick-c']);
		expect(minor.report.totalAttempts).toBe(1);
		expect(minor.report.totalPassed).toBe(1);
	});

	it('preserves session-wide fields (elapsedMinutes, single-lick metadata) on every slice', () => {
		const plan: LickPracticePlanItem[] = [
			makePlanItem('lick-a', 'ii-V-I-major'),
			makePlanItem('lick-b', 'blues')
		];
		const report: SessionReport = {
			licks: [
				makeLickReport('lick-a', [{ key: 'C', score: 0.9, passed: true }]),
				makeLickReport('lick-b', [{ key: 'F', score: 0.7, passed: false }])
			],
			overallAverage: 0.8,
			totalAttempts: 2,
			totalPassed: 1,
			elapsedMinutes: 9,
			roundsCompleted: 3,
			finalTempo: 130,
			keysMasteredByRound: [{ round: 1, tempo: 120, keys: ['C'] }],
			ramp: {
				focusKey: 'D',
				targetTempo: 100,
				lowestTempo: 87,
				upToSpeedRound: 14,
				rebuiltRound: null
			}
		};

		const slices = splitReportByProgression(report, plan);

		for (const slice of slices) {
			expect(slice.report.elapsedMinutes).toBe(9);
			expect(slice.report.roundsCompleted).toBe(3);
			expect(slice.report.finalTempo).toBe(130);
			expect(slice.report.keysMasteredByRound).toEqual([{ round: 1, tempo: 120, keys: ['C'] }]);
			expect(slice.report.ramp).toEqual({
				focusKey: 'D',
				targetTempo: 100,
				lowestTempo: 87,
				upToSpeedRound: 14,
				rebuiltRound: null
			});
		}
	});

	it("sums (totalAttempts, totalPassed) across slices back to the original totals", () => {
		const plan: LickPracticePlanItem[] = [
			makePlanItem('lick-a', 'ii-V-I-major'),
			makePlanItem('lick-b', 'blues'),
			makePlanItem('lick-c', 'minor-vamp')
		];
		const report: SessionReport = {
			licks: [
				makeLickReport('lick-a', [
					{ key: 'C', score: 0.9, passed: true },
					{ key: 'D', score: 0.5, passed: false }
				]),
				makeLickReport('lick-b', [{ key: 'F', score: 0.8, passed: true }]),
				makeLickReport('lick-c', [
					{ key: 'A', score: 1.0, passed: true },
					{ key: 'E', score: 0.85, passed: true }
				])
			],
			overallAverage: (0.9 + 0.5 + 0.8 + 1.0 + 0.85) / 5,
			totalAttempts: 5,
			totalPassed: 4,
			elapsedMinutes: 7
		};

		const slices = splitReportByProgression(report, plan);

		const attemptsSum = slices.reduce((s, x) => s + x.report.totalAttempts, 0);
		const passedSum = slices.reduce((s, x) => s + x.report.totalPassed, 0);
		expect(attemptsSum).toBe(report.totalAttempts);
		expect(passedSum).toBe(report.totalPassed);
	});

	it('emits empty slices for plan progressions with no scored licks yet', () => {
		// Early in a session, the report may only contain licks scored so far.
		// Each distinct progression in the plan still gets a slice so callers
		// can iterate once; upsertLickPracticeSession's totalAttempts === 0
		// guard no-ops the empty entries.
		const plan: LickPracticePlanItem[] = [
			makePlanItem('lick-a', 'ii-V-I-major'),
			makePlanItem('lick-b', 'blues')
		];
		const report: SessionReport = {
			licks: [makeLickReport('lick-a', [{ key: 'C', score: 0.9, passed: true }])],
			overallAverage: 0.9,
			totalAttempts: 1,
			totalPassed: 1,
			elapsedMinutes: 1
		};

		const slices = splitReportByProgression(report, plan);

		expect(slices.map((s) => s.progressionType)).toEqual(['ii-V-I-major', 'blues']);
		const blues = slices.find((s) => s.progressionType === 'blues')!;
		expect(blues.report.licks).toEqual([]);
		expect(blues.report.totalAttempts).toBe(0);
		expect(blues.report.totalPassed).toBe(0);
		expect(blues.report.overallAverage).toBe(0);
	});

	it('drops licks whose lickId is not present in the plan (defensive)', () => {
		// Should never happen in practice — every scored key flows through a
		// plan item — but guard against orphan LickReports rather than throw.
		const plan: LickPracticePlanItem[] = [makePlanItem('lick-a', 'ii-V-I-major')];
		const report: SessionReport = {
			licks: [
				makeLickReport('lick-a', [{ key: 'C', score: 0.9, passed: true }]),
				makeLickReport('ghost', [{ key: 'D', score: 0.1, passed: false }])
			],
			overallAverage: 0.5,
			totalAttempts: 2,
			totalPassed: 1,
			elapsedMinutes: 2
		};

		const slices = splitReportByProgression(report, plan);

		expect(slices).toHaveLength(1);
		expect(slices[0].report.licks.map((l) => l.lickId)).toEqual(['lick-a']);
		expect(slices[0].report.totalAttempts).toBe(1);
	});

	it('returns an empty array when the plan is empty', () => {
		const report: SessionReport = {
			licks: [],
			overallAverage: 0,
			totalAttempts: 0,
			totalPassed: 0,
			elapsedMinutes: 0
		};
		expect(splitReportByProgression(report, [])).toEqual([]);
	});
});

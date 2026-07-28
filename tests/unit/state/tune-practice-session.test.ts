import { describe, it, expect } from 'vitest';
import type { Score } from '$lib/types/scoring';
import type { LickSuggestion } from '$lib/tunes/lick-matcher';
import {
	applyInsertionResult,
	emptyResultTally,
	resolvePickedSuggestion,
	strictnessKnobs,
	type ResultTally
} from '$lib/state/tune-practice-plan';

function mkScore(overall: number): Score {
	return {
		pitchAccuracy: overall,
		rhythmAccuracy: overall,
		overall,
		grade: 'good',
		noteResults: [],
		notesHit: 0,
		notesTotal: 0,
		timing: { medianOffsetMs: 0 }
	} as unknown as Score;
}

describe('strictnessKnobs', () => {
	it('maps the three levels onto existing pipeline knobs only', () => {
		expect(strictnessKnobs('guided', false)).toEqual({
			octaveInsensitive: true,
			bleedFilterEnabled: true,
			cueLevel: 'full'
		});
		expect(strictnessKnobs('standard', false)).toEqual({
			octaveInsensitive: true,
			bleedFilterEnabled: true,
			cueLevel: 'reduced'
		});
		// Solo respects the user's real bleed-filter setting.
		expect(strictnessKnobs('solo', true)).toEqual({
			octaveInsensitive: false,
			bleedFilterEnabled: true,
			cueLevel: 'none'
		});
		expect(strictnessKnobs('solo', false).bleedFilterEnabled).toBe(false);
	});
});

describe('applyInsertionResult', () => {
	it('awards base points from the window score in points mode', () => {
		const tally = applyInsertionResult(emptyResultTally(), 'ip-0', 'My Lick', mkScore(0.87), 'points');
		expect(tally.results).toHaveLength(1);
		expect(tally.results[0].basePoints).toBe(87);
		expect(tally.results[0].connectionBonus).toBe(0);
		expect(tally.results[0].grade).toBe('great');
		expect(tally.totalPoints).toBe(87);
		expect(tally.streak).toBe(0);
	});

	it('doubles the window with a connection bonus when consecutive hits clear the pass bar', () => {
		let tally = applyInsertionResult(emptyResultTally(), 'ip-0', 'A', mkScore(0.92), 'points');
		expect(tally.streak).toBe(1);
		tally = applyInsertionResult(tally, 'ip-1', 'B', mkScore(0.95), 'points');
		expect(tally.results[1].basePoints).toBe(95);
		expect(tally.results[1].connectionBonus).toBe(95);
		expect(tally.totalPoints).toBe(92 + 95 + 95);
		expect(tally.streak).toBe(2);
		expect(tally.bestStreak).toBe(2);
	});

	it('breaks the connection across a sub-threshold window', () => {
		let tally = applyInsertionResult(emptyResultTally(), 'ip-0', 'A', mkScore(0.92), 'points');
		tally = applyInsertionResult(tally, 'ip-1', 'B', mkScore(0.6), 'points');
		expect(tally.streak).toBe(0);
		tally = applyInsertionResult(tally, 'ip-2', 'C', mkScore(0.93), 'points');
		expect(tally.results[2].connectionBonus).toBe(0);
		expect(tally.streak).toBe(1);
		expect(tally.bestStreak).toBe(1);
	});

	it('records a skipped window (no notes) as null score, resetting the streak', () => {
		let tally = applyInsertionResult(emptyResultTally(), 'ip-0', 'A', mkScore(0.95), 'points');
		tally = applyInsertionResult(tally, 'ip-1', null, null, 'points');
		expect(tally.results[1].score).toBeNull();
		expect(tally.results[1].grade).toBeNull();
		expect(tally.results[1].basePoints).toBe(0);
		expect(tally.streak).toBe(0);
		expect(tally.totalPoints).toBe(95);
	});

	it('records grades but no points in suggest mode', () => {
		let tally: ResultTally = emptyResultTally();
		tally = applyInsertionResult(tally, 'ip-0', 'A', mkScore(0.96), 'suggest');
		tally = applyInsertionResult(tally, 'ip-1', 'B', mkScore(0.91), 'suggest');
		expect(tally.results.map((r) => r.grade)).toEqual(['perfect', 'great']);
		expect(tally.totalPoints).toBe(0);
		expect(tally.results.every((r) => r.basePoints === 0 && r.connectionBonus === 0)).toBe(true);
		// Streak still tracks proficient hits for the report.
		expect(tally.streak).toBe(2);
	});
});

describe('resolvePickedSuggestion', () => {
	const suggestion = (lickId: string): LickSuggestion => ({
		lickId,
		lickName: lickId,
		category: 'ii-V-I-major',
		targetKey: 'C',
		insertionOffset: [0, 1],
		insertionBar: 0,
		templateAlignmentOffset: [0, 1],
		masteryTier: 'unknown',
		matchSources: ['category'],
		substitution: null,
		inPracticeSet: false,
		difficultyLevel: 20
	});
	const suggestions = [suggestion('a'), suggestion('b'), suggestion('c')];

	it('defaults to the top suggestion when nothing was picked', () => {
		expect(resolvePickedSuggestion(suggestions, undefined)?.lickId).toBe('a');
	});

	it('returns the picked suggestion when the index is valid', () => {
		expect(resolvePickedSuggestion(suggestions, 2)?.lickId).toBe('c');
	});

	it('falls back to the top suggestion for an out-of-range pick', () => {
		expect(resolvePickedSuggestion(suggestions, 7)?.lickId).toBe('a');
	});

	it('returns null when there are no suggestions', () => {
		expect(resolvePickedSuggestion([], undefined)).toBeNull();
	});
});

import { describe, it, expect } from 'vitest';
import type { Score } from '$lib/types/scoring';
import type { LickSuggestion } from '$lib/tunes/lick-matcher';
import {
	applyInsertionResult,
	bestCandidateResult,
	emptyResultTally,
	insertionLabel,
	resolvePickedSuggestion,
	strictnessKnobs,
	windowCandidates,
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

function mkSuggestion(lickId: string): LickSuggestion {
	return {
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
	};
}

describe('strictnessKnobs', () => {
	it('listens the same way at every level: any octave, bleed filter on', () => {
		// Nothing is demonstrated in tune practice, so there is no heard
		// register to match — a lick legitimately moves an octave to stay on
		// the horn at every level, Solo included.
		for (const level of ['guided', 'standard', 'solo'] as const) {
			expect(strictnessKnobs(level).octaveInsensitive).toBe(true);
			expect(strictnessKnobs(level).bleedFilterEnabled).toBe(true);
		}
	});

	it('differs only in what the chart names: the lick, the progression, or nothing', () => {
		expect(strictnessKnobs('guided').cueLevel).toBe('lick');
		expect(strictnessKnobs('standard').cueLevel).toBe('progression');
		expect(strictnessKnobs('solo').cueLevel).toBe('none');
	});
});

describe('windowCandidates', () => {
	const suggestions = [mkSuggestion('a'), mkSuggestion('b'), mkSuggestion('c')];

	it('scores the named lick alone when the chart names licks', () => {
		expect(windowCandidates(suggestions, undefined, 'lick').map((s) => s.lickId)).toEqual(['a']);
		expect(windowCandidates(suggestions, 2, 'lick').map((s) => s.lickId)).toEqual(['c']);
	});

	it('scores every fitting lick when the chart names only the progression, or nothing', () => {
		// The player was not told which lick to play, so any lick that fits
		// the window counts — a pick made earlier is irrelevant.
		expect(windowCandidates(suggestions, undefined, 'progression').map((s) => s.lickId)).toEqual([
			'a',
			'b',
			'c'
		]);
		expect(windowCandidates(suggestions, 1, 'none').map((s) => s.lickId)).toEqual(['a', 'b', 'c']);
	});

	it('has nothing to score when nothing fits', () => {
		expect(windowCandidates([], undefined, 'lick')).toEqual([]);
		expect(windowCandidates([], undefined, 'none')).toEqual([]);
	});
});

describe('insertionLabel', () => {
	const args = {
		mode: 'suggest' as const,
		lickName: 'My Lick',
		progressionName: 'ii-V-I'
	};

	it('names the lick at the lick cue level, the progression when no lick fits', () => {
		expect(insertionLabel({ ...args, cueLevel: 'lick' })).toBe('My Lick');
		expect(insertionLabel({ ...args, cueLevel: 'lick', lickName: null })).toBe('ii-V-I');
	});

	it('names only the progression at the progression cue level, even when a lick fits', () => {
		expect(insertionLabel({ ...args, cueLevel: 'progression' })).toBe('ii-V-I');
	});

	it('names nothing at the none cue level, and nothing in freestyle at any level', () => {
		expect(insertionLabel({ ...args, cueLevel: 'none' })).toBeUndefined();
		expect(insertionLabel({ ...args, cueLevel: 'lick', mode: 'freestyle' })).toBeUndefined();
		expect(insertionLabel({ ...args, cueLevel: 'progression', mode: 'freestyle' })).toBeUndefined();
	});
});

describe('bestCandidateResult', () => {
	it('keeps the candidate the take matched best', () => {
		const best = bestCandidateResult([
			{ lickName: 'a', score: mkScore(0.4) },
			{ lickName: 'b', score: mkScore(0.9) },
			{ lickName: 'c', score: mkScore(0.7) }
		]);
		expect(best.lickName).toBe('b');
		expect(best.score?.overall).toBe(0.9);
	});

	it('ranks an unscorable candidate below any scored one', () => {
		const best = bestCandidateResult([
			{ lickName: 'a', score: null },
			{ lickName: 'b', score: mkScore(0.2) }
		]);
		expect(best.lickName).toBe('b');
	});

	it('falls back to the first candidate, unscored, when none could be scored', () => {
		const best = bestCandidateResult([
			{ lickName: 'a', score: null },
			{ lickName: 'b', score: null }
		]);
		expect(best).toEqual({ lickName: 'a', score: null });
	});
});

describe('applyInsertionResult', () => {
	it('awards base points from the window score in points mode', () => {
		const tally = applyInsertionResult(
			emptyResultTally(),
			'ip-0',
			'My Lick',
			mkScore(0.87),
			'points'
		);
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

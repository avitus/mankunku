import type { Phrase } from '$lib/types/music';
import type { InsertionPoint, InsertionResult } from '$lib/state/tune-practice-plan';
import type { LickSuggestion } from '$lib/tunes/lick-matcher';
import type { Score } from '$lib/types/scoring';
import { scoreToGrade } from '$lib/scoring/grades';
import { seg } from './tune-fixtures';

export const suggestion: LickSuggestion = { lickId: 'a', lickName: 'First lick', category: 'major-chord', targetKey: 'C',
	insertionOffset: [0, 1], insertionBar: 0, templateAlignmentOffset: [0, 1], masteryTier: 'known', matchSources: ['category'],
	substitution: null, inPracticeSet: true, difficultyLevel: 20, lengthBars: 2, mode: 'major' };
/** An insertion with stable performed position and a matching lick. */
export function point(id: string, start: number, extra: Partial<InsertionPoint> = {}): InsertionPoint {
	return { id, progressionType: 'major-vamp', bandName: 'Major', detectedType: 'major-vamp', localKey: 'C', keyCenter: 'C',
		degreeLabel: '1', startOffset: [start, 1], duration: [2, 1], playbackBarRange: { start, endExclusive: start + 2 },
		notationSegmentIndices: [0], notationBarRange: { start: 0, endExclusive: 2 }, notationLabelBar: 0,
		notationTimeRange: { start: 0, end: 2 }, markerKey: 'same-notation-marker', suggestions: [suggestion], uncategorizedCount: 0,
		openTick: (start + 1) * 1920, closeTick: (start + 3) * 1920, ...extra };
}
/** A head, two four-bar solos, and a closing head. */
export function phrase(): Phrase {
	return { id: 'tune', name: 'Tune', key: 'C', timeSignature: [4, 4], notes: [], category: 'user', tags: [], source: 'user',
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 16 },
		harmony: [seg('C', 'maj7', [0, 1], [16, 1])],
		performanceForm: { version: 1, totalBars: 16, sections: [], choruses: [
			{ index: 0, role: 'head', startBar: 0, endBarExclusive: 4 },
			{ index: 1, role: 'solo', startBar: 4, endBarExclusive: 8 },
			{ index: 2, role: 'solo', startBar: 8, endBarExclusive: 12 },
			{ index: 3, role: 'head', startBar: 12, endBarExclusive: 16 }
		] } };
}
/** A scored insertion, or a completed silent window when percent is null. */
export function result(id: string, percent: number | null): InsertionResult {
	const grade = percent === null ? null : scoreToGrade(percent / 100);
	return { insertionId: id, lickName: percent === null ? null : 'Played lick', grade, basePoints: 0, connectionBonus: 0,
		score: percent === null ? null : { overall: percent / 100, grade } as Score };
}

import { describe, expect, it } from 'vitest';
import type { Phrase } from '$lib/types/music';
import type { InsertionPoint, InsertionResult } from '$lib/state/tune-practice-plan';
import { buildPracticeReport as buildReport, focusPracticePlan as focusPlan, reportTiles } from '$lib/tunes/practice-report';
import { seg } from '../../helpers/tune-fixtures';
import { point, phrase, result, suggestion } from '../../helpers/tune-practice-report';

const clock = { barTicks: 1920, countInTicks: 1920 };
const buildPracticeReport = (phrase: Phrase, plan: InsertionPoint[], results: InsertionResult[], picked: Record<string, number> = {}) => buildReport(phrase, plan, results, clock, picked);
const focusPracticePlan = (plan: InsertionPoint[], phrase: Phrase, ids: string[]) => focusPlan(plan, phrase, ids, clock);

describe('tune practice chorus report', () => {
	it('joins results by insertion id and compares solo passes, excluding both heads', () => {
		const report = buildPracticeReport(phrase(), [point('a', 4), point('b', 8)], [result('b', 90), result('a', 40)]);
		expect(report.choruses.map(c => [c.index, c.landed, c.total])).toEqual([[0, 0, 1], [1, 1, 1]]);
		expect(report.spots).toHaveLength(1);
		expect(report.spots[0]).toMatchObject({ start: 0, end: 2, movement: 'recovered', needsWork: false });
		expect(report.spots[0].attempts.map(a => a.score)).toEqual([40, 90]);
		expect(report.blocks).toHaveLength(1);
		expect(report.blocks[0].choruses).toHaveLength(2);
	});
	it('uses scheduled ticks when head and pickup shifts leave source offsets outside the solo', () => {
		const p = phrase(), shifted = point('head-shift', 1, { openTick: 11520 });
		const transport = { barTicks: 1920, countInTicks: 3840 };
		const report = buildReport(p, [shifted], [result(shifted.id, 90)], transport);
		expect(report.choruses[0].attempts).toHaveLength(1);
		expect(report.spots[0]).toMatchObject({ start: 0, end: 2 });
		expect(focusPlan([shifted], p, [report.spots[0].id], transport)).toEqual([shifted]);
	});

	it('does not collapse repeated chart markers within one chorus', () => {
		const report = buildPracticeReport(phrase(), [point('a', 4), point('b', 6), point('c', 8), point('d', 10)], []);
		expect(report.spots.map(s => s.start)).toEqual([0, 2]);
		expect(report.spots.map(s => s.attempts.length)).toEqual([2, 2]);
	});
	it('separates skipped, unreached and unavailable windows without inventing misses', () => {
		const report = buildPracticeReport(phrase(), [point('a', 4), point('b', 6), point('c', 8, { suggestions: [] })], [result('a', null), result('c', null)]);
		expect(report.choruses.flatMap(c => c.attempts.map(a => a.status))).toEqual(['open', 'unplayed', 'unavailable']);
		expect(report.choruses.map(c => c.completed)).toEqual([1, 0]);
		expect(report.spots.filter(s => s.needsWork)).toHaveLength(1);
	});
	it('keeps an earlier miss actionable if a later chorus was never reached', () => {
		const report = buildPracticeReport(phrase(), [point('a', 4), point('b', 8)], [result('a', 40)]);
		expect(report.spots[0]).toMatchObject({ needsWork: true, movement: null });
	});
	it('shows the assigned suggestion for silence and the actually matched lick for a scored take', () => {
		const report = buildPracticeReport(phrase(), [point('a', 4, { suggestions: [suggestion, { ...suggestion, lickName: 'Alternate' }] }), point('b', 8)], [result('a', null), result('b', 90)], { a: 1 });
		expect(report.spots[0].attempts.map(a => a.name)).toEqual(['Alternate', 'Played lick']);
	});
	it('renders different closing changes separately, retaining their chorus number', () => {
		const p = phrase(); p.harmony = [seg('C', 'maj7', [0, 1], [8, 1]), seg('F', '7', [8, 1], [8, 1])];
		const report = buildPracticeReport(p, [point('a', 4), point('b', 8, { closingPass: true })], []);
		expect(report.blocks).toHaveLength(2);
		expect(report.blocks.map(b => b.choruses.map(c => c.index))).toEqual([[0], [1]]);
		expect(report.blocks.map(b => b.bars[0].harmony[0].chord.root)).toEqual(['C', 'F']);
	});
	it('uses bar units in 3/4, not whole notes or count-in ticks', () => {
		const p = phrase(); p.timeSignature = [3, 4];
		const report = buildReport(p, [point('a', 4, { startOffset: [3, 1], duration: [3, 2], openTick: 7200 })], [result('a', 90)], { barTicks: 1440, countInTicks: 1440 });
		expect(report.spots[0]).toMatchObject({ start: 0, end: 2 });
		expect(report.choruses[0].bars[0].harmony[0].duration).toEqual([3, 4]);
	});
	it('clips mid-bar windows across systems and gives overlapping windows independent lanes', () => {
		const report = buildPracticeReport(phrase(), [point('a', 4, { startOffset: [9, 2], duration: [3, 1], openTick: 10560 }), point('b', 5)], []);
		const tiles = reportTiles(report.choruses[0].attempts, 0, 2);
		expect(tiles.map(t => [t.left, t.width, t.lane])).toEqual([[25, 75, 0], [50, 50, 1]]);
		expect(reportTiles(report.choruses[0].attempts, 2, 4)[0]).toMatchObject({ left: 0, width: 75 });
	});
	it('focuses the same selected spot in every solo without shifting the backing phrase', () => {
		const p = phrase(), plan = [point('a', 4), point('b', 6), point('c', 8), point('d', 10)];
		const before = JSON.stringify(p);
		const id = buildPracticeReport(p, plan, []).spots[1].id;
		expect(focusPracticePlan(plan, p, [id]).map(p => p.id)).toEqual(['b', 'd']);
		expect(focusPracticePlan(plan, p, [])).toBe(plan);
		expect(() => focusPracticePlan(plan, p, ['no-longer-present'])).toThrow();
		expect(() => focusPracticePlan(plan, p, [id, 'no-longer-present'])).toThrow();
		expect(JSON.stringify(p)).toBe(before);
	});
	it('supports all twelve solos and does not synthesize opportunities in empty bars', () => {
		const p = phrase(); p.performanceForm!.totalBars = 48; p.harmony = [seg('C', 'maj7', [0, 1], [48, 1])]; p.performanceForm!.choruses = Array.from({ length: 12 }, (_, i) => ({ index: i, role: 'solo', startBar: i * 4, endBarExclusive: i * 4 + 4 }));
		const report = buildPracticeReport(p, [], []);
		expect(report.choruses).toHaveLength(12);
		expect(report.choruses.every(c => c.attempts.length === 0)).toBe(true);
		expect(report.spots).toEqual([]);
	});
});

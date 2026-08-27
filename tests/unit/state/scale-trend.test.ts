/**
 * buildScaleLevelSeries — the per-scale proficiency-over-time series behind
 * the Scale Proficiency hover chart on /progress.
 *
 * Two data sources, one series:
 *  - DailySummary.scaleLevels snapshots (durable, survive session pruning)
 *  - a backfill replay of the surviving ear-training sessions through the
 *    real processScaleAttempt for dates BEFORE the first snapshot, anchored
 *    (shifted) so the replay meets the first known real level — sessions are
 *    pruned at MAX_SESSIONS while proficiency accumulates forever, so an
 *    unanchored replay-from-initial would understate every level.
 *
 * The last point is always (today, currentLevel) so the chart always agrees
 * with the "Lv" number shown in the table row.
 */

import { describe, it, expect } from 'vitest';
import type { SessionResult, DailySummary } from '$lib/types/progress';
import type { ScaleType } from '$lib/tonality/tonality';
import { buildScaleLevelSeries } from '$lib/state/scale-trend';
import { localDateStr } from '$lib/util/local-date';

// Local-noon timestamps so localDateStr can never straddle a day boundary.
const day = (dom: number, hour = 12) => new Date(2026, 7, dom, hour).getTime(); // August 2026
const dateStr = (dom: number) => localDateStr(new Date(2026, 7, dom));

let nextId = 0;
function mkSession(
	timestamp: number,
	overall: number,
	opts: { scaleType?: ScaleType; source?: SessionResult['source'] } = {}
): SessionResult {
	return {
		id: `s${nextId++}`,
		timestamp,
		phraseId: 'p',
		phraseName: 'Phrase',
		category: 'modal',
		key: 'C',
		scaleType: 'scaleType' in opts ? opts.scaleType : 'major',
		source: opts.source,
		tempo: 100,
		difficultyLevel: 1,
		pitchAccuracy: overall,
		rhythmAccuracy: overall,
		overall,
		grade: 'perfect',
		notesHit: 4,
		notesTotal: 4,
		noteResults: []
	};
}

function mkSummary(date: string, scaleLevels?: DailySummary['scaleLevels']): DailySummary {
	return {
		date,
		sessionCount: 1,
		practiceMinutes: 2,
		avgOverall: 0.9,
		avgPitch: 0.9,
		avgRhythm: 0.9,
		bestScore: 0.9,
		notesTotal: 4,
		notesHit: 4,
		grades: { perfect: 1, great: 0, good: 0, fair: 0, tryAgain: 0 },
		categories: {},
		...(scaleLevels ? { scaleLevels } : {})
	};
}

describe('buildScaleLevelSeries', () => {
	it('returns just today at the current level when there is no history', () => {
		const series = buildScaleLevelSeries({
			scaleType: 'major',
			sessions: [],
			summaries: [],
			currentLevel: 7,
			today: dateStr(25)
		});
		expect(series).toEqual([{ date: dateStr(25), level: 7 }]);
	});

	it('replays sessions through the proficiency algorithm, one point per day (end-of-day level)', () => {
		// 12 perfect attempts: level advances 1→2 exactly on the 10th (day 21),
		// then holds. Sessions arrive newest-first, as progress.sessions stores them.
		const sessions = [
			...Array.from({ length: 5 }, (_, i) => mkSession(day(20, 9 + i), 1.0)),
			...Array.from({ length: 5 }, (_, i) => mkSession(day(21, 9 + i), 1.0)),
			...Array.from({ length: 2 }, (_, i) => mkSession(day(22, 9 + i), 1.0))
		].reverse();

		const series = buildScaleLevelSeries({
			scaleType: 'major',
			sessions,
			summaries: [],
			currentLevel: 2,
			today: dateStr(25)
		});

		expect(series).toEqual([
			{ date: dateStr(20), level: 1 },
			{ date: dateStr(21), level: 2 },
			{ date: dateStr(22), level: 2 },
			{ date: dateStr(25), level: 2 }
		]);
	});

	it('anchors the replay to the current level (pruned older sessions raised it beyond the replay)', () => {
		// Same 12 attempts, but the stored proficiency says level 30 — the replay
		// ends at 2, so every point shifts up by 28 to meet the known endpoint.
		const sessions = [
			...Array.from({ length: 5 }, (_, i) => mkSession(day(20, 9 + i), 1.0)),
			...Array.from({ length: 5 }, (_, i) => mkSession(day(21, 9 + i), 1.0)),
			...Array.from({ length: 2 }, (_, i) => mkSession(day(22, 9 + i), 1.0))
		];

		const series = buildScaleLevelSeries({
			scaleType: 'major',
			sessions,
			summaries: [],
			currentLevel: 30,
			today: dateStr(25)
		});

		expect(series).toEqual([
			{ date: dateStr(20), level: 29 },
			{ date: dateStr(21), level: 30 },
			{ date: dateStr(22), level: 30 },
			{ date: dateStr(25), level: 30 }
		]);
	});

	it('clamps anchored levels to at least 1', () => {
		// Replay ends at 2 but stored level is 1 → shift −1 would send day 20 to 0.
		const sessions = [
			...Array.from({ length: 10 }, (_, i) => mkSession(day(20, 9 + i), 1.0)),
			mkSession(day(21), 1.0)
		];

		const series = buildScaleLevelSeries({
			scaleType: 'major',
			sessions,
			summaries: [],
			currentLevel: 1,
			today: dateStr(25)
		});

		expect(series).toEqual([
			{ date: dateStr(20), level: 1 },
			{ date: dateStr(21), level: 1 },
			{ date: dateStr(25), level: 1 }
		]);
	});

	it('counts only ear-training sessions for the requested scale', () => {
		// 9 matching attempts (one short of an advance) plus decoys that must not
		// tip the 10-attempt window: another scale, a lick-practice session, and a
		// legacy session with no scaleType. Undefined source counts as ear-training.
		const sessions = [
			...Array.from({ length: 9 }, (_, i) => mkSession(day(20, 9 + i), 1.0)),
			mkSession(day(20, 20), 1.0, { scaleType: 'dorian' }),
			mkSession(day(20, 21), 1.0, { source: 'lick-practice' }),
			mkSession(day(20, 22), 1.0, { scaleType: undefined })
		];

		const series = buildScaleLevelSeries({
			scaleType: 'major',
			sessions,
			summaries: [],
			currentLevel: 1,
			today: dateStr(25)
		});

		expect(series).toEqual([
			{ date: dateStr(20), level: 1 },
			{ date: dateStr(25), level: 1 }
		]);
	});

	it('uses snapshots from the first snapshot date on, backfilling earlier days anchored to the first snapshot', () => {
		// Sessions on days 18–19 (replay: level 1 then 2). First snapshot (day 20)
		// says level 12 → backfill shifts by +10. Sessions on day 20 itself are
		// covered by the snapshot and must not double as backfill. A summary whose
		// scaleLevels lacks this scale contributes nothing.
		const sessions = [
			...Array.from({ length: 5 }, (_, i) => mkSession(day(18, 9 + i), 1.0)),
			...Array.from({ length: 5 }, (_, i) => mkSession(day(19, 9 + i), 1.0)),
			mkSession(day(20), 1.0)
		];
		const summaries = [
			mkSummary(dateStr(20), { major: 12 }),
			mkSummary(dateStr(21), { dorian: 40 }),
			mkSummary(dateStr(22), { major: 14 })
		];

		const series = buildScaleLevelSeries({
			scaleType: 'major',
			sessions,
			summaries,
			currentLevel: 15,
			today: dateStr(25)
		});

		expect(series).toEqual([
			{ date: dateStr(18), level: 11 },
			{ date: dateStr(19), level: 12 },
			{ date: dateStr(20), level: 12 },
			{ date: dateStr(22), level: 14 },
			{ date: dateStr(25), level: 15 }
		]);
	});

	it("replaces a same-day snapshot with the live current level (today's snapshot goes stale mid-day)", () => {
		const summaries = [
			mkSummary(dateStr(24), { major: 14 }),
			mkSummary(dateStr(25), { major: 14 })
		];

		const series = buildScaleLevelSeries({
			scaleType: 'major',
			sessions: [],
			summaries,
			currentLevel: 15,
			today: dateStr(25)
		});

		expect(series).toEqual([
			{ date: dateStr(24), level: 14 },
			{ date: dateStr(25), level: 15 }
		]);
	});
});

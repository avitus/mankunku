/**
 * Per-scale proficiency-over-time series for the Scale Proficiency trend
 * chart on /progress. Pure and Node-testable — no runes, no storage.
 *
 * Two sources merge into one chronological series:
 *
 *  - `DailySummary.scaleLevels` snapshots: durable end-of-day levels written
 *    by recordSession (the tonalMastery pattern). Authoritative from the
 *    first snapshot date onward.
 *  - Backfill for dates before the first snapshot: replay the surviving
 *    ear-training sessions for the scale through the real
 *    `processScaleAttempt`, keep each day's closing level, then shift the
 *    whole replay so its endpoint meets the first known real level (the
 *    first snapshot, or the live level when no snapshot exists yet).
 *    The shift matters because `progress.sessions` is pruned at MAX_SESSIONS
 *    while proficiency accumulates forever — an unanchored replay from
 *    level 1 would understate every point for a long-time user.
 *
 * The series always ends at (today, currentLevel) so the chart agrees with
 * the "Lv" number shown beside it, even when today's snapshot went stale
 * mid-day.
 */

import type { SessionResult, DailySummary } from '$lib/types/progress';
import type { ScaleType } from '$lib/tonality/tonality';
import { createInitialScaleProficiency, processScaleAttempt } from '$lib/difficulty/adaptive';
import { localDateStr } from '$lib/util/local-date';

export interface ScaleTrendPoint {
	/** Local "YYYY-MM-DD" */
	date: string;
	/** Proficiency level 1-100 at the end of that day */
	level: number;
}

export interface ScaleTrendInput {
	scaleType: ScaleType;
	/** progress.sessions — any order, mixed sources; filtered here */
	sessions: SessionResult[];
	/** dailySummaries, chronological */
	summaries: DailySummary[];
	/** The live proficiency level shown in the table row */
	currentLevel: number;
	/** localDateStr(new Date()) — passed in so the builder stays pure */
	today: string;
}

const clampLevel = (level: number): number => Math.min(100, Math.max(1, level));

export function buildScaleLevelSeries(input: ScaleTrendInput): ScaleTrendPoint[] {
	const { scaleType, sessions, summaries, currentLevel, today } = input;

	const snapshotPoints: ScaleTrendPoint[] = summaries
		.filter((s) => s.scaleLevels?.[scaleType] != null)
		.map((s) => ({ date: s.date, level: s.scaleLevels![scaleType]! }));

	const firstSnapshot = snapshotPoints[0];

	// Backfill: replay the sessions the prune window still holds, oldest first,
	// stopping where snapshots take over. Same eligibility rule as
	// recordSession's proficiency update (undefined source = pre-lick-practice
	// ear training).
	const replaySessions = sessions
		.filter(
			(s) =>
				s.scaleType === scaleType &&
				(s.source ?? 'ear-training') === 'ear-training' &&
				(firstSnapshot === undefined || localDateStr(new Date(s.timestamp)) < firstSnapshot.date)
		)
		.sort((a, b) => a.timestamp - b.timestamp);

	let replay = createInitialScaleProficiency();
	const lastLevelByDate = new Map<string, number>();
	for (const s of replaySessions) {
		replay = processScaleAttempt(replay, s.overall);
		lastLevelByDate.set(localDateStr(new Date(s.timestamp)), replay.level);
	}

	const backfillRaw = [...lastLevelByDate.entries()].map(([date, level]) => ({ date, level }));
	const anchorLevel = firstSnapshot?.level ?? currentLevel;
	const anchorShift = backfillRaw.length > 0 ? anchorLevel - backfillRaw[backfillRaw.length - 1].level : 0;
	const backfillPoints = backfillRaw.map((p) => ({ date: p.date, level: clampLevel(p.level + anchorShift) }));

	const series = [...backfillPoints, ...snapshotPoints];

	// The live level is the last word on today.
	if (series.length > 0 && series[series.length - 1].date === today) {
		series[series.length - 1] = { date: today, level: currentLevel };
	} else {
		series.push({ date: today, level: currentLevel });
	}

	return series;
}

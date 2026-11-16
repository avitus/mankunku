import type { HarmonicSegment, Phrase } from '$lib/types/music';
import type { PerformanceChorus } from '$lib/types/performance-form';
import type { InsertionPoint, InsertionResult } from '$lib/state/tune-practice-plan';
import { addFractions, compareFractions, fractionToFloat, multiplyFraction, subtractFractions } from '$lib/music/intervals';
import type { ChordBar } from './chord-bars';

export type ReportStatus = 'hit' | 'miss' | 'open' | 'unplayed' | 'unavailable';
export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
	hit: 'Landed', miss: 'Unsuccessful', open: 'Missed opening', unplayed: 'No take', unavailable: 'No matching lick'
};
export const REPORT_STATUS_SYMBOLS: Record<ReportStatus, string> = {
	hit: '✓', miss: '×', open: '○', unplayed: '—', unavailable: '—'
};
export interface ReportAttempt {
	point: InsertionPoint;
	chorus: number;
	spotId: string;
	start: number;
	end: number;
	status: ReportStatus;
	name: string;
	score: number | null;
}
export interface ReportSpot {
	id: string;
	start: number;
	end: number;
	attempts: ReportAttempt[];
	needsWork: boolean;
	movement: 'recovered' | 'slipped' | null;
}
export interface ReportChorus {
	index: number;
	bars: ChordBar[];
	attempts: ReportAttempt[];
	landed: number;
	completed: number;
	total: number;
}
export interface ReportBlock {
	id: string;
	start: number;
	end: number;
	bars: ChordBar[];
	choruses: ReportChorus[];
}

export interface ReportClock {
	barTicks: number;
	countInTicks: number;
}

export interface PracticeReport {
	choruses: ReportChorus[];
	spots: ReportSpot[];
	blocks: ReportBlock[];
}
export interface ReportTile {
	attempt: ReportAttempt;
	lane: number;
	left: number;
	width: number;
}

/** Relative performed position, not notation marker identity: a repeated section
 * can contain several distinct opportunities within the SAME solo chorus. */
export function reportSpotId(point: InsertionPoint, chorus: PerformanceChorus, timeSignature: [number, number], clock: ReportClock): string {
	const bar = fractionToFloat(timeSignature);
	const start = (point.openTick - clock.countInTicks) / clock.barTicks - chorus.startBar;
	const length = fractionToFloat(point.duration) / bar;
	return `${start.toFixed(6)}:${length.toFixed(6)}:${point.progressionType}`;
}

export class MissingPracticeSpotsError extends Error {}

export function focusPracticePlan(plan: InsertionPoint[], phrase: Phrase, spotIds: readonly string[], clock: ReportClock): InsertionPoint[] {
	if (!spotIds.length) return plan;
	const wanted = new Set(spotIds);
	const matched = new Set<string>();
	const focused = plan.filter(point => {
		const start = (point.openTick - clock.countInTicks) / clock.barTicks;
		const chorus = phrase.performanceForm?.choruses.find(c => c.role === 'solo'
			&& start >= c.startBar - 1e-8 && start < c.endBarExclusive - 1e-8);
		if (!chorus) return false;
		const id = reportSpotId(point, chorus, phrase.timeSignature, clock);
		if (!wanted.has(id)) return false;
		matched.add(id);
		return true;
	});
	if (matched.size !== wanted.size) throw new MissingPracticeSpotsError();
	return focused;
}

/** Chords come from the emitted performance, so omitted intros, pickups,
 * transposition, repeat order and a different closing ending stay factual. */
export function buildPracticeReport(phrase: Phrase, plan: InsertionPoint[], results: InsertionResult[], clock: ReportClock, picked: Record<string, number> = {}): PracticeReport {
	const byId = new Map(results.map(result => [result.insertionId, result]));
	const solos = phrase.performanceForm?.choruses.filter(c => c.role === 'solo') ?? [];
	const barLength = fractionToFloat(phrase.timeSignature);
	const spots = new Map<string, ReportSpot>();
	const choruses: ReportChorus[] = solos.map((chorus, index) => {
		const bars = Array.from({ length: chorus.endBarExclusive - chorus.startBar }, (_, bar) => {
			const start = multiplyFraction(phrase.timeSignature, chorus.startBar + bar);
			const end = addFractions(start, phrase.timeSignature);
			const harmony: HarmonicSegment[] = (phrase.harmony ?? []).flatMap(segment => {
				const segmentEnd = addFractions(segment.startOffset, segment.duration);
				if (compareFractions(segmentEnd, start) <= 0 || compareFractions(segment.startOffset, end) >= 0) return [];
				const from = compareFractions(segment.startOffset, start) < 0 ? start : segment.startOffset;
				const to = compareFractions(segmentEnd, end) > 0 ? end : segmentEnd;
				return [{ ...segment, startOffset: subtractFractions(from, start), duration: subtractFractions(to, from) }];
			});
			return { index: bar, number: bar + 1, harmony };
		});
		const attempts: ReportAttempt[] = plan.filter(point => {
			const start = (point.openTick - clock.countInTicks) / clock.barTicks;
			return start >= chorus.startBar - 1e-8 && start < chorus.endBarExclusive - 1e-8;
		}).map(point => {
			const result = byId.get(point.id);
			const status: ReportStatus = result?.score && result.grade
				? result.grade === 'try-again' ? 'miss' : 'hit'
				: point.suggestions.length === 0 ? 'unavailable' : result ? 'open' : 'unplayed';
			const start = (point.openTick - clock.countInTicks) / clock.barTicks - chorus.startBar;
			const end = Math.min(bars.length, start + fractionToFloat(point.duration) / barLength);
			const spotId = reportSpotId(point, chorus, phrase.timeSignature, clock);
			const suggestion = point.suggestions[picked[point.id] ?? 0] ?? point.suggestions[0];
			const attempt: ReportAttempt = { point, chorus: index, spotId, start, end, status,
				name: result?.lickName ?? suggestion?.lickName ?? point.bandName,
				score: result?.score ? Math.round(result.score.overall * 100) : null };
			const spot = spots.get(spotId) ?? { id: spotId, start, end, attempts: [], needsWork: false, movement: null };
			spot.attempts.push(attempt);
			spots.set(spotId, spot);
			return attempt;
		});
		return { index, bars, attempts, landed: attempts.filter(a => a.status === 'hit').length,
			completed: attempts.filter(a => ['hit', 'miss', 'open'].includes(a.status)).length,
			total: attempts.filter(a => a.status !== 'unavailable').length };
	});
	for (const spot of spots.values()) {
		const completed = spot.attempts.filter(a => ['hit', 'miss', 'open'].includes(a.status));
		const latest = completed.at(-1);
		const previous = completed.at(-2);
		spot.needsWork = latest?.status === 'miss' || latest?.status === 'open';
		spot.movement = previous && latest
			? previous.status !== 'hit' && latest.status === 'hit' ? 'recovered'
			: previous.status === 'hit' && latest.status !== 'hit' ? 'slipped' : null : null;
	}
	const blocks: ReportBlock[] = [];
	const maxBars = Math.max(0, ...choruses.map(c => c.bars.length));
	for (let start = 0; start < maxBars; start += 4) {
		const variants = new Map<string, ReportBlock>();
		for (const chorus of choruses) {
			const bars = chorus.bars.slice(start, start + 4);
			if (!bars.length) continue;
			// Different closing changes get their own block, never someone else's chords.
			const signature = JSON.stringify(bars.map(b => b.harmony));
			const block = variants.get(signature) ?? { id: `${start}-${variants.size}`, start, end: start + bars.length, bars, choruses: [] };
			block.choruses.push(chorus);
			variants.set(signature, block);
		}
		blocks.push(...variants.values());
	}
	return { choruses, spots: [...spots.values()].sort((a, b) => a.start - b.start), blocks };
}

/** Clip long/mid-bar windows to each chart system; overlapping windows retain
 * their own lane rather than painting over one another. */
export function reportTiles(attempts: ReportAttempt[], start: number, end: number): ReportTile[] {
	const laneEnds: number[] = [];
	return attempts.filter(a => a.start < end && a.end > start).sort((a, b) => a.start - b.start).map(attempt => {
		const from = Math.max(start, attempt.start), to = Math.min(end, attempt.end);
		let lane = laneEnds.findIndex(previousEnd => previousEnd <= from + 1e-8);
		if (lane < 0) lane = laneEnds.length;
		laneEnds[lane] = to;
		return { attempt, lane, left: (from - start) / (end - start) * 100, width: (to - from) / (end - start) * 100 };
	});
}

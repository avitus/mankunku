/**
 * Persistent log of lick-practice sessions, written incrementally by id.
 *
 * Each session generates a stable id at start; the session page calls
 * `upsertLickPracticeSession` after every scored key with the current
 * report. This gives per-key durability (browser crash mid-session keeps
 * the keys recorded so far) without a separate per-key write path —
 * `daily-summaries` then derives from this log as its source of truth for
 * lick activity.
 *
 * Entries are bounded to MAX_SESSIONS so the localStorage blob doesn't
 * grow unbounded; pruning keeps the newest by timestamp.
 */

import type {
	ChordProgressionType,
	LickPracticeMode,
	LickPracticePlanItem,
	LickReport,
	SessionReport
} from '$lib/types/lick-practice';
import { save, load } from './storage';
import { MAX_SESSIONS } from './limits';

const STORAGE_KEY = 'lick-practice-sessions';

export interface LickPracticeSessionLogEntry {
	id: string;
	timestamp: number;
	progressionType: ChordProgressionType;
	practiceMode: LickPracticeMode;
	report: SessionReport;
}

export function loadLickPracticeSessions(): LickPracticeSessionLogEntry[] {
	return load<LickPracticeSessionLogEntry[]>(STORAGE_KEY) ?? [];
}

export function saveLickPracticeSessions(entries: LickPracticeSessionLogEntry[]): void {
	save(STORAGE_KEY, entries);
}

/**
 * Insert or replace a session log entry by id. Called incrementally during
 * a session — once per scored key — so the persisted entry's
 * `report.totalAttempts` always reflects the keys completed so far. The
 * final call (at session end) is just the last in the sequence.
 *
 * Returns the saved entry, or `null` when `totalAttempts === 0` (an
 * upsert before any key has scored is a no-op so the log isn't littered
 * with empty placeholders).
 */
export function upsertLickPracticeSession(
	entry: LickPracticeSessionLogEntry
): LickPracticeSessionLogEntry | null {
	if (entry.report.totalAttempts === 0) return null;

	const existing = loadLickPracticeSessions();
	const idx = existing.findIndex((e) => e.id === entry.id);
	let next: LickPracticeSessionLogEntry[];
	if (idx >= 0) {
		next = [...existing];
		next[idx] = entry;
	} else {
		next = [entry, ...existing];
	}
	// Sort newest-first by timestamp before trimming so a late upsert on an
	// older session can't evict newer sessions when MAX_SESSIONS is hit.
	next.sort((a, b) => b.timestamp - a.timestamp);
	if (next.length > MAX_SESSIONS) next = next.slice(0, MAX_SESSIONS);

	saveLickPracticeSessions(next);
	return entry;
}

export function clearLickPracticeSessions(): void {
	saveLickPracticeSessions([]);
}

/**
 * Split a SessionReport into per-progression slices, one per distinct
 * `progressionType` in the plan. Each slice carries only the LickReports
 * whose plan item used that progression, with aggregates recomputed for
 * the subset (overallAverage, totalAttempts, totalPassed). Session-wide
 * fields (elapsedMinutes, single-lick round metadata) are preserved on
 * every slice — they describe the whole session, and the persisted log's
 * consumers (picker, daily summary) ignore them.
 *
 * Daily Practice sessions need this so the session log records each
 * progression actually practiced, rather than collapsing the whole
 * session under one `config.progressionType`. Standard sessions, where
 * every plan item shares one progression, produce a single-entry array
 * equivalent to the unsplit report.
 *
 * Plan items not represented in the report's licks are still surfaced
 * with an empty slice so callers (e.g. the per-progression upsert at
 * session start, before any key has scored) can iterate every distinct
 * progression without an extra membership check. Upsert's
 * `totalAttempts === 0` guard then no-ops the empty entries.
 */
export function splitReportByProgression(
	report: SessionReport,
	plan: LickPracticePlanItem[]
): Array<{ progressionType: ChordProgressionType; report: SessionReport }> {
	const lickIdToProgression = new Map<string, ChordProgressionType>();
	const distinctProgressions: ChordProgressionType[] = [];
	for (const item of plan) {
		if (!lickIdToProgression.has(item.phraseId)) {
			lickIdToProgression.set(item.phraseId, item.progressionType);
		}
		if (!distinctProgressions.includes(item.progressionType)) {
			distinctProgressions.push(item.progressionType);
		}
	}

	const licksByProgression = new Map<ChordProgressionType, LickReport[]>();
	for (const progressionType of distinctProgressions) {
		licksByProgression.set(progressionType, []);
	}
	for (const lick of report.licks) {
		const progressionType = lickIdToProgression.get(lick.lickId);
		if (!progressionType) continue;
		licksByProgression.get(progressionType)!.push(lick);
	}

	const slices: Array<{ progressionType: ChordProgressionType; report: SessionReport }> = [];
	for (const progressionType of distinctProgressions) {
		const licks = licksByProgression.get(progressionType)!;
		let totalAttempts = 0;
		let totalPassed = 0;
		let overallSum = 0;
		let keyCount = 0;
		for (const lick of licks) {
			for (const key of lick.keys) {
				overallSum += key.score;
				keyCount++;
				totalAttempts++;
				if (key.passed) totalPassed++;
			}
		}
		const sliced: SessionReport = {
			licks,
			overallAverage: keyCount > 0 ? overallSum / keyCount : 0,
			totalAttempts,
			totalPassed,
			elapsedMinutes: report.elapsedMinutes
		};
		if (report.roundsCompleted !== undefined) sliced.roundsCompleted = report.roundsCompleted;
		if (report.finalTempo !== undefined) sliced.finalTempo = report.finalTempo;
		if (report.keysMasteredByRound !== undefined)
			sliced.keysMasteredByRound = report.keysMasteredByRound;
		if (report.ramp !== undefined) sliced.ramp = report.ramp;
		slices.push({ progressionType, report: sliced });
	}

	return slices;
}

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

import type { ChordProgressionType, LickPracticeMode, SessionReport } from '$lib/types/lick-practice';
import { save, load } from './storage';

const STORAGE_KEY = 'lick-practice-sessions';
const MAX_SESSIONS = 100;

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
		next = [entry, ...existing].slice(0, MAX_SESSIONS);
	}

	saveLickPracticeSessions(next);
	return entry;
}

export function clearLickPracticeSessions(): void {
	saveLickPracticeSessions([]);
}

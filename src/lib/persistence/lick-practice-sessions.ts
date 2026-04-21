/**
 * Persistent log of completed lick-practice sessions.
 *
 * Distinct from the per-key progress store (`lick-practice-store.ts`) — this
 * captures an end-of-session snapshot so the /progress page can list past
 * sessions alongside ear-training ones. Entries are bounded to the same
 * MAX_SESSIONS window as ear-training.
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
 * Append a completed session to the log (newest first), bounded to MAX_SESSIONS.
 * Skips writes for empty reports — an aborted session with no attempted keys
 * carries no useful information for the history view.
 */
export function appendLickPracticeSession(entry: LickPracticeSessionLogEntry): void {
	if (entry.report.totalAttempts === 0) return;
	const existing = loadLickPracticeSessions();
	const next = [entry, ...existing].slice(0, MAX_SESSIONS);
	saveLickPracticeSessions(next);
}

export function clearLickPracticeSessions(): void {
	saveLickPracticeSessions([]);
}

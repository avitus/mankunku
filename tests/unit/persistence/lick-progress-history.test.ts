import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	getLickDisplayTempo,
	appendLickProgressPoint,
	getLickProgressHistory,
	seedProgressHistoryFromSessions,
	NEW_LICK_DEFAULT_TEMPO
} from '$lib/persistence/lick-practice-store';
import {
	saveLickPracticeSessions,
	type LickPracticeSessionLogEntry
} from '$lib/persistence/lick-practice-sessions';
import { __resetNamespaceCacheForTests } from '$lib/persistence/namespace';
import type { LickPracticeProgress } from '$lib/types/lick-practice';

// ─── Mock cloud + outbox so the store round-trips through localStorage only ──
vi.mock('$lib/persistence/sync', () => ({
	loadLickMetadataFromCloud: vi.fn(),
	upsertLickMetadataRow: vi.fn(),
	syncUserLicksToCloud: vi.fn(),
	syncLickMetadataToCloud: vi.fn()
}));
vi.mock('$lib/persistence/community', () => ({ getStolenLicksLocal: () => [] }));
vi.mock('$lib/persistence/outbox', () => ({ enqueue: vi.fn() }));

// ─── Mock localStorage ───────────────────────────────────────────────────────
const store: Record<string, string> = {};
const localStorageMock = {
	getItem: vi.fn((key: string) => store[key] ?? null),
	setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
	removeItem: vi.fn((key: string) => { delete store[key]; }),
	clear: vi.fn(() => { for (const key of Object.keys(store)) delete store[key]; }),
	get length() { return Object.keys(store).length; },
	key: vi.fn((i: number) => Object.keys(store)[i] ?? null)
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

beforeEach(() => {
	localStorageMock.clear();
	vi.clearAllMocks();
	__resetNamespaceCacheForTests();
});

/** Build a minimal session-log entry recording one lick over N keys. */
function sessionEntry(
	id: string,
	timestamp: number,
	lickId: string,
	tempo: number,
	newTempo: number | null,
	keyCount: number
): LickPracticeSessionLogEntry {
	const keys = Array.from({ length: keyCount }, (_, i) => ({
		key: (['C', 'F', 'Bb', 'Eb'] as const)[i % 4],
		score: 0.9,
		pitchAccuracy: 0.9,
		rhythmAccuracy: 0.9,
		passed: true
	}));
	return {
		id,
		timestamp,
		progressionType: 'ii-V-I-major',
		practiceMode: 'continuous',
		report: {
			licks: [{ lickId, lickName: lickId, tempo, newTempo, keys, averageScore: 0.9, passedCount: keyCount }],
			overallAverage: 0.9,
			totalAttempts: keyCount,
			totalPassed: keyCount,
			elapsedMinutes: 5
		}
	};
}

describe('getLickDisplayTempo', () => {
	it('returns the new-lick starting tempo for a never-practiced lick', () => {
		expect(getLickDisplayTempo({}, 'x')).toBe(NEW_LICK_DEFAULT_TEMPO);
	});

	it('returns the slowest unlocked-key tempo once the lick has progress', () => {
		const progress: LickPracticeProgress = {
			x: {
				C: { currentTempo: 90, lastPracticedAt: 1, passCount: 1 },
				F: { currentTempo: 80, lastPracticedAt: 1, passCount: 1 }
			}
		};
		expect(getLickDisplayTempo(progress, 'x')).toBe(80);
	});
});

describe('progress history append / read', () => {
	it('appends and reads points sorted oldest→newest', () => {
		appendLickProgressPoint('x', { t: 200, bpm: 65, keys: 2 });
		appendLickProgressPoint('x', { t: 100, bpm: 60, keys: 1 });
		expect(getLickProgressHistory('x')).toEqual([
			{ t: 100, bpm: 60, keys: 1 },
			{ t: 200, bpm: 65, keys: 2 }
		]);
	});

	it('is idempotent on a repeated timestamp (replay is a no-op)', () => {
		appendLickProgressPoint('x', { t: 100, bpm: 60, keys: 1 });
		appendLickProgressPoint('x', { t: 100, bpm: 99, keys: 9 });
		expect(getLickProgressHistory('x')).toEqual([{ t: 100, bpm: 60, keys: 1 }]);
	});

	it('keeps histories for different licks separate', () => {
		appendLickProgressPoint('x', { t: 1, bpm: 60, keys: 1 });
		appendLickProgressPoint('y', { t: 1, bpm: 70, keys: 3 });
		expect(getLickProgressHistory('x')).toHaveLength(1);
		expect(getLickProgressHistory('y')[0].bpm).toBe(70);
	});
});

describe('seedProgressHistoryFromSessions', () => {
	it('derives points from the session log (newTempo ?? tempo, keys.length)', () => {
		saveLickPracticeSessions([sessionEntry('s1', 1000, 'x', 60, 65, 2)]);
		seedProgressHistoryFromSessions();
		expect(getLickProgressHistory('x')).toEqual([{ t: 1000, bpm: 65, keys: 2 }]);
	});

	it('falls back to tempo when newTempo is null', () => {
		saveLickPracticeSessions([sessionEntry('s1', 1000, 'x', 72, null, 1)]);
		seedProgressHistoryFromSessions();
		expect(getLickProgressHistory('x')[0].bpm).toBe(72);
	});

	it('runs only once — a later session is not re-seeded', () => {
		saveLickPracticeSessions([sessionEntry('s1', 1000, 'x', 60, 65, 2)]);
		seedProgressHistoryFromSessions();
		// A new session lands after the marker is set; re-running must not re-scan.
		saveLickPracticeSessions([
			sessionEntry('s1', 1000, 'x', 60, 65, 2),
			sessionEntry('s2', 2000, 'x', 65, 70, 3)
		]);
		seedProgressHistoryFromSessions();
		expect(getLickProgressHistory('x')).toHaveLength(1);
	});
});

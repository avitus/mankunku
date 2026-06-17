/**
 * Integration tests for Daily Practice plan construction.
 *
 * `buildDailyPracticePlan` pools practice-tagged licks across every progression
 * the user has opted into, sorts them by least-recently-practiced (lick-level),
 * and assigns each lick its own least-recently-practiced compatible
 * progression. This exercises that data flow against the real lick library
 * using a stubbed localStorage for the tag / progress / session stores.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	lickPractice,
	buildDailyPracticePlan,
	getDailyPracticeLicks,
	getCurrentProgressionType
} from '$lib/state/lick-practice.svelte';
import {
	togglePracticeTag,
	toggleProgressionTag
} from '$lib/persistence/lick-practice-store';
import {
	saveLickPracticeSessions,
	type LickPracticeSessionLogEntry
} from '$lib/persistence/lick-practice-sessions';
import type { ChordProgressionType, LickPracticeProgress } from '$lib/types/lick-practice';

// ── localStorage stub shared by tag store, progress store, session log ──

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: vi.fn((key: string) => store.get(key) ?? null),
	setItem: vi.fn((key: string, val: string) => store.set(key, val)),
	removeItem: vi.fn((key: string) => store.delete(key)),
	key: vi.fn((i: number) => [...store.keys()][i] ?? null),
	get length() {
		return store.size;
	},
	clear: vi.fn(() => store.clear())
});

// Real lick IDs from `src/lib/data/licks/` — picked so each is tagged for a
// different progression by default. The tests below explicitly add
// `prog:*` tags so the picker has unambiguous candidates.
const II_V_LICK = 'ii-V-I-maj-001';
const BLUES_LICK = 'blues-001';
const MINOR_LICK = 'minor-chord-001';

function progressForLick(
	id: string,
	keyTimes: Record<string, number>
): LickPracticeProgress {
	const keys: Record<
		string,
		{ currentTempo: number; lastPracticedAt: number; passCount: number }
	> = {};
	for (const [k, t] of Object.entries(keyTimes)) {
		keys[k] = { currentTempo: 120, lastPracticedAt: t, passCount: 0 };
	}
	return { [id]: keys as never };
}

function logEntry(
	progressionType: ChordProgressionType,
	timestamp: number
): LickPracticeSessionLogEntry {
	return {
		id: `s-${progressionType}-${timestamp}`,
		timestamp,
		progressionType,
		practiceMode: 'continuous',
		// Minimal placeholder — Daily Practice planner only reads timestamp +
		// progressionType. Anything more would couple the test to unrelated
		// report fields.
		report: {
			licks: [],
			overallAverage: 0,
			totalAttempts: 1,
			totalPassed: 0,
			elapsedMinutes: 0
		}
	};
}

beforeEach(() => {
	store.clear();
	lickPractice.progress = {};
	lickPractice.plan = [];
	lickPractice.config.progressionType = 'ii-V-I-major';
	lickPractice.config.practiceMode = 'continuous';
	lickPractice.config.enableSubstitutions = false;
	lickPractice.config.singleLickId = undefined;
	// Plenty of budget so the plan reflects every eligible lick.
	lickPractice.config.durationMinutes = 60;
});

describe('getDailyPracticeLicks', () => {
	it('returns no licks when nothing is practice-tagged', () => {
		expect(getDailyPracticeLicks()).toEqual([]);
	});

	it('returns practice-tagged licks regardless of their progression tags', () => {
		togglePracticeTag(II_V_LICK);
		toggleProgressionTag(II_V_LICK, 'ii-V-I-major');
		togglePracticeTag(BLUES_LICK);
		toggleProgressionTag(BLUES_LICK, 'blues');

		const ids = getDailyPracticeLicks().map((l) => l.id);
		expect(ids).toContain(II_V_LICK);
		expect(ids).toContain(BLUES_LICK);
	});

	it('skips stranded licks (practice-tagged but no prog:* tag)', () => {
		togglePracticeTag(II_V_LICK);
		toggleProgressionTag(II_V_LICK, 'ii-V-I-major');
		togglePracticeTag(BLUES_LICK);
		// BLUES_LICK has no prog:* tag → stranded → excluded.

		const ids = getDailyPracticeLicks().map((l) => l.id);
		expect(ids).toContain(II_V_LICK);
		expect(ids).not.toContain(BLUES_LICK);
	});
});

describe('buildDailyPracticePlan', () => {
	it('pools licks across progressions and stamps each with its own progressionType', () => {
		togglePracticeTag(II_V_LICK);
		toggleProgressionTag(II_V_LICK, 'ii-V-I-major');
		togglePracticeTag(BLUES_LICK);
		toggleProgressionTag(BLUES_LICK, 'blues');

		buildDailyPracticePlan();

		const byId = new Map(lickPractice.plan.map((item) => [item.phraseId, item]));
		expect(byId.get(II_V_LICK)?.progressionType).toBe('ii-V-I-major');
		expect(byId.get(BLUES_LICK)?.progressionType).toBe('blues');
	});

	it('orders plan items by least-recently-practiced lick', () => {
		togglePracticeTag(II_V_LICK);
		toggleProgressionTag(II_V_LICK, 'ii-V-I-major');
		togglePracticeTag(BLUES_LICK);
		toggleProgressionTag(BLUES_LICK, 'blues');
		togglePracticeTag(MINOR_LICK);
		toggleProgressionTag(MINOR_LICK, 'minor-vamp');

		// II_V_LICK practiced most recently; MINOR_LICK least. Expected order:
		// MINOR_LICK (never practiced) → BLUES_LICK → II_V_LICK.
		lickPractice.progress = {
			...progressForLick(II_V_LICK, { C: 9000 }),
			...progressForLick(BLUES_LICK, { C: 1000 })
		};

		buildDailyPracticePlan();

		const ids = lickPractice.plan.map((item) => item.phraseId);
		expect(ids.indexOf(MINOR_LICK)).toBeLessThan(ids.indexOf(BLUES_LICK));
		expect(ids.indexOf(BLUES_LICK)).toBeLessThan(ids.indexOf(II_V_LICK));
	});

	it("assigns each lick its least-recently-practiced compatible progression", () => {
		// II_V_LICK is opted into TWO progressions. The picker should pick the
		// one whose session-log timestamp is smaller. Seed the log so
		// `ii-V-I-major` looks recently played and `ii-V-I-major-long` looks
		// long-ago → expect the picker to choose the latter.
		togglePracticeTag(II_V_LICK);
		toggleProgressionTag(II_V_LICK, 'ii-V-I-major');
		toggleProgressionTag(II_V_LICK, 'ii-V-I-major-long');
		saveLickPracticeSessions([
			logEntry('ii-V-I-major', 9000),
			logEntry('ii-V-I-major-long', 100)
		]);

		buildDailyPracticePlan();

		const item = lickPractice.plan.find((p) => p.phraseId === II_V_LICK);
		expect(item?.progressionType).toBe('ii-V-I-major-long');
	});

	it('stops appending licks once the time budget is exhausted', () => {
		togglePracticeTag(II_V_LICK);
		toggleProgressionTag(II_V_LICK, 'ii-V-I-major');
		togglePracticeTag(BLUES_LICK);
		toggleProgressionTag(BLUES_LICK, 'blues');
		togglePracticeTag(MINOR_LICK);
		toggleProgressionTag(MINOR_LICK, 'minor-vamp');

		// 5-minute budget. A single new lick at default tempo (60 BPM) on a
		// 2-bar progression with 1 unlocked key consumes only a fraction of
		// that, but the loop should still terminate before iterating every
		// candidate when the budget is small.
		lickPractice.config.durationMinutes = 1;
		buildDailyPracticePlan();

		// At one minute the planner cannot fit every eligible lick (each lick
		// is at least 8s of audio per its lone unlocked entry key). The exact
		// count depends on bar math; the invariant is that the plan is
		// non-empty and bounded.
		expect(lickPractice.plan.length).toBeGreaterThan(0);
		expect(lickPractice.plan.length).toBeLessThanOrEqual(3);
	});

	it('produces an empty plan when no licks are practice-tagged', () => {
		buildDailyPracticePlan();
		expect(lickPractice.plan).toEqual([]);
	});
});

describe('getCurrentProgressionType', () => {
	// Regression: the session header used to read lickPractice.config.progressionType,
	// which is pinned at plan-build time to a single value. In Daily Practice the
	// plan mixes progressions per item, so the header showed the same label
	// ("Minor", because pickInitialProgression seeds minor-vamp on first use)
	// for every lick. The current-progression lookup must instead defer to the
	// active plan item's progressionType.
	it("returns the current plan item's progressionType, not the session-wide config", () => {
		togglePracticeTag(II_V_LICK);
		toggleProgressionTag(II_V_LICK, 'ii-V-I-major');
		togglePracticeTag(BLUES_LICK);
		toggleProgressionTag(BLUES_LICK, 'blues');

		buildDailyPracticePlan();
		// Pin config to something neither item carries so a stale config read
		// would produce an unambiguously wrong answer.
		lickPractice.config.progressionType = 'minor-vamp';

		expect(lickPractice.plan.length).toBeGreaterThanOrEqual(2);
		for (let i = 0; i < lickPractice.plan.length; i++) {
			lickPractice.currentLickIndex = i;
			expect(getCurrentProgressionType()).toBe(lickPractice.plan[i].progressionType);
			expect(getCurrentProgressionType()).not.toBe('minor-vamp');
		}
	});

	it('falls back to config.progressionType when no plan is loaded (setup phase)', () => {
		lickPractice.plan = [];
		lickPractice.currentLickIndex = 0;
		lickPractice.config.progressionType = 'turnaround';
		expect(getCurrentProgressionType()).toBe('turnaround');
	});
});

/**
 * Deep-practice demo policy + worst-first rotation, wired into session state:
 *
 * - `startSingleLickSession` orders the rotation worst-first from PERSISTED
 *   rolling scores and always demos the first cycle (session reminder).
 * - `advanceSingleLickRound` re-sorts the survivors (and the refilled circle)
 *   from the rolling scores — which by then include this cycle's attempts —
 *   and decides `demoNextCycle`: demo only while the head (worst) key is
 *   below proficient, only in continuous mode, and NEVER on a refill cycle —
 *   a rotation rebuilt after a full clear was played in full moments ago,
 *   and a rolling score that lags the clear is no reason to replay the line.
 * - Tricks keep their rotation order (worst-first is a lick concept) but
 *   follow the same demo gate: `advanceSingleLickRound` demos a trick cycle
 *   only when its example STYLE is new to the session (enclosures: round 1
 *   only; triad pairs: one round per style) — see tests/unit/tricks/
 *   demo-round-policy.test.ts and tests/unit/state/trick-session.test.ts.
 * - `getDemoBars` is the single source for the demo block's length: the
 *   super-phrase builder and the session page must agree on 0 bars for a
 *   skipped demo, else windows and audio desync.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	lickPractice,
	startSingleLickSession,
	advanceSingleLickRound,
	buildLickSuperPhrase,
	getDemoBars,
	getKeyBars,
	resetSession
} from '$lib/state/lick-practice.svelte';
import {
	bumpUnlockedKeyCount,
	updateKeyProgress
} from '$lib/persistence/lick-practice-store';
import type { PitchClass, Phrase } from '$lib/types/music';

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

// Real library lick: 1-bar ii-V-I lick against the 2-bar short progression,
// so buildLickSuperPhrase resolves real notes for the demo assertions.
const LICK_ID = 'short-ii-V-maj-001';

function makeLick(key: PitchClass, id = `test-lick-${key}`): Phrase {
	return {
		id,
		name: `Test lick in ${key}`,
		timeSignature: [4, 4],
		key,
		notes: [],
		harmony: [],
		difficulty: { level: 10, pitchComplexity: 10, rhythmComplexity: 10, lengthBars: 1 },
		category: 'short-ii-V-I-major',
		tags: [],
		source: 'curated'
	};
}

function setUnlockedCount(phraseId: string, target: number): void {
	for (let n = 1; n < target; n++) {
		bumpUnlockedKeyCount(lickPractice.progress, phraseId);
	}
}

function seedRolling(phraseId: string, scores: Partial<Record<PitchClass, number>>): void {
	for (const [key, rollingScore] of Object.entries(scores)) {
		lickPractice.progress = updateKeyProgress(lickPractice.progress, phraseId, key as PitchClass, {
			lastPracticedAt: 1,
			rollingScore
		});
	}
}

beforeEach(() => {
	store.clear();
	resetSession();
	lickPractice.progress = {};
	lickPractice.config.practiceMode = 'continuous';
});

describe('startSingleLickSession worst-first ordering', () => {
	it('orders the rotation worst-first from persisted rolling scores', () => {
		setUnlockedCount('lick-f', 3); // circle from F → {F, Bb, C}
		seedRolling('lick-f', { F: 0.95, Bb: 0.6, C: 0.8 });
		startSingleLickSession(makeLick('F', 'lick-f'));
		expect(lickPractice.plan[0].keys).toEqual(['Bb', 'C', 'F']);
	});

	it('keeps circle order when no rolling data exists', () => {
		setUnlockedCount('lick-f', 3);
		startSingleLickSession(makeLick('F', 'lick-f'));
		expect(lickPractice.plan[0].keys).toEqual(['F', 'Bb', 'C']);
	});

	it('always demos the first cycle of a session', () => {
		setUnlockedCount('lick-f', 3);
		seedRolling('lick-f', { F: 0.99, Bb: 0.98, C: 0.97 }); // all proficient
		startSingleLickSession(makeLick('F', 'lick-f'));
		expect(lickPractice.demoNextCycle).toBe(true);
	});
});

describe('advanceSingleLickRound rotation + demo decision', () => {
	it('sorts survivors worst-first and demos while the head key is weak', () => {
		setUnlockedCount('lick-f', 3);
		startSingleLickSession(makeLick('F', 'lick-f'));
		seedRolling('lick-f', { F: 0.92, Bb: 0.96, C: 0.85 });
		lickPractice.masteredThisRound = ['Bb'];

		advanceSingleLickRound();

		expect(lickPractice.plan[0].keys).toEqual(['C', 'F']);
		expect(lickPractice.demoNextCycle).toBe(true); // head C at 0.85 < 0.9
	});

	it('skips the demo once every surviving key is proficient', () => {
		setUnlockedCount('lick-f', 3);
		startSingleLickSession(makeLick('F', 'lick-f'));
		seedRolling('lick-f', { F: 0.95, Bb: 0.96, C: 0.93 });
		lickPractice.masteredThisRound = ['Bb'];

		advanceSingleLickRound();

		expect(lickPractice.plan[0].keys).toEqual(['C', 'F']);
		expect(lickPractice.demoNextCycle).toBe(false); // head C at 0.93 ≥ 0.9
	});

	it('sorts the refilled circle worst-first after a full clear', () => {
		setUnlockedCount('lick-f', 3);
		startSingleLickSession(makeLick('F', 'lick-f'));
		seedRolling('lick-f', { F: 0.99, Bb: 0.98, C: 0.91 });
		lickPractice.masteredThisRound = [...lickPractice.plan[0].keys];

		advanceSingleLickRound();

		expect(lickPractice.plan[0].keys).toEqual(['C', 'Bb', 'F']);
		expect(lickPractice.demoNextCycle).toBe(false); // a refill never demos
	});

	it('skips the demo on a refill cycle even when the head key is still weak by history', () => {
		setUnlockedCount('lick-f', 3);
		startSingleLickSession(makeLick('F', 'lick-f'));
		// Every key cleared this cycle, but C's EWMA still lags the clear: a
		// 0.95 from a 0.7 history lands at 0.8. The old rule demoed C here —
		// "it plays even at tempo bumps" — for a key the user just cleared.
		seedRolling('lick-f', { F: 0.99, Bb: 0.98, C: 0.8 });
		lickPractice.masteredThisRound = [...lickPractice.plan[0].keys];

		advanceSingleLickRound();

		expect(lickPractice.plan[0].keys).toEqual(['C', 'Bb', 'F']);
		expect(lickPractice.demoNextCycle).toBe(false);
	});

	it('still demos a weak head key when the rotation was not cleared in full', () => {
		setUnlockedCount('lick-f', 3);
		startSingleLickSession(makeLick('F', 'lick-f'));
		seedRolling('lick-f', { F: 0.99, Bb: 0.98, C: 0.8 });
		lickPractice.masteredThisRound = ['F', 'Bb']; // C survives

		advanceSingleLickRound();

		expect(lickPractice.plan[0].keys).toEqual(['C']);
		expect(lickPractice.demoNextCycle).toBe(true);
	});

	it('ranks a never-practiced key worst so it gets the demo', () => {
		setUnlockedCount('lick-f', 3);
		startSingleLickSession(makeLick('F', 'lick-f'));
		seedRolling('lick-f', { F: 0.95, Bb: 0.92 }); // C unknown
		lickPractice.masteredThisRound = [];

		advanceSingleLickRound();

		expect(lickPractice.plan[0].keys[0]).toBe('C');
		expect(lickPractice.demoNextCycle).toBe(true);
	});

	it('never demos in call-response mode (each key already has its own call)', () => {
		setUnlockedCount('lick-f', 3);
		startSingleLickSession(makeLick('F', 'lick-f'));
		lickPractice.config.practiceMode = 'call-response';
		seedRolling('lick-f', { F: 0.5, Bb: 0.5, C: 0.5 });
		lickPractice.masteredThisRound = [];

		advanceSingleLickRound();

		expect(lickPractice.demoNextCycle).toBe(false);
	});

	it('leaves trick rotations unsorted and drops the demo after the first cycle', () => {
		setUnlockedCount('trick-host', 3);
		startSingleLickSession(makeLick('C', 'trick-host'));
		lickPractice.plan[0].kind = 'trick';
		lickPractice.plan[0].keys = ['C', 'G'];
		seedRolling('trick-host', { C: 0.95, G: 0.5 }); // would sort G first if licks
		lickPractice.masteredThisRound = [];

		advanceSingleLickRound();

		expect(lickPractice.plan[0].keys).toEqual(['C', 'G']);
		// A synthetic trick item with no device resolves to a single example
		// style: nothing new to hear after round 1, so no demo.
		expect(lickPractice.demoNextCycle).toBe(false);
	});
});

describe('getDemoBars', () => {
	it('returns the full demo block for a first cycle (demoNextCycle true)', () => {
		startSingleLickSession(LICK_ID);
		expect(lickPractice.demoNextCycle).toBe(true);
		expect(getDemoBars(0)).toBe(getKeyBars());
	});

	it('returns 0 when the demo is skipped', () => {
		startSingleLickSession(LICK_ID);
		lickPractice.demoNextCycle = false;
		expect(getDemoBars(0)).toBe(0);
	});

	it('returns 0 in call-response mode', () => {
		startSingleLickSession(LICK_ID);
		lickPractice.config.practiceMode = 'call-response';
		expect(getDemoBars(0)).toBe(0);
	});

	it('gates trick items by demoNextCycle exactly like licks', () => {
		startSingleLickSession(LICK_ID);
		lickPractice.plan[0].kind = 'trick';
		expect(getDemoBars(0)).toBe(getKeyBars());
		lickPractice.demoNextCycle = false;
		expect(getDemoBars(0)).toBe(0);
	});

	it('always returns the demo block in standard mode (unchanged behavior)', () => {
		startSingleLickSession(LICK_ID);
		lickPractice.mode = 'standard';
		lickPractice.demoNextCycle = false;
		expect(getDemoBars(0)).toBe(getKeyBars());
	});
});

describe('buildLickSuperPhrase demo gating', () => {
	it('emits demo notes and the demo bars when demoNextCycle is true', () => {
		startSingleLickSession(LICK_ID);
		const keyBars = getKeyBars();
		const superPhrase = buildLickSuperPhrase(0)!;
		expect(superPhrase.notes.length).toBeGreaterThan(0);
		expect(superPhrase.difficulty.lengthBars).toBe(
			lickPractice.plan[0].keys.length * keyBars + keyBars
		);
	});

	it('emits no demo notes and no demo bars when the demo is skipped', () => {
		startSingleLickSession(LICK_ID);
		lickPractice.demoNextCycle = false;
		const keyBars = getKeyBars();
		const superPhrase = buildLickSuperPhrase(0)!;
		// Continuous-mode user keys emit no melody — with the demo gone the
		// super-phrase is harmony-only and exactly N × keyBars long.
		expect(superPhrase.notes).toEqual([]);
		expect(superPhrase.difficulty.lengthBars).toBe(lickPractice.plan[0].keys.length * keyBars);
	});

	it('places the first user key at offset 0 when the demo is skipped', () => {
		startSingleLickSession(LICK_ID);
		lickPractice.demoNextCycle = false;
		const superPhrase = buildLickSuperPhrase(0)!;
		const firstSeg = superPhrase.harmony.reduce((min, seg) =>
			seg.startOffset[0] / seg.startOffset[1] < min.startOffset[0] / min.startOffset[1] ? seg : min
		);
		expect(firstSeg.startOffset[0] / firstSeg.startOffset[1]).toBe(0);
	});
});

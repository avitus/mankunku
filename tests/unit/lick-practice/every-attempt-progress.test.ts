/**
 * recordKeyAttempt must persist per-key progress on EVERY scored attempt —
 * not just passes — so the rolling score (which ranks keys worst-first for
 * Deep Practice's struggling-key demo) reflects failures, the very signal
 * it exists to capture. Passes alone would bias the EWMA upward and hide
 * exactly the keys the feature is meant to find.
 *
 * The write must carry the SESSION tempo explicitly: updateKeyProgress
 * merges over getKeyProgress's default `{currentTempo: 100}`, so an
 * implicit write on a failed first attempt would seed a brand-new lick at
 * 100 BPM and override resolveLickTempo's 60 BPM new-lick default.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	lickPractice,
	startSingleLickSession,
	recordKeyAttempt,
	resetSession
} from '$lib/state/lick-practice.svelte';
import { NEW_LICK_DEFAULT_TEMPO } from '$lib/persistence/lick-practice-store';
import type { PitchClass, Phrase } from '$lib/types/music';
import type { Score } from '$lib/types/scoring';

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

function makeScore(overall: number): Score {
	return {
		pitchAccuracy: overall,
		rhythmAccuracy: overall,
		overall,
		grade: 'A',
		noteResults: [],
		notesHit: 0,
		notesTotal: 0,
		timing: { bias: 0, spread: 0, offsets: [] }
	} as unknown as Score;
}

beforeEach(() => {
	store.clear();
	resetSession();
	lickPractice.progress = {};
});

describe('recordKeyAttempt every-attempt persistence', () => {
	it('persists a FAILED attempt: rolling score + practiced-at + session tempo, no passCount', () => {
		startSingleLickSession(makeLick('C', 'fresh-lick'));
		expect(lickPractice.currentTempo).toBe(NEW_LICK_DEFAULT_TEMPO);

		recordKeyAttempt(makeScore(0.6));

		const entry = lickPractice.progress['fresh-lick']?.C;
		expect(entry).toBeDefined();
		expect(entry!.rollingScore).toBeCloseTo(0.6, 10);
		expect(entry!.passCount).toBe(0);
		expect(entry!.lastPracticedAt).toBeGreaterThan(0);
		// The 100-BPM default-leak guard: the entry must carry the session
		// tempo (60 for a brand-new lick), not getKeyProgress's default.
		expect(entry!.currentTempo).toBe(NEW_LICK_DEFAULT_TEMPO);
	});

	it('persists a PASSING attempt with passCount and rolling score', () => {
		startSingleLickSession(makeLick('C', 'fresh-lick'));
		recordKeyAttempt(makeScore(0.95));

		const entry = lickPractice.progress['fresh-lick']?.C;
		expect(entry!.passCount).toBe(1);
		expect(entry!.rollingScore).toBeCloseTo(0.95, 10);
	});

	it('blends successive attempts into the EWMA', () => {
		startSingleLickSession(makeLick('C', 'fresh-lick'));
		recordKeyAttempt(makeScore(0.95));
		recordKeyAttempt(makeScore(0.5));

		const entry = lickPractice.progress['fresh-lick']?.C;
		// alpha 0.4: 0.4·0.5 + 0.6·0.95 = 0.77
		expect(entry!.rollingScore).toBeCloseTo(0.77, 10);
		expect(entry!.passCount).toBe(1); // the fail added no pass
	});

	it('never writes trick attempts into the lick progress store', () => {
		startSingleLickSession(makeLick('C', 'trick-host'));
		// Re-brand the plan item as a trick: recordKeyAttempt must route by
		// item.kind, and composite variant keys must never enter the lick blob.
		lickPractice.plan[0].kind = 'trick';
		lickPractice.plan[0].phraseId = 'chromatic-enclosure:{"steps":1}';

		recordKeyAttempt(makeScore(0.6)); // fail
		recordKeyAttempt(makeScore(0.95)); // pass

		expect(lickPractice.progress).toEqual({});
	});
});

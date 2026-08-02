/**
 * REGRESSION: lick-practice tempo must keep advancing across a full-12-key,
 * high-score session — even when the stored progress blob carries a legacy
 * non-canonical "phantom" key (e.g. an all-flats `Gb` from an older build).
 *
 * Real-world symptom this guards against: "Honeysuckle Rose" scored ~98% in all
 * 12 keys during Daily Practice yet the tempo stayed pinned at 100 BPM. Root
 * cause was `getLickTempo`'s unfiltered `Math.min` reading a stranded `Gb:100`
 * entry that no writer (recordKeyAttempt / the end-of-lick bump) can ever reach,
 * vetoing the bump that every canonical key had already earned. The fix filters
 * `getLickTempo` to the 12 canonical PitchClass spellings.
 *
 * The tests drive the REAL exported state functions, faithfully replaying what
 * the session scheduler does for a fully-unlocked lick:
 *   1. resolveLickTempo -> currentTempo.
 *   2. For each key in rotation order, recordKeyAttempt(score) with
 *      currentKeyIndex pointing at that key (advance() keeps them in lockstep).
 *   3. startInterLickTransition() once at end-of-lick (handleLickComplete).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getLickTempo } from '$lib/persistence/lick-practice-store';
import {
	lickPractice,
	recordKeyAttempt,
	startInterLickTransition,
	resolveLickTempo,
	getSessionReport
} from '$lib/state/lick-practice.svelte';
import type { LickPracticePlanItem, LickPracticeProgress } from '$lib/types/lick-practice';
import type { PitchClass } from '$lib/types/music';
import type { Score } from '$lib/types/scoring';

// localStorage mock (mirrors tempo-adjustment.test.ts).
const store: Record<string, string> = {};
Object.defineProperty(globalThis, 'localStorage', {
	value: {
		getItem: (k: string) => store[k] ?? null,
		setItem: (k: string, v: string) => {
			store[k] = v;
		},
		removeItem: (k: string) => {
			delete store[k];
		},
		clear: () => {
			for (const k of Object.keys(store)) delete store[k];
		},
		get length() {
			return Object.keys(store).length;
		},
		key: (i: number) => Object.keys(store)[i] ?? null
	},
	writable: true
});

const LICK_ID = 'honeysuckle-rose';

// Rotation order + scores exactly as the user reported them (avg 0.9808, worst 0.91).
const KEY_SCORES: Array<{ key: PitchClass; score: number }> = [
	{ key: 'C', score: 0.99 },
	{ key: 'G', score: 0.98 },
	{ key: 'D', score: 0.98 },
	{ key: 'A', score: 0.99 },
	{ key: 'E', score: 0.99 },
	{ key: 'B', score: 0.99 },
	{ key: 'F#', score: 0.99 },
	{ key: 'Db', score: 0.98 },
	{ key: 'Ab', score: 0.99 },
	{ key: 'Eb', score: 0.91 },
	{ key: 'Bb', score: 1.0 },
	{ key: 'F', score: 0.98 }
];

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

/** Seed the store + state for a fully-unlocked lick whose 12 canonical keys all
 *  sit at `startTempo`, optionally with a non-canonical phantom key present. */
function seedSession(startTempo: number, phantom?: { key: string; tempo: number }): void {
	for (const k of Object.keys(store)) delete store[k];

	const seeded: LickPracticeProgress = { [LICK_ID]: {} };
	for (const { key } of KEY_SCORES) {
		seeded[LICK_ID][key] = { currentTempo: startTempo, lastPracticedAt: 1, passCount: 2 };
	}
	if (phantom) {
		// Cast: the phantom is deliberately a spelling outside the PitchClass union.
		(seeded[LICK_ID] as Record<string, { currentTempo: number; lastPracticedAt: number; passCount: number }>)[
			phantom.key
		] = { currentTempo: phantom.tempo, lastPracticedAt: 1, passCount: 2 };
	}
	lickPractice.progress = seeded;
	store['mankunku:lick-unlock-count'] = JSON.stringify({ [LICK_ID]: 12 });

	const keys = KEY_SCORES.map((k) => k.key);
	const plan: LickPracticePlanItem[] = [
		{
			phraseId: LICK_ID,
			phraseName: 'Honeysuckle Rose',
			phraseNumber: 1,
			category: 'ii-V-I-major',
			keys,
			progressionType: 'ii-V-I-major'
		}
	];
	lickPractice.plan = plan;
	lickPractice.mode = 'standard';
	lickPractice.currentLickIndex = 0;
	lickPractice.currentKeyIndex = 0;
	lickPractice.keyResults = [];
	lickPractice.allAttempts = [];
	lickPractice.elapsedSeconds = 0;
	lickPractice.config.durationMinutes = 20; // plenty — timeUp stays false
	lickPractice.currentTempo = resolveLickTempo(lickPractice.progress, LICK_ID);
}

/** Play all 12 keys then run the end-of-lick transition, as the scheduler does. */
function playFullLickAndAdvance(): void {
	for (let i = 0; i < KEY_SCORES.length; i++) {
		lickPractice.currentKeyIndex = i;
		recordKeyAttempt(makeScore(KEY_SCORES[i].score), `sid-${i}`);
	}
	expect(lickPractice.keyResults.length).toBe(12);
	startInterLickTransition();
}

describe('getLickTempo — canonical-key filtering', () => {
	beforeEach(() => {
		for (const k of Object.keys(store)) delete store[k];
	});

	it('ignores a non-canonical phantom key when taking the tempo minimum', () => {
		const progress = {
			[LICK_ID]: Object.fromEntries([
				...KEY_SCORES.map(({ key }) => [key, { currentTempo: 105, lastPracticedAt: 1, passCount: 2 }]),
				['Gb', { currentTempo: 100, lastPracticedAt: 1, passCount: 2 }]
			])
		} as unknown as LickPracticeProgress;
		// Without the canonical filter this returns 100 (the stale Gb wins the min).
		expect(getLickTempo(progress, LICK_ID)).toBe(105);
	});
});

describe('Honeysuckle Rose full-12 daily-practice tempo bump', () => {
	it('advances 100 -> 102 on a clean 12-key store (baseline)', () => {
		seedSession(100);
		expect(lickPractice.currentTempo).toBe(100);

		playFullLickAndAdvance();

		expect(getLickTempo(lickPractice.progress, LICK_ID)).toBe(102);
		const card = getSessionReport().licks[0];
		expect(card?.tempo).toBe(100);
		expect(card?.newTempo).toBe(102); // report shows "+2"
	});

	it('advances despite a legacy Gb phantom key pinning the old min (regression)', () => {
		// Pre-fix, getLickTempo(min over ALL stored keys) returns 100 because the
		// stranded Gb:100 out-votes the twelve keys the session bumped to 102 —
		// the report shows a flat 100 and the tempo never climbs.
		seedSession(100, { key: 'Gb', tempo: 100 });
		expect(lickPractice.currentTempo).toBe(100);

		playFullLickAndAdvance();

		// The Gb phantom is untouched at 100, but the canonical keys all reached 102.
		expect(
			(lickPractice.progress[LICK_ID] as Record<string, { currentTempo: number }>)['Gb'].currentTempo
		).toBe(100);
		expect(getLickTempo(lickPractice.progress, LICK_ID)).toBe(102);

		const card = getSessionReport().licks[0];
		expect(card?.tempo).toBe(100);
		expect(card?.newTempo).toBe(102); // "+2" instead of the buggy flat 100
	});
});

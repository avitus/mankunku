/**
 * Tests for the lick-practice state module's lookahead and super-phrase
 * builder. These verify the math used to schedule continuous and
 * call-response practice sessions across all 12 keys.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	lickPractice,
	getPlannedKey,
	getUpcomingKeys,
	buildLickSuperPhrase,
	getKeyBars,
	getProgressionBars,
	advance,
	startInterLickTransition,
	recordKeyAttempt
} from '$lib/state/lick-practice.svelte';
import type { LickPracticePlanItem } from '$lib/types/lick-practice';
import { fractionToFloat } from '$lib/music/intervals';
import type { Score } from '$lib/types/scoring';

// Use the real lick library — short-ii-V-maj-001 is a 1-bar lick
// curated against a 2-bar progression template.
const SHORT_LICK_ID = 'short-ii-V-maj-001';

function plan(...items: Array<{ id: string; keys: string[] }>): LickPracticePlanItem[] {
	return items.map((item, idx) => ({
		phraseId: item.id,
		phraseName: item.id,
		phraseNumber: idx + 1,
		category: 'short-ii-V-I-major' as const,
		keys: item.keys as LickPracticePlanItem['keys']
	}));
}

beforeEach(() => {
	lickPractice.config.progressionType = 'ii-V-I-major';
	lickPractice.config.practiceMode = 'continuous';
	lickPractice.currentLickIndex = 0;
	lickPractice.currentKeyIndex = 0;
	lickPractice.currentTempo = 100;
	lickPractice.keyResults = [];
	lickPractice.allAttempts = [];
	lickPractice.plan = [];
});

describe('getPlannedKey lookahead', () => {
	it('returns null when plan is empty', () => {
		expect(getPlannedKey(0)).toBeNull();
		expect(getPlannedKey(1)).toBeNull();
	});

	it('returns the current key for offset 0', () => {
		lickPractice.plan = plan({ id: SHORT_LICK_ID, keys: ['C', 'F', 'Bb'] });
		const result = getPlannedKey(0);
		expect(result?.lickIndex).toBe(0);
		expect(result?.keyIndex).toBe(0);
		expect(result?.key).toBe('C');
		expect(result?.lickId).toBe(SHORT_LICK_ID);
	});

	it('returns the next key for offset 1', () => {
		lickPractice.plan = plan({ id: SHORT_LICK_ID, keys: ['C', 'F', 'Bb'] });
		const result = getPlannedKey(1);
		expect(result?.keyIndex).toBe(1);
		expect(result?.key).toBe('F');
	});

	it('crosses lick boundaries when looking ahead past the end of the current lick', () => {
		lickPractice.plan = plan(
			{ id: SHORT_LICK_ID, keys: ['C', 'F'] },
			{ id: SHORT_LICK_ID, keys: ['G', 'D'] }
		);
		// At lick 0, key 1 (F): offset 1 should be lick 1, key 0 (G)
		lickPractice.currentKeyIndex = 1;
		const next = getPlannedKey(1);
		expect(next?.lickIndex).toBe(1);
		expect(next?.keyIndex).toBe(0);
		expect(next?.key).toBe('G');

		// offset 2 should be lick 1, key 1 (D)
		const afterNext = getPlannedKey(2);
		expect(afterNext?.lickIndex).toBe(1);
		expect(afterNext?.keyIndex).toBe(1);
		expect(afterNext?.key).toBe('D');
	});

	it('returns null when looking ahead past the end of the plan', () => {
		lickPractice.plan = plan({ id: SHORT_LICK_ID, keys: ['C'] });
		expect(getPlannedKey(1)).toBeNull();
		expect(getPlannedKey(5)).toBeNull();
	});

	it('the planned key carries the transposed harmony for its target key', () => {
		lickPractice.plan = plan({ id: SHORT_LICK_ID, keys: ['F'] });
		const result = getPlannedKey(0);
		expect(result?.harmony.length).toBeGreaterThan(0);
		// ii-V-I in F → Gm7 (the ii) should be the first chord
		expect(result?.harmony[0].chord.root).toBe('G');
		expect(result?.harmony[0].chord.quality).toBe('min7');
	});
});

describe('getUpcomingKeys', () => {
	it('returns current/next/afterNext for the 3-row preview', () => {
		lickPractice.plan = plan({ id: SHORT_LICK_ID, keys: ['C', 'F', 'Bb', 'Eb'] });
		const upcoming = getUpcomingKeys();
		expect(upcoming.current?.key).toBe('C');
		expect(upcoming.next?.key).toBe('F');
		expect(upcoming.afterNext?.key).toBe('Bb');
	});

	it('returns nulls past the end of the plan', () => {
		lickPractice.plan = plan({ id: SHORT_LICK_ID, keys: ['C'] });
		const upcoming = getUpcomingKeys();
		expect(upcoming.current?.key).toBe('C');
		expect(upcoming.next).toBeNull();
		expect(upcoming.afterNext).toBeNull();
	});
});

describe('getKeyBars and getProgressionBars', () => {
	it('continuous mode: keyBars equals progressionBars', () => {
		lickPractice.config.practiceMode = 'continuous';
		lickPractice.plan = plan({ id: SHORT_LICK_ID, keys: ['C'] });
		// ii-V-I-major progression is 2 bars
		expect(getProgressionBars()).toBe(2);
		expect(getKeyBars()).toBe(2);
	});

	it('call-response mode: keyBars equals 2 × progressionBars', () => {
		lickPractice.config.practiceMode = 'call-response';
		lickPractice.plan = plan({ id: SHORT_LICK_ID, keys: ['C'] });
		expect(getProgressionBars()).toBe(2);
		expect(getKeyBars()).toBe(4);
	});
});

describe('buildLickSuperPhrase — continuous mode', () => {
	// Continuous mode prepends a demo cycle (1 progression's worth of bars
	// where the app plays the lick in keys[0]) before the 12 user keys.
	// For a 3-key plan on a 2-bar progression that means:
	//   - 1 demo segment-set at offset [0, 2)
	//   - 3 user segment-sets at offsets [2, 4), [4, 6), [6, 8)
	// Plus the demo's melody notes (the lick transposed to keys[0]).

	beforeEach(() => {
		lickPractice.config.practiceMode = 'continuous';
		lickPractice.plan = plan({ id: SHORT_LICK_ID, keys: ['C', 'F', 'Bb'] });
	});

	it('returns null for an out-of-range lick index', () => {
		expect(buildLickSuperPhrase(99)).toBeNull();
	});

	it('emits the demo notes (the lick transposed to keys[0]) — exactly once', () => {
		const sp = buildLickSuperPhrase(0);
		// short-ii-V-maj-001 has 4 notes; the demo plays them once and the
		// 12 user keys do NOT add any further notes (the user plays them).
		expect(sp?.notes.length).toBe(4);
	});

	it('demo notes are at the start of the phrase (offset < 1 bar)', () => {
		const sp = buildLickSuperPhrase(0);
		for (const note of sp!.notes) {
			expect(fractionToFloat(note.offset)).toBeLessThan(1);
		}
	});

	it('concatenates harmony for the demo + all keys', () => {
		const sp = buildLickSuperPhrase(0);
		// (1 demo + 3 keys) × 3 segments per ii-V-I-major progression = 12 segments
		expect(sp?.harmony.length).toBe(12);
	});

	it('demo segment is the first key (C → Dm7) at offset 0', () => {
		const sp = buildLickSuperPhrase(0);
		expect(fractionToFloat(sp!.harmony[0].startOffset)).toBe(0);
		expect(sp!.harmony[0].chord.root).toBe('D'); // ii of C = Dm7
	});

	it('user-key 0 starts at progressionBars (offset 2 for a 2-bar progression)', () => {
		const sp = buildLickSuperPhrase(0);
		const segsPerKey = 3;
		const progressionBars = 2;
		// segments[0..2] are the demo (key C). segments[3] is the start
		// of user key 0 (also C, since keys[0] = 'C'), shifted by demoBars.
		expect(fractionToFloat(sp!.harmony[segsPerKey].startOffset)).toBe(progressionBars);
		expect(sp!.harmony[segsPerKey].chord.root).toBe('D');
	});

	it('each user key transposes the chord roots correctly', () => {
		const sp = buildLickSuperPhrase(0);
		const segsPerKey = 3;
		// Demo (key C): segments[0..2] = Dm7 G7 Cmaj7
		expect(sp!.harmony[0].chord.root).toBe('D');
		// User key 0 = C → ii-V-I = Dm7 G7 Cmaj7
		expect(sp!.harmony[segsPerKey].chord.root).toBe('D');
		// User key 1 = F → Gm7 C7 Fmaj7
		expect(sp!.harmony[segsPerKey * 2].chord.root).toBe('G');
		// User key 2 = Bb → Cm7 F7 Bbmaj7
		expect(sp!.harmony[segsPerKey * 3].chord.root).toBe('C');
	});

	it('total span equals (1 demo + keys.length) × progressionBars', () => {
		const sp = buildLickSuperPhrase(0);
		// (1 demo + 3 user keys) × 2 bars = 8 bars
		const lastSeg = sp!.harmony[sp!.harmony.length - 1];
		const endOffset =
			fractionToFloat(lastSeg.startOffset) + fractionToFloat(lastSeg.duration);
		expect(endOffset).toBe(8);
	});

	it('reports total length in difficulty.lengthBars', () => {
		const sp = buildLickSuperPhrase(0);
		// 3 user keys × 2 bars + 2 demo bars = 8
		expect(sp?.difficulty.lengthBars).toBe(8);
	});
});

describe('buildLickSuperPhrase — call-response mode', () => {
	beforeEach(() => {
		lickPractice.config.practiceMode = 'call-response';
		lickPractice.plan = plan({ id: SHORT_LICK_ID, keys: ['C', 'F'] });
	});

	it('emits melody notes for each key (the app plays the lick)', () => {
		const sp = buildLickSuperPhrase(0);
		// Each key gets the lick's notes once. short-ii-V-maj-001 has 4 notes.
		// 2 keys × 4 notes = 8 melody notes total
		expect(sp?.notes.length).toBe(8);
	});

	it('harmony spans the full keyBars (= 2 × progressionBars) per key', () => {
		const sp = buildLickSuperPhrase(0);
		// 3 segments × 2 (app + user halves) × 2 keys = 12 segments
		expect(sp?.harmony.length).toBe(12);
	});

	it('first key user-bars harmony starts at progressionBars', () => {
		const sp = buildLickSuperPhrase(0);
		// Key 0 app bars start at 0, user bars start at 2 (progressionBars)
		// The 3 app-bar segments come first, then the 3 user-bar segments.
		expect(fractionToFloat(sp!.harmony[3].startOffset)).toBe(2);
	});

	it('second key starts at 2 × progressionBars (not 1 × progressionBars)', () => {
		const sp = buildLickSuperPhrase(0);
		// Key 1 app bars start at 4 (= 1 × keyBars = 1 × 4)
		expect(fractionToFloat(sp!.harmony[6].startOffset)).toBe(4);
	});

	it('total span equals keys × 2 × progressionBars', () => {
		const sp = buildLickSuperPhrase(0);
		const lastSeg = sp!.harmony[sp!.harmony.length - 1];
		const endOffset =
			fractionToFloat(lastSeg.startOffset) + fractionToFloat(lastSeg.duration);
		// 2 keys × 4 bars (2 app + 2 user) = 8 bars
		expect(endOffset).toBe(8);
	});
});

describe('advance() — no retry logic', () => {
	beforeEach(() => {
		lickPractice.plan = plan({ id: SHORT_LICK_ID, keys: ['C', 'F', 'Bb'] });
		lickPractice.currentKeyIndex = 0;
	});

	it('always moves to the next key, regardless of pass/fail', () => {
		expect(advance()).toBe('next-key');
		expect(lickPractice.currentKeyIndex).toBe(1);

		expect(advance()).toBe('next-key');
		expect(lickPractice.currentKeyIndex).toBe(2);
	});

	it('returns end-of-lick when at the last key', () => {
		lickPractice.currentKeyIndex = 2;
		expect(advance()).toBe('end-of-lick');
		// currentKeyIndex stays at last key (the inter-lick transition resets it)
		expect(lickPractice.currentKeyIndex).toBe(2);
	});
});

describe('startInterLickTransition', () => {
	const fakeScore = (overall: number): Score => ({
		overall,
		pitchAccuracy: overall,
		rhythmAccuracy: overall,
		grade: 'good',
		noteResults: [],
		notesHit: 0,
		notesTotal: 0,
		timing: {
			meanOffsetMs: 0,
			medianOffsetMs: 0,
			stdDevMs: 0,
			latencyCorrectionMs: 0,
			perNoteOffsetMs: []
		}
	});

	it('archives keyResults and moves to the next lick', () => {
		lickPractice.plan = plan(
			{ id: SHORT_LICK_ID, keys: ['C'] },
			{ id: SHORT_LICK_ID, keys: ['F'] }
		);
		lickPractice.currentLickIndex = 0;
		lickPractice.currentKeyIndex = 0;
		recordKeyAttempt(fakeScore(0.5));

		expect(startInterLickTransition()).toBe('next-lick');
		expect(lickPractice.currentLickIndex).toBe(1);
		expect(lickPractice.currentKeyIndex).toBe(0);
		expect(lickPractice.allAttempts.length).toBe(1);
		expect(lickPractice.keyResults.length).toBe(0);
	});

	it('completes the session when on the last lick', () => {
		lickPractice.plan = plan({ id: SHORT_LICK_ID, keys: ['C'] });
		recordKeyAttempt(fakeScore(0.5));
		expect(startInterLickTransition()).toBe('complete');
		expect(lickPractice.phase).toBe('complete');
	});

	it('adjusts tempo based on average score (now always-on)', () => {
		lickPractice.plan = plan(
			{ id: SHORT_LICK_ID, keys: ['C', 'F'] },
			{ id: SHORT_LICK_ID, keys: ['G'] }
		);
		lickPractice.currentTempo = 100;
		recordKeyAttempt(fakeScore(0.5)); // C: failed
		lickPractice.currentKeyIndex = 1;
		recordKeyAttempt(fakeScore(0.9)); // F: passed
		startInterLickTransition();
		// avg = 0.7 → computeAutoTempoAdjustment returns -1, so tempo goes
		// from 100 → 99 and the next lick (same phraseId) inherits that.
		expect(lickPractice.currentTempo).toBe(99);
	});
});

// ─── Pickup-bar handling for the 3-bar major lick ────────────────────
//
// `major-chord-pickup-001` is a 3-bar lick (`lengthBars: 3`, `pickupBars: 1`):
// rests + a triplet pickup on beat 4 of lick bar 0, melodic bulk on lick bar 1,
// and a final note on beat 1 of lick bar 2. The engine shifts the
// `major-chord` category's base alignment left by `pickupBars` (clamped at
// `[0,1]`) so the pickup lands on the V chord wherever V exists; when the
// shifted lick wouldn't fit inside the progression cycle, the per-key window
// stretches and the progression's last chord sustains through the tail.

const PICKUP_LICK_ID = 'major-chord-pickup-001';

function planMajorChord(...items: Array<{ id: string; keys: string[] }>): LickPracticePlanItem[] {
	return items.map((item, idx) => ({
		phraseId: item.id,
		phraseName: item.id,
		phraseNumber: idx + 1,
		category: 'major-chord' as const,
		keys: item.keys as LickPracticePlanItem['keys']
	}));
}

describe('3-bar pickup major lick over major-vamp', () => {
	beforeEach(() => {
		lickPractice.config.progressionType = 'major-vamp';
		lickPractice.config.practiceMode = 'continuous';
		lickPractice.plan = planMajorChord({ id: PICKUP_LICK_ID, keys: ['C'] });
	});

	it('getKeyBars stretches to fit the 3-bar lick (progressionBars 2 → keyBars 3)', () => {
		expect(getProgressionBars()).toBe(2);
		expect(getKeyBars()).toBe(3);
	});

	it('super-phrase total span = (1 demo + 1 user) × 3 bars = 6', () => {
		const sp = buildLickSuperPhrase(0);
		const lastSeg = sp!.harmony[sp!.harmony.length - 1];
		const endOffset =
			fractionToFloat(lastSeg.startOffset) + fractionToFloat(lastSeg.duration);
		expect(endOffset).toBe(6);
		expect(sp?.difficulty.lengthBars).toBe(6);
	});

	it('each cycle is one Cmaj7 segment with duration extended to 3 bars', () => {
		const sp = buildLickSuperPhrase(0);
		// 1 segment per cycle × 2 cycles (demo + 1 user key) = 2 segments
		expect(sp?.harmony.length).toBe(2);
		expect(sp!.harmony[0].chord.root).toBe('C');
		expect(sp!.harmony[0].chord.quality).toBe('maj7');
		expect(fractionToFloat(sp!.harmony[0].duration)).toBe(3);
		expect(fractionToFloat(sp!.harmony[1].startOffset)).toBe(3);
		expect(fractionToFloat(sp!.harmony[1].duration)).toBe(3);
	});

	it('demo notes keep their original offsets — pickup at beat 4, final at bar 2 beat 1', () => {
		const sp = buildLickSuperPhrase(0);
		// Continuous mode: only the demo cycle emits melody (12 notes for this lick)
		expect(sp?.notes.length).toBe(12);
		// First note (pickup triplet's first eighth) is at beat 4 of lick bar 0
		expect(fractionToFloat(sp!.notes[0].offset)).toBe(0.75);
		// Last note (resolution) is at beat 1 of lick bar 2
		expect(fractionToFloat(sp!.notes[sp!.notes.length - 1].offset)).toBe(2);
	});
});

describe('3-bar pickup major lick over short ii-V-I-major', () => {
	beforeEach(() => {
		lickPractice.config.progressionType = 'ii-V-I-major';
		lickPractice.config.practiceMode = 'continuous';
		lickPractice.plan = planMajorChord({ id: PICKUP_LICK_ID, keys: ['C'] });
	});

	it('pickupBars shift moves alignment from [1,1] to [0,1]; keyBars stretches 2 → 3', () => {
		expect(getProgressionBars()).toBe(2);
		expect(getKeyBars()).toBe(3);
	});

	it('Cmaj7 (last segment) sustains an extra bar; Dm7/G7 unchanged', () => {
		const sp = buildLickSuperPhrase(0);
		// 3 segments per cycle × 2 cycles = 6 segments
		expect(sp?.harmony.length).toBe(6);
		// Demo cycle:
		//   [0]   Dm7  startOffset 0     duration 0.5
		//   [1]   G7   startOffset 0.5   duration 0.5
		//   [2]   Cmaj7 startOffset 1    duration 2 (extended from 1 → 2)
		expect(sp!.harmony[0].chord.root).toBe('D');
		expect(fractionToFloat(sp!.harmony[0].duration)).toBe(0.5);
		expect(sp!.harmony[1].chord.root).toBe('G');
		expect(fractionToFloat(sp!.harmony[1].duration)).toBe(0.5);
		expect(sp!.harmony[2].chord.root).toBe('C');
		expect(sp!.harmony[2].chord.quality).toBe('maj7');
		expect(fractionToFloat(sp!.harmony[2].duration)).toBe(2);
	});

	it('pickup falls on G7\'s last beat (beat 4 of progression bar 0)', () => {
		const sp = buildLickSuperPhrase(0);
		// First demo note is the start of the triplet pickup at beat 4
		expect(fractionToFloat(sp!.notes[0].offset)).toBe(0.75);
		// At offset 0.75 the harmony segment is G7 (covers [0.5, 1.0))
		// Sanity check: G7 starts at 0.5 with duration 0.5, so 0.75 falls inside it
		expect(fractionToFloat(sp!.harmony[1].startOffset)).toBe(0.5);
		expect(fractionToFloat(sp!.harmony[1].startOffset) + fractionToFloat(sp!.harmony[1].duration)).toBe(1);
	});

	it('total span = (1 demo + 1 user) × 3 bars = 6', () => {
		const sp = buildLickSuperPhrase(0);
		const lastSeg = sp!.harmony[sp!.harmony.length - 1];
		const endOffset =
			fractionToFloat(lastSeg.startOffset) + fractionToFloat(lastSeg.duration);
		expect(endOffset).toBe(6);
	});
});

describe('3-bar pickup major lick over long ii-V-I-major', () => {
	beforeEach(() => {
		lickPractice.config.progressionType = 'ii-V-I-major-long';
		lickPractice.config.practiceMode = 'continuous';
		lickPractice.plan = planMajorChord({ id: PICKUP_LICK_ID, keys: ['C'] });
	});

	it('lick fits in 4 bars: alignment shifts [2,1] → [1,1], no extension', () => {
		expect(getProgressionBars()).toBe(4);
		expect(getKeyBars()).toBe(4);
	});

	it('Cmaj7 last segment keeps its original 2-bar duration (no extension)', () => {
		const sp = buildLickSuperPhrase(0);
		// 3 segments per cycle × 2 cycles = 6 segments
		expect(sp?.harmony.length).toBe(6);
		expect(sp!.harmony[2].chord.root).toBe('C');
		expect(sp!.harmony[2].chord.quality).toBe('maj7');
		expect(fractionToFloat(sp!.harmony[2].duration)).toBe(2);
	});

	it('alignment offset [1,1] places pickup on G7\'s last beat (bar 1 beat 4)', () => {
		const sp = buildLickSuperPhrase(0);
		// Pickup's first note: original offset [3,4] (=0.75) shifted by [1,1] → 1.75
		expect(fractionToFloat(sp!.notes[0].offset)).toBe(1.75);
		// Final note: original [2,1] (=2) shifted by [1,1] → 3 (= bar 4 beat 1)
		expect(fractionToFloat(sp!.notes[sp!.notes.length - 1].offset)).toBe(3);
		// Bar 1 (G7) spans [1, 2) — 1.75 is inside
		expect(sp!.harmony[1].chord.root).toBe('G');
		expect(fractionToFloat(sp!.harmony[1].startOffset)).toBe(1);
		expect(fractionToFloat(sp!.harmony[1].duration)).toBe(1);
	});

	it('total span = (1 demo + 1 user) × 4 bars = 8', () => {
		const sp = buildLickSuperPhrase(0);
		const lastSeg = sp!.harmony[sp!.harmony.length - 1];
		const endOffset =
			fractionToFloat(lastSeg.startOffset) + fractionToFloat(lastSeg.duration);
		expect(endOffset).toBe(8);
	});
});

describe('3-bar pickup major lick — call-response mode', () => {
	beforeEach(() => {
		lickPractice.config.progressionType = 'ii-V-I-major';
		lickPractice.config.practiceMode = 'call-response';
		lickPractice.plan = planMajorChord({ id: PICKUP_LICK_ID, keys: ['C', 'F'] });
	});

	it('keyBars doubles the stretched lickBars (3 × 2 = 6)', () => {
		expect(getKeyBars()).toBe(6);
	});

	it('app and user halves of each key both span the stretched 3-bar window', () => {
		const sp = buildLickSuperPhrase(0);
		// Each key has the progression's 3 segments twice (app + user halves):
		// 3 × 2 × 2 keys = 12 segments
		expect(sp?.harmony.length).toBe(12);
		// User half of key 0 starts at offset 3 (= app phase of 3 stretched bars)
		// Segment index 3 is the start of the user half (Dm7 again)
		expect(sp!.harmony[3].chord.root).toBe('D');
		expect(fractionToFloat(sp!.harmony[3].startOffset)).toBe(3);
	});
});

describe('1-bar major-chord lick is unaffected by pickup-bar machinery', () => {
	const ONE_BAR_MAJOR_LICK_ID = 'major-chord-001';

	beforeEach(() => {
		lickPractice.config.practiceMode = 'continuous';
		lickPractice.plan = planMajorChord({ id: ONE_BAR_MAJOR_LICK_ID, keys: ['C'] });
	});

	it('on short ii-V-I-major: keyBars stays 2 (progressionBars), no extension', () => {
		lickPractice.config.progressionType = 'ii-V-I-major';
		expect(getKeyBars()).toBe(2);
		const sp = buildLickSuperPhrase(0);
		// Cmaj7 last segment keeps its original 1-bar duration
		expect(fractionToFloat(sp!.harmony[2].duration)).toBe(1);
	});

	it('on long ii-V-I-major: keyBars stays 4, alignment offset still [2,1]', () => {
		lickPractice.config.progressionType = 'ii-V-I-major-long';
		expect(getKeyBars()).toBe(4);
		const sp = buildLickSuperPhrase(0);
		// First demo note's offset = original [0,1] + alignment [2,1] = 2
		expect(fractionToFloat(sp!.notes[0].offset)).toBe(2);
	});
});

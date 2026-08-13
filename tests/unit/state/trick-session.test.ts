/**
 * Tests for the trick-drill integration in `state/lick-practice.svelte.ts`.
 *
 * A trick session reuses the single-lick round loop, but its plan item is a
 * `kind: 'trick'` item whose `phraseId` is the composite variant key and
 * whose progress writes must go to the TRICK store — never to
 * `lickPractice.progress` (the lick store). The invariants under test:
 *
 *   1. `startTrickSession` builds a one-item, C-rooted, major-vamp plan from
 *      `config.trickId`/`trickParameters` and fails cleanly on bad config.
 *      The KEY ROTATION anchors at the player's WRITTEN C (concert Bb on the
 *      default tenor sax) while the generation context stays concert C — the
 *      example transposes per key exactly like a C-stored lick.
 *   2. `recordKeyAttempt` on a trick item writes passes to the trick store
 *      and leaves the lick store untouched.
 *   3. `advanceSingleLickRound` refill path bumps the trick unlock count
 *      FIRST (clearing the rotation IS the trick unlock path), refills the
 *      circle from the written-C anchor, persists the bumped tempo per key to
 *      the trick store, and appends a progress-history point.
 *   4. Both round paths regenerate the disposable example phrase.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	lickPractice,
	startTrickSession,
	recordKeyAttempt,
	advanceSingleLickRound,
	resetSession,
	getLickBars
} from '$lib/state/lick-practice.svelte';
import { trickVariantKey, type TrickParameters } from '$lib/types/tricks';
import { getTrickById, trickContextFor } from '$lib/tricks';
import {
	loadTrickPracticeProgress,
	saveTrickPracticeProgress,
	updateTrickKeyProgress,
	getTrickUnlockedKeyCount,
	bumpTrickUnlockedKeyCount,
	getTrickProgressHistory,
	TRICK_DEFAULT_TEMPO
} from '$lib/persistence/trick-practice-store';
import { settings } from '$lib/state/settings.svelte';
import { clampTempo } from '$lib/persistence/lick-practice-store';
import {
	nextCycleTempo,
	DEFAULT_TEMPO_BUMP_PERCENT
} from '$lib/state/lick-practice-rotation';
import type { Score } from '$lib/types/scoring';

// ── localStorage stub shared by the trick / lick / outbox stores ──
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

// First rung of the enclosures major chain — always unlocked.
const E1_PARAMS: TrickParameters = {
	noteCount: '1',
	shape: 'chromatic-below',
	targetTone: 'root',
	beatPlacement: 'downbeat',
	type: 'major'
};
const E1_KEY = trickVariantKey('enclosures', E1_PARAMS);

function makeScore(overall: number): Score {
	return {
		pitchAccuracy: overall,
		rhythmAccuracy: overall,
		overall,
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
	};
}

beforeEach(() => {
	store.clear();
	resetSession();
	lickPractice.progress = {};
	lickPractice.config.trickId = 'enclosures';
	lickPractice.config.trickParameters = { ...E1_PARAMS };
	lickPractice.config.tempoBumpPercent = undefined;
	// Explicit anchor for the key pins below: on the tenor (a Bb horn) the
	// player's written C is concert Bb, so the drill rotation starts there.
	settings.instrumentId = 'tenor-sax';
});

describe('startTrickSession', () => {
	it('returns false when trick config is missing or unknown', () => {
		lickPractice.config.trickId = undefined;
		expect(startTrickSession()).toBe(false);

		lickPractice.config.trickId = 'no-such-trick';
		expect(startTrickSession()).toBe(false);
		expect(lickPractice.plan).toHaveLength(0);
	});

	it('builds a one-item C-rooted trick plan over the major vamp', () => {
		expect(startTrickSession()).toBe(true);

		expect(lickPractice.plan).toHaveLength(1);
		const item = lickPractice.plan[0];
		expect(item.kind).toBe('trick');
		// For trick items the composite variant key IS the phraseId.
		expect(item.phraseId).toBe(E1_KEY);
		expect(item.phraseName).toContain(getTrickById('enclosures')!.name);
		expect(item.progressionType).toBe('major-vamp');
		// Fresh store → one unlocked key: the player's written C, which on the
		// tenor is concert Bb. The generation context below stays concert C.
		expect(item.keys).toEqual(['Bb']);
		expect(item.trickId).toBe('enclosures');
		expect(item.trickParameters).toEqual(E1_PARAMS);
		expect(item.trickContext).toMatchObject({
			chordRoot: 'C',
			chordQuality: 'maj7',
			scaleId: 'major.ionian',
			key: 'C',
			timeSignature: [4, 4]
		});
		// The example realizes in the C context so the existing per-key
		// transposition path works unchanged.
		expect(item.phrase).toBeDefined();
		expect(item.phrase!.key).toBe('C');

		expect(lickPractice.mode).toBe('single-lick');
		expect(lickPractice.roundNumber).toBe(1);
		expect(lickPractice.phase).toBe('count-in');
		expect(lickPractice.currentTempo).toBe(TRICK_DEFAULT_TEMPO);
	});

	it('drills a minor-type enclosure over the minor vamp with a 5-bar window', () => {
		lickPractice.config.trickParameters = { ...E1_PARAMS, type: 'minor' };
		expect(startTrickSession()).toBe(true);

		const item = lickPractice.plan[0];
		// The type parameter picks the bed; the C context mirrors its chord/scale.
		expect(item.progressionType).toBe('minor-vamp');
		expect(item.trickContext).toMatchObject({
			chordRoot: 'C',
			chordQuality: 'min7',
			scaleId: 'major.dorian',
			key: 'C'
		});
		expect(item.phrase!.harmony[0].chord.quality).toBe('min7');
		// Full equality against the shared derivation (see the triad-pair test).
		expect(item.trickContext).toEqual(
			trickContextFor(getTrickById('enclosures')!, { ...E1_PARAMS, type: 'minor' }, 'C', TRICK_DEFAULT_TEMPO)
		);
		// Progress/tempo key under the minor chain's own variant key.
		expect(item.phraseId).toBe(trickVariantKey('enclosures', { ...E1_PARAMS, type: 'minor' }));

		// The full drill figure: anacrusis + 4 content bars stretches the
		// 2-bar vamp to a 5-bar per-key window.
		expect(item.phrase!.difficulty.lengthBars).toBe(5);
		expect(item.phrase!.difficulty.pickupBars).toBe(1);
		expect(getLickBars(item.phrase!, item.progressionType, false)).toBe(5);
	});

	it('drills a quality-specific triad-pair family over its own vamp', () => {
		// The altered pair belongs on a dominant chord; the C-rooted context
		// mirrors the dominant vamp's chord + scale so the example, the
		// conformance scale set, and the rhythm section all agree.
		lickPractice.config.trickId = 'triad-pairs';
		lickPractice.config.trickParameters = { pair: 'minor-b9' };
		expect(startTrickSession()).toBe(true);

		const item = lickPractice.plan[0];
		expect(item.progressionType).toBe('dominant-vamp');
		expect(item.trickContext).toMatchObject({
			chordRoot: 'C',
			chordQuality: '7',
			scaleId: 'major.mixolydian',
			key: 'C'
		});
		// The stored session context IS the shared derivation — full equality,
		// so the trick page's preview (which calls trickContextFor directly)
		// provably cannot drift from what the drill schedules.
		expect(item.trickContext).toEqual(
			trickContextFor(getTrickById('triad-pairs')!, { pair: 'minor-b9' }, 'C', TRICK_DEFAULT_TEMPO)
		);
		expect(item.phrase!.key).toBe('C');
		expect(item.phrase!.harmony[0].chord.quality).toBe('7');

		// The tonic melodic-minor family drills over the minor vamp.
		resetSession();
		lickPractice.config.trickId = 'triad-pairs';
		lickPractice.config.trickParameters = { pair: 'aug-major' };
		expect(startTrickSession()).toBe(true);
		expect(lickPractice.plan[0].progressionType).toBe('minor-vamp');
		expect(lickPractice.plan[0].trickContext!.chordQuality).toBe('min7');
	});

	it('anchors the rotation at the player\'s written C, per instrument', () => {
		// Concert-pitch instrument: written C IS concert C.
		settings.instrumentId = 'concert';
		expect(startTrickSession()).toBe(true);
		expect(lickPractice.plan[0].keys).toEqual(['C']);
		// The generation context is unaffected — examples always realize in
		// concert C and transpose per key like a C-stored lick.
		expect(lickPractice.plan[0].trickContext).toMatchObject({ chordRoot: 'C', key: 'C' });

		// Alto sax (Eb horn): written C = concert Eb.
		resetSession();
		lickPractice.config.trickId = 'enclosures';
		lickPractice.config.trickParameters = { ...E1_PARAMS };
		settings.instrumentId = 'alto-sax';
		expect(startTrickSession()).toBe(true);
		expect(lickPractice.plan[0].keys).toEqual(['Eb']);
	});

	it('orders the unlocked keys along the circle of 4ths from the anchor', () => {
		// Three unlocks under tenor: the RAMP earns concert Bb, F, Eb (written
		// C, G, F — easiest first by accidental count), but the session rotation
		// runs them in circle-of-4ths order from the anchor: Bb → Eb → F
		// (written C → F → G), matching lick practice.
		bumpTrickUnlockedKeyCount(E1_KEY);
		bumpTrickUnlockedKeyCount(E1_KEY);
		expect(getTrickUnlockedKeyCount(E1_KEY)).toBe(3);

		expect(startTrickSession()).toBe(true);
		expect(lickPractice.plan[0].keys).toEqual(['Bb', 'Eb', 'F']);
		expect(lickPractice.sessionKeys).toEqual(['Bb', 'Eb', 'F']);
	});

	it('clamps a corrupt stored tempo — mirrors resolveLickTempo', () => {
		// A bad cloud merge or hand-edited localStorage could leave an absurd
		// tempo in the trick store; the session must start within clamp bounds.
		saveTrickPracticeProgress(updateTrickKeyProgress({}, E1_KEY, 'C', { currentTempo: 1000 }));

		expect(startTrickSession()).toBe(true);

		// Read the actual ceiling from the store module rather than a literal.
		const ceiling = clampTempo(Number.POSITIVE_INFINITY);
		expect(ceiling).toBeLessThan(1000);
		expect(lickPractice.currentTempo).toBe(ceiling);
	});
});

describe('recordKeyAttempt on a trick item', () => {
	it('writes passes to the trick store, never the lick store', () => {
		expect(startTrickSession()).toBe(true);

		recordKeyAttempt(makeScore(0.92));

		// Lick-practice progress stays untouched by trick items.
		expect(lickPractice.progress).toEqual({});

		const trickProgress = loadTrickPracticeProgress();
		expect(trickProgress[E1_KEY]?.Bb?.passCount).toBe(1);
		expect(trickProgress[E1_KEY]?.Bb?.currentTempo).toBe(TRICK_DEFAULT_TEMPO);

		expect(lickPractice.keyResults).toHaveLength(1);
		expect(lickPractice.keyResults[0].passed).toBe(true);
		// 0.92 passes but doesn't clear the 0.95 mastery bar.
		expect(lickPractice.masteredThisRound).toEqual([]);
	});

	it('does not write a failed attempt to the trick store', () => {
		expect(startTrickSession()).toBe(true);

		recordKeyAttempt(makeScore(0.5));

		expect(loadTrickPracticeProgress()[E1_KEY]).toBeUndefined();
		expect(lickPractice.keyResults[0].passed).toBe(false);
	});
});

describe('advanceSingleLickRound on a trick item', () => {
	it('refill path: bumps unlock count first, refills from the written-C anchor, persists tempo to the trick store', () => {
		expect(startTrickSession()).toBe(true);
		const phraseIdBefore = lickPractice.plan[0].phrase!.id;

		// Master the only unlocked key so the rotation clears.
		recordKeyAttempt(makeScore(0.96));
		expect(lickPractice.masteredThisRound).toEqual(['Bb']);

		advanceSingleLickRound();

		const item = lickPractice.plan[0];
		// Clearing the rotation IS the trick unlock path: count bumps to 2 and
		// the refilled circle includes the newly earned key (F, the first
		// sharp-side neighbour of the concert-Bb anchor — written G on tenor).
		expect(getTrickUnlockedKeyCount(E1_KEY)).toBe(2);
		expect(item.keys).toEqual(['Bb', 'F']);

		// Default 1% bump (rounded up to a whole BPM), persisted per refilled
		// key to the TRICK store. Tricks DO persist, unlike deep lick practice:
		// clearing the rotation is a trick's only advancement path, and there
		// is no daily session to hand a surprise tempo to.
		const bumped = nextCycleTempo(TRICK_DEFAULT_TEMPO, DEFAULT_TEMPO_BUMP_PERCENT);
		expect(lickPractice.currentTempo).toBe(bumped);
		const trickProgress = loadTrickPracticeProgress();
		expect(trickProgress[E1_KEY]?.Bb?.currentTempo).toBe(bumped);
		expect(trickProgress[E1_KEY]?.F?.currentTempo).toBe(bumped);
		// The lick store never sees the variant key.
		expect(lickPractice.progress).toEqual({});

		const history = getTrickProgressHistory(E1_KEY);
		expect(history).toHaveLength(1);
		expect(history[0]).toMatchObject({ bpm: bumped, keys: 2 });

		// The disposable example is regenerated each round.
		expect(item.phrase).toBeDefined();
		expect(item.phrase!.id).not.toBe(phraseIdBefore);

		expect(lickPractice.roundNumber).toBe(2);
		expect(lickPractice.phase).toBe('inter-lick-rest');
	});

	it('survivor path: keeps unmastered keys, no unlock/tempo change, still regenerates the example', () => {
		expect(startTrickSession()).toBe(true);
		const phraseIdBefore = lickPractice.plan[0].phrase!.id;

		// Passing but below the 0.95 mastery bar → the anchor key survives.
		recordKeyAttempt(makeScore(0.9));
		advanceSingleLickRound();

		const item = lickPractice.plan[0];
		expect(item.keys).toEqual(['Bb']);
		expect(getTrickUnlockedKeyCount(E1_KEY)).toBe(1);
		expect(lickPractice.currentTempo).toBe(TRICK_DEFAULT_TEMPO);
		expect(getTrickProgressHistory(E1_KEY)).toHaveLength(0);

		expect(item.phrase).toBeDefined();
		expect(item.phrase!.id).not.toBe(phraseIdBefore);
	});
});

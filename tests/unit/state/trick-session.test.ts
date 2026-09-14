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
	getLickBars,
	getDemoBars,
	getKeyBars,
	getCurrentPhrase,
	getCurrentHarmony,
	getPhraseFor,
	getPlannedKeysForLick,
	buildLickSuperPhrase,
	getSessionReport,
	trickPracticeProgressKey,
	trickPracticeLabel
} from '$lib/state/lick-practice.svelte';
import { trickVariantKey, type TrickParameters } from '$lib/types/tricks';
import { getTrickById, trickContextFor, transposeTrickContext } from '$lib/tricks';
import { getVariantByKey } from '$lib/tricks/mastery';
import { PITCH_CLASSES } from '$lib/types/music';
import { fractionToFloat } from '$lib/music/intervals';
import { scoreFluency } from '$lib/scoring/fluency';
import { migrateEnclosureVariantKey } from '$lib/persistence/trick-state-migrations';
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
	lickPractice.config.trickProgressionType = undefined;
	lickPractice.config.practiceMode = 'continuous';
	lickPractice.config.tempoBumpPercent = undefined;
	// Explicit anchor for the key pins below: on the tenor (a Bb horn) the
	// player's written C is concert Bb, so the drill rotation starts there.
	settings.instrumentId = 'tenor-sax';
});

describe('enclosure progression sessions', () => {
	const enclosure = getTrickById('enclosures')!;
	const beds = ['ii-V-I-major-long', 'ii-V-I-minor-long'] as const;

	it('keeps progression progress stable, canonical and separate from every family key', () => {
		const major = trickPracticeProgressKey(enclosure, E1_PARAMS, beds[0]);
		const minor = trickPracticeProgressKey(enclosure, E1_PARAMS, beds[1]);
		expect(major).toBe(`trick-progression:${beds[0]}:${E1_KEY}`);
		expect(minor).not.toBe(major);
		expect(trickPracticeProgressKey(enclosure, { ...E1_PARAMS, type: 'dominant' }, beds[0])).toBe(major);
		expect(trickPracticeProgressKey(enclosure, { ...E1_PARAMS, type: 'minor' }, beds[1])).toBe(minor);
		expect(trickPracticeProgressKey(enclosure, E1_PARAMS)).toBe(E1_KEY);
		// The old enclosure migration must never reinterpret the new namespace.
		expect(migrateEnclosureVariantKey(major)).toBe(major);
		expect(migrateEnclosureVariantKey(minor)).toBe(minor);
	});

	it.each(beds)('starts %s independently of the standard lick progression and remembered family', (bed) => {
		lickPractice.config.progressionType = 'blues';
		lickPractice.config.trickParameters = { ...E1_PARAMS, type: 'dominant' };
		lickPractice.config.trickProgressionType = bed;
		expect(startTrickSession()).toBe(true);
		const item = lickPractice.plan[0];
		expect(item.progressionType).toBe(bed);
		expect(item.trickParameters?.type).toBe(bed === beds[0] ? 'major' : 'minor');
		expect(item.trickContext?.harmony?.map((s) => s.chord.root)).toEqual(['D', 'G', 'C']);
		expect(item.phrase!.harmony.map((s) => s.chord.root)).toEqual(['C', 'D', 'G', 'C']);
		expect(item.phrase!.harmony.map((s) => fractionToFloat(s.startOffset))).toEqual([0, 1, 2, 3]);
		expect(item.phrase!.harmony.map((s) => fractionToFloat(s.duration))).toEqual([1, 1, 1, 2]);
		expect(item.phrase!.difficulty.pickupBars).toBe(1);
		expect(getDemoBars(0)).toBe(5);
		expect(getKeyBars()).toBe(5);
		expect(lickPractice.config.progressionType).toBe('blues');
	});

	it.each(beds)('transposes all %s arrival groups, accompaniment and scoring across all keys', (bed) => {
		lickPractice.config.trickProgressionType = bed;
		expect(startTrickSession()).toBe(true);
		const item = lickPractice.plan[0];
		item.keys = [...PITCH_CLASSES];
		for (let index = 0; index < PITCH_CLASSES.length; index++) {
			const key = PITCH_CLASSES[index];
			lickPractice.currentKeyIndex = index;
			const phrase = getCurrentPhrase()!;
			const pitched = phrase.notes.filter((n) => n.pitch !== null);
			// Root targets: chromatic pickup into ii, V and I. These must
			// transpose as a complete progression, not align with I as a lick.
			expect(pitched.map((n) => n.pitch! % 12)).toEqual(
				[1, 2, 6, 7, 11, 0].map((pc) => (pc + index) % 12)
			);
			expect(pitched.map((n) => fractionToFloat(n.offset))).toEqual([0.875, 1, 1.875, 2, 2.875, 3]);
			expect(phrase.harmony.map((s) => s.chord.root)).toEqual(
				[0, 2, 7, 0].map((pc) => PITCH_CLASSES[(pc + index) % 12])
			);
			expect(phrase.harmony[0].symbol).toContain(key);
			expect(getCurrentHarmony()).toEqual(phrase.harmony);
			expect(getPhraseFor(0, index)).toEqual(phrase);
			const context = transposeTrickContext(item.trickContext!, key);
			const played = pitched.map((n) => ({
				midi: n.pitch!, cents: 0, clarity: 1,
				onsetTime: fractionToFloat(n.offset) * 4 * 60 / context.tempo,
				duration: fractionToFloat(n.duration) * 4 * 60 / context.tempo
			}));
			const score = scoreFluency({ played, trick: enclosure, parameters: item.trickParameters!, context });
			expect(score.pitchAccuracy).toBe(1);
			expect(score.conformance.slots.every((slot) => slot.tier === 'exact')).toBe(true);
		}
		expect(getPlannedKeysForLick(0).map((row) => row.harmony)).toEqual(
			PITCH_CLASSES.map((_, index) => getPhraseFor(0, index)!.harmony)
		);
	});

	it.each(['continuous', 'call-response'] as const)('schedules the same pickup and complete harmony in %s mode', (mode) => {
		lickPractice.config.trickProgressionType = beds[0];
		lickPractice.config.practiceMode = mode;
		expect(startTrickSession()).toBe(true);
		lickPractice.plan[0].keys = ['Bb', 'F'];
		const phrase = buildLickSuperPhrase(0)!;
		const copies = mode === 'continuous' ? ['Bb', 'Bb', 'F'] : ['Bb', 'Bb', 'F', 'F'];
		expect(phrase.difficulty.lengthBars).toBe(copies.length * 5);
		expect(phrase.harmony).toHaveLength(copies.length * 4);
		copies.forEach((key, index) => {
			const segments = phrase.harmony.slice(index * 4, index * 4 + 4);
			expect(segments[0].chord.root).toBe(key);
			expect(segments.map((s) => fractionToFloat(s.startOffset))).toEqual(
				[0, 1, 2, 3].map((offset) => offset + index * 5)
			);
			expect(segments.map((s) => fractionToFloat(s.duration))).toEqual([1, 1, 1, 2]);
		});
		expect(phrase.notes.filter((n) => n.pitch !== null)).toHaveLength(mode === 'continuous' ? 6 : 12);
		const firstNotes = getPhraseFor(0, 0)!.notes;
		expect(phrase.notes.slice(0, firstNotes.length)).toEqual(firstNotes);
		if (mode === 'call-response') {
			expect(phrase.notes.slice(firstNotes.length).map((n) => fractionToFloat(n.offset))).toEqual(
				getPhraseFor(0, 1)!.notes.map((n) => fractionToFloat(n.offset) + 10)
			);
		}
	});

	it('does not add a pickup bar when a one-note offbeat approach fits at the start', () => {
		lickPractice.config.trickProgressionType = beds[0];
		lickPractice.config.trickParameters = { ...E1_PARAMS, beatPlacement: 'offbeat' };
		expect(startTrickSession()).toBe(true);
		expect(getCurrentPhrase()!.difficulty.pickupBars).toBe(0);
		expect(getCurrentHarmony()).toHaveLength(3);
		expect(getCurrentPhrase()!.notes[0].offset).toEqual([0, 1]);
		expect(getKeyBars()).toBe(4);
		expect(getDemoBars(0)).toBe(4);
		expect(buildLickSuperPhrase(0)!.difficulty.lengthBars).toBe(8);
	});

	it('persists progression improvement without changing family passes, tempo, unlocks or history', () => {
		saveTrickPracticeProgress(updateTrickKeyProgress({}, E1_KEY, 'Bb', {
			passCount: 7, currentTempo: 100, lastPracticedAt: 1
		}));
		bumpTrickUnlockedKeyCount(E1_KEY);
		const familyBefore = loadTrickPracticeProgress()[E1_KEY];
		lickPractice.config.trickProgressionType = beds[0];
		expect(startTrickSession()).toBe(true);
		const progressKey = lickPractice.plan[0].phraseId;
		expect(lickPractice.currentTempo).toBe(TRICK_DEFAULT_TEMPO);
		expect(lickPractice.plan[0].keys).toEqual(['Bb']);
		const phraseBefore = lickPractice.plan[0].phrase!.id;
		recordKeyAttempt(makeScore(0.99), 'progression-take');
		advanceSingleLickRound();
		expect(loadTrickPracticeProgress()[progressKey]?.Bb?.passCount).toBe(1);
		expect(getTrickUnlockedKeyCount(progressKey)).toBe(2);
		expect(getTrickProgressHistory(progressKey)).toHaveLength(1);
		expect(lickPractice.plan[0].keys).toEqual(['Bb', 'F']);
		expect(lickPractice.plan[0].phrase!.id).not.toBe(phraseBefore);
		expect(lickPractice.plan[0].phrase!.harmony).toHaveLength(4);
		expect(loadTrickPracticeProgress()[E1_KEY]).toEqual(familyBefore);
		expect(getTrickUnlockedKeyCount(E1_KEY)).toBe(2);
		expect(getTrickProgressHistory(E1_KEY)).toEqual([]);
		expect(lickPractice.progress).toEqual({});
		expect(getSessionReport().licks[0].keys[0].sessionId).toBe('progression-take');
		const savedTempo = lickPractice.currentTempo;
		resetSession();
		expect(startTrickSession()).toBe(true);
		expect(lickPractice.currentTempo).toBe(savedTempo);
		expect(lickPractice.plan[0].keys).toEqual(['Bb', 'F']);
		resetSession();
		lickPractice.config.trickProgressionType = beds[1];
		expect(startTrickSession()).toBe(true);
		expect(lickPractice.currentTempo).toBe(TRICK_DEFAULT_TEMPO);
		expect(lickPractice.plan[0].keys).toEqual(['Bb']);
	});

	it('accepts a valid progression gesture outside the family mastery catalog', () => {
		lickPractice.config.trickProgressionType = beds[1];
		lickPractice.config.trickParameters = {
			...E1_PARAMS, noteCount: '3', shape: 'double-chromatic', targetTone: 'fifth', beatPlacement: 'offbeat'
		};
		expect(startTrickSession()).toBe(true);
		expect(getCurrentPhrase()!.notes.filter((n) => n.pitch !== null)).toHaveLength(12);
		expect(lickPractice.plan[0].phraseId).toMatch(/^trick-progression:/);
		expect(lickPractice.plan[0].phraseName).toBe(
			'Enclosures · Minor · Three approach notes · Double chromatic · Target 5th · Off the beat'
		);
		expect(lickPractice.plan[0].phraseName).not.toMatch(/noteCount|targetTone|beatPlacement|=/);
	});

	it('preserves catalog labels and shares readable custom labels with setup', () => {
		expect(trickPracticeLabel(enclosure, E1_PARAMS)).toBe(getVariantByKey(E1_KEY)!.label);
		const custom = { ...E1_PARAMS, targetTone: 'fifth' };
		expect(trickPracticeLabel(enclosure, custom)).toBe(
			'Major · One approach note · Chromatic from below · Target 5th · On the beat'
		);
	});

	it('normalizes an explicitly selected vamp to its matching family', () => {
		lickPractice.config.trickProgressionType = 'minor-vamp';
		expect(startTrickSession()).toBe(true);
		expect(lickPractice.plan[0].phraseId).toBe(trickVariantKey('enclosures', { ...E1_PARAMS, type: 'minor' }));
		expect(lickPractice.plan[0].trickContext?.chordQuality).toBe('min7');
		expect(lickPractice.plan[0].trickContext?.harmony).toBeUndefined();
	});

	it('does not apply an enclosure progression selection to triad pairs', () => {
		lickPractice.config.trickId = 'triad-pairs';
		lickPractice.config.trickParameters = { pair: 'minor-b9' };
		lickPractice.config.trickProgressionType = beds[1];
		expect(startTrickSession()).toBe(true);
		expect(lickPractice.plan[0].progressionType).toBe('dominant-vamp');
		expect(lickPractice.plan[0].phraseId).toBe(trickVariantKey('triad-pairs', { pair: 'minor-b9' }));
		expect(lickPractice.plan[0].trickContext?.harmony).toBeUndefined();
	});
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


describe('trick demo policy — Listen only when there is something new to hear', () => {
	beforeEach(() => {
		store.clear();
		resetSession();
		lickPractice.config.trickId = 'enclosures';
		lickPractice.config.trickParameters = E1_PARAMS;
		lickPractice.config.practiceMode = 'continuous';
	});

	it('an enclosure session demos its first cycle and never again', () => {
		expect(startTrickSession()).toBe(true);
		expect(lickPractice.demoNextCycle).toBe(true);
		expect(getDemoBars(0)).toBe(getKeyBars());

		// Survivor path (nothing cleared): round 2 — same single style, no demo.
		lickPractice.masteredThisRound = [];
		advanceSingleLickRound();
		expect(lickPractice.roundNumber).toBe(2);
		expect(lickPractice.demoNextCycle).toBe(false);
		expect(getDemoBars(0)).toBe(0);

		// Refill path (whole rotation cleared → unlock + refill): still no demo.
		lickPractice.masteredThisRound = [...lickPractice.plan[0].keys];
		advanceSingleLickRound();
		expect(lickPractice.roundNumber).toBe(3);
		expect(lickPractice.demoNextCycle).toBe(false);
		expect(getDemoBars(0)).toBe(0);
	});

	it('a triad-pair session demos once per example style, then never again', () => {
		lickPractice.config.trickId = 'triad-pairs';
		lickPractice.config.trickParameters = { pair: 'major-whole' };
		expect(startTrickSession()).toBe(true);
		const styles = getTrickById('triad-pairs')!.exampleStyles!;
		expect(styles.length).toBe(3);

		// Round 1 (cell) demos; rounds 2 and 3 introduce triplets and four
		// eighths — each demos; round 4 cycles back to cell — no demo, ever after.
		expect(lickPractice.demoNextCycle).toBe(true);
		const expected = [true, true, false, false, false];
		for (const demo of expected) {
			lickPractice.masteredThisRound = [];
			advanceSingleLickRound();
			expect(lickPractice.demoNextCycle).toBe(demo);
			expect(getDemoBars(0)).toBe(demo ? getKeyBars() : 0);
		}
		expect(lickPractice.roundNumber).toBe(6);
	});

	it('call-and-response keeps its own per-key call and never adds the upfront demo', () => {
		lickPractice.config.practiceMode = 'call-response';
		expect(startTrickSession()).toBe(true);
		expect(getDemoBars(0)).toBe(0);
		lickPractice.masteredThisRound = [];
		advanceSingleLickRound();
		expect(lickPractice.demoNextCycle).toBe(false);
	});
});

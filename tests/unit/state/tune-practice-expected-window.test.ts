import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { LickSuggestion } from '$lib/tunes/lick-matcher';
import type { InsertionPoint } from '$lib/state/tune-practice-plan';
import { getAllLicks } from '$lib/phrases/library-loader';
import { fractionToFloat } from '$lib/music/intervals';
import {
	candidatesForWindow,
	expectedForSuggestion,
	pickSuggestion,
	suggestionNameFor,
	trickForSuggestion,
	tunePractice,
	resetTunePractice
} from '$lib/state/tune-practice.svelte';
import { getTrickById } from '$lib/tricks';
import type { TrickContext } from '$lib/types/tricks';

// getAllLicks reads localStorage for user licks; mock it so the curated catalog
// loads cleanly in node.
const store: Record<string, string> = {};
Object.defineProperty(globalThis, 'localStorage', {
	writable: true,
	value: {
		getItem: (k: string) => store[k] ?? null,
		setItem: (k: string, v: string) => {
			store[k] = v;
		},
		removeItem: (k: string) => delete store[k],
		clear: () => {
			for (const k of Object.keys(store)) delete store[k];
		},
		get length() {
			return Object.keys(store).length;
		},
		key: (i: number) => Object.keys(store)[i] ?? null
	}
});

function suggestion(lickId: string, insertionOffset: [number, number]): LickSuggestion {
	return {
		lickId,
		lickName: 'Test Lick',
		category: 'ii-V-I-major',
		targetKey: 'C', // curated licks are stored in C → transposition is identity
		insertionOffset,
		insertionBar: 0,
		templateAlignmentOffset: [0, 1],
		masteryTier: 'unknown',
		matchSources: ['category'],
		substitution: null,
		inPracticeSet: false,
		difficultyLevel: 20
	};
}

function ip(startOffset: [number, number], s: LickSuggestion): InsertionPoint {
	return { id: 'ip-0', startOffset, suggestions: [s] } as InsertionPoint;
}

describe('expectedForSuggestion', () => {
	// A real curated lick with pitched notes — expectedForSuggestion resolves it via
	// getBaseLickFromId, so it must exist in the catalog.
	const lick = getAllLicks().find((l) => l.notes.some((n) => n.pitch !== null))!;

	beforeEach(() => resetTunePractice());

	it('returns the transposed lick unchanged when the insertion sits at the window start', () => {
		const s = suggestion(lick.id, [0, 1]);
		const out = expectedForSuggestion(ip([0, 1], s), s);
		expect(out).not.toBeNull();
		// No shift: offsets match the source lick's.
		expect(out!.phrase.notes.map((n) => fractionToFloat(n.offset))).toEqual(
			lick.notes.map((n) => fractionToFloat(n.offset))
		);
	});

	it('shifts every note/harmony offset when the insertion starts mid-window', () => {
		// insertionOffset 1/4 into a window that starts at 0 → shift every offset +1/4.
		const s = suggestion(lick.id, [1, 4]);
		const out = expectedForSuggestion(ip([0, 1], s), s);
		expect(out).not.toBeNull();
		out!.phrase.notes.forEach((n, i) => {
			expect(fractionToFloat(n.offset)).toBeCloseTo(fractionToFloat(lick.notes[i].offset) + 0.25, 6);
		});
	});

	it('returns null when the suggestion cannot be resolved', () => {
		const s = suggestion('no-such-lick-id', [0, 1]);
		expect(expectedForSuggestion(ip([0, 1], s), s)).toBeNull();
	});
});

describe('picking a suggestion (suggest mode cycles picks per window)', () => {
	const licks = getAllLicks().filter((l) => l.notes.some((n) => n.pitch !== null));

	beforeEach(() => resetTunePractice());

	it('the pick selects both the chart label and the phrase the window expects', () => {
		const first = { ...suggestion(licks[0].id, [0, 1]), lickName: 'First' };
		const second = { ...suggestion(licks[1].id, [0, 1]), lickName: 'Second' };
		const point = { id: 'ip-0', startOffset: [0, 1], suggestions: [first, second] } as InsertionPoint;

		expect(suggestionNameFor(point)).toBe('First');
		pickSuggestion('ip-0', 1);
		expect(tunePractice.pickedSuggestion).toEqual({ 'ip-0': 1 });
		expect(suggestionNameFor(point)).toBe('Second');
		// At the lick cue level (Guided) the pick IS the one accepted answer.
		const guided = candidatesForWindow(point, 'lick');
		expect(guided.map((c) => c.lickName)).toEqual(['Second']);
		expect(guided[0].phrase!.id).toBe(licks[1].id);
	});

	it('accepts every fitting lick once the chart stops naming one', () => {
		// Standard/Solo never told the player which lick to play, so the pick
		// is irrelevant and both licks are valid answers.
		const first = { ...suggestion(licks[0].id, [0, 1]), lickName: 'First' };
		const second = { ...suggestion(licks[1].id, [0, 1]), lickName: 'Second' };
		const point = { id: 'ip-0', startOffset: [0, 1], suggestions: [first, second] } as InsertionPoint;

		pickSuggestion('ip-0', 1);
		for (const level of ['progression', 'none'] as const) {
			expect(candidatesForWindow(point, level).map((c) => c.lickName)).toEqual([
				'First',
				'Second'
			]);
		}
	});

	it('names nothing for a window with no suggestions', () => {
		expect(suggestionNameFor({ id: 'ip-9', startOffset: [0, 1], suggestions: [] } as unknown as InsertionPoint)).toBeNull();
	});
});

describe('trickForSuggestion (Fluency-scored windows)', () => {
	const context: TrickContext = {
		chordRoot: 'C',
		chordQuality: 'maj7',
		scaleId: 'major.ionian',
		key: 'C',
		timeSignature: [4, 4],
		level: 50,
		tempo: 120
	};
	const params = { pair: 'major-whole' };
	function trickSuggestion(trickId: string, insertionOffset: [number, number]): LickSuggestion {
		return {
			...suggestion(`${trickId}:pair=major-whole`, insertionOffset),
			trick: { trickId, parameters: params, context }
		};
	}

	beforeEach(() => resetTunePractice());

	it('is null for an ordinary lick pick — that window scores on the exact-phrase path', () => {
		const lick = getAllLicks()[0];
		const s = suggestion(lick.id, [0, 1]);
		expect(trickForSuggestion(ip([0, 1], s), s)).toBeNull();
	});

	it('resolves the device and rebases by the insertion\'s shift inside the window', () => {
		// The window opens at bar 1 but the trick is aligned to bar 3: the
		// played onsets must be moved back by two bars before scoring.
		const s = trickSuggestion('triad-pairs', [3, 1]);
		const out = trickForSuggestion(ip([1, 1], s), s);
		expect(out).not.toBeNull();
		expect(out!.trick).toBe(getTrickById('triad-pairs'));
		expect(out!.parameters).toBe(params);
		expect(out!.context).toBe(context);
		expect(fractionToFloat(out!.shift)).toBe(2);
	});

	it('is null when the suggestion names a trick the catalog no longer has', () => {
		const s = trickSuggestion('retired-device', [0, 1]);
		expect(trickForSuggestion(ip([0, 1], s), s)).toBeNull();
	});
});

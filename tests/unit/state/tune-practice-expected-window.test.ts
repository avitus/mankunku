import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { LickSuggestion } from '$lib/tunes/lick-matcher';
import type { InsertionPoint } from '$lib/state/tune-practice-plan';
import { getAllLicks } from '$lib/phrases/library-loader';
import { fractionToFloat } from '$lib/music/intervals';
import { expectedForWindow, tunePractice, resetTunePractice } from '$lib/state/tune-practice.svelte';

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

describe('expectedForWindow', () => {
	// A real curated lick with pitched notes — expectedForWindow resolves it via
	// getBaseLickFromId, so it must exist in the catalog.
	const lick = getAllLicks().find((l) => l.notes.some((n) => n.pitch !== null))!;

	beforeEach(() => resetTunePractice());

	it('returns the transposed lick unchanged when the insertion sits at the window start', () => {
		const out = expectedForWindow(ip([0, 1], suggestion(lick.id, [0, 1])));
		expect(out).not.toBeNull();
		// No shift: offsets match the source lick's.
		expect(out!.phrase.notes.map((n) => fractionToFloat(n.offset))).toEqual(
			lick.notes.map((n) => fractionToFloat(n.offset))
		);
	});

	it('shifts every note/harmony offset when the insertion starts mid-window', () => {
		// insertionOffset 1/4 into a window that starts at 0 → shift every offset +1/4.
		const out = expectedForWindow(ip([0, 1], suggestion(lick.id, [1, 4])));
		expect(out).not.toBeNull();
		out!.phrase.notes.forEach((n, i) => {
			expect(fractionToFloat(n.offset)).toBeCloseTo(fractionToFloat(lick.notes[i].offset) + 0.25, 6);
		});
	});

	it('returns null when the picked suggestion cannot be resolved', () => {
		expect(expectedForWindow(ip([0, 1], suggestion('no-such-lick-id', [0, 1])))).toBeNull();
	});
});

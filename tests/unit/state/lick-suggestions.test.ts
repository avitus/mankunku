/**
 * Tests for `src/lib/state/lick-suggestions.svelte.ts`.
 *
 * The state module wraps a debounced fetch to /api/lick-match with two
 * race-prone guards:
 *   1. abort() the previous controller before starting a new request
 *   2. ignore the response if a newer request superseded the in-flight one
 *
 * Both guards are easy to break in a refactor and have no test today. The
 * MIN_PITCHED_NOTES gate (≥ 6 sounded notes before fetching) is the third
 * non-obvious behavior and is also untested.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	suggestions,
	requestMatches,
	clearSuggestions,
	markPickedFromSuggestion,
	clearPickedFromSuggestion
} from '$lib/state/lick-suggestions.svelte';
import type { Phrase, Note, Fraction } from '$lib/types/music';

function note(pitch: number | null, offset: Fraction): Note {
	return { pitch, offset, duration: [1, 4] };
}

function phrase(notes: Note[]): Phrase {
	return {
		id: 'test',
		name: 'test',
		timeSignature: [4, 4],
		key: 'C',
		notes,
		harmony: [],
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'user',
		tags: [],
		source: 'test'
	};
}

function sixNotes(): Phrase {
	// Six pitched notes → encoder produces 5 intervals which equals
	// `MIN_PITCHED_NOTES - 1 = 5`, the minimum to trigger fetch.
	return phrase([
		note(60, [0, 1]),
		note(62, [1, 4]),
		note(64, [1, 2]),
		note(65, [3, 4]),
		note(67, [1, 1]),
		note(69, [5, 4])
	]);
}

beforeEach(() => {
	vi.useFakeTimers();
	clearSuggestions();
});

afterEach(() => {
	clearSuggestions();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('requestMatches — synchronous fallback name + clears prior matches', () => {
	it('updates fallbackName synchronously before any fetch happens', async () => {
		const fetchMock = vi.fn(() => new Promise<Response>(() => {})); // never resolves
		vi.stubGlobal('fetch', fetchMock);
		try {
			requestMatches(sixNotes());
			// No timer advance, no microtask flush — the fallback must already
			// be populated from the synchronous path.
			expect(suggestions.fallbackName.length).toBeGreaterThan(0);
			expect(suggestions.matches).toEqual([]);
			expect(suggestions.loading).toBe(true);
			// Fetch is debounced 600ms — has not been called yet.
			expect(fetchMock).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('clears stale matches from the previous phrase synchronously', async () => {
		// Pre-seed matches so we can prove they get cleared.
		suggestions.matches = [
			{
				kind: 'quote',
				sourceId: 'old',
				label: 'old',
				attribution: 'old',
				license: 'curated',
				confidence: 'quote',
				score: 1
			}
		];
		const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
		vi.stubGlobal('fetch', fetchMock);
		try {
			requestMatches(sixNotes());
			expect(suggestions.matches).toEqual([]);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe('requestMatches — MIN_PITCHED_NOTES gate', () => {
	it('skips the fetch and clears `loading` when the phrase is too short', async () => {
		// Three pitched notes → 2 intervals < 5 = MIN_PITCHED_NOTES - 1.
		const tooShort = phrase([note(60, [0, 1]), note(62, [1, 4]), note(64, [1, 2])]);
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		try {
			requestMatches(tooShort);
			// Even after the debounce window elapses, fetch must not have run.
			vi.advanceTimersByTime(2000);
			await Promise.resolve();
			expect(fetchMock).not.toHaveBeenCalled();
			expect(suggestions.loading).toBe(false);
			// Fallback name is still populated (synchronous path runs first).
			expect(suggestions.fallbackName.length).toBeGreaterThan(0);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe('requestMatches — debounce + abort race guards', () => {
	it('does not fetch within the debounce window', async () => {
		const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
		vi.stubGlobal('fetch', fetchMock);
		try {
			requestMatches(sixNotes());
			vi.advanceTimersByTime(500); // < 600ms debounce
			expect(fetchMock).not.toHaveBeenCalled();
			vi.advanceTimersByTime(150); // crosses 600ms total
			expect(fetchMock).toHaveBeenCalledTimes(1);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('rapid successive calls debounce to a single fetch', async () => {
		const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
		vi.stubGlobal('fetch', fetchMock);
		try {
			requestMatches(sixNotes());
			vi.advanceTimersByTime(100);
			requestMatches(sixNotes());
			vi.advanceTimersByTime(100);
			requestMatches(sixNotes());
			vi.advanceTimersByTime(700);
			// Three back-to-back calls collapse into one POST.
			expect(fetchMock).toHaveBeenCalledTimes(1);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('aborts the prior in-flight controller when superseded mid-flight', async () => {
		// First request: resolves later. We capture the abort signal.
		const aborts: AbortSignal[] = [];
		const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
			if (init?.signal) aborts.push(init.signal);
			return new Promise<Response>(() => {}); // never settles
		});
		vi.stubGlobal('fetch', fetchMock);
		try {
			requestMatches(sixNotes());
			vi.advanceTimersByTime(700);
			// One fetch fired; first signal not yet aborted.
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(aborts[0].aborted).toBe(false);

			// Supersede with a new request — must abort the prior.
			requestMatches(sixNotes());
			vi.advanceTimersByTime(700);

			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(aborts[0].aborted).toBe(true);
			// New controller is fresh; not aborted.
			expect(aborts[1].aborted).toBe(false);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe('clearSuggestions', () => {
	it('aborts any in-flight controller and resets all fields', async () => {
		let capturedSignal: AbortSignal | undefined;
		const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
			capturedSignal = init?.signal ?? undefined;
			return new Promise<Response>(() => {});
		});
		vi.stubGlobal('fetch', fetchMock);
		try {
			requestMatches(sixNotes());
			vi.advanceTimersByTime(700);
			expect(capturedSignal?.aborted).toBe(false);

			suggestions.pickedFromSuggestion = 'something';
			clearSuggestions();

			expect(capturedSignal?.aborted).toBe(true);
			expect(suggestions.fallbackName).toBe('');
			expect(suggestions.matches).toEqual([]);
			expect(suggestions.loading).toBe(false);
			expect(suggestions.pickedFromSuggestion).toBeNull();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('cancels the pending debounce timer (no fetch ever fires)', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		try {
			requestMatches(sixNotes());
			vi.advanceTimersByTime(100);
			clearSuggestions();
			vi.advanceTimersByTime(2000);
			expect(fetchMock).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe('pickedFromSuggestion helpers', () => {
	it('mark/clear roundtrip', () => {
		expect(suggestions.pickedFromSuggestion).toBeNull();
		markPickedFromSuggestion('Coltrane changes');
		expect(suggestions.pickedFromSuggestion).toBe('Coltrane changes');
		clearPickedFromSuggestion();
		expect(suggestions.pickedFromSuggestion).toBeNull();
	});
});

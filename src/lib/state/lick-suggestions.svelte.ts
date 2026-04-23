/**
 * Lick-suggestion state for the /entry page.
 *
 * Holds the most recent descriptive fallback name and the server-returned
 * attribution candidates (if any). The fallback is computed locally and is
 * always populated; the matches arrive asynchronously and may be empty.
 */
import type { Phrase } from '$lib/types/music';
import { encodePhrase } from '$lib/matching/encode';
import { fallbackName as computeFallback } from '$lib/matching/fallback-name';

export interface SuggestionMatch {
	kind: 'wjazzd' | 'quote';
	sourceId: string;
	label: string;
	attribution: string;
	license: 'CC-BY-NC-SA' | 'curated';
	confidence: 'quote' | 'reminiscent';
	score: number;
}

interface SuggestionsState {
	fallbackName: string;
	matches: SuggestionMatch[];
	loading: boolean;
	/** Name the user picked from a suggestion; cleared on reset. */
	pickedFromSuggestion: string | null;
}

export const suggestions = $state<SuggestionsState>({
	fallbackName: '',
	matches: [],
	loading: false,
	pickedFromSuggestion: null
});

const DEBOUNCE_MS = 600;
const MIN_PITCHED_NOTES = 6;

let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let inflight: AbortController | null = null;

export function requestMatches(phrase: Phrase): void {
	// Fallback is cheap and deterministic — update synchronously so the UI
	// always has a name to show as a placeholder.
	suggestions.fallbackName = computeFallback(phrase);

	const feature = encodePhrase(phrase);
	if (feature.intervals.length < MIN_PITCHED_NOTES - 1) {
		suggestions.matches = [];
		suggestions.loading = false;
		return;
	}

	if (debounceTimer) clearTimeout(debounceTimer);
	debounceTimer = setTimeout(() => void fetchMatches(feature.intervals, feature.iois), DEBOUNCE_MS);
}

async function fetchMatches(intervals: number[], iois: number[]): Promise<void> {
	if (inflight) inflight.abort();
	const controller = new AbortController();
	inflight = controller;
	suggestions.loading = true;

	try {
		const response = await fetch('/api/lick-match', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ intervals, iois }),
			signal: controller.signal
		});
		if (!response.ok) {
			suggestions.matches = [];
			return;
		}
		const data = (await response.json()) as { matches: SuggestionMatch[] };
		if (controller.signal.aborted) return;
		suggestions.matches = data.matches ?? [];
	} catch (err) {
		if ((err as { name?: string })?.name === 'AbortError') return;
		suggestions.matches = [];
	} finally {
		if (inflight === controller) {
			inflight = null;
			suggestions.loading = false;
		}
	}
}

export function clearSuggestions(): void {
	if (debounceTimer) clearTimeout(debounceTimer);
	debounceTimer = undefined;
	if (inflight) inflight.abort();
	inflight = null;
	suggestions.fallbackName = '';
	suggestions.matches = [];
	suggestions.loading = false;
	suggestions.pickedFromSuggestion = null;
}

export function markPickedFromSuggestion(label: string): void {
	suggestions.pickedFromSuggestion = label;
}

export function clearPickedFromSuggestion(): void {
	suggestions.pickedFromSuggestion = null;
}

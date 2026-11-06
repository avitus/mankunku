/** Optional attribution suggestions shared by the recorder and editor. Never assigns a name. */
import type { Phrase } from '$lib/types/music';
import { encodePhrase } from '$lib/matching/encode';

export interface SuggestionMatch {
	kind: 'wjazzd' | 'quote';
	sourceId: string;
	label: string;
	suggestedName?: string | null;
	attribution: string;
	license: 'CC-BY-NC-SA' | 'curated';
	confidence: 'quote' | 'reminiscent';
	score: number;
}

interface SuggestionsState {
	matches: SuggestionMatch[];
	loading: boolean;
	unavailable: boolean;
	/** Name the user picked from a suggestion; cleared on reset. */
	pickedFromSuggestion: string | null;
}

export const suggestions = $state<SuggestionsState>({
	matches: [],
	loading: false,
	unavailable: false,
	pickedFromSuggestion: null
});

const DEBOUNCE_MS = 600;
const MIN_PITCHED_NOTES = 6;

let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let inflight: AbortController | null = null;

/** Debounce a song lookup, cancelling stale work without choosing a name. */
export function requestMatches(phrase: Phrase): void {
	// Cancel any pending debounce or in-flight fetch from a prior phrase so
	// stale results can't resolve after a newer request has started.
	if (debounceTimer) {
		clearTimeout(debounceTimer);
		debounceTimer = undefined;
	}
	if (inflight) {
		inflight.abort();
		inflight = null;
	}
	// Clear any stale matches from the previous phrase so they can't be applied
	// to the edited phrase during the debounce/network gap.
	suggestions.matches = [];
	suggestions.loading = true;
	suggestions.unavailable = false;

	const feature = encodePhrase(phrase);
	if (feature.intervals.length < MIN_PITCHED_NOTES - 1) {
		suggestions.loading = false;
		return;
	}

	debounceTimer = setTimeout(() => {
		debounceTimer = undefined;
		void fetchMatches(feature.intervals, feature.iois);
	}, DEBOUNCE_MS);
}

/** Publish only the current request, exposing failures for the custom-name prompt. */
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
		if (controller.signal.aborted) return;
		if (!response.ok) {
			suggestions.unavailable = true;
			suggestions.matches = [];
			return;
		}
		const data = (await response.json()) as { matches: SuggestionMatch[] };
		if (controller.signal.aborted) return;
		suggestions.matches = (data.matches ?? []).filter((match) => match.kind === 'wjazzd' && match.suggestedName?.trim());
	} catch (err) {
		if (controller.signal.aborted || (err as { name?: string })?.name === 'AbortError') return;
		suggestions.unavailable = true;
		suggestions.matches = [];
	} finally {
		if (inflight === controller) {
			inflight = null;
			suggestions.loading = false;
		}
	}
}

/** Cancel outstanding work and clear page-local naming suggestions. */
export function clearSuggestions(): void {
	if (debounceTimer) clearTimeout(debounceTimer);
	debounceTimer = undefined;
	if (inflight) inflight.abort();
	inflight = null;
	suggestions.matches = [];
	suggestions.loading = false;
	suggestions.pickedFromSuggestion = null;
	suggestions.unavailable = false;
}

export function markPickedFromSuggestion(label: string): void {
	suggestions.pickedFromSuggestion = label;
}

export function clearPickedFromSuggestion(): void {
	suggestions.pickedFromSuggestion = null;
}

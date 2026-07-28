import type { DetectedNote } from '$lib/types/audio';
import type { LickFeature } from './index-format';
import type { FreestyleBook } from './book-index';
import { featureFromDetected } from './live-feature';
import { DEFAULT_NGRAM_SIZE, searchMatches, type MatchResult, type SearchOptions } from './search';

/**
 * Debounced live-lick recognition over a rolling segmented-note buffer.
 * Stateful by design (silence guard + per-lick cooldowns); create one per
 * freestyle session.
 */

export interface FreestyleMatch {
	lickId: string;
	name: string;
	score: number;
	/** Transport tick at which the match fired. */
	atTick: number;
}

/**
 * Celebration bar: the existing `/api/lick-match` "quote" confidence cutoff
 * (score >= 0.9 renders as a quote rather than "reminiscent of"). Reused, not
 * invented — freestyle applause means "that WAS the lick", not "close".
 */
const QUOTE_CONFIDENCE_SCORE = 0.9;

export function createFreestyleRecognizer(args: {
	book: FreestyleBook;
	tempo: number;
	barTicks: number;
	/** Injectable for tests; defaults to the real matcher. */
	search?: (query: LickFeature, index: FreestyleBook['index'], opts?: SearchOptions) => MatchResult[];
}): { scan(notes: readonly DetectedNote[], nowTick: number): FreestyleMatch | null } {
	const { book, tempo, barTicks } = args;
	const search = args.search ?? searchMatches;

	let lastNoteCount = -1;
	const cooldownUntil = new Map<string, number>();

	return {
		scan(notes: readonly DetectedNote[], nowTick: number): FreestyleMatch | null {
			// Silence guard: nothing new since the last scan → skip the search.
			if (notes.length === lastNoteCount) return null;
			lastNoteCount = notes.length;
			// The n-gram matcher needs DEFAULT_NGRAM_SIZE intervals (one more note).
			if (notes.length < DEFAULT_NGRAM_SIZE + 1) return null;

			const feature = featureFromDetected(notes, tempo);
			const results = search(feature, book.index, { topK: 3 });
			for (const result of results) {
				if (result.score < QUOTE_CONFIDENCE_SCORE) continue;
				if ((cooldownUntil.get(result.sourceId) ?? -Infinity) > nowTick) continue;
				// A fired lick stays quiet while it is still ringing: its own
				// notated length, floored at one bar.
				const durTicks = book.durationTicks.get(result.sourceId) ?? 0;
				cooldownUntil.set(result.sourceId, nowTick + Math.max(barTicks, durTicks));
				return {
					lickId: result.sourceId,
					name: book.names.get(result.sourceId) ?? result.sourceId,
					score: result.score,
					atTick: nowTick
				};
			}
			return null;
		}
	};
}

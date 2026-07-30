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

/**
 * Stricter fire bar for a minimum-length (single-n-gram) match, whose pitch side
 * carries no discrimination (all intervals forced to match). At the 60/40
 * weighting, 0.95 demands an essentially perfect rhythm too (0.6·1 + 0.4·r ≥ 0.95
 * ⟹ r ≥ 0.875 ⟹ all 5 IOIs within tolerance), so a short shared fragment played
 * loosely no longer celebrates while a deliberately, accurately played short lick
 * still does.
 */
const SHORT_MATCH_CONFIDENCE = 0.95;

/**
 * A content signature over the note stream, invariant to the sliding window's
 * per-scan time re-basing: pitch plus quantized inter-onset GAPS (differences,
 * so unaffected by a constant shift of the window's time origin). Two scans with
 * the same signature carry identical musical material and are safely skipped.
 */
function noteSignature(notes: readonly DetectedNote[]): string {
	let sig = String(notes.length);
	for (let i = 0; i < notes.length; i++) {
		const gap = i === 0 ? 0 : Math.round((notes[i].onsetTime - notes[i - 1].onsetTime) * 100);
		sig += `|${notes[i].midi}:${gap}`;
	}
	return sig;
}

export function createFreestyleRecognizer(args: {
	book: FreestyleBook;
	tempo: number;
	barTicks: number;
	/** Injectable for tests; defaults to the real matcher. */
	search?: (query: LickFeature, index: FreestyleBook['index'], opts?: SearchOptions) => MatchResult[];
}): { scan(notes: readonly DetectedNote[], nowTick: number): FreestyleMatch | null } {
	const { book, tempo, barTicks } = args;
	const search = args.search ?? searchMatches;

	let lastSignature = '';
	const cooldownUntil = new Map<string, number>();

	return {
		scan(notes: readonly DetectedNote[], nowTick: number): FreestyleMatch | null {
			// Content guard: skip only when the note stream is UNCHANGED since the
			// last scan. The feed is a sliding trailing window (see the route's
			// runFreestyleScan), so the note COUNT can repeat across scans while the
			// content rolls over — a length check would then skip real new material
			// and silently switch recognition off mid-solo. The signature keys on
			// pitch + onset gaps, both invariant to the window's per-scan time
			// re-basing; genuine silence leaves it unchanged so a played lick can't
			// re-fire once its cooldown lapses.
			const signature = noteSignature(notes);
			if (signature === lastSignature) return null;
			lastSignature = signature;
			// The n-gram matcher needs DEFAULT_NGRAM_SIZE intervals (one more note).
			if (notes.length < DEFAULT_NGRAM_SIZE + 1) return null;

			const feature = featureFromDetected(notes, tempo);
			// The query is a rolling window, so penalize by how much of the matched
			// LICK aligned (not of the buffer) — otherwise a fully played short lick
			// is dragged under the fire threshold once the buffer outgrows it.
			// Pitch/rhythm weighting is the 60/40 default.
			const results = search(feature, book.index, { topK: 3, lengthBasis: 'target' });
			for (const result of results) {
				// A minimum-length match spans exactly one n-gram, so its intervals
				// are all forced to match (`intervalRatio ≡ 1`) and the coverage
				// penalty is inert under target basis — the pitch side carries no
				// discrimination and firing would collapse to "rhythm alone". Short,
				// widely-shared fragments (chromatic runs, scale segments) then
				// celebrate too easily, so hold them to a stricter, near-perfect bar;
				// longer matches keep the standard quote confidence.
				const fireBar =
					result.matched <= DEFAULT_NGRAM_SIZE ? SHORT_MATCH_CONFIDENCE : QUOTE_CONFIDENCE_SCORE;
				if (result.score < fireBar) continue;
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

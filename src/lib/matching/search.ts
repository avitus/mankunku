/**
 * N-gram inverted-index melodic matching.
 *
 * Build phase: indexes interval 5-grams from every IndexPhrase.
 * Query phase: for each query 5-gram, finds hits in the index, groups them
 * by (phraseIndex, offset), and scores each alignment over the query span.
 */
import type { LickFeature, IndexPhrase, MatchIndex, SourceEntry } from './index-format';

export const DEFAULT_NGRAM_SIZE = 5;

export interface MatchResult {
	sourceId: string;
	source: SourceEntry;
	/** 1-based bar number within the source, when known */
	startBar?: number;
	/** 0..1 confidence score */
	score: number;
	/** Number of query intervals that aligned inside the phrase */
	matched: number;
	queryLength: number;
}

export interface SearchOptions {
	minScore?: number;
	topK?: number;
}

export function buildIndex(
	sources: SourceEntry[],
	phrases: IndexPhrase[],
	ngramSize: number = DEFAULT_NGRAM_SIZE
): MatchIndex {
	const ngramIndex: Record<string, Array<[number, number]>> = {};
	for (let pIdx = 0; pIdx < phrases.length; pIdx++) {
		const { intervals } = phrases[pIdx];
		for (let pos = 0; pos + ngramSize <= intervals.length; pos++) {
			const key = intervals.slice(pos, pos + ngramSize).join(',');
			(ngramIndex[key] ??= []).push([pIdx, pos]);
		}
	}
	return {
		sources,
		phrases,
		ngramIndex,
		ngramSize,
		builtAt: new Date().toISOString()
	};
}

export function searchMatches(
	query: LickFeature,
	index: MatchIndex,
	opts: SearchOptions = {}
): MatchResult[] {
	const minScore = opts.minScore ?? 0.75;
	const topK = opts.topK ?? 3;
	const n = index.ngramSize;
	const q = query.intervals;
	const qIois = query.iois;
	if (q.length < n) return [];

	const seenAlignments = new Set<string>();
	const alignments: Array<{ phraseIndex: number; offset: number }> = [];

	for (let qi = 0; qi <= q.length - n; qi++) {
		const key = q.slice(qi, qi + n).join(',');
		const hits = index.ngramIndex[key];
		if (!hits) continue;
		for (const [pIdx, pi] of hits) {
			const offset = pi - qi;
			const alignKey = `${pIdx}:${offset}`;
			if (seenAlignments.has(alignKey)) continue;
			seenAlignments.add(alignKey);
			alignments.push({ phraseIndex: pIdx, offset });
		}
	}

	const candidates: MatchResult[] = [];

	for (const { phraseIndex, offset } of alignments) {
		const phrase = index.phrases[phraseIndex];
		const aln = alignScore(q, qIois, phrase.intervals, phrase.iois, offset);
		if (aln.matched === 0) continue;

		const intervalRatio = aln.intervalHits / aln.matched;
		const rhythmRatio = aln.rhythmHits / aln.matched;
		const raw = 0.7 * intervalRatio + 0.3 * rhythmRatio;
		const lengthPenalty = Math.sqrt(aln.matched / q.length);
		const score = raw * lengthPenalty;

		if (score < minScore) continue;

		const source = index.sources.find((s) => s.id === phrase.sourceId);
		if (!source) continue;

		candidates.push({
			sourceId: phrase.sourceId,
			source,
			startBar: phrase.startBar,
			score,
			matched: aln.matched,
			queryLength: q.length
		});
	}

	// Keep best match per source, then sort by score descending.
	const bySource = new Map<string, MatchResult>();
	for (const r of candidates) {
		const cur = bySource.get(r.sourceId);
		if (!cur || r.score > cur.score) bySource.set(r.sourceId, r);
	}
	return [...bySource.values()].sort((a, b) => b.score - a.score).slice(0, topK);
}

interface AlignmentStats {
	matched: number;
	intervalHits: number;
	rhythmHits: number;
}

function alignScore(
	qIntervals: number[],
	qIois: number[],
	pIntervals: number[],
	pIois: number[],
	offset: number
): AlignmentStats {
	const startQ = Math.max(0, -offset);
	const startP = Math.max(0, offset);
	const endQ = Math.min(qIntervals.length, pIntervals.length - offset);
	const matched = endQ - startQ;
	if (matched <= 0) return { matched: 0, intervalHits: 0, rhythmHits: 0 };

	let intervalHits = 0;
	let rhythmHits = 0;
	for (let k = 0; k < matched; k++) {
		if (qIntervals[startQ + k] === pIntervals[startP + k]) intervalHits++;
		if (Math.abs(qIois[startQ + k] - pIois[startP + k]) <= 1) rhythmHits++;
	}
	return { matched, intervalHits, rhythmHits };
}

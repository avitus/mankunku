/**
 * POST /api/lick-match — melodic attribution search.
 *
 * Client encodes a phrase into a transposition-invariant feature vector
 * (intervals + IOIs) and POSTs the two arrays. The server searches an
 * in-memory index built from the Weimar Jazz Database (CC-BY-NC-SA) and a
 * curated quote library, returning ranked attribution candidates. The
 * client is responsible for the descriptive fallback name; this endpoint
 * only does matching.
 */
import type { RequestHandler } from './$types';
import quotesData from '$lib/matching/data/quotes.json';
import wjazzdData from '$lib/matching/data/wjazzd-index.json';
import type { IndexPhrase, SourceEntry, MatchIndex } from '$lib/matching/index-format';
import { buildIndex, searchMatches, DEFAULT_NGRAM_SIZE } from '$lib/matching/search';

interface IndexBundle {
	sources: SourceEntry[];
	phrases: IndexPhrase[];
}

function assembleIndex(): MatchIndex {
	const quotes = quotesData as unknown as IndexBundle;
	const wjazzd = wjazzdData as unknown as IndexBundle;
	const sources = [...quotes.sources, ...wjazzd.sources];
	const phrases = [...quotes.phrases, ...wjazzd.phrases];
	return buildIndex(sources, phrases, DEFAULT_NGRAM_SIZE);
}

// Loaded once at module init. SvelteKit keeps it warm across requests.
const MATCH_INDEX = assembleIndex();

const MAX_SEQUENCE_LENGTH = 512;

interface RequestBody {
	intervals: number[];
	iois: number[];
	minScore?: number;
	topK?: number;
}

interface MatchResponse {
	kind: 'wjazzd' | 'quote';
	sourceId: string;
	label: string;
	attribution: string;
	license: 'CC-BY-NC-SA' | 'curated';
	confidence: 'quote' | 'reminiscent';
	score: number;
	matched: number;
	queryLength: number;
}

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, 400);
	}

	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		return json({ error: 'Expected JSON object body' }, 400);
	}

	const { intervals, iois, minScore, topK } = body as Partial<RequestBody>;

	if (!isValidSequence(intervals) || !isValidSequence(iois)) {
		return json({ error: 'intervals and iois must be integer arrays' }, 400);
	}
	if (intervals.length !== iois.length) {
		return json({ error: 'intervals and iois must have equal length' }, 400);
	}
	if (intervals.length > MAX_SEQUENCE_LENGTH) {
		return json({ error: `sequence too long (max ${MAX_SEQUENCE_LENGTH})` }, 400);
	}

	// Validate and sanitize minScore and topK
	let validatedMinScore: number | undefined;
	let validatedTopK: number | undefined;

	if (minScore !== undefined) {
		if (typeof minScore !== 'number' || !Number.isFinite(minScore)) {
			return json({ error: 'minScore must be a finite number' }, 400);
		}
		if (minScore < 0 || minScore > 1) {
			return json({ error: 'minScore must be between 0 and 1' }, 400);
		}
		validatedMinScore = minScore;
	}

	if (topK !== undefined) {
		if (typeof topK !== 'number' || !Number.isFinite(topK) || !Number.isInteger(topK)) {
			return json({ error: 'topK must be a finite integer' }, 400);
		}
		if (topK < 1) {
			return json({ error: 'topK must be a positive integer' }, 400);
		}
		if (topK > 100) {
			return json({ error: 'topK must not exceed 100' }, 400);
		}
		validatedTopK = topK;
	}

	const results = searchMatches(
		{
			intervals,
			iois,
			noteCount: intervals.length + 1,
			totalBeats: 0,
			keyPc: 0
		},
		MATCH_INDEX,
		{ minScore: validatedMinScore, topK: validatedTopK }
	);

	const matches: MatchResponse[] = results.map((r) => ({
		kind: r.source.kind === 'wjazzd' ? 'wjazzd' : 'quote',
		sourceId: r.sourceId,
		label: formatLabel(r.source, r.startBar),
		attribution: formatAttribution(r.source),
		license: r.source.kind === 'wjazzd' ? 'CC-BY-NC-SA' : 'curated',
		confidence: r.score >= 0.9 ? 'quote' : 'reminiscent',
		score: r.score,
		matched: r.matched,
		queryLength: r.queryLength
	}));

	return json({ matches }, 200);
};

function isValidSequence(seq: unknown): seq is number[] {
	return Array.isArray(seq) && seq.every((x) => typeof x === 'number' && Number.isFinite(x) && Number.isInteger(x));
}

function formatLabel(source: SourceEntry, startBar: number | undefined): string {
	if (source.kind === 'wjazzd') {
		const bar = startBar ? `, bar ${startBar}` : '';
		return `${source.performer} — ${source.title}${bar}`;
	}
	return source.title;
}

function formatAttribution(source: SourceEntry): string {
	if (source.kind === 'wjazzd') {
		const year = source.year ? `, ${source.year}` : '';
		return `Weimar Jazz Database: ${source.performer} — ${source.title}${year}`;
	}
	return source.note ?? 'Curated quote';
}

function json(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

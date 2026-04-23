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
import type { IndexPhrase, SourceEntry } from '$lib/matching/index-format';
import { buildIndex, searchMatches, DEFAULT_NGRAM_SIZE } from '$lib/matching/search';

interface IndexBundle {
	sources: SourceEntry[];
	phrases: IndexPhrase[];
}

function assembleIndex() {
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
	let body: RequestBody;
	try {
		body = (await request.json()) as RequestBody;
	} catch {
		return json({ error: 'Invalid JSON' }, 400);
	}

	if (!isValidSequence(body.intervals) || !isValidSequence(body.iois)) {
		return json({ error: 'intervals and iois must be integer arrays' }, 400);
	}
	if (body.intervals.length !== body.iois.length) {
		return json({ error: 'intervals and iois must have equal length' }, 400);
	}
	if (body.intervals.length > MAX_SEQUENCE_LENGTH) {
		return json({ error: `sequence too long (max ${MAX_SEQUENCE_LENGTH})` }, 400);
	}

	const results = searchMatches(
		{
			intervals: body.intervals,
			iois: body.iois,
			noteCount: body.intervals.length + 1,
			totalBeats: 0,
			keyPc: 0
		},
		MATCH_INDEX,
		{ minScore: body.minScore, topK: body.topK }
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
	return Array.isArray(seq) && seq.every((x) => typeof x === 'number' && Number.isFinite(x));
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

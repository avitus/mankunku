import { error, json } from '@sveltejs/kit';
// Wide RequestHandler (chat-route precedent) so guard tests can hand-roll
// event objects without the route-narrowed generic fighting them.
import type { RequestHandler } from '@sveltejs/kit';
import {
	getAnthropicClient,
	isAnthropicConfigured,
	ANTHROPIC_MODEL,
	ANTHROPIC_LEAD_SHEET_MAX_TOKENS
} from '$lib/server/anthropic';
import { claudeJsonToLeadSheet, extractionConsistencyScore } from '$lib/leadsheets/import/claude-pdf';

/**
 * POST /api/lead-sheet-parse — extract a lead sheet (chords + melody) from an
 * uploaded PDF via Claude's document understanding.
 *
 * Gate order mirrors /api/chat (config → auth+rate-limit → size guards →
 * validation), with the monitoring route's manual byte-counting reader as
 * the REAL size gate — a PDF body can't trust the declared content-length.
 * The extraction result is strictly validated server-side
 * (claudeJsonToLeadSheet) and returned as a DRAFT for mandatory human
 * review in the editor; this endpoint never writes to storage.
 */

interface ParseRequestBody {
	/** Base64-encoded PDF (optionally a data: URL). */
	pdf: string;
	filename?: string;
}

// In-memory rate limit (chat-route pattern; safe because PM2 runs a single
// fork instance). Tighter than chat's 10/min: every call here ships a whole
// PDF through Claude, so the cost per request is an order of magnitude higher.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;
const rateLimitBuckets = new Map<string, number[]>();

function rateLimitKey(userId: string | null, getClientAddress: () => string): string {
	if (userId) return `u:${userId}`;
	try {
		return `ip:${getClientAddress()}`;
	} catch {
		return 'ip:unknown';
	}
}

function isRateLimited(key: string): boolean {
	const now = Date.now();
	const bucket = rateLimitBuckets.get(key) ?? [];
	const recent = bucket.filter((ts) => ts > now - RATE_LIMIT_WINDOW_MS);
	if (recent.length >= RATE_LIMIT_MAX) {
		rateLimitBuckets.set(key, recent);
		return true;
	}
	recent.push(now);
	rateLimitBuckets.set(key, recent);
	return false;
}

/**
 * Hard cap on the request body. A 10 MB PDF becomes ~13.4 MB of base64 plus
 * JSON overhead; anything larger than this is not a lead sheet. Requires
 * BODY_SIZE_LIMIT ≥ 16M at the adapter layer (ecosystem.config.cjs) — this
 * constant is the real gate.
 */
const MAX_PDF_REQUEST_BYTES = 15_000_000;

/**
 * Stream the request body with a running byte count (monitoring-route
 * pattern) — true enforcement, independent of the declared content-length.
 * Throws SvelteKit errors; never returns partial data.
 */
async function readBodyBounded(request: Request): Promise<string> {
	const body = request.body;
	if (!body) return '';
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			total += value.byteLength;
			if (total > MAX_PDF_REQUEST_BYTES) {
				await reader.cancel();
				throw error(413, 'PDF too large — keep uploads under 10 MB.');
			}
			chunks.push(value);
		}
	} catch (err) {
		// adapter-node errors the stream with a SvelteKitError(413) when the
		// declared Content-Length exceeds BODY_SIZE_LIMIT, before any bytes
		// arrive — surface that as 413 rather than a malformed payload.
		const status = (err as { status?: unknown })?.status;
		if (status === 413) throw err;
		throw error(400, 'Malformed request body.');
	}
	const buffer = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		buffer.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(buffer);
}

/** Generate a lead-sheet id (same scheme as user-lead-sheets.ts). */
function generateSheetId(): string {
	const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
	let rand = '';
	for (let i = 0; i < 4; i++) {
		rand += chars[Math.floor(Math.random() * chars.length)];
	}
	return `sheet-${Date.now()}-${rand}`;
}

const SYSTEM_PROMPT = `You are a music COPYIST. Transcribe exactly what is PRINTED on the attached PDF chart.
You may recognize the tune — that knowledge is a trap. Published charts appear in many keys and
layouts; the ONLY authority is the ink on this page. Never "correct" anything toward the version
you know.

Work SYSTEM BY SYSTEM (one printed line of music), BAR BY BAR. Return ONLY a JSON object — no
prose, no markdown fences — with this exact shape:
{
  "title": string,
  "composer": string | null,
  "style": string | null,
  "keySignature": { "fifths": number }, // COUNT the sharps/flats printed on the staff: 2 sharps → 2, 3 flats → -3, none → 0
  "timeSignature": [number, number],    // as printed, e.g. [4, 4] or [3, 4]
  "systemsOverview": [number, ...],     // FIRST: scan the whole chart and list the bar count of EVERY system, top to bottom
  "systems": [
    { "firstBarNumber": number | null,  // the small bar number printed at the system's left edge, if any
      "bars": [
        {
          "mark": string | null,     // rehearsal mark printed AT this bar ("A", "B", "Intro"), else null
          "startRepeat": boolean,    // |: printed at the START of this bar
          "endRepeat": boolean,      // :| printed at the END of this bar
          "ending": 1 | 2 | null,    // this bar lies UNDER a printed 1st/2nd volta bracket
          "pickup": boolean,         // this is a partial pickup bar before the form
          "chords": [ [beat, "symbol"], ... ],
          "melody": [ [beat, durationBeats, "pitch"], ... ]   // append true as a 4th element when the note TIES into the next one
        }
      ]
    }
  ]
}
Transcription rules — fidelity to the page beats everything:
- SURVEY FIRST: fill systemsOverview by counting every system's bars across the whole page(s)
  before transcribing anything. The systems array must then contain exactly one entry per
  overview item, with exactly that many bars — re-check as you go.
- ONE ENTRY PER PRINTED BAR, in reading order; every printed bar appears exactly once. After
  transcribing each system, RE-COUNT its barlines and check you produced that many entries —
  dense systems can hold 6-8 bars. If the system prints a small bar number at its left edge,
  report it as firstBarNumber; it must equal 1 + the number of full bars before this system.
  Do NOT write out repeats — the music between |: and :| is transcribed once, with the flags
  set on its first/last bars.
- beat is 0-based WITHIN THE BAR, in units of the time signature's denominator, and may be
  fractional (0.5 = an eighth-note offset). durationBeats uses the same unit.
- PITCH: scientific notation of the PRINTED note (middle C = C4), respecting the printed key
  signature and accidentals. NEVER transpose, NEVER shift octaves, NEVER convert to concert
  pitch — even if the chart names a transposing instrument (the app handles transposition).
- RHYTHM: the notes and rests of a bar fill it exactly — beats + durations must be consistent
  with the time signature. A note tied across the barline is reported in BOTH bars, the first
  part with the tie flag.
- KEY: count the accidentals in the printed key signature. Do not name the key you believe the
  tune is in.
- PICKUP: ANY notes printed before the first full bar — even a single note ahead of the first
  section letter — form a pickup bar: report it as the very first bar with pickup: true and
  the notes at their real beats near the END of the bar (a one-beat pickup in 4/4 starts at
  beat 3). Pickup bars are excluded from printed bar numbering.
- IGNORE decoration: lyrics, colored highlighting, analysis text, fingerings, and editorial
  commentary are not musical content. Extract the melody even where bars are highlighted.
- CHORDS: symbols exactly as printed ("Dm7", "G7b9", "Cmaj7/E"), at their printed beats.
  Strip editorial parentheses; a parenthesized pair like "(Em7 A7)" is TWO chords at their own
  beats.
- If a passage is truly illegible, omit its notes rather than inventing them — but highlighted
  or small print is still legible.`;

export const POST: RequestHandler = async ({ request, getClientAddress, locals }) => {
	if (!isAnthropicConfigured()) {
		throw error(503, 'PDF import is not configured. Set ANTHROPIC_API_KEY in the environment.');
	}

	const { user } = await locals.safeGetSession();
	if (isRateLimited(rateLimitKey(user?.id ?? null, getClientAddress))) {
		throw error(429, 'Too many PDF imports. Take a breath, then try again in a minute.');
	}

	// Cheap early exit on the declared size; the reader below is the real gate.
	const declaredLength = Number(request.headers.get('content-length') ?? '');
	if (Number.isFinite(declaredLength) && declaredLength > MAX_PDF_REQUEST_BYTES) {
		throw error(413, 'PDF too large — keep uploads under 10 MB.');
	}

	const raw = await readBodyBounded(request);
	let body: unknown;
	try {
		body = JSON.parse(raw);
	} catch {
		throw error(400, 'Invalid JSON body.');
	}
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		throw error(400, 'Expected a JSON object body.');
	}
	const { pdf } = body as Partial<ParseRequestBody>;
	if (typeof pdf !== 'string' || pdf.length === 0) {
		throw error(400, '`pdf` (base64 string) is required.');
	}
	const data = pdf.replace(/^data:application\/pdf;base64,/, '').replace(/\s/g, '');
	if (data.length === 0 || !/^[A-Za-z0-9+/]+=*$/.test(data)) {
		throw error(400, '`pdf` must be base64-encoded PDF data.');
	}

	const client = getAnthropicClient();
	if (!client) {
		throw error(503, 'PDF import is not configured.');
	}

	type Attempt =
		| { ok: true; sheet: NonNullable<ReturnType<typeof claudeJsonToLeadSheet>['sheet']>; warnings: string[]; score: number }
		| { ok: false; convErrors: string[] | null };

	const runExtraction = async (): Promise<Attempt> => {
		let responseText: string;
		try {
			// Streamed: the SDK refuses non-streaming requests big enough to run
			// long (bar-wise transcription needs the 16k output ceiling).
			const response = await client.messages.stream({
				model: ANTHROPIC_MODEL,
				max_tokens: ANTHROPIC_LEAD_SHEET_MAX_TOKENS,
				system: SYSTEM_PROMPT,
				messages: [
					{
						role: 'user',
						content: [
							{
								type: 'document',
								source: { type: 'base64', media_type: 'application/pdf', data }
							},
							{
								type: 'text',
								text: 'Extract this lead sheet as JSON per the schema. Return ONLY the JSON object.'
							}
						]
					}
				]
			}).finalMessage();
			responseText = response.content
				.filter((block) => block.type === 'text')
				.map((block) => (block as { text: string }).text)
				.join('');
		} catch (err) {
			console.error('[lead-sheet-parse] extraction failed:', err);
			return { ok: false, convErrors: null };
		}

		// Models sometimes wrap JSON in fences despite instructions — strip them.
		const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(responseText.trim());
		const jsonText = fenced ? fenced[1] : responseText.trim();

		let extracted: unknown;
		try {
			extracted = JSON.parse(jsonText);
		} catch {
			console.warn('[lead-sheet-parse] model returned non-JSON output');
			return { ok: false, convErrors: null };
		}

		const { sheet, errors, warnings } = claudeJsonToLeadSheet(extracted);
		if (!sheet) {
			console.warn('[lead-sheet-parse] conversion rejected:', errors.join('; '));
			return { ok: false, convErrors: errors };
		}
		return { ok: true, sheet, warnings, score: extractionConsistencyScore(warnings) };
	};

	// Extraction has no temperature control on this model, and a bad sample
	// loses bars. A structurally shaky attempt gets ONE retry; keep the
	// steadier of the two.
	let result = await runExtraction();
	if (!result.ok || result.score >= 2) {
		const second = await runExtraction();
		if (second.ok && (!result.ok || second.score < result.score)) result = second;
	}

	if (!result.ok) {
		if (result.convErrors) {
			throw error(422, `The chart could not be read as a lead sheet: ${result.convErrors.join('; ')}`);
		}
		throw error(502, 'The PDF could not be processed. Try again, or enter the chart manually.');
	}
	result.sheet.id = generateSheetId();

	return json({ sheet: result.sheet, warnings: result.warnings });
};

/** Config probe so the upload page can render a not-configured state. */
export const GET: RequestHandler = async () => {
	return json({
		configured: isAnthropicConfigured(),
		model: isAnthropicConfigured() ? ANTHROPIC_MODEL : null
	});
};

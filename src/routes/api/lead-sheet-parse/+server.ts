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
import { claudeJsonToLeadSheet } from '$lib/leadsheets/import/claude-pdf';

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

const SYSTEM_PROMPT = `You are a music engraving assistant that extracts lead sheets from PDF charts.
Read the attached PDF and return ONLY a JSON object — no prose, no markdown fences — with this exact shape:
{
  "title": string,
  "composer": string | null,
  "style": string | null,
  "key": string,                     // concert key of the chart, e.g. "Bb", "F#", "Eb"
  "timeSignature": [number, number], // e.g. [4, 4] or [3, 4]
  "sections": [
    {
      "label": string,               // "A", "B", "Intro", ...
      "bars": number,                // bar count of the section
      "repeatStart": boolean,        // section opens with a |: repeat
      "repeatEnd": boolean,          // section closes with a :| repeat
      "ending": 1 | 2 | null,        // numbered volta ending, if any
      "chords": [ { "bar": number, "beat": number, "symbol": string } ],
      "melody": [ { "bar": number, "beat": number, "durationBeats": number, "pitch": string | null } ]
    }
  ]
}
Conventions:
- bar and beat are 0-based and SECTION-relative; beat is in units of the time signature's denominator (a quarter note in 4/4) and may be fractional (0.5 = an eighth-note offset).
- pitch is scientific pitch notation at CONCERT pitch, e.g. "Bb4", "F#5"; use null for rests (or omit them).
- chord symbols exactly as printed, e.g. "Dm7", "G7b9", "Cmaj7/E", "N.C.".
- Split the form into sections at rehearsal letters, double barlines, and repeat structures.
- If the chart is for a transposing instrument and says so, convert to concert pitch; otherwise assume it is already concert.
- If melody is unreadable, return an empty melody array rather than guessing.`;

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

	let responseText: string;
	try {
		const response = await client.messages.create({
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
		});
		responseText = response.content
			.filter((block) => block.type === 'text')
			.map((block) => (block as { text: string }).text)
			.join('');
	} catch (err) {
		console.error('[lead-sheet-parse] extraction failed:', err);
		throw error(502, 'The PDF could not be processed. Try again, or enter the chart manually.');
	}

	// Models sometimes wrap JSON in fences despite instructions — strip them.
	const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(responseText.trim());
	const jsonText = fenced ? fenced[1] : responseText.trim();

	let extracted: unknown;
	try {
		extracted = JSON.parse(jsonText);
	} catch {
		console.warn('[lead-sheet-parse] model returned non-JSON output');
		throw error(502, 'The extraction did not produce readable data. Try again, or enter the chart manually.');
	}

	const { sheet, errors, warnings } = claudeJsonToLeadSheet(extracted);
	if (!sheet) {
		throw error(422, `The chart could not be read as a lead sheet: ${errors.join('; ')}`);
	}
	sheet.id = generateSheetId();

	return json({ sheet, warnings });
};

/** Config probe so the upload page can render a not-configured state. */
export const GET: RequestHandler = async () => {
	return json({
		configured: isAnthropicConfigured(),
		model: isAnthropicConfigured() ? ANTHROPIC_MODEL : null
	});
};

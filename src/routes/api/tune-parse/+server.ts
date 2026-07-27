import { error, json } from '@sveltejs/kit';
// Wide RequestHandler (chat-route precedent) so guard tests can hand-roll
// event objects without the route-narrowed generic fighting them.
import type { RequestHandler } from '@sveltejs/kit';
import {
	getAnthropicClient,
	isAnthropicConfigured,
	ANTHROPIC_MODEL,
	ANTHROPIC_TUNE_MODEL,
	ANTHROPIC_TUNE_MAX_TOKENS
} from '$lib/server/anthropic';
import { claudeJsonToTune, extractionConsistencyScore } from '$lib/tunes/import/claude-pdf';
import { barTilingIssues, isRestPitch } from '$lib/tunes/import/system-bar-validation';

/**
 * POST /api/tune-parse — extract a lead sheet (chords + melody) from an
 * uploaded PDF via Claude's document understanding.
 *
 * Gate order mirrors /api/chat (config → auth+rate-limit → size guards →
 * validation), with the monitoring route's manual byte-counting reader as
 * the REAL size gate — a PDF body can't trust the declared content-length.
 * The extraction result is strictly validated server-side
 * (claudeJsonToTune) and returned as a DRAFT for mandatory human
 * review in the editor; this endpoint never writes to storage.
 */

interface ParseRequestBody {
	/** Base64-encoded PDF (optionally a data: URL). */
	pdf: string;
	filename?: string;
}

/**
 * Per-system mode: the client has already determined the structure
 * deterministically (staff geometry → bar count, text layer → chords), and
 * sends ONE system's image for melody transcription into that fixed
 * skeleton. Much cheaper than a whole-PDF call, and the known bar count
 * removes the model's main failure mode (miscounting).
 */
interface SystemRequestBody {
	system: {
		/** Base64-encoded PNG crop of one system (optionally a data: URL). */
		image: string;
		/** Barlines counted by the client's geometry pass. */
		barCount: number;
		timeSignature: [number, number];
		/** True for the chart's first system — prompts a pickup-bar check. */
		first?: boolean;
		/**
		 * Per-bar notehead evidence from the client's geometry pass: counts
		 * and treble letter names (no accidentals). Used as a SOFT
		 * cross-check — the model is asked to re-read disagreeing bars but
		 * may keep its answer.
		 */
		barEvidence?: Array<{ count: number; letters: string[] } | null>;
	};
}

// In-memory rate limit (chat-route pattern; safe because PM2 runs a single
// fork instance). Tighter than chat's 10/min: every whole-PDF call ships a
// full document through Claude. Per-system calls carry one small image
// (~1/20 the tokens), and one chart legitimately fans out 10+ of them, so
// they get their own, larger allowance.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;
const SYSTEM_RATE_LIMIT_MAX = 60;
const rateLimitBuckets = new Map<string, number[]>();

function rateLimitKey(userId: string | null, getClientAddress: () => string): string {
	if (userId) return `u:${userId}`;
	try {
		return `ip:${getClientAddress()}`;
	} catch {
		return 'ip:unknown';
	}
}

/** Prune a bucket to the window and return its live array (non-consuming). */
function recentInWindow(key: string): number[] {
	const now = Date.now();
	const recent = (rateLimitBuckets.get(key) ?? []).filter((ts) => ts > now - RATE_LIMIT_WINDOW_MS);
	rateLimitBuckets.set(key, recent);
	return recent;
}

function isRateLimited(key: string, max = RATE_LIMIT_MAX): boolean {
	const recent = recentInWindow(key);
	if (recent.length >= max) return true;
	recent.push(Date.now());
	return false;
}

/**
 * Pre-read admission (CWE-770): consume a `:pre` ticket BEFORE the body is
 * buffered; the caller refunds it once the request reaches mode
 * classification. The `:pre` bucket therefore only ever accumulates requests
 * that never reached a mode limiter (malformed floods), while admission also
 * weighs both mode buckets non-consumingly — so a request the mode limiters
 * would admit is never refused here, and mode-rejected requests starve
 * nothing. Returns the ticket timestamp, or null when over budget.
 */
function takePreReadTicket(limitKey: string): number | null {
	const pre = recentInWindow(`${limitKey}:pre`);
	const used =
		pre.length + recentInWindow(limitKey).length + recentInWindow(`${limitKey}:sys`).length;
	if (used >= RATE_LIMIT_MAX + SYSTEM_RATE_LIMIT_MAX) return null;
	const ts = Date.now();
	pre.push(ts);
	return ts;
}

function refundPreReadTicket(limitKey: string, ts: number): void {
	const bucket = rateLimitBuckets.get(`${limitKey}:pre`);
	const i = bucket?.lastIndexOf(ts) ?? -1;
	if (bucket && i >= 0) bucket.splice(i, 1);
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

/** Generate a lead-sheet id (same scheme as user-tunes.ts). */
function generateSheetId(): string {
	const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
	let rand = '';
	for (let i = 0; i < 4; i++) {
		rand += chars[Math.floor(Math.random() * chars.length)];
	}
	return `sheet-${Date.now()}-${rand}`;
}

/**
 * Fable's thinking controls (the API rejects budget_tokens for this model:
 * adaptive thinking + output effort is the supported shape). Typed loosely
 * because the installed SDK predates output_config.
 */
const FABLE_THINKING = {
	thinking: { type: 'adaptive' },
	output_config: { effort: 'high' }
} as unknown as Record<string, never>;

const SYSTEM_MODE_PROMPT = `You are a music COPYIST. The attached image is ONE SYSTEM (one printed line)
of a lead sheet. The bar count is known and given — your only job is to transcribe what is printed
inside each bar. You may recognize the tune; that knowledge is a trap — the ONLY authority is the ink.
Return ONLY a JSON object — no prose, no markdown fences — with this exact shape:
{
  "keySignature": { "fifths": number }, // COUNT the sharps/flats printed at the clef: 2 sharps → 2, 3 flats → -3, none → 0
  "timeSignature": [number, number] | null, // the printed meter, when this system shows one at its start
  "bars": [
    {
      "startRepeat": boolean,   // |: printed at the START of this bar (winged or plain)
      "endRepeat": boolean,     // :| printed at the END of this bar
      "ending": 1 | 2 | null,   // this bar lies UNDER a printed 1st/2nd volta bracket
      "pickup": boolean,        // partial pickup bar (fewer beats printed than the meter)
      "melody": [ [beat, durationBeats, "pitch"], ... ]  // notes AND rests in reading order; a rest uses pitch "rest"; append true as a 4th element when a note TIES into the next
    }
  ]
}
Rules:
- The bars array must contain EXACTLY the given number of entries, in reading order.
- beat is 0-based within the bar in units of the meter denominator; fractional allowed (0.5 = eighth offset).
- PITCH: scientific notation as PRINTED (middle C = C4), respecting key signature and accidentals.
  NEVER transpose or shift octaves — the app handles instrument transposition.
- RHYTHM: notes and rests fill each bar exactly; a note tied across a barline appears in BOTH bars,
  the first part carrying the tie flag.
- A pickup bar's notes sit at their real beats near the END of the bar (a one-beat pickup in 4/4
  starts at beat 3).
- IGNORE chord symbols, lyrics, colored highlighting, and text — melody notes and structural
  markings only.
- melody lists notes AND rests in reading order (pitch "rest" for rests). Each bar's notes and
  rests must tile the meter EXACTLY — this is mechanically checked. A pickup bar may omit its
  unprinted leading silence.
- If a passage is truly illegible, omit its notes rather than inventing them.`;

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
	const limitKey = rateLimitKey(user?.id ?? null, getClientAddress);

	// Cheap early exit on the declared size; the reader below is the real gate.
	const declaredLength = Number(request.headers.get('content-length') ?? '');
	if (Number.isFinite(declaredLength) && declaredLength > MAX_PDF_REQUEST_BYTES) {
		throw error(413, 'PDF too large — keep uploads under 10 MB.');
	}

	// PRE-READ admission (CWE-770): the mode (pdf vs system) is only known
	// after the body is parsed, so a ticket is consumed here — BEFORE up to
	// 15 MB of body is buffered — and refunded at classification below.
	// Malformed floods keep their tickets and get cut off; classified traffic
	// is accounted solely by the mode-specific limiters.
	const preTicket = takePreReadTicket(limitKey);
	if (preTicket === null) {
		throw error(429, 'Too many requests. Take a breath, then try again in a minute.');
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
	refundPreReadTicket(limitKey, preTicket);
	const { system } = body as Partial<SystemRequestBody>;
	if (system !== undefined) {
		if (isRateLimited(`${limitKey}:sys`, SYSTEM_RATE_LIMIT_MAX)) {
			throw error(429, 'Too many transcription calls. Try again in a minute.');
		}
		return await handleSystemMode(system);
	}

	if (isRateLimited(limitKey)) {
		throw error(429, 'Too many PDF imports. Take a breath, then try again in a minute.');
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
		| { ok: true; sheet: NonNullable<ReturnType<typeof claudeJsonToTune>['sheet']>; warnings: string[]; score: number }
		| { ok: false; convErrors: string[] | null };

	const runExtraction = async (model: string): Promise<Attempt> => {
		let responseText: string;
		try {
			// Streamed: the SDK refuses non-streaming requests big enough to run
			// long (bar-wise transcription needs the 16k output ceiling).
			const response = await client.messages.stream({
				model,
				max_tokens: ANTHROPIC_TUNE_MAX_TOKENS,
				...(model === ANTHROPIC_TUNE_MODEL ? FABLE_THINKING : {}),
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
			console.error('[tune-parse] extraction failed:', err);
			return { ok: false, convErrors: null };
		}

		// Models sometimes wrap JSON in fences despite instructions — strip them.
		const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(responseText.trim());
		const jsonText = fenced ? fenced[1] : responseText.trim();

		let extracted: unknown;
		try {
			extracted = JSON.parse(jsonText);
		} catch {
			console.warn('[tune-parse] model returned non-JSON output');
			return { ok: false, convErrors: null };
		}

		const { sheet, errors, warnings } = claudeJsonToTune(extracted);
		if (!sheet) {
			console.warn('[tune-parse] conversion rejected:', errors.join('; '));
			return { ok: false, convErrors: errors };
		}
		return { ok: true, sheet, warnings, score: extractionConsistencyScore(warnings) };
	};

	// Extraction has no temperature control on this model, and a bad sample
	// loses bars. A structurally shaky attempt gets ONE retry; keep the
	// steadier of the two.
	let result = await runExtraction(ANTHROPIC_TUNE_MODEL);
	if (!result.ok || result.score >= 2) {
		// The retry drops to the baseline model when the first attempt died
		// outright (Fable's output filter blocks some well-known tunes).
		const second = await runExtraction(result.ok ? ANTHROPIC_TUNE_MODEL : ANTHROPIC_MODEL);
		if (second.ok && (!result.ok || second.score < result.score)) result = second;
	}

	if (!result.ok) {
		if (result.convErrors) {
			throw error(422, `The chart could not be read as a tune: ${result.convErrors.join('; ')}`);
		}
		throw error(502, 'The PDF could not be processed. Try again, or enter the chart manually.');
	}
	result.sheet.id = generateSheetId();

	return json({ sheet: result.sheet, warnings: result.warnings });
};

/** One bar entry of a system-mode response, structurally screened. */
interface SystemBar {
	startRepeat: boolean;
	endRepeat: boolean;
	ending: number | null;
	pickup: boolean;
	melody: Array<[number, number, string] | [number, number, string, boolean]>;
}

/** Per-bar rhythm issues (exact tiling incl. rests) plus the global bar
 * count; index 0 of the result is the global issue list, then one list per
 * bar. */
function systemBarIssues(
	bars: SystemBar[],
	barCount: number,
	beats: number
): { global: string[]; perBar: string[][] } {
	const global: string[] = [];
	if (bars.length !== barCount) {
		global.push(`expected ${barCount} bars but the transcription returned ${bars.length}`);
	}
	const perBar = bars.map((bar, i) =>
		barTilingIssues(bar.melody, i, beats, { allowLeadingGap: bar.pickup })
	);
	return { global, perBar };
}

/** Screen the raw model JSON into SystemBar[]; null when malformed. */
function screenSystemBars(parsed: unknown): {
	fifths: number | null;
	timeSignature: [number, number] | null;
	bars: SystemBar[];
} | null {
	if (!parsed || typeof parsed !== 'object') return null;
	const obj = parsed as {
		keySignature?: { fifths?: unknown };
		timeSignature?: unknown;
		bars?: unknown;
	};
	if (!Array.isArray(obj.bars)) return null;
	const bars: SystemBar[] = [];
	for (const raw of obj.bars) {
		if (!raw || typeof raw !== 'object') return null;
		const b = raw as Record<string, unknown>;
		if (!Array.isArray(b.melody)) return null;
		const melody: SystemBar['melody'] = [];
		for (const note of b.melody) {
			if (
				!Array.isArray(note) ||
				note.length < 3 ||
				typeof note[0] !== 'number' ||
				typeof note[1] !== 'number' ||
				typeof note[2] !== 'string'
			) {
				return null;
			}
			melody.push(
				note[3] === true
					? [note[0], note[1], note[2], true]
					: [note[0], note[1], note[2]]
			);
		}
		bars.push({
			startRepeat: b.startRepeat === true,
			endRepeat: b.endRepeat === true,
			ending: typeof b.ending === 'number' ? b.ending : null,
			pickup: b.pickup === true,
			melody
		});
	}
	const fifths =
		typeof obj.keySignature?.fifths === 'number' ? obj.keySignature.fifths : null;
	const ts = obj.timeSignature;
	const timeSignature =
		Array.isArray(ts) && ts.length === 2 && typeof ts[0] === 'number' && typeof ts[1] === 'number'
			? ([ts[0], ts[1]] as [number, number])
			: null;
	return { fifths, timeSignature, bars };
}

async function handleSystemMode(system: SystemRequestBody['system']): Promise<Response> {
	if (
		!system ||
		typeof system.image !== 'string' ||
		system.image.length === 0 ||
		typeof system.barCount !== 'number' ||
		!Number.isInteger(system.barCount) ||
		system.barCount < 1 ||
		system.barCount > 32
	) {
		throw error(400, '`system.image` (base64 PNG) and `system.barCount` (1-32) are required.');
	}
	// The meter is interpolated into the model prompt: both members must be
	// small positive integers or a client could inject arbitrary instructions
	// (or an unbounded beat count) through `timeSignature`.
	const rawMeter: unknown[] = Array.isArray(system.timeSignature) ? system.timeSignature : [];
	const meterNum = (v: unknown, fallback: number): number =>
		typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 32 ? v : fallback;
	const meter: [number, number] = [meterNum(rawMeter[0], 4), meterNum(rawMeter[1], 4)];
	const beats = meter[0];
	const data = system.image.replace(/^data:image\/png;base64,/, '').replace(/\s/g, '');
	if (data.length === 0 || !/^[A-Za-z0-9+/]+=*$/.test(data)) {
		throw error(400, '`system.image` must be base64-encoded PNG data.');
	}

	const client = getAnthropicClient();
	if (!client) {
		throw error(503, 'PDF import is not configured.');
	}

	let lastFailure = 'unknown';
	const ask = async (
		feedback: string | null,
		model: string
	): Promise<{
		fifths: number | null;
		timeSignature: [number, number] | null;
		bars: SystemBar[];
		issues: { global: string[]; perBar: string[][] };
	} | null> => {
		let responseText: string;
		try {
			const response = await client.messages
				.stream({
					model,
					max_tokens: ANTHROPIC_TUNE_MAX_TOKENS,
					// Fable thinks adaptively; high effort buys transcription
					// accuracy, and the 32k ceiling keeps dense-system JSON
					// clear of truncation under the thinking tokens.
					...(model === ANTHROPIC_TUNE_MODEL ? FABLE_THINKING : {}),
					system: SYSTEM_MODE_PROMPT,
					messages: [
						{
							role: 'user',
							content: [
								{
									type: 'image',
									source: { type: 'base64', media_type: 'image/png', data }
								},
								{
									type: 'text',
									text:
										`This system contains exactly ${system.barCount} bars in ${beats}/${meter[1]} time. ` +
										`Transcribe it as JSON per the schema.` +
										(system.first === true
											? ' This is the FIRST system of the chart: check carefully whether the notes before the first full bar form a partial PICKUP bar (pickup: true, notes at their real beats near the END of the bar).'
											: '') +
										(feedback ? ` Your previous attempt had problems — re-read the image carefully: ${feedback}` : '')
								}
							]
						}
					]
				})
				.finalMessage();
			responseText = response.content
				.filter((block) => block.type === 'text')
				.map((block) => (block as { text: string }).text)
				.join('');
		} catch (err) {
			console.error('[tune-parse] system-mode extraction failed:', err);
			lastFailure = `api: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown'}`;
			return null;
		}
		const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(responseText.trim());
		let parsed: unknown;
		try {
			parsed = JSON.parse(fenced ? fenced[1] : responseText.trim());
		} catch {
			lastFailure = `non-json output (${responseText.length} chars): ${responseText.slice(0, 120)}`;
			return null;
		}
		const screened = screenSystemBars(parsed);
		if (!screened) {
			lastFailure = 'malformed bars structure';
			return null;
		}
		return { ...screened, issues: systemBarIssues(screened.bars, system.barCount, beats) };
	};

	const flatIssues = (a: { issues: { global: string[]; perBar: string[][] } }): string[] => [
		...a.issues.global,
		...a.issues.perBar.flat()
	];

	// Fable first for accuracy; its stricter output filter sometimes blocks
	// transcription of well-known tunes — as an explicit API error OR as a
	// silently EMPTY response — so any total first-attempt failure falls
	// back to the baseline model. Failing bars then get ONE retry with
	// their exact rhythm deltas fed back (the Audiveris rhythm-QA loop),
	// and the answer is merged PER BAR so a clean first-attempt bar can
	// never regress.
	let model = ANTHROPIC_TUNE_MODEL;
	let first = await ask(null, model);
	if (!first && model !== ANTHROPIC_MODEL) {
		model = ANTHROPIC_MODEL;
		first = await ask(null, model);
	}
	const evidence = Array.isArray(system.barEvidence) ? system.barEvidence : [];
	const evidenceDisagreements = (bars: SystemBar[]): string[] => {
		const out: string[] = [];
		bars.forEach((bar, i) => {
			const ev = evidence[i];
			if (!ev || typeof ev.count !== 'number') return;
			const noteCount = bar.melody.filter((note) => !isRestPitch(note[2])).length;
			if (noteCount !== ev.count) {
				out.push(
					`bar ${i + 1}: independent notehead detection reads ${ev.count} notehead(s)` +
						(ev.letters?.length ? ` on lines/spaces ${ev.letters.join(' ')} (letters only — apply the key signature and accidentals yourself)` : '') +
						` but your transcription has ${noteCount} — re-read that bar carefully and keep your reading only if the print clearly confirms it`
				);
			}
		});
		return out;
	};

	let result = first;
	let bars = first?.bars ?? [];
	let warnings = first ? flatIssues(first) : [];
	const firstEvidenceIssues = first ? evidenceDisagreements(first.bars) : [];
	if (!first || warnings.length > 0 || firstEvidenceIssues.length > 0) {
		const second = await ask(
			first ? [...warnings, ...firstEvidenceIssues].join('; ') : null,
			model
		);
		if (second && !first) {
			result = second;
			bars = second.bars;
			warnings = flatIssues(second);
		} else if (second && first) {
			// Per-bar merge: prefer clean bars, and among clean bars prefer
			// the one agreeing with the notehead evidence.
			const agreesWithEvidence = (bar: SystemBar | undefined, i: number): boolean => {
				const ev = evidence[i];
				if (!bar || !ev || typeof ev.count !== 'number') return false;
				return bar.melody.filter((note) => !isRestPitch(note[2])).length === ev.count;
			};
			const merged: SystemBar[] = [];
			const survivors: string[] = [...first.issues.global];
			const count = Math.max(first.bars.length, second.bars.length);
			for (let i = 0; i < count; i++) {
				const firstClean = first.bars[i] && (first.issues.perBar[i] ?? []).length === 0;
				const secondClean = second.bars[i] && (second.issues.perBar[i] ?? []).length === 0;
				if (firstClean && secondClean && !agreesWithEvidence(first.bars[i], i) && agreesWithEvidence(second.bars[i], i)) {
					merged.push(second.bars[i]);
				} else if (firstClean) {
					merged.push(first.bars[i]);
				} else if (secondClean) {
					merged.push(second.bars[i]);
				} else if (first.bars[i]) {
					merged.push(first.bars[i]);
					survivors.push(...(first.issues.perBar[i] ?? []));
				} else if (second.bars[i]) {
					merged.push(second.bars[i]);
					survivors.push(...(second.issues.perBar[i] ?? []));
				}
			}
			bars = merged;
			warnings = survivors;
		}
	}
	if (!result) {
		throw error(502, `The system image could not be transcribed (${lastFailure}). Try again.`);
	}
	// Rests were only needed for validation — the importer works with notes.
	const stripped = bars.map((bar) => ({
		...bar,
		melody: bar.melody.filter((note) => !isRestPitch(note[2]))
	}));
	return json({
		keySignature: result.fifths === null ? null : { fifths: result.fifths },
		timeSignature: result.timeSignature,
		bars: stripped,
		warnings
	});
}

/** Config probe so the upload page can render a not-configured state. */
export const GET: RequestHandler = async () => {
	return json({
		configured: isAnthropicConfigured(),
		model: isAnthropicConfigured() ? ANTHROPIC_TUNE_MODEL : null
	});
};

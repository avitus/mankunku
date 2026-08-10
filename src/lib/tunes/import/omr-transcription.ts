/**
 * Bridge from a locally-generated OMR transcription (`python -m omr
 * transcribe` → `.omr.json`) into the per-system model responses the PDF
 * import fusion consumes.
 *
 * The file is UNTRUSTED user input: `validateOmrTranscription` gates it in
 * the adopted-tune-validator style (shape, DoS caps, script-content
 * heuristic) before any mapping runs.
 *
 * Unit conventions: OMR onsets/durations are [num, den] fractions of a
 * WHOLE NOTE; `ModelBar.melody` entries are [beat, durationBeats, pitch,
 * tied?] in units of the DECLARED meter denominator — the same meter the
 * assembled doc is built with, so the two can never disagree.
 */

import type { ModelBar } from './pdf-system-assemble';

export interface OmrNote {
	spelled_pitch: string | null;
	onset: [number, number];
	duration: [number, number];
	tied_to_next?: boolean;
	is_rest?: boolean;
}

export interface OmrMeasureWarning {
	code: string;
	message: string;
}

export interface OmrMeasure {
	number: number;
	notes: OmrNote[];
	start_repeat?: boolean;
	end_repeat?: boolean;
	ending?: number | null;
	raw_unparsed?: string[];
	warnings?: OmrMeasureWarning[];
}

export interface OmrNormalized {
	title: string | null;
	composer: string | null;
	key_signature: string | null;
	time_signature: [number, number] | null;
	measures: OmrMeasure[];
}

/** Structurally identical to the import page's SystemModeResponse. */
export interface OmrSystemResponse {
	keySignature: { fifths: number } | null;
	timeSignature: [number, number] | null;
	bars: ModelBar[];
	warnings: string[];
}

export interface OmrValidation {
	valid: boolean;
	errors: string[];
}

/** DoS caps for the untrusted file. */
export const MAX_OMR_MEASURES = 512;
export const MAX_OMR_NOTES_PER_MEASURE = 128;
export const MAX_OMR_TEXT_LENGTH = 200;
export const MAX_OMR_PITCH_LENGTH = 8;

const DANGEROUS_CONTENT = /<[a-z]|javascript:|on\w+\s*=/i;

function isCleanStringOrNull(v: unknown, maxLength: number): boolean {
	if (v === null || v === undefined) return true;
	return typeof v === 'string' && v.length <= maxLength && !DANGEROUS_CONTENT.test(v);
}

function isFraction(v: unknown, allowZeroNumerator: boolean): v is [number, number] {
	return (
		Array.isArray(v) &&
		v.length === 2 &&
		typeof v[0] === 'number' &&
		typeof v[1] === 'number' &&
		Number.isInteger(v[0]) &&
		Number.isInteger(v[1]) &&
		v[1] > 0 &&
		(allowZeroNumerator ? v[0] >= 0 : v[0] > 0)
	);
}

/** Validate an untrusted `.omr.json` CLI payload (or bare normalized doc). */
export function validateOmrTranscription(input: unknown): OmrValidation {
	const errors: string[] = [];

	if (typeof input !== 'object' || input === null || Array.isArray(input)) {
		return { valid: false, errors: ['payload is not an object'] };
	}
	const root = input as Record<string, unknown>;
	const normalized = (root.normalized ?? root) as Record<string, unknown>;
	if (typeof normalized !== 'object' || normalized === null || !Array.isArray(normalized.measures)) {
		return { valid: false, errors: ['payload has no normalized.measures — is this a .omr.json from `python -m omr transcribe`?'] };
	}

	if (!isCleanStringOrNull(normalized.title, MAX_OMR_TEXT_LENGTH)) errors.push('unsafe or oversized title');
	if (!isCleanStringOrNull(normalized.composer, MAX_OMR_TEXT_LENGTH)) errors.push('unsafe or oversized composer');
	if (!isCleanStringOrNull(normalized.key_signature, MAX_OMR_TEXT_LENGTH)) errors.push('unsafe key signature');
	if (
		normalized.time_signature !== null &&
		normalized.time_signature !== undefined &&
		!isFraction(normalized.time_signature, false)
	) {
		errors.push('invalid time signature');
	}

	const measures = normalized.measures as unknown[];
	if (measures.length > MAX_OMR_MEASURES) {
		errors.push(`too many measures (${measures.length} > ${MAX_OMR_MEASURES})`);
	}

	for (const [index, entry] of measures.entries()) {
		if (typeof entry !== 'object' || entry === null) {
			errors.push(`measure ${index + 1} is not an object`);
			continue;
		}
		const m = entry as Record<string, unknown>;
		if (!Number.isInteger(m.number) || (m.number as number) < 1) {
			errors.push(`measure ${index + 1} has an invalid number`);
		}
		if (!Array.isArray(m.notes)) {
			errors.push(`measure ${index + 1} notes is not an array`);
			continue;
		}
		if (m.notes.length > MAX_OMR_NOTES_PER_MEASURE) {
			errors.push(`measure ${index + 1} has too many notes (${m.notes.length})`);
			continue;
		}
		for (const [noteIndex, rawNote] of (m.notes as unknown[]).entries()) {
			if (typeof rawNote !== 'object' || rawNote === null) {
				errors.push(`measure ${index + 1} note ${noteIndex + 1} is not an object`);
				continue;
			}
			const n = rawNote as Record<string, unknown>;
			const pitchOk =
				n.spelled_pitch === null ||
				(typeof n.spelled_pitch === 'string' &&
					n.spelled_pitch.length <= MAX_OMR_PITCH_LENGTH &&
					!DANGEROUS_CONTENT.test(n.spelled_pitch));
			if (!pitchOk) errors.push(`measure ${index + 1} note ${noteIndex + 1} has an invalid pitch`);
			if (!isFraction(n.onset, true)) errors.push(`measure ${index + 1} note ${noteIndex + 1} has an invalid onset`);
			if (!isFraction(n.duration, false)) {
				errors.push(`measure ${index + 1} note ${noteIndex + 1} has an invalid duration`);
			}
		}
		if (errors.length > 40) {
			errors.push('further errors suppressed');
			break;
		}
	}

	return { valid: errors.length === 0, errors };
}

/** Extract the normalized doc from a validated payload. */
export function omrNormalized(input: unknown): OmrNormalized {
	const root = input as Record<string, unknown>;
	return (root.normalized ?? root) as unknown as OmrNormalized;
}

const MAJOR_FIFTHS: Record<string, number> = {
	C: 0,
	G: 1,
	D: 2,
	A: 3,
	E: 4,
	B: 5,
	'F#': 6,
	'C#': 7,
	F: -1,
	Bb: -2,
	Eb: -3,
	Ab: -4,
	Db: -5,
	Gb: -6,
	Cb: -7
};

/**
 * OMR key names ("D", "F#m", "gb") → circle-of-fifths signature int, or null
 * when unparseable (modes other than major/minor return null — no guessing).
 */
export function omrKeyToFifths(key: string): number | null {
	const normalized = key.trim().replace(/♯/g, '#').replace(/♭/g, 'b');
	const match = normalized.match(/^([A-Ga-g])([#b]?)\s*(m|min|minor|maj|major)?$/i);
	if (!match) return null;
	const root = match[1].toUpperCase() + match[2].toLowerCase();
	const fifths = MAJOR_FIFTHS[root];
	if (fifths === undefined) return null;
	const mode = match[3]?.toLowerCase() ?? '';
	if (mode === 'm' || mode === 'min' || mode === 'minor') return fifths - 3;
	return fifths;
}

/**
 * Slice the flat OMR measure list into per-system model responses using the
 * page geometry's bar counts. Systems the transcription cannot fully cover
 * come back as null — the caller falls back (Claude, or untranscribed
 * padding) for exactly those.
 */
export function omrSystemResponses(
	omr: OmrNormalized,
	barCounts: number[],
	declaredMeter: [number, number]
): { responses: Array<OmrSystemResponse | null>; warnings: string[] } {
	const den = declaredMeter[1];
	const toBeat = (fraction: [number, number]) => (fraction[0] / fraction[1]) * den;

	const totalNeeded = barCounts.reduce((sum, count) => sum + count, 0);
	const total = omr.measures.length;
	const warnings: string[] = [];
	if (total !== totalNeeded) {
		warnings.push(
			`the OMR transcription has ${total} measure(s) but the page layout has ` +
				`${totalNeeded} — systems past the mismatch fall back to the standard reader`
		);
	}

	const fifths = omr.key_signature ? omrKeyToFifths(omr.key_signature) : null;
	const keySignature = fifths === null ? null : { fifths };
	const timeSignature = omr.time_signature ?? null;

	let cursor = 0;
	const responses = barCounts.map((count) => {
		const start = cursor;
		cursor += count;
		if (start + count > total) return null;
		const chunk = omr.measures.slice(start, start + count);

		const systemWarnings: string[] = [];
		const bars: ModelBar[] = chunk.map((m, local) => {
			for (const warning of m.warnings ?? []) {
				systemWarnings.push(`bar ${local + 1}: ${warning.message}`);
			}
			if ((m.raw_unparsed?.length ?? 0) > 0 && (m.warnings?.length ?? 0) === 0) {
				systemWarnings.push(`bar ${local + 1}: unreadable region in the OMR transcription`);
			}
			return {
				startRepeat: m.start_repeat ?? false,
				endRepeat: m.end_repeat ?? false,
				ending: m.ending ?? null,
				pickup: false,
				melody: (m.notes ?? [])
					.filter((n) => !n.is_rest && n.spelled_pitch)
					.map((n) =>
						n.tied_to_next
							? ([toBeat(n.onset), toBeat(n.duration), n.spelled_pitch as string, true] as const)
							: ([toBeat(n.onset), toBeat(n.duration), n.spelled_pitch as string] as const)
					)
					.map((entry) => entry as unknown as ModelBar['melody'][number])
			};
		});

		return { keySignature, timeSignature, bars, warnings: systemWarnings };
	});

	return { responses, warnings };
}

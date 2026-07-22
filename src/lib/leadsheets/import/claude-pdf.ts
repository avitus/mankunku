import type { Fraction, Note, PitchClass } from '$lib/types/music';
import type { LeadSheet, LeadSheetSection } from '$lib/types/lead-sheet';
import { PITCH_CLASSES } from '$lib/types/music';
import { noteNameToMidi } from '$lib/music/intervals';
import { parseChordSymbol } from '$lib/music/chord-symbol';
import { harmonicSegmentFromChordSymbol } from '$lib/leadsheets/segment-from-symbol';
import {
	validateAdoptedLeadSheet,
	MAX_SECTIONS_PER_ADOPTED_SHEET,
	MAX_BARS_PER_SECTION,
	MAX_NOTES_PER_ADOPTED_SHEET
} from '$lib/leadsheets/adopted-lead-sheet-validator';

/**
 * Conversion of the Claude PDF-extraction JSON into a LeadSheet draft.
 *
 * The model's output is UNTRUSTED input: every field is validated, elements
 * that fail locally (a chord in a nonexistent bar, an unparseable pitch)
 * are skipped with warnings, and the assembled sheet must still pass the
 * adopted-sheet structural validator before it is returned. The draft then
 * goes to the manual editor for mandatory human review — never straight to
 * storage.
 *
 * Expected document shape (what the API route prompts for):
 * {
 *   title, composer?, style?, key, timeSignature: [n, d],
 *   sections: [{ label, bars, repeatStart?, repeatEnd?, ending?,
 *     chords: [{ bar, beat, symbol }],
 *     melody: [{ bar, beat, durationBeats, pitch: "Bb4" | null }] }]
 * }
 * Bars and beats are 0-based; beats are in units of the time signature's
 * denominator; pitch is scientific pitch notation at CONCERT pitch.
 */

export interface ClaudePdfConversion {
	sheet: LeadSheet | null;
	errors: string[];
	warnings: string[];
}

/** Convert a float in whole notes to a reduced fraction (denominators to 24ths). */
function toFraction(value: number): Fraction {
	for (const den of [1, 2, 3, 4, 6, 8, 12, 16, 24]) {
		const num = Math.round(value * den);
		if (Math.abs(num / den - value) < 1e-9) return [num, den];
	}
	return [Math.round(value * 24), 24];
}

function isFiniteNumber(v: unknown): v is number {
	return typeof v === 'number' && Number.isFinite(v);
}

export function claudeJsonToLeadSheet(data: unknown): ClaudePdfConversion {
	const errors: string[] = [];
	const warnings: string[] = [];

	if (typeof data !== 'object' || data === null || Array.isArray(data)) {
		return { sheet: null, errors: ['extraction is not a JSON object'], warnings };
	}
	const doc = data as Record<string, unknown>;

	if (typeof doc.title !== 'string' || doc.title.trim() === '') {
		errors.push('missing title');
	}
	const key = doc.key;
	const normalizedKey = typeof key === 'string' ? parseChordSymbol(key)?.root : undefined;
	if (!normalizedKey || !PITCH_CLASSES.includes(normalizedKey)) {
		errors.push(`invalid key: ${String(key)}`);
	}

	const ts = doc.timeSignature;
	const validTs =
		Array.isArray(ts) &&
		ts.length === 2 &&
		Number.isInteger(ts[0]) &&
		Number.isInteger(ts[1]) &&
		(ts[0] as number) > 0 &&
		(ts[1] as number) > 0;
	if (!validTs) errors.push('invalid timeSignature');

	const rawSections = doc.sections;
	if (!Array.isArray(rawSections) || rawSections.length === 0) {
		errors.push('no sections extracted');
	} else if (rawSections.length > MAX_SECTIONS_PER_ADOPTED_SHEET) {
		errors.push(`too many sections (${rawSections.length})`);
	}
	if (errors.length > 0) return { sheet: null, errors, warnings };

	const [tsNum, tsDen] = ts as [number, number];
	/** One beat (time-signature denominator unit) in whole notes. */
	const beatUnit = 1 / tsDen;

	let totalNotes = 0;
	const sections: LeadSheetSection[] = [];

	for (let s = 0; s < (rawSections as unknown[]).length; s++) {
		const raw = (rawSections as Record<string, unknown>[])[s];
		if (typeof raw !== 'object' || raw === null) {
			warnings.push(`section ${s + 1}: not an object — skipped`);
			continue;
		}
		const bars = raw.bars;
		if (!Number.isInteger(bars) || (bars as number) < 1 || (bars as number) > MAX_BARS_PER_SECTION) {
			warnings.push(`section ${s + 1}: invalid bar count — skipped`);
			continue;
		}
		const barCount = bars as number;
		const sectionEndBeats = barCount * tsNum;

		const section: LeadSheetSection = {
			label: typeof raw.label === 'string' && raw.label ? raw.label : String.fromCharCode(65 + s),
			bars: barCount,
			notes: [],
			harmony: []
		};
		if (raw.repeatStart === true) section.repeatStart = true;
		if (raw.repeatEnd === true) section.repeatEnd = true;
		if (raw.ending === 1 || raw.ending === 2) section.ending = raw.ending;

		// ── Chords: change points with derived durations ────────────────
		const placed: { offsetBeats: number; symbol: string }[] = [];
		for (const c of Array.isArray(raw.chords) ? (raw.chords as Record<string, unknown>[]) : []) {
			if (!isFiniteNumber(c?.bar) || !isFiniteNumber(c?.beat) || typeof c?.symbol !== 'string') {
				warnings.push(`section ${s + 1}: malformed chord entry skipped`);
				continue;
			}
			const offsetBeats = (c.bar as number) * tsNum + (c.beat as number);
			if (c.bar < 0 || c.bar >= barCount || c.beat < 0 || c.beat >= tsNum) {
				warnings.push(`section ${s + 1}: chord "${c.symbol}" outside the section — skipped`);
				continue;
			}
			if (!parseChordSymbol(c.symbol)) {
				warnings.push(`section ${s + 1}: unparseable chord "${c.symbol}" — skipped`);
				continue;
			}
			placed.push({ offsetBeats, symbol: c.symbol });
		}
		placed.sort((a, b) => a.offsetBeats - b.offsetBeats);
		placed.forEach((p, idx) => {
			const nextBeats = idx + 1 < placed.length ? placed[idx + 1].offsetBeats : sectionEndBeats;
			const parsed = parseChordSymbol(p.symbol)!;
			section.harmony.push(
				harmonicSegmentFromChordSymbol(
					parsed,
					toFraction(p.offsetBeats * beatUnit),
					toFraction((nextBeats - p.offsetBeats) * beatUnit)
				)
			);
		});

		// ── Melody: pitched notes only (rests are gap-filled at render) ──
		for (const n of Array.isArray(raw.melody) ? (raw.melody as Record<string, unknown>[]) : []) {
			if (n?.pitch === null) continue;
			if (
				!isFiniteNumber(n?.bar) || !isFiniteNumber(n?.beat) ||
				!isFiniteNumber(n?.durationBeats) || typeof n?.pitch !== 'string'
			) {
				warnings.push(`section ${s + 1}: malformed melody entry skipped`);
				continue;
			}
			if (n.bar < 0 || n.bar >= barCount || n.beat < 0 || n.beat >= tsNum || n.durationBeats <= 0) {
				warnings.push(`section ${s + 1}: melody note outside the section — skipped`);
				continue;
			}
			let midi: number;
			try {
				midi = noteNameToMidi(n.pitch);
			} catch {
				warnings.push(`section ${s + 1}: unreadable pitch "${n.pitch}" — skipped`);
				continue;
			}
			if (midi < 0 || midi > 127) {
				warnings.push(`section ${s + 1}: pitch "${n.pitch}" out of MIDI range — skipped`);
				continue;
			}
			const note: Note = {
				pitch: midi,
				duration: toFraction((n.durationBeats as number) * beatUnit),
				offset: toFraction(((n.bar as number) * tsNum + (n.beat as number)) * beatUnit)
			};
			section.notes.push(note);
			totalNotes++;
		}
		section.notes.sort(
			(a, b) => a.offset[0] * b.offset[1] - b.offset[0] * a.offset[1]
		);

		sections.push(section);
	}

	if (sections.length === 0) {
		return { sheet: null, errors: ['every extracted section was invalid'], warnings };
	}
	if (totalNotes > MAX_NOTES_PER_ADOPTED_SHEET) {
		return { sheet: null, errors: [`too many melody notes (${totalNotes})`], warnings };
	}

	const sheet: LeadSheet = {
		id: '',
		title: (doc.title as string).trim(),
		key: normalizedKey as PitchClass,
		timeSignature: [tsNum, tsDen],
		tags: [],
		sections,
		source: 'imported-pdf'
	};
	if (typeof doc.composer === 'string' && doc.composer.trim()) sheet.composer = doc.composer.trim();
	if (typeof doc.style === 'string' && doc.style.trim()) sheet.style = doc.style.trim();

	// Final structural gate — same validator community payloads pass through.
	// (It requires a non-empty id; the caller assigns the real one.)
	const validation = validateAdoptedLeadSheet({ ...sheet, id: 'pdf-import-draft' });
	if (!validation.valid) {
		return { sheet: null, errors: validation.errors, warnings };
	}

	return { sheet, errors: [], warnings };
}

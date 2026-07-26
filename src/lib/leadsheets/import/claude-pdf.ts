import type { Fraction, Note, PitchClass } from '$lib/types/music';
import type { Tune, TuneSection } from '$lib/types/tune';
import { PITCH_CLASSES } from '$lib/types/music';
import { noteNameToMidi } from '$lib/music/intervals';
import { parseChordSymbol } from '$lib/music/chord-symbol';
import { harmonicSegmentFromChordSymbol } from '$lib/leadsheets/segment-from-symbol';
import {
	buildSections,
	type BarStructure,
	type HarmonyChange
} from '$lib/leadsheets/section-builder';
import {
	validateAdoptedLeadSheet,
	MAX_SECTIONS_PER_ADOPTED_SHEET,
	MAX_BARS_PER_SECTION,
	MAX_NOTES_PER_ADOPTED_SHEET
} from '$lib/leadsheets/adopted-lead-sheet-validator';

/**
 * Structural-shakiness score of a conversion: the count of warnings that
 * indicate the transcription itself lost or misplaced bars (resyncs, bar
 * count mismatches, overview disagreements) — content-level skips don't
 * count. The route retries an extraction once when this is high.
 */
export function extractionConsistencyScore(warnings: string[]): number {
	return warnings.filter((w) => /resync|bar count mismatch|overview/.test(w)).length;
}

/**
 * Conversion of the Claude PDF-extraction JSON into a Tune draft.
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
	sheet: Tune | null;
	errors: string[];
	warnings: string[];
}

/** Convert a float in whole notes to a reduced fraction (denominators to 24ths). */
/** Rational snap over the duration ladder (triplets included); shared with
 * the route's per-bar rhythm validation. */
export function toFraction(value: number): Fraction {
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
	// Prefer the mechanical reading: the printed key signature's fifths.
	// A key NAME invites the model's knowledge of the tune; counting sharps
	// is copying. Legacy responses carry only `key`.
	const fifths = (doc.keySignature as Record<string, unknown> | undefined)?.fifths;
	const key = doc.key;
	const normalizedKey =
		typeof fifths === 'number' && Number.isInteger(fifths)
			? PITCH_CLASSES[(((fifths * 7) % 12) + 12) % 12]
			: typeof key === 'string'
				? parseChordSymbol(key)?.root
				: undefined;
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

	const barwise = Array.isArray(doc.systems);
	const rawSections = doc.sections;
	if (!barwise) {
		if (!Array.isArray(rawSections) || rawSections.length === 0) {
			errors.push('no sections extracted');
		} else if (rawSections.length > MAX_SECTIONS_PER_ADOPTED_SHEET) {
			errors.push(`too many sections (${rawSections.length})`);
		}
	}
	if (errors.length > 0) return { sheet: null, errors, warnings };

	const [tsNum, tsDen] = ts as [number, number];
	/** One beat (time-signature denominator unit) in whole notes. */
	const beatUnit = 1 / tsDen;

	let totalNotes = 0;
	let sections: TuneSection[] = [];

	// ── v2: bar-wise transcription (systems → bars) ─────────────────────
	// The model reads system by system, bar by bar — its reliable frame.
	// Structural assembly runs through the SAME section builder as the
	// MuseScore importer, so equivalent readings produce identical forms.
	if (barwise) {
		const structures: BarStructure[] = [];
		const noteEvents: Note[] = [];
		const harmonyEvents: HarmonyChange[] = [];

		let pickupBars = 0;
		for (const sys of doc.systems as unknown[]) {
			const sysBars = (sys as Record<string, unknown>)?.bars;
			if (!Array.isArray(sysBars)) {
				warnings.push('malformed system entry skipped');
				continue;
			}

			// Printed system bar numbers are a mechanical check on the count.
			// Engravers exclude pickup bars from numbering, so a system whose
			// first printed number is N should start at transcribed index
			// N-1 (+ pickups). Undercounts get placeholder bars inserted so
			// every later bar keeps its true position.
			const firstBarNumber = (sys as Record<string, unknown>).firstBarNumber;
			if (typeof firstBarNumber === 'number' && Number.isInteger(firstBarNumber) && firstBarNumber > 0) {
				// Charts number their bars under either convention: pickups
				// excluded (engraving default) or counted as bar 1. Accept a
				// transcription matching EITHER before resyncing.
				const expected = firstBarNumber - 1 + pickupBars;
				const expectedCounted = firstBarNumber - 1;
				if (structures.length === expectedCounted && expectedCounted !== expected) {
					// Pickup-counted numbering — the transcription agrees as-is.
				} else if (structures.length < expected) {
					warnings.push(
						`bar count resynced: inserted ${expected - structures.length} missing bar(s) before printed bar ${firstBarNumber}`
					);
					while (structures.length < expected) {
						structures.push({
							startOffset: [structures.length * tsNum, tsDen],
							length: [tsNum, tsDen],
							rehearsalMark: null,
							startRepeat: false,
							endRepeat: false,
							pickup: false
						});
					}
				} else if (structures.length > expected) {
					warnings.push(
						`bar count mismatch: transcription has ${structures.length} bars before printed bar ${firstBarNumber}`
					);
				}
			}
			for (const rawBar of sysBars as Record<string, unknown>[]) {
				const i = structures.length;
				const startOffset: Fraction = [i * tsNum, tsDen];
				const bar: BarStructure = {
					startOffset,
					length: [tsNum, tsDen],
					rehearsalMark:
						typeof rawBar?.mark === 'string' && rawBar.mark.trim() !== ''
							? rawBar.mark.trim()
							: null,
					startRepeat: rawBar?.startRepeat === true,
					endRepeat: rawBar?.endRepeat === true,
					pickup: rawBar?.pickup === true,
					ending: rawBar?.ending === 1 || rawBar?.ending === 2 ? rawBar.ending : undefined
				};
				structures.push(bar);
				if (bar.pickup) pickupBars++;

				const barBase = i * tsNum;
				for (const c of Array.isArray(rawBar?.chords) ? (rawBar.chords as unknown[]) : []) {
					const beat = Array.isArray(c) ? c[0] : undefined;
					const rawSymbol = Array.isArray(c) ? c[1] : undefined;
					if (!isFiniteNumber(beat) || typeof rawSymbol !== 'string' || beat < 0 || beat >= tsNum) {
						warnings.push(`bar ${i + 1}: malformed chord entry skipped`);
						continue;
					}
					const symbol = rawSymbol.replace(/^\s*\(\s*/, '').replace(/\s*\)\s*$/, '');
					if (!parseChordSymbol(symbol)) {
						warnings.push(`bar ${i + 1}: unparseable chord "${rawSymbol}" — skipped`);
						continue;
					}
					harmonyEvents.push({ offset: toFraction((barBase + beat) * beatUnit), text: symbol });
				}

				for (const m of Array.isArray(rawBar?.melody) ? (rawBar.melody as unknown[]) : []) {
					if (!Array.isArray(m)) {
						warnings.push(`bar ${i + 1}: malformed melody entry skipped`);
						continue;
					}
					const [beat, durationBeats, pitch, tied] = m as unknown[];
					if (
						!isFiniteNumber(beat) ||
						!isFiniteNumber(durationBeats) ||
						typeof pitch !== 'string' ||
						beat < 0 ||
						beat >= tsNum ||
						durationBeats <= 0
					) {
						warnings.push(`bar ${i + 1}: malformed melody entry skipped`);
						continue;
					}
					let midi: number;
					try {
						const normalized = pitch
							.replace(/♯/g, '#')
							.replace(/♭/g, 'b')
							.replace(/^([A-G])[n♮]/, '$1');
						midi = noteNameToMidi(normalized);
					} catch {
						warnings.push(`bar ${i + 1}: unreadable pitch "${pitch}" — skipped`);
						continue;
					}
					if (midi < 0 || midi > 127) {
						warnings.push(`bar ${i + 1}: pitch "${pitch}" out of MIDI range — skipped`);
						continue;
					}
					const note: Note = {
						pitch: midi,
						duration: toFraction(durationBeats * beatUnit),
						offset: toFraction((barBase + beat) * beatUnit)
					};
					if (tied === true) note.tied = true;
					noteEvents.push(note);
					totalNotes++;
				}
			}
		}

		if (structures.length === 0) {
			return { sheet: null, errors: ['no bars extracted'], warnings };
		}

		// Self-consistency scaffold: the model declares its bar-per-system
		// inventory BEFORE transcribing; disagreement means bars were lost.
		if (Array.isArray(doc.systemsOverview)) {
			const declared = (doc.systemsOverview as unknown[]).filter(
				(n): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0
			);
			const declaredBars = declared.reduce((a, b) => a + b, 0);
			const systemCount = (doc.systems as unknown[]).length;
			if (declared.length !== systemCount) {
				warnings.push(
					`system overview declared ${declared.length} systems but ${systemCount} were transcribed`
				);
			} else if (declaredBars !== structures.length) {
				warnings.push(
					`system overview declared ${declaredBars} bars but ${structures.length} were transcribed`
				);
			}
		}
		noteEvents.sort((a, b) => a.offset[0] / a.offset[1] - b.offset[0] / b.offset[1]);
		harmonyEvents.sort((a, b) => a.offset[0] / a.offset[1] - b.offset[0] / b.offset[1]);
		sections = buildSections(structures, noteEvents, harmonyEvents, (msg) => {
			if (!warnings.includes(msg)) warnings.push(msg);
		});
		if (sections.length > MAX_SECTIONS_PER_ADOPTED_SHEET) {
			return { sheet: null, errors: [`too many sections (${sections.length})`], warnings };
		}
	}

	for (let s = 0; !barwise && s < (rawSections as unknown[]).length; s++) {
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

		const section: TuneSection = {
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
			// Editorial parentheses around a chord are punctuation, not pitch.
			const symbol = (c.symbol as string).replace(/^\s*\(\s*/, '').replace(/\s*\)\s*$/, '');
			if (!parseChordSymbol(symbol)) {
				warnings.push(`section ${s + 1}: unparseable chord "${c.symbol}" — skipped`);
				continue;
			}
			placed.push({ offsetBeats, symbol });
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
				// Extraction tolerance: unicode accidentals and explicit natural
				// markers ("Bn4", "B♮4") normalize before the strict reader.
				const normalized = (n.pitch as string)
					.replace(/♯/g, '#')
					.replace(/♭/g, 'b')
					.replace(/^([A-G])[n♮]/, '$1');
				midi = noteNameToMidi(normalized);
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

	const sheet: Tune = {
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

import type { Fraction, Note } from '$lib/types/music';
import { PITCH_CLASSES } from '$lib/types/music';
import type { LeadSheet, LeadSheetSection } from '$lib/types/lead-sheet';
import {
	addFractions,
	subtractFractions,
	multiplyFraction,
	compareFractions,
	gcd
} from '$lib/music/intervals';
import { harmonicSegmentFromSymbol } from '$lib/leadsheets/segment-from-symbol';

/**
 * MuseScore importer (.mscz / .mscx, MuseScore 3-4 formats).
 *
 * Reads the FIRST staff's first voice as the melody and its Harmony
 * elements as the changes. Two pitch conventions meet here and the file
 * resolves both exactly (unlike the PDF path, this import is lossless):
 *
 *  - `<Note><pitch>` is CONCERT midi regardless of the part's transposition
 *    — stored as-is.
 *  - `<Harmony>` roots are WRITTEN-pitch tonal pitch classes; they are
 *    shifted by the part's `<transposeChromatic>` back to concert.
 *  - `<KeySig><concertKey>` gives the concert key signature directly.
 *
 * Sections split at RehearsalMarks; repeat barlines map to section repeat
 * flags when they land on section boundaries.
 */

export interface MuseScoreImportResult {
	sheets: LeadSheet[];
	warnings: string[];
	/**
	 * The melody part's declared transposition in semitones (0 = the file
	 * claims concert pitch). A nonzero value means the parser has already
	 * converted the part to concert; zero means the file's pitch claim is
	 * only as trustworthy as its author — a written-pitch chart typed into
	 * a non-transposing part looks identical.
	 */
	declaredTransposition: number;
}

// ─── Small XML helpers (regex-based; runs in Node and the browser) ──────

function xmlText(source: string, tag: string): string | null {
	// Exact tag match — `<root>` must not match `<rootCase>`, nor
	// `<duration>` match `<durationType>`.
	const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(source);
	return m ? m[1] : null;
}

function decodeEntities(s: string): string {
	return s
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, '&');
}

/** Element text content with inline formatting tags stripped. */
function plainText(source: string, tag: string): string | null {
	const raw = xmlText(source, tag);
	if (raw === null) return null;
	const text = decodeEntities(raw.replace(/<[^>]*>/g, '')).trim();
	return text.length > 0 ? text : null;
}

/** First frame Text of the given style (VBox title/composer fallback). */
function frameText(xml: string, style: string): string | null {
	for (const t of xml.matchAll(/<Text>[\s\S]*?<\/Text>/g)) {
		if (t[0].includes(`<style>${style}</style>`)) return plainText(t[0], 'text');
	}
	return null;
}

function parseFractionText(text: string | null): Fraction | null {
	const m = /^\s*(-?\d+)\s*\/\s*(\d+)\s*$/.exec(text ?? '');
	if (!m) return null;
	const num = Number(m[1]);
	const den = Number(m[2]);
	if (den === 0) return null;
	const g = gcd(Math.abs(num), den);
	return [num / g, den / g];
}

// ─── Pitch spelling ─────────────────────────────────────────────────────

/** Tonal pitch class (14 = C, +1 per fifth) → pitch class 0-11. */
function tpcToPitchClass(tpc: number): number {
	return (((tpc - 14) * 7) % 12 + 12) % 12;
}

/** Key signature fifths (positive = sharps) → canonical major-key name. */
function fifthsToKey(fifths: number): (typeof PITCH_CLASSES)[number] {
	return PITCH_CLASSES[((fifths * 7) % 12 + 12) % 12];
}

// ─── Durations ──────────────────────────────────────────────────────────

const DURATION_TYPES: Record<string, Fraction> = {
	breve: [2, 1],
	whole: [1, 1],
	half: [1, 2],
	quarter: [1, 4],
	eighth: [1, 8],
	'16th': [1, 16],
	'32nd': [1, 32],
	'64th': [1, 64],
	'128th': [1, 128]
};

/** Largest multiple of 1/den at or below f — the containing beat. */
function floorToBeat(f: Fraction, den: number): Fraction {
	const k = Math.floor((f[0] * den) / f[1]);
	const g = gcd(Math.abs(k), den);
	return [k / g, den / g];
}

function multiplyFractions(a: Fraction, b: Fraction): Fraction {
	const num = a[0] * b[0];
	const den = a[1] * b[1];
	const g = gcd(Math.abs(num), den);
	return [num / g, den / g];
}

/** durationType + dots + tuplet ratio → whole-note fraction, or null. */
function resolveDuration(
	block: string,
	barLength: Fraction,
	tupletRatio: Fraction | null
): Fraction | null {
	const type = xmlText(block, 'durationType')?.trim() ?? '';
	let base: Fraction | null = null;
	if (type === 'measure') {
		base = parseFractionText(xmlText(block, 'duration')) ?? barLength;
	} else if (DURATION_TYPES[type]) {
		base = DURATION_TYPES[type];
		const dots = Number(xmlText(block, 'dots') ?? '0');
		if (dots > 0) {
			// n dots multiply by (2^(n+1) - 1) / 2^n.
			base = multiplyFractions(base, [2 ** (dots + 1) - 1, 2 ** dots]);
		}
	}
	if (base && tupletRatio) base = multiplyFractions(base, tupletRatio);
	return base;
}

// ─── The .mscx walker ───────────────────────────────────────────────────

interface HarmonyEvent {
	offset: Fraction; // absolute, whole-note units
	text: string; // concert-pitch chord text
}

/** Melody note whose offset is absolute during the walk; rebased per-section afterwards. */
type NoteEvent = Note;

interface MeasureInfo {
	startOffset: Fraction;
	/** The bar length in effect AT this measure (meters can change mid-piece). */
	length: Fraction;
	rehearsalMark: string | null;
	startRepeat: boolean;
	endRepeat: boolean;
	/** True for a right-aligned anacrusis (used to label a lone pickup section). */
	pickup: boolean;
	/** Volta this measure belongs to (1st/2nd ending), if any. */
	ending?: 1 | 2;
}

/** The user's instrument, for picking the matching part of a multi-part score. */
export interface PreferredInstrument {
	/** Display name, e.g. 'Tenor Saxophone'. */
	name: string;
	/** Written-above-concert semitones (tenor 14, alto 9, concert 0). */
	transpositionSemitones: number;
}

interface PartInfo {
	names: string[];
	transpose: number;
	firstStaffIndex: number;
}

export function parseMscx(xml: string, preferred?: PreferredInstrument): MuseScoreImportResult {
	const warnings: string[] = [];
	const warnOnce = (msg: string): void => {
		if (!warnings.includes(msg)) warnings.push(msg);
	};

	// Frame text (the VBox title block) is the fallback when the metaTags
	// were never filled in — a common state for hand-made charts.
	const title =
		plainText(/<metaTag name="workTitle">[\s\S]*?<\/metaTag>/.exec(xml)?.[0] ?? '', 'metaTag') ??
		frameText(xml, 'title') ??
		'Untitled';
	const composer =
		plainText(/<metaTag name="composer">[\s\S]*?<\/metaTag>/.exec(xml)?.[0] ?? '', 'metaTag') ??
		frameText(xml, 'composer') ??
		undefined;

	// Parts, in order, with the score staff range each one owns.
	const parts: PartInfo[] = [];
	let staffCursor = 0;
	for (const pm of xml.matchAll(/<Part[\s>][\s\S]*?<\/Part>/g)) {
		const body = pm[0];
		const names = [xmlText(body, 'trackName'), xmlText(body, 'longName'), xmlText(body, 'instrumentId')]
			.map((n) => n?.trim() ?? '')
			.filter((n) => n.length > 0);
		const staffCount = (body.match(/<Staff[\s>]/g) ?? []).length || 1;
		parts.push({
			names,
			transpose: Number(xmlText(body, 'transposeChromatic') ?? '0'),
			firstStaffIndex: staffCursor
		});
		staffCursor += staffCount;
	}

	// Score staves in document order (Part blocks also hold <Staff>
	// definitions, but those carry no measures).
	const scoreStaves = [...xml.matchAll(/<Staff[^>]*>[\s\S]*?<\/Staff>/g)]
		.map((m) => m[0])
		.filter((b) => b.includes('<Measure'));
	if (scoreStaves.length === 0) {
		return {
			sheets: [],
			warnings: ['No staff with measures found in the MuseScore file.'],
			declaredTransposition: parts[0]?.transpose ?? 0
		};
	}

	// Pick the part matching the user's instrument — by name first, then by
	// declared transposition — falling back to the first (top) staff.
	let selected = parts[0] ?? { names: [], transpose: 0, firstStaffIndex: 0 };
	if (preferred) {
		const hint = preferred.name.trim().toLowerCase();
		const byName = parts.find((p) =>
			p.names.some((n) => {
				const l = n.toLowerCase();
				return l.includes(hint) || (l.length >= 4 && hint.includes(l));
			})
		);
		const byTransposition =
			preferred.transpositionSemitones !== 0
				? parts.find((p) => p.transpose === -preferred.transpositionSemitones)
				: undefined;
		selected = byName ?? byTransposition ?? selected;
	}
	const transpose = selected.transpose;
	const melodyStaff =
		scoreStaves[selected.firstStaffIndex] ?? scoreStaves[0];

	let timeSignature: [number, number] | null = null;
	let barLength: Fraction = [1, 1];
	let key: (typeof PITCH_CLASSES)[number] | null = null;
	let style: string | undefined;

	const measures: MeasureInfo[] = [];
	const notes: NoteEvent[] = [];
	const harmonies: HarmonyEvent[] = [];

	let measureStart: Fraction = [0, 1];
	const tupletStack: Fraction[] = [];

	// Repeats, voltas, and rehearsal marks are SYSTEM-level objects that
	// MuseScore serializes only on the top staff — when another part is
	// extracted, its structure comes from staff 1, bar by bar.
	const structuralBlocks =
		melodyStaff === scoreStaves[0]
			? null
			: [...scoreStaves[0].matchAll(/<Measure[^>]*>[\s\S]*?<\/Measure>/g)].map((m) => m[0]);

	// Volta prepass: a start anchor carries <Volta><endings> plus its span in
	// <next><measures>; stamp every covered measure with its ending number.
	const structList =
		structuralBlocks ?? [...melodyStaff.matchAll(/<Measure[^>]*>[\s\S]*?<\/Measure>/g)].map((m) => m[0]);
	const endingByMeasure: (1 | 2 | undefined)[] = [];
	structList.forEach((b, i) => {
		for (const sp of b.matchAll(/<Spanner type="Volta">[\s\S]*?<\/Spanner>/g)) {
			const endingsText = xmlText(sp[0], 'endings');
			if (endingsText === null) continue; // the span's end anchor
			const n = Number.parseInt(endingsText, 10);
			if (n !== 1 && n !== 2) {
				warnOnce(`Ending "${endingsText.trim()}" is not supported (only 1st/2nd) — imported as plain bars.`);
				continue;
			}
			const span = Math.max(1, Number(/<next>[\s\S]*?<measures>(-?\d+)<\/measures>/.exec(sp[0])?.[1] ?? '1'));
			for (let k = i; k < Math.min(i + span, structList.length); k++) endingByMeasure[k] = n;
		}
	});

	let measureIdx = -1;
	for (const measureMatch of melodyStaff.matchAll(/<Measure[^>]*>[\s\S]*?<\/Measure>/g)) {
		const block = measureMatch[0];
		measureIdx++;
		const struct = structuralBlocks?.[measureIdx] ?? block;

		// An irregular measure declares its actual length in the len attribute.
		// The one musically common case is the ANACRUSIS: a short first
		// measure whose notes lead into bar 2's downbeat. The model has no
		// partial bars, so the pickup is right-aligned inside a full first bar
		// (leading rests take up the slack) — downbeats stay downbeats.
		//
		// len= alone does NOT mean anacrusis: split measures get it too. True
		// pickups also carry the exclude-from-measure-count flag, serialized
		// as an <irregular> child — that is the discriminator.
		const lenMatch = /len="(\d+)\/(\d+)"/.exec(block.slice(0, block.indexOf('>')));
		const actualLen: Fraction | null = lenMatch
			? [Number(lenMatch[1]), Number(lenMatch[2])]
			: null;
		// A TimeSig inside this measure applies from its start — peek so the
		// pickup pads against the real meter, not the previous barLength.
		const sigN = xmlText(block, 'sigN');
		const sigD = xmlText(block, 'sigD');
		const nominal: Fraction = sigN && sigD ? [Number(sigN), Number(sigD)] : barLength;

		let pad: Fraction = [0, 1];
		if (actualLen && compareFractions(actualLen, nominal) !== 0) {
			const shortFirst = measures.length === 0 && compareFractions(actualLen, nominal) < 0;
			if (shortFirst && block.includes('<irregular') && sigN && sigD) {
				pad = subtractFractions(nominal, actualLen);
			} else if (shortFirst) {
				warnOnce('A short first bar was imported as a full bar — for a pickup, tick "Exclude from measure count" in MuseScore\'s bar properties and re-export.');
			} else {
				warnOnce('An irregular measure length was imported as a full bar — review the rhythm placement.');
			}
		}

		const structMarkBlock =
			struct !== block ? /<RehearsalMark[\s>][\s\S]*?<\/RehearsalMark>/.exec(struct)?.[0] : undefined;
		const info: MeasureInfo = {
			startOffset: measureStart,
			length: nominal,
			rehearsalMark: structMarkBlock ? plainText(structMarkBlock, 'text') : null,
			startRepeat: block.includes('<startRepeat') || struct.includes('<startRepeat'),
			endRepeat: block.includes('<endRepeat') || struct.includes('<endRepeat'),
			pickup: pad[0] > 0,
			ending: endingByMeasure[measureIdx]
		};

		const voice = xmlText(block, 'voice');
		let cursor = addFractions(measureStart, pad);
		if (voice) {
			// Spanner is matched (and discarded) so that the <location> inside a
			// voice-level slur/text-line/hairpin's <next>/<prev> — spanner
			// ADDRESSING, not time — never reads as a cursor jump. Bare
			// voice-level <location> elements remain genuine jumps.
			const elements = voice.matchAll(
				/<(KeySig|TimeSig|RehearsalMark|SystemText|Tempo|Harmony|Chord|Rest|Tuplet|Spanner|location)\b[^>]*>[\s\S]*?<\/\1>|<endTuplet\/>/g
			);
			for (const el of elements) {
				const tag = el[1] ?? 'endTuplet';
				const body = el[0];
				switch (tag) {
					case 'KeySig': {
						const fifths = xmlText(body, 'concertKey') ?? xmlText(body, 'accidental');
						if (fifths !== null && key === null) key = fifthsToKey(Number(fifths));
						break;
					}
					case 'TimeSig': {
						const n = Number(xmlText(body, 'sigN') ?? '4');
						const d = Number(xmlText(body, 'sigD') ?? '4');
						if (timeSignature === null) {
							timeSignature = [n, d];
							barLength = [n, d];
						} else if (timeSignature[0] !== n || timeSignature[1] !== d) {
							warnOnce('Time signature changes are not supported — bars after the change may be misaligned.');
							barLength = [n, d];
						}
						break;
					}
					case 'RehearsalMark':
						info.rehearsalMark = plainText(body, 'text');
						break;
					case 'SystemText':
					case 'Tempo':
						style ??= plainText(body, 'text') ?? undefined;
						break;
					case 'Tuplet': {
						const normal = Number(xmlText(body, 'normalNotes') ?? '0');
						const actual = Number(xmlText(body, 'actualNotes') ?? '0');
						tupletStack.push(normal > 0 && actual > 0 ? [normal, actual] : [1, 1]);
						break;
					}
					case 'endTuplet':
						tupletStack.pop();
						break;
					case 'location': {
						const shift = parseFractionText(xmlText(body, 'fractions'));
						if (shift) cursor = addFractions(cursor, shift);
						break;
					}
					case 'Harmony': {
						const text = harmonyText(body, transpose, warnOnce);
						if (text !== null) {
							// Chord symbols are beat-granular in the editor, and a
							// chord with no note to attach to (e.g. over a rest bar)
							// can be anchored at an arbitrary drag-placed "time tick".
							// Snap every anchor down to its containing beat: sub-beat
							// chords would be unreachable in the editor and fragment
							// the side-by-side rest layout.
							harmonies.push({ offset: floorToBeat(cursor, nominal[1]), text });
						}
						break;
					}
					case 'Rest': {
						const dur = resolveDuration(body, barLength, null);
						if (dur) cursor = addFractions(cursor, dur);
						break;
					}
					case 'Chord': {
						if (/<(acciaccatura|appoggiatura|grace\d)/.test(body)) {
							warnOnce('Grace notes are not imported.');
							break;
						}
						const ratio = tupletStack.length
							? tupletStack.reduce(multiplyFractions, [1, 1] as Fraction)
							: null;
						const dur = resolveDuration(body, barLength, ratio);
						if (!dur) break;
						const note = topNote(body);
						if (note) {
							notes.push({
								pitch: note.pitch,
								duration: dur,
								offset: cursor,
								...(note.tied ? { tied: true } : {})
							});
						}
						cursor = addFractions(cursor, dur);
						break;
					}
				}
			}
		}

		measures.push(info);
		measureStart = addFractions(measureStart, nominal);
	}

	const sections = buildSections(measures, notes, harmonies, warnOnce);

	const sheet: LeadSheet = {
		id: '',
		title,
		...(composer ? { composer } : {}),
		key: key ?? 'C',
		timeSignature: timeSignature ?? [4, 4],
		...(style ? { style } : {}),
		tags: [],
		sections,
		source: 'imported-musescore'
	};
	return { sheets: [sheet], warnings, declaredTransposition: transpose };
}

/** Highest note of the chord + whether it starts a tie. */
function topNote(chordBlock: string): { pitch: number; tied: boolean } | null {
	let best: { pitch: number; tied: boolean } | null = null;
	for (const noteMatch of chordBlock.matchAll(/<Note>[\s\S]*?<\/Note>/g)) {
		const pitch = Number(xmlText(noteMatch[0], 'pitch') ?? 'NaN');
		if (!Number.isFinite(pitch)) continue;
		if (best === null || pitch > best.pitch) {
			const tied = /<Spanner type="Tie">[\s\S]*?<next>/.test(noteMatch[0]);
			best = { pitch, tied };
		}
	}
	return best;
}

/** Harmony element → concert-pitch chord text, or null to skip. */
function harmonyText(
	body: string,
	transpose: number,
	warnOnce: (msg: string) => void
): string | null {
	const rootTpc = xmlText(body, 'root');
	if (rootTpc === null) {
		warnOnce('Skipped a chord symbol without a root (e.g. a Roman-numeral or N.C. marking).');
		return null;
	}
	const toConcert = (tpc: number): string =>
		PITCH_CLASSES[(tpcToPitchClass(tpc) + (transpose % 12) + 12) % 12];
	const root = toConcert(Number(rootTpc));
	// MuseScore writes alterations in optional parentheses — "7(b9)" — which
	// our chord parser doesn't accept.
	const name = (plainText(body, 'name') ?? '').replace(/[()]/g, '');
	const bassTpc = xmlText(body, 'bass');
	const bass = bassTpc !== null ? `/${toConcert(Number(bassTpc))}` : '';
	return `${root}${name}${bass}`;
}

interface SectionBuilder {
	/** Rehearsal-mark label, or null until an auto letter is assigned. */
	label: string | null;
	/** True for the lone anacrusis section (unlabeled, outside repeats). */
	pickup: boolean;
	/** Volta ending number, when this section IS an ending. */
	ending?: 1 | 2;
	/** Ending sections continue the body — they inherit its label. */
	inheritLabel: boolean;
	firstMeasure: number;
	measureCount: number;
	startRepeat: boolean;
	endRepeat: boolean;
	startOffset: Fraction;
	endOffset: Fraction;
}

function buildSections(
	measures: MeasureInfo[],
	notes: NoteEvent[],
	harmonies: HarmonyEvent[],
	warnOnce: (msg: string) => void
): LeadSheetSection[] {
	// Sections split at rehearsal marks AND at repeat barlines: a |: opens a
	// section and a :| closes one, so a simple repeat is always representable
	// (sections repeat as whole units). Unmarked sections get running letters.
	const startsSection = (i: number): boolean =>
		i === 0 ||
		measures[i].rehearsalMark !== null ||
		measures[i].startRepeat ||
		measures[i - 1].endRepeat ||
		measures[i].ending !== measures[i - 1].ending;

	const builders: SectionBuilder[] = [];
	measures.forEach((m, i) => {
		if (startsSection(i)) {
			builders.push({
				label: m.rehearsalMark,
				pickup: false,
				ending: m.ending,
				inheritLabel: m.ending !== undefined && m.rehearsalMark === null,
				firstMeasure: i,
				measureCount: 0,
				startRepeat: false,
				endRepeat: false,
				startOffset: m.startOffset,
				endOffset: m.startOffset
			});
		}
		const current = builders[builders.length - 1];
		current.measureCount += 1;
		current.endOffset = addFractions(m.startOffset, m.length);
		// Both flags land on section boundaries by construction now.
		if (m.startRepeat) current.startRepeat = true;
		if (m.endRepeat) current.endRepeat = true;
	});

	// A lone anacrusis bar ahead of the first section boundary sits outside
	// the form — it stays UNLABELED (no boxed marker) and consumes no letter.
	if (
		measures[0]?.pickup &&
		measures[0].rehearsalMark === null &&
		builders.length > 1 &&
		builders[0].measureCount === 1
	) {
		builders[0].label = '';
		builders[0].pickup = true;
	}

	// Unmarked front matter ahead of the first real rehearsal mark carries no
	// letter either — it's the pickup/intro bar of the form the marks define,
	// and a boxed 'C' ahead of 'A' reads as an error, not a section.
	const hasMarks = builders.some((b) => b.label !== null && b.label !== '');
	if (hasMarks && builders[0] && builders[0].label === null && !builders[0].inheritLabel) {
		builders[0].label = '';
	}

	// A lone :| with no |: means "repeat from the top" (or from the bar after
	// the previous :|) — synthesize the opening so playback matches the page.
	// "The top" is the top of the FORM: pickup/front-matter bars stay outside.
	let spanStart = builders[0]?.label === '' ? 1 : 0;
	let hasStart = false;
	builders.forEach((b, i) => {
		if (b.startRepeat) hasStart = true;
		if (b.endRepeat) {
			if (!hasStart) builders[spanStart].startRepeat = true;
			spanStart = i + 1;
			hasStart = false;
		}
	});

	// Unmarked sections get the next letter NOT already taken by a rehearsal
	// mark or an earlier auto label — a colliding duplicate would be
	// suppressed by the notation's consecutive-part-label logic.
	const usedLabels = new Set(builders.map((b) => b.label).filter((l) => l !== null));
	for (const b of builders) {
		if (b.label !== null || b.inheritLabel) continue;
		let code = 65; // 'A'
		while (usedLabels.has(String.fromCharCode(code))) code++;
		b.label = String.fromCharCode(code);
		usedLabels.add(b.label);
	}
	// Ending sections continue their body's material — same label, no letter.
	builders.forEach((b, i) => {
		if (b.inheritLabel && b.label === null) b.label = builders[i - 1]?.label ?? 'A';
	});

	return builders.map((b) => {
		const inRange = (offset: Fraction): boolean =>
			compareFractions(offset, b.startOffset) >= 0 && compareFractions(offset, b.endOffset) < 0;

		const sectionNotes: Note[] = notes
			.filter((n) => inRange(n.offset))
			.map((n) => ({ ...n, offset: subtractFractions(n.offset, b.startOffset) }));

		// Later declaration wins when two changes share an anchor (e.g. a
		// snapped pickup chord landing on an already-occupied beat) — avoids
		// zero-duration segments.
		const changes = harmonies
			.filter((h) => inRange(h.offset))
			.filter((h, i, arr) => i + 1 === arr.length || compareFractions(arr[i + 1].offset, h.offset) !== 0);

		// Carry the in-effect chord across the section boundary: a section
		// opened by a repeat barline (or a mark placed mid-harmony) restates
		// the active chord at its start so coverage survives the split.
		const active = harmonies.filter((h) => compareFractions(h.offset, b.startOffset) < 0).pop();
		if (active && (changes.length === 0 || compareFractions(changes[0].offset, b.startOffset) > 0)) {
			changes.unshift({ offset: b.startOffset, text: active.text });
		}
		const harmony = changes.flatMap((h, i) => {
			const end = i + 1 < changes.length ? changes[i + 1].offset : b.endOffset;
			const duration = subtractFractions(end, h.offset);
			const segment = harmonicSegmentFromSymbol(
				h.text,
				subtractFractions(h.offset, b.startOffset),
				duration
			);
			if (!segment) {
				warnOnce(`Chord "${h.text}" was not recognized and was skipped.`);
				return [];
			}
			return [segment];
		});

		return {
			label: b.label ?? 'A',
			bars: b.measureCount,
			...(b.startRepeat ? { repeatStart: true } : {}),
			...(b.endRepeat ? { repeatEnd: true } : {}),
			...(b.ending ? { ending: b.ending } : {}),
			notes: sectionNotes,
			harmony
		};
	});
}

// ─── File dispatch (.mscz zip / .mscx xml) ──────────────────────────────

export interface MuseScoreImportInput {
	name: string;
	bytes: Uint8Array;
}

export async function parseMuseScoreFile(
	input: MuseScoreImportInput,
	preferred?: PreferredInstrument
): Promise<MuseScoreImportResult> {
	const lower = input.name.toLowerCase();
	if (lower.endsWith('.mscx')) {
		return parseMscx(new TextDecoder().decode(input.bytes), preferred);
	}
	if (lower.endsWith('.mscz')) {
		try {
			const xml = await extractMscxFromZip(input.bytes);
			if (xml === null) {
				return {
					sheets: [],
					warnings: ['No .mscx score found inside the .mscz archive.'],
					declaredTransposition: 0
				};
			}
			return parseMscx(xml, preferred);
		} catch (err) {
			return {
				sheets: [],
				warnings: [
					`Failed to read the .mscz archive (${err instanceof Error ? err.message : 'unknown error'}).`
				],
				declaredTransposition: 0
			};
		}
	}
	return {
		sheets: [],
		warnings: [`Unsupported file type "${input.name}" — expected .mscz or .mscx.`],
		declaredTransposition: 0
	};
}

/**
 * Minimal ZIP reader: enough for .mscz (stored or deflate entries, no
 * zip64). Returns the root-level .mscx entry's text (Excerpts/ holds
 * per-part extracts we don't want).
 */
async function extractMscxFromZip(bytes: Uint8Array): Promise<string | null> {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

	// End-of-central-directory record: scan back for its signature.
	let eocd = -1;
	for (let i = bytes.length - 22; i >= 0; i--) {
		if (view.getUint32(i, true) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new Error('not a zip archive');
	const entryCount = view.getUint16(eocd + 10, true);
	let offset = view.getUint32(eocd + 16, true);

	const entries: { name: string; method: number; compSize: number; localOffset: number }[] = [];
	for (let i = 0; i < entryCount; i++) {
		if (view.getUint32(offset, true) !== 0x02014b50) break;
		const method = view.getUint16(offset + 10, true);
		const compSize = view.getUint32(offset + 20, true);
		const nameLen = view.getUint16(offset + 28, true);
		const extraLen = view.getUint16(offset + 30, true);
		const commentLen = view.getUint16(offset + 32, true);
		const localOffset = view.getUint32(offset + 42, true);
		const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
		entries.push({ name, method, compSize, localOffset });
		offset += 46 + nameLen + extraLen + commentLen;
	}

	const candidates = entries.filter((e) => e.name.toLowerCase().endsWith('.mscx'));
	const entry = candidates.find((e) => !e.name.includes('/')) ?? candidates[0];
	if (!entry) return null;

	// Local header carries its own name/extra lengths — they can differ
	// from the central directory's.
	const lh = entry.localOffset;
	if (view.getUint32(lh, true) !== 0x04034b50) throw new Error('corrupt local header');
	const nameLen = view.getUint16(lh + 26, true);
	const extraLen = view.getUint16(lh + 28, true);
	const dataStart = lh + 30 + nameLen + extraLen;
	const data = bytes.subarray(dataStart, dataStart + entry.compSize);

	if (entry.method === 0) return new TextDecoder().decode(data);
	if (entry.method === 8) {
		const stream = new Blob([data.slice()]).stream().pipeThrough(
			new DecompressionStream('deflate-raw')
		);
		return await new Response(stream).text();
	}
	throw new Error(`unsupported compression method ${entry.method}`);
}

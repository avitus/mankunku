import type { Fraction, HarmonicSegment, PitchClass } from '$lib/types/music';
import type { Tune } from '$lib/types/tune';
import { addFractions, multiplyFraction, subtractFractions } from '$lib/music/intervals';
import { harmonicSegmentFromSymbol, scaleIdForQuality } from '$lib/leadsheets/segment-from-symbol';

/**
 * Band-in-a-Box importer.
 *
 * Two paths behind one interface:
 *  - `parseBiabFile` — best-effort reader for the proprietary .SGU/.MGU
 *    binary, following the layout reverse-engineered by MuseScore's
 *    importexport/bb module (version byte, pascal title, style/key/tempo,
 *    then RLE streams of chord-extension ids and packed root/bass bytes
 *    over a 255-bar × 4-beat grid);
 *  - `parseBiabMusicXml` — fallback for BIAB's MusicXML export, reading
 *    <harmony> elements (well-specified, and the recommended route when the
 *    binary read comes out wrong).
 *
 * Both emit harmony-only LeadSheets (melody left empty for later entry).
 */

export interface BiabImportResult {
	sheets: Tune[];
	warnings: string[];
}

// ─── Binary (.SGU/.MGU) ─────────────────────────────────────────────────

/** Style number → display name + time signature (MuseScore bb.h table). */
const BIAB_STYLES: { name: string; timeSignature: [number, number] }[] = [
	{ name: 'Jazz Swing', timeSignature: [4, 4] },
	{ name: 'Country 12/8', timeSignature: [12, 8] },
	{ name: 'Country 4/4', timeSignature: [4, 4] },
	{ name: 'Bossa Nova', timeSignature: [4, 4] },
	{ name: 'Ethnic', timeSignature: [4, 4] },
	{ name: 'Blues Shuffle', timeSignature: [4, 4] },
	{ name: 'Blues Straight', timeSignature: [4, 4] },
	{ name: 'Waltz', timeSignature: [3, 4] },
	{ name: 'Pop Ballad', timeSignature: [4, 4] },
	{ name: 'Rock Shuffle', timeSignature: [4, 4] },
	{ name: 'Lite Rock', timeSignature: [4, 4] },
	{ name: 'Medium Rock', timeSignature: [4, 4] },
	{ name: 'Heavy Rock', timeSignature: [4, 4] },
	{ name: 'Miami Rock', timeSignature: [4, 4] },
	{ name: 'Milly Pop', timeSignature: [4, 4] },
	{ name: 'Funk', timeSignature: [4, 4] },
	{ name: 'Jazz Waltz', timeSignature: [3, 4] },
	{ name: 'Rhumba', timeSignature: [4, 4] },
	{ name: 'Cha Cha', timeSignature: [4, 4] },
	{ name: 'Bouncy', timeSignature: [4, 4] },
	{ name: 'Irish', timeSignature: [4, 4] },
	{ name: 'Pop Ballad 12/8', timeSignature: [12, 8] },
	{ name: 'Country 12/8 old', timeSignature: [12, 8] },
	{ name: 'Reggae', timeSignature: [4, 4] }
];

/** Root index 1-17 → note name (BIAB numbering), canonical spellings. */
const BIAB_ROOTS = [
	'', 'C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B',
	'Db', 'Eb', 'F#', 'Ab', 'Bb'
];

/**
 * Chord-type id → suffix text (subset of the 176-entry table shipped with
 * MuseScore's BIAB-compatible chord list, normalized to spellings our
 * chord-symbol parser accepts). Unlisted or unparseable ids degrade to a
 * coarse quality with the raw text preserved.
 */
const BIAB_CHORD_SUFFIX: Record<number, string> = {
	1: '', 2: '', 4: 'aug', 5: '6', 6: 'maj7', 7: 'maj9', 8: 'maj9#11', 9: 'maj13#11',
	10: 'maj13', 12: 'aug', 13: 'maj7#5', 14: '69', 15: 'sus2', 16: 'm', 17: 'm#5',
	18: 'mMaj7', 19: 'm7', 20: 'm9', 21: 'm11', 22: 'm13', 23: 'm6', 25: 'm7#5',
	26: 'm69', 27: 'maj7#11', 28: 'maj7#11', 29: 'maj7b5', 32: 'm7b5', 33: 'dim',
	34: 'm9b5', 56: '7#5', 57: '9#5', 58: '13#5', 59: '7', 60: '7', 64: '7', 65: '13',
	66: '7b13', 67: '7#11', 68: '13#11', 69: '7#11b13', 70: '9', 72: '9b13', 73: '9#11',
	74: '13#11', 75: '9#11b13', 76: '7b9', 77: '13b9', 78: '7b9b13', 79: '7b9#11',
	80: '13b9#11', 81: '7b9#11b13', 82: '7#9', 83: '13#9', 84: '7#9b13', 85: '9#11',
	86: '13#9#11', 87: '7#9#11b13', 88: '7b5', 89: '13b5', 90: '7b5b13', 91: '9b5',
	92: '9b5b13', 93: '7b5b9', 94: '13b5b9', 95: '7b5b9b13', 96: '7b5#9', 97: '13b5#9',
	98: '7b5#9b13', 99: '7#5', 100: '13#5', 101: '7#5#11', 102: '13#5#11', 103: '9#5',
	104: '9#5#11', 105: '7#5b9', 106: '13#5b9', 107: '7#5b9#11', 108: '13#5b9#11',
	109: '7#5#9', 110: '13#5#9#11', 111: '7#5#9#11', 112: '13#5#9#11', 113: '7alt',
	128: '7sus', 129: '13sus', 130: '7susb13', 131: '7sus#11', 132: '13sus#11',
	133: '7sus#11b13', 134: '9sus', 135: '9susb13', 136: '9sus#11', 137: '13sus#11',
	139: '9sus#11b13', 140: '7susb9', 141: '13susb9', 142: '7susb9b13', 143: '7susb9#11',
	144: '13susb9#11', 145: '7susb9#11b13', 146: '7sus#9', 147: '13sus#9', 148: '7sus#9b13',
	152: '7susb5', 153: '13susb5', 155: '9susb5', 163: '7sus#5', 167: '9sus#5',
	169: '7sus#5b9', 173: '7sus#5#9', 177: 'sus4', 184: 'sus4', 185: 'dim7', 186: 'sus2',
	191: '69', 192: 'sus4', 193: '11', 194: 'maj11', 198: 'madd9', 201: 'm11b5',
	203: '9#5', 205: 'aug7', 206: '9#5', 207: '13#5', 210: 'maj7#11', 211: 'maj9#5',
	212: 'maj7#9', 213: 'add9', 214: 'add9', 220: 'm7b9', 221: 'm7b13', 223: 'madd9',
	241: 'maj7b13'
};

interface BinaryChord {
	beat: number;
	extension: number;
	root: number;
	bass: number;
}

class ByteReader {
	private idx = 0;
	constructor(private readonly bytes: Uint8Array) {}
	get position(): number {
		return this.idx;
	}
	get remaining(): number {
		return this.bytes.length - this.idx;
	}
	u8(): number {
		if (this.idx >= this.bytes.length) throw new Error('unexpected end of file');
		return this.bytes[this.idx++];
	}
	u16le(): number {
		return this.u8() + (this.u8() << 8);
	}
	text(length: number): string {
		let s = '';
		for (let i = 0; i < length; i++) s += String.fromCharCode(this.u8());
		return s;
	}
}

const MAX_BARS = 255;

/** Build a segment from a coarse quality when the suffix text won't parse. */
function fallbackSegment(
	rootName: string,
	bassName: string | undefined,
	rawText: string,
	startOffset: Fraction,
	duration: Fraction
): HarmonicSegment | null {
	const root = normalizePitchClass(rootName);
	if (!root) return null;
	const suffix = rawText.slice(rootName.length);
	const quality = /^m(?!aj)/i.test(suffix) ? 'min7' : /7|9|11|13/.test(suffix) ? '7' : 'maj6';
	const bass = bassName ? normalizePitchClass(bassName) : undefined;
	return {
		chord: { root, quality, ...(bass ? { bass } : {}) },
		scaleId: scaleIdForQuality(quality),
		startOffset,
		duration,
		symbol: rawText
	};
}

const CANONICAL: Record<string, PitchClass> = {
	C: 'C', 'C#': 'Db', Db: 'Db', D: 'D', 'D#': 'Eb', Eb: 'Eb', E: 'E', F: 'F',
	'F#': 'F#', Gb: 'F#', G: 'G', 'G#': 'Ab', Ab: 'Ab', A: 'A', 'A#': 'Bb', Bb: 'Bb', B: 'B'
};

function normalizePitchClass(name: string): PitchClass | null {
	return CANONICAL[name] ?? null;
}

/** Parse a .SGU/.MGU binary. Best-effort: failures degrade to warnings. */
export function parseBiabFile(bytes: Uint8Array): BiabImportResult {
	const warnings: string[] = [];
	const r = new ByteReader(bytes);
	try {
		const version = r.u8();
		if (version < 0x43 || version > 0x49) {
			return {
				sheets: [],
				warnings: [
					`Unrecognized Band-in-a-Box file version 0x${version.toString(16)} — try the MusicXML export instead.`
				]
			};
		}

		const title = r.text(r.u8());
		r.u8();
		r.u8(); // two undocumented pad bytes
		const styleIdx = r.u8() - 1;
		const style = BIAB_STYLES[styleIdx];
		if (!style) {
			return {
				sheets: [],
				warnings: [`Unknown Band-in-a-Box style ${styleIdx + 1} — try the MusicXML export instead.`]
			};
		}
		const keyByte = r.u8();
		r.u16le(); // tempo (not represented on Tune)

		const rootIdx = keyByte >= 18 ? keyByte - 17 : keyByte;
		const key = normalizePitchClass(BIAB_ROOTS[rootIdx] ?? '') ?? 'C';
		if (!BIAB_ROOTS[rootIdx]) warnings.push(`Unknown key byte ${keyByte}; defaulting to C.`);

		// Bar-type stream: part markers. A marked bar starts a new form
		// section; the value is the substyle (1 = 'a', 2 = 'b', …), which is
		// how BIAB denotes a style change — e.g. the B section of an AABA
		// form carries a 'b' marker on its first bar.
		const markers = new Map<number, string>(); // 0-based bar → section label
		let bar = r.u8();
		while (bar < MAX_BARS) {
			const val = r.u8();
			if (val === 0) bar += r.u8();
			else {
				const letter =
					val >= 1 && val <= 26 ? String.fromCharCode(64 + val) : 'A';
				markers.set(bar - 1, letter);
				bar++;
			}
		}

		// Chord extension ids per beat cell.
		const chords: BinaryChord[] = [];
		for (let beat = 0; beat < MAX_BARS * 4; ) {
			const val = r.u8();
			if (val === 0) beat += r.u8();
			else {
				chords.push({ beat, extension: val, root: 0, bass: 0 });
				beat++;
			}
		}

		// Chord roots (packed root + bass) per beat cell.
		let idx = 0;
		let maxBeat = 0;
		for (let beat = 0; beat < MAX_BARS * 4; ) {
			const val = r.u8();
			if (val === 0) beat += r.u8();
			else {
				const root = val % 18;
				let bass = ((root - 1 + Math.floor(val / 18)) % 18) + 1;
				if (root === bass) bass = 0;
				if (idx < chords.length && chords[idx].beat === beat) {
					chords[idx].root = root;
					chords[idx].bass = bass;
					idx++;
				} else {
					warnings.push('Chord root/extension streams disagree; some chords skipped.');
				}
				if (beat > maxBeat) maxBeat = beat;
				beat++;
			}
		}
		if (idx !== chords.length) {
			warnings.push('Chord extension count exceeds root count; trailing chords dropped.');
			chords.length = idx;
		}

		const [tsNum, tsDen] = style.timeSignature;
		const bars = Math.floor((maxBeat + 4 - 1) / 4) + 1;
		const barDuration: Fraction = [tsNum, tsDen];

		// Chorus markers follow the streams as [start][end][repeats]. NB: the
		// first byte IS startChorus — MuseScore's importer skips a leading
		// 0x01 as a "pad", which eats the start marker whenever the chorus
		// starts at bar 1 (i.e. almost always) and loses the repeat. Some
		// files do carry a pad, so read both interpretations and keep the
		// coherent one.
		const plausibleChorus = (s: number, e: number, rep: number): boolean =>
			s >= 1 && e > s && e <= bars && rep >= 1 && rep <= 40;
		let chorus: { start: number; end: number; repeats: number } | null = null;
		try {
			const c0 = r.u8();
			const c1 = r.u8();
			const c2 = r.u8();
			if (plausibleChorus(c0, c1, c2)) {
				chorus = { start: c0, end: c1, repeats: c2 };
			} else {
				const c3 = r.u8();
				if (plausibleChorus(c1, c2, c3)) chorus = { start: c1, end: c2, repeats: c3 };
			}
		} catch {
			/* truncated file — no chorus markers */
		}

		// ── Sections from part markers ──────────────────────────────────
		const boundaries = [...markers.keys()].filter((b) => b < bars).sort((a, b) => a - b);
		if (boundaries.length === 0 || boundaries[0] !== 0) boundaries.unshift(0);

		const sections = boundaries.map((startBar, i) => {
			const nextStart = boundaries[i + 1] ?? bars;
			const section: import('$lib/types/tune').TuneSection = {
				label: markers.get(startBar) ?? 'A',
				bars: nextStart - startBar,
				notes: [],
				harmony: []
			};
			return { startBar, endBar: nextStart - 1, section };
		});

		if (chorus && chorus.repeats >= 2) {
			const opening = sections.find((s) => s.startBar === chorus!.start - 1);
			const closing = sections.find((s) => s.endBar === chorus!.end - 1);
			if (opening && closing) {
				opening.section.repeatStart = true;
				closing.section.repeatEnd = true;
			} else {
				warnings.push(
					`Chorus repeat (bars ${chorus.start}-${chorus.end}) did not align with the part markers; repeat omitted.`
				);
			}
		}

		// ── Chords, section-local, durations to the next change or section end ──
		const sectionFor = (barIdx: number) =>
			sections.find((s) => barIdx >= s.startBar && barIdx <= s.endBar);

		chords.forEach((c, i) => {
			const barIdx = Math.floor(c.beat / 4);
			const home = sectionFor(barIdx);
			if (!home) return;
			const localBar = barIdx - home.startBar;
			const offset = addFractions(
				multiplyFraction(barDuration, localBar),
				multiplyFraction([barDuration[0], barDuration[1] * 4], c.beat % 4)
			);

			// Next chord within the same section, else the section end.
			const next = chords[i + 1];
			const nextBarIdx = next ? Math.floor(next.beat / 4) : -1;
			const nextOffset =
				next && nextBarIdx <= home.endBar
					? addFractions(
							multiplyFraction(barDuration, nextBarIdx - home.startBar),
							multiplyFraction([barDuration[0], barDuration[1] * 4], next.beat % 4)
						)
					: multiplyFraction(barDuration, home.section.bars);
			const duration = subtractFractions(nextOffset, offset);

			const rootName = BIAB_ROOTS[c.root];
			if (!rootName) {
				warnings.push(`Skipped chord with unknown root index ${c.root}.`);
				return;
			}
			const bassName = c.bass > 0 ? BIAB_ROOTS[c.bass] : undefined;
			const suffix = BIAB_CHORD_SUFFIX[c.extension];
			const text = `${rootName}${suffix ?? `?${c.extension}`}${bassName ? `/${bassName}` : ''}`;

			const segment =
				suffix !== undefined ? harmonicSegmentFromSymbol(text, offset, duration) : null;
			if (segment) {
				home.section.harmony.push(segment);
			} else {
				const fallback = fallbackSegment(rootName, bassName, text, offset, duration);
				if (fallback) {
					home.section.harmony.push(fallback);
					warnings.push(`Chord type ${c.extension} approximated as "${fallback.symbol}".`);
				}
			}
		});

		const sheet: Tune = {
			id: '',
			title: title || 'Untitled',
			key,
			timeSignature: style.timeSignature,
			style: style.name,
			tags: [],
			sections: sections.map((s) => s.section),
			source: 'imported-biab'
		};
		return { sheets: [sheet], warnings };
	} catch (err) {
		return {
			sheets: [],
			warnings: [
				`Failed to read Band-in-a-Box file (${err instanceof Error ? err.message : 'unknown error'}) — try the MusicXML export instead.`
			]
		};
	}
}

// ─── MusicXML fallback ──────────────────────────────────────────────────

/** MusicXML <kind> → chord suffix accepted by the chord-symbol parser. */
const XML_KIND_SUFFIX: Record<string, string> = {
	major: '', minor: 'm', augmented: 'aug', diminished: 'dim',
	dominant: '7', 'dominant-seventh': '7', 'major-seventh': 'maj7',
	'minor-seventh': 'm7', 'diminished-seventh': 'dim7',
	'augmented-seventh': 'aug7', 'half-diminished': 'm7b5',
	'major-minor': 'mMaj7', 'minor-major': 'mMaj7',
	'major-sixth': '6', 'minor-sixth': 'm6',
	'dominant-ninth': '9', 'major-ninth': 'maj9', 'minor-ninth': 'm9',
	'dominant-11th': '11', 'major-11th': 'maj11', 'minor-11th': 'm11',
	'dominant-13th': '13', 'major-13th': 'maj13', 'minor-13th': 'm13',
	'suspended-fourth': 'sus4', 'suspended-second': 'sus2'
};

function xmlTag(source: string, tag: string): string | null {
	const m = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`).exec(source);
	return m ? m[1].trim() : null;
}

function xmlNoteName(step: string | null, alter: string | null): string | null {
	if (!step) return null;
	const alterNum = alter ? Number(alter) : 0;
	return `${step}${alterNum === -1 ? 'b' : alterNum === 1 ? '#' : ''}`;
}

/** Parse a BIAB-exported MusicXML document's harmony track. */
export function parseBiabMusicXml(xml: string): BiabImportResult {
	const warnings: string[] = [];

	const title =
		xmlTag(xml, 'work-title') ?? xmlTag(xml, 'movement-title') ?? 'Untitled';
	const composerMatch = /<creator[^>]*type="composer"[^>]*>([^<]*)<\/creator>/.exec(xml);

	let timeSignature: [number, number] = [4, 4];
	const timeMatch = /<time[^>]*>[\s\S]*?<beats>(\d+)<\/beats>[\s\S]*?<beat-type>(\d+)<\/beat-type>/.exec(xml);
	if (timeMatch) timeSignature = [Number(timeMatch[1]), Number(timeMatch[2])];
	const barDuration: Fraction = [timeSignature[0], timeSignature[1]];

	const measures = [...xml.matchAll(/<measure[^>]*>([\s\S]*?)<\/measure>/g)].map((m) => m[1]);
	if (measures.length === 0) {
		return { sheets: [], warnings: ['No <measure> elements found — is this a MusicXML file?'] };
	}

	const placed: { offset: Fraction; text: string }[] = [];
	measures.forEach((measure, barIdx) => {
		const harmonies = [...measure.matchAll(/<harmony[^>]*>([\s\S]*?)<\/harmony>/g)].map((m) => m[1]);
		const barStart = multiplyFraction(barDuration, barIdx);
		harmonies.forEach((h, j) => {
			const rootName = xmlNoteName(xmlTag(h, 'root-step'), xmlTag(h, 'root-alter'));
			if (!rootName) {
				warnings.push(`Bar ${barIdx + 1}: harmony without a root skipped.`);
				return;
			}
			const kind = xmlTag(h, 'kind') ?? 'major';
			const suffix = XML_KIND_SUFFIX[kind];
			if (suffix === undefined) {
				warnings.push(`Bar ${barIdx + 1}: unsupported chord kind "${kind}" approximated as a triad.`);
			}
			const bassName = xmlNoteName(xmlTag(h, 'bass-step'), xmlTag(h, 'bass-alter'));
			const text = `${rootName}${suffix ?? ''}${bassName ? `/${bassName}` : ''}`;
			const within = multiplyFraction([barDuration[0], barDuration[1] * harmonies.length], j);
			placed.push({ offset: addFractions(barStart, within), text });
		});
	});

	const sectionEnd = multiplyFraction(barDuration, measures.length);
	const harmony: HarmonicSegment[] = [];
	placed.forEach((p, idx) => {
		const next = idx + 1 < placed.length ? placed[idx + 1].offset : sectionEnd;
		const segment = harmonicSegmentFromSymbol(p.text, p.offset, subtractFractions(next, p.offset));
		if (segment) harmony.push(segment);
		else warnings.push(`Skipped unparseable chord "${p.text}".`);
	});

	const sheet: Tune = {
		id: '',
		title,
		key: harmony[0]?.chord.root ?? 'C',
		timeSignature,
		tags: [],
		sections: [{ label: 'A', bars: measures.length, notes: [], harmony }],
		source: 'imported-biab'
	};
	if (composerMatch) sheet.composer = composerMatch[1].trim();
	return { sheets: [sheet], warnings };
}

// ─── Dispatch ───────────────────────────────────────────────────────────

export interface BiabImportInput {
	name: string;
	bytes?: Uint8Array;
	text?: string;
}

/** Route a file to the binary or MusicXML parser by extension. */
export function importBandInABox(input: BiabImportInput): BiabImportResult {
	const lower = input.name.toLowerCase();
	if (/\.(sgu|mgu|mg[0-9u])$/.test(lower)) {
		if (!input.bytes) return { sheets: [], warnings: ['No file bytes provided.'] };
		return parseBiabFile(input.bytes);
	}
	if (/\.(xml|musicxml|txt)$/.test(lower)) {
		const text = input.text ?? (input.bytes ? new TextDecoder().decode(input.bytes) : '');
		if (!text) return { sheets: [], warnings: ['No file text provided.'] };
		return parseBiabMusicXml(text);
	}
	return {
		sheets: [],
		warnings: [
			`Unsupported file type "${input.name}" — expected .SGU/.MGU or a BIAB MusicXML export.`
		]
	};
}

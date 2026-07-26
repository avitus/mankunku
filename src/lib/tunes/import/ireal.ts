import type { Fraction, PitchClass } from '$lib/types/music';
import type { Tune, TuneSection } from '$lib/types/tune';
import { addFractions, multiplyFraction } from '$lib/music/intervals';
import { parseChordSymbol } from '$lib/music/chord-symbol';
import { harmonicSegmentFromSymbol } from '$lib/tunes/segment-from-symbol';

/**
 * iReal Pro importer — parses `irealbook://` (plain) and `irealb://`
 * (scrambled) share URLs into harmony-only Tunes (melody left empty for
 * later entry).
 *
 * Format knowledge from the published reverse-engineering in
 * pianosnake/ireal-reader and ironss/accompaniser (irealb_parser.lua):
 *  - songs are separated by `===`; a trailing part with no `=` is the
 *    playlist name;
 *  - fields are `=`-separated; after dropping blanks, 7-9 fields resolve as
 *    [title, composer, style, key, (transpose), music, (compStyle), bpm,
 *    repeats] with the music field marked by the `1r34LbKcu7` prefix;
 *  - irealb music is scrambled in 50-char chunks: positions 0-4 mirror-swap
 *    with 45-49 and 10-23 with 26-39; a trailing chunk stays untouched.
 */

const MUSIC_PREFIX = '1r34LbKcu7';

export interface IRealImportResult {
	sheets: Tune[];
	warnings: string[];
}

/** Undo iReal's 50-char-chunk scrambling (the transform is an involution). */
export function unscrambleIRealMusic(s: string): string {
	let result = '';
	while (s.length > 50) {
		const chunk = s.substring(0, 50);
		s = s.substring(50);
		result += s.length < 2 ? chunk : obfusc50(chunk);
	}
	return result + s;
}

function obfusc50(s: string): string {
	const out = s.split('');
	for (let i = 0; i < 5; i++) {
		out[49 - i] = s[i];
		out[i] = s[49 - i];
	}
	for (let i = 10; i < 24; i++) {
		out[49 - i] = s[i];
		out[i] = s[49 - i];
	}
	return out.join('');
}

const TIME_SIGNATURES: Record<string, [number, number]> = {
	T22: [2, 2], T32: [3, 2], T24: [2, 4], T34: [3, 4], T44: [4, 4],
	T54: [5, 4], T64: [6, 4], T74: [7, 4], T58: [5, 8], T68: [6, 8],
	T78: [7, 8], T98: [9, 8], T12: [12, 8]
};

const SECTION_LABELS: Record<string, string> = {
	A: 'A', B: 'B', C: 'C', D: 'D', v: 'Verse', i: 'Intro'
};

/** Characters that can appear inside an iReal chord quality/extension. */
const QUALITY_CHARS = /[-+^hob#0-9sudalt*]/;

interface RawBar {
	/** Chord texts (iReal spelling) in playing order within the bar. */
	chords: string[];
}

type MusicToken =
	| { kind: 'barline'; value: string }
	| { kind: 'label'; value: string }
	| { kind: 'timesig'; value: [number, number] }
	| { kind: 'ending'; value: number }
	| { kind: 'chord'; value: string }
	| { kind: 'cell'; value: string }; // x, r, p, n, s, l — cell-occupying markers

function tokenizeMusic(music: string, warnings: string[]): MusicToken[] {
	const tokens: MusicToken[] = [];
	let i = 0;
	while (i < music.length) {
		const c = music[i];
		if (c === '{' || c === '}' || c === '[' || c === ']' || c === '|' || c === 'Z') {
			tokens.push({ kind: 'barline', value: c });
			i++;
		} else if (c === '*' && i + 1 < music.length) {
			const label = SECTION_LABELS[music[i + 1]];
			if (label) tokens.push({ kind: 'label', value: label });
			i += 2;
		} else if (c === 'T' && TIME_SIGNATURES[music.slice(i, i + 3)]) {
			tokens.push({ kind: 'timesig', value: TIME_SIGNATURES[music.slice(i, i + 3)] });
			i += 3;
		} else if (c === 'N' && /[0-3]/.test(music[i + 1] ?? '')) {
			tokens.push({ kind: 'ending', value: Number(music[i + 1]) });
			i += 2;
		} else if (c === '<') {
			const end = music.indexOf('>', i);
			i = end < 0 ? music.length : end + 1;
		} else if (c === '(') {
			// Alternate chord suggestions render small in iReal — not part of
			// the primary harmony; skip.
			const end = music.indexOf(')', i);
			i = end < 0 ? music.length : end + 1;
		} else if (c === 'W') {
			// Root-only placeholder; swallow an attached slash bass too.
			i++;
			if (music[i] === '/' && /[A-G]/.test(music[i + 1] ?? '')) {
				i += /[#b]/.test(music[i + 2] ?? '') ? 3 : 2;
			}
		} else if ('xrpnsl'.includes(c)) {
			tokens.push({ kind: 'cell', value: c });
			i++;
		} else if (c === 'S' || c === 'Q' || c === 'f' || c === 'U' || c === 'Y') {
			i++; // segno/coda/fermata/end-marker/vertical space — render-only
		} else if (c === ' ' || c === ',' || c === '\n') {
			i++;
		} else if (/[A-G]/.test(c)) {
			let j = i + 1;
			if (/[#b]/.test(music[j] ?? '')) j++;
			while (j < music.length && QUALITY_CHARS.test(music[j])) j++;
			let text = music.slice(i, j);
			// Slash bass
			if (music[j] === '/' && /[A-G]/.test(music[j + 1] ?? '')) {
				let k = j + 2;
				if (/[#b]/.test(music[k] ?? '')) k++;
				text += music.slice(j, k);
				j = k;
			}
			tokens.push({ kind: 'chord', value: text });
			i = j;
		} else {
			warnings.push(`iReal: skipped unrecognized character '${c}'`);
			i++;
		}
	}
	return tokens;
}

/** Normalize iReal chord spellings to what `parseChordSymbol` accepts. */
function normalizeIRealChord(text: string): string {
	let t = text;
	// 'h' quality marker = half-diminished (e.g. Bh7 → Bø7).
	t = t.replace(/^([A-G][#b]?)h/, '$1ø');
	// Bare 'alt' implies a 7th (Calt → C7alt).
	t = t.replace(/^([A-G][#b]?)alt/, '$17alt');
	// Strip iReal's *...* render-style wrapper if present.
	t = t.replace(/\*[^*]*\*/g, '');
	return t;
}

interface SectionBuilder {
	label: string;
	repeatStart?: boolean;
	repeatEnd?: boolean;
	ending?: 1 | 2;
	bars: RawBar[];
}

/** Parse a music string into sections of raw bars. */
function parseMusicString(
	music: string,
	warnings: string[]
): { sections: SectionBuilder[]; timeSignature: [number, number] } {
	const tokens = tokenizeMusic(music, warnings);
	let timeSignature: [number, number] = [4, 4];
	let sawTimesig = false;

	const sections: SectionBuilder[] = [];
	let current: SectionBuilder | null = null;
	let pendingLabel: string | null = null;
	let pendingRepeatStart = false;
	let pendingEnding: 1 | 2 | undefined;
	let barChords: string[] = [];
	let barHasContent = false;

	const ensureSection = (): SectionBuilder => {
		if (!current) {
			current = {
				label: pendingLabel ?? (sections.length > 0 ? sections[sections.length - 1].label : 'A'),
				bars: []
			};
			if (pendingRepeatStart) current.repeatStart = true;
			if (pendingEnding) current.ending = pendingEnding;
			pendingLabel = null;
			pendingRepeatStart = false;
			pendingEnding = undefined;
		}
		return current;
	};

	const closeBar = (): void => {
		if (!barHasContent) return;
		ensureSection().bars.push({ chords: barChords });
		barChords = [];
		barHasContent = false;
	};

	const closeSection = (): void => {
		closeBar();
		// The cast defeats TS's closure narrowing: `current` is assigned inside
		// `ensureSection`, which control-flow analysis can't see from here.
		const open = current as SectionBuilder | null;
		if (open && open.bars.length > 0) sections.push(open);
		current = null;
	};

	for (const token of tokens) {
		// Same closure-narrowing workaround as closeSection.
		const open = current as SectionBuilder | null;
		switch (token.kind) {
			case 'timesig':
				if (!sawTimesig && sections.length === 0 && (!open || open.bars.length === 0)) {
					timeSignature = token.value;
					sawTimesig = true;
				} else if (
					token.value[0] !== timeSignature[0] ||
					token.value[1] !== timeSignature[1]
				) {
					warnings.push('iReal: mid-tune time signature change ignored');
				}
				break;
			case 'label':
				closeSection();
				pendingLabel = token.value;
				break;
			case 'ending': {
				closeSection();
				if (token.value === 1 || token.value === 2) {
					pendingEnding = token.value;
				} else {
					warnings.push(`iReal: ending N${token.value} imported as a plain section`);
				}
				break;
			}
			case 'barline':
				if (token.value === '{') {
					closeSection();
					pendingRepeatStart = true;
				} else if (token.value === '}') {
					closeBar();
					if (current) (current as SectionBuilder).repeatEnd = true;
					closeSection();
				} else {
					// '|', '[', ']', 'Z' all just delimit bars.
					closeBar();
				}
				break;
			case 'cell':
				if (token.value === 'x') {
					const prev = lastBar(sections, current);
					if (prev) barChords = [...prev.chords];
					barHasContent = true;
				} else if (token.value === 'r') {
					// Repeat the previous TWO bars.
					const bars = allBars(sections, current);
					if (bars.length >= 2) {
						ensureSection().bars.push({ chords: [...bars[bars.length - 2].chords] });
						barChords = [...allBars(sections, current)[allBars(sections, current).length - 2].chords];
					}
					barHasContent = true;
					warnings.push('iReal: two-bar repeat (r) approximated');
				} else {
					// p (slash), n (N.C.), s/l (render size) — cell-occupying,
					// no chord change.
					barHasContent = true;
				}
				break;
			case 'chord':
				barChords.push(token.value);
				barHasContent = true;
				break;
		}
	}
	closeSection();

	return { sections, timeSignature };
}

function lastBar(sections: SectionBuilder[], current: SectionBuilder | null): RawBar | null {
	if (current && current.bars.length > 0) return current.bars[current.bars.length - 1];
	const prevSection = sections[sections.length - 1];
	return prevSection?.bars[prevSection.bars.length - 1] ?? null;
}

function allBars(sections: SectionBuilder[], current: SectionBuilder | null): RawBar[] {
	return [...sections.flatMap((s) => s.bars), ...(current?.bars ?? [])];
}

/** Convert raw bars into a TuneSection with evenly-placed chords. */
function buildSection(
	builder: SectionBuilder,
	timeSignature: [number, number],
	warnings: string[]
): TuneSection {
	const barDuration: Fraction = [timeSignature[0], timeSignature[1]];
	const section: TuneSection = {
		label: builder.label,
		bars: builder.bars.length,
		notes: [],
		harmony: []
	};
	if (builder.repeatStart) section.repeatStart = true;
	if (builder.repeatEnd) section.repeatEnd = true;
	if (builder.ending) section.ending = builder.ending;

	// Chords as change points: placed evenly within their bar, each running
	// until the next chord or the section end.
	const placed: { offset: Fraction; text: string }[] = [];
	builder.bars.forEach((bar, barIdx) => {
		const barStart = multiplyFraction(barDuration, barIdx);
		bar.chords.forEach((text, j) => {
			const within = multiplyFraction([barDuration[0], barDuration[1] * bar.chords.length], j);
			placed.push({ offset: addFractions(barStart, within), text });
		});
	});

	const sectionEnd = multiplyFraction(barDuration, builder.bars.length);
	placed.forEach((p, idx) => {
		const next = idx + 1 < placed.length ? placed[idx + 1].offset : sectionEnd;
		const duration: Fraction = [
			next[0] * p.offset[1] - p.offset[0] * next[1],
			next[1] * p.offset[1]
		];
		const segment = harmonicSegmentFromSymbol(normalizeIRealChord(p.text), p.offset, duration);
		if (segment) section.harmony.push(segment);
		else warnings.push(`iReal: skipped unparseable chord "${p.text}"`);
	});

	return section;
}

/** Resolve a song's `=`-separated fields per the ireal-reader layout. */
function resolveFields(parts: string[]): { title: string; composer: string; style: string; key: string; music: string } | null {
	let title = '', composer = '', style = '', key = '', music = '';
	if (parts.length === 6 && !parts.some((p) => p.startsWith(MUSIC_PREFIX))) {
		// irealbook:// plain layout: title=composer=style=key=n=music
		[title, composer, style, key, , music] = parts;
		return { title, composer, style, key, music };
	}
	if (parts.length === 7) {
		[title, composer, style, key, music] = parts;
	} else if (parts.length === 8 && parts[4].startsWith(MUSIC_PREFIX)) {
		[title, composer, style, key, music] = parts;
	} else if (parts.length === 8 && parts[5].startsWith(MUSIC_PREFIX)) {
		[title, composer, style, key, , music] = parts;
	} else if (parts.length === 9) {
		[title, composer, style, key, , music] = parts;
	} else {
		return null;
	}
	return { title, composer, style, key, music };
}

function makeSheet(raw: string, plainScheme: boolean, warnings: string[]): Tune | null {
	const parts = plainScheme ? raw.split('=') : raw.split(/=+/).filter((x) => x !== '');
	const fields = resolveFields(parts);
	if (!fields) {
		warnings.push(`iReal: unrecognized song field layout (${parts.length} fields)`);
		return null;
	}

	let music = fields.music;
	if (music.startsWith(MUSIC_PREFIX)) {
		music = unscrambleIRealMusic(music.slice(MUSIC_PREFIX.length));
	}

	const { sections, timeSignature } = parseMusicString(music, warnings);
	if (sections.length === 0) {
		warnings.push(`iReal: "${fields.title}" contained no bars`);
		return null;
	}

	const key: PitchClass = parseChordSymbol(fields.key)?.root ?? 'C';

	const sheet: Tune = {
		id: '',
		title: fields.title || 'Untitled',
		key,
		timeSignature,
		tags: [],
		sections: sections.map((b) => buildSection(b, timeSignature, warnings)),
		source: 'imported-ireal'
	};
	if (fields.composer) sheet.composer = fields.composer;
	if (fields.style) sheet.style = fields.style;
	return sheet;
}

/**
 * Parse an iReal Pro share URL (or any text containing one) into
 * harmony-only lead sheets.
 */
export function parseIRealUrl(input: string): IRealImportResult {
	const warnings: string[] = [];
	const match = /(irealb|irealbook):\/\/([^"'\s]*)/.exec(input);
	if (!match) {
		return { sheets: [], warnings: ['No irealbook:// or irealb:// URL found in the input.'] };
	}
	const plainScheme = match[1] === 'irealbook';

	let decoded: string;
	try {
		decoded = decodeURIComponent(match[2]);
	} catch {
		return { sheets: [], warnings: ['The iReal URL is not valid percent-encoding.'] };
	}

	const chunks = decoded.split('===');
	// A trailing chunk with no '=' is the playlist name.
	if (chunks.length > 1 && !chunks[chunks.length - 1].includes('=')) {
		chunks.pop();
	}

	const sheets: Tune[] = [];
	for (const chunk of chunks) {
		if (!chunk.trim()) continue;
		const sheet = makeSheet(chunk, plainScheme, warnings);
		if (sheet) sheets.push(sheet);
	}
	return { sheets, warnings };
}

import type { ChordQuality, PitchClass } from '$lib/types/music';
import { transposePitchClass } from '$lib/music/transposition';

/**
 * Canonical chord-symbol model.
 *
 * A `ChordSymbol` preserves what a lead sheet actually says — base quality,
 * stacked extension, alterations, slash bass — independent of the closed
 * `ChordQuality` enum the audio layer voices. `chordSymbolToQuality` maps to
 * the nearest playable quality; the raw source string travels separately
 * (`HarmonicSegment.symbol`) so display never loses fidelity.
 */

/** Base quality families a written chord symbol can express. */
export type ChordBaseQuality =
	| 'maj' | 'min' | 'dom' | 'dim' | 'halfdim' | 'aug' | 'minmaj' | 'sus4' | 'sus2';

export interface ChordSymbol {
	/** Root normalized to the canonical 12-value PitchClass spelling. */
	root: PitchClass;
	quality: ChordBaseQuality;
	/**
	 * Stacked extension degrees as written, e.g. ['7'], ['9'], ['6','9'].
	 * The quality decides the seventh's flavor (maj7 vs b7), so tokens are
	 * plain degree numbers.
	 */
	extensions: string[];
	/** Alteration tokens normalized to b/# form: 'b9', '#11', 'alt', 'add9'… */
	alterations: string[];
	/** Slash-bass note, normalized like `root`. */
	bass?: PitchClass;
}

/** Letter + accidental → canonical PitchClass (enharmonic normalization). */
const ROOT_NORMALIZATION: Record<string, PitchClass> = {
	'C': 'C', 'C#': 'Db', 'Cb': 'B',
	'D': 'D', 'D#': 'Eb', 'Db': 'Db',
	'E': 'E', 'E#': 'F', 'Eb': 'Eb',
	'F': 'F', 'F#': 'F#', 'Fb': 'E',
	'G': 'G', 'G#': 'Ab', 'Gb': 'F#',
	'A': 'A', 'A#': 'Bb', 'Ab': 'Ab',
	'B': 'B', 'B#': 'C', 'Bb': 'Bb'
};

/** Parse a note token like "Eb" / "F♯" to a canonical PitchClass, or null. */
function parseNoteToken(token: string): PitchClass | null {
	const m = /^([A-G])([#♯b♭])?$/.exec(token);
	if (!m) return null;
	const accidental = m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : (m[2] ?? '');
	return ROOT_NORMALIZATION[m[1] + accidental] ?? null;
}

const ALTERABLE_DEGREES = new Set(['5', '9', '11', '13']);

/**
 * Parse a chord-symbol string (e.g. "Dm7b5", "C7(b9,#11)", "Am7/G") into a
 * `ChordSymbol`. Returns null for no-chord markers ("N.C.") and anything
 * unparseable — callers decide whether null means "skip" or "reject".
 */
export function parseChordSymbol(input: string): ChordSymbol | null {
	let s = input.trim();
	if (s === '') return null;
	if (/^n\.?c\.?$/i.test(s)) return null;

	const rootMatch = /^([A-G])([#♯b♭])?/.exec(s);
	if (!rootMatch) return null;
	const root = parseNoteToken(rootMatch[0].replace('♯', '#').replace('♭', 'b'));
	if (!root) return null;
	s = s.slice(rootMatch[0].length);

	// "6/9" is an extension pair, not a slash bass — collapse before splitting.
	s = s.replace('6/9', '69');

	let bass: PitchClass | undefined;
	const slash = s.lastIndexOf('/');
	if (slash >= 0) {
		const parsed = parseNoteToken(s.slice(slash + 1).trim());
		if (!parsed) return null;
		bass = parsed;
		s = s.slice(0, slash);
	}

	let quality: ChordBaseQuality | null = null;
	const extensions: string[] = [];
	const alterations: string[] = [];

	// Minor-major seventh first — its spellings embed both the min and maj
	// markers. Token order matters throughout: longest first (min before mi
	// before m; maj before ma before M) so a prefix never eats a longer name.
	const minMaj = /^(?:min|Min|MIN|mi|Mi|MI|m|-|−)(?:maj|Maj|MAJ|ma|Ma|MA|∆|Δ|△|\^|M)7/.exec(s);
	if (minMaj) {
		quality = 'minmaj';
		extensions.push('7');
		s = s.slice(minMaj[0].length);
	} else if (/^maj/i.test(s)) {
		quality = 'maj';
		s = s.slice(3);
	} else if (/^min/i.test(s)) {
		quality = 'min';
		s = s.slice(3);
	} else if (/^ma(?=\d|[(\s]|$)/i.test(s)) {
		// 'ma'/'mi' only when a digit/end follows — 'Cmadd9' is m + add9.
		quality = 'maj';
		s = s.slice(2);
	} else if (/^mi(?=\d|[(\s]|$)/i.test(s)) {
		quality = 'min';
		s = s.slice(2);
	} else if (/^[∆Δ△^M]/.test(s)) {
		quality = 'maj';
		// Δ / ^ conventionally imply the seventh even without a digit.
		if (/^[∆Δ△^]/.test(s) && !/^.\d/.test(s)) extensions.push('7');
		s = s.slice(1);
	} else if (/^[m\-−]/.test(s)) {
		quality = 'min';
		s = s.slice(1);
	} else if (/^dim/i.test(s)) {
		quality = 'dim';
		s = s.slice(3);
	} else if (/^[o°º]/.test(s)) {
		quality = 'dim';
		s = s.slice(1);
	} else if (/^[øØ]/.test(s)) {
		quality = 'halfdim';
		s = s.slice(1);
	} else if (/^aug/i.test(s)) {
		quality = 'aug';
		s = s.slice(3);
	} else if (/^\+/.test(s)) {
		quality = 'aug';
		s = s.slice(1);
	}

	// Extension digits (69 is the six-nine pair).
	const ext = /^(69|13|11|9|7|6)/.exec(s);
	if (ext) {
		if (ext[1] === '69') extensions.push('6', '9');
		else extensions.push(ext[1]);
		s = s.slice(ext[0].length);
	}

	if (quality === null) {
		if (extensions.length === 0) quality = 'maj';
		else quality = extensions[0] === '6' ? 'maj' : 'dom';
	}
	// Half-diminished implies the seventh.
	if (quality === 'halfdim' && !extensions.includes('7')) extensions.push('7');

	// Trailing tokens: sus, alt, add-tones, alterations, separators.
	while (s.length > 0) {
		const susMatch = /^sus(2|4)?/.exec(s);
		if (susMatch) {
			quality = susMatch[1] === '2' ? 'sus2' : 'sus4';
			s = s.slice(susMatch[0].length);
			continue;
		}
		const addMatch = /^add(\d+)/i.exec(s);
		if (addMatch) {
			alterations.push(`add${addMatch[1]}`);
			s = s.slice(addMatch[0].length);
			continue;
		}
		if (/^alt/i.test(s)) {
			alterations.push('alt');
			s = s.slice(3);
			continue;
		}
		const altMatch = /^([b♭#♯+\-−])(13|11|9|5)/.exec(s);
		if (altMatch) {
			const sign = altMatch[1] === '♭' || altMatch[1] === 'b' || altMatch[1] === '-' || altMatch[1] === '−' ? 'b' : '#';
			const degree = altMatch[2];
			if (!ALTERABLE_DEGREES.has(degree)) return null;
			// m7b5 (and m9b5, m11b5…) is half-diminished, not "minor seventh
			// with an alteration". The seventh is implied by any stacked
			// extension, so push it when absent (mirrors the ø handling).
			if (
				sign === 'b' &&
				degree === '5' &&
				quality === 'min' &&
				// A '9' contributed by a 6/9 pair implies no seventh — m69b5
				// stays minor with an altered fifth, not half-diminished.
				!extensions.includes('6') &&
				['7', '9', '11', '13'].some((e) => extensions.includes(e))
			) {
				quality = 'halfdim';
				if (!extensions.includes('7')) extensions.push('7');
			} else {
				alterations.push(`${sign}${degree}`);
			}
			s = s.slice(altMatch[0].length);
			continue;
		}
		if (/^[(),\s]/.test(s)) {
			s = s.slice(1);
			continue;
		}
		return null;
	}

	const result: ChordSymbol = { root, quality, extensions, alterations };
	if (bass) result.bass = bass;
	return result;
}

/**
 * Format a `ChordSymbol` as its canonical display string, using the compact
 * jazz spellings: Δ for the major-seventh family (CΔ7, CΔ9), a dash for the
 * minor family (C-7, C-6, C-7b5, C-Δ7). Inverse of `parseChordSymbol` for
 * canonical spellings: parse(format(x)) === x.
 */
export function formatChordSymbol(cs: ChordSymbol): string {
	let core: string;
	const extension = cs.extensions.includes('6') && cs.extensions.includes('9')
		? '69'
		: cs.extensions[0] ?? '';

	switch (cs.quality) {
		case 'maj':
			core = extension === '' || extension === '6' || extension === '69'
				? extension
				: `Δ${extension}`;
			break;
		case 'min':
			core = `-${extension}`;
			break;
		case 'dom':
			core = extension || '7';
			break;
		case 'halfdim': {
			// Keep the highest stacked extension (ø9 → -9b5); the implied
			// seventh only prints when nothing sits above it.
			const upper = cs.extensions.find((e) => e !== '7');
			core = upper ? `-${upper}b5` : '-7b5';
			break;
		}
		case 'dim':
			core = `dim${extension}`;
			break;
		case 'aug':
			core = `aug${extension}`;
			break;
		case 'minmaj':
			core = '-Δ7';
			break;
		case 'sus4':
			core = extension ? `${extension}sus4` : 'sus4';
			break;
		case 'sus2':
			core = extension ? `${extension}sus2` : 'sus2';
			break;
	}

	const alterations = cs.alterations.join('');
	const bass = cs.bass ? `/${cs.bass}` : '';
	return `${cs.root}${core}${alterations}${bass}`;
}

/**
 * Transpose a chord symbol's root (and slash bass) by pitch class and
 * re-format canonically. Returns undefined for missing/unparseable text —
 * callers drop the symbol rather than display a wrong-key one.
 */
export function transposeChordSymbol(
	symbol: string | undefined,
	semitones: number
): string | undefined {
	if (!symbol) return undefined;
	const parsed = parseChordSymbol(symbol);
	if (!parsed) return undefined;
	return formatChordSymbol({
		...parsed,
		root: transposePitchClass(parsed.root, semitones),
		bass: parsed.bass ? transposePitchClass(parsed.bass, semitones) : undefined
	});
}

/** Dominant alterations that push toward a specific voiced quality. */
const DOM_ALTERATION_QUALITY: Record<string, ChordQuality> = {
	'b9': '7b9',
	'#9': '7#9',
	'#11': '7#11',
	'b13': '7b13',
	'#5': 'aug7',
	'b5': '7#11'
};

/**
 * Map a `ChordSymbol` to the nearest existing `ChordQuality` so voicings and
 * backing tracks keep working. Lossy by design — the raw symbol stays on the
 * segment for display.
 *
 * Plain major triads map to maj6 (the traditional comping default — no maj7
 * color clash when the melody sits on the root); plain minor triads to min7.
 */
export function chordSymbolToQuality(cs: ChordSymbol): ChordQuality {
	const alts = cs.alterations.filter((a) => !a.startsWith('add'));
	switch (cs.quality) {
		case 'maj':
			if (cs.extensions.includes('6')) return 'maj6';
			return ['7', '9', '11', '13'].some((e) => cs.extensions.includes(e)) ? 'maj7' : 'maj6';
		case 'min':
			if (cs.extensions.includes('6')) return 'min6';
			if (alts.includes('b5')) return cs.extensions.includes('7') ? 'min7b5' : 'dim';
			return 'min7';
		case 'minmaj':
			return 'minMaj7';
		case 'halfdim':
			return 'min7b5';
		case 'dim':
			return cs.extensions.includes('7') ? 'dim7' : 'dim';
		case 'aug':
			return cs.extensions.length > 0 ? 'aug7' : 'aug';
		case 'sus4':
			return 'sus4';
		case 'sus2':
			return 'sus2';
		case 'dom': {
			if (alts.includes('alt')) return '7alt';
			const specific = alts.filter((a) => a in DOM_ALTERATION_QUALITY);
			if (specific.length >= 2) return '7alt';
			if (specific.length === 1) return DOM_ALTERATION_QUALITY[specific[0]];
			return '7';
		}
	}
}

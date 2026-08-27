import type { PitchClass } from '$lib/types/music';
import {
	formatChordSymbol,
	parseChordSymbol,
	type ChordSymbol
} from './chord-symbol';
import { displayPitchClass } from './notation';

/**
 * Structured jazz chord layout — MuseScore Jazz–style stacking:
 *
 *   E7  b9
 *       #11
 *      /G
 *
 * Root + quality sit on the main baseline; alterations form a vertical
 * column to the RIGHT of the quality (never over the root). Slash bass
 * hangs below the main symbol.
 */

export interface ChordLayoutParts {
	/** Root letter + accidental as displayed (e.g. "Bb", "F#"). */
	root: string;
	/**
	 * Quality + primary extension only — no alterations
	 * (e.g. "Δ7", "-7", "7", "dim7", "sus4", "").
	 */
	quality: string;
	/**
	 * Alteration tokens stacked top→bottom to the right of the quality
	 * (e.g. ["b9", "#11"]). Empty when none.
	 */
	alterations: string[];
	/** Slash bass without the leading slash (e.g. "G"), or null. */
	bass: string | null;
}

/**
 * Format alteration tokens as a compact parenthetical for single-line contexts
 * (ABC emission, plain text). Stacked SVG layout uses the raw token array.
 */
export function formatAlterations(alts: readonly string[]): string {
	if (alts.length === 0) return '';
	if (alts.length === 1) return alts[0];
	return `(${alts.join(',')})`;
}

/**
 * Split a canonical display chord string (or parseable raw symbol) into
 * layout parts. Unparseable strings return a single-root fallback so the
 * engraver never drops ink.
 */
export function layoutChordParts(
	displayText: string,
	keyContext?: PitchClass
): ChordLayoutParts {
	const parsed = parseChordSymbol(displayText);
	if (!parsed) {
		return { root: displayText, quality: '', alterations: [], bass: null };
	}
	return layoutFromChordSymbol(parsed, keyContext);
}

/** Layout parts from a structured ChordSymbol (roots re-spelled for key). */
export function layoutFromChordSymbol(
	cs: ChordSymbol,
	keyContext?: PitchClass
): ChordLayoutParts {
	const root = keyContext ? displayPitchClass(cs.root, keyContext) : cs.root;
	const bass = cs.bass
		? keyContext
			? displayPitchClass(cs.bass, keyContext)
			: cs.bass
		: null;

	// Quality only — strip alterations from the formatter so stacking owns them.
	const quality = formatChordSymbol({
		...cs,
		root: 'C',
		bass: undefined,
		alterations: []
	}).slice(1);

	return {
		root,
		quality,
		alterations: [...cs.alterations],
		bass
	};
}

/**
 * Compact single-line display (for ABC quoted chords / plain text).
 * Multi-alts use parentheses: E7(b9,#11).
 */
export function chordDisplayLine(displayText: string, keyContext?: PitchClass): string {
	const parts = layoutChordParts(displayText, keyContext);
	const bass = parts.bass ? `/${parts.bass}` : '';
	return `${parts.root}${parts.quality}${formatAlterations(parts.alterations)}${bass}`;
}

/** @deprecated Use chordDisplayLine. */
export function chordAbcAnnotation(displayText: string, keyContext?: PitchClass): string {
	return chordDisplayLine(displayText, keyContext);
}

/**
 * Pretty display parts — the ONE convention every chord surface renders
 * (leadsheet SVG, practice chart, chord lists). Display-only: canonical and
 * serialized strings stay ASCII-plus-Δ (`formatChordSymbol`), this layer maps
 * them to what the reader sees.
 *
 * Conventions (chosen 2026-08-26):
 * - root and the minor "-" sit full-size on the baseline
 * - everything after them is one superscript run: extensions, Δ, ø, °, +,
 *   sus, and a single alteration parenthesized — G⁷⁽♭⁹⁾, Dø⁷, C-⁷, F♯°⁷
 * - two or more alterations become `supStack`, one tall paren pair around a
 *   vertical column (the renderer draws the parens)
 * - accidentals are real glyphs: B♭, F♯, ♭9, ♯11 (ASCII stays in aria/title
 *   attributes and editable inputs)
 */
export interface ChordDisplayModel {
	/** Root as displayed: "C", "B♭", "F♯". Baseline, full size. */
	root: string;
	/** The minor "-" (also min-maj), or "" — baseline, full size. */
	baselineQuality: '' | '-';
	/** Superscript run: "7", "Δ7", "ø7", "°7", "+7", "7sus4", "7(♭9)", "7alt", "". */
	sup: string;
	/** Two+ alterations as a stacked column ("♭9", "♯11"), else null. */
	supStack: string[] | null;
	/** Slash bass without the slash ("G", "B♭"), or null. */
	bass: string | null;
}

/** Trailing ASCII accidental → glyph: "Bb" → "B♭", "F#" → "F♯". */
function prettyPitch(s: string): string {
	return s.replace(/b$/, '♭').replace(/#$/, '♯');
}

/** Leading ASCII accidental → glyph: "b9" → "♭9", "#11" → "♯11". */
function prettyAlteration(s: string): string {
	return s.replace(/^b/, '♭').replace(/^#/, '♯');
}

/**
 * Canonical quality string (formatChordSymbol minus root/alterations) → the
 * baseline/superscript split plus glyph substitutions (ø, °, +).
 */
function displayQualityParts(quality: string): { baselineQuality: '' | '-'; sup: string } {
	const halfdim = quality.match(/^-(\d+)b5$/);
	if (halfdim) return { baselineQuality: '', sup: `ø${halfdim[1]}` };
	if (quality.startsWith('-')) return { baselineQuality: '-', sup: quality.slice(1) };
	const dim = quality.match(/^dim(\d*)$/);
	if (dim) return { baselineQuality: '', sup: `°${dim[1]}` };
	const aug = quality.match(/^aug(\d*)$/);
	if (aug) return { baselineQuality: '', sup: `+${aug[1]}` };
	return { baselineQuality: '', sup: quality };
}

/** Pretty display parts from a structured ChordSymbol. */
export function chordDisplayModel(cs: ChordSymbol, keyContext?: PitchClass): ChordDisplayModel {
	const parts = layoutFromChordSymbol(cs, keyContext);
	const { baselineQuality, sup } = displayQualityParts(parts.quality);

	// Accidental alterations get parens (one) or the stack (two+); word
	// tokens like "alt" / "add9" append bare — jazz never parenthesizes them.
	const accidentals = parts.alterations.filter((a) => /^[b#]/.test(a));
	const words = parts.alterations.filter((a) => !/^[b#]/.test(a));
	let supRun = sup;
	let supStack: string[] | null = null;
	if (accidentals.length === 1) supRun += `(${prettyAlteration(accidentals[0])})`;
	else if (accidentals.length > 1) supStack = accidentals.map(prettyAlteration);
	supRun += words.join('');

	return {
		root: prettyPitch(parts.root),
		baselineQuality,
		sup: supRun,
		supStack,
		bass: parts.bass ? prettyPitch(parts.bass) : null
	};
}

/**
 * Pretty display parts from raw chord text. Unparseable strings return the
 * text as a bare root so the engraver never drops ink.
 */
export function chordDisplayModelFromText(
	displayText: string,
	keyContext?: PitchClass
): ChordDisplayModel {
	const parsed = parseChordSymbol(displayText);
	if (!parsed) {
		return { root: displayText, baselineQuality: '', sup: '', supStack: null, bass: null };
	}
	return chordDisplayModel(parsed, keyContext);
}

/**
 * Pure layout numbers for stacked chord engraving. The renderer measures the
 * main-line width, then places the alteration column at mainRight + gap.
 *
 * Roles:
 * - `root` / `quality` — same baseline, flow left→right
 * - `alteration` — vertical stack; renderer sets absolute x to mainRight
 * - `bass` — below main baseline under the root/quality
 */
export interface ChordTspanSpec {
	text: string;
	/** Multiplier of the parent font-size (1 = root size). */
	size: number;
	/**
	 * Vertical offset in em relative to the main baseline.
	 * Negative = above, positive = below.
	 */
	dyEm: number;
	role: 'root' | 'quality' | 'sup' | 'alteration' | 'paren' | 'bass';
	/**
	 * When true, the renderer must position this tspan past the right edge of
	 * the flowing main line, not as a flowing continuation. Paren/alteration
	 * groups chain left→right in spec order (paren, column, paren).
	 */
	stackRight: boolean;
}

/** Superscript run size as a fraction of the root size (showcase-approved). */
export const CHORD_SUP_SIZE_EM = 0.58;
/** Superscript baseline rise in root-em (top lands near the root cap height). */
export const CHORD_SUP_RISE_EM = -0.42;

/**
 * Superscript engraving geometry:
 * - root and the minor "-" flow on the baseline at full size
 * - the sup run (extension, glyph quality, single parenthesized alteration)
 *   flows right after them, small and raised
 * - a two+ alteration stack is a raised column wrapped in one tall paren
 *   pair, positioned by the renderer at the measured right edge
 * - slash bass hangs below
 */
export function chordTspanSpecs(model: ChordDisplayModel): ChordTspanSpec[] {
	const specs: ChordTspanSpec[] = [
		{ text: model.root, size: 1, dyEm: 0, role: 'root', stackRight: false }
	];
	if (model.baselineQuality) {
		specs.push({ text: model.baselineQuality, size: 1, dyEm: 0, role: 'quality', stackRight: false });
	}
	if (model.sup) {
		specs.push({
			text: model.sup,
			size: CHORD_SUP_SIZE_EM,
			dyEm: CHORD_SUP_RISE_EM,
			role: 'sup',
			stackRight: false
		});
	}

	if (model.supStack) {
		const n = model.supStack.length;
		const altSize = 0.56;
		const stepEm = 0.85 * altSize;
		// Raised column: centered on the sup rise so the stack reads as one
		// superscript unit beside the extension. Three+ rows would push the
		// bottom row below the baseline from the fixed center, so it lifts
		// just enough to keep every row superscript.
		const lowestRowOffset = ((n - 1) / 2) * stepEm;
		const centerEm = Math.min(-0.35, -lowestRowOffset - 0.01);
		const topOffset = centerEm - ((n - 1) / 2) * stepEm;
		// Tall parens: a full-size glyph whose optical center (~0.3em above its
		// baseline) sits on the stack center.
		const parenSize = 0.62 + 0.32 * n;
		const parenDy = centerEm + 0.3 * parenSize;
		specs.push({ text: '(', size: parenSize, dyEm: parenDy, role: 'paren', stackRight: true });
		for (let i = 0; i < n; i++) {
			specs.push({
				text: model.supStack[i],
				size: altSize,
				dyEm: topOffset + i * stepEm,
				role: 'alteration',
				stackRight: true
			});
		}
		specs.push({ text: ')', size: parenSize, dyEm: parenDy, role: 'paren', stackRight: true });
	}

	if (model.bass) {
		specs.push({ text: `/${model.bass}`, size: 0.72, dyEm: 0.55, role: 'bass', stackRight: false });
	}

	return specs;
}

/** Horizontal gap between quality and the alteration column (root-em units). */
export const CHORD_STACK_GAP_EM = 0.12;

/**
 * Where to put the left edge of the alteration column, given the painted
 * main-line box (root+quality). Pure so it is unit-testable without SVG.
 *
 * Callers must place alts with `text-anchor="start"` — if the parent chord
 * keeps abcjs's default `text-anchor="middle"`, absolute `x` centers each
 * alt on this point and the left half of "b9"/"#11" paints over the quality.
 */
export function alterationStackX(
	mainBox: { x: number; width: number },
	baseSize: number,
	gapEm: number = CHORD_STACK_GAP_EM
): number {
	return mainBox.x + mainBox.width + baseSize * gapEm;
}

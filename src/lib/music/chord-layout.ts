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
	 * Negative = above, positive = below. Alterations use a centered stack.
	 */
	dyEm: number;
	role: 'root' | 'quality' | 'alteration' | 'bass';
	/**
	 * When true, the renderer must position this tspan at the right edge of
	 * the main line (root+quality), not as a flowing continuation.
	 */
	stackRight: boolean;
}

/**
 * MuseScore Jazz stack geometry:
 * - One alteration → slight superscript to the right of quality (same column).
 * - Two+ alterations → vertical column centered on the main baseline, top→bottom.
 *
 * Line spacing for the stack is ~0.85em of the alteration size.
 */
export function chordTspanSpecs(parts: ChordLayoutParts): ChordTspanSpec[] {
	const specs: ChordTspanSpec[] = [
		{ text: parts.root, size: 1, dyEm: 0, role: 'root', stackRight: false }
	];
	if (parts.quality) {
		specs.push({
			text: parts.quality,
			size: 0.88,
			dyEm: 0,
			role: 'quality',
			stackRight: false
		});
	}

	const alts = parts.alterations;
	const n = alts.length;
	if (n > 0) {
		// Alteration size relative to root; stack step in root-em units.
		const altSize = 0.58;
		const stepEm = 0.85 * altSize; // ~0.49 root-em between alt baselines
		// Center the stack on the main baseline: first alt above, last below
		// (or a single alt slightly above like a superscript).
		const topOffset = n === 1 ? -0.35 * altSize : -((n - 1) / 2) * stepEm;
		for (let i = 0; i < n; i++) {
			specs.push({
				text: alts[i],
				size: altSize,
				dyEm: topOffset + i * stepEm,
				role: 'alteration',
				stackRight: true
			});
		}
	}

	if (parts.bass) {
		// Below the main symbol; stack clears multi-alt columns.
		const bassDy = n > 1 ? 0.55 + ((n - 1) / 2) * 0.5 : 0.55;
		specs.push({
			text: `/${parts.bass}`,
			size: 0.72,
			dyEm: bassDy,
			role: 'bass',
			stackRight: false
		});
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

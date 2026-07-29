import type { ChordProgressionType } from '$lib/types/lick-practice';

/**
 * Per-progression identity colour, as a theme-aware CSS variable reference.
 *
 * The actual hues live in `src/app.css` (`--prog-*`, defined for both themes),
 * mirroring how `difficultyDisplay` returns `var(--difficulty-N)`. This is an
 * explicit `Record<ChordProgressionType, …>` so the compiler forces a colour
 * for every progression — a new progression won't type-check until it has one.
 *
 * Used on the library card (tinted category pill + dots) and carried through to
 * the lick-practice session header (`LickHeader.svelte`), so the colour a user
 * sees on a lick in the library is the colour they see while drilling it.
 */
const PROGRESSION_COLOR_VARS: Record<ChordProgressionType, string> = {
	'minor-vamp': 'var(--prog-minor-vamp)',
	'major-vamp': 'var(--prog-major-vamp)',
	'dominant-vamp': 'var(--prog-dominant-vamp)',
	'ii-V-I-major': 'var(--prog-ii-V-I-major)',
	'ii-V-I-minor': 'var(--prog-ii-V-I-minor)',
	'ii-V-I-major-long': 'var(--prog-ii-V-I-major-long)',
	'ii-V-I-minor-long': 'var(--prog-ii-V-I-minor-long)',
	turnaround: 'var(--prog-turnaround)',
	'iii-VI-ii-V-I': 'var(--prog-iii-VI-ii-V-I)',
	blues: 'var(--prog-blues)'
};

/**
 * CSS colour (a `var(--prog-*)` reference) for a progression's identity hue.
 * Falls back to the neutral accent for an orphaned/legacy tag that no longer
 * maps to a known progression, so the pill never renders an invalid colour.
 */
export function progressionColor(type: ChordProgressionType): string {
	return PROGRESSION_COLOR_VARS[type] ?? 'var(--color-accent)';
}

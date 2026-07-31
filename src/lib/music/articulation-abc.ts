import type { Articulation, Note } from '$lib/types/music';

/**
 * Map authored {@link Articulation} values onto ABC decorations that abcjs
 * engraves. Returns a prefix string (empty when no mark should print).
 *
 * - accent   → `!>!`  (sforzato wedge)
 * - staccato → `.`    (dot)
 * - ghost    → `!pp!` (soft cue; abcjs has no parenthetical ghost glyph)
 * - bend-up  → `!slide!` when the engraver knows it; otherwise no mark
 * - legato   → no single-note mark (needs a multi-note slur span)
 * - normal   → ''
 */

const ARTICULATION_PREFIX: Partial<Record<Articulation, string>> = {
	accent: '!>!',
	staccato: '.',
	ghost: '!pp!',
	'bend-up': '!slide!',
	legato: '',
	normal: ''
};

/** ABC decoration prefix for a note's articulation (empty string if none). */
export function articulationAbcPrefix(articulation: Articulation | undefined): string {
	if (!articulation || articulation === 'normal' || articulation === 'legato') return '';
	return ARTICULATION_PREFIX[articulation] ?? '';
}

/** Convenience: prefix for a full Note. */
export function noteArticulationPrefix(note: Note): string {
	return articulationAbcPrefix(note.articulation);
}

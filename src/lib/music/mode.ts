/**
 * Lick mode — the single resolver for "is this lick major or minor".
 *
 * `Phrase.key` is always the TONIC. `Phrase.mode` states how to read it;
 * when absent (legacy rows, curated licks written before the field existed)
 * the HARMONY decides: the tonic segment — the last one rooted on the key —
 * with a minor-tonic quality reads minor, any other quality reads major, and
 * with no segment on the key root we fall back to major.
 *
 * Never infer from the category. The user's existing minor-category licks
 * were entered with key = the relative MAJOR (the editor's key signature was
 * major-only), so a category rule would relabel a "D minor lick stored as F"
 * as F minor. Categories only seed the editor's default (MINOR_CATEGORIES).
 */
import type { ChordQuality, HarmonicSegment, Mode, Phrase, PhraseCategory } from '$lib/types/music';
import { fractionToFloat } from './intervals';

/** Qualities that make a segment on the key root a MINOR tonic. A ø/dim on the root is not a tonic. */
export const MINOR_TONIC_QUALITIES: ReadonlySet<ChordQuality> = new Set<ChordQuality>([
	'min7',
	'min6',
	'minMaj7'
]);

/** Categories whose licks are minor by construction — the editor's default mode follows them. */
export const MINOR_CATEGORIES: ReadonlySet<PhraseCategory> = new Set<PhraseCategory>([
	'ii-V-I-minor',
	'short-ii-V-I-minor',
	'V-I-minor',
	'minor-chord'
]);

/**
 * The mode the harmony implies for the tonic, or null when nothing is rooted
 * on the key (a ii-chord lick keyed C over Dm7 says nothing about C).
 */
export function harmonyTonicMode(phrase: Pick<Phrase, 'key' | 'harmony'>): Mode | null {
	let tonic: HarmonicSegment | null = null;
	for (const seg of phrase.harmony) {
		if (seg.chord.root !== phrase.key) continue;
		// The RESOLUTION decides: the last segment on the key root, by time.
		if (!tonic || fractionToFloat(seg.startOffset) >= fractionToFloat(tonic.startOffset)) {
			tonic = seg;
		}
	}
	if (!tonic) return null;
	return MINOR_TONIC_QUALITIES.has(tonic.chord.quality) ? 'minor' : 'major';
}

/** Explicit `mode` › harmony inference › major. */
export function lickMode(phrase: Pick<Phrase, 'key' | 'harmony' | 'mode'>): Mode {
	return phrase.mode ?? harmonyTonicMode(phrase) ?? 'major';
}

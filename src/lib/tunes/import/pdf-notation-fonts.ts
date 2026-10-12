/** Translate explicitly identified legacy music fonts into the canonical SMuFL
 * alphabet used by the notation readers. Ordinary text and chord fonts never
 * enter this adapter. Unsupported symbols invalidate the affected measure.
 * Add future font families here, without changing geometry or musical parsing.
 */
const inkpen: Record<string, string> = {
	œ: '\ue0a4',
	'˙': '\ue0a3',
	w: '\ue0a2',
	'&': '\ue050',
	'?': '\ue0a5',
	b: '\ue260',
	n: '\ue261',
	'#': '\ue262',
	'∑': '\ue4e3',
	Ó: '\ue4e4',
	Œ: '\ue4e5',
	'‰': '\ue4e6',
	J: '\ue241',
	j: '\ue240'
};
const family = (name?: string) => name?.replace(/^[A-Z]{6}\+/, '');
export function isLegacyNotationFont(name?: string): boolean {
	return /^(Inkpen2|Inkpen2Std|Inkpen2SpecialStd)$/.test(family(name) ?? '');
}
export function decodeNotationGlyph(unicode: string, fontName?: string): string | null {
	if (/^[\ue000-\uf8ff]$/.test(unicode)) return unicode;
	if (!isLegacyNotationFont(fontName) || !unicode.trim()) return null;
	if (family(fontName) === 'Inkpen2SpecialStd') return unicode === '™' ? '\ue1e7' : '\ue0a5';
	if (/^[0-9]$/.test(unicode)) return String.fromCharCode(0xe080 + Number(unicode));
	return inkpen[unicode] ?? '\ue0a5';
}
/** Inkpen's advance includes a right bearing; stems attach to the head's ink
 * edge (0.36 em), not to the next character origin. Keep PDF advances intact.
 */
export function notationGlyphWidth(
	unicode: string,
	fontName: string | undefined,
	em: number,
	advance: number
): number {
	return /^(Inkpen2|Inkpen2Std)$/.test(family(fontName) ?? '') && /^[œ˙]$/.test(unicode)
		? 0.36 * em
		: advance;
}

/** Font-scoped decoding for old Sibelius chord text. PDF subsets may split
 * "maj" across several runs; join only touching runs at the same baseline.
 */
import type { PageTextItem } from './pdf-text-chords';
import { isLegacyNotationFont } from './pdf-notation-fonts';
const symbols: Record<string, string> = {
	'¨': 'b',
	'©': '#',
	'‹': 'm',
	Œ: 'm',
	'„': 'a',
	Š: 'j',
	Ø: 'ø',
	º: '°'
};
export function normalizeLegacyText(
	items: PageTextItem[],
	fontNames: Readonly<Record<string, string>>
): PageTextItem[] {
	const isChord = (i: PageTextItem) =>
		/^(?:[A-Z]{6}\+)?Inkpen2Chords(?:Std)?$/.test(fontNames[i.font ?? ''] ?? '');
	const plain = items.filter((i) => !isChord(i) && !isLegacyNotationFont(fontNames[i.font ?? '']));
	const chords = items
		.filter((i) => isChord(i) && i.str.trim())
		.sort((a, b) => a.y - b.y || a.x - b.x);
	const joined: PageTextItem[] = [];
	for (const item of chords) {
		const previous = joined.at(-1);
		if (
			previous &&
			Math.abs(previous.y - item.y) < 0.04 * item.h &&
			Math.abs(previous.h - item.h) < 0.04 * item.h &&
			Math.abs(item.x - previous.x - previous.w) < 0.08 * item.h
		) {
			previous.str += item.str;
			previous.w = item.x + item.w - previous.x;
		} else joined.push({ ...item });
	}
	return [
		...plain,
		...joined.map((i) => ({ ...i, str: [...i.str].map((c) => symbols[c] ?? c).join('') }))
	];
}

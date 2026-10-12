/** Decode individual supported music-font text-show operations. getTextContent() combines
 * adjacent glyphs, losing their individual positions; this adapter preserves
 * glyph widths, TJ spacing and nested transforms. Only horizontal fonts and
 * visible black text are eligible for deterministic notation reading.
 */
import { decodeNotationGlyph, notationGlyphWidth } from './pdf-notation-fonts';
import type { PageTextItem } from './pdf-text-chords';
import { composePdfTransforms, type PdfOperatorList } from './pdf-operators';
export function extractMusicGlyphs(
	ops: PdfOperatorList,
	codes: Record<string, number>,
	viewport: number[],
	fontNames: Readonly<Record<string, string>> = {}
): PageTextItem[] {
	let s = {
		matrix: viewport,
		tm: [1, 0, 0, 1, 0, 0],
		font: '',
		size: 0,
		x: 0,
		y: 0,
		lineX: 0,
		lineY: 0,
		spacing: 0,
		wordSpacing: 0,
		hscale: 1,
		rise: 0,
		fill: '#000000',
		mode: 0
	};
	const stack: (typeof s)[] = [];
	const result: PageTextItem[] = [];
	for (let i = 0; i < ops.fnArray.length; i++) {
		const op = ops.fnArray[i],
			a = ops.argsArray[i] as any[] | null;
		if (op === codes.save) stack.push({ ...s });
		else if (op === codes.restore) s = stack.pop() ?? s;
		else if (op === codes.transform && a?.length === 6)
			s.matrix = composePdfTransforms(s.matrix, a);
		else if (op === codes.beginText) {
			s.tm = [1, 0, 0, 1, 0, 0];
			s.x = s.y = s.lineX = s.lineY = 0;
		} else if (op === codes.setFont && a) {
			s.font = a[0];
			s.size = a[1];
		} else if (op === codes.setTextMatrix && a) {
			s.tm = Array.from(a[0]?.length === 6 ? a[0] : a);
			s.x = s.y = s.lineX = s.lineY = 0;
		} else if (op === codes.moveText && a) {
			s.lineX += a[0];
			s.lineY += a[1];
			s.x = s.lineX;
			s.y = s.lineY;
		} else if (op === codes.setCharSpacing && a) s.spacing = a[0];
		else if (op === codes.setWordSpacing && a) s.wordSpacing = a[0];
		else if (op === codes.setHScale && a) s.hscale = a[0] / 100;
		else if (op === codes.setTextRise && a) s.rise = a[0];
		else if (op === codes.setTextRenderingMode && a) s.mode = a[0];
		else if (op === codes.setFillRGBColor && a) s.fill = a[0];
		else if (op === codes.showText && a && Array.isArray(a[0])) {
			const m = composePdfTransforms(s.matrix, s.tm),
				sx = Math.hypot(m[0], m[1]),
				sy = Math.hypot(m[2], m[3]);
			for (const glyph of a[0]) {
				if (typeof glyph === 'number') {
					s.x -= ((glyph * s.size) / 1000) * s.hscale;
					continue;
				}
				if (!glyph || typeof glyph.width !== 'number') continue;
				const w = (glyph.width * s.size) / 1000;
				const symbol =
					typeof glyph.unicode === 'string'
						? decodeNotationGlyph(glyph.unicode, fontNames[s.font])
						: null;
				if (
					symbol &&
					s.mode === 0 &&
					s.fill === '#000000' &&
					Math.abs(m[1]) < 0.001 &&
					Math.abs(m[2]) < 0.001 &&
					s.size > 0
				)
					result.push({
						str: symbol,
						x: m[0] * s.x + m[2] * (s.y + s.rise) + m[4],
						y: m[1] * s.x + m[3] * (s.y + s.rise) + m[5],
						w: notationGlyphWidth(
							glyph.unicode,
							fontNames[s.font],
							Math.abs(s.size * s.hscale * sx),
							Math.abs(w * s.hscale * sx)
						),
						h: s.size * sy,
						font: s.font
					});
				s.x += (w + s.spacing + (glyph.isSpace ? s.wordSpacing : 0)) * s.hscale;
			}
		}
	}
	return result;
}

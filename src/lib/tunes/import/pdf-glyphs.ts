/** Read SMuFL glyph identities/coordinates embedded in exported PDFs.
 * This is a separate source from heuristic pixel detections. Unknown glyphs,
 * combined note runs, grace-size heads and polyphony decline automatic fusion.
 * SMuFL: https://smufl.formats.music/latest/tables/noteheads.html
 */
import type { PageTextItem } from './pdf-text-chords';
import type { SystemGeometry } from './pdf-geometry';
import type { RecognitionContext, RecognizedBar } from './pdf-recognition';
import { resolveStaffEvents, type PrintedAccidental } from './staff-pitch';
import { isRestPitch } from './system-bar-validation';

export interface GlyphNote {
	x: number;
	position: number;
	accidental: PrintedAccidental | null;
	head: 'whole' | 'half' | 'black';
}
export interface GlyphNotation {
	context: RecognitionContext;
	/** null declines this measure; [] is a measure without noteheads. */
	bars: Array<GlyphNote[] | null>;
}
const heads: Record<string, GlyphNote['head']> = {
	'\ue0a2': 'whole',
	'\ue0a3': 'half',
	'\ue0a4': 'black'
};
const accidentalGlyphs: Record<string, PrintedAccidental> = {
	'\ue260': 'flat',
	'\ue261': 'natural',
	'\ue262': 'sharp',
	'\ue263': 'double-sharp',
	'\ue264': 'double-flat'
};
export function extractGlyphNotation(
	items: PageTextItem[],
	system: SystemGeometry,
	first = false
): GlyphNotation | null {
	const { band, interline: il, firstBarLeft, barlines } = system;
	const nearby = items
		.filter(
			(i) => i.y >= band.top - 3 * il && i.y <= band.bottom + 3 * il && i.x < (barlines.at(-1) ?? 0)
		)
		.map((i) => ({ ...i, str: i.str.trim() }));
	// A legacy-font adapter represents an unsupported symbol with the unknown
	// head marker. In the header it may be a clef or meter change: inheriting
	// the previous context would turn an unsupported read into wrong pitches.
	if (nearby.some((i) => i.str === '\ue0a5' && i.x < firstBarLeft)) return null;
	const noteItems = nearby.filter((i) => [...i.str].some((c) => heads[c]));
	if (!noteItems.length || !noteItems.some((i) => heads[i.str])) return null;
	const bars: GlyphNotation['bars'] = barlines.map(() => []);
	const indexOf = (x: number) => barlines.findIndex((right) => x < right);
	const position = (y: number) => ((band.bottom - y) * 2) / il;
	// A clef glyph's origin is its reference line. Only known, standard
	// treble/bass placements are supported here; C clefs remain optical.
	const clefItem = nearby.find(
		(i) => i.x < firstBarLeft && (i.str === '\ue050' || i.str === '\ue062')
	);
	const clef =
		clefItem && Math.abs(position(clefItem.y) - (clefItem.str === '\ue050' ? 2 : 6)) < 0.3
			? clefItem.str === '\ue050'
				? 'treble'
				: 'bass'
			: null;
	const musicStart = Math.min(
		...nearby.filter((i) => heads[i.str] || /^[\ue4e3-\ue4e9]$/.test(i.str)).map((i) => i.x)
	);
	const signatureItems: PageTextItem[] = [];
	const candidates = nearby
		.filter((i) => i.x < musicStart && /^[\ue260-\ue262]+$/.test(i.str))
		.sort((a, b) => a.x - b.x);
	const signaturePositions =
		candidates[0]?.str[0] === '\ue260' ? [4, 7, 3, 6, 2, 5, 1] : [8, 5, 9, 6, 3, 7, 4];
	let signatureCount = 0;
	for (const item of candidates) {
		const previous = signatureItems.at(-1);
		if (
			!clefItem ||
			item.x < clefItem.x ||
			(!previous && item.x > clefItem.x + 6 * il) ||
			(previous && item.x - previous.x > 1.5 * il)
		)
			break;
		if (
			item.str[0] !== candidates[0].str[0] ||
			Math.abs(
				position(item.y) - (signaturePositions[signatureCount] - (clef === 'bass' ? 2 : 0))
			) > 0.35
		)
			break;
		signatureItems.push(item);
		signatureCount += item.str.length;
	}
	// The pixel content boundary can start at the head, excluding its leading
	// accidental. Accept only a sign that has exactly one matching note.
	const leadingSigns = candidates.filter(
		(i) =>
			!signatureItems.includes(i) &&
			i.x < firstBarLeft &&
			noteItems.filter(
				(n) =>
					heads[n.str] &&
					n.x >= firstBarLeft &&
					n.x > i.x &&
					n.x - i.x < 2 * il &&
					Math.abs(position(n.y) - position(i.y)) < 0.3
			).length === 1
	);
	if (
		candidates.some(
			(i) => i.x < firstBarLeft && !signatureItems.includes(i) && !leadingSigns.includes(i)
		)
	)
		return null;
	const signature = signatureItems.map((i) => i.str).join('');
	const fifths =
		signature.length > 0 && signature.length <= 7 && /^\ue262+$/.test(signature)
			? signature.length
			: signature.length > 0 && signature.length <= 7 && /^\ue260+$/.test(signature)
				? -signature.length
				: /^\ue261+$/.test(signature)
					? 0
					: first && clef && !signature
						? 0
						: null;
	const meterItems = nearby.filter((i) => i.x < musicStart && /^[\ue080-\ue089]$/.test(i.str));
	const meterValue = (p: number) =>
		Number(
			meterItems
				.filter((i) => Math.abs(position(i.y) - p) < 0.3)
				.sort((a, b) => a.x - b.x)
				.map((i) => String(i.str.charCodeAt(0) - 0xe080))
				.join('')
		);
	const top = meterValue(6),
		bottom = meterValue(2);
	const common = nearby.find((i) => i.x < musicStart && (i.str === '\ue08a' || i.str === '\ue08b'));
	const timeSignature: [number, number] | null =
		top > 0 && top <= 32 && [1, 2, 4, 8, 16].includes(bottom)
			? [top, bottom]
			: common
				? common.str === '\ue08a'
					? [4, 4]
					: [2, 2]
				: null;
	for (const i of noteItems) {
		const b = indexOf(i.x);
		if (b < 0) continue;
		const pos = position(i.y);
		if (
			!heads[i.str] ||
			Math.abs(pos - Math.round(pos)) > 0.25 ||
			i.h < 3.4 * il ||
			i.h > 4.6 * il ||
			i.x < firstBarLeft
		) {
			bars[b] = null;
			continue;
		}
		bars[b]?.push({ x: i.x, position: Math.round(pos), accidental: null, head: heads[i.str] });
	}
	for (let b = 0; b < bars.length; b++) {
		const left = b ? barlines[b - 1] : firstBarLeft;
		if (
			nearby.some(
				(i) =>
					i.x >= left &&
					i.x < barlines[b] &&
					/[\ue050-\ue07f\ue0a5-\ue0f4\ue0f7-\ue0ff]/.test(i.str)
			)
		) {
			bars[b] = null;
			continue;
		}
		const notes = bars[b];
		if (!notes) continue;
		notes.sort((a, c) => a.x - c.x);
		if (notes.some((n, i) => i > 0 && n.x - notes[i - 1].x < 0.6 * il)) {
			bars[b] = null;
			continue;
		}
		const signs = nearby.filter(
			(i) =>
				!signatureItems.includes(i) &&
				(i.x >= left || (b === 0 && leadingSigns.includes(i))) &&
				i.x < barlines[b] &&
				accidentalGlyphs[i.str]
		);
		for (const sign of signs) {
			const candidates = notes.filter(
				(n) =>
					n.x > sign.x && n.x - sign.x < 2 * il && Math.abs(n.position - position(sign.y)) < 0.3
			);
			if (candidates.length !== 1 || candidates[0].accidental !== null) {
				bars[b] = null;
				break;
			}
			candidates[0].accidental = accidentalGlyphs[sign.str];
		}
	}
	return { context: { clef, fifths, timeSignature }, bars };
}

/** Preserve recognized rhythm/form; replace pitches only with exact one-to-one
 * embedded note observations. Never align by dropping notes or filling gaps. */
export function applyGlyphPitches(
	bars: RecognizedBar[],
	notation: GlyphNotation,
	context: RecognitionContext
): { bars: RecognizedBar[]; warnings: string[] } {
	const warnings: string[] = [];
	const clef = notation.context.clef ?? context.clef,
		fifths = notation.context.fifths ?? context.fifths;
	if (!clef || fifths === null)
		return { bars, warnings: ['Embedded pitches need a confirmed clef and key signature.'] };
	let tiedFrom: string | undefined;
	const corrected = bars.map((bar, b) => {
		const notes = notation.bars[b];
		if (!notes) {
			tiedFrom = undefined;
			return bar;
		}
		if (bar.melody.filter((n) => !isRestPitch(n[2])).length !== notes.length) {
			warnings.push(
				`bar ${b + 1}: embedded note count disagrees with recognition; review rhythm before applying pitches`
			);
			tiedFrom = undefined;
			return bar;
		}
		let index = 0;
		const events = bar.melody.map((n) => {
			const note = isRestPitch(n[2]) ? null : notes[index++];
			return {
				beat: n[0],
				duration: n[1],
				position: note?.position ?? null,
				accidental: note?.accidental ?? null,
				tied: n[3] === true
			};
		});
		const melody = resolveStaffEvents(events, clef, fifths, tiedFrom);
		const last = melody.at(-1);
		tiedFrom = last?.[3] ? last[2] : undefined;
		return { ...bar, melody };
	});
	return { bars: corrected, warnings };
}

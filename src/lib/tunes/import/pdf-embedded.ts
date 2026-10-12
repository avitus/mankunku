/** Provider-neutral fusion of embedded notation and an optional optical read. */
import type { ExtractedSystem } from './pdf-system-extract';
import type { RecognitionContext, SystemRecognitionResult } from './pdf-recognition';
import { applyGlyphPitches } from './pdf-glyphs';
const emptyBar = () => ({
	startRepeat: false,
	endRepeat: false,
	ending: null,
	pickup: false,
	melody: []
});
export function embeddedHeader(system: ExtractedSystem): SystemRecognitionResult | null {
	const c = system.glyphs?.context;
	return c?.clef && c.fifths != null
		? {
				keySignature: { fifths: c.fifths },
				clef: c.clef,
				timeSignature: c.timeSignature,
				bars: [],
				warnings: []
			}
		: null;
}
export function embeddedSystemResult(
	system: ExtractedSystem,
	partial = false
): SystemRecognitionResult | null {
	const bars = system.glyphBars;
	if (!bars?.length || !bars.some(Boolean) || (!partial && bars.some((b) => !b))) return null;
	return {
		...(embeddedHeader(system) ?? { keySignature: null, clef: null, timeSignature: null }),
		bars: bars.map((b) => b ?? emptyBar()),
		warnings: bars.flatMap((b, i) =>
			b ? [] : [`bar ${i + 1}: melody could not be read; check the original PDF`]
		)
	};
}
export function mergeEmbeddedSystem(
	system: ExtractedSystem,
	optical: SystemRecognitionResult,
	context: RecognitionContext
): SystemRecognitionResult {
	if (optical.bars.length !== system.geometry.barlines.length)
		throw new Error('Optical measure count does not match the PDF layout.');
	if (!system.glyphs) return optical;
	const pitches = applyGlyphPitches(optical.bars, system.glyphs, context);
	const bars = pitches.bars.map((bar, i) => system.glyphBars?.[i] ?? bar);
	const warnings = [...optical.warnings, ...pitches.warnings].filter((w) => {
		const m = /\bbar (\d+):/i.exec(w);
		return !m || !system.glyphBars?.[Number(m[1]) - 1];
	});
	return {
		...optical,
		bars,
		warnings,
		keySignature:
			system.glyphs.context.fifths != null
				? { fifths: system.glyphs.context.fifths }
				: optical.keySignature,
		clef: system.glyphs.context.clef ?? optical.clef
	};
}

/** One fusion policy shared by the upload flow and the accuracy evaluator.
 * A complete embedded read wins. Otherwise optical recognition fills gaps;
 * failure retains only independently read measures, at their original indexes.
 */
export async function recognizeExtractedSystem(
	system: ExtractedSystem,
	context: RecognitionContext,
	optical?: (harmonyOnly: boolean) => Promise<SystemRecognitionResult>,
	fallback?: SystemRecognitionResult | null,
	signal?: AbortSignal
): Promise<SystemRecognitionResult | null> {
	const complete =
		embeddedSystemResult(system) ??
		(fallback ? mergeEmbeddedSystem(system, fallback, context) : null);
	if (complete) {
		if (system.texts.chords.length) return complete;
		if (!optical)
			return {
				...complete,
				warnings: [
					...complete.warnings,
					'Chord symbols need review; no optical reader is configured.'
				]
			};
		try {
			const harmony = await optical(true);
			return {
				...complete,
				harmony: harmony.harmony,
				warnings: [...complete.warnings, ...harmony.warnings]
			};
		} catch (error) {
			if (signal?.aborted) throw error;
			return {
				...complete,
				warnings: [
					...complete.warnings,
					'Chord recognition failed; the recognized melody was retained. Check harmony against the PDF.'
				]
			};
		}
	}
	if (!optical) return embeddedSystemResult(system, true);
	try {
		return mergeEmbeddedSystem(system, await optical(false), context);
	} catch (error) {
		if (signal?.aborted) throw error;
		const partial = embeddedSystemResult(system, true);
		if (partial) return partial;
		throw error;
	}
}

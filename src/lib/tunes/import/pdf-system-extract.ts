import { canvasToPng, releaseCanvas } from './pdf-canvas';
import { appendPitchPanels, measureSourceLeft } from './pdf-review-image';
/**
 * Browser-side deterministic pass of the PDF import: render each page with
 * pdf.js, find staff systems and barlines (`analyzePageGeometry`), read
 * chords/marks/bar numbers from the text layer (`extractSystemTexts`), and
 * crop each system to a PNG for the parse route's per-system mode.
 *
 * Browser-only (canvas + pdf.js); the pure merge lives in
 * `pdf-system-assemble.ts`. Validated against the five reference charts via
 * the geometry probes — see tests/integration/pdf-vs-musescore.test.ts.
 */
import { systemBarBoundaries } from './pdf-system-assemble';
import { systemCropBounds, layoutIssues } from './pdf-layout';
import { extractGlyphNotation, type GlyphNotation } from './pdf-glyphs';
import { extractVectorPaths } from './pdf-vector-paths';
import {
	readGlyphBars,
	readGlyphTieEdges,
	connectGlyphTies,
	type GlyphTieEdges
} from './pdf-glyph-rhythm';
import { normalizeLegacyText } from './pdf-legacy-text';
import { isLegacyNotationFont } from './pdf-notation-fonts';
import { extractMusicGlyphs } from './pdf-music-glyphs';
import { refineGlyphLayout, supplementGlyphLayout } from './pdf-glyph-layout';
import { readGlyphForm } from './pdf-glyph-form';
import type { RecognizedBar, RecognitionContext } from './pdf-recognition';
import { analyzePageGeometry, type SystemGeometry } from './pdf-geometry';
import { extractSystemTexts, type PageTextItem, type SystemTexts } from './pdf-text-chords';
import { detectNoteEvents, barEvidence, type BarEvidence, type NoteEvent } from './pdf-noteheads';

export interface ExtractedSystem {
	glyphs?: GlyphNotation | null;
	glyphTieEdges?: GlyphTieEdges;
	glyphBars?: Array<RecognizedBar | null>;
	geometry: SystemGeometry;
	texts: SystemTexts;
	/** Per-bar notehead evidence (counts + letter names) for the route's
	 * soft cross-check. */
	evidence: BarEvidence[];
	/** Raw detected note events — chord beats anchor to notehead x's. */
	noteEvents: NoteEvent[];
	/** PNG data URL crop of this system, for the parse route. */
	image: string;
	/** Clef/key/meter crop for the inexpensive context pass. */
	headerImage: string;
	/** Isolated measures with numbered staff coordinates for focused pitch review. */
	barImages: string[];
	/** Unannotated original measures for the correction workflow. */
	sourceBarImages?: string[];
}

export interface PdfSystemExtraction {
	systems: ExtractedSystem[];
	title: string | null;
	composer: string | null;
}

/** Render scale: the geometry thresholds were validated at 4 (interline
 * ≈ 20px on letter-size MuseScore parts). */
const SCALE = 4;

/**
 * pdf.js 6 calls Math.sumPrecise (a 2025 JS builtin) in its font code;
 * browsers without it render every glyph as a tofu box, which starves the
 * geometry pass. Kahan-compensated fallback, installed before pdf.js loads.
 */
function installSumPrecisePolyfill(): void {
	const m = Math as unknown as { sumPrecise?: (values: Iterable<number>) => number };
	m.sumPrecise ??= (values: Iterable<number>): number => {
		let sum = 0;
		let c = 0;
		for (const v of values) {
			const y = v - c;
			const t = sum + y;
			c = t - sum - y;
			sum = t;
		}
		return sum;
	};
}

/**
 * Run the deterministic pass over a PDF. Returns null when no staff system
 * is found (not a chart, or a scan too degraded for the geometry) — the
 * caller falls back to whole-PDF extraction.
 */
export async function extractPdfSystems(
	buffer: ArrayBuffer,
	/** Reports page-by-page progress; rendering a dense chart is not instant. */
	onProgress?: (page: number, totalPages: number) => void,
	timeSignature: [number, number] = [4, 4]
): Promise<PdfSystemExtraction | null> {
	installSumPrecisePolyfill();
	// Fake-worker mode: the worker module runs on the main thread, where the
	// polyfill above covers it. Import PDFs are small; parse time is fine.
	const [pdfjs] = await Promise.all([
		import('pdfjs-dist'),
		import('pdfjs-dist/build/pdf.worker.mjs' as string).then((worker) => {
			(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
		})
	]);

	const loading = pdfjs.getDocument({ data: buffer.slice(0), disableFontFace: true });
	const doc = await loading.promise;
	const pageCanvases: HTMLCanvasElement[] = [];
	try {
		const systems: ExtractedSystem[] = [];
		const farItems: Array<PageTextItem & { page: number }> = [];
		let glyphContext: RecognitionContext = { clef: null, fifths: null, timeSignature };

		for (let p = 1; p <= doc.numPages; p++) {
			onProgress?.(p, doc.numPages);
			const pg = await doc.getPage(p);
			const vp = pg.getViewport({ scale: SCALE });
			const canvas = document.createElement('canvas');
			pageCanvases.push(canvas);
			canvas.width = Math.ceil(vp.width);
			canvas.height = Math.ceil(vp.height);
			const ctx = canvas.getContext('2d', { willReadFrequently: true });
			if (!ctx) return null;
			await pg.render({ canvas, canvasContext: ctx, viewport: vp }).promise;

			const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
			const pageSystems = analyzePageGeometry(img);
			if (!pageSystems.length) return null;

			const text = await pg.getTextContent();
			const items: PageTextItem[] = text.items.map((raw) => {
				const it = raw as {
					str: string;
					transform: number[];
					height: number;
					width: number;
					fontName?: string;
				};
				const [, , , , e, f] = pdfjs.Util.transform(vp.transform, it.transform);
				return {
					str: it.str,
					x: Math.round(e),
					y: Math.round(f),
					h: Math.round(it.height * SCALE),
					w: Math.round(it.width * SCALE),
					font: it.fontName
				};
			});

			const operators = await pg.getOperatorList();
			const vectorPaths = extractVectorPaths(operators, pdfjs.OPS, vp.transform);
			const fontNames: Record<string, string> = {};
			for (let i = 0; i < operators.fnArray.length; i++) {
				if (operators.fnArray[i] !== pdfjs.OPS.setFont) continue;
				const id = operators.argsArray[i]?.[0];
				if (typeof id !== 'string' || fontNames[id]) continue;
				try {
					const font = pg.commonObjs.get(id);
					if (typeof font?.name === 'string') fontNames[id] = font.name;
				} catch {
					/* Unresolved fonts retain the existing recognition fallback. */
				}
			}
			const notationItems = [
				...items.filter(
					(i) => !/[\ue000-\uf8ff]/.test(i.str) && !isLegacyNotationFont(fontNames[i.font ?? ''])
				),
				...extractMusicGlyphs(operators, pdfjs.OPS, vp.transform, fontNames)
			];
			if (layoutIssues(pageSystems).length)
				for (let i = 0; i < pageSystems.length; i++)
					pageSystems[i] = refineGlyphLayout(pageSystems[i], notationItems, vectorPaths);
			for (let i = 0; i < pageSystems.length; i++)
				pageSystems[i] = supplementGlyphLayout(pageSystems[i], notationItems, vectorPaths);
			if (layoutIssues(pageSystems).length) return null;
			const texts = extractSystemTexts(normalizeLegacyText(items, fontNames), pageSystems);
			for (let i = 0; i < pageSystems.length; i++) {
				const form = readGlyphForm(pageSystems[i], notationItems, texts[i], vectorPaths);
				pageSystems[i] = form.geometry;
				texts[i] = form.texts;
			}

			// Title/composer candidates: text clear of every system's zone.
			if (p === 1 && pageSystems.length > 0) {
				const firstTop = pageSystems[0].band.top;
				for (const it of items) {
					if (it.str.trim() && it.y < firstTop - 8.5 * pageSystems[0].interline) {
						farItems.push({ ...it, page: p });
					}
				}
			}

			for (let i = 0; i < pageSystems.length; i++) {
				const [y0, y1] = systemCropBounds(pageSystems, i, canvas.height);
				const crop = document.createElement('canvas');
				crop.width = canvas.width;
				crop.height = y1 - y0;
				const cropCtx = crop.getContext('2d');
				if (!cropCtx) return null;
				cropCtx.drawImage(canvas, 0, y0, canvas.width, y1 - y0, 0, 0, canvas.width, y1 - y0);
				const header = document.createElement('canvas');
				header.width = Math.min(crop.width, Math.ceil(pageSystems[i].barlines[0]));
				header.height = crop.height;
				header.getContext('2d')?.drawImage(crop, 0, 0);
				const image = canvasToPng(crop);
				const headerImage = canvasToPng(header);
				const boundaries = systemBarBoundaries(pageSystems[i]);
				const { band, interline } = pageSystems[i];
				const barTop = Math.max(0, Math.floor(band.top - 3 * interline));
				const barBottom = Math.min(canvas.height, Math.ceil(band.bottom + 3 * interline));
				const sourceBarImages: string[] = [];
				const detected = detectNoteEvents(img, pageSystems[i]);
				const barImages = pageSystems[i].barlines.map((right, b) => {
					const left = measureSourceLeft(boundaries[b], b, interline);
					const measure = document.createElement('canvas');
					measure.width = Math.ceil(right - left) + 48;
					measure.height = barBottom - barTop;
					const c = measure.getContext('2d')!;
					c.fillStyle = 'white';
					c.fillRect(0, 0, measure.width, measure.height);
					c.drawImage(
						canvas,
						left,
						barTop,
						right - left,
						measure.height,
						48,
						0,
						right - left,
						measure.height
					);
					const original = document.createElement('canvas');
					original.width = Math.ceil(right - left);
					original.height = y1 - y0;
					original
						.getContext('2d')
						?.drawImage(canvas, left, y0, right - left, y1 - y0, 0, 0, right - left, y1 - y0);
					sourceBarImages.push(canvasToPng(original));
					c.fillStyle = '#2452a1';
					c.font = `${Math.max(8, interline * 0.48)}px sans-serif`;
					c.textAlign = 'right';
					c.textBaseline = 'middle';
					for (let position = -4; position <= 12; position++) {
						const y = band.bottom - barTop - (position * interline) / 2;
						c.fillText(String(position), 36, y);
					}
					try {
						return canvasToPng(appendPitchPanels(
							canvas, measure, pageSystems[i], detected, left, right
						));
					} finally {
						releaseCanvas(measure);
					}
				});
				const glyphs = extractGlyphNotation(notationItems, pageSystems[i], systems.length === 0);
				if (glyphs)
					glyphContext = {
						...glyphContext,
						clef: glyphs.context.clef ?? glyphContext.clef,
						fifths: glyphs.context.fifths ?? glyphContext.fifths
					};
				const noteEvents = glyphs
					? pageSystems[i].barlines.flatMap(
							(right, b) =>
								glyphs.bars[b]?.map((n) => ({
									x: n.x,
									anchorX: n.x,
									position: n.position,
									kind: n.head === 'whole' ? ('hollow' as const) : ('stemmed' as const)
								})) ?? detected.filter((n) => n.anchorX >= boundaries[b] && n.anchorX < right)
						)
					: detected;
				systems.push({
					glyphs,
					glyphTieEdges: glyphs
						? readGlyphTieEdges(pageSystems[i], vectorPaths, glyphs)
						: undefined,
					glyphBars: glyphs
						? readGlyphBars(
								notationItems,
								pageSystems[i],
								vectorPaths,
								glyphs,
								glyphContext,
								systems.length === 0
							)
						: undefined,
					geometry: pageSystems[i],
					texts: texts[i],
					evidence: barEvidence(noteEvents, pageSystems[i]),
					noteEvents,
					image,
					headerImage,
					barImages,
					sourceBarImages
				});
			}
			releaseCanvas(canvas);
			pg.cleanup();
		}

		if (systems.length === 0 || systems.some((s) => s.geometry.barlines.length === 0)) {
			return null;
		}

		// Title: the tallest text above the first system; composer: the next
		// distinct item on its right half (MuseScore's layout convention).
		let title: string | null = null;
		let composer: string | null = null;
		const sorted = [...farItems].sort((a, b) => b.h - a.h);
		if (sorted.length > 0) {
			title = sorted[0].str.trim();
			const titleRight = sorted[0].x + sorted[0].w;
			const candidate = sorted.find(
				(it) => it !== sorted[0] && it.h < sorted[0].h && (it.x > titleRight || it.y > sorted[0].y)
			);
			if (candidate) composer = candidate.str.trim();
		}

		connectGlyphTies(systems);
		return { systems, title, composer };
	} finally {
		for (const canvas of pageCanvases) releaseCanvas(canvas);
		await loading.destroy();
	}
}

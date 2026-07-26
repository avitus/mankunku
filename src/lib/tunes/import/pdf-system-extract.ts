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
import {
	analyzePageGeometry,
	type SystemGeometry
} from './pdf-geometry';
import { extractSystemTexts, type PageTextItem, type SystemTexts } from './pdf-text-chords';
import { detectNoteEvents, barEvidence, type BarEvidence, type NoteEvent } from './pdf-noteheads';

export interface ExtractedSystem {
	geometry: SystemGeometry;
	texts: SystemTexts;
	/** Per-bar notehead evidence (counts + letter names) for the route's
	 * soft cross-check. */
	evidence: BarEvidence[];
	/** Raw detected note events — chord beats anchor to notehead x's. */
	noteEvents: NoteEvent[];
	/** PNG data URL crop of this system, for the parse route. */
	image: string;
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
export async function extractPdfSystems(buffer: ArrayBuffer): Promise<PdfSystemExtraction | null> {
	installSumPrecisePolyfill();
	// Fake-worker mode: the worker module runs on the main thread, where the
	// polyfill above covers it. Import PDFs are small; parse time is fine.
	const [pdfjs] = await Promise.all([
		import('pdfjs-dist'),
		import('pdfjs-dist/build/pdf.worker.mjs' as string).then((worker) => {
			(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
		})
	]);

	const doc = await pdfjs.getDocument({ data: buffer.slice(0), disableFontFace: true }).promise;
	const systems: ExtractedSystem[] = [];
	const farItems: Array<PageTextItem & { page: number }> = [];

	for (let p = 1; p <= doc.numPages; p++) {
		const pg = await doc.getPage(p);
		const vp = pg.getViewport({ scale: SCALE });
		const canvas = document.createElement('canvas');
		canvas.width = Math.ceil(vp.width);
		canvas.height = Math.ceil(vp.height);
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		if (!ctx) return null;
		await pg.render({ canvas, canvasContext: ctx, viewport: vp }).promise;

		const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
		const pageSystems = analyzePageGeometry(img);

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
		const texts = extractSystemTexts(items, pageSystems);

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
			const { band, interline } = pageSystems[i];
			const y0 = Math.max(0, Math.round(band.top - 6 * interline));
			const y1 = Math.min(canvas.height, Math.round(band.bottom + 6 * interline));
			const crop = document.createElement('canvas');
			crop.width = canvas.width;
			crop.height = y1 - y0;
			const cropCtx = crop.getContext('2d');
			if (!cropCtx) return null;
			cropCtx.drawImage(canvas, 0, y0, canvas.width, y1 - y0, 0, 0, canvas.width, y1 - y0);
			const noteEvents = detectNoteEvents(img, pageSystems[i]);
			systems.push({
				geometry: pageSystems[i],
				texts: texts[i],
				evidence: barEvidence(noteEvents, pageSystems[i]),
				noteEvents,
				image: crop.toDataURL('image/png')
			});
		}
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

	return { systems, title, composer };
}

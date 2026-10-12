/** Staff-aware shape observations, independent of pitch spelling and recognition providers. */
import type { PageImage, SystemGeometry } from './pdf-geometry';
export interface RasterHead {
	x: number;
	y: number;
	position: number;
	/** Template agreement, not a calibrated probability of correctness. */
	score: number;
	hollow: boolean;
}
export type InkReader = (x: number, y: number) => boolean;
export function pageInk(page: PageImage): InkReader {
	return (x, y) => {
		x = Math.round(x);
		y = Math.round(y);
		if (x < 0 || y < 0 || x >= page.width || y >= page.height) return false;
		const i = (y * page.width + x) * 4;
		return (
			page.data[i] < 128 && page.data[i + 1] < 128 && page.data[i + 2] < 128 && page.data[i + 3] > 0
		);
	};
}

/** Match compact elliptical heads, excluding staff rows from both ink and whitespace scores.
 * Negative space matters: a tie arc over a staff line must not become a hollow head.
 * Small scale/angle variants accommodate engraved and handwritten oval shapes.
 */
export function rasterHeadCandidates(
	page: PageImage,
	system: SystemGeometry,
	x0: number,
	x1: number
): RasterHead[] {
	const il = system.interline,
		dark = pageInk(page);
	if (!Number.isFinite(il) || il < 6) return [];
	const templates: Array<{
		hollow: boolean;
		points: Array<{ dx: number; dy: number; ink: boolean }>;
	}> = [];
	const step = Math.max(1, Math.round(il / 10));
	for (const angle of [0, -0.45])
		for (const hollow of [false, true])
			for (const scale of [1, 1.2]) {
				const points: Array<{ dx: number; dy: number; ink: boolean }> = [];
				for (let dy = -Math.ceil(il); dy <= il; dy += step)
					for (let dx = -Math.ceil(il); dx <= il; dx += step) {
						const u = (dx * Math.cos(angle) + dy * Math.sin(angle)) / (0.72 * il * scale);
						const v = (-dx * Math.sin(angle) + dy * Math.cos(angle)) / (0.42 * il * scale);
						const r = u * u + v * v;
						if (r < 0.85 && (!hollow || r > 0.33)) points.push({ dx, dy, ink: true });
						else if ((r > 1.5 && r < 2.6) || (hollow && r < 0.18))
							points.push({ dx, dy, ink: false });
					}
				templates.push({ hollow, points });
			}
	const candidates: RasterHead[] = [];
	for (let position = -6; position <= 14; position++) {
		const y = Math.round(system.band.bottom - (position * il) / 2);
		if (y < il || y >= page.height - il) continue;
		const lines = [...system.band.lines];
		for (let p = -2; p >= position; p -= 2) lines.push(system.band.bottom - (p * il) / 2);
		for (let p = 10; p <= position; p += 2) lines.push(system.band.bottom - (p * il) / 2);
		const masks = templates.map((t) => ({
			...t,
			points: t.points.filter((p) => !lines.some((line) => Math.abs(line - y - p.dy) <= 0.18 * il))
		}));
		for (
			let x = Math.max(Math.ceil(il), Math.ceil(x0 + il));
			x <= Math.min(page.width - il - 1, x1);
			x += step
		) {
			let best: RasterHead | null = null;
			for (const template of masks) {
				let ink = 0,
					inkN = 0,
					white = 0,
					whiteN = 0;
				for (const p of template.points) {
					const hit = dark(x + p.dx, y + p.dy);
					if (p.ink) {
						ink += Number(hit);
						inkN++;
					} else {
						white += Number(!hit);
						whiteN++;
					}
				}
				const coverage = ink / inkN,
					clearance = white / whiteN;
				const score = 0.65 * coverage + 0.35 * clearance;
				if (coverage > 0.75 && clearance > 0.65 && score > 0.88 && (!best || score > best.score))
					best = { x, y, position, score, hollow: template.hollow };
			}
			if (best) candidates.push(best);
		}
	}
	candidates.sort((a, b) => b.score - a.score);
	const kept: RasterHead[] = [];
	for (const head of candidates)
		if (!kept.some((h) => Math.abs(h.x - head.x) < il && Math.abs(h.y - head.y) < il))
			kept.push(head);
	return kept.sort((a, b) => a.x - b.x);
}

/** Require a correctly oriented stem extending away from the head, beyond its oval. */
export function attachedStem(head: RasterHead, dark: InkReader, il: number): number | null {
	for (const direction of [-1, 1]) {
		for (let dx = Math.round(0.35 * il); dx <= Math.round(0.95 * il); dx++) {
			const x = Math.round(head.x - direction * dx);
			let ink = 0,
				total = 0;
			for (let dy = Math.round(0.7 * il); dy <= Math.round(2.6 * il); dy++) {
				ink += Number(dark(x, Math.round(head.y + direction * dy)));
				total++;
			}
			if (ink / total >= 0.85) return x;
		}
	}
	return null;
}

/** Beyond the staff, require the ledger strokes that distinguish notes from chord text. */
export function hasLedgerSupport(
	head: RasterHead,
	dark: InkReader,
	system: SystemGeometry
): boolean {
	const il = system.interline;
	const required: number[] = [];
	if (head.position >= 10) for (let p = 10; p <= head.position; p += 2) required.push(p);
	if (head.position <= -2) for (let p = -2; p >= head.position; p -= 2) required.push(p);
	return required.every((position) => {
		const y = Math.round(system.band.bottom - (position * il) / 2);
		return [-1, 1].every((side) => {
			for (let dy = -Math.ceil(0.15 * il); dy <= 0.15 * il; dy++) {
				let ink = 0,
					total = 0;
				for (let dx = Math.round(0.8 * il); dx <= Math.round(1.1 * il); dx++) {
					ink += Number(dark(Math.round(head.x + side * dx), y + dy));
					total++;
				}
				if (ink / total >= 0.7) return true;
			}
			return false;
		});
	});
}

/** Median printed staff thickness, in pixels, from horizontal coverage rather than note ink. */
export function staffLineThickness(page: PageImage, system: SystemGeometry): number {
	const dark = pageInk(page),
		il = system.interline;
	const left = Math.max(0, Math.ceil(system.firstBarLeft)),
		right = Math.min(page.width, system.barlines.at(-1) ?? page.width);
	const widths = system.band.lines
		.map((line) => {
			let rows = 0;
			for (
				let y = Math.max(0, Math.round(line - 0.3 * il));
				y <= Math.min(page.height - 1, line + 0.3 * il);
				y++
			) {
				let ink = 0,
					total = 0;
				for (let x = left; x < right; x += 4) {
					ink += Number(dark(x, y));
					total++;
				}
				if (total && ink / total > 0.5) rows++;
			}
			return rows;
		})
		.sort((a, b) => a - b);
	return widths[Math.floor(widths.length / 2)] ?? 0;
}

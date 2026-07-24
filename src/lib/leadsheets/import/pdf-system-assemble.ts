/**
 * Assemble the bar-wise extraction doc (the `claudeJsonToLeadSheet` v2
 * input) from the three per-system ingredients of the deterministic PDF
 * pipeline:
 *
 *  - geometry (staff bands + barlines) — authoritative bar counts;
 *  - text layer (chords, marks, printed bar numbers) — authoritative
 *    harmony;
 *  - the model's per-system transcription — melody, repeats, endings,
 *    pickup flags (the only parts that genuinely need vision).
 *
 * Pure function: all browser work (rendering, cropping, route calls)
 * happens in the import page; this just merges the results.
 */
import type { SystemGeometry } from './pdf-geometry';
import type { SystemTexts } from './pdf-text-chords';

/** One bar as returned by the parse route's system mode. */
export interface ModelBar {
	startRepeat: boolean;
	endRepeat: boolean;
	ending: number | null;
	pickup: boolean;
	melody: Array<[number, number, string] | [number, number, string, boolean]>;
}

export interface AssembleSystemInput {
	geometry: SystemGeometry;
	texts: SystemTexts;
	model: { fifths: number | null; bars: ModelBar[] };
}

export interface AssembleMeta {
	title: string;
	composer?: string | null;
	timeSignature: [number, number];
}

/**
 * Bar boundaries for beat interpolation. Single-staff systems draw no
 * initial barline, and the first bar's left edge is hidden behind the
 * clef/key header — approximate it as one median bar width before the
 * first barline.
 */
export function systemBarBoundaries(geometry: SystemGeometry): number[] {
	const bl = geometry.barlines;
	if (bl.length === 0) return [];
	// The measured header end is the real first-bar left edge; fall back to
	// one median bar width for degenerate measurements.
	if (geometry.firstBarLeft > 0 && geometry.firstBarLeft < bl[0] - geometry.interline) {
		return [geometry.firstBarLeft, ...bl];
	}
	const widths = bl
		.slice(1)
		.map((x, i) => x - bl[i])
		.sort((a, b) => a - b);
	const median = widths.length ? widths[Math.floor(widths.length / 2)] : 8 * geometry.interline;
	return [Math.max(0, bl[0] - median), ...bl];
}

export function assembleClaudeDoc(systems: AssembleSystemInput[], meta: AssembleMeta): unknown {
	const [tsNum] = meta.timeSignature;

	// Key signature: majority vote across the per-system readings.
	const votes = new Map<number, number>();
	for (const s of systems) {
		if (s.model.fifths !== null) votes.set(s.model.fifths, (votes.get(s.model.fifths) ?? 0) + 1);
	}
	let fifths = 0;
	let best = 0;
	for (const [f, n] of votes) {
		if (n > best) {
			best = n;
			fifths = f;
		}
	}

	const docSystems = systems.map((sys, sysIndex) => {
		const boundaries = systemBarBoundaries(sys.geometry);
		const barCount = sys.geometry.barlines.length;

		// Bars come from the model but the COUNT comes from geometry: pad or
		// truncate a disagreeing transcription (the route already retried).
		const bars = Array.from({ length: barCount }, (_, i): ModelBar => {
			return (
				sys.model.bars[i] ?? {
					startRepeat: false,
					endRepeat: false,
					ending: null,
					pickup: false,
					melody: []
				}
			);
		});

		// Chord beats from raw interpolation, then musical snapping: a bar's
		// leading chord sits on the downbeat, and TWO chords in a 4/4 bar
		// land on beats 1 and 3 unless the print position is decisively
		// later (interpolation noise cannot distinguish 2.4 from 2.6, but
		// no jazz chart splits a bar 1/2.5).
		const contentPad = 0.75 * sys.geometry.interline;
		const rawByBar = new Map<number, Array<{ raw: number; text: string }>>();
		for (const chord of sys.texts.chords) {
			if (boundaries.length < 2) continue;
			if (chord.x > boundaries[boundaries.length - 1]) continue;
			let barIdx = 0;
			for (let b = 0; b + 1 < boundaries.length; b++) {
				if (chord.x < boundaries[b + 1]) {
					barIdx = b;
					break;
				}
				barIdx = b;
			}
			const start = boundaries[barIdx] + contentPad;
			const width = boundaries[barIdx + 1] - start;
			const raw = width > 0 ? Math.max(0, ((chord.x - start) / width) * tsNum) : 0;
			const list = rawByBar.get(barIdx) ?? [];
			list.push({ raw, text: chord.text });
			rawByBar.set(barIdx, list);
		}
		const chordsByBar = new Map<number, Array<[number, string]>>();
		for (const [barIdx, list] of rawByBar) {
			list.sort((a, b) => a.raw - b.raw);
			const beats = list.map(({ raw }, k) => {
				if (k === 0 && (barIdx === 0 || raw < 0.8)) return 0;
				if (tsNum === 4 && list.length === 2 && k === 1) return raw >= 3 ? 3 : 2;
				return Math.min(Math.round(raw * 2) / 2, tsNum - 0.5);
			});
			chordsByBar.set(
				barIdx,
				list.map(({ text }, k) => [beats[k], text])
			);
		}

		// Volta labels are printed facts; the model's per-bar ending flags
		// are its least reliable output. When labels exist, they win: ending
		// n runs from its label's bar to the bar before the next label, or
		// the system end (lead-sheet endings don't span systems).
		const endingByBar = new Map<number, 1 | 2>();
		if (sys.texts.endings.length > 0) {
			const labeled = sys.texts.endings
				.filter((e) => e.n === 1 || e.n === 2)
				.map((e) => {
					let b = barCount - 1;
					for (let i = 0; i + 1 < boundaries.length; i++) {
						if (e.x < boundaries[i + 1] - sys.geometry.interline) {
							b = i;
							break;
						}
					}
					return { bar: b, n: e.n as 1 | 2 };
				})
				.sort((a, b) => a.bar - b.bar);
			for (let i = 0; i < labeled.length; i++) {
				const to = i + 1 < labeled.length ? labeled[i + 1].bar - 1 : barCount - 1;
				for (let b = labeled[i].bar; b <= to; b++) endingByBar.set(b, labeled[i].n);
			}
		}

		// A rehearsal mark labels the bar whose start boundary it sits at.
		const markByBar = new Map<number, string>();
		for (const mark of sys.texts.marks) {
			let nearest = 0;
			let bestDist = Number.POSITIVE_INFINITY;
			for (let b = 0; b < barCount; b++) {
				const dist = Math.abs(mark.x - boundaries[b]);
				if (dist < bestDist) {
					bestDist = dist;
					nearest = b;
				}
			}
			if (!markByBar.has(nearest)) markByBar.set(nearest, mark.text);
		}

		// Volta semantics are universal: ending 1 closes with :|, and repeat
		// flags never live on other ending bars — normalize the model's
		// attribution, which drifts around the winged repeat barline.
		let lastEnding1 = -1;
		for (const [b, n] of endingByBar) if (n === 1 && b > lastEnding1) lastEnding1 = b;

		// Sheet-opening pickup decision, hoisted so the mark shift below can
		// use it: the model's flag, the narrow-first-bar evidence (time
		// signature to first barline well under the median bar width), or a
		// melody that only starts in the back half of the meter.
		let firstBarPickup = false;
		if (sysIndex === 0 && bars.length > 0) {
			firstBarPickup = bars[0].pickup;
			if (!firstBarPickup) {
				const bl = sys.geometry.barlines;
				const widths = bl
					.slice(1)
					.map((x, k) => x - bl[k])
					.sort((a, b) => a - b);
				const median = widths.length ? widths[Math.floor(widths.length / 2)] : 0;
				const bar0Width = bl.length ? bl[0] - sys.geometry.firstBarLeft : 0;
				if (median > 0 && bar0Width < 0.8 * median) firstBarPickup = true;
			}
			if (!firstBarPickup && bars[0].melody.length > 0) {
				const firstOnset = Math.min(...bars[0].melody.map((n) => n[0]));
				if (firstOnset >= tsNum / 2) firstBarPickup = true;
			}
		}
		// A rehearsal mark never labels a pickup bar — engraving may print
		// the label over the pickup, but it anchors to the first FULL bar.
		if (firstBarPickup && markByBar.has(0) && !markByBar.has(1) && barCount > 1) {
			markByBar.set(1, markByBar.get(0) as string);
			markByBar.delete(0);
		}
		return {
			firstBarNumber: sys.texts.barNumber,
			bars: bars.map((bar, i) => {
				const ending =
					sys.texts.endings.length > 0
						? (endingByBar.get(i) ?? null)
						: bar.ending === 1 || bar.ending === 2
							? bar.ending
							: null;
				const pickup = sysIndex === 0 && i === 0 ? firstBarPickup : bar.pickup;
				const underLabel = endingByBar.has(i);
				// Repeat flags are the model's least reliable output; the
				// printed dots beside a barline are the evidence. A |: needs
				// dots RIGHT of the boundary starting the bar (bar 0 of a
				// system has no start boundary — unverifiable, suppressed); a
				// :| needs dots LEFT of the boundary ending it. Volta labels
				// stay authoritative for the ending bars themselves.
				const dotsConfirmStart = i > 0 && (sys.geometry.repeatDots[i - 1]?.right ?? false);
				const dotsConfirmEnd = sys.geometry.repeatDots[i]?.left ?? false;
				return {
					mark: markByBar.get(i) ?? null,
					startRepeat: underLabel ? false : bar.startRepeat && dotsConfirmStart,
					endRepeat:
						endingByBar.get(i) === 2
							? false
							: lastEnding1 >= 0
								? i === lastEnding1
								: bar.endRepeat && dotsConfirmEnd,
					ending,
					pickup,
					chords: chordsByBar.get(i) ?? [],
					melody: bar.melody
				};
			})
		};
	});

	return {
		title: meta.title,
		composer: meta.composer ?? null,
		style: null,
		keySignature: { fifths },
		timeSignature: meta.timeSignature,
		systems: docSystems
	};
}

/** Conservative monophonic reading of explicit PDF notation geometry.
 * Unsupported rhythms/voices decline the measure; no time is filled by guesswork.
 */
import { resolvePrintedTriplets } from './pdf-tuplets';
import type { PageTextItem } from './pdf-text-chords';
import type { SystemGeometry } from './pdf-geometry';
import type { VectorPath } from './pdf-vector-paths';
import type { GlyphNotation } from './pdf-glyphs';
import type { RecognizedBar, RecognitionContext } from './pdf-recognition';
import { resolveStaffEvents, type StaffEvent } from './staff-pitch';
interface Event extends StaffEvent {
	x: number;
	center: number;
}
const restDurations: Record<string, number> = {
	'\ue4e3': 4,
	'\ue4e4': 2,
	'\ue4e5': 1,
	'\ue4e6': 0.5,
	'\ue4e7': 0.25,
	'\ue4e8': 0.125,
	'\ue4e9': 0.0625
};
const flags: Record<string, number> = {
	'\ue240': 1,
	'\ue241': 1,
	'\ue242': 2,
	'\ue243': 2,
	'\ue244': 3,
	'\ue245': 3
};
const bounds = (p: VectorPath) => ({
	left: Math.min(...p.points.map((p) => p[0])),
	right: Math.max(...p.points.map((p) => p[0])),
	top: Math.min(...p.points.map((p) => p[1])),
	bottom: Math.max(...p.points.map((p) => p[1]))
});
export function readGlyphBars(
	items: PageTextItem[],
	system: SystemGeometry,
	paths: VectorPath[],
	notation: GlyphNotation,
	context: RecognitionContext,
	first = false
): Array<RecognizedBar | null> {
	const clef = notation.context.clef ?? context.clef,
		fifths = notation.context.fifths ?? context.fifths,
		meter = context.timeSignature;
	if (
		!clef ||
		fifths === null ||
		!meter ||
		(notation.context.timeSignature && notation.context.timeSignature.join('/') !== meter.join('/'))
	)
		return notation.bars.map(() => null);
	const il = system.interline,
		beats = meter[0],
		scale = meter[1] / 4;
	const nearby = items
		.filter((i) => i.y >= system.band.top - 4 * il && i.y <= system.band.bottom + 4 * il)
		.map((i) => ({ ...i, str: i.str.trim() }));
	const strokes = paths
		.filter(
			(p) =>
				!p.curved &&
				!p.filled &&
				p.points.length === 2 &&
				Math.abs(p.points[0][0] - p.points[1][0]) < 0.12 * il &&
				p.width < 0.3 * il
		)
		.map((p) => ({ ...bounds(p), x: p.points[0][0] }));
	const beams = paths
		.filter((p) => p.filled && !p.curved && p.points.length >= 4)
		.map((p) => ({ ...bounds(p), p }))
		.filter(
			(b) => b.right - b.left > il && b.bottom - b.top > 0.2 * il && b.bottom - b.top < 2 * il
		);
	const curves = paths
		.filter((p) => p.curved && p.filled && p.points.length === 7)
		.map((p) => ({ ...bounds(p), startY: p.points[0][1], endY: p.points[3][1] }));
	const groups: Array<Event[] | null> = notation.bars.map((notes, b) => {
		if (!notes) return null;
		const left = b ? system.barlines[b - 1] : system.firstBarLeft,
			right = system.barlines[b];
		const events: Event[] = [];
		for (const note of notes) {
			const y = system.band.bottom - (note.position * il) / 2;
			const glyph = nearby.find(
				(i) => Math.abs(i.x - note.x) < 1 && /^[\ue0a2-\ue0a4]$/.test(i.str)
			);
			if (!glyph) return null;
			let duration = note.head === 'whole' ? 4 : note.head === 'half' ? 2 : 1;
			if (note.head === 'black') {
				const stems = strokes.filter(
					(s) =>
						Math.min(Math.abs(s.x - note.x), Math.abs(s.x - note.x - glyph.w)) < 0.25 * il &&
						Math.min(Math.abs(s.top - y), Math.abs(s.bottom - y)) < 0.5 * il &&
						s.bottom - s.top > 2.2 * il &&
						s.bottom - s.top < 8 * il
				);
				if (stems.length !== 1) return null;
				const stem = stems[0];
				const printedFlags = nearby.filter(
					(i) =>
						flags[i.str] &&
						Math.abs(i.x - stem.x) < 0.4 * il &&
						i.y >= stem.top - il &&
						i.y <= stem.bottom + il
				);
				const touching = beams.filter(
					(b) =>
						stem.x >= b.left - 0.2 * il &&
						stem.x <= b.right + 0.2 * il &&
						b.bottom >= stem.top - 0.3 * il &&
						b.top <= stem.bottom + 0.3 * il &&
						Math.min(Math.abs(b.top - y), Math.abs(b.bottom - y)) > il
				);
				const levels = printedFlags.length ? flags[printedFlags[0].str] : touching.length;
				if (printedFlags.length > 1 || levels > 3) return null;
				duration /= 2 ** levels;
			}
			const next = notes.find((n) => n.x > note.x)?.x ?? right;
			const dots = nearby.filter(
				(i) =>
					i.str === '\ue1e7' &&
					i.x > note.x + glyph.w * 0.75 &&
					i.x < Math.min(next, note.x + 2.5 * il) &&
					Math.abs(i.y - y) < 0.7 * il
			).length;
			if (dots > 2) return null;
			duration *= 2 - 2 ** -dots;
			events.push({
				x: note.x,
				center: note.x + glyph.w / 2,
				beat: 0,
				duration: duration * scale,
				position: note.position,
				accidental: note.accidental,
				tied: false
			});
		}
		for (const rest of nearby.filter((i) => restDurations[i.str] && i.x >= left && i.x < right)) {
			const next =
				nearby
					.filter(
						(i) =>
							i.x > rest.x &&
							i.x < right &&
							(/^[\ue0a2-\ue0a4]$/.test(i.str) || restDurations[i.str])
					)
					.sort((a, b) => a.x - b.x)[0]?.x ?? right;
			const dots = nearby.filter(
				(i) =>
					i.str === '\ue1e7' &&
					i.x > rest.x &&
					i.x < Math.min(next, rest.x + 2.5 * il) &&
					Math.abs(i.y - rest.y) < il
			).length;
			if (dots > 2) return null;
			const duration =
				rest.str === '\ue4e3' && !notes.length
					? beats
					: restDurations[rest.str] * scale * (2 - 2 ** -dots);
			events.push({
				x: rest.x,
				center: rest.x + rest.w / 2,
				beat: 0,
				duration,
				position: null,
				accidental: null,
				tied: false
			});
		}
		events.sort((a, b) => a.x - b.x);
		if (!events.length || events.some((e, i) => i > 0 && e.x - events[i - 1].x < 0.5 * il))
			return null;
		const total = () => events.reduce((sum, e) => sum + e.duration, 0);
		const labels = nearby.filter(
			(i) =>
				i.str === '3' &&
				i.x >= left &&
				i.x < right &&
				(i.y < system.band.top - 0.25 * il || i.y > system.band.bottom + 0.25 * il)
		);
		const durations = resolvePrintedTriplets(events, labels, beats, il);
		if (!durations) return null;
		events.forEach((event, i) => {
			event.duration = durations[i];
		});
		const length = total();
		if (Math.abs(length - beats) > 1e-5 && !(first && b === 0 && length < beats)) return null;
		let beat = length < beats - 1e-5 ? beats - length : 0;
		for (const e of events) {
			e.beat = beat;
			beat += e.duration;
		}
		return events;
	});
	// A same-position curved connection is a tie candidate. Curves that span
	// intervening events are slurs; cross-system continuations remain optical.
	for (let b = 0; b < groups.length; b++) {
		const events = groups[b];
		if (!events) continue;
		for (let i = 0; i < events.length; i++) {
			const e = events[i],
				next = events[i + 1] ?? groups[b + 1]?.[0];
			if (e.position === null || !next || e.position !== next.position || next.x <= e.x) continue;
			const y = system.band.bottom - (e.position * il) / 2;
			e.tied = curves.some(
				(c) =>
					c.left >= e.x &&
					c.left <= e.x + 2 * il &&
					Math.abs(c.right - next.x) < 1.5 * il &&
					Math.abs(c.startY - y) < 1.5 * il &&
					Math.abs(c.endY - y) < 1.5 * il
			);
		}
	}
	let tiedFrom: string | undefined;
	return groups.map((events, b) => {
		if (!events) {
			tiedFrom = undefined;
			return null;
		}
		const melody = resolveStaffEvents(events, clef, fifths, tiedFrom),
			last = melody.at(-1);
		tiedFrom = last?.[3] ? last[2] : undefined;
		return {
			startRepeat:
				b === 0 ? system.initialRepeat === true : system.repeatDots[b - 1]?.right === true,
			endRepeat: system.repeatDots[b]?.left === true,
			ending: null,
			pickup: first && b === 0 && events[0].beat > 1e-5,
			melody
		};
	});
}

export interface GlyphTieEdges {
	incoming: number | null;
	outgoing: number | null;
}
/** A line break needs both printed curve halves and matching note pitches. */
export function readGlyphTieEdges(
	system: SystemGeometry,
	paths: VectorPath[],
	notation: GlyphNotation
): GlyphTieEdges {
	const il = system.interline,
		first = notation.bars[0]?.[0],
		last = notation.bars.at(-1)?.at(-1);
	const curves = paths
		.filter((p) => p.curved && p.filled && p.points.length === 7)
		.map((p) => ({ ...bounds(p), startY: p.points[0][1], endY: p.points[3][1] }));
	const near = (c: (typeof curves)[number], position: number) =>
		Math.abs(c.startY - (system.band.bottom - (position * il) / 2)) < 1.5 * il &&
		Math.abs(c.endY - (system.band.bottom - (position * il) / 2)) < 1.5 * il;
	return {
		incoming:
			first &&
			curves.some(
				(c) =>
					c.right < first.x + il &&
					c.right > first.x - 1.5 * il &&
					c.left < first.x &&
					c.left > first.x - 4 * il &&
					near(c, first.position)
			)
				? first.position
				: null,
		outgoing:
			last &&
			curves.some(
				(c) =>
					c.left >= last.x &&
					c.left < last.x + 2 * il &&
					Math.abs(c.right - system.barlines.at(-1)!) < il &&
					near(c, last.position)
			)
				? last.position
				: null
	};
}
export function connectGlyphTies(
	systems: Array<{ glyphBars?: Array<RecognizedBar | null>; glyphTieEdges?: GlyphTieEdges }>
): void {
	for (let i = 0; i < systems.length - 1; i++) {
		const a = systems[i],
			b = systems[i + 1];
		if (a.glyphTieEdges?.outgoing == null || a.glyphTieEdges.outgoing !== b.glyphTieEdges?.incoming)
			continue;
		const last = a.glyphBars?.at(-1)?.melody.at(-1),
			first = b.glyphBars?.[0]?.melody[0];
		if (last && first && last[2] !== 'rest' && last[2] === first[2]) last[3] = true;
	}
}

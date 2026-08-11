import type { BarAnchor, ChordSlotAnchor } from '$lib/music/tune-notation';
import type { NoteAnchor } from '$lib/music/notation';

/**
 * Pure hit-zone geometry for the leadsheet editor. Turns the char-span anchors
 * from `tuneToAbcWithMap` plus a reduced view of abcjs' rendered layout into
 * horizontal rectangle specs (bar zones, per-beat chord zones) and beat-advance
 * logic — all as plain math so it is unit-testable in Node.
 *
 * No DOM, no abcjs import, no Svelte: the NotationDisplay wiring task adapts real
 * abcjs voice items onto the minimal {@link LayoutItem}/{@link SystemLayout}
 * shapes below. y-coordinates are NOT this module's job — the component derives
 * vertical bands from staff bounding boxes; rect specs here are x-spans + identity.
 */

/** One rendered note/rest/barline element, reduced to what geometry needs. */
export interface LayoutItem {
	/** Char index in the ABC string where this element's token begins. */
	startChar: number;
	/** Char index just past this element's token. */
	endChar: number;
	/** Left x of the element's bounding box (abcjs `abselem.x`). */
	x: number;
	/** Width of the element's bounding box (abcjs `abselem.w`). */
	w: number;
	/** A note/rest glyph vs a barline. */
	type: 'note' | 'bar';
}

/** One rendered system (staff line): its elements ordered left → right. */
export interface SystemLayout {
	items: LayoutItem[];
}

/** A bar's horizontal span within the system that rendered it. */
export interface BarZone {
	sectionIdx: number;
	/** 0-based bar within the section. */
	bar: number;
	systemIdx: number;
	x0: number;
	x1: number;
}

/** A known (beat-within-bar, x) pair used to interpolate beat edges. */
export interface BeatSample {
	/** Beat position within the bar (0 = downbeat; off-beats like 1.5 allowed). */
	beat: number;
	x: number;
}

/** One clickable beat cell: a rectangle span with its musical identity. */
export interface ChordZone {
	sectionIdx: number;
	bar: number;
	/** 0-based beat within the bar. */
	beat: number;
	systemIdx: number;
	x0: number;
	x1: number;
}

/** A cursor position within the whole song form. */
export interface BeatPosition {
	sectionIdx: number;
	bar: number;
	beat: number;
}

/** The bar/beat shape of a whole song form, for beat-advance wrapping. */
export interface FormShape {
	sections: { bars: number }[];
	beatsPerBar: number;
}

/** Inputs for {@link chordZones}: layout + anchors + the meter it renders in. */
export interface ChordZoneInputs {
	systems: SystemLayout[];
	barAnchors: BarAnchor[];
	noteAnchors: NoteAnchor[];
	chordSlotAnchors: ChordSlotAnchor[];
	beatsPerBar: number;
	/** Whole-note duration of one bar, i.e. `timeSig[0] / timeSig[1]`. */
	barDurationWholeNotes: number;
}

/**
 * Find the layout item covering an anchor's `startChar`. Mirrors the
 * `findAnchorAt` semantics in NotationDisplay but in the layout direction:
 * exact start-char match first (the common case), then range containment.
 */
export function matchLayoutItem(items: LayoutItem[], startChar: number): LayoutItem | null {
	const exact = items.find((it) => it.startChar === startChar);
	if (exact) return exact;
	return items.find((it) => startChar >= it.startChar && startChar < it.endChar) ?? null;
}

function systemLeftEdge(system: SystemLayout): number {
	return Math.min(...system.items.map((it) => it.x));
}

function systemRightEdge(system: SystemLayout): number {
	return Math.max(...system.items.map((it) => it.x + it.w));
}

/** Which system rendered the token at `startChar` (−1 if none). */
function findSystemIndex(systems: SystemLayout[], startChar: number): number {
	for (let s = 0; s < systems.length; s++) {
		if (matchLayoutItem(systems[s].items, startChar)) return s;
	}
	// Fallback: the system whose char-range brackets startChar (covers tokens
	// with no direct layout item, e.g. invisible rests reported oddly).
	for (let s = 0; s < systems.length; s++) {
		const items = systems[s].items;
		if (items.length === 0) continue;
		const lo = Math.min(...items.map((i) => i.startChar));
		const hi = Math.max(...items.map((i) => i.endChar));
		if (startChar >= lo && startChar < hi) return s;
	}
	return -1;
}

/** Resolve one bar to its system and x-span (barlines bound it; edges fall back). */
function locateBar(
	systems: SystemLayout[],
	anchor: BarAnchor
): { systemIdx: number; x0: number; x1: number } | null {
	const systemIdx = findSystemIndex(systems, anchor.startChar);
	if (systemIdx < 0) return null;
	const system = systems[systemIdx];
	const bars = system.items.filter((it) => it.type === 'bar');
	// Right edge: the bar's own closing barline (endChar lands just past it).
	const closing =
		bars.find((it) => it.endChar === anchor.endChar) ??
		bars.find((it) => anchor.endChar - 1 >= it.startChar && anchor.endChar - 1 < it.endChar) ??
		null;
	// Left edge: the nearest preceding barline in this system, else the system's
	// left edge (a bar that opens the system has no barline to its left).
	const preceding = bars
		.filter((it) => it.endChar <= anchor.startChar)
		.sort((a, b) => b.endChar - a.endChar)[0];
	const x0 = preceding ? preceding.x : systemLeftEdge(system);
	const x1 = closing ? closing.x : systemRightEdge(system);
	return { systemIdx, x0, x1 };
}

export function barZones(systems: SystemLayout[], barAnchors: BarAnchor[]): BarZone[] {
	const zones: BarZone[] = [];
	for (const anchor of barAnchors) {
		const loc = locateBar(systems, anchor);
		if (!loc) continue;
		zones.push({ sectionIdx: anchor.sectionIdx, bar: anchor.bar, ...loc });
	}
	return zones;
}

function clamp(v: number, lo: number, hi: number): number {
	return v < lo ? lo : v > hi ? hi : v;
}

/** Linear-interpolate x at beat `q` over control points sorted by ascending beat. */
function interpolate(points: { beat: number; x: number }[], q: number): number {
	if (q <= points[0].beat) return points[0].x;
	const last = points[points.length - 1];
	if (q >= last.beat) return last.x;
	for (let i = 0; i + 1 < points.length; i++) {
		const a = points[i];
		const b = points[i + 1];
		if (q >= a.beat && q <= b.beat) {
			const t = (q - a.beat) / (b.beat - a.beat);
			return a.x + t * (b.x - a.x);
		}
	}
	return last.x;
}

/**
 * Beat-edge x-positions across a bar (length `beatsPerBar + 1`, monotonic,
 * clamped to `[zone.x0, zone.x1]`). The bar's two ends are pinned to the zone
 * edges (beat 0 → x0, last beat → x1); interior samples become control points,
 * so an edge that coincides with a sample lands exactly on it. No interior
 * samples ⇒ even division.
 */
export function beatEdges(zone: BarZone, samples: BeatSample[], beatsPerBar: number): number[] {
	const { x0, x1 } = zone;
	// Merge interior samples by (rounded) beat, averaging any collisions, and
	// clamp their x into the bar span so control points can't escape it.
	const byBeat = new Map<number, number[]>();
	for (const s of samples) {
		if (s.beat <= 1e-9 || s.beat >= beatsPerBar - 1e-9) continue;
		const key = Math.round(s.beat * 1e6) / 1e6;
		const xs = byBeat.get(key) ?? [];
		xs.push(clamp(s.x, x0, x1));
		byBeat.set(key, xs);
	}
	const points: { beat: number; x: number }[] = [{ beat: 0, x: x0 }];
	for (const beat of [...byBeat.keys()].sort((a, b) => a - b)) {
		const xs = byBeat.get(beat)!;
		points.push({ beat, x: xs.reduce((a, b) => a + b, 0) / xs.length });
	}
	points.push({ beat: beatsPerBar, x: x1 });

	const edges: number[] = [];
	let prev = x0;
	for (let k = 0; k <= beatsPerBar; k++) {
		const e = clamp(interpolate(points, k), x0, x1);
		const monotone = e < prev ? prev : e; // never step backwards
		edges.push(monotone);
		prev = monotone;
	}
	return edges;
}

/** Position within the bar (in beats) of a note at absolute whole-note offset. */
function offsetToBeatInBar(
	offsetWholeNotes: number,
	barDurationWholeNotes: number,
	beatsPerBar: number
): number {
	const barsIn = Math.floor(offsetWholeNotes / barDurationWholeNotes + 1e-9);
	const withinBar = offsetWholeNotes - barsIn * barDurationWholeNotes;
	const beatsPerWhole = beatsPerBar / barDurationWholeNotes;
	return withinBar * beatsPerWhole;
}

/**
 * One clickable rectangle per (system × bar × beat). Bars are resolved to their
 * system + x-span (as in {@link barZones}); beat boundaries within each bar are
 * interpolated from melody-note anchors (offset → beat) and chord-slot anchors
 * (beat carried directly), each matched to a rendered x by charspan.
 */
export function chordZones(inputs: ChordZoneInputs): ChordZone[] {
	const { systems, barAnchors, noteAnchors, chordSlotAnchors, beatsPerBar, barDurationWholeNotes } =
		inputs;
	const result: ChordZone[] = [];
	for (const anchor of barAnchors) {
		const loc = locateBar(systems, anchor);
		if (!loc) continue;
		const { systemIdx, x0, x1 } = loc;
		const zone: BarZone = { sectionIdx: anchor.sectionIdx, bar: anchor.bar, systemIdx, x0, x1 };
		const items = systems[systemIdx].items;

		const samples: BeatSample[] = [];
		for (const na of noteAnchors) {
			if (na.startChar < anchor.startChar || na.startChar >= anchor.endChar) continue;
			const hit = matchLayoutItem(items, na.startChar);
			if (!hit) continue;
			const beat = offsetToBeatInBar(na.offset ?? 0, barDurationWholeNotes, beatsPerBar);
			samples.push({ beat, x: hit.x });
		}
		for (const cs of chordSlotAnchors) {
			if (cs.sectionIdx !== anchor.sectionIdx || cs.bar !== anchor.bar) continue;
			const hit = matchLayoutItem(items, cs.startChar);
			if (!hit) continue;
			samples.push({ beat: cs.beat, x: hit.x });
		}

		const edges = beatEdges(zone, samples, beatsPerBar);
		for (let beat = 0; beat < beatsPerBar; beat++) {
			result.push({
				sectionIdx: anchor.sectionIdx,
				bar: anchor.bar,
				beat,
				systemIdx,
				x0: edges[beat],
				x1: edges[beat + 1]
			});
		}
	}
	return result;
}

/** The next beat position across the whole form, or null past its final beat. */
export function nextBeatPos(pos: BeatPosition, form: FormShape): BeatPosition | null {
	const { sectionIdx, bar, beat } = pos;
	if (beat + 1 < form.beatsPerBar) return { sectionIdx, bar, beat: beat + 1 };
	if (bar + 1 < form.sections[sectionIdx].bars) return { sectionIdx, bar: bar + 1, beat: 0 };
	if (sectionIdx + 1 < form.sections.length) return { sectionIdx: sectionIdx + 1, bar: 0, beat: 0 };
	return null;
}

/** The previous beat position across the whole form, or null before its first beat. */
export function prevBeatPos(pos: BeatPosition, form: FormShape): BeatPosition | null {
	const { sectionIdx, bar, beat } = pos;
	if (beat - 1 >= 0) return { sectionIdx, bar, beat: beat - 1 };
	if (bar - 1 >= 0) return { sectionIdx, bar: bar - 1, beat: form.beatsPerBar - 1 };
	if (sectionIdx - 1 >= 0) {
		const prevSection = sectionIdx - 1;
		return {
			sectionIdx: prevSection,
			bar: form.sections[prevSection].bars - 1,
			beat: form.beatsPerBar - 1
		};
	}
	return null;
}

const CLIP_EPS = 1e-9;

/**
 * Clip a bar's horizontal span to the portion covered by a half-open time
 * range in whole-note units. Used so mid-bar-abutted insertion markers split a
 * shared bar instead of stacking two full-bar washes.
 *
 * @param x0 Left edge of the full bar zone (SVG user units)
 * @param x1 Right edge of the full bar zone
 * @param absBar 0-based absolute notation bar index
 * @param barWholeNotes Length of one bar in whole notes (1 for 4/4, 0.75 for 3/4)
 * @param rangeStart Inclusive start of the marker span (whole notes from form 0)
 * @param rangeEnd Exclusive end of the marker span
 * @returns Clipped `[x0, x1]` or null when the range misses this bar
 */
export function clipBarSpanX(
	x0: number,
	x1: number,
	absBar: number,
	barWholeNotes: number,
	rangeStart: number,
	rangeEnd: number
): { x0: number; x1: number } | null {
	if (!(barWholeNotes > 0) || !(x1 > x0)) return null;
	const barStart = absBar * barWholeNotes;
	const barEnd = barStart + barWholeNotes;
	const t0 = Math.max(barStart, rangeStart);
	const t1 = Math.min(barEnd, rangeEnd);
	if (t1 <= t0 + CLIP_EPS) return null;
	const w = x1 - x0;
	const f0 = (t0 - barStart) / barWholeNotes;
	const f1 = (t1 - barStart) / barWholeNotes;
	return { x0: x0 + w * f0, x1: x0 + w * f1 };
}

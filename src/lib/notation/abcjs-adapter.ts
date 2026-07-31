import {
	nextBeatPos,
	prevBeatPos,
	type BeatPosition,
	type FormShape,
	type LayoutItem,
	type SystemLayout
} from '$lib/notation/chart-geometry';
import type { PitchedNoteAnchor } from '$lib/music/notation';
import type { BarAnchor, ChordSlotAnchor } from '$lib/music/tune-notation';

/**
 * Adapts abcjs-shaped render output onto chart-geometry's pure input shapes,
 * plus the small pure helpers NotationDisplay's hit-zone/chord-input wiring
 * needs. Everything here is DOM-free and unit-testable in Node.
 *
 * abcjs types are deliberately NOT imported — the interfaces below structurally
 * describe only what this module consumes from `renderAbc`'s returned
 * visualObj (abcjs 6.6.2: `lines[l].staff[s].voices[v]` voice items carrying
 * `startChar`/`endChar`, with the post-render `abselem { x, w, elemset }`
 * attached by the draw phase).
 */

/** Post-render absolute element: layout box + the drawn SVG group(s). */
export interface AdapterAbselem {
	x?: number;
	w?: number;
	/** SVG elements drawn for this item; `elemset[0]` is the carrier group. */
	elemset?: unknown[];
}

/** One parsed voice item (note, rest, barline, clef, …) as abcjs shapes it. */
export interface AdapterVoiceItem {
	el_type?: string;
	startChar?: number;
	endChar?: number;
	/** Present only after the draw phase, and only for rendered items. */
	abselem?: AdapterAbselem;
}

export interface AdapterStaff {
	voices?: AdapterVoiceItem[][];
}

/** One visualObj line; non-music lines (subtitle/text/separator) have no staff. */
export interface AdapterLine {
	staff?: AdapterStaff[];
}

export interface AdapterVisualObj {
	lines?: AdapterLine[];
}

/** One rendered system's layout items, split by voice role. */
export interface SystemVoiceItems {
	/** Voice 0 (the melody voice M on the tune path). */
	melody: LayoutItem[];
	/** Voice 1 (the invisible chord voice H); empty for single-voice charts. */
	harmony: LayoutItem[];
}

/** Reduce a raw voice-item array to renderable note/bar layout items. */
function layoutItems(items: AdapterVoiceItem[] | undefined): LayoutItem[] {
	const out: LayoutItem[] = [];
	for (const item of items ?? []) {
		if (item.el_type !== 'note' && item.el_type !== 'bar') continue;
		if (typeof item.startChar !== 'number' || typeof item.endChar !== 'number') continue;
		const box = item.abselem;
		if (!box || typeof box.x !== 'number' || typeof box.w !== 'number') continue;
		out.push({
			startChar: item.startChar,
			endChar: item.endChar,
			x: box.x,
			w: box.w,
			type: item.el_type
		});
	}
	return out;
}

/**
 * One entry per rendered MUSIC line (system), in document order — the same
 * order as the SVG's `.abcjs-staff-wrapper` groups. Both voices live on the
 * first staff (the tune renderer merges them via `%%score (M H)`).
 */
export function systemsFromVisualObj(visualObj: AdapterVisualObj): SystemVoiceItems[] {
	const systems: SystemVoiceItems[] = [];
	for (const line of visualObj.lines ?? []) {
		const staff = line.staff?.[0];
		if (!staff) continue;
		systems.push({
			melody: layoutItems(staff.voices?.[0]),
			harmony: layoutItems(staff.voices?.[1])
		});
	}
	return systems;
}

/** Merge each system's voices into chart-geometry's `SystemLayout` shape. */
export function toSystemLayouts(systems: SystemVoiceItems[]): SystemLayout[] {
	return systems.map((s) => ({ items: [...s.melody, ...s.harmony] }));
}

/**
 * Resolve an anchor's `startChar` to the melody-voice item that rendered it
 * (exact start match first, then charspan containment — mirroring
 * `matchLayoutItem`). The caller reads `abselem.elemset[0]` for the DOM group;
 * items are returned raw so that reference survives.
 */
export function findVoiceItem(
	visualObj: AdapterVisualObj,
	startChar: number
): AdapterVoiceItem | null {
	const melodies: AdapterVoiceItem[][] = [];
	for (const line of visualObj.lines ?? []) {
		const voice = line.staff?.[0]?.voices?.[0];
		if (voice) melodies.push(voice.filter((it) => it.el_type === 'note'));
	}
	for (const voice of melodies) {
		const exact = voice.find((it) => it.startChar === startChar);
		if (exact) return exact;
	}
	for (const voice of melodies) {
		const containing = voice.find(
			(it) =>
				typeof it.startChar === 'number' &&
				typeof it.endChar === 'number' &&
				startChar >= it.startChar &&
				startChar < it.endChar
		);
		if (containing) return containing;
	}
	return null;
}

/** Where to place the inline chord input, as percentages of the SVG's box. */
export interface OverlayBox {
	leftPct: number;
	topPct: number;
	widthPct: number;
}

/**
 * Position the inline chord input over a chord zone. The rendered SVG scales
 * to its container (viewBox, no fixed width), so percentages of the viewBox
 * are also percentages of the shared wrapper — resolution-independent. A
 * too-narrow zone widens to `minWidth` user units (default 60 ≈ a 5-char
 * chord at staffwidth 600), shifting left rather than overflowing the right
 * edge.
 */
export function overlayBoxPct(
	zone: { x0: number; x1: number },
	viewBox: { width: number; height: number },
	bandTop: number,
	options: { minWidth?: number } = {}
): OverlayBox {
	const { width, height } = viewBox;
	if (width <= 0 || height <= 0) return { leftPct: 0, topPct: 0, widthPct: 0 };
	const minWidth = options.minWidth ?? 60;
	const w = Math.min(Math.max(zone.x1 - zone.x0, minWidth), width);
	const left = Math.max(0, Math.min(zone.x0, width - w));
	const top = Math.min(Math.max(bandTop, 0), height);
	return {
		leftPct: (left / width) * 100,
		topPct: (top / height) * 100,
		widthPct: (w / width) * 100
	};
}

/** Derive the beat-advance form shape from a tune's sections + meter. */
export function formShape(tune: {
	sections: { bars: number }[];
	timeSignature: [number, number];
}): FormShape {
	return {
		sections: tune.sections.map((s) => ({ bars: s.bars })),
		beatsPerBar: tune.timeSignature[0]
	};
}

/** Beat 0 of the next bar across the form, or null past the final bar. */
export function nextBarStart(pos: BeatPosition, form: FormShape): BeatPosition | null {
	const { sectionIdx, bar } = pos;
	if (bar + 1 < form.sections[sectionIdx].bars) return { sectionIdx, bar: bar + 1, beat: 0 };
	if (sectionIdx + 1 < form.sections.length) return { sectionIdx: sectionIdx + 1, bar: 0, beat: 0 };
	return null;
}

/** Beat 0 of the previous bar across the form, or null before the first bar. */
export function prevBarStart(pos: BeatPosition, form: FormShape): BeatPosition | null {
	const { sectionIdx, bar } = pos;
	if (bar - 1 >= 0) return { sectionIdx, bar: bar - 1, beat: 0 };
	if (sectionIdx - 1 >= 0) {
		return { sectionIdx: sectionIdx - 1, bar: form.sections[sectionIdx - 1].bars - 1, beat: 0 };
	}
	return null;
}

/** What the inline chord input should do with a keydown. */
export type ChordKeyAction =
	| { type: 'close'; preventDefault: boolean }
	| { type: 'commit-close'; preventDefault: boolean }
	| { type: 'commit-advance'; target: BeatPosition | null; preventDefault: boolean };

/**
 * The inline chord input's key bindings: Enter commits + closes; Escape
 * cancels; Space / Shift+Space commit + advance a beat (the space must never
 * reach the input); Tab / Shift+Tab commit + jump a whole bar (suppressing
 * focus travel). A null `target` means the advance ran off the form's end —
 * commit, then close. Anything else is ordinary typing (null).
 */
export function chordKeyAction(
	key: string,
	shiftKey: boolean,
	pos: BeatPosition,
	form: FormShape
): ChordKeyAction | null {
	if (key === 'Enter') return { type: 'commit-close', preventDefault: false };
	if (key === 'Escape') return { type: 'close', preventDefault: false };
	if (key === ' ') {
		const target = shiftKey ? prevBeatPos(pos, form) : nextBeatPos(pos, form);
		return { type: 'commit-advance', target, preventDefault: true };
	}
	if (key === 'Tab') {
		const target = shiftKey ? prevBarStart(pos, form) : nextBarStart(pos, form);
		return { type: 'commit-advance', target, preventDefault: true };
	}
	return null;
}

/** What a chart click at some charspan position should do. */
export type ChartClickTarget =
	| { kind: 'note'; sourceIndex: number }
	| { kind: 'bar'; pos: { sectionIdx: number; bar: number } };

/**
 * Resolve a clicked abcjs element's `startChar` in priority order: pitched
 * melody note (exact start, then charspan containment) → chord-voice slot →
 * melody bar span. Rests carry no note anchor, so clicking one falls through
 * to its bar — a click anywhere in a bar can move the cursor there.
 */
export function resolveChartClick(
	startChar: number,
	noteAnchors: PitchedNoteAnchor[],
	chordSlotAnchors: ChordSlotAnchor[],
	barAnchors: BarAnchor[]
): ChartClickTarget | null {
	const note =
		noteAnchors.find((a) => a.startChar === startChar) ??
		noteAnchors.find((a) => startChar >= a.startChar && startChar < a.endChar);
	if (note) return { kind: 'note', sourceIndex: note.sourceIndex };
	const slot = chordSlotAnchors.find((a) => startChar >= a.startChar && startChar < a.endChar);
	if (slot) return { kind: 'bar', pos: { sectionIdx: slot.sectionIdx, bar: slot.bar } };
	const bar = barAnchors.find((a) => startChar >= a.startChar && startChar < a.endChar);
	if (bar) return { kind: 'bar', pos: { sectionIdx: bar.sectionIdx, bar: bar.bar } };
	return null;
}

/** One system's vertical geometry, measured from its rendered bounding boxes. */
export interface BandGeometry {
	/** Top of the chord band: the system top, with ≥3 spacings of room. */
	top: number;
	staffTop: number;
	staffBottom: number;
	/** One staff-line spacing (staff height / 4). */
	spacing: number;
}

/**
 * Vertical bands for one system from its wrapper top + staff box. The chord
 * band always opens at least 3 spacings above the staff so the first chord of
 * an empty chart still has a clickable target.
 */
export function bandGeometry(wrapperTop: number, staffTop: number, staffHeight: number): BandGeometry {
	const spacing = staffHeight / 4;
	return {
		top: Math.min(wrapperTop, staffTop - 3 * spacing),
		staffTop,
		staffBottom: staffTop + staffHeight,
		spacing
	};
}

export interface RectSpec {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Bar hit rect: the bar's x-span over the staff expanded 2 spacings each way. */
export function barHitRect(zone: { x0: number; x1: number }, band: BandGeometry): RectSpec {
	const y = band.staffTop - 2 * band.spacing;
	return { x: zone.x0, y, w: zone.x1 - zone.x0, h: band.staffBottom + 2 * band.spacing - y };
}

/** Chord hit rect: the beat cell's x-span over the chord band above the staff. */
export function chordHitRect(zone: { x0: number; x1: number }, band: BandGeometry): RectSpec {
	return { x: zone.x0, y: band.top, w: zone.x1 - zone.x0, h: band.staffTop - band.top };
}

/** An SVG bounding box (the relevant subset of `getBBox()`'s DOMRect). */
export interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** One rendered chord `<text>` glyph: its alphabetic baseline + bounding box. */
export interface ChordGlyphBox {
	/** The glyph's baseline y (the `y` attribute abcjs set on the text). */
	baselineY: number;
	box: Box;
}

/** MuseScore's default chord-symbol baseline: 2.5 staff-spaces above the top line. */
const CHORD_BASELINE_SPACINGS = 2.5;
/** MuseScore's minimum clearance between a pushed chord and the ink below it. */
const CHORD_CLEARANCE_SPACINGS = 0.5;

/**
 * Rehearsal-mark placement (Real Book / MuseScore convention):
 * system-start marks sit slightly right of the clef's left edge and *above*
 * the clef's top (never through the G-clef curl). Mid-line marks keep their
 * horizontal seat. Both drop from abcjs's high part-lane only as far as
 * clearance against the staff, clef top, and bar numbers allows.
 */
/** Gap from clef left edge to mark left edge, in staff spaces. */
const PART_CLEF_INSET_SPACINGS = 0.35;
/** Clearance from mark bottom to top staff line (staff spaces). */
const PART_STAFF_CLEARANCE_SPACINGS = 1.75;
/** Clearance from mark bottom to top of the clef glyph (staff spaces). */
const PART_CLEF_TOP_CLEARANCE_SPACINGS = 0.35;
/** Clearance from mark bottom to any x-overlapping bar-number box. */
const PART_BAR_NUMBER_CLEARANCE_SPACINGS = 0.3;
/**
 * If the mark's left edge is further right than this fraction of the staff
 * width past the clef, treat it as mid-line (do not snap to the clef).
 */
const PART_SYSTEM_START_FRACTION = 0.28;

/**
 * Compute dx/dy to re-seat a rehearsal mark. Pure math for unit tests.
 *
 * @param partBox — bounding box of the part group (letter + box)
 * @param clefBox — clef glyph box on the same system, or null
 * @param staffTop — y of the top staff line
 * @param staffWidth — full staff / system content width (for mid-line detect)
 * @param spacing — one staff-space in user units
 * @param obstacles — boxes that must stay clear (bar numbers on this system)
 */
export function partLabelDelta(
	partBox: Box,
	clefBox: Box | null,
	staffTop: number,
	staffWidth: number,
	spacing: number,
	obstacles: Box[] = []
): { dx: number; dy: number } {
	if (!Number.isFinite(spacing) || spacing <= 0 || !Number.isFinite(staffTop)) {
		return { dx: 0, dy: 0 };
	}

	// Horizontal: only snap toward the clef when this looks like a system-start mark.
	let dx = 0;
	let systemStart = false;
	if (clefBox && Number.isFinite(clefBox.x) && Number.isFinite(clefBox.width)) {
		const systemStartLimit =
			clefBox.x + Math.max(clefBox.width, staffWidth * PART_SYSTEM_START_FRACTION);
		if (partBox.x <= systemStartLimit) {
			systemStart = true;
			const targetLeft = clefBox.x + PART_CLEF_INSET_SPACINGS * spacing;
			dx = targetLeft - partBox.x;
		}
	}

	// Final horizontal span after the snap (for obstacle / clef overlap tests).
	const finalLeft = partBox.x + dx;
	const finalRight = finalLeft + partBox.width;
	const xOverlaps = (o: Box) => !(o.x >= finalRight || o.x + o.width <= finalLeft);

	// Vertical ceiling for the mark's bottom edge: stay above staff, clef top
	// (when co-located), and any bar numbers we would land on.
	let targetBottom = staffTop - PART_STAFF_CLEARANCE_SPACINGS * spacing;
	if (systemStart && clefBox && Number.isFinite(clefBox.y) && xOverlaps(clefBox)) {
		targetBottom = Math.min(
			targetBottom,
			clefBox.y - PART_CLEF_TOP_CLEARANCE_SPACINGS * spacing
		);
	}
	for (const o of obstacles) {
		if (!xOverlaps(o)) continue;
		targetBottom = Math.min(
			targetBottom,
			o.y - PART_BAR_NUMBER_CLEARANCE_SPACINGS * spacing
		);
	}

	const dy = targetBottom - (partBox.y + partBox.height);
	// Only drop; never raise (and never push into the staff past targetBottom
	// with a positive overshoot — Math.max(0, dy) keeps high marks from going
	// lower than allowed only when dy is already the correct drop).
	return { dx, dy: Math.max(0, dy) };
}

/**
 * Per-chord vertical corrections (translate dy) dropping abcjs's chord row
 * to MuseScore's default: baseline 2.5 spacings above the top staff line,
 * each chord pushed up individually — never placed closer — just far enough
 * to keep half a spacing of clearance over x-overlapping ink that reaches
 * into its box. abcjs anchors ALL chords in a system above the line's
 * tallest element, so one high bar otherwise lifts every chord in the
 * system. Ink floating wholly above the default box (ending brackets, which
 * abcjs lays out above the chord row) must not veto the drop and is ignored.
 */
export function chordSymbolDeltas(
	chords: ChordGlyphBox[],
	obstacles: Box[],
	topLineY: number,
	spacing: number
): number[] {
	if (!Number.isFinite(spacing) || spacing <= 0 || !Number.isFinite(topLineY)) {
		return chords.map(() => 0);
	}
	const targetBaseline = topLineY - CHORD_BASELINE_SPACINGS * spacing;
	const clearance = CHORD_CLEARANCE_SPACINGS * spacing;
	return chords.map(({ baselineY, box }) => {
		if (!Number.isFinite(baselineY)) return 0;
		const ascent = baselineY - box.y;
		const descent = box.y + box.height - baselineY;
		const defaultTop = targetBaseline - ascent;
		const defaultBottom = targetBaseline + descent;
		let bottom = defaultBottom;
		for (const o of obstacles) {
			if (o.x >= box.x + box.width || o.x + o.width <= box.x) continue;
			const reachesUp = o.y < defaultBottom + clearance;
			const reachesBelowBoxTop = o.y + o.height > defaultTop;
			if (reachesUp && reachesBelowBoxTop) bottom = Math.min(bottom, o.y - clearance);
		}
		return bottom - descent - baselineY;
	});
}

/** Minimum gap between adjacent chord symbols (in staff spaces). */
const CHORD_H_GAP_SPACINGS = 0.35;
/** Minimum clearance from a chord's left edge to x-overlapping staff ink. */
const CHORD_H_INK_CLEARANCE_SPACINGS = 0.2;

/**
 * Per-chord horizontal corrections (translate dx) so neighbouring chords and
 * tall staff ink (accidentals, flags) don't collide. Processes left→right;
 * each chord may only shift right (never left past its natural seat), which
 * preserves beat alignment for the first symbol of a bar.
 *
 * `boxes` are the chords' current bounding boxes (after any vertical drop).
 * Returns one dx per chord.
 */
export function chordHorizontalNudges(
	boxes: Box[],
	obstacles: Box[],
	spacing: number
): number[] {
	if (!Number.isFinite(spacing) || spacing <= 0 || boxes.length === 0) {
		return boxes.map(() => 0);
	}
	const gap = CHORD_H_GAP_SPACINGS * spacing;
	const inkClear = CHORD_H_INK_CLEARANCE_SPACINGS * spacing;
	const dx = boxes.map(() => 0);
	// Working left edges after prior nudges.
	const left = boxes.map((b) => b.x);
	const width = boxes.map((b) => b.width);

	for (let i = 0; i < boxes.length; i++) {
		let x = left[i];
		// Clear prior chord.
		if (i > 0) {
			const prevRight = left[i - 1] + width[i - 1];
			if (x < prevRight + gap) x = prevRight + gap;
		}
		// Clear x-overlapping ink that reaches into this chord's horizontal band
		// (same y-band as the chord row — obstacles wholly below the staff top
		// are still considered; the caller filters ending/part marks).
		const top = boxes[i].y;
		const bottom = boxes[i].y + boxes[i].height;
		for (const o of obstacles) {
			if (o.y + o.height < top - spacing || o.y > bottom + spacing) continue;
			const oRight = o.x + o.width;
			// If the obstacle overlaps our natural box and sits to our left
			// edge, push past it.
			if (oRight + inkClear > x && o.x < x + width[i]) {
				if (oRight + inkClear > x) x = Math.max(x, oRight + inkClear);
			}
		}
		dx[i] = x - boxes[i].x;
		left[i] = x;
	}
	return dx;
}

/**
 * MuseScore-style wavy glissando between two notehead boxes: half-waves of
 * ~0.8 spacing with ~0.22-spacing amplitude along the connector, padded a
 * quarter-spacing off each head. Null when the padded gap is shorter than one
 * spacing (no room for a wave). Returns SVG path data + formatted stroke width.
 */
export function glissandoWave(
	a: Box,
	b: Box,
	spacing: number
): { d: string; strokeWidth: string } | null {
	const pad = spacing * 0.25;
	const x1 = a.x + a.width + pad;
	const y1 = a.y + a.height / 2;
	const x2 = b.x - pad;
	const y2 = b.y + b.height / 2;
	const dx = x2 - x1;
	const dy = y2 - y1;
	const len = Math.hypot(dx, dy);
	if (len < spacing) return null;
	const waves = Math.max(2, Math.round(len / (spacing * 0.8)));
	const amp = spacing * 0.22;
	const ux = dx / len;
	const uy = dy / len;
	const px = -uy;
	const py = ux;
	let d = `M ${x1.toFixed(2)} ${y1.toFixed(2)}`;
	for (let k = 0; k < waves; k++) {
		const t0 = (k / waves) * len;
		const t1 = ((k + 1) / waves) * len;
		const tm = (t0 + t1) / 2;
		const sign = k % 2 === 0 ? 1 : -1;
		const cx = x1 + ux * tm + px * amp * sign;
		const cy = y1 + uy * tm + py * amp * sign;
		const ex = x1 + ux * t1;
		const ey = y1 + uy * t1;
		d += ` Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${ex.toFixed(2)} ${ey.toFixed(2)}`;
	}
	return { d, strokeWidth: Math.max(1, spacing * 0.13).toFixed(2) };
}

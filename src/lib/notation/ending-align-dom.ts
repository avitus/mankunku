/**
 * Post-render DOM alignment for stacked second endings.
 *
 * Extracted from NotationDisplay so the geometry can be unit-tested against
 * real SVG trees without mounting Svelte.
 *
 * Strategy (no more "scale everything then un-squash"):
 * - **Rigid glyphs** (notes, rests, bars, chords, decorations): pure
 *   `translate` so centers map under [1] but shapes stay full size.
 * - **Line art** (volta path, beams, slurs, ties): `matrix(sx,0,0,1,tx,0)`
 *   so the bracket width matches [1].
 * - **Volta number text**: pure translate (never scaled) + extra inset so
 *   the digit clears the left hook after the path is compressed.
 * - **Chords**: pure translate + clearance past the (nudged) "2".
 * - Ending group is re-appended last so the "2" paints above chords.
 */

import {
	endingAlignTransform,
	endingAlignMatrix,
	endingGlyphTranslateDx,
	planStackedEndingRigidGlyphs,
	endingChordVerticalMatchDy,
	meanFinite,
	ENDING_LABEL_CHORD_MIN_GAP,
	ENDING_LABEL_HOOK_MIN_GAP,
	type EndingAlignTransform
} from '$lib/music/ending-layout';

function prependTransform(el: Element, t: string): void {
	const prior = el.getAttribute('transform');
	el.setAttribute('transform', prior ? `${t} ${prior}` : t);
}

function localBox(
	el: SVGGraphicsElement
): { x: number; width: number; cx: number } | null {
	try {
		const b = el.getBBox();
		if (!Number.isFinite(b.x) || !Number.isFinite(b.width) || b.width < 0) return null;
		return { x: b.x, width: b.width, cx: b.x + b.width / 2 };
	} catch {
		return null;
	}
}

/** Convert a screen-pixel delta to layer-local user units via the CTM. */
function screenToLocal(
	layer: SVGGElement,
	needPx: number,
	axis: 'x' | 'y' = 'x'
): number {
	if (needPx <= 0.5) return 0;
	let scale = 1;
	try {
		const ctm = layer.getScreenCTM();
		if (ctm) {
			const s = axis === 'y' ? ctm.d : ctm.a;
			if (Number.isFinite(s) && Math.abs(s) > 1e-6) scale = s;
		}
	} catch {
		scale = 1;
	}
	const local = needPx / scale;
	return local > 0.5 ? local : 0;
}

/**
 * Align every stacked [2] under its preceding [1] inside `container`.
 * Mutates the SVG DOM in place.
 */
export function alignStackedEndingsInContainer(container: ParentNode): void {
	for (const svg of container.querySelectorAll('svg')) {
		alignStackedEndingsInSvg(svg);
	}
}

export function alignStackedEndingsInSvg(svg: Element): void {
	const endings = [...svg.querySelectorAll<SVGGElement>('g.abcjs-ending')];
	type Labeled = { g: SVGGElement; label: string; x: number; width: number };
	const labeled: Labeled[] = [];
	for (const g of endings) {
		const label = (g.querySelector('text')?.textContent ?? '').trim();
		if (label !== '1' && label !== '2') continue;
		const box = localBox(g);
		if (!box || box.width < 1) continue;
		labeled.push({ g, label, x: box.x, width: box.width });
	}

	for (let i = 0; i < labeled.length; i++) {
		if (labeled[i].label !== '1') continue;
		const second = labeled.slice(i + 1).find((e) => e.label === '2');
		if (!second) continue;
		const first = labeled[i];
		const xform = endingAlignTransform(
			{ x: first.x, width: first.width },
			{ x: second.x, width: second.width }
		);
		if (!xform) continue;
		alignOneSecondEnding(second.g, first.g, xform, second.x);
	}
}

function alignOneSecondEnding(
	endingG: SVGGElement,
	firstEndingG: SVGGElement,
	xform: EndingAlignTransform,
	secondLeftX: number
): void {
	const wrapper = endingG.closest('g.abcjs-staff-wrapper');
	if (!wrapper) return;

	const threshold = secondLeftX - 0.5;
	const selector =
		'g.abcjs-note, g.abcjs-rest, g.abcjs-bar, g.abcjs-ending, g.abcjs-beam, g.abcjs-triplet, text.abcjs-chord, path.abcjs-slur, path.abcjs-tie, g.abcjs-decoration, g.abcjs-annotation';
	const nodes = [...wrapper.querySelectorAll<SVGGraphicsElement>(selector)];
	const roots = nodes.filter((n) => !nodes.some((o) => o !== n && o.contains(n)));
	const movers: SVGGraphicsElement[] = [];
	for (const el of roots) {
		const b = localBox(el);
		if (!b || b.x + b.width < threshold) continue;
		if (el.closest('.abcjs-clef, .abcjs-key-signature, .abcjs-time-signature')) continue;
		movers.push(el);
	}
	if (movers.length === 0) return;

	const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
	layer.setAttribute('class', 'abcjs-ending-align');
	layer.setAttribute('data-ending-align', '2');
	// Layer itself is identity — per-element transforms do the work so we
	// never squash noteheads under a parent matrix.
	wrapper.insertBefore(layer, movers[0]);
	for (const el of movers) layer.appendChild(el);

	const { sx, tx } = xform;

	// Measure label / chords / hook **before** mutating transforms (local space).
	const labelText = layer.querySelector<SVGGraphicsElement>('g.abcjs-ending text');
	const chordEls = [...layer.querySelectorAll<SVGGraphicsElement>('text.abcjs-chord')];
	const labelBox = labelText ? localBox(labelText) : null;
	const chordBoxes = chordEls.map((el) => {
		const b = localBox(el);
		return b ? { x: b.x, width: b.width } : { x: 0, width: 0 };
	});
	// Left hook ≈ left edge of the ending path (pre-scale local coords).
	const endingPath = layer.querySelector<SVGGraphicsElement>('g.abcjs-ending path, g.abcjs-ending line');
	const hookLocalX = endingPath ? (localBox(endingPath)?.x ?? secondLeftX) : secondLeftX;

	const plan = planStackedEndingRigidGlyphs(
		xform,
		labelBox ? { x: labelBox.x, width: labelBox.width } : null,
		chordBoxes,
		hookLocalX
	);

	// ── Line art: horizontal scale is OK (paths, not noteheads) ─────────
	const lineArtSel =
		'g.abcjs-ending, g.abcjs-beam, g.abcjs-triplet, path.abcjs-slur, path.abcjs-tie';
	const lineArt = [...layer.querySelectorAll<SVGGraphicsElement>(lineArtSel)].filter(
		(n, _, all) => !all.some((o) => o !== n && o.contains(n))
	);
	const matrix = endingAlignMatrix(xform);
	for (const el of lineArt) {
		// Ending number text must NOT inherit the scale — handle separately.
		if (el.classList.contains('abcjs-ending')) {
			// Scale only the path/line children; leave the number text alone.
			for (const ink of el.querySelectorAll('path, line')) {
				prependTransform(ink, matrix);
				ink.setAttribute('vector-effect', 'non-scaling-stroke');
			}
			// Volta number: pure translate (full size) + hook-clearance inset.
			for (const text of el.querySelectorAll<SVGGraphicsElement>('text')) {
				const b = localBox(text);
				if (!b) continue;
				let dx = endingGlyphTranslateDx(sx, tx, b.cx);
				if (plan.labelExtraDx > 0.5) dx += plan.labelExtraDx;
				if (Math.abs(dx) >= 0.5) {
					prependTransform(text, `translate(${dx.toFixed(2)},0)`);
				}
			}
		} else {
			prependTransform(el, matrix);
			for (const ink of el.querySelectorAll('path, line')) {
				ink.setAttribute('vector-effect', 'non-scaling-stroke');
			}
			if (el.tagName.toLowerCase() === 'path' || el.tagName.toLowerCase() === 'line') {
				el.setAttribute('vector-effect', 'non-scaling-stroke');
			}
		}
	}

	// ── Rigid glyphs: pure translate (size preserved) ───────────────────
	const rigidSel =
		'g.abcjs-note, g.abcjs-rest, g.abcjs-bar, text.abcjs-chord, g.abcjs-decoration, g.abcjs-annotation';
	const rigidNodes = [...layer.querySelectorAll<SVGGraphicsElement>(rigidSel)];
	const rigidRoots = rigidNodes.filter(
		(n) => !rigidNodes.some((o) => o !== n && o.contains(n))
	);

	for (const el of rigidRoots) {
		const b = localBox(el);
		if (!b) continue;
		let dx = endingGlyphTranslateDx(sx, tx, b.cx);
		const cls = el.getAttribute('class') ?? '';
		const isChord = cls.includes('abcjs-chord') || cls.split(/\s+/).includes('chord');
		if (isChord && plan.chordExtraDx > 0.5) dx += plan.chordExtraDx;
		if (Math.abs(dx) < 0.5) continue;
		prependTransform(el, `translate(${dx.toFixed(2)},0)`);
	}

	// Paint volta (hooks + "2") above chords so the number is never buried.
	const endingEl = layer.querySelector('g.abcjs-ending');
	if (endingEl) layer.appendChild(endingEl);

	// Screen-space cleanup: fonts / CTM can still leave a hair of overlap.
	clearLabelFromEndingHook(layer);
	clearChordsFromEndingLabel(layer);
	// Drop [2] chords to the same height above the staff as [1]'s chord row.
	matchSecondEndingChordHeight(firstEndingG, layer);
}

/**
 * Chords on a short stacked-[2] system often sit higher than the inline [1]
 * row (abcjs's per-system anchor). Match mean gap-above-staff so the stacked
 * endings share one chord baseline.
 */
function matchSecondEndingChordHeight(
	firstEndingG: SVGGElement,
	layer: SVGGElement
): void {
	const firstWrapper = firstEndingG.closest('g.abcjs-staff-wrapper');
	const secondWrapper = layer.closest('g.abcjs-staff-wrapper');
	if (!firstWrapper || !secondWrapper) return;

	const firstStaff = firstWrapper.querySelector<SVGGraphicsElement>('.abcjs-staff');
	const secondStaff = secondWrapper.querySelector<SVGGraphicsElement>('.abcjs-staff');
	if (!firstStaff || !secondStaff) return;

	let firstEndingBox: DOMRect;
	try {
		firstEndingBox = firstEndingG.getBoundingClientRect();
	} catch {
		return;
	}

	// [1] chords whose ink overlaps the first-ending bracket's x-span.
	const firstChords = [
		...firstWrapper.querySelectorAll<SVGGraphicsElement>('text.abcjs-chord')
	].filter((c) => {
		try {
			const r = c.getBoundingClientRect();
			return r.right > firstEndingBox.left - 2 && r.left < firstEndingBox.right + 2;
		} catch {
			return false;
		}
	});
	const secondChords = [
		...layer.querySelectorAll<SVGGraphicsElement>('text.abcjs-chord')
	];
	if (firstChords.length === 0 || secondChords.length === 0) return;

	const gapAbove = (staff: Element, chord: Element): number | null => {
		try {
			const st = staff.getBoundingClientRect().top;
			const ct = chord.getBoundingClientRect().top;
			if (!Number.isFinite(st) || !Number.isFinite(ct)) return null;
			return st - ct; // + = chord above staff
		} catch {
			return null;
		}
	};

	const firstGap = meanFinite(
		firstChords.map((c) => gapAbove(firstStaff, c)).filter((v): v is number => v !== null)
	);
	const secondGap = meanFinite(
		secondChords.map((c) => gapAbove(secondStaff, c)).filter((v): v is number => v !== null)
	);
	if (firstGap === null || secondGap === null) return;

	const needPx = endingChordVerticalMatchDy(firstGap, secondGap);
	const localDy = screenToLocal(layer, needPx, 'y');
	if (localDy <= 0) return;
	const t = `translate(0,${localDy.toFixed(2)})`;
	for (const c of secondChords) prependTransform(c, t);
}

/**
 * Push the volta number right of the left hook if the compressed path left
 * the full-size digit sitting on the bracket.
 */
function clearLabelFromEndingHook(layer: SVGGElement): void {
	const ending = layer.querySelector<SVGGElement>('g.abcjs-ending');
	const labelEl = ending?.querySelector<SVGGraphicsElement>('text');
	const pathEl = ending?.querySelector<SVGGraphicsElement>('path, line');
	if (!labelEl || !pathEl) return;

	let hookLeft: number;
	let labelLeft: number;
	try {
		hookLeft = pathEl.getBoundingClientRect().left;
		labelLeft = labelEl.getBoundingClientRect().left;
	} catch {
		return;
	}
	if (!Number.isFinite(hookLeft) || !Number.isFinite(labelLeft)) return;

	const needPx = hookLeft + ENDING_LABEL_HOOK_MIN_GAP - labelLeft;
	const localDx = screenToLocal(layer, needPx, 'x');
	if (localDx <= 0) return;
	prependTransform(labelEl, `translate(${localDx.toFixed(2)},0)`);
}

/**
 * After transforms are applied, ensure every chord in the layer sits to the
 * right of the volta number with {@link ENDING_LABEL_CHORD_MIN_GAP} in screen
 * pixels (converted to local user units via the layer CTM).
 */
function clearChordsFromEndingLabel(layer: SVGGElement): void {
	const labelEl = layer.querySelector<SVGGraphicsElement>('g.abcjs-ending text');
	if (!labelEl) return;
	const chords = [...layer.querySelectorAll<SVGGraphicsElement>('text.abcjs-chord')];
	if (chords.length === 0) return;

	let labelRight: number;
	try {
		labelRight = labelEl.getBoundingClientRect().right;
	} catch {
		return;
	}
	if (!Number.isFinite(labelRight)) return;

	let needPx = 0;
	for (const c of chords) {
		try {
			const left = c.getBoundingClientRect().left;
			if (!Number.isFinite(left)) continue;
			const n = labelRight + ENDING_LABEL_CHORD_MIN_GAP - left;
			if (n > needPx) needPx = n;
		} catch {
			/* skip */
		}
	}
	const localDx = screenToLocal(layer, needPx, 'x');
	if (localDx <= 0) return;
	const t = `translate(${localDx.toFixed(2)},0)`;
	for (const c of chords) prependTransform(c, t);
}

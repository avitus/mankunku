<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import type { Snippet } from 'svelte';
	import type { Phrase } from '$lib/types/music';
	import type { Tune } from '$lib/types/tune';
	import type { InstrumentConfig } from '$lib/types/instruments';
	import { phraseToAbcWithMap, type PitchedNoteAnchor } from '$lib/music/notation';
	import {
		tuneToAbcWithMap,
		type BarAnchor,
		type ChordSlotAnchor
	} from '$lib/music/tune-notation';
	import { barZones, chordZones, type ChordZone } from '$lib/notation/chart-geometry';
	import {
		systemsFromVisualObj,
		toSystemLayouts,
		findVoiceItem,
		overlayBoxPct,
		formShape,
		resolveChartClick,
		chordKeyAction,
		bandGeometry,
		barHitRect,
		chordHitRect,
		chordSymbolDeltas,
		glissandoWave,
		type AdapterVisualObj,
		type BandGeometry,
		type OverlayBox,
		type RectSpec
	} from '$lib/notation/abcjs-adapter';

	type BeatPos = { sectionIdx: number; bar: number; beat: number };

	/** Tinted bar-range band on a tune chart, in absolute notation bars. */
	export interface RangeMarker {
		id: string;
		startBar: number;
		endBarExclusive: number;
		/** 'playhead' is the moving current-bar band (never labeled). */
		status: 'upcoming' | 'active' | 'hit' | 'missed' | 'playhead';
		/** Text drawn inside the band below the staff (e.g. the lick's name). */
		label?: string;
	}

	interface Props {
		phrase?: Phrase | null;
		/**
		 * Full song form rendered with chord symbols, section markers, and
		 * multi-system reflow. Takes precedence over `phrase` when set;
		 * click/highlight indices refer to the flattened note order
		 * (`flattenTune(sheet).notes`).
		 */
		tune?: Tune | null;
		instrument?: InstrumentConfig;
		/** Source-array index of the note to highlight, or `null` for no highlight. */
		selectedIndex?: number | null;
		/**
		 * Playback cursor (notation-order note index), styled distinctly from
		 * `selectedIndex`. Unlike `selectedIndex`, changing it never re-renders
		 * the chart — a dedicated effect swaps a CSS class on the stashed
		 * anchors, so it is safe to drive per-note during playback.
		 */
		cursorIndex?: number | null;
		/**
		 * Insertion-point range bands (tune charts only). Status changes swap
		 * a handful of overlay rects without re-rendering the chart.
		 */
		rangeMarkers?: RangeMarker[];
		/** Fires when the user clicks a pitched note. Receives the source-array index. */
		onSelect?: (sourceIndex: number) => void;
		/**
		 * Fires when the user clicks a bar's empty space, a rest, or a chord
		 * symbol on a tune chart. Enables the invisible per-bar hit rects.
		 */
		onBarClick?: (pos: { sectionIdx: number; bar: number }) => void;
		/**
		 * Inline on-chart chord editing. Enables per-beat hit rects above the
		 * staff; clicking one opens a positioned input prefilled via `textAt`.
		 * `commit` returns false for unparseable text (input flashes and stays
		 * open); blank input calls `clear`.
		 */
		chordEditor?: {
			textAt: (pos: BeatPos) => string | null;
			commit: (pos: BeatPos, text: string) => boolean;
			clear: (pos: BeatPos) => void;
		};
		titleArea?: Snippet;
	}

	let {
		phrase = null,
		tune = null,
		instrument,
		selectedIndex = null,
		cursorIndex = null,
		rangeMarkers,
		onSelect,
		onBarClick,
		chordEditor,
		titleArea
	}: Props = $props();

	let containerEl = $state<HTMLDivElement | undefined>(undefined);
	let abcjs = $state<typeof import('abcjs') | null>(null);

	// ── Inline chord editor state ────────────────────────────────────────────
	let chordEdit: BeatPos | null = $state(null);
	let chordInputValue = $state('');
	let chordInputEl: HTMLInputElement | undefined = $state();
	let errorFlash = $state(false);
	let errorTimer: ReturnType<typeof setTimeout> | null = null;
	let overlayBox: OverlayBox | null = $state(null);
	/** Bumped after every abcjs render so the input re-positions/re-focuses. */
	let renderVersion = $state(0);

	/** Per-system vertical geometry, measured before any hit rects go in. */
	interface SystemBand extends BandGeometry {
		wrapper: SVGGElement;
	}

	// Non-reactive per-render caches consumed by the positioning effect.
	let lastChordZones: ChordZone[] = [];
	let systemBands: SystemBand[] = [];
	let lastViewBox: { width: number; height: number } | null = null;
	// Non-reactive per-render caches for the cursor + range-marker effects —
	// they let those effects address the rendered SVG without re-running
	// renderAbc (the render effect must never read cursorIndex/rangeMarkers).
	let lastVisualObj: AdapterVisualObj | null = null;
	let lastNoteAnchors: PitchedNoteAnchor[] = [];
	let lastBarZones: ReturnType<typeof barZones> = [];
	let prevCursorEl: SVGGraphicsElement | null = null;

	onMount(async () => {
		abcjs = await import('abcjs');
	});

	$effect(() => () => {
		if (errorTimer) clearTimeout(errorTimer);
	});

	$effect(() => {
		if (!abcjs || !containerEl || (!phrase && !tune)) return;

		const rendered: {
			abc: string;
			noteAnchors: PitchedNoteAnchor[];
			barAnchors: BarAnchor[];
			chordSlotAnchors: ChordSlotAnchor[];
		} = tune
			? tuneToAbcWithMap(tune, instrument)
			: { ...phraseToAbcWithMap(phrase!, instrument), barAnchors: [], chordSlotAnchors: [] };
		const { abc, noteAnchors, barAnchors, chordSlotAnchors } = rendered;
		const [visualObj] = abcjs.renderAbc(containerEl, abc, {
			responsive: 'resize',
			staffwidth: 600,
			paddingtop: 10,
			paddingbottom: 10,
			add_classes: true,
			clickListener: (abcElem, _tuneNumber, _classes, analysis) => {
				if (!abcElem) return;
				const startChar = (abcElem as { startChar?: number }).startChar;
				if (typeof startChar !== 'number') return;
				const target = resolveChartClick(startChar, noteAnchors, chordSlotAnchors, barAnchors);
				if (target?.kind === 'note') {
					onSelect?.(target.sourceIndex);
					return;
				}
				if (target?.kind !== 'bar') return;
				// Clicking a rendered chord SYMBOL means "edit this chord"
				// (MuseScore behavior), not "move the cursor". The clicked-glyph
				// name distinguishes the chord text from the other glyphs (rests)
				// sharing the chord voice's charspans.
				if (chordEditor && analysis?.clickedName === 'chord') {
					const slot = chordSlotAnchors.find(
						(a) => startChar >= a.startChar && startChar < a.endChar
					);
					if (slot) {
						openChordEditorAt({ sectionIdx: slot.sectionIdx, bar: slot.bar, beat: slot.beat });
						return;
					}
				}
				onBarClick?.(target.pos);
			}
		});
		const vo = visualObj as unknown as AdapterVisualObj;

		normalizeChordVoiceRests(containerEl);
		dropChordSymbols(containerEl);
		drawGlissandi(vo, noteAnchors);
		applySelectionHighlight(vo, noteAnchors, selectedIndex);
		buildHitZones(containerEl, vo, rendered);
		// Stash for the cursor/marker effects. The cursor element belonged to
		// the SVG this render just replaced, so forget it.
		lastVisualObj = vo;
		lastNoteAnchors = noteAnchors;
		prevCursorEl = null;
		untrack(() => (renderVersion += 1));
	});

	// Playback cursor — a class swap on the stashed render, never a re-render.
	$effect(() => {
		const idx = cursorIndex;
		void renderVersion;
		prevCursorEl?.classList.remove('cursor-note');
		prevCursorEl = null;
		if (idx === null || idx === undefined || !lastVisualObj) return;
		const anchor = lastNoteAnchors.find((a) => a.sourceIndex === idx);
		if (!anchor) return;
		const el = elementForAnchor(lastVisualObj, anchor);
		if (el) {
			el.classList.add('cursor-note');
			prevCursorEl = el;
		}
	});

	// Insertion-point range bands — a handful of overlay rects per status
	// change, inserted below the glyphs like the bar hit rects.
	$effect(() => {
		const markers = rangeMarkers;
		void renderVersion;
		const container = containerEl;
		if (!container) return;
		for (const stale of container.querySelectorAll('.range-marker')) stale.remove();
		const sheet = tune;
		if (!markers?.length || !sheet || systemBands.length === 0 || lastBarZones.length === 0) return;

		const sectionBases: number[] = [];
		let barsAcc = 0;
		for (const sec of sheet.sections) {
			sectionBases.push(barsAcc);
			barsAcc += sec.bars;
		}

		for (const marker of markers) {
			// Merge the marker's bar zones into one x-run per system row.
			const runs = new Map<number, { x0: number; x1: number }>();
			for (const zone of lastBarZones) {
				const absBar = sectionBases[zone.sectionIdx] + zone.bar;
				if (absBar < marker.startBar || absBar >= marker.endBarExclusive) continue;
				const run = runs.get(zone.systemIdx);
				if (run) {
					run.x0 = Math.min(run.x0, zone.x0);
					run.x1 = Math.max(run.x1, zone.x1);
				} else {
					runs.set(zone.systemIdx, { x0: zone.x0, x1: zone.x1 });
				}
			}
			let labelPlaced = false;
			for (const systemIdx of [...runs.keys()].sort((a, b) => a - b)) {
				const run = runs.get(systemIdx)!;
				const band = systemBands[systemIdx];
				if (!band) continue;
				const spec = barHitRect(run, band);
				const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
				rect.setAttribute('x', spec.x.toFixed(2));
				rect.setAttribute('y', spec.y.toFixed(2));
				rect.setAttribute('width', Math.max(0, spec.w).toFixed(2));
				rect.setAttribute('height', Math.max(0, spec.h).toFixed(2));
				rect.setAttribute('rx', '4');
				rect.setAttribute('class', `range-marker marker-${marker.status}`);
				rect.setAttribute('data-marker-id', marker.id);
				band.wrapper.insertBefore(rect, band.wrapper.firstChild);

				// Lick/progression name inside the band, below the staff — on the
				// marker's first system only. Truncated to the run width so long
				// names can't bleed into the next insertion point.
				if (marker.label && marker.status !== 'playhead' && !labelPlaced) {
					labelPlaced = true;
					const fontSize = band.spacing * 1.8;
					const maxChars = Math.max(3, Math.floor((run.x1 - run.x0 - band.spacing) / (fontSize * 0.58)));
					const text =
						marker.label.length > maxChars
							? marker.label.slice(0, Math.max(1, maxChars - 1)) + '…'
							: marker.label;
					const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
					el.setAttribute('x', (run.x0 + band.spacing * 0.6).toFixed(2));
					el.setAttribute('y', (band.staffBottom + band.spacing * 1.9).toFixed(2));
					el.setAttribute('font-size', fontSize.toFixed(2));
					el.setAttribute('class', `range-marker range-marker-label marker-label-${marker.status}`);
					el.setAttribute('data-marker-id', marker.id);
					el.textContent = text;
					band.wrapper.appendChild(el);
				}
			}
		}
	});

	/**
	 * Position (and re-position after every re-render) the inline chord input
	 * over its beat cell, then focus it. Closes the editor when the rendered
	 * chart no longer has the target slot.
	 */
	$effect(() => {
		const pos = chordEdit;
		void renderVersion;
		if (!pos) {
			overlayBox = null;
			return;
		}
		const zone = lastChordZones.find(
			(z) => z.sectionIdx === pos.sectionIdx && z.bar === pos.bar && z.beat === pos.beat
		);
		const band = zone ? systemBands[zone.systemIdx] : undefined;
		if (!zone || !band || !lastViewBox) {
			chordEdit = null;
			overlayBox = null;
			return;
		}
		overlayBox = overlayBoxPct(zone, lastViewBox, band.top);
		tick().then(() => {
			if (chordEdit === pos) {
				chordInputEl?.focus();
				chordInputEl?.select();
			}
		});
	});

	/** Open the inline chord editor at a form position (also for `bind:this`). */
	export function openChordEditorAt(pos: BeatPos): void {
		if (!tune || !chordEditor) return;
		chordInputValue = chordEditor.textAt(pos) ?? '';
		errorFlash = false;
		chordEdit = pos;
	}

	function closeChordEditor(): void {
		chordEdit = null;
		chordInputValue = '';
		errorFlash = false;
	}

	function flashError(): void {
		errorFlash = true;
		if (errorTimer) clearTimeout(errorTimer);
		errorTimer = setTimeout(() => (errorFlash = false), 300);
	}

	/** Commit the input at the open position; false = invalid (and flashed). */
	function commitChord(): boolean {
		if (!chordEdit || !chordEditor) return false;
		const text = chordInputValue.trim();
		if (text === '') {
			chordEditor.clear(chordEdit);
			return true;
		}
		if (chordEditor.commit(chordEdit, text)) return true;
		flashError();
		return false;
	}

	function handleChordKeydown(e: KeyboardEvent): void {
		// The editor pages listen for note-entry keys on window — nothing
		// typed here may leak out.
		e.stopPropagation();
		if (!chordEdit || !tune) return;
		const action = chordKeyAction(e.key, e.shiftKey, chordEdit, formShape(tune));
		if (!action) return;
		if (action.preventDefault) e.preventDefault();
		if (action.type === 'close') return closeChordEditor();
		if (!commitChord()) return; // invalid: flashed, stay put
		if (action.type === 'commit-advance' && action.target) openChordEditorAt(action.target);
		else closeChordEditor();
	}

	function handleChordBlur(): void {
		if (!chordEdit) return;
		if (commitChord()) closeChordEditor();
		// Invalid text: flashed by commitChord; stay open for a fix.
	}

	/**
	 * Invisible click targets over the chart: one rect per bar (empty-space
	 * clicks → `onBarClick`) inserted BELOW the glyphs, and one per beat cell
	 * in the chord band above the staff (clicks → inline chord editor)
	 * appended ABOVE them. Rendered in SVG user units inside each system's
	 * `.abcjs-staff-wrapper`, so the responsive viewBox rescales them for free.
	 */
	function buildHitZones(
		container: HTMLDivElement,
		visualObj: AdapterVisualObj,
		anchors: {
			noteAnchors: PitchedNoteAnchor[];
			barAnchors: BarAnchor[];
			chordSlotAnchors: ChordSlotAnchor[];
		}
	): void {
		lastChordZones = [];
		systemBands = [];
		lastViewBox = null;
		lastBarZones = [];
		const sheet = tune;
		// Geometry (bands + bar zones) is measured for every tune render — the
		// range-marker effect needs it even when no hit rects are requested.
		if (!sheet) return;
		const svg = container.querySelector('svg');
		if (!svg) return;
		const vb = svg.viewBox.baseVal;
		lastViewBox = { width: vb.width, height: vb.height };

		const systems = toSystemLayouts(systemsFromVisualObj(visualObj));
		// Wrapper n ↔ system n: both follow the visualObj music-line order.
		// Measure every band BEFORE inserting rects (rects would inflate boxes).
		for (const wrapper of svg.querySelectorAll<SVGGElement>('g.abcjs-staff-wrapper')) {
			const staffEl = wrapper.querySelector<SVGGraphicsElement>('.abcjs-staff');
			if (!staffEl) break; // keep index alignment: stop at the first oddity
			const staffBox = staffEl.getBBox();
			const wrapBox = wrapper.getBBox();
			systemBands.push({ wrapper, ...bandGeometry(wrapBox.y, staffBox.y, staffBox.height) });
		}

		lastBarZones = barZones(systems, anchors.barAnchors);

		if (onBarClick) {
			for (const zone of lastBarZones) {
				const band = systemBands[zone.systemIdx];
				if (!band) continue;
				const rect = makeHitRect(barHitRect(zone, band), 'bar-hit');
				const pos = { sectionIdx: zone.sectionIdx, bar: zone.bar };
				rect.setAttribute('data-bar-pos', `${pos.sectionIdx}:${pos.bar}`);
				rect.addEventListener('click', (e) => {
					e.stopPropagation();
					onBarClick?.(pos);
				});
				band.wrapper.insertBefore(rect, band.wrapper.firstChild);
			}
		}

		if (chordEditor) {
			lastChordZones = chordZones({
				systems,
				barAnchors: anchors.barAnchors,
				noteAnchors: anchors.noteAnchors,
				chordSlotAnchors: anchors.chordSlotAnchors,
				beatsPerBar: sheet.timeSignature[0],
				barDurationWholeNotes: sheet.timeSignature[0] / sheet.timeSignature[1]
			});
			for (const zone of lastChordZones) {
				const band = systemBands[zone.systemIdx];
				if (!band) continue;
				const rect = makeHitRect(chordHitRect(zone, band), 'chord-hit');
				const pos = { sectionIdx: zone.sectionIdx, bar: zone.bar, beat: zone.beat };
				rect.setAttribute('data-chord-pos', `${pos.sectionIdx}:${pos.bar}:${pos.beat}`);
				rect.addEventListener('click', (e) => {
					e.stopPropagation();
					openChordEditorAt(pos);
				});
				band.wrapper.appendChild(rect);
			}
		}
	}

	function makeHitRect(spec: RectSpec, kind: string): SVGRectElement {
		const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
		rect.setAttribute('x', spec.x.toFixed(2));
		rect.setAttribute('y', spec.y.toFixed(2));
		rect.setAttribute('width', Math.max(0, spec.w).toFixed(2));
		rect.setAttribute('height', Math.max(0, spec.h).toFixed(2));
		rect.setAttribute('rx', '3');
		rect.setAttribute('class', `hit-zone ${kind}`);
		// abcjs binds mousedown/mouseup AND touchstart/touchend on the SVG and
		// resolves clicks by PROXIMITY — swallow all four so a rect tap/click
		// can't double-dispatch through the clickListener as a phantom
		// note/bar hit nearby.
		const swallow = (e: Event) => e.stopPropagation();
		rect.addEventListener('mousedown', swallow);
		rect.addEventListener('mouseup', swallow);
		rect.addEventListener('touchstart', swallow);
		rect.addEventListener('touchend', swallow);
		return rect;
	}

	/**
	 * abcjs drops second-voice rests exactly TWO staff-line spacings below
	 * the standard single-voice position (measured per rest type against a
	 * single-voice reference render). Tunes render the READER's rests
	 * from the invisible chord voice (V:H, voice index 1), so shift those
	 * glyphs back up to the standard positions (eighth/quarter rests
	 * centered on the staff, the semibreve rest in the C space).
	 */
	function normalizeChordVoiceRests(container: HTMLDivElement): void {
		for (const svg of container.querySelectorAll('svg')) {
			const staff = svg.querySelector('.abcjs-staff') as SVGGraphicsElement | null;
			if (!staff) continue;
			const spacing = staff.getBBox().height / 4;
			if (!Number.isFinite(spacing) || spacing <= 0) continue;
			for (const rest of svg.querySelectorAll('.abcjs-rest.abcjs-v1')) {
				// The rest group ALSO carries the segment's chord <text> —
				// translating the group would drag the chord symbol up with
				// the rest glyph (and used to: every tune chord rode two
				// extra spacings above abcjs's own row). Shift only the ink.
				for (const child of rest.children) {
					if (child.tagName !== 'text') {
						child.setAttribute('transform', `translate(0, ${-2 * spacing})`);
					}
				}
			}
		}
	}

	/**
	 * Drop chord symbols to MuseScore's default height. abcjs parks every
	 * chord in a system above the tallest element of the WHOLE line (one
	 * high bar lifts them all); `chordSymbolDeltas` computes per-chord
	 * corrections instead — baseline 2.5 spacings above the top line,
	 * pushed up only over x-overlapping ink. Endings/parts/tempo float
	 * above the chord row by abcjs's layout and rests never reach it, so
	 * none of them count as obstacles (voice-H rests also carry stale
	 * pre-transform boxes from the rest normalization). Must run BEFORE
	 * buildHitZones so the band measurements see final chord positions.
	 */
	function dropChordSymbols(container: HTMLDivElement): void {
		for (const svg of container.querySelectorAll('svg')) {
			for (const wrapper of svg.querySelectorAll<SVGGElement>('g.abcjs-staff-wrapper')) {
				const chordEls = [...wrapper.querySelectorAll<SVGTextElement>('text.abcjs-chord')];
				if (chordEls.length === 0) continue;
				const staffEl = wrapper.querySelector<SVGGraphicsElement>('.abcjs-staff');
				if (!staffEl) continue;
				const staffBox = staffEl.getBBox();
				const chords = chordEls.map((el) => ({
					baselineY: Number.parseFloat(el.getAttribute('y') ?? ''),
					box: el.getBBox()
				}));
				const obstacles = [
					...wrapper.querySelectorAll<SVGGraphicsElement>('path, ellipse, rect, circle, polygon, line, text')
				]
					.filter(
						(leaf) =>
							!leaf.closest('.abcjs-chord, .abcjs-ending, .abcjs-part, .abcjs-tempo, .abcjs-rest, .hit-zone')
					)
					.map((leaf) => leaf.getBBox());
				const deltas = chordSymbolDeltas(chords, obstacles, staffBox.y, staffBox.height / 4);
				chordEls.forEach((el, i) => {
					if (Math.abs(deltas[i]) > 0.01) {
						el.setAttribute('transform', `translate(0, ${deltas[i].toFixed(2)})`);
					}
				});
			}
		}
	}

	/** The rendered SVG group for an anchor's note, resolved by charspan. */
	function elementForAnchor(
		visualObj: AdapterVisualObj,
		anchor: PitchedNoteAnchor
	): SVGGraphicsElement | null {
		const el = findVoiceItem(visualObj, anchor.startChar)?.abselem?.elemset?.[0];
		return el instanceof SVGGraphicsElement ? el : null;
	}

	/**
	 * MuseScore-style glissando: a wavy line connecting the two noteheads
	 * (abcjs has no native glissando). Anchors flag the SOURCE note; the
	 * target is the next pitched note. Pairs split across rendered lines
	 * are skipped, as are pairs too close to fit a wave.
	 */
	function drawGlissandi(visualObj: AdapterVisualObj, anchors: PitchedNoteAnchor[]): void {
		anchors.forEach((anchor, i) => {
			if (!anchor.gliss || i + 1 >= anchors.length) return;
			const src = elementForAnchor(visualObj, anchor);
			const tgt = elementForAnchor(visualObj, anchors[i + 1]);
			if (!src || !tgt) return;
			const svg = src.ownerSVGElement;
			if (!svg || tgt.ownerSVGElement !== svg) return;
			const staff = svg.querySelector('.abcjs-staff') as SVGGraphicsElement | null;
			if (!staff) return;
			const spacing = staff.getBBox().height / 4;
			const srcHead = (src.querySelector('.abcjs-notehead') ?? src) as SVGGraphicsElement;
			const tgtHead = (tgt.querySelector('.abcjs-notehead') ?? tgt) as SVGGraphicsElement;
			const wave = glissandoWave(srcHead.getBBox(), tgtHead.getBBox(), spacing);
			if (!wave) return;
			const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			path.setAttribute('d', wave.d);
			path.setAttribute('fill', 'none');
			path.setAttribute('stroke', 'currentColor');
			path.setAttribute('stroke-width', wave.strokeWidth);
			path.setAttribute('stroke-linecap', 'round');
			path.setAttribute('class', 'abcjs-glissando');
			svg.appendChild(path);
		});
	}

	/** Colour the selected note's group, resolved from its anchor charspan. */
	function applySelectionHighlight(
		visualObj: AdapterVisualObj,
		anchors: PitchedNoteAnchor[],
		index: number | null
	): void {
		if (index === null) return;
		const anchor = anchors.find((a) => a.sourceIndex === index);
		if (!anchor) return;
		elementForAnchor(visualObj, anchor)?.classList.add('selected-note');
	}
</script>

<div class="notation-container rounded-lg bg-[var(--color-bg-secondary)] p-4" class:has-custom-title={titleArea}>
	<!-- "Chart" liner-note header — mirrors the typography of a Blue Note LP.
	     "Chart" covers both renderable payloads (a lick phrase or a full tune). -->
	<div class="mb-4 flex items-center gap-2">
		<span class="smallcaps text-[var(--color-brass)]">Chart</span>
		<div class="jazz-rule flex-1"></div>
	</div>
	{#if titleArea}
		{@render titleArea()}
	{/if}
	{#if phrase || tune}
		<div class="relative">
			<div bind:this={containerEl} class="abcjs-container"></div>
			{#if chordEdit && overlayBox}
				<input
					bind:this={chordInputEl}
					bind:value={chordInputValue}
					onkeydown={handleChordKeydown}
					onblur={handleChordBlur}
					autocomplete="off"
					spellcheck="false"
					data-testid="chord-input"
					aria-label="Chord at section {chordEdit.sectionIdx + 1}, bar {chordEdit.bar + 1}, beat {chordEdit.beat + 1}"
					style="left: {overlayBox.leftPct}%; top: {overlayBox.topPct}%; width: {overlayBox.widthPct}%"
					class="absolute z-10 rounded px-1 py-0.5 text-center text-xs outline-none ring-2 {errorFlash
						? 'bg-[var(--color-error)]/15 ring-[var(--color-error)]'
						: 'bg-[var(--color-bg-secondary)] ring-[var(--color-accent)]'}"
				/>
			{/if}
		</div>
	{:else}
		<div class="flex h-24 items-center justify-center italic text-[var(--color-text-secondary)]">
			No phrase loaded
		</div>
	{/if}
</div>

<style>
	.notation-container :global(svg) {
		width: 100%;
		max-width: 100%;
	}
	/* Style abcjs SVG for dark mode (hit zones + markers stay strokeless) */
	.notation-container :global(svg path),
	.notation-container :global(svg line),
	.notation-container :global(svg rect:not(.abcjs-note_selected):not(.hit-zone):not(.range-marker)) {
		stroke: var(--color-text) !important;
	}
	.notation-container :global(svg text) {
		fill: var(--color-text) !important;
	}
	/* Invisible click targets over the chart; hover hints at the live zone */
	.notation-container :global(svg .hit-zone) {
		fill: transparent;
		stroke: none;
	}
	.notation-container :global(svg .bar-hit) {
		cursor: pointer;
	}
	.notation-container :global(svg .bar-hit:hover) {
		fill: var(--color-accent);
		fill-opacity: 0.05;
	}
	.notation-container :global(svg .chord-hit) {
		cursor: text;
	}
	.notation-container :global(svg .chord-hit:hover) {
		fill: var(--color-accent);
		fill-opacity: 0.08;
	}
	/* Suppress abcjs-rendered title when the parent provides its own title area */
	.notation-container.has-custom-title :global(.abcjs-title) {
		display: none;
	}
	/* Cursor affordance: every pitched note is clickable */
	.notation-container :global(.abcjs-note) {
		cursor: pointer;
	}
	/* User-selected note — colored notehead + stem so it stands out on the staff.
	   Includes the .abcjs-note group itself in case abcjs renders the notehead
	   directly on that element rather than on a child path/ellipse/circle. */
	.notation-container :global(.abcjs-note.selected-note),
	.notation-container :global(.abcjs-note.selected-note path),
	.notation-container :global(.abcjs-note.selected-note ellipse),
	.notation-container :global(.abcjs-note.selected-note circle) {
		fill: var(--color-accent) !important;
		stroke: var(--color-accent) !important;
	}
	.notation-container :global(.abcjs-note.selected-note line) {
		stroke: var(--color-accent) !important;
	}
	/* Playback cursor — brass to contrast the accent-colored selection.
	   Declared after selected-note so the cursor wins if both land on one note. */
	.notation-container :global(.abcjs-note.cursor-note),
	.notation-container :global(.abcjs-note.cursor-note path),
	.notation-container :global(.abcjs-note.cursor-note ellipse),
	.notation-container :global(.abcjs-note.cursor-note circle) {
		fill: var(--color-brass) !important;
		stroke: var(--color-brass) !important;
	}
	.notation-container :global(.abcjs-note.cursor-note line) {
		stroke: var(--color-brass) !important;
	}
	/* Insertion-point range bands — translucent status tints under the glyphs. */
	.notation-container :global(svg .range-marker) {
		stroke: none;
		pointer-events: none;
	}
	.notation-container :global(svg .range-marker.marker-upcoming) {
		fill: var(--color-accent);
		fill-opacity: 0.08;
	}
	.notation-container :global(svg .range-marker.marker-active) {
		fill: var(--color-brass);
		fill-opacity: 0.18;
	}
	.notation-container :global(svg .range-marker.marker-hit) {
		fill: var(--color-success);
		fill-opacity: 0.12;
	}
	.notation-container :global(svg .range-marker.marker-missed) {
		fill: var(--color-error);
		fill-opacity: 0.1;
	}
	/* Moving current-bar band — keeps the player's place on the chart. */
	.notation-container :global(svg .range-marker.marker-playhead) {
		fill: var(--color-brass);
		fill-opacity: 0.1;
	}
	/* Band labels (lick / progression names) — colored to match their band.
	   The dark-mode text rule targets svg text broadly, so these need !important
	   to keep their band color. */
	.notation-container :global(svg text.range-marker-label) {
		stroke: none !important;
		font-weight: 600;
		pointer-events: none;
	}
	.notation-container :global(svg text.range-marker-label.marker-label-upcoming) {
		fill: var(--color-accent) !important;
	}
	.notation-container :global(svg text.range-marker-label.marker-label-active) {
		fill: var(--color-brass) !important;
	}
	.notation-container :global(svg text.range-marker-label.marker-label-hit) {
		fill: var(--color-success) !important;
	}
	.notation-container :global(svg text.range-marker-label.marker-label-missed) {
		fill: var(--color-error) !important;
	}
</style>

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
		glissandoWave,
		type AdapterVisualObj,
		type BandGeometry,
		type OverlayBox,
		type RectSpec
	} from '$lib/notation/abcjs-adapter';

	type BeatPos = { sectionIdx: number; bar: number; beat: number };

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
			clickListener: (abcElem) => {
				if (!abcElem) return;
				const startChar = (abcElem as { startChar?: number }).startChar;
				if (typeof startChar !== 'number') return;
				const target = resolveChartClick(startChar, noteAnchors, chordSlotAnchors, barAnchors);
				if (target?.kind === 'note') onSelect?.(target.sourceIndex);
				else if (target?.kind === 'bar') onBarClick?.(target.pos);
			}
		});
		const vo = visualObj as unknown as AdapterVisualObj;

		normalizeChordVoiceRests(containerEl);
		drawGlissandi(vo, noteAnchors);
		applySelectionHighlight(vo, noteAnchors, selectedIndex);
		buildHitZones(containerEl, vo, rendered);
		untrack(() => (renderVersion += 1));
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
		const sheet = tune;
		if (!sheet || (!onBarClick && !chordEditor)) return;
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

		if (onBarClick) {
			for (const zone of barZones(systems, anchors.barAnchors)) {
				const band = systemBands[zone.systemIdx];
				if (!band) continue;
				const rect = makeHitRect(barHitRect(zone, band), 'bar-hit');
				const pos = { sectionIdx: zone.sectionIdx, bar: zone.bar };
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
		// abcjs binds mousedown/mouseup on the SVG and resolves clicks by
		// PROXIMITY — swallow both so a rect click can't double-dispatch
		// through the clickListener as a phantom note/bar hit nearby.
		const swallow = (e: Event) => e.stopPropagation();
		rect.addEventListener('mousedown', swallow);
		rect.addEventListener('mouseup', swallow);
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
				rest.setAttribute('transform', `translate(0, ${-2 * spacing})`);
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
					aria-label="Chord at bar {chordEdit.bar + 1}, beat {chordEdit.beat + 1}"
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
	/* Style abcjs SVG for dark mode (hit zones stay strokeless + fill-driven) */
	.notation-container :global(svg path),
	.notation-container :global(svg line),
	.notation-container :global(svg rect:not(.abcjs-note_selected):not(.hit-zone)) {
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
</style>

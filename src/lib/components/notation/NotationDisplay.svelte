<script lang="ts">
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import type { Phrase } from '$lib/types/music';
	import type { Tune } from '$lib/types/tune';
	import type { InstrumentConfig } from '$lib/types/instruments';
	import { phraseToAbcWithMap, type PitchedNoteAnchor } from '$lib/music/notation';
	import { leadSheetToAbcWithMap } from '$lib/music/lead-sheet-notation';

	interface Props {
		phrase?: Phrase | null;
		/**
		 * Full song form rendered with chord symbols, section markers, and
		 * multi-system reflow. Takes precedence over `phrase` when set;
		 * click/highlight indices refer to the flattened note order
		 * (`flattenLeadSheet(sheet).notes`).
		 */
		leadSheet?: Tune | null;
		instrument?: InstrumentConfig;
		/** Source-array index of the note to highlight, or `null` for no highlight. */
		selectedIndex?: number | null;
		/** Fires when the user clicks a pitched note. Receives the source-array index. */
		onSelect?: (sourceIndex: number) => void;
		titleArea?: Snippet;
	}

	let { phrase = null, leadSheet = null, instrument, selectedIndex = null, onSelect, titleArea }: Props = $props();

	let containerEl = $state<HTMLDivElement | undefined>(undefined);
	let abcjs = $state<typeof import('abcjs') | null>(null);

	onMount(async () => {
		abcjs = await import('abcjs');
	});

	$effect(() => {
		if (!abcjs || !containerEl || (!phrase && !leadSheet)) return;

		const { abc, noteAnchors } = leadSheet
			? leadSheetToAbcWithMap(leadSheet, instrument)
			: phraseToAbcWithMap(phrase!, instrument);
		abcjs.renderAbc(containerEl, abc, {
			responsive: 'resize',
			staffwidth: 600,
			paddingtop: 10,
			paddingbottom: 10,
			add_classes: true,
			clickListener: (abcElem) => {
				if (!onSelect || !abcElem) return;
				const startChar = (abcElem as { startChar?: number }).startChar;
				if (typeof startChar !== 'number') return;
				const anchor = findAnchorAt(noteAnchors, startChar);
				if (anchor) onSelect(anchor.sourceIndex);
			}
		});

		normalizeChordVoiceRests(containerEl);
		drawGlissandi(containerEl, noteAnchors);
		applySelectionHighlight(containerEl, noteAnchors, selectedIndex);
	});

	/**
	 * abcjs drops second-voice rests exactly TWO staff-line spacings below
	 * the standard single-voice position (measured per rest type against a
	 * single-voice reference render). Lead sheets render the READER's rests
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

	/**
	 * MuseScore-style glissando: a wavy line connecting the two noteheads
	 * (abcjs has no native glissando). Anchors flag the SOURCE note; the
	 * target is the next pitched note. Pairs split across rendered lines
	 * are skipped, as are pairs too close to fit a wave.
	 */
	function drawGlissandi(container: HTMLDivElement, anchors: PitchedNoteAnchor[]): void {
		const noteEls = container.querySelectorAll('.abcjs-note');
		anchors.forEach((anchor, i) => {
			if (!anchor.gliss || i + 1 >= anchors.length) return;
			const src = noteEls[i] as SVGGraphicsElement | undefined;
			const tgt = noteEls[i + 1] as SVGGraphicsElement | undefined;
			if (!src || !tgt) return;
			const svg = src.ownerSVGElement;
			if (!svg || tgt.ownerSVGElement !== svg) return;
			const staff = svg.querySelector('.abcjs-staff') as SVGGraphicsElement | null;
			if (!staff) return;
			const spacing = staff.getBBox().height / 4;
			const srcHead = (src.querySelector('.abcjs-notehead') ?? src) as SVGGraphicsElement;
			const tgtHead = (tgt.querySelector('.abcjs-notehead') ?? tgt) as SVGGraphicsElement;
			const a = srcHead.getBBox();
			const b = tgtHead.getBBox();
			const pad = spacing * 0.25;
			const x1 = a.x + a.width + pad;
			const y1 = a.y + a.height / 2;
			const x2 = b.x - pad;
			const y2 = b.y + b.height / 2;
			const dx = x2 - x1;
			const dy = y2 - y1;
			const len = Math.hypot(dx, dy);
			if (len < spacing) return;
			// Squiggle along the connector: half-waves of ~0.8 spacing with
			// ~0.2 spacing amplitude, like MuseScore's wavy glissando.
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
			const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			path.setAttribute('d', d);
			path.setAttribute('fill', 'none');
			path.setAttribute('stroke', 'currentColor');
			path.setAttribute('stroke-width', Math.max(1, spacing * 0.13).toFixed(2));
			path.setAttribute('stroke-linecap', 'round');
			path.setAttribute('class', 'abcjs-glissando');
			svg.appendChild(path);
		});
	}

	function findAnchorAt(anchors: PitchedNoteAnchor[], char: number): PitchedNoteAnchor | undefined {
		// Exact-start match first (the common case), then fall back to range
		// containment for abcjs implementations that report a slightly different
		// position inside the note token.
		const exact = anchors.find((a) => a.startChar === char);
		if (exact) return exact;
		return anchors.find((a) => char >= a.startChar && char < a.endChar);
	}

	function applySelectionHighlight(
		container: HTMLDivElement,
		anchors: PitchedNoteAnchor[],
		index: number | null
	): void {
		if (index === null) return;
		const anchorIdx = anchors.findIndex((a) => a.sourceIndex === index);
		if (anchorIdx < 0) return;
		// abcjs renders pitched notes in source order with `.abcjs-note` (rests
		// get `.abcjs-rest`), so the nth `.abcjs-note` matches the nth anchor.
		const noteEls = container.querySelectorAll('.abcjs-note');
		const el = noteEls[anchorIdx] as HTMLElement | undefined;
		el?.classList.add('selected-note');
	}
</script>

<div class="notation-container rounded-lg bg-[var(--color-bg-secondary)] p-4" class:has-custom-title={titleArea}>
	<!-- "Lead sheet" liner-note header — mirrors the typography of a Blue Note LP -->
	<div class="mb-4 flex items-center gap-2">
		<span class="smallcaps text-[var(--color-brass)]">Lead sheet</span>
		<div class="jazz-rule flex-1"></div>
	</div>
	{#if titleArea}
		{@render titleArea()}
	{/if}
	{#if phrase || leadSheet}
		<div bind:this={containerEl} class="abcjs-container"></div>
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
	/* Style abcjs SVG for dark mode */
	.notation-container :global(svg path),
	.notation-container :global(svg line),
	.notation-container :global(svg rect:not(.abcjs-note_selected)) {
		stroke: var(--color-text) !important;
	}
	.notation-container :global(svg text) {
		fill: var(--color-text) !important;
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

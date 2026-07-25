<script lang="ts">
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import type { Phrase } from '$lib/types/music';
	import type { LeadSheet } from '$lib/types/lead-sheet';
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
		leadSheet?: LeadSheet | null;
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
		applySelectionHighlight(containerEl, noteAnchors, selectedIndex);
	});

	/**
	 * abcjs drops second-voice rests one staff line below their normal
	 * position (and raises first-voice rests one line). Lead sheets render
	 * the READER's rests from the invisible chord voice (V:H, voice index
	 * 1), so shift those glyphs back up one line-spacing to the standard
	 * single-voice position.
	 */
	function normalizeChordVoiceRests(container: HTMLDivElement): void {
		for (const svg of container.querySelectorAll('svg')) {
			const staff = svg.querySelector('.abcjs-staff') as SVGGraphicsElement | null;
			if (!staff) continue;
			const spacing = staff.getBBox().height / 4;
			if (!Number.isFinite(spacing) || spacing <= 0) continue;
			for (const rest of svg.querySelectorAll('.abcjs-rest.abcjs-v1')) {
				rest.setAttribute('transform', `translate(0, ${-spacing})`);
			}
		}
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

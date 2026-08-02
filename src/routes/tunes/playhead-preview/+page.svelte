<script lang="ts">
	// TEMPORARY design-preview page — compare current-bar playhead styles.
	// Delete this folder once a style is chosen. Not linked from nav.
	import { onMount, onDestroy } from 'svelte';
	import NotationDisplay, {
		type RangeMarker,
		type PlayheadStyle
	} from '$lib/components/notation/NotationDisplay.svelte';
	import { MANKUNKU_BLUES } from '$lib/data/tunes/index';
	import { getInstrument } from '$lib/state/settings.svelte';

	const tune = MANKUNKU_BLUES;
	// Notation bars across all sections (Intro 4 + A 10 + ending1 2 + ending2 2).
	const totalBars = tune.sections.reduce((n, s) => n + s.bars, 0);

	const OPTIONS: { style: PlayheadStyle; name: string; note: string }[] = [
		{
			style: 'under-bar',
			name: 'Under-bar band',
			note: 'Solid color only in the strip below the staff — notes and chords stay clean. (Your request.)'
		},
		{
			style: 'cursor-line',
			name: 'Cursor line',
			note: 'A bright vertical line at the bar’s leading edge with a flag — a DAW-style playhead.'
		},
		{
			style: 'box',
			name: 'Box outline',
			note: 'An outlined frame around the current bar; nothing washes over the notes.'
		},
		{
			style: 'wash-strong',
			name: 'Wash (bolder)',
			note: 'Today’s full-bar fill, but darker and edged — the current approach made visible.'
		},
		{
			style: 'underline-caret',
			name: 'Underline + caret',
			note: 'A thick underline beneath the bar plus a caret pointing at it from the left.'
		}
	];

	// A couple of static insertion bands so each playhead is judged against the
	// real colored bands it competes with during practice.
	const insertionBands: RangeMarker[] = [
		{ id: 'b-blues', startBar: 5, endBarExclusive: 6, status: 'upcoming', label: 'Blues' },
		{ id: 'b-turn', startBar: 10, endBarExclusive: 14, status: 'upcoming', label: 'Turnaround' },
		{ id: 'b-iiv', startBar: 14, endBarExclusive: 16, status: 'active', label: 'Short ii-V-I' }
	];

	let currentBar = $state(0);
	let playing = $state(true);
	let speedMs = $state(750);
	let timer: ReturnType<typeof setInterval> | null = null;

	const markers = $derived<RangeMarker[]>([
		...insertionBands,
		{ id: '__playhead', startBar: currentBar, endBarExclusive: currentBar + 1, status: 'playhead' }
	]);

	function restartTimer() {
		if (timer) clearInterval(timer);
		timer = null;
		if (!playing) return;
		timer = setInterval(() => {
			currentBar = (currentBar + 1) % totalBars;
		}, speedMs);
	}

	$effect(() => {
		void speedMs;
		void playing;
		restartTimer();
	});

	onMount(() => restartTimer());
	onDestroy(() => {
		if (timer) clearInterval(timer);
	});

	const instrument = $derived(getInstrument());
</script>

<svelte:head>
	<title>Playhead styles — Mankunku</title>
</svelte:head>

<div class="space-y-8">
	<div>
		<div class="mb-2 flex items-center gap-2">
			<span class="smallcaps text-[var(--color-brass)]">Preview</span>
			<div class="jazz-rule flex-1"></div>
		</div>
		<h1 class="font-display text-2xl font-bold">Current-bar playhead — options</h1>
		<p class="mt-1 text-sm text-[var(--color-text-secondary)]">
			Each chart shows the same tune with a different treatment for the moving current bar,
			animating against real insertion bands. Watch which one your eye finds fastest. Temporary
			page — pick one and I’ll ship it. Toggle light/dark in Settings to check both themes.
		</p>
	</div>

	<div class="flex flex-wrap items-center gap-4 rounded-lg bg-[var(--color-bg-secondary)] p-3">
		<button
			onclick={() => (playing = !playing)}
			class="rounded-full bg-[var(--color-bg-tertiary)] px-4 py-1.5 text-sm font-medium transition-colors hover:bg-[var(--color-bg)]"
		>
			{playing ? 'Pause' : 'Play'}
		</button>
		<label class="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
			Speed
			<input type="range" min="250" max="1400" step="50" bind:value={speedMs} class="accent-[var(--color-accent)]" />
			<span class="w-14 text-right font-mono">{(speedMs / 1000).toFixed(2)}s</span>
		</label>
		<label class="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
			Bar
			<input type="range" min="0" max={totalBars - 1} step="1" bind:value={currentBar} class="accent-[var(--color-accent)]" />
			<span class="w-10 text-right font-mono">{currentBar + 1}/{totalBars}</span>
		</label>
	</div>

	{#each OPTIONS as opt (opt.style)}
		<section class="space-y-2">
			<div class="flex items-baseline gap-3">
				<span class="smallcaps text-[var(--color-brass)]">{opt.name}</span>
				<span class="text-xs text-[var(--color-text-secondary)]">{opt.note}</span>
			</div>
			<NotationDisplay {tune} {instrument} rangeMarkers={markers} playheadStyle={opt.style} />
		</section>
	{/each}
</div>

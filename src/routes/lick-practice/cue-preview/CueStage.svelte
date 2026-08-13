<script lang="ts">
	// TEMPORARY design-preview stage — one cue-design option rendered over a
	// preview-local copy of the session chart stack. Delete with this folder.
	//
	// The stack geometry (row height, translate, active-row derivation)
	// mirrors UpcomingKeysDisplay exactly; only the overlay DOM differs per
	// variant. Option C's overlay assumes four equal one-bar columns — true
	// for the synthetic long ii-V-I harmony, an approximation production
	// would resolve by drawing inside ChordChart itself.
	import { onMount } from 'svelte';
	import ChordChart from '$lib/components/lick-practice/ChordChart.svelte';
	import { concertKeyToWritten } from '$lib/music/transposition';
	import { displayPitchClass } from '$lib/music/notation';
	import type { InstrumentConfig } from '$lib/types/instruments';
	import type { PitchClass } from '$lib/types/music';
	import type { CueVariant, StageFrame } from './scenarios';

	interface Props {
		variant: CueVariant;
		frame: StageFrame;
		instrument: InstrumentConfig;
	}

	let { variant, frame, instrument }: Props = $props();

	const ROW_HEIGHT = 105;
	const VISIBLE_ROWS = 3;

	const translateYpx = $derived((1 - Math.max(0, frame.scrollFraction)) * ROW_HEIGHT);
	const isRunning = $derived(frame.currentBeat >= 0);

	let reducedMotion = $state(false);
	onMount(() => {
		const mq = matchMedia('(prefers-reduced-motion: reduce)');
		reducedMotion = mq.matches;
		const onChange = (e: MediaQueryListEvent) => (reducedMotion = e.matches);
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	});

	// Cursor position across the active row: continuous glide normally,
	// quantized to whole beats under reduced motion.
	const glideLeft = $derived(
		frame.currentBeat < 0
			? -1
			: reducedMotion
				? Math.floor(frame.currentBeat) / 16
				: frame.rowFraction
	);

	function keyLabel(key: PitchClass): string {
		const written = concertKeyToWritten(key, instrument);
		return displayPitchClass(written, written);
	}

	const arm = $derived(frame.cue.countdown > 0 ? (5 - frame.cue.countdown) / 5 : 0);
	const straightIn = $derived(frame.nextEntry !== null && !frame.nextEntry.demo);

	// ——— Option A: row tab state ———
	interface TabView {
		kind: 'listen' | 'listen-in' | 'play-in' | 'play' | 'rest';
		text: string;
		count?: number;
	}
	const tab: TabView = $derived.by(() => {
		const { cue } = frame;
		const headKey = keyLabel(frame.rows[0].key);
		if (cue.countdown > 0 && cue.next === 'play') {
			return {
				kind: 'play-in',
				count: cue.countdown,
				text: straightIn ? `Straight in — ${headKey}` : `Play ${headKey} in`
			};
		}
		if (cue.countdown > 0 && cue.next === 'listen') {
			return { kind: 'listen-in', count: cue.countdown, text: 'Listen in' };
		}
		if (cue.phase === 'play') return { kind: 'play', text: 'Play' };
		if (frame.isDemoing || cue.phase === 'listen') return { kind: 'listen', text: 'Listen' };
		return { kind: 'rest', text: 'Rest' };
	});

	// ——— Option B: surface wash opacities ———
	const listenWash = $derived.by(() => {
		if (frame.isDemoing) return frame.isArming ? 1 - arm * 0.65 : 1;
		if (frame.cue.countdown > 0 && frame.cue.next === 'listen') return arm * 0.8;
		return 0;
	});
	const playWash = $derived.by(() => {
		if (frame.isRecording) return 1;
		if (frame.isArming) return arm * 0.7;
		return 0;
	});
</script>

{#snippet speakerGlyph(cls: string)}
	<svg class={cls} viewBox="0 0 16 16" aria-hidden="true">
		<path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="currentColor" />
		<path
			d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6 6 0 0 1 0 9"
			fill="none"
			stroke="currentColor"
			stroke-width="1.3"
			stroke-linecap="round"
		/>
	</svg>
{/snippet}

{#snippet micGlyph(cls: string)}
	<svg class={cls} viewBox="0 0 16 16" aria-hidden="true">
		<rect x="6" y="1.5" width="4" height="7.5" rx="2" fill="currentColor" />
		<path
			d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5"
			fill="none"
			stroke="currentColor"
			stroke-width="1.3"
			stroke-linecap="round"
		/>
	</svg>
{/snippet}

{#snippet noteGlyph(cls: string)}
	<svg class={cls} viewBox="0 0 16 16" aria-hidden="true">
		<ellipse cx="5.6" cy="12" rx="2.3" ry="1.7" fill="currentColor" transform="rotate(-18 5.6 12)" />
		<path d="M7.7 12V3.1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
		<path
			d="M7.7 3.1c2.2.9 3.4 2.3 3.2 4.4"
			fill="none"
			stroke="currentColor"
			stroke-width="1.2"
			stroke-linecap="round"
		/>
	</svg>
{/snippet}

<div class="viewport" style="height: {ROW_HEIGHT * VISIBLE_ROWS}px;">
	<div class="stack" style="transform: translateY({translateYpx}px);">
		{#each frame.rows as r, i (r.key + ':' + i)}
			{@const isActive = i === frame.activeRowIndex}
			<div class="row" class:current={isActive} style="height: {ROW_HEIGHT}px;">
				<div
					class="chart-wrap"
					class:straight-arming={variant === 'surface' &&
						isActive &&
						straightIn &&
						frame.cue.phase === 'transition'}
				>
					{#if variant === 'surface' && isActive}
						<div class="wash wash-listen" style="opacity: {listenWash};">
							{@render speakerGlyph('watermark')}
						</div>
						<div class="wash wash-play" style="opacity: {playWash};">
							{@render micGlyph('watermark')}
						</div>
					{/if}

					<div class="chart-body">
						<ChordChart
							harmony={r.harmony}
							currentBeat={isActive ? Math.max(0, frame.currentBeat) : 0}
							timeSignature={[4, 4]}
							isPlaying={isActive && isRunning}
							key={r.key}
							{instrument}
						/>
					</div>

					{#if variant === 'surface' && isActive}
						{#if glideLeft >= 0}
							<div
								class="cursor-line"
								class:live={frame.isRecording}
								style="left: {glideLeft * 100}%;"
							></div>
						{/if}
						{#if straightIn && frame.cue.phase === 'transition'}
							<span class="surface-caption smallcaps">Straight in</span>
						{/if}
					{/if}

					{#if variant === 'cursor' && isActive}
						<div class="c-overlay">
							{#if glideLeft >= 0}
								<div class="c-glide" style="left: {glideLeft * 100}%;">
									<span class="c-line" class:live={frame.isRecording}></span>
									<span class="c-face c-note" style="opacity: {frame.isDemoing ? 1 : 0};">
										{@render noteGlyph('c-glyph')}
									</span>
									<span class="c-face c-mic" style="opacity: {frame.isRecording ? 1 : 0};">
										{@render micGlyph('c-glyph')}
										<span class="c-lamp"></span>
									</span>
								</div>
							{/if}
							{#if frame.cue.countdown > 0 && (frame.cue.next === 'play' || frame.cue.next === 'listen')}
								<div class="c-count" data-into={frame.cue.next}>
									{#if frame.cue.next === 'play'}
										{@render micGlyph('c-count-glyph')}
									{:else}
										{@render noteGlyph('c-count-glyph')}
									{/if}
									{#each [4, 3, 2, 1] as n (n)}
										<span
											class="c-num"
											class:now={n === frame.cue.countdown}
											class:spent={n > frame.cue.countdown}>{n}</span
										>
									{/each}
								</div>
							{/if}
						</div>
					{/if}

					{#if variant === 'row-tab' && isActive}
						<div class="tab" data-kind={tab.kind} style="--arm: {arm};">
							<span class="tab-lamp" class:lit={tab.kind === 'play'} aria-hidden="true"></span>
							{#if tab.kind === 'play' || tab.kind === 'play-in'}
								{@render micGlyph('tab-glyph')}
							{:else if tab.kind === 'listen' || tab.kind === 'listen-in'}
								{@render speakerGlyph('tab-glyph')}
							{/if}
							<span class="smallcaps">{tab.text}</span>
							{#if tab.count}
								{#key tab.count}
									<span class="tab-count">{tab.count}</span>
								{/key}
							{/if}
						</div>
					{/if}
				</div>
			</div>
		{/each}
	</div>
</div>

<style>
	.viewport {
		position: relative;
		overflow: hidden;
		border-radius: 0.5rem;
	}
	.stack {
		display: flex;
		flex-direction: column;
		will-change: transform;
	}
	.row {
		position: relative;
		padding: 0.25rem 0.5rem 0.5rem;
		opacity: 0.35;
		transition: opacity 250ms ease;
	}
	.row.current {
		opacity: 1;
	}
	.chart-wrap {
		position: relative;
		border-radius: 0.5rem;
	}
	.chart-body {
		position: relative;
		z-index: 1;
	}

	/* ——— Option B: stage lighting ——— */
	.wash {
		position: absolute;
		inset: 0;
		z-index: 0;
		border-radius: 0.5rem;
		pointer-events: none;
		transition: opacity 450ms ease;
	}
	.wash-listen {
		background: linear-gradient(
			90deg,
			color-mix(in srgb, var(--color-brass) 14%, transparent),
			color-mix(in srgb, var(--color-brass) 5%, transparent)
		);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-brass) 35%, transparent);
		color: var(--color-brass);
	}
	.wash-play {
		background: color-mix(in srgb, var(--color-onair) 11%, transparent);
		box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--color-onair) 60%, transparent);
		color: var(--color-onair);
	}
	.wash :global(.watermark) {
		position: absolute;
		right: 0.75rem;
		top: 50%;
		transform: translateY(-50%);
		width: 52px;
		height: 52px;
		opacity: 0.14;
	}
	.cursor-line {
		position: absolute;
		top: 1.5rem;
		bottom: 0.35rem;
		z-index: 2;
		width: 2px;
		margin-left: -1px;
		border-radius: 1px;
		background: var(--color-brass);
		pointer-events: none;
	}
	.cursor-line.live {
		background: var(--color-onair);
	}
	.surface-caption {
		position: absolute;
		top: 0.3rem;
		right: 0.6rem;
		z-index: 2;
		color: color-mix(in srgb, var(--color-onair) 70%, var(--color-text));
	}
	/* Shape redundancy for the straight-in bar: same dashed on-air outline the
	   shipped arming ring uses, so the state reads without relying on colour. */
	.chart-wrap.straight-arming {
		outline: 2px dashed color-mix(in srgb, var(--color-onair) 55%, transparent);
	}

	/* ——— Option C: cursor handoff ——— */
	.c-overlay {
		position: absolute;
		inset: 0;
		z-index: 2;
		pointer-events: none;
	}
	.c-glide {
		position: absolute;
		top: 0.35rem;
		bottom: 0.3rem;
		width: 0;
	}
	.c-line {
		position: absolute;
		top: 1.35rem;
		bottom: 0;
		left: -0.75px;
		width: 1.5px;
		border-radius: 1px;
		background: color-mix(in srgb, var(--color-brass) 65%, transparent);
	}
	.c-line.live {
		background: color-mix(in srgb, var(--color-onair) 75%, transparent);
	}
	.c-face {
		position: absolute;
		top: 0;
		left: 0;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 0.2rem;
		transition: opacity 300ms ease;
	}
	.c-face :global(.c-glyph) {
		width: 1.15rem;
		height: 1.15rem;
	}
	.c-note {
		color: var(--color-brass);
	}
	.c-mic {
		color: var(--color-onair);
	}
	.c-lamp {
		width: 5px;
		height: 5px;
		border-radius: 999px;
		background: var(--color-onair);
		box-shadow: 0 0 5px color-mix(in srgb, var(--color-onair) 80%, transparent);
	}
	/* The count lands where the entrance lands: over bar 1 of the row about to
	   be played, at the beat-dot line. */
	.c-count {
		position: absolute;
		left: 0;
		bottom: 0.1rem;
		width: 25%;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
	}
	.c-count[data-into='play'] {
		color: color-mix(in srgb, var(--color-onair) 75%, var(--color-text));
	}
	.c-count[data-into='listen'] {
		color: color-mix(in srgb, var(--color-brass) 75%, var(--color-text));
	}
	.c-count :global(.c-count-glyph) {
		width: 0.85rem;
		height: 0.85rem;
	}
	.c-num {
		font-size: 0.85rem;
		font-weight: 600;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		opacity: 0.55;
		transition:
			opacity 150ms ease,
			transform 150ms ease;
	}
	.c-num.now {
		font-size: 1.05rem;
		font-weight: 800;
		opacity: 1;
		transform: scale(1.15);
		animation: count-pop 220ms ease-out;
	}
	.c-num.spent {
		opacity: 0.25;
	}
	@keyframes count-pop {
		from {
			transform: scale(1.5);
		}
		to {
			transform: scale(1.15);
		}
	}

	/* ——— Option A: row tab ——— */
	.tab {
		position: absolute;
		top: 0;
		left: 0;
		z-index: 3;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.18rem 0.55rem;
		border-radius: 0.45rem;
		border: 1px solid transparent;
		background: var(--color-bg);
		color: var(--color-text-secondary);
		transition:
			color 200ms ease,
			background-color 200ms ease,
			border-color 200ms ease;
	}
	.tab::before {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		pointer-events: none;
		opacity: 0;
		transition: opacity 200ms linear;
	}
	.tab > * {
		position: relative;
	}
	.tab[data-kind='listen'],
	.tab[data-kind='listen-in'] {
		color: color-mix(in srgb, var(--color-brass) 70%, var(--color-text));
		background: color-mix(in srgb, var(--color-brass) 16%, var(--color-bg));
		border-color: color-mix(in srgb, var(--color-brass) 40%, transparent);
	}
	.tab[data-kind='play-in'] {
		color: color-mix(in srgb, var(--color-onair) 70%, var(--color-text));
		background: color-mix(in srgb, var(--color-onair) 10%, var(--color-bg));
		border-color: color-mix(in srgb, var(--color-onair) 40%, transparent);
	}
	.tab[data-kind='play-in']::before {
		background: color-mix(in srgb, var(--color-onair) 22%, transparent);
		opacity: var(--arm);
	}
	.tab[data-kind='play'] {
		color: color-mix(in srgb, var(--color-onair) 70%, var(--color-text));
		background: color-mix(in srgb, var(--color-onair) 18%, var(--color-bg));
		border-color: color-mix(in srgb, var(--color-onair) 50%, transparent);
	}
	.tab-lamp {
		flex: none;
		width: 7px;
		height: 7px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-onair) 18%, var(--color-bg));
		box-shadow: inset 0 0 1px rgba(0, 0, 0, 0.6);
		transition:
			background-color 150ms ease,
			box-shadow 150ms ease;
	}
	.tab-lamp.lit {
		background: var(--color-onair);
		box-shadow:
			0 0 6px color-mix(in srgb, var(--color-onair) 80%, transparent),
			inset 0 0 1px rgba(255, 255, 255, 0.4);
	}
	.tab :global(.tab-glyph) {
		flex: none;
		width: 0.85rem;
		height: 0.85rem;
	}
	.tab-count {
		display: inline-block;
		min-width: 0.9rem;
		text-align: center;
		font-size: 1.05rem;
		font-weight: 800;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		animation: tab-tick 220ms ease-out;
	}
	@keyframes tab-tick {
		from {
			opacity: 0.4;
			transform: scale(1.35);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.row,
		.wash,
		.c-face,
		.c-num,
		.tab,
		.tab::before,
		.tab-lamp {
			transition: none;
		}
		.tab-count,
		.c-num.now {
			animation: none;
		}
	}
</style>

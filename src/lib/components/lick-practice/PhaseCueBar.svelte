<script lang="ts">
	import type { PhaseCue, PracticePhase } from '$lib/state/lick-practice-phase';

	interface Props {
		cue: PhaseCue;
	}

	let { cue }: Props = $props();

	const LABELS: Record<PracticePhase, string> = {
		'count-in': 'Count in',
		listen: 'Listen',
		read: 'Read',
		play: 'Play',
		transition: 'Rest',
		idle: ''
	};

	const label = $derived(LABELS[cue.phase]);
	// Only warn about a phase the user has to DO something about. Counting
	// into a rest would be noise; counting into listen/play is the point.
	const leadPhase = $derived(
		cue.countdown > 0 && (cue.next === 'play' || cue.next === 'listen') ? cue.next : null
	);
	// The bar tints toward its incoming phase over the lead-in bar, so the
	// switch is felt before it is read.
	const armStrength = $derived(leadPhase ? (5 - cue.countdown) / 5 : 0);
</script>

<div class="cue" data-phase={cue.phase} data-lead={leadPhase} style="--arm: {armStrength};">
	<span class="lamp" class:lit={cue.phase === 'play'} aria-hidden="true"></span>

	<!-- Icon is the colour-independent half of the signal: a speaker while the
	     app plays, a staff while you read the sheet that has just come up, a
	     microphone while you play. -->
	{#if cue.phase === 'read'}
		<svg class="glyph" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M2 4.5h12M2 8h12M2 11.5h12" fill="none" stroke="currentColor" stroke-width="1.1" />
			<ellipse cx="10.2" cy="9.8" rx="2" ry="1.5" fill="currentColor" />
			<path d="M12.1 9.6V3.2" fill="none" stroke="currentColor" stroke-width="1.2" />
		</svg>
	{:else if cue.phase === 'listen' || cue.phase === 'count-in'}
		<svg class="glyph" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="currentColor" />
			<path
				d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6 6 0 0 1 0 9"
				fill="none"
				stroke="currentColor"
				stroke-width="1.3"
				stroke-linecap="round"
			/>
		</svg>
	{:else if cue.phase === 'play'}
		<svg class="glyph" viewBox="0 0 16 16" aria-hidden="true">
			<rect x="6" y="1.5" width="4" height="7.5" rx="2" fill="currentColor" />
			<path
				d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5"
				fill="none"
				stroke="currentColor"
				stroke-width="1.3"
				stroke-linecap="round"
			/>
		</svg>
	{/if}

	<!-- Announced on phase change only; the per-beat countdown beside it is
	     hidden from screen readers so it can't chatter every beat. -->
	<span class="label smallcaps" role="status" aria-live="polite">{label}</span>

	<span class="lead" aria-hidden="true">
		{#if leadPhase}
			<span class="lead-word smallcaps">{LABELS[leadPhase]} in</span>
			{#key cue.countdown}
				<span class="lead-count">{cue.countdown}</span>
			{/key}
		{/if}
	</span>
</div>

<style>
	.cue {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 2rem;
		padding: 0 0.65rem;
		border-radius: 0.5rem;
		border: 1px solid transparent;
		color: var(--color-text-secondary);
		background: color-mix(in srgb, var(--color-bg-secondary) 60%, transparent);
		transition:
			color 200ms ease,
			background-color 200ms ease,
			border-color 200ms ease;
	}
	/* Lead-in wash. An overlay whose OPACITY tracks the countdown, rather than
	   a calc() inside color-mix's percentage — same effect, no dependency on
	   calc() being accepted there. */
	.cue::before {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		pointer-events: none;
		opacity: 0;
		transition: opacity 200ms linear;
	}
	.cue > * {
		position: relative;
	}
	/* "Your turn" reads in the play-phase colour (brass), "Listen" and the
	   count-in in the listen-phase colour (on-air red — red reads as "stop",
	   i.e. don't play yet); the rest stays quiet chrome. The TEXT is pulled
	   toward --color-text so it clears 4.5:1 on its own tinted background in
	   both themes — the pure tokens are tuned for fills, not small type. */
	.cue[data-phase='play'] {
		color: color-mix(in srgb, var(--color-phase-play) 70%, var(--color-text));
		background: color-mix(in srgb, var(--color-phase-play) 12%, transparent);
		border-color: color-mix(in srgb, var(--color-phase-play) 35%, transparent);
	}
	.cue[data-phase='listen'],
	.cue[data-phase='read'],
	.cue[data-phase='count-in'] {
		color: color-mix(in srgb, var(--color-phase-listen) 70%, var(--color-text));
		background: color-mix(in srgb, var(--color-phase-listen) 12%, transparent);
		border-color: color-mix(in srgb, var(--color-phase-listen) 35%, transparent);
	}
	/* Lead-in: the wash deepens over the four beats before the switch, so the
	   change is felt a bar early rather than read a beat late. */
	.cue[data-lead='play']::before {
		background: color-mix(in srgb, var(--color-phase-play) 22%, transparent);
		opacity: var(--arm);
	}
	.cue[data-lead='play'] {
		border-color: color-mix(in srgb, var(--color-phase-play) 30%, transparent);
	}
	.cue[data-lead='listen']::before {
		background: color-mix(in srgb, var(--color-phase-listen) 22%, transparent);
		opacity: var(--arm);
	}

	.lamp {
		flex: none;
		width: 7px;
		height: 7px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-phase-play) 18%, var(--color-bg));
		box-shadow: inset 0 0 1px rgba(0, 0, 0, 0.6);
		transition:
			background-color 150ms ease,
			box-shadow 150ms ease;
	}
	.lamp.lit {
		background: var(--color-phase-play);
		box-shadow:
			0 0 6px color-mix(in srgb, var(--color-phase-play) 80%, transparent),
			inset 0 0 1px rgba(255, 255, 255, 0.4);
	}

	.glyph {
		flex: none;
		width: 0.85rem;
		height: 0.85rem;
	}

	.label {
		flex: 1;
		min-width: 0;
	}

	.lead {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		/* Reserved so the bar never changes height when the count appears. */
		min-height: 1.25rem;
	}
	.lead-word {
		color: var(--color-text-secondary);
	}
	.cue[data-lead='play'] .lead-word,
	.cue[data-lead='play'] .lead-count {
		color: color-mix(in srgb, var(--color-phase-play) 70%, var(--color-text));
	}
	.lead-count {
		display: inline-block;
		min-width: 0.9rem;
		text-align: center;
		font-size: 1.05rem;
		font-weight: 800;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		animation: lead-tick 220ms ease-out;
	}
	@keyframes lead-tick {
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
		.cue,
		.cue::before,
		.lamp {
			transition: none;
		}
		.lead-count {
			animation: none;
		}
	}
</style>

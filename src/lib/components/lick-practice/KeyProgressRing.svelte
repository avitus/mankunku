<script lang="ts">
	import type { PitchClass } from '$lib/types/music';
	import type { LickPracticeKeyResult } from '$lib/types/lick-practice';
	import { concertKeyToWritten } from '$lib/music/transposition';
	import { getInstrument } from '$lib/state/settings.svelte';
	import { accuracyTier } from '$lib/ui/score-colors';
	import { KEY_PROFICIENT_THRESHOLD } from '$lib/persistence/lick-practice-store';

	interface Props {
		keys: PitchClass[];
		currentKeyIndex: number;
		keyResults: LickPracticeKeyResult[];
		tempo: number;
	}

	let { keys, currentKeyIndex, keyResults, tempo }: Props = $props();

	const instrument = $derived(getInstrument());

	const RING_RADIUS = 80;
	const DOT_RADIUS = 18;
	const CENTER = 110;

	// A scored dot carries its accuracy tier; 'current' / 'pending' are the two
	// score-less states.
	type Visual =
		| { kind: 'scored'; color: string }
		| { kind: 'current' }
		| { kind: 'pending' };

	function getKeyPosition(index: number): { x: number; y: number } {
		// Distribute dots evenly around the ring based on the actual key
		// count rather than the usual 12, so this works if the plan ever
		// uses fewer/more keys (partial cycles, custom progressions).
		const count = keys.length || 1;
		const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
		return {
			x: CENTER + RING_RADIUS * Math.cos(angle),
			y: CENTER + RING_RADIUS * Math.sin(angle)
		};
	}

	// When every key has scored proficient, the ring glows brass as a reward —
	// a small Blue Note-style flourish at completion.
	const allProficient = $derived(
		keys.length > 0 &&
			keys.every((k) => {
				const r = keyResults.find((r) => r.key === k);
				return r != null && r.score >= KEY_PROFICIENT_THRESHOLD;
			})
	);

	function getKeyVisual(key: PitchClass): Visual {
		// A scored key shows its accuracy tier even when it's still the current
		// index — after the final key, currentKeyIndex parks on it through the
		// inter-lick score-hold bar, and the point of that bar is seeing the
		// last dot's colour. Scores use the discrete accuracy medal scale so a
		// key that needs work reads as such at a glance (not a cool mastery
		// tint). Each dot always keeps its own tier colour; the all-proficient
		// completion reward is a brass halo (see the template), so per-key
		// accuracy stays visible even when the whole ring is celebrated.
		const result = keyResults.find(r => r.key === key);
		if (result) {
			return { kind: 'scored', color: accuracyTier(result.score) };
		}
		if (keys.indexOf(key) === currentKeyIndex) return { kind: 'current' };
		return { kind: 'pending' };
	}

	// Report-style chip fill: a dark tint of the tier color (matches the
	// end-of-session per-key chips), so the ring and the report read alike.
	function dotFill(color: string): string {
		return `color-mix(in srgb, ${color} 20%, var(--color-bg))`;
	}
</script>

<div class="flex flex-col items-center">
	<svg viewBox="0 0 220 220" class="w-56 h-56">
		<!-- Center tempo display -->
		<text
			x={CENTER}
			y={CENTER - 8}
			text-anchor="middle"
			dominant-baseline="middle"
			class="fill-[var(--color-text)]"
			font-size="28"
			font-weight="bold"
		>
			{tempo}
		</text>
		<text
			x={CENTER}
			y={CENTER + 14}
			text-anchor="middle"
			dominant-baseline="middle"
			class="fill-[var(--color-text-secondary)]"
			font-size="12"
		>
			BPM
		</text>

		<!-- Key dots arranged in a circle. Scored keys use the report-style
		     treatment: a dark tinted circle with the key label in the tier
		     color. The current key is a hollow, pulsing brass outline (no fill)
		     so it reads as "here, not yet scored"; pending keys are dim slate. -->
		{#each keys as key, i (key)}
			{@const pos = getKeyPosition(i)}
			{@const visual = getKeyVisual(key)}
			{@const displayKey = concertKeyToWritten(key, instrument)}

			<g>
				{#if visual.kind === 'current'}
					<circle
						cx={pos.x} cy={pos.y} r={DOT_RADIUS + 3}
						fill="none"
						stroke="var(--color-brass-soft)"
						stroke-width="2"
						opacity="0.55"
						class="animate-pulse"
					/>
					<circle
						cx={pos.x} cy={pos.y} r={DOT_RADIUS}
						fill="none"
						stroke="var(--color-brass-soft)"
						stroke-width="2.5"
					/>
					<text
						x={pos.x} y={pos.y}
						text-anchor="middle"
						dominant-baseline="central"
						font-size="11"
						font-weight="bold"
						fill="var(--color-text)"
					>
						{displayKey}
					</text>
				{:else if visual.kind === 'pending'}
					<circle cx={pos.x} cy={pos.y} r={DOT_RADIUS} fill="var(--color-bg-tertiary)" opacity="0.3" />
					<text
						x={pos.x} y={pos.y}
						text-anchor="middle"
						dominant-baseline="central"
						font-size="11"
						fill="var(--color-text-secondary)"
					>
						{displayKey}
					</text>
				{:else}
					{#if allProficient}
						<!-- Completion reward: a brass halo around every dot, kept
						     separate from the fill so each key still shows its tier. -->
						<circle
							cx={pos.x} cy={pos.y} r={DOT_RADIUS + 3}
							fill="none"
							stroke="var(--color-brass)"
							stroke-width="2"
							opacity="0.75"
						/>
					{/if}
					<circle cx={pos.x} cy={pos.y} r={DOT_RADIUS} style="fill: {dotFill(visual.color)}" />
					<text
						x={pos.x} y={pos.y}
						text-anchor="middle"
						dominant-baseline="central"
						font-size="11"
						font-weight="bold"
						fill={visual.color}
					>
						{displayKey}
					</text>
				{/if}
			</g>
		{/each}
	</svg>
</div>

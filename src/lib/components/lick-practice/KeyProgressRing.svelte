<script lang="ts">
	import type { PitchClass } from '$lib/types/music';
	import type { LickPracticeKeyResult } from '$lib/types/lick-practice';
	import { concertKeyToWritten } from '$lib/music/transposition';
	import { getInstrument } from '$lib/state/settings.svelte';
	import {
		KEY_PROFICIENT_THRESHOLD,
		KEY_FLOOR_THRESHOLD
	} from '$lib/persistence/lick-practice-store';

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

	type Status = 'current' | 'proficient' | 'developing' | 'struggling' | 'pending';

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

	function getKeyStatus(key: PitchClass): Status {
		// A scored key shows its score tier even when it's still the
		// current index — after the final key, currentKeyIndex parks on it
		// through the inter-lick score-hold bar, and the whole point of
		// that bar is seeing the last dot's colour.
		const result = keyResults.find(r => r.key === key);
		if (result) {
			if (result.score >= KEY_PROFICIENT_THRESHOLD) return 'proficient';
			if (result.score >= KEY_FLOOR_THRESHOLD) return 'developing';
			return 'struggling';
		}
		const idx = keys.indexOf(key);
		if (idx === currentKeyIndex) return 'current';
		return 'pending';
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

	// Proficiency reads as accomplishment via the teal→brass mastery ramp
	// (matching the ear-training Scale Proficiency bars) — not a green/amber/red
	// danger scale. The all-proficient ring still glows brass as a reward.
	const STATUS_COLORS = $derived({
		current: 'var(--color-accent)',
		proficient: allProficient ? 'var(--color-brass)' : 'var(--mastery-9)',
		developing: 'var(--mastery-5)',
		struggling: 'var(--mastery-3)',
		pending: 'var(--color-bg-tertiary)'
	});
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

		<!-- Key dots arranged in a circle -->
		{#each keys as key, i (key)}
			{@const pos = getKeyPosition(i)}
			{@const status = getKeyStatus(key)}
			{@const isCurrent = status === 'current'}
			{@const displayKey = concertKeyToWritten(key, instrument)}

			<g>
				{#if isCurrent}
					<circle
						cx={pos.x} cy={pos.y} r={DOT_RADIUS + 3}
						fill="none"
						stroke={STATUS_COLORS.current}
						stroke-width="2"
						opacity="0.4"
						class="animate-pulse"
					/>
				{/if}
				<circle
					cx={pos.x} cy={pos.y} r={DOT_RADIUS}
					fill={STATUS_COLORS[status]}
					opacity={status === 'pending' ? 0.3 : 1}
				/>
				{#if status === 'proficient'}
					<text
						x={pos.x} y={pos.y + 1}
						text-anchor="middle"
						dominant-baseline="central"
						font-size="14"
						font-weight="bold"
						fill="white"
					>
						&#10003;
					</text>
				{:else}
					<text
						x={pos.x} y={pos.y}
						text-anchor="middle"
						dominant-baseline="central"
						font-size="11"
						font-weight={isCurrent ? 'bold' : 'normal'}
						fill={status === 'pending' ? 'var(--color-text-secondary)' : 'white'}
					>
						{displayKey}
					</text>
				{/if}
			</g>
		{/each}
	</svg>
</div>

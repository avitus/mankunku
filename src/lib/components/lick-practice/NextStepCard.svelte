<script lang="ts">
	import type { NextStep, NextStepAction } from '$lib/state/lick-practice-next-steps';

	// The session report's single suggestion. Presentational only — the policy
	// lives in `buildNextStep`, and the tee-up (which resets the page's timing
	// state before starting) belongs to the session route. Deliberately quiet:
	// one line of advice, one number, and at most one button. Steps whose right
	// answer is to stop carry no action and render without one.
	let { step, onstart }: { step: NextStep; onstart: (action: NextStepAction) => void } = $props();
</script>

<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4">
	<div class="smallcaps text-[var(--color-brass)]">Next</div>
	<div class="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
		<div class="min-w-[14rem] flex-1 space-y-1">
			<div class="font-medium">{step.headline}</div>
			<div class="text-xs text-[var(--color-text-secondary)]">{step.reason}</div>
		</div>
		{#if step.action}
			{@const action = step.action}
			<button
				onclick={() => onstart(action)}
				class="shrink-0 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-bold text-white transition-opacity hover:opacity-90"
			>
				{action.label}
			</button>
		{/if}
	</div>
</div>

<script lang="ts">
	import { suggestions, markPickedFromSuggestion } from '$lib/state/lick-suggestions.svelte';
	import { stepEntry } from '$lib/state/step-entry.svelte';

	function pick(label: string) {
		stepEntry.phraseName = label;
		markPickedFromSuggestion(label);
	}
</script>

{#if suggestions.matches.length > 0}
	<div class="rounded-lg border border-[var(--color-bg-tertiary)] bg-[var(--color-bg-secondary)] p-3">
		<div class="smallcaps mb-2 text-[11px] text-[var(--color-text-secondary)]">
			Name suggestions
		</div>
		<ul class="space-y-1">
			{#each suggestions.matches as match (match.sourceId)}
				<li>
					<button
						type="button"
						onclick={() => pick(match.label)}
						class="group flex w-full items-start justify-between gap-3 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-[var(--color-bg-tertiary)]"
					>
						<span class="min-w-0 flex-1">
							<span class="block truncate">
								{#if match.confidence === 'reminiscent'}
									<span class="italic text-[var(--color-text-secondary)]">reminiscent of</span>
								{/if}
								{match.label}
							</span>
							<span class="mt-0.5 block truncate text-xs text-[var(--color-text-secondary)]">
								{match.attribution}
							</span>
						</span>
						<span class="shrink-0 font-mono text-[11px] tabular-nums text-[var(--color-text-secondary)]">
							{(match.score * 100).toFixed(0)}%
						</span>
					</button>
				</li>
			{/each}
		</ul>
		<p class="mt-2 text-[11px] italic text-[var(--color-text-secondary)]">
			Suggestions are not verified attributions. Click to use, or type your own name.
		</p>
	</div>
{/if}

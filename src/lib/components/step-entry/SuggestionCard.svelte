<script lang="ts">
	import { suggestions, markPickedFromSuggestion } from '$lib/state/lick-suggestions.svelte';
	import { availableLickName } from '$lib/matching/lick-name';
	import { getUserLicksLocal } from '$lib/persistence/user-licks';

	let { onpick, editingId = null, disabled = false }: {
		onpick: (name: string) => void;
		editingId?: string | null;
		disabled?: boolean;
	} = $props();

	/** Apply an optional song title, numbering collisions in the local book. */
	function pick(base: string): void {
		const name = availableLickName(base, getUserLicksLocal()
			.filter((lick) => lick.id !== editingId).map((lick) => lick.name));
		onpick(name);
		markPickedFromSuggestion(name);
	}
</script>

{#if suggestions.matches.length > 0}
	<div class="rounded-lg border border-[var(--color-bg-tertiary)] bg-[var(--color-bg-secondary)] p-3">
		<div class="smallcaps mb-2 text-[11px] text-[var(--color-text-secondary)]">
			Optional name suggestions
		</div>
		<ul class="space-y-1">
			{#each suggestions.matches as match (match.sourceId)}
				<li>
					<button
						type="button"
						onclick={() => pick(match.suggestedName!)}
						{disabled}
						class="group flex w-full items-start justify-between gap-3 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-[var(--color-bg-tertiary)]"
					>
						<span class="min-w-0 flex-1">
							<span class="block break-words">
								{#if match.confidence === 'reminiscent'}
									<span class="italic text-[var(--color-text-secondary)]">Similar to</span>
								{/if}
								{match.suggestedName}
							</span>
							<span class="mt-0.5 block break-words text-xs text-[var(--color-text-secondary)]">
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
			Suggestions are not verified attributions. Choose one or enter your own name.
		</p>
	</div>
{/if}

<p class="mt-2 text-xs text-[var(--color-text-secondary)]" role="status">
	{#if suggestions.loading}Looking for song matches.
	{:else if suggestions.unavailable}Song suggestions are unavailable. Enter your own name.
	{:else if suggestions.matches.length === 0}No song match found. Enter your own name.{/if}
</p>

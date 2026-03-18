<script lang="ts">
	import { INSTRUMENTS } from '$lib/types/instruments.ts';

	const instruments = Object.entries(INSTRUMENTS);
</script>

<div class="space-y-6">
	<h1 class="text-2xl font-bold">Settings</h1>

	<section class="space-y-3">
		<h2 class="text-lg font-semibold">Instrument</h2>
		<div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
			{#each instruments as [id, config]}
				<div class="rounded bg-[var(--color-bg-secondary)] px-4 py-3">
					<p class="font-medium">{config.name}</p>
					<p class="text-xs text-[var(--color-text-secondary)]">
						{config.key} transposition
					</p>
				</div>
			{/each}
		</div>
	</section>

	<section class="space-y-3">
		<h2 class="text-lg font-semibold">Audio</h2>
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-8 text-center">
			<p class="text-[var(--color-text-secondary)]">
				Mic and audio settings — coming in Phase 3
			</p>
		</div>
	</section>
</div>

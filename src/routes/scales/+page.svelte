<script lang="ts">
	import { SCALE_CATALOG, getMvpScales } from '$lib/music/scales';

	const mvpScales = getMvpScales();
	const families = [...new Set(mvpScales.map((s) => s.family))];
</script>

<div class="space-y-6">
	<h1 class="text-2xl font-bold">Scale Reference</h1>
	<p class="text-[var(--color-text-secondary)]">
		{mvpScales.length} scales available ({SCALE_CATALOG.length} total in catalog)
	</p>

	{#each families as family}
		<section class="space-y-3">
			<h2 class="text-lg font-semibold capitalize">{family.replace('-', ' ')}</h2>
			<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
				{#each mvpScales.filter((s) => s.family === family) as scale}
					<div class="rounded bg-[var(--color-bg-secondary)] px-4 py-3">
						<p class="font-medium">{scale.name}</p>
						<p class="text-xs text-[var(--color-text-secondary)]">
							{scale.degrees.join(' ')}
						</p>
					</div>
				{/each}
			</div>
		</section>
	{/each}
</div>

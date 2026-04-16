<script lang="ts">
	import { SCALE_CATALOG, getMvpScales } from '$lib/music/scales';

	const mvpScales = getMvpScales();
	const families = [...new Set(mvpScales.map((s) => s.family))];
</script>

<div class="space-y-6">
	<div>
		<div class="smallcaps text-[var(--color-brass)]">The Changes</div>
		<h1 class="font-display text-4xl font-bold tracking-tight text-[var(--color-accent)]">
			Scale Reference
		</h1>
		<div class="jazz-rule mt-2 max-w-[140px]"></div>
	</div>
	<p class="italic text-[var(--color-text-secondary)]">
		{mvpScales.length} scales available ({SCALE_CATALOG.length} total in catalog)
	</p>

	{#each families as family}
		<section class="space-y-3">
			<div>
				<h2 class="smallcaps text-[var(--color-brass)]">{family.replace('-', ' ')}</h2>
				<div class="jazz-rule mt-1 max-w-[100px]"></div>
			</div>
			<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
				{#each mvpScales.filter((s) => s.family === family) as scale}
					<div
						class="rounded border border-[var(--color-accent)]/20 bg-[var(--color-bg-secondary)] px-4 py-3"
					>
						<p class="font-display text-lg font-medium text-[var(--color-accent)]">
							{scale.name}
						</p>
						<p class="text-xs tabular-nums text-[var(--color-text-secondary)]">
							{scale.degrees.join(' ')}
						</p>
					</div>
				{/each}
			</div>
		</section>
	{/each}
</div>

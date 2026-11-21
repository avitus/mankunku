<script lang="ts">
	import type { Tune } from '$lib/types/tune';
	import { tunePath } from '$lib/tunes/tune-slug';

	interface Props {
		compact?: boolean;
		recent?: boolean;
		sheet: Tune;
		authorName?: string | null;
		badge?: string;
	}

	let { compact = false, recent = false, sheet, authorName = null, badge = '' }: Props = $props();
</script>

<a href={tunePath(sheet)} class="tune-card library-tune-card" class:compact class:recent aria-label="Open {sheet.title}">
	<h3>{sheet.title}</h3>
	<div class="attribution">
		{#if sheet.composer}<span>{sheet.composer}</span>{/if}
		{#if authorName}<span class="shared">Shared by {authorName}</span>{/if}
	</div>
	{#if badge}<span class="origin">{badge}</span>{/if}
	<span class="arrow" aria-hidden="true">›</span>
</a>

<style>
	.tune-card.library-tune-card {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto 12px;
		align-items: center;
		gap: 4px 12px;
		min-width: 0;
		padding: 16px;
		border: 1px solid var(--studio-border);
		border-radius: 6px;
		background: var(--studio-panel);
		color: var(--studio-text);
		text-decoration: none;
	}
	.tune-card h3 { min-width: 0; margin: 0; font: 500 20px/1.3 var(--font-display); overflow-wrap: anywhere; }
	.attribution { grid-column: 1; display: grid; gap: 2px; color: var(--studio-muted); font-size: 12px; }
	.shared { font-size: 12px; }
	.origin { grid-column: 2; grid-row: 1 / 3; color: var(--studio-muted); font-size: 11px; }
	.arrow { grid-column: 3; grid-row: 1 / 3; font-size: 22px; color: var(--studio-muted); }
	.tune-card.compact {
		grid-template-columns: minmax(0, 1fr) minmax(120px, 25%) 56px 12px;
		gap: 12px;
		min-height: 52px;
		padding: 10px 16px;
		border: 0;
		border-radius: 0;
		border-bottom: 1px solid color-mix(in srgb, var(--studio-border) 45%, transparent);
		background: transparent;
	}
	.compact h3 { font-family: inherit; font-size: 15px; }
	.compact .attribution { grid-column: 2; }
	.compact .origin { grid-column: 3; grid-row: 1; }
	.compact .arrow { grid-column: 4; grid-row: 1; }
	.compact:last-child { border-bottom: 0; }
	.tune-card.recent { min-height: 56px; }
	.recent h3 { font: 500 20px/1.3 var(--font-display); }
	.tune-card.library-tune-card:hover { background: var(--studio-panel-highlight); }
	.tune-card:focus-visible { outline: 2px solid var(--color-brass); outline-offset: -3px; }
	@media (max-width: 600px) {
		.tune-card.compact { grid-template-columns: minmax(0, 1fr) auto 12px; gap: 4px 12px; padding: 12px; }
		.compact .attribution { grid-column: 1; grid-row: 2; }
		.compact .origin { grid-column: 2; grid-row: 1 / 3; }
		.compact .arrow { grid-column: 3; grid-row: 1 / 3; }
	}
</style>

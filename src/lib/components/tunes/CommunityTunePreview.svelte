<script lang="ts">
	import type { CommunityTune } from '$lib/persistence/tune-community';
	import { PITCH_CLASSES, type PitchClass } from '$lib/types/music';
	import { getInstrument } from '$lib/state/settings.svelte';
	import { concertKeyToWritten } from '$lib/music/transposition';
	import { communityPreviewBars } from '$lib/tunes/community-preview';
	import ChordSymbolText from '$lib/components/music/ChordSymbolText.svelte';

	let {
		item,
		pending,
		busy,
		onfavorite,
		onadopt,
		onreturn
	}: {
		item: CommunityTune;
		pending: 'favorite' | 'adopt' | 'return' | null;
		busy: boolean;
		onfavorite: () => void;
		onadopt: () => void;
		onreturn: () => void;
	} = $props();
	let selectedKey: PitchClass | null = $state(null);
	const writtenKey = $derived(selectedKey ?? concertKeyToWritten(item.sheet.key, getInstrument()));
	const bars = $derived(communityPreviewBars(item.sheet, writtenKey));
	const totalBars = $derived(item.sheet.sections.reduce((sum, section) => sum + section.bars, 0));
	const hasMelody = $derived(
		item.sheet.sections.some((section) => section.notes.some((note) => note.pitch !== null))
	);
	/** Swaps the ASCII accidental in a key name for its real flat or sharp glyph. */
	const keyLabel = (key: string) => key.replace('b', '♭').replace('#', '♯');
</script>

<section class="ct-preview" aria-label="Selected tune preview">
	<div class="ct-preview-top">
		<p class="studio-label">On the desk</p>
		<button
			class="ct-favorite"
			class:active={item.isFavoritedByMe}
			aria-pressed={item.isFavoritedByMe}
			aria-label="{item.isFavoritedByMe ? 'Unfavorite' : 'Favorite'} {item.sheet.title}"
			disabled={busy}
			onclick={onfavorite}
		>
			<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"
				><path
					d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"
				/></svg
			>
			{item.favoriteCount}
		</button>
	</div>
	<h3>{item.sheet.title}</h3>
	<p class="ct-byline">
		{#if item.sheet.composer}{item.sheet.composer}<span class="ct-separator" aria-hidden="true"
				>·</span
			>{/if}Shared by {item.authorName ?? 'Anonymous'}
	</p>
	<div class="ct-metadata">
		{#if item.sheet.style}<span class="ct-style">{item.sheet.style}</span>{/if}
		<span>{item.sheet.timeSignature.join('/')}</span><span>{totalBars} bars</span>
		<span>{hasMelody ? 'Melody & changes' : 'Changes only'}</span>
	</div>
	<div class="ct-chart-toolbar">
		<span class="studio-label">Opening changes</span>
		<label
			>Written key <select
				aria-label="Preview written key"
				value={writtenKey}
				onchange={(event) => (selectedKey = event.currentTarget.value as PitchClass)}
			>
				{#each PITCH_CLASSES as key}<option value={key}>{keyLabel(key)}</option>{/each}
			</select></label
		>
	</div>
	<div class="ct-chart" aria-label="Opening {bars.length} bars in {keyLabel(writtenKey)}">
		{#each bars as bar (bar.number)}
			<div class="ct-bar">
				<div class="ct-bar-heading">
					<span>{bar.number}</span>{#if bar.section}<b>{bar.section}</b>{/if}
				</div>
				<div class="ct-chords">
					{#each bar.cells as cell}
						<div class="ct-chord-cell" data-role={cell.role ?? 'neutral'} style:flex={cell.length}>
							{#if cell.symbol}<ChordSymbolText symbol={cell.symbol} stacked />{:else}<span
									class="ct-no-chord"
									aria-label="No chord marked">—</span
								>{/if}
						</div>
					{/each}
				</div>
				<div class="ct-beats" aria-hidden="true">
					{#each Array(item.sheet.timeSignature[0]) as _}<i></i>{/each}
				</div>
			</div>
		{/each}
	</div>
	<div class="ct-form">
		<div>
			<span class="studio-label">Form</span
			>{#each item.sheet.sections as section}{#if section.label}<span
						class="ct-section"
						title="{section.bars} bars{section.repeatStart
							? ', repeat start'
							: ''}{section.repeatEnd ? ', repeat end' : ''}"
						>{section.repeatStart ? '𝄆 ' : ''}{section.label}{section.ending
							? ` (${section.ending})`
							: ''}{section.repeatEnd ? ' 𝄇' : ''}</span
					>{/if}{/each}
		</div>
		<a class="studio-text-action" href="/tunes/{item.sheet.id}">View full chart ↗</a>
	</div>
	<footer class="ct-preview-footer">
		<div>
			<h4>{item.isAdoptedByMe ? 'A tune in your book.' : 'A new tune for your book.'}</h4>
			<p>
				{item.isAdoptedByMe
					? 'Ready for your next session.'
					: 'Keep the chart, then practice it in any key.'}
			</p>
		</div>
		{#if item.isAdoptedByMe}
			<div class="ct-book-actions">
				<a class="studio-action" href="/tunes/{item.sheet.id}">✓ In my book</a><button
					class="studio-text-action"
					disabled={busy}
					onclick={onreturn}>{pending === 'return' ? 'Returning…' : 'Return to community'}</button
				>
			</div>
		{:else}
			<button
				class="studio-action"
				aria-label="Add {item.sheet.title} to my book"
				disabled={busy}
				onclick={onadopt}>{pending === 'adopt' ? 'Adding…' : '+ Add to my book'}</button
			>
		{/if}
	</footer>
</section>

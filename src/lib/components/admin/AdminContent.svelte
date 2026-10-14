<script lang="ts">
	import { leadSheetTuneFor, leadSheetAbcOptions } from '$lib/music/lead-sheet';
	import { onDestroy } from 'svelte';
	import { enhance } from '$app/forms';
	import type { AdminContent } from '$lib/server/admin-content';
	import NotationDisplay from '$lib/components/notation/NotationDisplay.svelte';
	import { createLickAudition } from '$lib/state/lick-audition.svelte';

	let { content, userId }: { content: AdminContent; userId: string } = $props();
	let removeId = $state<string | null>(null);
	let confirm = $state('');
	let pending = $state(false);
	const audition = createLickAudition();
	onDestroy(() => audition.dispose());
</script>

<div class="admin-content">
	<div class="admin-content-title"><h3>Content inspection</h3><span>{content.licks.length} licks · {content.tunes.length} tunes</span></div>
	{#if audition.state.error}<p role="alert" class="text-sm text-[var(--color-error-text)]">{audition.state.error}</p>{/if}
	{#each content.licks as lick (lick.id)}
		<details class="rounded-lg border border-[var(--color-bg-tertiary)] p-3" ontoggle={(event) => { if (!event.currentTarget.open && audition.state.playingId === lick.id && lick.phrase) void audition.play(lick.phrase); }}>
			<summary class="cursor-pointer text-sm font-medium">
				{lick.name || 'Untitled lick'} <span class="ml-2 font-normal text-[var(--color-text-secondary)]">{lick.adoptionCount} {lick.adoptionCount === 1 ? 'adopter' : 'adopters'}</span>
			</summary>
			<div class="mt-3 space-y-3">
				{#if lick.phrase}
					<div class="admin-score"><div class="admin-score-inner"><NotationDisplay tune={leadSheetTuneFor(lick.phrase, Number.POSITIVE_INFINITY).tune} tuneOptions={{ ...leadSheetAbcOptions(lick.phrase, 4), omitMasthead: true }} variant="practice" frameless staffWidth={750} /></div></div>
					<button type="button" class="text-sm text-[var(--color-brass)]" onclick={() => lick.phrase && audition.play(lick.phrase)}>{audition.state.playingId === lick.id ? 'Stop preview' : 'Play preview'}</button>
				{:else}
					<p class="text-sm text-[var(--color-error-text)]">This lick cannot be previewed safely.</p>
					<ul class="list-disc pl-4 text-xs text-[var(--color-text-secondary)]">{#each lick.errors as error}<li>{error}</li>{/each}</ul>
				{/if}
				{#if lick.adoptionCount > 0}
					<p class="text-xs text-[var(--color-text-secondary)]">Removal blocked: this lick is in another user's library.</p>
				{:else if removeId === lick.id}
					<form method="POST" action="?/removeLick" class="space-y-2 rounded-lg bg-[var(--color-error)]/5 p-3" use:enhance={() => {
						pending = true;
						return async ({ update }) => { pending = false; await update(); };
					}}>
						<input type="hidden" name="userId" value={userId} />
						<input type="hidden" name="lickId" value={lick.id} />
						<label for="remove-{lick.id}" class="block text-xs">Remove this lick from the library and community. The account stays. No adopters are affected. Type “{lick.name.trim() ? lick.name : lick.id}” to confirm.</label>
						<input id="remove-{lick.id}" name="confirm" bind:value={confirm} autocomplete="off" class="w-full rounded-lg bg-[var(--color-bg-tertiary)] px-3 py-2 text-sm" />
						<button disabled={pending || confirm !== (lick.name.trim() ? lick.name : lick.id)} class="rounded-lg bg-[var(--color-error)]/80 px-3 py-2 text-sm text-white disabled:opacity-40">{pending ? 'Removing…' : 'Remove lick'}</button>
						<button type="button" disabled={pending} class="ml-3 text-xs" onclick={() => removeId = null}>Cancel</button>
					</form>
				{:else}
					<button type="button" class="ml-3 text-xs text-[var(--color-error-text)]" onclick={() => { removeId = lick.id; confirm = ''; }}>Remove lick…</button>
				{/if}
			</div>
		</details>
	{:else}
		<p class="text-sm text-[var(--color-text-secondary)]">No licks.</p>
	{/each}
	{#each content.tunes as tune (tune.id)}
		<p class="text-sm">Tune: {tune.title} <span class="text-[var(--color-text-secondary)]">· {tune.adoptionCount} {tune.adoptionCount === 1 ? 'adopter' : 'adopters'}</span></p>
	{/each}
	<p class="admin-impact">Account deletion would remove {content.licks.length} {content.licks.length === 1 ? 'lick' : 'licks'} and {content.tunes.length} {content.tunes.length === 1 ? 'tune' : 'tunes'}, plus the user's practice data and uploads. {content.affectedUsers} other {content.affectedUsers === 1 ? 'user affected' : 'users affected'}.</p>
	{#if content.affectedUsers > 0}
		<p class="text-sm text-[var(--color-error-text)]">Account deletion is blocked while other users have adopted this content.</p>
	{/if}
</div>

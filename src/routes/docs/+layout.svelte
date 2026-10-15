<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import DocsSidebar from '$lib/components/docs/DocsSidebar.svelte';
	import ChatInterface from '$lib/components/docs/ChatInterface.svelte';
	import '$lib/components/docs/docs-desk.css';

	let { children }: { children: Snippet } = $props();
	let mobileSidebarOpen = $state(false);
	let assistantDialog: HTMLDialogElement;
	let assistantTrigger: HTMLButtonElement;
	const currentSlug = $derived(page.url.pathname.replace(/^\/docs\/?/, ''));
	afterNavigate(() => { mobileSidebarOpen = false; });
</script>

<div class="studio-desk docs-studio">
	<div class="docs-masthead">
		<a href="/docs" class="docs-wordmark">MANKUNKU <span>/ LINER NOTES</span></a>
		<div>
			<button type="button" class="docs-mobile-toggle" aria-expanded={mobileSidebarOpen} aria-controls="docs-sidebar" onclick={() => mobileSidebarOpen = !mobileSidebarOpen}>{mobileSidebarOpen ? 'Close guides' : 'Browse guides'}</button>
			<button bind:this={assistantTrigger} type="button" class="docs-ask" onclick={() => assistantDialog.showModal()}>Ask AI <span aria-hidden="true">↗</span></button>
		</div>
	</div>
	<div class="docs-layout-grid">
		<aside id="docs-sidebar" class="docs-index" class:open={mobileSidebarOpen}>
			<DocsSidebar {currentSlug} onnavigate={() => mobileSidebarOpen = false} />
		</aside>
		<div class="docs-main">{@render children()}</div>
	</div>
	<footer class="docs-footer"><span>MANKUNKU <b>/</b> Listen closely. Play freely.</span><span>The guidebook for your practice.</span></footer>
	<dialog bind:this={assistantDialog} class="docs-assistant-dialog" aria-label="AI assistant" onclose={() => assistantTrigger.focus()} onclick={(event) => { if (event.target === assistantDialog) assistantDialog.close(); }} onkeydown={(event) => { if (event.key === 'Escape') assistantDialog.close(); }}>
		<div class="docs-assistant-shell">
			<div class="docs-assistant-top"><span class="docs-kicker">The studio / A little guidance</span><button type="button" aria-label="Close assistant" onclick={() => assistantDialog.close()}>Close <span aria-hidden="true">×</span></button></div>
			<!-- Keep the conversation mounted across opening, closing and doc navigation. -->
			<ChatInterface pageSlug={currentSlug} />
		</div>
	</dialog>
</div>

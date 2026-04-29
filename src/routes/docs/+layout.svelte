<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import DocsSidebar from '$lib/components/docs/DocsSidebar.svelte';
	import ChatInterface from '$lib/components/docs/ChatInterface.svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();

	let mobileSidebarOpen = $state(false);
	let chatOpen = $state(false);

	const currentSlug = $derived.by(() => {
		const path = page.url?.pathname ?? '';
		const m = path.match(/^\/docs\/(.+)$/);
		return m ? m[1] : '';
	});
</script>

<div class="docs-layout">
	<!-- Mobile sidebar toggle -->
	<button
		type="button"
		onclick={() => { mobileSidebarOpen = !mobileSidebarOpen; }}
		aria-expanded={mobileSidebarOpen}
		aria-controls="docs-sidebar"
		class="md:hidden mb-3 inline-flex items-center gap-2 rounded-md border border-[var(--color-bg-tertiary)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
	>
		<svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
			<line x1="2" y1="4" x2="14" y2="4" />
			<line x1="2" y1="8" x2="14" y2="8" />
			<line x1="2" y1="12" x2="14" y2="12" />
		</svg>
		{mobileSidebarOpen ? 'Hide' : 'Show'} docs index
	</button>

	<div class="grid gap-8 md:grid-cols-[14rem_minmax(0,1fr)]">
		<aside
			id="docs-sidebar"
			class="docs-aside {mobileSidebarOpen ? 'block' : 'hidden md:block'}"
		>
			<div class="md:sticky md:top-4 space-y-3">
				<DocsSidebar
					{currentSlug}
					onnavigate={() => { mobileSidebarOpen = false; }}
				/>
				<button
					type="button"
					onclick={() => { chatOpen = !chatOpen; }}
					class="w-full rounded-md bg-[var(--color-bg-secondary)] border border-[var(--color-bg-tertiary)] px-3 py-2 text-xs text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text)] hover:border-[var(--color-brass)] flex items-center justify-center gap-2"
				>
					<svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
						<path d="M2 6c0-2 1.5-3.5 3.5-3.5h5c2 0 3.5 1.5 3.5 3.5v3c0 2-1.5 3.5-3.5 3.5h-3.5l-3 2.5v-2.5h-1c-1 0-1-1-1-1z" stroke-linejoin="round" />
					</svg>
					{chatOpen ? 'Hide AI assistant' : 'Ask AI'}
				</button>
			</div>
		</aside>

		<div class="min-w-0">
			{@render children()}
		</div>
	</div>

	<!-- Floating action button (mobile + when chat closed on desktop) -->
	{#if !chatOpen}
		<button
			type="button"
			onclick={() => { chatOpen = true; }}
			aria-label="Open AI assistant"
			class="chat-fab"
		>
			<svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
				<path d="M2 6c0-2 1.5-3.5 3.5-3.5h5c2 0 3.5 1.5 3.5 3.5v3c0 2-1.5 3.5-3.5 3.5h-3.5l-3 2.5v-2.5h-1c-1 0-1-1-1-1z" stroke-linejoin="round" />
			</svg>
			<span>Ask AI</span>
		</button>
	{/if}

	<!-- Chat panel — desktop drawer + mobile bottom sheet -->
	{#if chatOpen}
		<div class="chat-overlay" aria-hidden="true" onclick={() => { chatOpen = false; }} role="presentation"></div>
	{/if}
	<aside
		class="chat-panel {chatOpen ? 'is-open' : ''}"
		aria-label="AI assistant"
		aria-hidden={!chatOpen}
	>
		<div class="chat-panel-header">
			<button
				type="button"
				onclick={() => { chatOpen = false; }}
				aria-label="Close assistant"
				class="chat-close"
			>
				✕
			</button>
		</div>
		<div class="chat-panel-body">
			<!-- Always mounted so messages persist across doc navigations within the session -->
			<ChatInterface pageSlug={currentSlug} />
		</div>
	</aside>
</div>

<style>
	.docs-aside {
		max-height: calc(100vh - 6rem);
		overflow-y: auto;
		padding-right: 0.25rem;
	}

	.chat-fab {
		position: fixed;
		right: 1.25rem;
		bottom: 1.25rem;
		z-index: 30;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.65rem 1rem;
		background: var(--color-accent);
		color: white;
		border: none;
		border-radius: 9999px;
		font-size: 0.8rem;
		font-weight: 600;
		box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
		cursor: pointer;
		transition: background-color 120ms ease-out, transform 120ms ease-out;
	}
	.chat-fab:hover {
		background: var(--color-accent-hover);
		transform: translateY(-1px);
	}

	.chat-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		z-index: 35;
	}
	@media (min-width: 768px) {
		.chat-overlay {
			background: transparent;
			pointer-events: none;
		}
	}

	.chat-panel {
		position: fixed;
		z-index: 40;
		background: var(--color-bg-secondary);
		border-left: 1px solid var(--color-bg-tertiary);
		display: flex;
		flex-direction: column;
		transition: transform 220ms ease-out;
	}

	/* Mobile: bottom sheet */
	@media (max-width: 767px) {
		.chat-panel {
			left: 0;
			right: 0;
			bottom: 0;
			height: 80vh;
			border-top: 2px solid var(--color-brass);
			border-left: none;
			border-radius: 1rem 1rem 0 0;
			transform: translateY(100%);
		}
		.chat-panel.is-open {
			transform: translateY(0);
		}
	}

	/* Desktop: right-hand drawer */
	@media (min-width: 768px) {
		.chat-panel {
			top: 0;
			right: 0;
			bottom: 0;
			width: min(420px, 90vw);
			border-left: 2px solid var(--color-brass);
			transform: translateX(100%);
			box-shadow: -8px 0 24px rgba(0, 0, 0, 0.35);
		}
		.chat-panel.is-open {
			transform: translateX(0);
		}
	}

	.chat-panel-header {
		display: flex;
		justify-content: flex-end;
		padding: 0.4rem 0.5rem;
	}
	.chat-close {
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 0.375rem;
		background: transparent;
		border: none;
		color: var(--color-text-secondary);
		cursor: pointer;
		font-size: 1rem;
		line-height: 1;
		transition: color 120ms ease-out, background-color 120ms ease-out;
	}
	.chat-close:hover {
		color: var(--color-text);
		background: var(--color-bg-tertiary);
	}

	.chat-panel-body {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.chat-panel-body :global(.chat-root) {
		flex: 1;
		min-height: 0;
	}

	@media (prefers-reduced-motion: reduce) {
		.chat-panel,
		.chat-fab {
			transition: none;
		}
	}
</style>

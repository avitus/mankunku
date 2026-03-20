<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { settings, applyTheme } from '$lib/state/settings.svelte.ts';
	import Onboarding from '$lib/components/onboarding/Onboarding.svelte';

	interface Props {
		children: import('svelte').Snippet;
	}

	let { children }: Props = $props();
	let mobileMenuOpen = $state(false);

	const navItems = [
		{ href: '/', label: 'Home' },
		{ href: '/practice', label: 'Practice' },
		{ href: '/record', label: 'Record' },
		{ href: '/library', label: 'Library' },
		{ href: '/scales', label: 'Scales' },
		{ href: '/progress', label: 'Progress' },
		{ href: '/settings', label: 'Settings' }
	];

	onMount(() => {
		applyTheme();
	});

	function isActive(href: string): boolean {
		if (href === '/') return page.url?.pathname === '/';
		return page.url?.pathname?.startsWith(href) ?? false;
	}
</script>

{#if !settings.onboardingComplete}
	<Onboarding />
{/if}

<div class="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
	<nav class="border-b border-[var(--color-bg-tertiary)] px-4 py-3">
		<div class="mx-auto flex max-w-5xl items-center justify-between">
			<a href="/" class="text-xl font-bold tracking-tight">Mankunku</a>

			<!-- Desktop nav -->
			<div class="hidden gap-4 text-sm sm:flex">
				{#each navItems as { href, label }}
					<a
						{href}
						class="transition-colors {isActive(href)
							? 'text-[var(--color-accent)] font-medium'
							: 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'}"
					>
						{label}
					</a>
				{/each}
			</div>

			<!-- Mobile hamburger -->
			<button
				class="sm:hidden rounded p-1.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-tertiary)]"
				onclick={() => { mobileMenuOpen = !mobileMenuOpen; }}
				aria-label="Toggle menu"
			>
				<svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					{#if mobileMenuOpen}
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					{:else}
						<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
					{/if}
				</svg>
			</button>
		</div>

		<!-- Mobile menu -->
		{#if mobileMenuOpen}
			<div class="mt-3 space-y-1 border-t border-[var(--color-bg-tertiary)] pt-3 sm:hidden">
				{#each navItems as { href, label }}
					<a
						{href}
						onclick={() => { mobileMenuOpen = false; }}
						class="block rounded px-3 py-2 text-sm transition-colors {isActive(href)
							? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)] font-medium'
							: 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text)]'}"
					>
						{label}
					</a>
				{/each}
			</div>
		{/if}
	</nav>

	<main class="mx-auto max-w-5xl px-4 py-6">
		{@render children()}
	</main>
</div>

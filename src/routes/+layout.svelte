<script lang="ts">
	import '../app.css';

	interface Props {
		children: import('svelte').Snippet;
	}

	let { children }: Props = $props();

	const navItems = [
		{ href: '/', label: 'Home' },
		{ href: '/practice', label: 'Practice' },
		{ href: '/library', label: 'Library' },
		{ href: '/scales', label: 'Scales' },
		{ href: '/progress', label: 'Progress' },
		{ href: '/settings', label: 'Settings' }
	];
</script>

<div class="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
	<nav class="border-b border-[var(--color-bg-tertiary)] px-4 py-3">
		<div class="mx-auto flex max-w-5xl items-center justify-between">
			<a href="/" class="text-xl font-bold tracking-tight">Mankunku</a>
			<div class="flex gap-4 text-sm">
				{#each navItems as { href, label }}
					<a
						{href}
						class="text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
					>
						{label}
					</a>
				{/each}
			</div>
		</div>
	</nav>

	<main class="mx-auto max-w-5xl px-4 py-6">
		{@render children()}
	</main>
</div>

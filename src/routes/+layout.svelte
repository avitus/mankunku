<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { settings, applyTheme, getInstrument } from '$lib/state/settings.svelte';
	import {
		migrateUserLicksWrittenToConcert,
		migrateUserLicksKeyWrittenToConcert
	} from '$lib/persistence/user-licks';
	import Onboarding from '$lib/components/onboarding/Onboarding.svelte';
	import { invalidate } from '$app/navigation';

	interface Props {
		children: import('svelte').Snippet;
		data: {
			supabase: import('@supabase/supabase-js').SupabaseClient;
			session: import('@supabase/supabase-js').Session | null;
			user: import('@supabase/supabase-js').User | null;
		};
	}

	let { children, data }: Props = $props();
	let mobileMenuOpen = $state(false);
	let { supabase, session, user } = $derived(data);

	const navItems = [
		{ href: '/', label: 'Home' },
		{ href: '/practice', label: 'Ear Training' },
		{ href: '/lick-practice', label: 'Lick Practice' },
		{ href: '/library', label: 'Library' },
		{ href: '/add-licks', label: 'Add Licks' },
		{ href: '/progress', label: 'Progress' },
		{ href: '/settings', label: 'Settings' }
	];

	/**
	 * Derive the visual identity domain for the current route. This drives
	 * the data-domain attribute on the layout root, which scopes the
	 * `--color-accent` override defined in app.css. See the design system
	 * spec at documentation/architecture/design-system.md.
	 *
	 * - 'lick-practice' (green) — anything under /lick-practice
	 * - 'ear-training' (blue, the default) — /practice, /scales, /record,
	 *   /progress and their subroutes
	 * - 'neutral' (slate) — everything else (Library, Add Licks, Settings,
	 *   Home, Auth, Diagnostics, etc.)
	 */
	const dataDomain = $derived.by(() => {
		const path = page.url?.pathname ?? '/';
		if (path.startsWith('/lick-practice')) return 'lick-practice';
		if (
			path.startsWith('/practice') ||
			path.startsWith('/scales') ||
			path.startsWith('/record') ||
			path.startsWith('/progress')
		) {
			return 'ear-training';
		}
		return 'neutral';
	});

	const domainLabel = $derived(
		dataDomain === 'ear-training'
			? 'Ear Training'
			: dataDomain === 'lick-practice'
				? 'Lick Practice'
				: ''
	);

	onMount(() => {
		applyTheme();

		// One-off migrations for step-entered licks that were stored in the
		// user's WRITTEN pitch space (before step-entry was made instrument-
		// aware). Both are idempotent via separate localStorage flags — safe
		// to call on every app start.
		const instrument = getInstrument();
		const notesMigrated = migrateUserLicksWrittenToConcert(instrument.transpositionSemitones);
		if (notesMigrated > 0) {
			console.info(`[migration] Shifted ${notesMigrated} step-entered lick(s) notes to concert pitch.`);
		}
		const keysMigrated = migrateUserLicksKeyWrittenToConcert(instrument);
		if (keysMigrated > 0) {
			console.info(`[migration] Converted ${keysMigrated} step-entered lick(s) keys to concert pitch.`);
		}

		const {
			data: { subscription }
		} = data.supabase.auth.onAuthStateChange((event, newSession) => {
			if (newSession?.expires_at !== data.session?.expires_at) {
				invalidate('supabase:auth');
			}
		});

		return () => {
			subscription.unsubscribe();
		};
	});

	function isActive(href: string): boolean {
		if (href === '/') return page.url?.pathname === '/';
		if (href === '/add-licks') {
			return ['/add-licks', '/record', '/entry'].some(
				(p) => page.url?.pathname?.startsWith(p) ?? false
			);
		}
		return page.url?.pathname?.startsWith(href) ?? false;
	}
</script>

{#if !settings.onboardingComplete}
	<Onboarding {supabase} {session} {user} />
{/if}

<div
	data-domain={dataDomain}
	class="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]"
>
	<!-- Domain accent stripe — peripheral cue that the user is inside a
	     mode-specific section. Hidden on neutral pages. -->
	{#if dataDomain !== 'neutral'}
		<div class="h-0.5 w-full bg-[var(--color-accent)]"></div>
	{/if}

	<nav class="border-b border-[var(--color-bg-tertiary)] px-4 py-3">
		<div class="mx-auto flex max-w-5xl items-center justify-between">
			<div class="flex items-center gap-2">
				<a href="/" class="text-xl font-bold tracking-tight">Mankunku</a>
				{#if dataDomain !== 'neutral'}
					<span
						class="rounded-full bg-[var(--color-accent)]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-accent)]"
					>
						{domainLabel}
					</span>
				{/if}
			</div>

			<!-- Desktop nav -->
			<div class="hidden gap-4 text-sm sm:flex items-center">
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

				<!-- Auth controls (desktop) -->
				<span class="ml-2 border-l border-[var(--color-bg-tertiary)] pl-3">
					{#if session && user}
						<span class="flex items-center gap-2">
							<span
								class="max-w-[120px] truncate text-xs text-[var(--color-text-secondary)]"
								>{user.email}</span
							>
							<form method="POST" action="/auth/logout">
								<button
									type="submit"
									class="text-xs text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text)]"
								>
									Sign Out
								</button>
							</form>
						</span>
					{:else}
						<a
							href="/auth"
							class="text-xs font-medium text-[var(--color-accent)] transition-opacity hover:opacity-80"
						>
							Sign In
						</a>
					{/if}
				</span>
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

				<!-- Mobile auth controls -->
				<div class="mt-2 border-t border-[var(--color-bg-tertiary)] pt-2">
					{#if session && user}
						<div class="truncate px-3 py-2 text-xs text-[var(--color-text-secondary)]">
							{user.email}
						</div>
						<form method="POST" action="/auth/logout">
							<button
								type="submit"
								class="block w-full rounded px-3 py-2 text-left text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text)]"
								onclick={() => {
									mobileMenuOpen = false;
								}}
							>
								Sign Out
							</button>
						</form>
					{:else}
						<a
							href="/auth"
							onclick={() => {
								mobileMenuOpen = false;
							}}
							class="block rounded px-3 py-2 text-sm font-medium text-[var(--color-accent)] transition-colors hover:bg-[var(--color-bg-tertiary)]"
						>
							Sign In
						</a>
					{/if}
				</div>
			</div>
		{/if}
	</nav>

	<main class="mx-auto max-w-5xl px-4 py-6">
		{@render children()}
	</main>
</div>

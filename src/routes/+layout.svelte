<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page, updated } from '$app/state';
	import { isOnboardingRoute } from '$lib/state/onboarding-routes';
	import { settings, applyTheme } from '$lib/state/settings.svelte';
	import Onboarding from '$lib/components/onboarding/Onboarding.svelte';
	import TourBanner from '$lib/components/ui/TourBanner.svelte';
	import { welcomeTour } from '$lib/tour/tours/welcome';
	import type { NavTourKey } from '$lib/tour/nav-target';
	import { loadTourStateFromCloud } from '$lib/state/tour.svelte';
	import { afterNavigate, beforeNavigate, invalidate } from '$app/navigation';
	import {
		shouldHardReloadOnNavigation,
		setPendingNavTarget,
		clearNavRecoveryLatch
	} from '$lib/util/stale-chunk';

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

	// Proactive stale-chunk guard (Sentry MANKUNKU-8). `kit.version.pollInterval`
	// (svelte.config.js) polls for a new deployment; when one goes live,
	// `updated.current` flips true. On the next client navigation we do a
	// full-page load of the target instead of a client-side one, so a fresh HTML
	// shell + manifest are fetched and the next lazy `import()` resolves to a
	// chunk that still exists — heading off "error loading dynamically imported
	// module" before it can happen. `handleNavErrorRecovery` in hooks.client.ts
	// is the reactive backstop for anything that slips past this.
	//
	// nav.cancel() stops the client-side navigation BEFORE handing off to the
	// full-page load; without it the SvelteKit nav keeps running and races the
	// document load (SvelteKit's own native_navigation() stalls the router the
	// same way).
	beforeNavigate((nav) => {
		// Record the in-flight target so handleNavErrorRecovery (hooks.client.ts)
		// can distinguish a failed NAVIGATION (recover toward this URL) from a
		// failed hover/touch PRELOAD (do nothing).
		setPendingNavTarget(nav.to?.url.href ?? null);
		if (shouldHardReloadOnNavigation(nav, updated.current) && nav.to) {
			nav.cancel();
			location.href = nav.to.url.href;
		}
	});

	afterNavigate((nav) => {
		setPendingNavTarget(null);
		// A completed client-side navigation (not the initial 'enter') proves the
		// router is healthy — reset the one-attempt recovery latch so the next
		// deploy-window episode recovers instead of dead-ending. Never reset on
		// 'enter' alone: a page whose hydration keeps failing must stay latched
		// or recovery would loop full-page navigations.
		if (nav.type !== 'enter' && typeof sessionStorage !== 'undefined') {
			clearNavRecoveryLatch(sessionStorage);
		}
	});

	/**
	 * Username portion of the email (before the @) — saves horizontal space in
	 * the nav. Falls back to "Account" if the user has no email (e.g. a
	 * non-email auth provider) or if the local part is empty, so both desktop
	 * and mobile labels never render blank.
	 */
	const emailPrefix = $derived(
		(user?.email && user.email.split('@')[0].trim()) || 'Account'
	);

	/**
	 * Explicit sign-out. Storage is per-user-namespaced, so the user's data
	 * SURVIVES sign-out (local-first, ready for instant re-login) — the
	 * post-logout load re-homes this browser to the anonymous bucket. Before
	 * posting to /auth/logout we FLUSH any pending cloud syncs so nothing
	 * unsynced is stranded, then submit. `form.submit()` bypasses this handler,
	 * so there is no resubmission loop. Flushing is best-effort and never blocks
	 * sign-out.
	 */
	async function handleSignOut(event: SubmitEvent) {
		event.preventDefault();
		const form = event.currentTarget as HTMLFormElement;
		try {
			const { flushAllPendingSync } = await import('$lib/persistence/outbox');
			await flushAllPendingSync();
		} catch {
			/* best effort — never block sign-out */
		}
		form.submit();
	}

	// `primary: true` marks the two headline practice modes. They get
	// display-serif treatment and sit visually separated from the utility
	// nav so they read as the "Side A / Side B" of the app.
	// `tourKey` is typed, not free text: guided-tour steps resolve nav targets
	// through `navTourElement(tourKey)`, so renaming a key here without updating
	// the tour must fail to compile rather than silently highlight nothing.
	const navItems: {
		href: string;
		label: string;
		primary: boolean;
		tourKey: NavTourKey;
	}[] = [
		{ href: '/', label: 'Home', primary: false, tourKey: 'home' },
		{ href: '/ear-training', label: 'Ear Training', primary: true, tourKey: 'ear-training' },
		{ href: '/lick-practice', label: 'Lick Practice', primary: true, tourKey: 'lick-practice' },
		{ href: '/licks', label: 'Licks', primary: false, tourKey: 'licks' },
		{ href: '/tricks', label: 'Tricks', primary: false, tourKey: 'tricks' },
		{ href: '/tunes', label: 'Tunes', primary: false, tourKey: 'tunes' },
		{ href: '/progress', label: 'Progress', primary: false, tourKey: 'progress' },
		{ href: '/docs', label: 'Docs', primary: false, tourKey: 'docs' },
		{ href: '/settings', label: 'Settings', primary: false, tourKey: 'settings' }
	];

	/**
	 * Derive the visual identity domain for the current route. This drives
	 * the data-domain attribute on the layout root, which scopes the
	 * `--color-accent` override defined in app.css. See the design system
	 * spec at documentation/architecture/design-system.md.
	 *
	 * - 'lick-practice' (warm terracotta) — anything under /lick-practice
	 * - 'ear-training' (blue, the default) — /ear-training, /scales, /progress
	 *   and their subroutes
	 * - 'neutral' (slate) — everything else (Licks, Tunes, Settings, Home,
	 *   Auth, Diagnostics, etc. — book management, not practice)
	 */
	const dataDomain = $derived.by(() => {
		const path = page.url?.pathname ?? '/';
		if (path.startsWith('/lick-practice')) return 'lick-practice';
		if (
			path.startsWith('/ear-training') ||
			path.startsWith('/scales') ||
			path.startsWith('/progress')
		) {
			return 'ear-training';
		}
		return 'neutral';
	});


	// Onboarding auto-triggers only on the mic-driven practice surfaces —
	// the route rule and its rationale live in state/onboarding-routes.ts,
	// where a table-driven test pins the prefix boundaries.
	const onboardingRoute = $derived.by(() => isOnboardingRoute(page.url?.pathname ?? '/'));

	// The overlay may only mount AFTER hydration: `settings.onboardingComplete`
	// comes from localStorage, which the server can't read, so consulting it
	// during SSR/hydration would either bake the overlay into every page's
	// server HTML (it did) or create a hydration mismatch. SSR renders the
	// branch false, hydration agrees, and the overlay appears as a plain
	// post-mount state change.
	let hydrated = $state(false);

	// Track whether cloud tour state has been merged in. Without this, the
	// welcome banner can render on a fresh device using stale local state
	// before the cloud merge resolves — letting someone who already
	// completed/dismissed the tour elsewhere see the CTA again.
	let tourStateHydrated = $state(false);

	// Pull tour completion from the cloud whenever auth state changes so a
	// completed tour on one device doesn't replay on another.
	$effect(() => {
		const sb = data.supabase;
		const sess = data.session;
		if (sb && sess) {
			tourStateHydrated = false;
			loadTourStateFromCloud(sb)
				.catch(() => {
					/* fire-and-forget — local state already loaded */
				})
				.finally(() => {
					tourStateHydrated = true;
				});
			// Trick-state hydration runs inside +layout.ts's awaitHydration chain
			// (with the other cloud inits), not here.
		} else {
			// Anonymous / signed-out: nothing to hydrate from, so unblock.
			tourStateHydrated = true;
		}
	});

	// Welcome banner only shows on the home route to avoid distracting from
	// in-progress practice sessions on /ear-training or /lick-practice. Also
	// gated on `tourStateHydrated` so the cloud-completion check is reliable
	// before we render the CTA.
	const showWelcomeBanner = $derived(
		settings.onboardingComplete &&
			tourStateHydrated &&
			(page.url?.pathname ?? '/') === '/'
	);

	onMount(() => {
		hydrated = true;
		applyTheme();


		const {
			data: { subscription }
		} = data.supabase.auth.onAuthStateChange((event, newSession) => {
			if (newSession?.expires_at !== data.session?.expires_at) {
				invalidate('supabase:auth');
			}
		});

		// Propagate account switches across tabs: when another tab switches
		// users, this tab re-homes (reloads) instead of writing the previous
		// user's in-memory state under whoever is now signed in.
		let teardownCrossTab: (() => void) | undefined;
		import('$lib/persistence/user-scope').then(({ initCrossTabSync }) => {
			teardownCrossTab = initCrossTabSync();
		});

		// Flush debounced/queued cloud syncs when the tab is hidden or unloaded
		// (mobile-safe: pagehide + visibilitychange, not beforeunload-only), so
		// pending writes are captured durably before the tab may be killed.
		const onHide = () => {
			import('$lib/persistence/outbox').then(({ flushOnHide }) => flushOnHide(supabase)).catch(() => {});
		};
		const onVisibility = () => {
			if (document.visibilityState === 'hidden') onHide();
		};
		window.addEventListener('pagehide', onHide);
		document.addEventListener('visibilitychange', onVisibility);
		const onOnline = () => {
			import('$lib/persistence/outbox').then(({ drainOutbox }) => drainOutbox(supabase)).catch(() => {});
		};
		window.addEventListener('online', onOnline);

		return () => {
			subscription.unsubscribe();
			teardownCrossTab?.();
			window.removeEventListener('pagehide', onHide);
			document.removeEventListener('visibilitychange', onVisibility);
			window.removeEventListener('online', onOnline);
		};
	});

	function isActive(href: string): boolean {
		if (href === '/') return page.url?.pathname === '/';
		return page.url?.pathname?.startsWith(href) ?? false;
	}

	// Canonical and og:url must reflect the current route, not the home page.
	// Using $page.url.origin keeps the host correct in preview/staging too.
	const canonicalUrl = $derived(
		page.url ? `${page.url.origin}${page.url.pathname}` : 'https://mankunkujazz.com/'
	);
</script>

<svelte:head>
	<link rel="canonical" href={canonicalUrl} />
	<meta property="og:url" content={canonicalUrl} />
</svelte:head>

{#if hydrated && onboardingRoute && !settings.onboardingComplete}
	<Onboarding {supabase} {session} {user} />
{/if}

<!-- data-hydrated flips to "true" once the layout has mounted. The e2e
     fixtures' goto() waits on it before returning: until PR #229 the SSR'd
     onboarding overlay covered every page and incidentally blocked Playwright
     clicks until hydration removed it — without that accidental barrier, a
     click fired straight after navigation can land before handlers attach
     and silently do nothing (the delete-account race on /settings). -->
<div
	data-domain={dataDomain}
	data-hydrated={hydrated}
	class="grain-overlay min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]"
>
	<!-- Domain accent stripe — peripheral cue that the user is inside a
	     mode-specific section. Hidden on neutral pages. -->
	{#if dataDomain !== 'neutral'}
		<div class="h-0.5 w-full bg-[var(--color-accent)]"></div>
	{/if}

	<nav class="relative z-20 border-b border-[var(--color-bg-tertiary)] px-4 py-3">
		<div class="mx-auto flex max-w-5xl items-center justify-between">
			<div class="flex items-center gap-3">
				<a
					href="/"
					class="font-display text-2xl tracking-tight text-[var(--color-text)]"
					style="font-weight: 700; letter-spacing: 0.02em;"
				>
					MANKUNKU
				</a>
			</div>

			<!-- Desktop nav -->
			<div class="hidden gap-4 text-sm sm:flex items-center">
				{#each navItems as { href, label, primary, tourKey }, i}
					{@const prevPrimary = i > 0 ? navItems[i - 1].primary : false}
					{@const needsDivider = prevPrimary && !primary}
					{#if needsDivider}
						<span class="h-4 w-px bg-[var(--color-brass)]/40" aria-hidden="true"></span>
					{/if}
					<a
						{href}
						id="nav-{tourKey}"
						data-tour="nav-{tourKey}"
						class="relative transition-colors {primary
							? 'font-display text-lg tracking-tight'
							: 'text-sm'} {isActive(href)
							? 'text-[var(--color-text)] font-medium'
							: primary
								? 'text-[var(--color-text)]/90 hover:text-[var(--color-brass)]'
								: 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'}"
					>
						{label}
						{#if isActive(href)}
							<span
								class="absolute -bottom-1 left-0 right-0 h-px bg-[var(--color-brass)]"
							></span>
						{/if}
					</a>
				{/each}

				<!--
					Auth controls (desktop) — collapsed into a single dropdown
					using <details>/<summary>. The summary shows just the
					email's local part (before the @) to save horizontal space;
					clicking reveals a compact menu with Sign Out. Native
					disclosure gives us keyboard access for free.
				-->
				<div class="ml-2 border-l border-[var(--color-bg-tertiary)] pl-3">
					{#if session && user}
						<details class="group relative">
							<summary
								class="cursor-pointer list-none max-w-[120px] truncate text-xs text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text)]"
								title={user.email ?? ''}
							>
								{emailPrefix} <span class="opacity-60 group-open:opacity-100">▾</span>
							</summary>
							<div
								class="absolute right-0 top-full z-20 mt-1 min-w-[120px] rounded-md border border-[var(--color-bg-tertiary)] bg-[var(--color-bg-secondary)] p-1 shadow-md"
							>
								<form method="POST" action="/auth/logout" onsubmit={handleSignOut}>
									<button
										type="submit"
										class="block w-full rounded px-3 py-1.5 text-left text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text)]"
									>
										Sign Out
									</button>
								</form>
							</div>
						</details>
					{:else}
						<a
							href="/auth"
							class="text-xs font-medium text-[var(--color-accent)] transition-opacity hover:opacity-80"
						>
							Sign In
						</a>
					{/if}
				</div>
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
				{#each navItems as { href, label, primary, tourKey }, i}
					{@const prevPrimary = i > 0 ? navItems[i - 1].primary : false}
					{@const needsDivider = prevPrimary && !primary}
					{#if needsDivider}
						<div class="my-1 h-px bg-[var(--color-brass)]/30" aria-hidden="true"></div>
					{/if}
					<a
						{href}
						data-tour="nav-{tourKey}"
						data-tour-mobile="nav-{tourKey}"
						onclick={() => { mobileMenuOpen = false; }}
						class="block rounded px-3 py-2 transition-colors {primary
							? 'font-display text-xl tracking-tight'
							: 'text-sm'} {isActive(href)
							? 'text-[var(--color-text)] font-medium border-l-2 border-[var(--color-brass)]'
							: primary
								? 'text-[var(--color-text)] border-l-2 border-transparent hover:bg-[var(--color-bg-tertiary)]'
								: 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text)] border-l-2 border-transparent'}"
					>
						{label}
					</a>
				{/each}

				<!-- Mobile auth controls -->
				<div class="mt-2 border-t border-[var(--color-bg-tertiary)] pt-2">
					{#if session && user}
						<div
							class="truncate px-3 py-2 text-xs text-[var(--color-text-secondary)]"
							title={user.email ?? ''}
						>
							{emailPrefix}
						</div>
						<form method="POST" action="/auth/logout" onsubmit={handleSignOut}>
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

	<main class="relative z-10 mx-auto max-w-5xl px-4 py-6">
		{#if showWelcomeBanner}
			<TourBanner
				tourId="welcome"
				title="Take a quick tour?"
				description="A 60-second walkthrough of the app — Side A, Side B, and how to start practicing."
				steps={welcomeTour}
				ctaLabel="Start tour"
			/>
		{/if}
		{@render children()}
	</main>
</div>

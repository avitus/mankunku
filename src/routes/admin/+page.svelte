<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import AdminContent from '$lib/components/admin/AdminContent.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const form = $derived(page.form);

	// Delete confirmation: one row at a time, gated on retyping the identity.
	let confirmTargetId = $state<string | null>(null);
	let confirmText = $state('');
	let deleting = $state(false);
	let search = $state('');
	let filter = $state('all');
	let joinedBefore = $state('');
	const visibleUsers = $derived(data.users.filter(row => {
		const matchesSearch = `${row.email ?? ''} ${row.displayName ?? ''} ${row.id}`.toLowerCase().includes(search.trim().toLowerCase());
		const lastSeen = row.lastVisitDate ?? row.lastSignInAt?.slice(0, 10) ?? row.createdAt?.slice(0, 10);
		const inactive = !!lastSeen && Date.parse(lastSeen) < Date.now() - 30 * 86400000;
		return matchesSearch && (!joinedBefore || (row.createdAt && row.createdAt.slice(0, 10) <= joinedBefore)) &&
			(filter === 'all' || (filter === 'inactive' && inactive) || (filter === 'unconfirmed' && !row.emailConfirmedAt));
	}));

	/** Open account deletion confirmation for one user. */
	function openConfirm(id: string) {
		confirmTargetId = id;
		confirmText = '';
	}

	/** Clear the selected deletion target and typed confirmation. */
	function closeConfirm() {
		confirmTargetId = null;
		confirmText = '';
	}

	/** The string the owner must retype to arm the delete button. */
	function confirmPhrase(row: { email: string | null; id: string }): string {
		return row.email || row.id;
	}

	// ISO slicing keeps SSR and hydration output identical (no locale drift).
	/** Format a date identically during server rendering and hydration. */
	function fmtDate(iso: string | null): string {
		return iso ? iso.slice(0, 10) : '—';
	}

	/** Format a date identically during server rendering and hydration. */
	/** Format an observation timestamp in UTC. */
	function fmtDateTime(iso: string | null): string {
		return iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : '—';
	}

	/** Render server uptime using whole days, hours and minutes. */
	function fmtUptime(seconds: number): string {
		const d = Math.floor(seconds / 86400);
		const h = Math.floor((seconds % 86400) / 3600);
		const m = Math.floor((seconds % 3600) / 60);
		if (d > 0) return `${d}d ${h}h`;
		if (h > 0) return `${h}h ${m}m`;
		return `${m}m`;
	}
</script>

<svelte:head>
	<title>Admin — Mankunku</title>
	<!-- Owner-only page: never indexed, regardless of auth state. -->
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="space-y-8">
	<div>
		<div class="smallcaps text-[var(--color-brass)]">Back Office</div>
		<h1 class="font-display text-4xl font-bold tracking-tight">Admin</h1>
		<div class="jazz-rule mt-2 max-w-[140px]"></div>
	</div>

	{#if form?.error}
		<div
			class="rounded-lg bg-[var(--color-error)]/10 px-4 py-3 text-sm text-[var(--color-error-text)]"
			role="alert"
		>
			{form.error}
		</div>
	{:else if form?.success}
		<div class="rounded-lg bg-[var(--color-bg-secondary)] px-4 py-3 text-sm" role="status">
			{form.message ?? 'Action completed.'}
		</div>
	{/if}

	<!-- Totals -->
	{#if data.totals}
		<div class="grid grid-cols-3 gap-3">
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 text-center">
				<div class="font-display text-3xl font-bold tabular-nums text-[var(--color-brass)]">
					{data.totals.totalUsers}
				</div>
				<div class="smallcaps text-[var(--color-text-secondary)]">Total Users</div>
			</div>
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 text-center">
				<div class="font-display text-3xl font-bold tabular-nums" style="color: var(--color-brass-soft)">
					{data.totals.signupsThisWeek}
				</div>
				<div class="smallcaps text-[var(--color-text-secondary)]">Signups This Week</div>
			</div>
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 text-center">
				<div class="font-display text-3xl font-bold tabular-nums text-[var(--color-accent)]">
					{data.totals.activeThisWeek}
				</div>
				<div class="smallcaps text-[var(--color-text-secondary)]">Visited This Week</div>
			</div>
		</div>
	{/if}

	<!-- Users -->
	<div class="space-y-4">
		<div>
			<h2 class="font-display text-xl font-semibold">Users</h2>
			<p class="text-xs text-[var(--color-text-secondary)]">
				Signups, visits, and content — newest first
			</p>
		</div>

		<div class="flex flex-wrap items-end gap-3">
			<label class="flex-1 text-xs">Find a user<input type="search" bind:value={search} placeholder="Email or name" class="mt-1 block w-full min-w-48 rounded-lg bg-[var(--color-bg-secondary)] px-3 py-2 text-sm" /></label>
			<label class="text-xs">Show<select bind:value={filter} class="mt-1 block rounded-lg bg-[var(--color-bg-secondary)] px-3 py-2 text-sm"><option value="all">All users</option><option value="inactive">No visits in 30 days</option><option value="unconfirmed">Unconfirmed</option></select></label>
			<label class="text-xs">Joined on or before<input type="date" bind:value={joinedBefore} class="mt-1 block rounded-lg bg-[var(--color-bg-secondary)] px-3 py-2 text-sm" /></label>
		</div>
		<p class="text-xs text-[var(--color-text-secondary)]">Days visited counts distinct UTC dates seen signed in, across all browsers. Earlier visit history may be incomplete.</p>

		{#if data.unavailable}
			<div class="rounded-xl border border-[var(--color-bg-tertiary)] bg-[var(--color-bg-secondary)] px-5 py-8 text-center text-sm text-[var(--color-text-secondary)]">
				Admin data unavailable — the service-role connection could not be reached.
			</div>
		{:else}
			{#if data.truncated}
				<div class="rounded-lg bg-[var(--color-bg-secondary)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
					Showing the first {data.users.length} users — the list was truncated, so the
					totals tiles are withheld rather than reporting partial counts.
				</div>
			{/if}
			<div class="rounded-xl border border-[var(--color-bg-tertiary)] bg-[var(--color-bg-secondary)] divide-y divide-[var(--color-bg-tertiary)]">
				{#each visibleUsers as row (row.id)}
					<div class="space-y-3 p-5">
						<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
							<span class="text-sm font-medium">{row.email ?? row.id}</span>
							{#if row.displayName}
								<span class="text-sm text-[var(--color-text-secondary)]">{row.displayName}</span>
							{/if}
							{#if row.isAdmin}
								<span class="rounded-full bg-[var(--color-brass)]/15 px-2 py-0.5 text-xs text-[var(--color-brass)]">admin</span>
							{/if}
							{#if !row.emailConfirmedAt}
								<span class="rounded-full bg-[var(--color-bg-tertiary)] px-2 py-0.5 text-xs text-[var(--color-text-secondary)]">unconfirmed</span>
							{/if}
							<form method="POST" action="?/inspectUser" class="ml-auto" use:enhance>
								<input type="hidden" name="userId" value={row.id} />
								<button class="text-xs text-[var(--color-brass)]">Inspect content</button>
							</form>
						</div>

						<div class="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-[var(--color-text-secondary)] sm:grid-cols-4">
							<div><span class="smallcaps">Joined</span> <span class="tabular-nums">{fmtDate(row.createdAt)}</span></div>
							<div><span class="smallcaps">Last sign-in</span> <span class="tabular-nums">{fmtDate(row.lastSignInAt)}</span></div>
							<div><span class="smallcaps">Last visit</span> <span class="tabular-nums">{fmtDate(row.lastVisitDate)}</span></div>
							<div><span class="smallcaps">Last sync</span> <span class="tabular-nums">{fmtDateTime(row.lastSyncAt)}</span></div>
							<div><span class="smallcaps">Days visited</span> <span class="tabular-nums">{row.visitDayCount || '—'}</span></div>
							<div><span class="smallcaps" title="Practice time, not time signed in. Ear-training attempts are estimated at 30 seconds each.">Practice minutes</span> <span class="tabular-nums">{row.practiceMinutes}</span></div>
							<div><span class="smallcaps">Licks</span> <span class="tabular-nums">{row.lickCount}</span></div>
							<div><span class="smallcaps">Tunes</span> <span class="tabular-nums">{row.tuneCount}</span></div>
						</div>

						<details class="text-xs text-[var(--color-text-secondary)]">
							<summary class="cursor-pointer">Browsers and devices ({row.devices.length})</summary>
							<p class="mt-2">Observed on signed-in page loads; last seen updates at most hourly unless browser details change. Device type is approximate.</p>
							{#each row.devices as device (device.device_id)}
								<div class="mt-2">
									<span class="font-medium">{device.browser_name}{device.browser_version ? ` ${device.browser_version}` : ''} · {device.os_name} · {device.device_type}</span>
									<div>First seen {fmtDateTime(device.first_seen_at)} · Last seen {fmtDateTime(device.last_seen_at)}</div>
								</div>
							{:else}
								<p class="mt-2">No browser activity recorded yet.</p>
							{/each}
						</details>

						{#if data.audit.some(a => a.action === 'delete_user' && a.target_user_id === row.id && a.status === 'pending')}
							<p class="text-sm text-[var(--color-error-text)]">Deletion incomplete. Inspect content and retry deletion to finish.</p>
						{/if}
						{#if form?.inspectedUserId === row.id && form.content}
							<AdminContent content={form.content} userId={row.id} />
							{#if row.id !== data.user?.id && form.content.affectedUsers === 0}
								<button type="button" class="text-xs text-[var(--color-error-text)]" onclick={() => confirmTargetId === row.id ? closeConfirm() : openConfirm(row.id)}>{confirmTargetId === row.id ? 'Cancel account deletion' : 'Delete account…'}</button>
							{/if}
						{/if}

						{#if confirmTargetId === row.id && form?.inspectedUserId === row.id && form.content?.affectedUsers === 0}
							<form
								method="POST"
								action="?/deleteUser"
								class="flex flex-wrap items-center gap-3 rounded-lg bg-[var(--color-error)]/5 p-3"
								use:enhance={() => {
									deleting = true;
									return async ({ update }) => {
										deleting = false;
										closeConfirm();
										await update();
									};
								}}
							>
								<input type="hidden" name="userId" value={row.id} />
								<label class="flex-1 text-xs text-[var(--color-text-secondary)]" for="confirm-{row.id}">
									This permanently deletes the user, all their data, and their uploads.
									Type <span class="font-medium select-all">{confirmPhrase(row)}</span> to confirm.
								</label>
								<input
									id="confirm-{row.id}"
									name="confirm"
									type="text"
									autocomplete="off"
									bind:value={confirmText}
									placeholder={confirmPhrase(row)}
									class="w-56 rounded-lg bg-[var(--color-bg-tertiary)] px-3 py-1.5 text-sm placeholder-[var(--color-text-secondary)]/50 outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--color-error)]"
								/>
								<button
									type="submit"
									disabled={deleting || confirmText !== confirmPhrase(row)}
									class="rounded-lg bg-[var(--color-error)]/80 px-3 py-1.5 text-sm text-white transition-opacity disabled:opacity-40"
								>
									{deleting ? 'Deleting…' : 'Delete user'}
								</button>
							</form>
						{/if}
					</div>
				{:else}
					<div class="px-5 py-8 text-center text-sm text-[var(--color-text-secondary)]">
						No matching users.
					</div>
				{/each}
			</div>
		{/if}
	</div>

	{#if data.audit.length > 0}
		<details class="rounded-xl border border-[var(--color-bg-tertiary)] p-4 text-sm">
			<summary class="cursor-pointer font-medium">Recent admin actions</summary>
			<ul class="mt-3 space-y-3 text-xs text-[var(--color-text-secondary)]">
				{#each data.audit as action (action.id)}
					<li>{fmtDateTime(action.created_at)} · {action.action === 'remove_lick' ? 'Lick removal' : 'Account deletion'} · {action.status === 'completed' ? 'Completed' : 'Incomplete'}<br />By {data.users.find(u => u.id === action.actor_id)?.email ?? action.actor_id}<br />Target: {action.target_id}
						{#if action.status === 'pending'}
							<form method="POST" action="?/checkDeletion" use:enhance class="mt-1"><input type="hidden" name="operationId" value={action.id} /><button class="text-[var(--color-brass)]">Check completion</button></form>
						{/if}
					</li>
				{/each}
			</ul>
		</details>
	{/if}

	<!-- System health -->
	<div class="space-y-4">
		<div>
			<h2 class="font-display text-xl font-semibold">System Health</h2>
			<p class="text-xs text-[var(--color-text-secondary)]">Live process identity from /api/health</p>
		</div>
		<div class="rounded-xl border border-[var(--color-bg-tertiary)] bg-[var(--color-bg-secondary)] p-5">
			{#if data.health}
				<div class="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-[var(--color-text-secondary)] sm:grid-cols-5">
					<div><span class="smallcaps">Release</span> <span class="tabular-nums">{data.health.releaseId ?? '—'}</span></div>
					<div><span class="smallcaps">Commit</span> <span class="tabular-nums">{data.health.version.slice(0, 7)}</span></div>
					<div><span class="smallcaps">Node</span> <span class="tabular-nums">{data.health.node}</span></div>
					<div><span class="smallcaps">Uptime</span> <span class="tabular-nums">{fmtUptime(data.health.uptimeSeconds)}</span></div>
					<div><span class="smallcaps">Started</span> <span class="tabular-nums">{fmtDateTime(data.health.startedAt)}</span></div>
				</div>
			{:else}
				<p class="text-sm text-[var(--color-text-secondary)]">Health snapshot unavailable.</p>
			{/if}
		</div>
	</div>
</div>

<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import StudioPage from '$lib/components/console/StudioPage.svelte';
	import StudioPanel from '$lib/components/console/StudioPanel.svelte';
	import '$lib/components/admin/AdminDesk.css';
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
		const lastSeen = row.lastActiveDate ?? row.lastSignInAt?.slice(0, 10) ?? row.createdAt?.slice(0, 10);
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

<StudioPage eyebrow="Back office / Administration" title="Admin" description="People, libraries, and service health.">
	{#snippet actions()}<div class="admin-owner"><span>ADMIN ACCESS</span><small>Account & content management</small></div>{/snippet}
<div class="admin-desk">

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

	{#if data.totals}
		<div class="admin-totals" aria-label="Community overview">
			<div><span>Total users</span><strong>{data.totals.totalUsers}</strong><small>Registered accounts</small></div>
			<div><span>Signups this week</span><strong>{data.totals.signupsThisWeek}</strong><small>New to Mankunku</small></div>
			<div><span>Active this week</span><strong>{data.totals.activeThisWeek}</strong><small>Practiced or visited</small></div>
		</div>
	{/if}
	<div class="admin-layout">
	<div class="admin-users">
	<StudioPanel id="admin-users" number="01" title="Users" description="Signups, activity, and content — newest first">
		<div class="admin-filters">
			<label class="admin-search">Find a user<input type="search" bind:value={search} placeholder="Email or name" class="mt-1 block w-full min-w-48 rounded-lg bg-[var(--color-bg-secondary)] px-3 py-2 text-sm" /></label>
			<label class="text-xs">Show<select bind:value={filter} class="mt-1 block rounded-lg bg-[var(--color-bg-secondary)] px-3 py-2 text-sm"><option value="all">All users</option><option value="inactive">No activity in 30 days</option><option value="unconfirmed">Unconfirmed</option></select></label>
			<label class="text-xs">Joined on or before<input type="date" bind:value={joinedBefore} class="mt-1 block rounded-lg bg-[var(--color-bg-secondary)] px-3 py-2 text-sm" /></label>
		</div>
		<div class="admin-list-meta"><span>{visibleUsers.length} {visibleUsers.length === 1 ? 'user' : 'users'} shown</span><details><summary>About activity</summary><p>Days active counts distinct recorded dates with practice or a signed-in visit, including historical practice. Older visit-only days may be missing. Practice dates use local time and visit dates use UTC, so totals are approximate around midnight. Practice minutes are not time signed in.</p></details></div>

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
			<div class="admin-user-list">
				{#each visibleUsers as row (row.id)}
					<article class="admin-user" class:inspected={form?.inspectedUserId === row.id}>
						<div class="admin-identity">
							<span class="admin-avatar" aria-hidden="true">{(row.displayName || row.email || row.id).slice(0, 1).toUpperCase()}</span><span class="admin-user-name">{row.email ?? row.id}</span>
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
								<button class="admin-inspect">Inspect content <span aria-hidden="true">↗</span></button>
							</form>
						</div>

						<div class="admin-user-facts">
							<div><span class="smallcaps">Joined</span> <span class="tabular-nums">{fmtDate(row.createdAt)}</span></div>
							<div><span class="smallcaps">Last sign-in</span> <span class="tabular-nums">{fmtDate(row.lastSignInAt)}</span></div>
							<div><span class="smallcaps">Last active</span> <span class="tabular-nums">{fmtDate(row.lastActiveDate)}</span></div>
							<div><span class="smallcaps">Last sync</span> <span class="tabular-nums">{fmtDateTime(row.lastSyncAt)}</span></div>
							<div><span class="smallcaps">Days active</span> <span class="tabular-nums">{row.activeDayCount || '—'}</span></div>
							<div><span class="smallcaps" title="Practice time, not time signed in. Ear-training attempts are estimated at 30 seconds each.">Practice minutes</span> <span class="tabular-nums">{row.practiceMinutes}</span></div>
							<div><span class="smallcaps">Licks</span> <span class="tabular-nums">{row.lickCount}</span></div>
							<div><span class="smallcaps">Tunes</span> <span class="tabular-nums">{row.tuneCount}</span></div>
						</div>

						<details class="admin-devices">
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
					</article>
				{:else}
					<div class="px-5 py-8 text-center text-sm text-[var(--color-text-secondary)]">
						No matching users.
					</div>
				{/each}
			</div>
		{/if}
	</StudioPanel>
	</div>
	<aside class="admin-rail" aria-label="Service and activity">
	<!-- System health -->
	<StudioPanel id="admin-health" number="02" title="System Health" description="Current process snapshot">
		<div class="admin-health">
			{#if data.health}
				<div class="admin-health-facts">
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
	</StudioPanel>


	{#if data.audit.length > 0}
		<details class="admin-audit">
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
	{:else}<section class="admin-audit"><h2>Recent admin actions</h2><p>No recent actions recorded.</p></section>{/if}

	</aside>
	</div>
</div>
</StudioPage>

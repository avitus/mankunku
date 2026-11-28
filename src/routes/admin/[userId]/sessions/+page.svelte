<script lang="ts">
	import type { PageData } from './$types';
	import StudioPage from '$lib/components/console/StudioPage.svelte';
	import TakeReplay from '$lib/components/admin/TakeReplay.svelte';
	import { INSTRUMENTS } from '$lib/types/instruments';
	import '$lib/components/admin/AdminDesk.css';

	let { data }: { data: PageData } = $props();
	let mode = $state<'ear' | 'lick'>('ear');
	let openId = $state<string | null | undefined>(undefined);
	let openKey = $state('');
	function switchMode(next: 'ear' | 'lick') { mode = next; openId = undefined; openKey = ''; }
	function toggle(id: string, expanded: boolean) { openId = expanded ? null : id; openKey = ''; }
	const pct = (x: number | null) => x === null ? '—' : Math.round(x * 100) + '%';
	function date(ms: number) {
		const time = new Date(ms);
		return Number.isFinite(time.getTime()) ? time.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'Date unavailable';
	}
</script>

<svelte:head><title>Recent sessions — Mankunku Admin</title><meta name="robots" content="noindex" /></svelte:head>
<StudioPage eyebrow="Back office / Player progress" title="Recent sessions" description={data.name}>
	{#snippet actions()}<a class="review-link" href="/admin">← All players</a>{/snippet}
	<div class="review-desk">
		<div class="review-tools">
			<div class="review-modes" aria-label="Session type">
				<button aria-pressed={mode === 'ear'} onclick={() => switchMode('ear')}>Ear training <b>{data.ear.length}</b></button>
				<button aria-pressed={mode === 'lick'} onclick={() => switchMode('lick')}>Lick practice <b>{data.lick.length}</b></button>
			</div>
			<span>{data.instrument ? INSTRUMENTS[data.instrument].name : 'No instrument selected'}</span>
		</div>
		<p class="review-caption">Latest five synced sessions per activity · Newest first · Concert keys</p>

		{#if mode === 'ear'}
			{#each data.ear as s, i (s.id)}
				{@const expanded = openId === undefined ? i === 0 : openId === s.id}
				<section class="review-row">
					<button class="review-heading" aria-expanded={expanded} onclick={() => toggle(s.id, expanded)}>
						<strong>{pct(s.score)}</strong><span><b>{s.name}</b><small>{date(s.timestamp)}</small></span><i>{expanded ? '−' : '+'}</i>
					</button>
					{#if expanded}
						<div class="review-body">
							<p>Key {s.key} · {s.tempo} BPM · Difficulty {s.level}</p>
							<div class="practice-strip"><div><span>Pitch</span><strong>{pct(s.pitch)}</strong></div><div><span>Rhythm</span><strong>{pct(s.rhythm)}</strong></div><div><span>Notes hit</span><strong>{s.hit}<em> / {s.total}</em></strong></div></div>
							{#if s.noPitchedFrames}<p class="review-flag">Audio check detected no pitched sound during the target phrase.</p>{/if}
							{#if s.timing !== null}<p>Median timing offset · {s.timing === 0 ? 'On time' : Math.abs(s.timing) + ' ms ' + (s.timing < 0 ? 'early' : 'late')}</p>{/if}
							<TakeReplay userId={data.userId} take={s.id} phrase={s.phrase} instrument={data.instrument} tempo={s.tempo} swing={data.swing}/>
						</div>
					{/if}
				</section>
			{:else}<p class="review-empty">No synced ear-training takes.</p>{/each}
		{:else}
			{#each data.lick as s, i (s.id)}
				{@const expanded = openId === undefined ? i === 0 : openId === s.id}
				<section class="review-row">
					<button class="review-heading" aria-expanded={expanded} onclick={() => toggle(s.id, expanded)}>
						<strong>{s.licks.length ? s.passed + '/' + s.attempts : s.attempts}</strong><span><b>{s.licks[0]?.name ?? 'Lick practice'}{s.licks.length > 1 ? ' + ' + (s.licks.length - 1) + ' more' : ''}</b><small>{date(s.timestamp)} · {s.licks.length ? 'Keys passed' : 'Attempts'} · {s.minutes} min</small></span><i>{expanded ? '−' : '+'}</i>
					</button>
					{#if expanded}<div class="review-body">
						{#each s.licks as lick, li}
							<h3>{lick.name} <small>{lick.tempo ?? '—'} BPM</small></h3>
							{#each lick.keys as k, ki}
								{@const keyId = s.id + '/' + li + '/' + ki}
								<button class="review-key" aria-expanded={openKey === keyId} onclick={() => openKey = openKey === keyId ? '' : keyId}>
									<b>{k.key}</b> {pct(k.score)} · {k.passed ? 'Passed' : 'Missed'} <span>Pitch {pct(k.pitch)} · Rhythm {pct(k.rhythm)}　{openKey === keyId ? '−' : '+'}</span>
								</button>
								{#if openKey === keyId}<TakeReplay userId={data.userId} take={k.id} phrase={k.phrase} instrument={data.instrument} tempo={k.tempo ?? lick.tempo} swing={k.swing ?? data.swing}/>{/if}
							{/each}
						{:else}<p>Per-key details are unavailable for this workout.</p>{/each}
					</div>{/if}
				</section>
			{:else}<p class="review-empty">No synced lick-practice reports. Older reports can sync when the player returns on the device they used.</p>{/each}
		{/if}
	</div>
</StudioPage>

<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import MarkdownRenderer from '$lib/components/docs/MarkdownRenderer.svelte';
	import { MUSICALITY_AUDIT_DATE, MUSICALITY_AUDIT_REVISION, musicalityEvidenceUrl } from '$lib/musicality/manifest';
	import { filterMusicalityRequirements, STATUS_LABELS, INSTRUMENT_LABELS, type ImplementationStatus, type MusicalityInstrument } from '$lib/musicality/spec';
	import type { PageData } from '../../../routes/musicality/$types';

	let { data }: { data: PageData } = $props();
	let search = $state('');
	let instrument = $state<MusicalityInstrument | 'all'>('all');
	let status = $state<ImplementationStatus | 'all'>('all');
	let expanded = $state(new Set<string>());
	let fullSpecOpen = $state(false);
	const filtered = $derived(filterMusicalityRequirements(data.requirements, { search, instrument, status }));
	const deviceCounts = $derived.by(() => {
		const devices = data.requirements.filter((entry) => entry.kind === 'device');
		return Object.entries(STATUS_LABELS).filter(([key]) => key !== 'reference').map(([key, label]) => ({ key, label, count: devices.filter((entry) => entry.status === key).length }));
	});

	/** A linked requirement stays reachable even when earlier filters would hide it. */
	async function revealHash(hash: string): Promise<void> {
		if (hash.toLowerCase() === '#original-spec') {
			expanded = new Set();
			fullSpecOpen = true;
			await tick();
			document.getElementById('original-spec')?.scrollIntoView({ block: 'start' });
			return;
		}
		const id = hash.slice(1).toUpperCase();
		if (!data.requirements.some((entry) => entry.id === id)) return;
		search = ''; instrument = 'all'; status = 'all';
		fullSpecOpen = false;
		expanded = new Set([...expanded, id]);
		await tick();
		document.getElementById(id)?.scrollIntoView({ block: 'start' });
	}
	onMount(() => { void revealHash(window.location.hash); });
	afterNavigate(({ to }) => { if (to?.url.hash) void revealHash(to.url.hash); });

	/** Keep native details keyboard behavior while rendering expanded prose only on demand. */
	function toggleRequirement(id: string, open: boolean): void {
		const next = new Set(expanded);
		if (open) { next.add(id); fullSpecOpen = false; } else next.delete(id);
		expanded = next;
	}
	function clearFilters(): void { search = ''; instrument = 'all'; status = 'all'; }
</script>
<svelte:window onhashchange={(event) => void revealHash(new URL(event.newURL).hash)} />
<div class="ledger-wrap">
<p class="acceptance">Implementation is separate from musical acceptance. Listening review is still pending. <a href="/docs/architecture/musicality">Architecture & roadmap ↗</a> · <a href="#original-spec" onclick={() => void revealHash('#original-spec')}>Read the original specification</a></p>
	<div class="inventory" aria-label="Device implementation counts">
		<div class="inventory-total"><strong>202</strong><span>devices · 50 specification sections</span></div>
		{#each deviceCounts as item (item.key)}<div class="inventory-count"><strong>{item.count}</strong><span>{item.label}</span></div>{/each}
	</div>

	<section class="ledger" aria-labelledby="ledger-title">
		<div class="ledger-heading"><div><span class="eyebrow">The implementation ledger</span><h2 id="ledger-title">Find a musical idea.</h2></div><span class="ledger-hint">Open a row for the specification & evidence.</span></div>
		<div class="filters">
			<label class="search-field" for="musicality-search">Search the specification<input id="musicality-search" type="search" bind:value={search} placeholder="Charleston, silence, P3…" /></label>
			<label for="musicality-instrument">Instrument<select id="musicality-instrument" bind:value={instrument}><option value="all">All instruments</option>{#each Object.entries(INSTRUMENT_LABELS) as [value, label] (value)}<option {value}>{label}</option>{/each}</select></label>
			<label for="musicality-status">Implementation<select id="musicality-status" bind:value={status}><option value="all">All statuses</option>{#each Object.entries(STATUS_LABELS) as [value, label] (value)}<option {value}>{label}</option>{/each}</select></label>
		</div>
		<div class="result-line"><span role="status" aria-live="polite">{filtered.length} of {data.requirements.length} entries</span>{#if search || instrument !== 'all' || status !== 'all'}<button type="button" onclick={clearFilters}>Clear filters</button>{/if}</div>
		<div class="requirements">
			{#each filtered as entry (entry.id)}
				<details id={entry.id} data-requirement-id={entry.id} class:section-row={entry.kind === 'section'} open={expanded.has(entry.id)} ontoggle={(event) => toggleRequirement(entry.id, event.currentTarget.open)}>
					<summary><span class="entry-id">{entry.id}</span><span class="entry-title"><strong>{entry.title}</strong><small>{entry.kind === 'section' ? 'Specification section' : `${INSTRUMENT_LABELS[entry.instrument]} · ${entry.sectionTitle}`}</small></span><span class="status-label" data-status={entry.status}>{STATUS_LABELS[entry.status]}</span><span class="disclosure" aria-hidden="true">+</span></summary>
					{#if expanded.has(entry.id)}
						<div class="entry-body">
							<div class="assessment"><div><h3>Current behavior</h3><p>{entry.assessment}</p>{#if entry.remaining}<h3>{entry.status === 'reference' ? 'How to use this' : 'What remains'}</h3><p>{entry.remaining}</p>{/if}<p class="scope"><strong>Scope:</strong> {entry.scope}</p></div><aside aria-label={`${entry.id} evidence`}><h3>Evidence & validation</h3><p class="validation">Source inspected · listening not assessed</p><ul>{#each entry.evidence as evidence, index (`${evidence.kind}-${evidence.path}-${index}`)}<li><span>{evidence.kind === 'test' ? 'Test reference' : evidence.kind === 'listening' ? 'Historical listening' : 'Source'}{evidence.revision ? (/^[a-f0-9]{40}$/.test(evidence.revision) ? ` · commit ${evidence.revision.slice(0, 8)}` : ` · ${evidence.revision} branch`) : ' · baseline'}</span><a href={musicalityEvidenceUrl(evidence)} target="_blank" rel="noopener noreferrer">{evidence.label ?? evidence.path.split('/').at(-1)}{evidence.line ? `:${evidence.line}` : ''}</a></li>{/each}</ul><a class="permalink" href={`#${entry.id}`}>Link to {entry.id} <span aria-hidden="true">↗</span></a></aside></div>
							<div class="original-excerpt"><span class="eyebrow">From the original specification</span><MarkdownRenderer markdown={entry.markdown} slug="musicality/spec" /></div>
						</div>
					{/if}
				</details>
			{:else}
				<div class="empty-state"><h3>No matching musical ideas.</h3><p>Try a device ID, another term, or a broader filter.</p><button type="button" onclick={clearFilters}>Show all entries</button></div>
			{/each}
		</div>
	</section>

	<details class="full-spec" id="original-spec" bind:open={fullSpecOpen} ontoggle={(event) => { if (event.currentTarget.open) expanded = new Set(); }}>
		<summary><span><span class="eyebrow">The source document</span><strong>Read the complete original specification</strong></span><span aria-hidden="true">+</span></summary>
		{#if fullSpecOpen}<div class="full-spec-body"><p class="source-note">Preserved verbatim. Implementation claims live in the ledger above, so the target and the current behavior stay distinct.</p><MarkdownRenderer markdown={data.specification} slug="musicality/spec" /></div>{/if}
	</details>
<p class="build-line">Baseline audit {MUSICALITY_AUDIT_DATE} · {MUSICALITY_AUDIT_REVISION.slice(0,8)} · Running build <code data-testid="musicality-build">{data.buildVersion}</code></p>
</div>
<style>
.ledger-wrap { --rule: var(--color-bg-tertiary); --muted: var(--color-text-secondary); padding-top: 1.5rem; }
.eyebrow { font-family: monospace; font-size: .65rem; text-transform: uppercase; letter-spacing: .15em; color: var(--color-brass); }
.acceptance,.build-line {font-size:.75rem;line-height:1.7;color:var(--muted)} .acceptance a {color:var(--color-brass)} .build-line{margin-top:1.5rem;overflow-wrap:anywhere}
a{ text-underline-offset:.25em }
	.inventory { display: flex; justify-content: space-between; gap: 1.25rem; padding: 1.35rem 0 2.4rem; }
	.inventory strong { font-size: 1.45rem; font-weight: 500; font-variant-numeric: tabular-nums; }
	.inventory span { display: block; color: var(--muted); font-size: .68rem; margin-top: .1rem; }
	.inventory-total strong { color: var(--color-brass); }
	.ledger-heading { display: flex; align-items: end; justify-content: space-between; gap: 1rem; margin-bottom: 1.2rem; }
	.ledger-heading h2 { font-family: var(--font-display, Georgia, serif); font-size: 1.8rem; margin-top: .4rem; }
	.ledger-hint { color: var(--muted); font-size: .7rem; padding-bottom: .2rem; }
	.filters { display: grid; grid-template-columns: 1.7fr 1fr 1fr; gap: .8rem; }
	.filters label { font-size: .7rem; color: var(--muted); }
	.filters input, .filters select { display: block; width: 100%; margin-top: .4rem; min-height: 2.75rem; padding: .65rem .75rem; border: 1px solid var(--rule); border-radius: .3rem; background: var(--color-bg-secondary); color: var(--color-text); font: inherit; font-size: .8rem; }
	.filters input:focus-visible, .filters select:focus-visible, summary:focus-visible, a:focus-visible, button:focus-visible { outline: 2px solid var(--color-brass); outline-offset: 3px; }
	.result-line { display: flex; justify-content: space-between; align-items: center; min-height: 2.8rem; font-size: .7rem; color: var(--muted); }
	button { text-decoration: underline; text-underline-offset: .25em; cursor: pointer; min-height: 2.5rem; }
	.requirements { border-top: 1px solid var(--rule); }
	.requirements details { border-bottom: 1px solid var(--rule); scroll-margin-top: 1rem; }
	.requirements details:target { box-shadow: inset 3px 0 var(--color-brass); }
	summary { cursor: pointer; list-style: none; }
	summary::-webkit-details-marker { display: none; }
	.requirements summary { display: grid; grid-template-columns: 2.7rem 1fr auto 1rem; align-items: center; gap: .7rem; padding: 1rem .5rem; }
	.section-row summary { background: color-mix(in srgb, var(--color-bg-secondary) 70%, transparent); }
	.entry-id { color: var(--color-brass); font-family: monospace; font-size: .72rem; }
	.entry-title strong { display: block; font-size: .88rem; font-weight: 500; }
	.entry-title small { display: block; font-size: .64rem; color: var(--muted); margin-top: .2rem; }
	.status-label { font-size: .65rem; color: var(--muted); white-space: nowrap; }
	.status-label[data-status="implemented"] { color: var(--color-brass); }
	.status-label[data-status="partial"] { color: var(--color-text); }
	.disclosure { font-weight: 300; color: var(--muted); }
	details[open] > summary .disclosure { transform: rotate(45deg); }
	.entry-body { padding: .6rem 1rem 1.5rem 3.9rem; }
	.assessment { display: grid; grid-template-columns: 1.7fr 1fr; gap: 2rem; }
	.assessment h3 { font-size: .67rem; text-transform: uppercase; letter-spacing: .07em; margin-bottom: .4rem; }
	.assessment p { font-size: .8rem; line-height: 1.7; color: var(--muted); margin-bottom: 1rem; }
	.assessment .scope { font-size: .7rem; }
	.assessment .validation { font-size: .68rem; }
	.assessment ul { list-style: none; margin: 0 0 1rem; padding: 0; }
	.assessment li { margin-bottom: .65rem; overflow-wrap: anywhere; }
	.assessment li span { display: block; text-transform: uppercase; font-size: .58rem; color: var(--muted); letter-spacing: .05em; }
	.assessment li a, .permalink { font-size: .7rem; text-decoration: underline; }
	.original-excerpt { margin-top: .5rem; padding-top: 1.2rem; border-top: 1px solid var(--rule); }
	.original-excerpt :global(.prose-docs) { font-size: .85rem; margin-top: .6rem; }
	.original-excerpt :global(h1), .original-excerpt :global(h2), .original-excerpt :global(h3) { font-size: 1.1rem; }
	.empty-state { padding: 3rem 1rem; text-align: center; }
	.empty-state h3 { font-family: var(--font-display, Georgia, serif); font-size: 1.5rem; }
	.empty-state p, .empty-state button { font-size: .8rem; color: var(--muted); margin-top: .5rem; }
	.full-spec { margin-top: 2.5rem; border-top: 1px solid var(--color-brass); border-bottom: 1px solid var(--rule); scroll-margin-top: 1rem; }
	.full-spec summary { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 1.3rem 0; }
	.full-spec summary strong { display: block; margin-top: .4rem; font-family: var(--font-display, Georgia, serif); font-size: 1.4rem; font-weight: 500; }
	.full-spec-body { padding: 1rem 0 2rem; }
	.source-note { font-size: .8rem; color: var(--muted); margin-bottom: 1.5rem; }	@media (max-width: 640px) {
		.inventory { flex-wrap: wrap; gap: 1.2rem; }
		.inventory-total { width: 100%; }
		.ledger-heading { display: block; }
		.ledger-hint { display: block; margin-top: .5rem; }
		.filters { grid-template-columns: 1fr 1fr; }
		.search-field { grid-column: 1 / -1; }
		.requirements summary { grid-template-columns: 2.2rem 1fr 1rem; gap: .4rem; padding: .9rem .25rem; }
		.status-label { grid-column: 2; grid-row: 2; }
		.disclosure { grid-column: 3; grid-row: 1 / 3; }
		.entry-body { padding: .5rem .75rem 1.5rem; }
		.assessment { grid-template-columns: 1fr; gap: .5rem; }
		.assessment aside { border-left: 1px solid var(--rule); padding-left: .8rem; margin-bottom: .8rem; }
	}
</style>

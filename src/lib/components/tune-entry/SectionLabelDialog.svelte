<script lang="ts">
	import { tick } from 'svelte';
	import { buildDraftTune, changeSectionLabel, setSectionSoloOmission, tuneEntry } from '$lib/state/tune-entry.svelte';
	import { sectionLabels } from '$lib/tunes/section-labels';
	import { resolvePickupLength } from '$lib/music/pickup';
	let dialog: HTMLDialogElement;
	let input: HTMLInputElement;
	let from = $state<number | null>(null);
	let label = $state('');
	let bar = $state(1);
	let omit = $state(false);
	let initialOmit = false;
	let error = $state('');
	const pickup = $derived(resolvePickupLength(buildDraftTune(), 0) ? 1 : 0);
	const total = $derived(tuneEntry.sections.reduce((n, s) => n + s.bars, 0));
	export async function open(index: number | null, absoluteBar = 0) {
		const marks = sectionLabels(buildDraftTune());
		const mark = marks.find(m => m.sectionIdx === index);
		from = index;
		label = mark?.label ?? Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)).find(l => !marks.some(m => m.label === l)) ?? 'Section';
		bar = (mark?.bar ?? absoluteBar) + 1 - pickup;
		let base = 0;
		const anchored = index === null ? tuneEntry.sections.find(s => { base += s.bars; return absoluteBar < base; }) : tuneEntry.sections[index];
		omit = initialOmit = !!anchored?.omitFromSolos;
		error = '';
		dialog.showModal();
		await tick();
		input.focus(); input.select();
	}
	function save(event: SubmitEvent) {
		event.preventDefault();
		const destination = bar - 1 + pickup;
		if (!changeSectionLabel(from, destination, label)) { error = 'Choose an unoccupied bar and a label without brackets or line breaks.'; return; }
		const mark = sectionLabels(buildDraftTune()).find(m => m.bar === destination);
		if (mark && omit !== initialOmit) setSectionSoloOmission(mark.sectionIdx, omit);
		dialog.close();
	}
</script>

<dialog bind:this={dialog} class="le-dialog te-label-dialog" aria-labelledby="section-label-heading">
	<form onsubmit={save}>
		<header><div><p class="studio-label">Rehearsal mark</p><h2 id="section-label-heading">{from === null ? 'Add section label' : 'Edit section label'}</h2></div><button type="button" aria-label="Close section label" onclick={() => dialog.close()}>×</button></header>
		<div class="label-fields">
			<label>Label<input bind:this={input} bind:value={label} maxlength="80" required /></label>
			<label>Starts at bar<input type="number" bind:value={bar} min={1 - pickup} max={total - pickup} step="1" required /></label>
			<label class="solo-option"><input type="checkbox" bind:checked={omit} />Omit from solos</label>
			<p>Skip this section during solos; keep it in the opening and closing melody.</p>
			<p>Move or remove the label without deleting music. Repeat signs and endings stay on their bars.</p>
			{#if error}<p role="alert">{error}</p>{/if}
		</div>
		<div class="le-dialog-actions">
			{#if from !== null}<button type="button" class="le-button le-quiet" onclick={() => { changeSectionLabel(from, null); dialog.close(); }}>Remove label</button>{/if}
			<button type="button" class="le-button le-quiet" onclick={() => dialog.close()}>Cancel</button>
			<button type="submit" class="le-button le-save">Apply label</button>
		</div>
	</form>
</dialog>

<style>
	.label-fields { display: grid; gap: 16px; padding: 24px; }
	.label-fields label { display: grid; gap: 6px; font-size: 13px; }
	.label-fields input:not([type='checkbox']) { padding: 10px; border: 1px solid var(--color-bg-tertiary); border-radius: 4px; background: var(--color-bg-secondary); }
	.label-fields .solo-option { display: flex; align-items: center; gap: 10px; }
	.label-fields p { color: var(--color-text-secondary); font-size: 12px; margin: 0; }
	.label-fields [role='alert'] { color: var(--color-error-text); }
</style>

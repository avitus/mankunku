<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { savedTuneDisplay, saveTuneDisplay } from '$lib/tunes/preferences';
	import { tooltips } from '$lib/content/tooltips';
	import './tune-session-options.css';

	let { hasMelody, choruses, playHead, onchoruses, onhead, disabled = false,
		practice = false, summaryPrefix = '', children }: {
		hasMelody: boolean; choruses: number; playHead: boolean;
		onchoruses: (value: number) => void; onhead: (value: boolean) => void;
		disabled?: boolean; practice?: boolean; summaryPrefix?: string; children?: Snippet;
	} = $props();
	let expanded = $state(false);
	const preference = $derived(practice ? 'practice-options-open' : 'options-open');
	const inputId = $derived(practice ? 'practice-solo-choruses' : 'tune-solo-choruses');
	const head = $derived(hasMelody && playHead);
	onMount(() => { expanded = savedTuneDisplay(preference, false); });

	/** Show the normalized count even when a boundary edit leaves state unchanged. */
	function changeChoruses(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		onchoruses(input.valueAsNumber);
		input.value = String(choruses);
	}
</script>

<details class="so-panel" class:tp-options={practice} class:td-session-options={!practice} bind:open={expanded} ontoggle={event => saveTuneDisplay(preference, event.currentTarget.open)}>
	<summary class="so-disclosure">
		<span class="so-heading"><span class="so-kicker">Make it your session</span><strong>Session options</strong></span>
		<span class="so-summary">{summaryPrefix ? `${summaryPrefix} · ` : ''}{choruses} solo{choruses === 1 ? '' : 's'}<span class="so-chevron" aria-hidden="true">⌄</span></span>
	</summary>
	<fieldset {disabled} class="so-body">
		<legend class="sr-only">Session options</legend>
		<div class="so-section-label"><h3>The form</h3><span>One continuous take</span></div>
		<div class="so-form" class:so-solos-only={!head} aria-label="Session form">
			{#if head}<div class="so-head"><span class="so-stage">01 / In</span><strong>Head</strong><small>Play the melody</small></div><span class="so-arrow" aria-hidden="true">→</span>{/if}
			<div class="so-solos">
				<label for={inputId}>Solo choruses</label>
				<div class="so-stepper"><button type="button" aria-label="Fewer solo choruses" disabled={choruses <= 1} onclick={() => onchoruses(choruses - 1)}>−</button><input id={inputId} type="number" min="1" max="12" step="1" value={choruses} onchange={changeChoruses} /><button type="button" aria-label="More solo choruses" disabled={choruses >= 12} onclick={() => onchoruses(choruses + 1)}>+</button></div>
				<small>The changes are yours</small>
			</div>
			{#if head}<span class="so-arrow" aria-hidden="true">→</span><div class="so-head"><span class="so-stage">03 / Out</span><strong>Head again</strong><small>Back to the melody</small></div>{/if}
		</div>
		<div class="so-form-footer"><button type="button" role="switch" aria-label="Play head and outro" aria-checked={head} disabled={!hasMelody} title={hasMelody ? tooltips.tunePractice.head.text : tooltips.tunePractice.headNoMelody.text} class="so-switch-row" onclick={() => onhead(!playHead)}><span class="so-switch" class:on={head} aria-hidden="true"><i></i></span>Head & outro</button><span>Settings remembered for next time</span></div>
		{#if !hasMelody}<p class="so-note so-no-melody">This chart has no melody — straight to the changes.</p>{/if}
		{@render children?.()}
	</fieldset>
</details>

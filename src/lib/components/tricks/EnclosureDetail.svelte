<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import EnclosurePhraseCanvas from './EnclosurePhraseCanvas.svelte';
	import EnclosureMasteryMap from './EnclosureMasteryMap.svelte';
	import LickProgressChart from '$lib/components/licks/LickProgressChart.svelte';
	import { getTrickById, trickContextFor, trickPracticeBed, trickEntryKey } from '$lib/tricks';
	import { getVariantsForTrick, getVariantByKey, getUnlockedVariants, loadTrickUnlockContext, totalVariantPasses } from '$lib/tricks/mastery';
	import { trickVariantKey, type TrickParameters } from '$lib/types/tricks';
	import { getTrickProgressHistory } from '$lib/persistence/trick-practice-store';
	import { isVariantSelected, toggleVariantSelected } from '$lib/state/tricks.svelte';
	import { lickPractice } from '$lib/state/lick-practice.svelte';
	import { getInstrument } from '$lib/state/settings.svelte';
	import { createTrickAudition } from '$lib/state/trick-audition.svelte';

	const trick = getTrickById('enclosures')!;
	let parameters = $state<TrickParameters>({ ...getVariantsForTrick('enclosures')[0].params });
	let version = $state(0);
	const audition = createTrickAudition();
	const context = $derived(trickContextFor(trick, parameters, trickEntryKey(getInstrument()), 90));
	const bed = $derived(trickPracticeBed(trick, parameters));
	const key = $derived(trickVariantKey(trick.id, parameters));
	const selected = $derived(getVariantByKey(key));
	const familyVariants = $derived(getVariantsForTrick(trick.id).filter(v => v.params.type === parameters.type));
	const unlockContext = $derived.by(() => { void version; return loadTrickUnlockContext(); });
	const unlocked = $derived(new Set(getUnlockedVariants(trick.id, unlockContext).map(v => v.key)));
	const ready = $derived(!!selected && unlocked.has(key));
	const history = $derived.by(() => { void version; return selected ? getTrickProgressHistory(key) : []; });
	const status = $derived(selected ? ready ? 'Ready to practice' : 'Locked · preview' : 'Exploration');
	const prerequisites = $derived(selected?.prerequisites.flatMap(clause => clause.variants.map(prerequisite => {
		const index = familyVariants.findIndex(v => v.key === prerequisite) + 1;
		return `Step ${index}: ${totalVariantPasses(unlockContext.progress, prerequisite)}/${clause.passes} passes`;
	})).join(' + ') ?? '');

	/** Editing keeps locked combinations previewable without granting practice credit. */
	function updateParameters(next: TrickParameters): void {
		void audition.stop();
		parameters = { ...next };
	}

	/** The graph and the canvas edit one selection. */
	function selectVariant(variantKey: string): void {
		const variant = getVariantByKey(variantKey);
		if (variant) updateParameters(variant.params);
	}

	/** Open setup with this family and gesture, clearing a previously chosen progression. */
	function practice(): void {
		if (!ready) return;
		void audition.stop();
		Object.assign(lickPractice.config, {
			sessionType: 'trick', trickId: trick.id, trickParameters: { ...parameters },
			trickProgressionType: undefined
		});
		void goto('/lick-practice');
	}

	/** Preserve the existing tune-suggestion opt-in for unlocked mastery variants. */
	function toggleSuggestion(): void {
		if (!ready) return;
		toggleVariantSelected(key);
		version++;
	}

	onMount(() => { version++; });
	onDestroy(audition.dispose);
</script>

<div class="enclosure-detail">
	<h1>Enclosures</h1>
	<EnclosurePhraseCanvas {parameters} onchange={updateParameters} {context} progressionType={bed}
		{status} statusKind={selected ? ready ? 'ready' : 'locked' : 'exploration'}
		onhear={phrase => audition.play(phrase, context.tempo)} hearing={audition.state.playing}
		onpreviewchange={() => { void audition.stop(); }} />
	{#if audition.state.error}<p class="audio-error" role="alert">{audition.state.error}</p>{/if}
	<div class="selection">
		<div>
			<strong>{selected ? `${String(familyVariants.findIndex(v => v.key === key) + 1).padStart(2, '0')} · ${selected.label.replace(/ — (major|minor|dominant)$/, '')}` : 'Explore this enclosure'}</strong>
			<p>{selected ? ready ? `${totalVariantPasses(unlockContext.progress, key)} passes` : `${prerequisites} required` : 'Choose a mastery step to practice this chord family.'}</p>
		</div>
		<button type="button" class="practice" disabled={!ready} onclick={practice}>Practice this enclosure →</button>
	</div>
	<section class="mastery" aria-labelledby="enclosure-mastery-heading">
		<div class="section-heading"><h2 id="enclosure-mastery-heading">Mastery path</h2>
			{#if ready}<button class="suggestion" type="button" aria-pressed={isVariantSelected(key)} onclick={toggleSuggestion}>{isVariantSelected(key) ? '★ Suggest in tunes' : '☆ Suggest in tunes'}</button>{/if}
		</div>
		<EnclosureMasteryMap family={parameters.type} {context} selectedKey={selected?.key} onselect={selectVariant} {version} />
	</section>
	{#if history.length > 0}
		<section class="history"><h2>Your progress</h2><LickProgressChart points={history} /></section>
	{/if}
</div>

<style>
	.enclosure-detail { display: grid; gap: 22px; }
	h1 { font-family: var(--font-display); font-size: clamp(32px, 4vw, 42px); font-weight: 500; letter-spacing: -.025em; line-height: 1.15; }
	h2 { font-family: var(--font-display); font-size: 25px; font-weight: 500; }
	.selection { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 14px; }
	.selection strong { font-size: 14px; font-weight: 500; }
	.selection p { font-size: 12px; color: var(--color-text-secondary); margin-top: 4px; }
	.practice { background: var(--color-accent); color: white; border-radius: 7px; padding: 11px 16px; font-size: 13px; font-weight: 500; min-height: 44px; cursor: pointer; }
	.practice:disabled { background: var(--color-bg-tertiary); color: var(--color-text-secondary); cursor: default; }
	.mastery { border-top: 1px solid var(--color-bg-tertiary); padding-top: 24px; margin-top: 6px; }
	.section-heading { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 20px; flex-wrap: wrap; }
	.suggestion { font-size: 12px; color: var(--color-text-secondary); min-height: 44px; cursor: pointer; }
	.suggestion[aria-pressed='true'] { color: var(--color-success); }
	.history { border-top: 1px solid var(--color-bg-tertiary); padding-top: 20px; }
	.history h2 { margin-bottom: 12px; }
	.audio-error { font-size: 13px; color: var(--color-error-text); }
	@media (max-width: 430px) { .practice { width: 100%; } }
</style>

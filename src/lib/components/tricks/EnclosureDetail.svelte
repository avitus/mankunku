<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import EnclosurePhraseCanvas from './EnclosurePhraseCanvas.svelte';
	import EnclosureMasteryMap from './EnclosureMasteryMap.svelte';
	import StudioPage from '$lib/components/console/StudioPage.svelte';
	import StudioPanel from '$lib/components/console/StudioPanel.svelte';
	import TrickProgress from './TrickProgress.svelte';
	import './tricks.css';
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

<div class="tricks-desk">
	<StudioPage eyebrow="Vocabulary / Melodic devices" title="Enclosures" description="Shape the approach. Hear the tension resolve. Make every chord tone an arrival.">
		{#snippet actions()}<a class="trick-back" href="/tricks">← All tricks</a>{/snippet}
		<div class="trick-layout">
			<div class="trick-main">
				<StudioPanel id="enclosure-shape" number="01" title="Shape the approach" description="Change the approach, target and landing directly in the phrase." domain="lick-practice">
					<EnclosurePhraseCanvas {parameters} onchange={updateParameters} {context} progressionType={bed}
						{status} statusKind={selected ? ready ? 'ready' : 'locked' : 'exploration'}
						onhear={phrase => audition.play(phrase, context.tempo)} hearing={audition.state.playing}
						onpreviewchange={() => { void audition.stop(); }} />
					{#if audition.state.error}<p class="trick-audio-error" role="alert">{audition.state.error}</p>{/if}
				</StudioPanel>
				<StudioPanel id="enclosure-mastery" number="02" title="Mastery path" description="Each chord family has its own path. Complete three passes to unlock the connected steps." domain="lick-practice">
					<EnclosureMasteryMap family={parameters.type} {context} selectedKey={selected?.key} onselect={selectVariant} {version} />
					{#if selected}<TrickProgress points={history} />{/if}
				</StudioPanel>
			</div>
			<aside class="trick-summary" aria-label="Your practice">
				<StudioPanel id="enclosure-practice" number="→" title="Your practice" description="Next session" domain="lick-practice">
					<p class="trick-status" data-ready={ready}>{status}</p>
					<p class="trick-selection">{selected ? `${String(familyVariants.findIndex(v => v.key === key) + 1).padStart(2, '0')} · ${selected.label.replace(/ — (major|minor|dominant)$/, '')}` : 'Explore this enclosure'}</p>
					{#if selected}<div class="trick-passes"><span>Total passes</span><strong>{totalVariantPasses(unlockContext.progress, key)}</strong></div>{/if}
					<p class="trick-hint">{selected ? ready ? 'Choose your band, tempo and practice mode in Lick Practice.' : `${prerequisites} required to unlock this step.` : 'Choose a mastery step to practice this chord family.'}</p>
					<button type="button" class="studio-action" disabled={!ready} onclick={practice}>Practice this enclosure →</button>
					{#if ready}<button class="trick-suggestion" type="button" aria-pressed={isVariantSelected(key)} onclick={toggleSuggestion}>{isVariantSelected(key) ? '★ Suggest in tunes' : '☆ Suggest in tunes'}</button>{/if}
				</StudioPanel>
			</aside>
		</div>
	</StudioPage>
</div>

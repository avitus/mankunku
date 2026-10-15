<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import StudioPage from '$lib/components/console/StudioPage.svelte';
	import StudioPanel from '$lib/components/console/StudioPanel.svelte';
	import NotationDisplay from '$lib/components/notation/NotationDisplay.svelte';
	import TrickPairSelector from './TrickPairSelector.svelte';
	import TrickMasteryTree from './TrickMasteryTree.svelte';
	import TrickProgress from './TrickProgress.svelte';
	import { getTrickById, trickContextFor } from '$lib/tricks';
	import { getTriadPairFamily } from '$lib/tricks/devices/triad-pairs';
	import { getVariantsForTrick, getUnlockedVariants, loadTrickUnlockContext, totalVariantPasses } from '$lib/tricks/mastery';
	import { isVariantSelected, toggleVariantSelected } from '$lib/state/tricks.svelte';
	import { getTrickProgressHistory } from '$lib/persistence/trick-practice-store';
	import { PITCH_CLASSES, type PitchClass } from '$lib/types/music';
	import { concertKeyToWritten, writtenKeyToConcert } from '$lib/music/transposition';
	import { getInstrument } from '$lib/state/settings.svelte';
	import { lickPractice } from '$lib/state/lick-practice.svelte';
	import { createTrickAudition } from '$lib/state/trick-audition.svelte';
	import './tricks.css';

	const trick = getTrickById('triad-pairs')!;
	const variants = getVariantsForTrick(trick.id);
	let selectedKey = $state(variants[0].key);
	let version = $state(0);
	const unlockContext = $derived.by(() => { void version; return loadTrickUnlockContext(); });
	const unlocked = $derived(getUnlockedVariants(trick.id, unlockContext));
	const selected = $derived(variants.find(v => v.key === selectedKey) ?? variants[0]);
	const ready = $derived(unlocked.some(v => v.key === selected.key));
	const family = $derived(getTriadPairFamily(selected.params.pair));
	// Written preview pitch changes the example only; setup owns the drill key.
	let selectedWrittenKey = $state<PitchClass | null>(null);
	const writtenKey = $derived(selectedWrittenKey ?? concertKeyToWritten('C', getInstrument()));
	const context = $derived(trickContextFor(trick, selected.params, writtenKeyToConcert(writtenKey, getInstrument()), 120));
	const example = $derived(trick.generateExample(selected.params, context));
	const history = $derived.by(() => { void version; return getTrickProgressHistory(selected.key); });
	const audition = createTrickAudition();
	// Cancel old audio when the family, written key, or instrument changes.
	$effect(() => { void example; untrack(() => { void audition.stop(); }); });
	onMount(() => { version++; });
	onDestroy(audition.dispose);

	/** Selects the unlocked variant for the chosen pair family; a locked or unknown pair is ignored. */
	function selectPair(value: string): void {
		const next = unlocked.find(v => v.params.pair === value);
		if (next) selectedKey = next.key;
	}
	/**
	 * Starts a trick practice session for the selected variant: stops any audition, points the
	 * lick-practice config at this trick and its parameters (clearing any progression override),
	 * and navigates to /lick-practice. Does nothing while the variant is still locked.
	 */
	function practice(): void {
		if (!ready) return;
		void audition.stop();
		Object.assign(lickPractice.config, { sessionType: 'trick', trickId: trick.id,
			trickParameters: { ...selected.params }, trickProgressionType: undefined });
		void goto('/lick-practice');
	}
	/** Stars or unstars the selected variant as a tune-practice suggestion and bumps `version` so the view re-reads. No-op while locked. */
	function toggleSuggestion(): void {
		if (!ready) return;
		toggleVariantSelected(selected.key); version++;
	}
</script>

<div class="tricks-desk">
	<StudioPage eyebrow="Vocabulary / Melodic devices" title="Triad Pairs" description="Two triads. Six notes. Find a new way through the harmony.">
		{#snippet actions()}<a class="trick-back" href="/tricks">← All tricks</a>{/snippet}
		<div class="trick-layout">
			<div class="trick-main">
				<StudioPanel id="triad-shape" number="01" title="Find the shape" description="Choose a pair family, then hear how the two triads connect." domain="lick-practice">
					<TrickPairSelector value={selected.params.pair} unlockedValues={unlocked.map(v => v.params.pair)} onchange={selectPair} />
					<p class="trick-formula">{family ? `Alternate ${family.description}, leading with the lower triad — ${family.application}.` : trick.description}</p>
					<div class="studio-well trick-score">
						<div class="trick-toolbar"><span class="studio-label">The example</span><div>
							<label class="trick-key">Preview key <select value={writtenKey} onchange={event => { selectedWrittenKey = event.currentTarget.value as PitchClass; }}>
								{#each PITCH_CLASSES as key}<option value={key}>{key}</option>{/each}
							</select></label>
							<button type="button" class="studio-action" disabled={!example} onclick={() => { if (example) void audition.play(example, context.tempo); }}>{audition.state.playing ? 'Stop' : '▷ Hear'}</button>
						</div></div>
						{#if example}<NotationDisplay phrase={example} instrument={getInstrument()} frameless />{:else}<p class="trick-hint">No example available in this key.</p>{/if}
						<p class="trick-hint">Written pitch for your instrument. The preview key does not change your drill.</p>
					</div>
					{#if audition.state.error}<p class="trick-audio-error" role="alert">{audition.state.error}</p>{/if}
					<ul class="trick-ways" aria-label="Ways to play"><li>Demo cell</li><li>Alternating triplets</li><li>Four eighths per triad</li></ul>
					<p class="trick-hint">All three ways of playing count in practice.</p>
				</StudioPanel>
				<StudioPanel id="triad-mastery" number="02" title="Mastery path" description="Complete three passes of a pair to open the next family." domain="lick-practice">
					<TrickMasteryTree trickId={trick.id} selectedKey={selected.key} onSelect={key => { if (unlocked.some(v => v.key === key)) selectedKey = key; }} {version} />
					<TrickProgress points={history} />
				</StudioPanel>
			</div>
			<aside class="trick-summary" aria-label="Your practice">
				<StudioPanel id="triad-practice" number="→" title="Your practice" description="Next session" domain="lick-practice">
					<p class="trick-status" data-ready={ready}>{ready ? 'Ready to practice' : 'Locked'}</p>
					<p class="trick-selection">{selected.label}</p>
					<div class="trick-passes"><span>Total passes</span><strong>{totalVariantPasses(unlockContext.progress, selected.key)}</strong></div>
					<p class="trick-hint">Choose your band, tempo and practice mode in Lick Practice.</p>
					<button type="button" class="studio-action" disabled={!ready} onclick={practice}>Practice this variant →</button>
					<button type="button" class="trick-suggestion" aria-pressed={isVariantSelected(selected.key)} onclick={toggleSuggestion}>{isVariantSelected(selected.key) ? '★' : '☆'} Suggest in tunes</button>
				</StudioPanel>
			</aside>
		</div>
	</StudioPage>
</div>

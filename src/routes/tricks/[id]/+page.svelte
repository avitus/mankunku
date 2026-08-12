<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import NotationDisplay from '$lib/components/notation/NotationDisplay.svelte';
	import LickProgressChart from '$lib/components/licks/LickProgressChart.svelte';
	import TrickMasteryTree from '$lib/components/tricks/TrickMasteryTree.svelte';
	import { getTrickById } from '$lib/tricks';
	import { getTriadPairFamily } from '$lib/tricks/devices/triad-pairs';
	import {
		getVariantsForTrick,
		getUnlockedVariants,
		loadTrickUnlockContext
	} from '$lib/tricks/mastery';
	import { isVariantSelected, toggleVariantSelected } from '$lib/state/tricks.svelte';
	import { getTrickProgressHistory } from '$lib/persistence/trick-practice-store';
	import { trickVariantKey } from '$lib/types/tricks';
	import type { Trick, TrickContext, TrickParameters } from '$lib/types/tricks';
	import { PITCH_CLASSES, CATEGORY_LABELS, type PitchClass } from '$lib/types/music';
	import { concertKeyToWritten, writtenKeyToConcert } from '$lib/music/transposition';
	import { getInstrument } from '$lib/state/settings.svelte';
	import { lickPractice } from '$lib/state/lick-practice.svelte';
	import { PROGRESSION_TEMPLATES } from '$lib/data/progressions';

	const trick = $derived(getTrickById(page.params.id ?? ''));

	/**
	 * Bumped after any practice-state mutation made from this page so the
	 * storage-backed deriveds (unlock context, progress history, mastery tree)
	 * re-read — plain localStorage reads aren't reactive on their own.
	 */
	let version = $state(0);

	const variants = $derived(trick ? getVariantsForTrick(trick.id) : []);

	// Unlock context re-read on every version bump. SSR-safe: storage.load
	// returns null on the server, so prerequisites evaluate against empty
	// progress (base variants only) until the client hydrates.
	const unlockCtx = $derived.by(() => {
		void version;
		return loadTrickUnlockContext();
	});
	const unlockedKeys = $derived(
		new Set(trick ? getUnlockedVariants(trick.id, unlockCtx).map((v) => v.key) : [])
	);

	/**
	 * Selected variant, defaulting to the first unlocked variant whenever the
	 * trick changes (client-side nav between tricks reuses this component).
	 * Every ladder's first rung has no prerequisites, so there is always at
	 * least one unlocked variant for a known trick.
	 */
	let selectedVariantKey: string | null = $state(null);
	$effect(() => {
		if (!trick) {
			selectedVariantKey = null;
			return;
		}
		const unlocked = getUnlockedVariants(trick.id, loadTrickUnlockContext());
		selectedVariantKey = unlocked[0]?.key ?? getVariantsForTrick(trick.id)[0]?.key ?? null;
	});

	const selectedVariant = $derived(variants.find((v) => v.key === selectedVariantKey) ?? null);

	/**
	 * Key selector state is in WRITTEN pitch (what the user sees on their
	 * instrument's sheet music), converted to concert at the example-context
	 * boundary. Defaults to concert C shown in the instrument's written pitch.
	 */
	let selectedWrittenKey: PitchClass | null = $state(null);
	const writtenKey = $derived(selectedWrittenKey ?? concertKeyToWritten('C', getInstrument()));
	const concertKey = $derived(writtenKeyToConcert(writtenKey, getInstrument()));

	// Example context derived from the variant's own practice bed (the same
	// lookup startTrickSession uses), so a minor-type enclosure previews over
	// min7/dorian and an altered triad pair over its dominant vamp — all
	// realized at the chosen concert key (scaleIds are rooted at chordRoot).
	const exampleContext = $derived.by<TrickContext>(() => {
		const bedType = (trick && selectedVariant && trick.practiceBed?.(selectedVariant.params)) ?? 'major-vamp';
		const bed = PROGRESSION_TEMPLATES[bedType].harmony[0];
		return {
			chordRoot: concertKey,
			chordQuality: bed.chord.quality,
			scaleId: bed.scaleId,
			key: concertKey,
			timeSignature: [4, 4],
			level: 50,
			tempo: 120,
			swing: 0.5
		};
	});

	const example = $derived.by(() => {
		if (!trick || !selectedVariant) return null;
		return trick.generateExample(selectedVariant.params, exampleContext);
	});

	// Per-variant BPM / keys-unlocked time series for the progress graph.
	// TrickProgressPoint is structurally identical to LickProgressPoint, so
	// the lick chart renders it unchanged.
	const progressPoints = $derived.by(() => {
		void version;
		if (!trick || !selectedVariant) return [];
		return getTrickProgressHistory(trickVariantKey(trick.id, selectedVariant.params));
	});

	const TONE_NAMES: Record<string, string> = {
		root: 'root',
		third: '3rd',
		fifth: '5th',
		seventh: '7th'
	};

	/** One-sentence human description of what the selected variant asks for. */
	function describeVariant(t: Trick, params: TrickParameters): string {
		if (t.id === 'enclosures') {
			const target = TONE_NAMES[params.targetTone ?? ''] ?? '3rd';
			const landing =
				params.beatPlacement === 'offbeat' ? 'landing off the beat' : 'landing on the downbeat';
			const three = params.noteCount === '3';
			const shapeText: Record<string, string> = {
				'chromatic-below': `Approach the ${target} chromatically from below`,
				'scale-above': `Step down to the ${target} from the scale tone above`,
				'above-below': three
					? `Approach the ${target} twice from above (scale), then once from below (chromatic)`
					: `Approach the ${target} from above (scale) then below (chromatic)`,
				'below-above': three
					? `Approach the ${target} twice from below (chromatic), then once from above (scale)`
					: `Approach the ${target} from below (chromatic) then above (scale)`,
				'double-chromatic': three
					? `Scale tone above, then two chromatic steps from below into the ${target}`
					: `Two chromatic steps from below into the ${target}`
			};
			const body = shapeText[params.shape ?? ''] ?? `Enclose the ${target} with neighbour tones`;
			const chordType: Record<string, string> = {
				major: 'a major chord',
				minor: 'a minor chord',
				dominant: 'a dominant chord'
			};
			const over = chordType[params.type ?? ''] ?? 'a major chord';
			return `${body}, ${landing}, over ${over}.`;
		}
		if (t.id === 'triad-pairs') {
			const family = getTriadPairFamily(params.pair ?? '');
			if (!family) return t.description;
			return `Alternate ${family.description}, leading with the lower triad — ${family.application}.`;
		}
		return t.description;
	}

	function handleToggleSuggest() {
		if (!selectedVariant) return;
		toggleVariantSelected(selectedVariant.key);
		version++;
	}

	/**
	 * Preset the lick-practice config for a trick session and hand off to the
	 * setup page — the setup page owns starting the session.
	 */
	function practiceVariant() {
		if (!trick || !selectedVariant) return;
		Object.assign(lickPractice.config, {
			sessionType: 'trick',
			trickId: trick.id,
			trickParameters: selectedVariant.params
		});
		goto('/lick-practice');
	}
</script>

<svelte:head>
	<title>{trick?.name ?? 'Trick'} — Mankunku</title>
</svelte:head>

<div class="space-y-6">
	<!-- Back link -->
	<a
		href="/tricks"
		class="inline-flex items-center gap-1 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
	>
		&larr; Tricks
	</a>

	{#if trick}
		<div>
			<h1 class="text-2xl font-bold">{trick.name}</h1>
			<p class="mt-1 text-sm text-[var(--color-text-secondary)]">{trick.description}</p>
			<div class="mt-2 flex flex-wrap items-center gap-2 text-sm">
				<span
					class="smallcaps rounded border border-[var(--color-brass)]/40 px-1.5 py-0.5 text-xs text-[var(--color-brass)]"
				>
					{CATEGORY_LABELS[trick.category] ?? trick.category}
				</span>
				{#each trick.tags as tag}
					<span class="text-xs italic text-[var(--color-text-secondary)]">{tag}</span>
				{/each}
			</div>
		</div>

		<!-- Variant selector: the ordered mastery ladder as pills. Locked
		     variants are visible but dimmed and non-selectable. -->
		<div class="flex items-start gap-3">
			<span class="mt-0.5 text-sm text-[var(--color-text-secondary)]">Variant:</span>
			<div class="flex flex-wrap gap-1.5">
				{#each variants as variant (variant.key)}
					{@const isUnlocked = unlockedKeys.has(variant.key)}
					{#if isUnlocked}
						<button
							onclick={() => (selectedVariantKey = variant.key)}
							class="rounded-full px-3 py-1 text-xs font-medium transition-colors
								{selectedVariantKey === variant.key
									? 'bg-[var(--color-accent)] text-white'
									: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]'}"
						>
							{variant.label}
						</button>
					{:else}
						<span
							class="cursor-not-allowed rounded-full bg-[var(--color-bg-tertiary)] px-3 py-1 text-xs text-[var(--color-text-secondary)] opacity-50"
							title="Locked — see the mastery path below"
						>
							🔒 {variant.label}
						</span>
					{/if}
				{/each}
			</div>
		</div>

		{#if selectedVariant}
			<div class="flex flex-wrap gap-2">
				<button
					onclick={practiceVariant}
					class="rounded-full bg-[var(--color-accent)] px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
				>
					Practice this variant
				</button>
				<button
					onclick={handleToggleSuggest}
					class="rounded-full px-3 py-1.5 text-sm font-medium transition-colors
						{isVariantSelected(selectedVariant.key)
							? 'bg-[var(--color-success)]/20 text-[var(--color-success)] hover:bg-[var(--color-success)]/30'
							: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]'}"
					title={isVariantSelected(selectedVariant.key)
						? 'Stop suggesting this variant during tune practice'
						: 'Suggest this variant during tune practice'}
				>
					{isVariantSelected(selectedVariant.key) ? '★ Suggest in tunes' : '☆ Suggest in tunes'}
				</button>
			</div>
		{/if}

		<!-- Key selector — displayed in the user's WRITTEN pitch (what they
		     see on sheet music and finger on their horn). -->
		<div class="flex items-center gap-3">
			<span class="text-sm text-[var(--color-text-secondary)]">Key:</span>
			<div class="flex flex-wrap gap-1">
				{#each PITCH_CLASSES as pc}
					<button
						onclick={() => (selectedWrittenKey = pc)}
						class="rounded-full px-2 py-0.5 text-xs transition-colors
							{writtenKey === pc
								? 'bg-[var(--color-accent)] text-white'
								: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)]'}"
					>
						{pc}
					</button>
				{/each}
			</div>
		</div>

		<!-- Formula: what the selected variant asks for, plus a rendered example -->
		{#if selectedVariant}
			<section class="space-y-3">
				<div class="flex items-center gap-2">
					<h2 class="smallcaps text-[var(--color-brass)]">The formula</h2>
					<div class="jazz-rule flex-1"></div>
				</div>
				<p class="text-sm text-[var(--color-text-secondary)]">
					{describeVariant(trick, selectedVariant.params)}
				</p>
				{#if example}
					<NotationDisplay phrase={example} instrument={getInstrument()} />
				{:else}
					<p class="text-sm italic text-[var(--color-text-secondary)]">
						No example available in this key.
					</p>
				{/if}
			</section>
		{/if}

		<!-- Mastery path -->
		<section class="space-y-3">
			<div class="flex items-center gap-2">
				<h2 class="smallcaps text-[var(--color-brass)]">Mastery path</h2>
				<div class="jazz-rule flex-1"></div>
			</div>
			<TrickMasteryTree
				trickId={trick.id}
				selectedKey={selectedVariant?.key}
				onSelect={(key) => (selectedVariantKey = key)}
				{version}
			/>
		</section>

		<!-- Progress over time -->
		{#if progressPoints.length > 0}
			<section class="space-y-3">
				<h2 class="font-display text-lg font-semibold">Your progress</h2>
				<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4">
					<LickProgressChart points={progressPoints} />
				</div>
			</section>
		{/if}
	{:else}
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-8 text-center">
			<p class="text-[var(--color-text-secondary)]">
				Trick not found: {page.params.id}
			</p>
			<a href="/tricks" class="mt-2 inline-block text-sm text-[var(--color-accent)]">
				Back to Tricks
			</a>
		</div>
	{/if}
</div>

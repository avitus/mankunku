<script lang="ts">
	import type {
		LickPracticeConfig,
		LickPracticeMode,
		LickPracticeSessionType
	} from '$lib/types/lick-practice';
	import type { BackingStyle } from '$lib/types/instruments';
	import type { PitchClass, Phrase } from '$lib/types/music';
	import {
		PROGRESSION_TEMPLATES,
		progressionHasSubstitutionTargets
	} from '$lib/data/progressions';
	import { BACKING_STYLE_NAMES } from '$lib/audio/backing-styles';
	import { getAllLicks } from '$lib/phrases/library-loader';
	import { getPracticeTaggedIds, getUnlockedKeyCount } from '$lib/persistence/lick-practice-store';
	import { TRICKS, getTrickById } from '$lib/tricks';
	import {
		getUnlockedVariants,
		getNextLockedVariants,
		getVariantByKey,
		loadTrickUnlockContext,
		type TrickVariantDefinition
	} from '$lib/tricks/mastery';
	import { trickVariantKey, type TrickParameters } from '$lib/types/tricks';
	import { lickPractice } from '$lib/state/lick-practice.svelte';
	import { getInstrument } from '$lib/state/settings.svelte';
	import { circleOfFourthsFrom, planUnlockedKeys } from '$lib/music/key-ordering';
	import { concertKeyToWritten } from '$lib/music/transposition';
	import TooltipHint from '$lib/components/ui/TooltipHint.svelte';
	import { tooltips } from '$lib/content/tooltips';
	import Knob from '$lib/components/console/Knob.svelte';
	import SelectorPad from '$lib/components/console/SelectorPad.svelte';
	import RockerSwitch from '$lib/components/console/RockerSwitch.svelte';

	interface Props {
		config: LickPracticeConfig;
		availableLickCount: number;
		dailyLickCount: number;
		/** Licks the plan would actually contain (≤ the eligible count above). */
		plannedLickCount: number;
		/** Seconds that plan takes to play — the real session-length estimate. */
		plannedSeconds: number;
		onstart: () => void;
		onupdate: (config: Partial<LickPracticeConfig>) => void;
	}

	let {
		config,
		availableLickCount,
		dailyLickCount,
		plannedLickCount,
		plannedSeconds,
		onstart,
		onupdate
	}: Props = $props();

	/**
	 * Session length for the start caption. Whole minutes at a minute or more,
	 * seconds below it — a single-lick book runs ~24 s, and rounding that up to
	 * "~1 min" would repeat the overstatement this estimate exists to remove.
	 */
	function formatEstimate(seconds: number): string {
		if (seconds < 60) return `~${Math.max(10, Math.round(seconds / 10) * 10)} sec`;
		return `~${Math.round(seconds / 60)} min`;
	}

	const progressionTypes = Object.values(PROGRESSION_TEMPLATES);
	const backingStyles = Object.keys(BACKING_STYLE_NAMES) as BackingStyle[];

	const sessionTypeOptions: { value: LickPracticeSessionType; label: string; sublabel: string }[] = [
		{ value: 'daily', label: 'Daily Practice', sublabel: 'rotate all progressions' },
		{ value: 'focused', label: 'Focused Session', sublabel: 'one progression at a time' },
		{ value: 'deep', label: 'Deep Practice', sublabel: 'master one lick' },
		{ value: 'trick', label: 'Tricks', sublabel: 'drill a melodic device' }
	];

	const practiceModeOptions: { value: LickPracticeMode; label: string }[] = [
		{ value: 'continuous', label: 'Continuous' },
		{ value: 'call-response', label: 'Call & Response' }
	];

	// Lick picker state (only used when sessionType === 'deep'). Resolution of
	// the selected lick reads the full library — a Drill action launched from
	// /licks can carry an untagged lick into setup — but the picker's
	// search/dropdown only surfaces practice-tagged licks so users curate
	// what they see here through the same flow they use for standard sessions.
	const allLicks = $derived(getAllLicks());
	const practiceTaggedLicks = $derived.by(() => {
		void lickPractice.progress;
		const ids = getPracticeTaggedIds();
		return allLicks.filter((l) => ids.has(l.id));
	});
	let lickSearch = $state('');
	const filteredLicks = $derived.by(() => {
		const q = lickSearch.trim().toLowerCase();
		if (!q) return practiceTaggedLicks.slice(0, 30);
		return practiceTaggedLicks
			.filter(
				(l) =>
					l.name.toLowerCase().includes(q) ||
					l.tags.some((t) => t.toLowerCase().includes(q))
			)
			.slice(0, 30);
	});

	const selectedLick = $derived<Phrase | null>(
		config.singleLickId ? allLicks.find((l) => l.id === config.singleLickId) ?? null : null
	);

	const instrument = $derived(getInstrument());

	// The set of keys the deep-practice rotation will cycle through: the
	// lick's circle-of-4ths order, restricted to the per-lick unlocked-key
	// set. Mirrors `unlockedCircleFrom` in lick-practice.svelte.ts; kept
	// inline here so the setup screen can preview the active set without
	// exporting an internal helper. Reads `lickPractice.progress` so a
	// per-key write (which bumps the unlock count) re-derives this list.
	const rotationKeys = $derived.by<PitchClass[]>(() => {
		if (!selectedLick) return [];
		const unlockedCount = getUnlockedKeyCount(lickPractice.progress, selectedLick.id);
		const unlocked = new Set(planUnlockedKeys(selectedLick.key, unlockedCount));
		const circle = circleOfFourthsFrom(selectedLick.key);
		const filtered = circle.filter((k) => unlocked.has(k));
		return filtered.length > 0 ? filtered : circle;
	});

	const showSubstitutions = $derived(progressionHasSubstitutionTargets(config.progressionType));

	// ── Trick drill setup (sessionType === 'trick') ──────────────────
	// Variant unlock state lives in non-reactive storage; bump this counter
	// on session-type changes (mirrors how the licks page uses
	// practiceVersion) so returning to the Tricks branch re-reads any
	// progress earned in the meantime.
	let trickUnlockVersion = $state(0);

	const trickUnlockCtx = $derived.by(() => {
		void trickUnlockVersion;
		return loadTrickUnlockContext();
	});

	const selectedTrick = $derived(config.trickId ? (getTrickById(config.trickId) ?? null) : null);

	const unlockedVariants = $derived.by<TrickVariantDefinition[]>(() =>
		selectedTrick ? getUnlockedVariants(selectedTrick.id, trickUnlockCtx) : []
	);

	const lockedFrontier = $derived.by<TrickVariantDefinition[]>(() =>
		selectedTrick ? getNextLockedVariants(selectedTrick.id, trickUnlockCtx) : []
	);

	const selectedVariantKey = $derived(
		config.trickId && config.trickParameters
			? trickVariantKey(config.trickId, config.trickParameters)
			: null
	);

	const selectedVariantUnlocked = $derived(
		selectedVariantKey !== null && unlockedVariants.some((v) => v.key === selectedVariantKey)
	);

	// One-line hint for the unlock frontier, e.g.
	// "Double chromatic → 7th, off the beat (needs 3 passes of ...)".
	const frontierHint = $derived.by<string | null>(() => {
		const next = lockedFrontier[0];
		if (!next) return null;
		const clause = next.prerequisites[0];
		if (!clause) return next.label;
		const prereqLabels = clause.variants
			.map((k) => getVariantByKey(k)?.label ?? k)
			.join(' + ');
		return `${next.label} (needs ${clause.passes} passes of ${prereqLabels})`;
	});

	function handleTrickSelect(trickId: string): void {
		// Seed the parameters from the trick's first unlocked variant so the
		// selection always starts on a startable combination.
		const first = getUnlockedVariants(trickId, loadTrickUnlockContext())[0];
		onupdate({ trickId, trickParameters: first ? { ...first.params } : undefined });
	}

	/** Parameter values reachable through at least one unlocked variant. */
	function allowedTrickValues(name: string): Set<string> {
		const allowed = new Set<string>();
		for (const v of unlockedVariants) {
			const value = v.params[name];
			if (value !== undefined) allowed.add(value);
		}
		return allowed;
	}

	function handleTrickParamChange(name: string, value: string): void {
		if (!selectedTrick || !config.trickParameters) return;
		const candidate: TrickParameters = { ...config.trickParameters, [name]: value };
		const candidateKey = trickVariantKey(selectedTrick.id, candidate);
		if (unlockedVariants.some((v) => v.key === candidateKey)) {
			onupdate({ trickParameters: candidate });
			return;
		}
		// The combination isn't an unlocked variant — snap to the first
		// unlocked variant that carries the newly chosen value.
		const snap = unlockedVariants.find((v) => v.params[name] === value);
		if (snap) onupdate({ trickParameters: { ...snap.params } });
	}

	const canStart = $derived.by(() => {
		if (config.sessionType === 'trick') return selectedVariantUnlocked;
		if (config.sessionType === 'deep') return selectedLick !== null;
		if (config.sessionType === 'daily') return dailyLickCount > 0;
		return availableLickCount > 0;
	});

	const startLabel = $derived(
		config.sessionType === 'trick'
			? 'Start Trick Drill'
			: config.sessionType === 'deep'
				? 'Start Drill'
				: config.sessionType === 'daily'
					? 'Start Daily Practice'
					: 'Start Session'
	);

	const startCaption = $derived.by(() => {
		if (config.sessionType === 'trick') {
			if (!selectedTrick) return 'Pick a trick to drill.';
			if (!selectedVariantUnlocked) return 'That variant is still locked — clear its prerequisites first.';
			const variantLabel = selectedVariantKey
				? (getVariantByKey(selectedVariantKey)?.label ?? null)
				: null;
			return `${variantLabel ?? selectedTrick.name} · ${unlockedVariants.length} variant${unlockedVariants.length === 1 ? '' : 's'} unlocked`;
		}
		if (config.sessionType === 'deep') {
			if (!selectedLick) return 'Pick a lick to drill.';
			return `${rotationKeys.length} unlocked key${rotationKeys.length === 1 ? '' : 's'}`;
		}
		if (config.sessionType === 'daily') {
			if (dailyLickCount === 0) {
				return 'No licks tagged for practice yet.';
			}
			// The planned count, not the eligible count: the budget can cut the
			// rotation short, and quoting the full tally next to a shorter time
			// reads as a contradiction.
			return `${plannedLickCount} lick${plannedLickCount === 1 ? '' : 's'} across your tagged progressions · ${formatEstimate(plannedSeconds)}`;
		}
		// focused
		if (availableLickCount === 0) {
			return dailyLickCount > 0
				? `No licks tagged for this progression — try Daily Practice or tag more in your book.`
				: 'No licks tagged for practice yet.';
		}
		return `${plannedLickCount} lick${plannedLickCount === 1 ? '' : 's'} on this progression · ${formatEstimate(plannedSeconds)}`;
	});
</script>

<div class="space-y-5">
	<!-- ── SESSION TYPE ────────────────────────────────────────── -->
	<section class="space-y-2">
		<h2 class="smallcaps text-[var(--color-brass)]">Session Type</h2>
		<div
			class="rounded-xl border border-[var(--color-accent)]/20 bg-[var(--color-bg-secondary)] p-4 space-y-4"
		>
			<!-- 3-way mode picker -->
			<div class="flex justify-center">
				<SelectorPad
					ariaLabel="Session type"
					value={config.sessionType}
					options={sessionTypeOptions}
					onChange={(v) => {
						// Unlock state is read from non-reactive storage — re-derive
						// it whenever the user toggles session types so the Tricks
						// branch reflects progress earned since the last visit.
						trickUnlockVersion++;
						onupdate({ sessionType: v });
					}}
				/>
			</div>

			<!-- Mode-specific config -->
			{#if config.sessionType === 'daily'}
				<div class="flex justify-center">
					<Knob
						label="Duration"
						ariaLabel="Practice time"
						helpText="Upper limit on session length. Mankunku queues licks until the budget fills — with a small book the session ends sooner, and the caption under Start shows what it will actually take."
						value={config.durationMinutes}
						min={3}
						max={20}
						step={1}
						displayValue={`${config.durationMinutes} min`}
						onInput={(v) => onupdate({ durationMinutes: v })}
					/>
				</div>
			{:else if config.sessionType === 'focused'}
				<div class="flex flex-wrap items-end justify-center gap-x-10 gap-y-4">
					<!-- Progression picker -->
					<div class="flex flex-col items-center gap-1.5">
						<SelectorPad
							ariaLabel="Chord progression"
							size="sm"
							columns={3}
							value={config.progressionType}
							options={progressionTypes.map((prog) => ({
								value: prog.type,
								label: prog.shortName
							}))}
							onChange={(v) => onupdate({ progressionType: v })}
						/>
						<span class="smallcaps console-engrave inline-flex items-center gap-1">
							Chord Progression
							<TooltipHint
								text={tooltips.lickPractice.progressionType.text}
								learnMore={tooltips.lickPractice.progressionType.learnMore}
								position="top"
							/>
						</span>
					</div>

					<Knob
						label="Duration"
						ariaLabel="Practice time"
						helpText="Upper limit on session length. Licks are queued until the budget fills — with a small book the session ends sooner, and the caption under Start shows what it will actually take."
						value={config.durationMinutes}
						min={3}
						max={20}
						step={1}
						displayValue={`${config.durationMinutes} min`}
						onInput={(v) => onupdate({ durationMinutes: v })}
					/>

					{#if showSubstitutions}
						<RockerSwitch
							label="Subs"
							ariaLabel="Include chord substitutions"
							checked={config.enableSubstitutions ?? false}
							onChange={(v) => onupdate({ enableSubstitutions: v })}
						/>
					{/if}
				</div>
			{:else if config.sessionType === 'deep'}
				<!-- Deep practice: lick picker + tempo bump knob -->
				<div class="space-y-3">
					<!-- Lick picker -->
					<div class="space-y-1.5">
						{#if selectedLick}
							<div
								class="flex items-center justify-between rounded-lg bg-[var(--color-bg-tertiary)] px-3 py-2"
							>
								<div class="min-w-0">
									<div class="truncate text-sm font-medium">{selectedLick.name}</div>
									<div class="text-xs text-[var(--color-text-secondary)]">
										{concertKeyToWritten(selectedLick.key, instrument)} · {selectedLick.category} · diff
										{selectedLick.difficulty.level}
									</div>
								</div>
								<button
									onclick={() => onupdate({ singleLickId: undefined })}
									class="shrink-0 text-xs text-[var(--color-text-secondary)] underline hover:text-[var(--color-accent)]"
								>
									change
								</button>
							</div>
						{:else if practiceTaggedLicks.length === 0}
							<p class="text-xs text-[var(--color-text-secondary)]">
								No licks tagged for practice yet.
								<a href="/licks" class="text-[var(--color-accent)] underline">Browse your licks</a>
								and tag a few first.
							</p>
						{:else}
							<input
								type="text"
								bind:value={lickSearch}
								placeholder="search practice licks…"
								class="w-full rounded-lg bg-[var(--color-bg-tertiary)] px-3 py-2 text-sm placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
							/>
							{#if filteredLicks.length > 0}
								<div class="max-h-48 overflow-y-auto rounded-lg bg-[var(--color-bg-tertiary)]">
									{#each filteredLicks as lick (lick.id)}
										<button
											onclick={() => onupdate({ singleLickId: lick.id })}
											class="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--color-bg)]"
										>
											<span class="truncate">{lick.name}</span>
											<span class="ml-2 shrink-0 text-xs text-[var(--color-text-secondary)]">
												{concertKeyToWritten(lick.key, instrument)} · {lick.category}
											</span>
										</button>
									{/each}
								</div>
							{:else}
								<p class="text-xs italic text-[var(--color-text-secondary)]">No matches.</p>
							{/if}
						{/if}
					</div>

					<!-- Tempo bump + rotation preview -->
					{#if selectedLick}
						<div class="flex justify-center">
							<Knob
								label="Tempo Bump"
								ariaLabel="Tempo bump per cleared rotation"
								helpText="BPM added each time you clear the whole rotation."
								value={config.tempoBumpBpm ?? 5}
								min={1}
								max={20}
								step={1}
								displayValue={`+${config.tempoBumpBpm ?? 5}`}
								onInput={(v) => onupdate({ tempoBumpBpm: v })}
							/>
						</div>

						{#if rotationKeys.length > 0}
							<p class="text-center text-xs text-[var(--color-text-secondary)]">
								Rotation: {rotationKeys.map((k) => concertKeyToWritten(k, instrument)).join(' · ')}
							</p>
						{/if}
					{/if}
				</div>
			{:else if config.sessionType === 'trick'}
				<!-- Trick drill: device picker + one control per parameter,
				     restricted to values reachable through unlocked variants. -->
				<div class="space-y-3">
					<div class="flex flex-col items-center gap-1.5">
						<SelectorPad
							ariaLabel="Trick"
							value={config.trickId ?? ''}
							options={TRICKS.map((t) => ({ value: t.id, label: t.name }))}
							onChange={(v) => handleTrickSelect(v)}
						/>
						<span class="smallcaps console-engrave">Trick</span>
					</div>

					{#if selectedTrick && config.trickParameters}
						{@const params = config.trickParameters}
						<div class="flex flex-wrap items-end justify-center gap-x-8 gap-y-3">
							{#each selectedTrick.parameters as def (def.name)}
								{@const allowed = allowedTrickValues(def.name)}
								<div class="flex flex-col items-center gap-1.5">
									<SelectorPad
										ariaLabel={def.label}
										size="sm"
										value={params[def.name] ?? ''}
										options={def.values.map((v) => ({
											value: v,
											label: def.valueLabels?.[v] ?? v,
											disabled: !allowed.has(v),
											title: allowed.has(v)
												? undefined
												: 'Locked — earn it on the mastery ladder'
										}))}
										onChange={(v) => handleTrickParamChange(def.name, v)}
									/>
									<span class="smallcaps console-engrave">{def.label}</span>
								</div>
							{/each}
						</div>

						{#if frontierHint}
							<p class="truncate text-center text-xs text-[var(--color-text-secondary)]">
								Next unlock: {frontierHint}
							</p>
						{/if}
					{/if}
				</div>
			{/if}
		</div>
	</section>

	<!-- ── BACKING & FLOW ──────────────────────────────────────── -->
	<section class="space-y-2">
		<h2 class="smallcaps text-[var(--color-brass)]">Backing &amp; Flow</h2>
		<div
			class="rounded-xl border border-[var(--color-accent)]/20 bg-[var(--color-bg-secondary)] p-4"
		>
			<div class="flex flex-wrap items-end justify-center gap-x-10 gap-y-4">
				<!-- Backing style -->
				<div class="flex flex-col items-center gap-1.5">
					<SelectorPad
						ariaLabel="Backing style"
						value={config.backingStyle}
						options={backingStyles.map((style) => ({
							value: style,
							label: BACKING_STYLE_NAMES[style]
						}))}
						onChange={(v) => onupdate({ backingStyle: v })}
					/>
					<span class="smallcaps console-engrave inline-flex items-center gap-1">
						Backing Style
						<TooltipHint
							text={tooltips.lickPractice.backingStyle.text}
							learnMore={tooltips.lickPractice.backingStyle.learnMore}
							position="top"
						/>
					</span>
				</div>

				<!-- Practice mode (Continuous / Call & Response) -->
				<div class="flex flex-col items-center gap-1.5">
					<SelectorPad
						ariaLabel="Practice mode"
						value={config.practiceMode}
						options={practiceModeOptions}
						onChange={(v) => onupdate({ practiceMode: v })}
					/>
					<span class="smallcaps console-engrave inline-flex items-center gap-1">
						Mode
						<TooltipHint text={tooltips.lickPractice.practiceMode.text} position="top" />
					</span>
				</div>
			</div>
		</div>
	</section>

	<!-- ── START ───────────────────────────────────────────────── -->
	<div class="flex flex-col items-center gap-1.5">
		{#if canStart}
			<button
				onclick={onstart}
				class="rounded-lg bg-[var(--color-accent)] px-8 py-2.5 text-base font-bold text-white shadow-md transition-opacity hover:opacity-90"
			>
				{startLabel}
			</button>
		{/if}
		<p class="text-center text-xs text-[var(--color-text-secondary)]">
			{startCaption}
		</p>
		{#if !canStart && dailyLickCount === 0}
			<a href="/licks" class="text-xs text-[var(--color-accent)] underline">
				Browse your licks to tag more
			</a>
		{/if}
	</div>
</div>

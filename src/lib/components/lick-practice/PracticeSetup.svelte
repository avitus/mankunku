<script lang="ts">
	import StudioPanel from '$lib/components/console/StudioPanel.svelte';
	import StudioMeter from '$lib/components/console/StudioMeter.svelte';
	import type {
		LickPracticeConfig,
		LickPracticeMode,
		LickPracticeSessionType,
		ChordProgressionType
	} from '$lib/types/lick-practice';
	import { onDestroy } from 'svelte';
	import { loadEnclosureSetup } from '$lib/persistence/enclosure-setup';
	import type { BackingStyle } from '$lib/types/instruments';
	import type { PitchClass, Phrase } from '$lib/types/music';
	import { PROGRESSION_TEMPLATES, progressionHasSubstitutionTargets } from '$lib/data/progressions';
	import { BACKING_STYLE_NAMES } from '$lib/audio/backing-styles';
	import { getAllLicks } from '$lib/phrases/library-loader';
	import { getPracticeTaggedIds, getUnlockedKeyCount } from '$lib/persistence/lick-practice-store';
	import {
		TRICKS,
		getTrickById,
		trickContextFor,
		trickEntryKey,
		resolveTrickPracticeBed,
		normalizeTrickPracticeParameters
	} from '$lib/tricks';
	import {
		getUnlockedVariants,
		getNextLockedVariants,
		getVariantByKey,
		loadTrickUnlockContext,
		type TrickVariantDefinition
	} from '$lib/tricks/mastery';
	import { trickVariantKey, type TrickParameters } from '$lib/types/tricks';
	import {
		lickPractice,
		trickPracticeProgressKey,
		trickPracticeLabel
	} from '$lib/state/lick-practice.svelte';
	import { getTrickTempo, loadTrickPracticeProgress } from '$lib/persistence/trick-practice-store';
	import { createTrickAudition } from '$lib/state/trick-audition.svelte';
	import TrickPairSelector from '$lib/components/tricks/TrickPairSelector.svelte';
	import EnclosurePhraseCanvas from '$lib/components/tricks/EnclosurePhraseCanvas.svelte';
	import { DEFAULT_TEMPO_BUMP_PERCENT } from '$lib/state/lick-practice-rotation';
	import { getInstrument } from '$lib/state/settings.svelte';
	import { circleOfFourthsFrom, lickUnlockRamp, planUnlockedKeys } from '$lib/music/key-ordering';
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

	const sessionTypeOptions: {
		value: LickPracticeSessionType;
		label: string;
		sublabel: string;
	}[] = [
		{
			value: 'daily',
			label: 'Daily Practice',
			sublabel: 'Rotate all progressions'
		},
		{
			value: 'focused',
			label: 'Focused Session',
			sublabel: 'One progression at a time'
		},
		{ value: 'deep', label: 'Deep Practice', sublabel: 'Master one lick' },
		{ value: 'trick', label: 'Tricks', sublabel: 'Drill a melodic device' }
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
				(l) => l.name.toLowerCase().includes(q) || l.tags.some((t) => t.toLowerCase().includes(q))
			)
			.slice(0, 30);
	});

	const selectedLick = $derived<Phrase | null>(
		config.singleLickId ? (allLicks.find((l) => l.id === config.singleLickId) ?? null) : null
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
		const unlocked = new Set(planUnlockedKeys(lickUnlockRamp(selectedLick, instrument), unlockedCount));
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
	const isEnclosure = $derived(
		config.sessionType === 'trick' && selectedTrick?.id === 'enclosures'
	);
	const trickBed = $derived(
		selectedTrick && config.trickParameters
			? resolveTrickPracticeBed(selectedTrick, config.trickParameters, config.trickProgressionType)
			: 'major-vamp'
	);
	const progressionDrill = $derived(
		isEnclosure && PROGRESSION_TEMPLATES[trickBed].harmony.length > 1
	);
	const trickTempo = $derived.by(() => {
		void trickUnlockVersion;
		return selectedTrick && config.trickParameters
			? getTrickTempo(
					loadTrickPracticeProgress(),
					trickPracticeProgressKey(selectedTrick, config.trickParameters, trickBed)
				)
			: 60;
	});
	const trickContext = $derived(
		selectedTrick && config.trickParameters
			? trickContextFor(
					selectedTrick,
					config.trickParameters,
					trickEntryKey(instrument),
					trickTempo,
					trickBed
				)
			: null
	);
	const audition = createTrickAudition();
	onDestroy(audition.dispose);

	/** The canvas may explore any shape; only a known unlocked vamp variant can start. */
	function updateEnclosureParameters(parameters: TrickParameters): void {
		if (!selectedTrick) return;
		void audition.stop();
		onupdate({
			trickParameters: normalizeTrickPracticeParameters(selectedTrick, parameters, trickBed)
		});
	}

	/** Progression selection retains the gesture while canonicalizing its chord family. */
	function updateTrickProgression(progression: ChordProgressionType): void {
		if (!selectedTrick || !config.trickParameters) return;
		void audition.stop();
		onupdate({
			trickProgressionType: progression,
			trickParameters: normalizeTrickPracticeParameters(
				selectedTrick,
				config.trickParameters,
				progression
			)
		});
	}

	// One-line hint for the unlock frontier, e.g.
	// "Double chromatic → 7th, off the beat (needs 3 passes of ...)".
	const frontierHint = $derived.by<string | null>(() => {
		const next = lockedFrontier[0];
		if (!next) return null;
		const clause = next.prerequisites[0];
		if (!clause) return next.label;
		const prereqLabels = clause.variants.map((k) => getVariantByKey(k)?.label ?? k).join(' + ');
		return `${next.label} (needs ${clause.passes} passes of ${prereqLabels})`;
	});

	/** Restore enclosure preferences; other devices start with an unlocked variant. */
	function handleTrickSelect(trickId: string): void {
		// Seed the parameters from the trick's first unlocked variant so the
		// selection always starts on a startable combination.
		const first = getUnlockedVariants(trickId, loadTrickUnlockContext())[0];
		void audition.stop();
		onupdate({
			trickId,
			trickParameters: first ? { ...first.params } : undefined,
			trickProgressionType: undefined,
			...(trickId === 'enclosures' ? loadEnclosureSetup() : null)
		});
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

	/** Keep the chosen parameter combination on an unlocked trick variant. */
	function handleTrickParamChange(name: string, value: string): void {
		if (!selectedTrick || !config.trickParameters) return;
		const candidate: TrickParameters = {
			...config.trickParameters,
			[name]: value
		};
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
		if (config.sessionType === 'trick') return progressionDrill || selectedVariantUnlocked;
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
			if (progressionDrill) return 'Progress saved separately for this progression · end anytime';
			if (!selectedVariantUnlocked)
				return 'That variant is still locked — clear its prerequisites first.';
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

<div class="practice-console-grid">
	<div class="practice-console-main">
		<!-- ── SESSION TYPE ────────────────────────────────────────── -->
		<StudioPanel
			id="practice-session"
			number="01"
			title="Choose your session"
			domain="lick-practice"
		>
			<div class="practice-session-controls">
				<!-- 3-way mode picker -->
				<div class="flex justify-center">
					<SelectorPad
						ariaLabel="Session type"
						columns={4}
						value={config.sessionType}
						options={sessionTypeOptions}
						onChange={(v) => {
							// Unlock state is read from non-reactive storage — re-derive
							// it whenever the user toggles session types so the Tricks
							// branch reflects progress earned since the last visit.
							trickUnlockVersion++;
							void audition.stop();
							onupdate({ sessionType: v });
						}}
					/>
				</div>

				<!-- Mode-specific config -->
				{#if config.sessionType === 'daily'}
					<div class="practice-duration-row">
						<p class="studio-caption">
							A little of everything. Keep your whole vocabulary moving.<br />Set a time budget;
							your actual session may be shorter.
						</p>
						<Knob
							size="lg"
							label="Duration"
							ariaLabel="Practice time"
							helpText="Target session length. Mankunku queues licks until the budget fills — with a small book the session ends sooner, and a single lick longer than the whole budget still gets queued on its own. The caption under Start shows what it will actually take."
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
							size="lg"
							label="Duration"
							ariaLabel="Practice time"
							helpText="Target session length. Licks are queued until the budget fills — with a small book the session ends sooner, and a single lick longer than the whole budget still gets queued on its own. The caption under Start shows what it will actually take."
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
										<div class="truncate text-sm font-medium">
											{selectedLick.name}
										</div>
										<div class="text-xs text-[var(--color-text-secondary)]">
											{concertKeyToWritten(selectedLick.key, instrument)} · {selectedLick.category}
											· diff
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
									<a href="/licks" class="text-[var(--color-accent)] underline">Browse your licks</a
									>
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
									size="lg"
									label="Tempo Bump"
									ariaLabel="Tempo bump per cleared rotation"
									helpText="Percent added each time you clear the whole rotation, rounded up to a whole BPM. Deep Practice starts 2% below the lick's saved tempo and leaves it there — it never changes the tempo your daily practice uses. It also sizes the focus drill the report's Drill-a-key suggestion launches: one step up per clear, three steps down per attempt under 75%. This knob also governs Trick Drills, which do save their bumps."
									value={config.tempoBumpPercent ?? DEFAULT_TEMPO_BUMP_PERCENT}
									min={0.5}
									max={5}
									step={0.5}
									displayValue={`+${config.tempoBumpPercent ?? DEFAULT_TEMPO_BUMP_PERCENT}%`}
									onInput={(v) => onupdate({ tempoBumpPercent: v })}
								/>
							</div>

							{#if rotationKeys.length > 0}
								<p class="text-center text-xs text-[var(--color-text-secondary)]">
									Rotation: {rotationKeys
										.map((k) => concertKeyToWritten(k, instrument))
										.join(' · ')}
								</p>
							{/if}
						{/if}
					</div>
				{:else if config.sessionType === 'trick'}
					<!-- Enclosures use the shared canvas below; other devices retain
				     the parameter controls restricted to unlocked variants. -->
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

						{#if selectedTrick && config.trickParameters && !isEnclosure}
							{@const params = config.trickParameters}
							{#if selectedTrick.id === 'triad-pairs'}
								<TrickPairSelector value={params.pair ?? ''} unlockedValues={[...allowedTrickValues('pair')]} onchange={value => handleTrickParamChange('pair', value)} />
							{:else}
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
													title: allowed.has(v) ? undefined : 'Locked — earn it on the mastery ladder'
												}))}
												onChange={(v) => handleTrickParamChange(def.name, v)}
											/>
											<span class="smallcaps console-engrave">{def.label}</span>
										</div>
									{/each}
								</div>
							{/if}

							{#if frontierHint}
								<p class="truncate text-center text-xs text-[var(--color-text-secondary)]">
									Next unlock: {frontierHint}
								</p>
							{/if}
						{/if}
					</div>
				{/if}
			</div>
		</StudioPanel>

		{#if isEnclosure && config.trickParameters && trickContext}
			<section aria-label="Enclosure setup">
				<EnclosurePhraseCanvas
					parameters={config.trickParameters}
					onchange={updateEnclosureParameters}
					context={trickContext}
					progressionType={trickBed}
					onprogressionchange={updateTrickProgression}
					status={progressionDrill || selectedVariantUnlocked
						? 'Ready to practice'
						: getVariantByKey(selectedVariantKey ?? '')
							? 'Locked · preview'
							: 'Exploration'}
					statusKind={progressionDrill || selectedVariantUnlocked
						? 'ready'
						: getVariantByKey(selectedVariantKey ?? '')
							? 'locked'
							: 'exploration'}
					onhear={(phrase) => audition.play(phrase, trickTempo)}
					hearing={audition.state.playing}
					onpreviewchange={() => {
						void audition.stop();
					}}
				/>
				{#if audition.state.error}<p
						class="mt-2 text-sm text-[var(--color-error-text)]"
						role="alert"
					>
						{audition.state.error}
					</p>{/if}
				<div class="mt-4 flex flex-wrap justify-between items-center gap-3 text-sm">
					<span
						>{selectedTrick
							? trickPracticeLabel(selectedTrick, config.trickParameters).replace(
									/ — (major|minor|dominant)$/,
									''
								)
							: ''}</span
					>
					<a
						class="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
						href="/tricks/enclosures">Mastery path →</a
					>
				</div>
			</section>
		{/if}

		<!-- ── BACKING & FLOW ──────────────────────────────────────── -->
		<StudioPanel
			id="practice-band"
			number="02"
			title={isEnclosure ? 'Practice settings' : 'Set the band'}
			domain="lick-practice"
		>
			<div class="practice-band-controls">
				{#if isEnclosure}
					<div
						class="mb-5 grid grid-cols-1 gap-4 border-b border-[var(--color-bg-tertiary)] pb-5 sm:grid-cols-3"
					>
						<div class="flex justify-between items-center gap-3 sm:block">
							<span class="text-xs text-[var(--color-text-secondary)]">Starting tempo</span>
							<div class="font-display text-2xl">
								{trickTempo}
								<span class="font-sans text-xs text-[var(--color-text-secondary)]">BPM</span>
							</div>
						</div>
						<div class="flex justify-between items-center gap-3 sm:block">
							<span class="text-xs text-[var(--color-text-secondary)]">First key</span>
							<div class="font-display text-2xl">
								{concertKeyToWritten(trickEntryKey(instrument), instrument)}
								<span class="font-sans text-xs text-[var(--color-text-secondary)]">written</span>
							</div>
						</div>
						<div class="flex justify-between items-center gap-3 sm:block">
							<span class="text-xs text-[var(--color-text-secondary)]">Backing</span>
							<div class="text-sm mt-1">
								{PROGRESSION_TEMPLATES[trickBed].name}
							</div>
						</div>
					</div>
				{/if}
				<div class="flex flex-wrap items-end justify-center gap-x-10 gap-y-4">
					<!-- Backing style -->
					<div class="flex flex-col items-center gap-1.5">
						<SelectorPad
							ariaLabel="Backing style"
							columns={4}
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
							columns={2}
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
		</StudioPanel>
	</div>
	<aside class="studio-panel practice-session-summary" aria-label="Your session">
		<p class="studio-label">Your session</p>
		{#if config.sessionType === 'daily' || config.sessionType === 'focused'}
			<StudioMeter value={config.durationMinutes} max={20} label="Time budget · Minutes" />
		{:else}<div class="studio-well">
				<strong
					>{config.sessionType === 'deep'
						? (selectedLick?.name ?? 'Choose a lick')
						: (selectedTrick?.name ?? 'Choose a trick')}</strong
				>
				<p class="studio-caption">Open-ended practice</p>
			</div>{/if}
		<dl>
			<div>
				<dt>Session</dt>
				<dd>
					{sessionTypeOptions.find((option) => option.value === config.sessionType)?.label}
				</dd>
			</div>
			{#if config.sessionType === 'daily' || config.sessionType === 'focused'}
				<div>
					<dt>Time budget</dt>
					<dd>{config.durationMinutes} min</dd>
				</div>
				<div>
					<dt>Estimated session</dt>
					<dd>
						{plannedLickCount > 0 ? formatEstimate(plannedSeconds) : 'No licks queued'}
					</dd>
				</div>
			{/if}
			<div>
				<dt>Feel</dt>
				<dd>{BACKING_STYLE_NAMES[config.backingStyle]}</dd>
			</div>
			<div>
				<dt>Mode</dt>
				<dd>
					{config.practiceMode === 'continuous' ? 'Continuous' : 'Call & Response'}
				</dd>
			</div>
		</dl>
		<p class="studio-caption">
			{dailyLickCount} lick{dailyLickCount === 1 ? '' : 's'} in your practice set
		</p>
	</aside>

	<!-- ── START ───────────────────────────────────────────────── -->
	<div class="practice-start">
		{#if canStart}
			<button
				disabled={config.sessionType !== 'trick' && lickPractice.progressLoading}
				onclick={() => {
					void audition.stop();
					onstart();
				}}
				class="studio-action disabled:opacity-50"
			>
				{config.sessionType !== 'trick' && lickPractice.progressLoading
					? 'Loading progress…'
					: startLabel}
			</button>
		{/if}
		<p class="text-center text-xs text-[var(--color-text-secondary)]">
			{startCaption}
		</p>
		{#if !canStart && dailyLickCount === 0 && config.sessionType !== 'trick'}
			<a href="/licks" class="text-xs text-[var(--color-accent)] underline">
				Browse your licks to tag more
			</a>
		{/if}
	</div>
</div>

<style>
	.practice-console-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 260px;
		gap: 24px;
		align-items: start;
	}
	.practice-console-main {
		display: grid;
		gap: 24px;
		min-width: 0;
	}
	.practice-session-controls {
		display: grid;
		gap: 24px;
	}
	.practice-session-controls > div:first-child {
		display: block;
	}
	.practice-session-controls :global([aria-label='Session type']) {
		--selector-columns: 4;
		width: 100%;
	}
	.practice-session-controls :global([aria-label='Session type'] .pad-btn) {
		min-height: 96px;
		text-align: left;
		align-items: flex-start;
		padding: 18px 12px;
	}
	.practice-session-controls :global([aria-label='Session type'] .pad-sublabel) {
		font-size: 10px;
	}
	.practice-duration-row {
		display: grid;
		grid-template-columns: 1fr 180px;
		align-items: center;
		gap: 24px;
		border-top: 1px solid var(--studio-border);
		padding-top: 24px;
	}
	.practice-band-controls > div:last-child {
		display: grid;
		grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
		gap: 28px;
		align-items: start;
	}
	.practice-band-controls :global(.pad-frame) {
		width: 100%;
	}
	.practice-session-summary {
		border-top: 3px solid var(--color-brass);
		padding: 26px 22px;
	}
	.practice-session-summary > p:first-child {
		margin-bottom: 24px;
	}
	.practice-session-summary dl {
		margin: 26px 0;
	}
	.practice-session-summary dl > div {
		display: flex;
		justify-content: space-between;
		gap: 14px;
		padding: 14px 0;
		border-bottom: 1px solid var(--studio-border);
		font-size: 12px;
	}
	.practice-session-summary dt {
		color: var(--studio-muted);
	}
	.practice-session-summary dd {
		text-align: right;
		max-width: 60%;
	}
	.practice-start {
		grid-column: 1/-1;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 18px;
		padding: 24px;
		border: 1px solid var(--studio-border);
		border-radius: 6px;
		background: var(--studio-panel);
	}
	.practice-start p {
		max-width: 620px;
	}
	@media (max-width: 1200px) {
		.practice-console-grid {
			grid-template-columns: minmax(0, 1fr) 230px;
		}
		.practice-band-controls > div:last-child {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 950px) {
		.practice-console-grid {
			grid-template-columns: 1fr;
		}
		.practice-session-summary :global(.studio-meter) {
			max-width: 240px;
		}
	}
	@media (max-width: 600px) {
		.practice-session-controls :global([aria-label='Session type']) {
			--selector-columns: 2;
		}
		.practice-duration-row {
			grid-template-columns: 1fr 100px;
			gap: 12px;
		}
		.practice-band-controls :global([aria-label='Backing style']) {
			--selector-columns: 2;
		}
		.practice-session-controls :global(.pad-frame-flex) {
			flex-wrap: wrap;
		}
		.practice-start {
			flex-direction: column;
			align-items: stretch;
			padding: 20px;
		}
	}
</style>

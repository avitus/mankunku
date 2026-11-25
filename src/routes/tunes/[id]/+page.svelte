<script lang="ts">
	import { observeChartWidth } from '$lib/notation/observe-chart-width';
	import { printedBarCount, firstBarNumber } from '$lib/music/pickup';
	import { savedTuneKey, saveTuneKey, savedTuneDisplay, saveTuneDisplay, savedTunePracticeStyle, saveTunePracticeStyle } from '$lib/tunes/preferences';
	import { recordRecentTune } from '$lib/persistence/recent-tunes';
	import { jamSheets } from '$lib/tunes/jam-sheets';
	import { page } from '$app/state';
	import { goto, onNavigate } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';
	import RockerSwitch from '$lib/components/console/RockerSwitch.svelte';
	import TuneBandControls from '$lib/components/tunes/TuneBandControls.svelte';
	import { TunePlayer } from '$lib/state/tune-player.svelte';
	import { tuneDeskView } from '$lib/state/tune-desk-view.svelte';
	import { tuneBackingStyle } from '$lib/tunes/backing-style';
	import type { BackingStyle } from '$lib/types/instruments';
	import { settings, saveSettings, saveTuneTempo } from '$lib/state/settings.svelte';
	import type { RangeMarker } from '$lib/components/notation/NotationDisplay.svelte';
	import EditorIcon from '$lib/components/step-entry/EditorIcon.svelte';
	import KeyCenterLegend from '$lib/components/tunes/KeyCenterLegend.svelte';
	import TuneSessionDesk from '$lib/components/tunes/TuneSessionDesk.svelte';
	import TunePracticeSession from '$lib/components/tune-practice/TunePracticeSession.svelte';
	import '$lib/components/tunes/session-desk.css';
	import HelpLink from '$lib/components/ui/HelpLink.svelte';
	import TourTrigger from '$lib/components/ui/TourTrigger.svelte';
	import { tunePracticeTour } from '$lib/tour/tours/tune-practice';
	import PrintableTune from '$lib/components/tunes/PrintableTune.svelte';

	import TuneHarmonyGuide from '$lib/components/tunes/TuneHarmonyGuide.svelte';
	import { tuneKeyCenters } from '$lib/tunes/key-centers';

	import { loadDraftForReview } from '$lib/state/tune-entry.svelte';
	import '$lib/components/step-entry/lick-editor.css';
	import '$lib/components/tunes/tune-desk.css';
	import '$lib/components/tunes/tune-detail.css';
	import NotationDisplay from '$lib/components/notation/NotationDisplay.svelte';
	import TuneChordChart from '$lib/components/tunes/TuneChordChart.svelte';
	import { tuneInPlayingRange } from '$lib/state/tune-playing-sheet';
	import { isCuratedTuneId } from '$lib/tunes/book-loader';
	import { resolveTuneRef } from '$lib/tunes/tune-slug';
	import { getUserTunesLocal, deleteUserTune, saveUserTune } from '$lib/persistence/user-tunes';
	import {
		getTuneAdoptionsLocal,
		getAdoptedTuneAuthorsLocal,
		adoptTune,
		returnTune,
		fetchCommunityTune,
		type SharedTune
	} from '$lib/persistence/tune-community';
	import { getInstrument } from '$lib/state/settings.svelte';
	import { awaitHydration } from '$lib/state/hydration';
	import { PITCH_CLASSES, type PitchClass } from '$lib/types/music';
	import { concertKeyToWritten, writtenKeyToConcert } from '$lib/music/transposition';

	const supabase = $derived(page.data?.supabase ?? null);
	const session = $derived(page.data?.session ?? null);

	// localStorage caches are non-reactive — the version counter forces a
	// re-read after background cloud hydration lands (/tunes pattern). It
	// races a deep-link mount: opening /tunes/<id> on a fresh device would
	// otherwise stay on "Tune not found" (or stale badges/author) until a
	// manual reload. awaitHydration() is the deterministic completion signal
	// (bounded wait), not a guessed timer.
	let cacheVersion = $state(0);

	$effect(() => {
		if (!session) return;
		let live = true;
		awaitHydration().then(() => {
			if (live) cacheVersion++;
		});
		return () => {
			live = false;
		};
	});

	const bookSheet = $derived.by(() => {
		void cacheVersion;
		return resolveTuneRef(page.params.id ?? '');
	});

	// A community tune the viewer has not adopted is in no local cache — the
	// community card links here by id, so look it up shared. The book always
	// wins: once adopted (or hydrated), `bookSheet` takes over.
	let shared = $state<(SharedTune & { ref: string }) | null>(null);
	let sharedLoading = $state(false);

	$effect(() => {
		const ref = page.params.id ?? '';
		const sb = supabase;
		if (bookSheet || !sb || !session || !ref) {
			sharedLoading = false;
			return;
		}
		let live = true;
		sharedLoading = true;
		fetchCommunityTune(sb, ref).then((result) => {
			if (!live) return;
			shared = result ? { ...result, ref } : null;
			sharedLoading = false;
		});
		return () => {
			live = false;
		};
	});

	const sharedSheet = $derived(
		!bookSheet && shared && shared.ref === page.params.id ? shared.sheet : undefined
	);
	const baseSheet = $derived(bookSheet ?? sharedSheet);
	const isCurated = $derived(baseSheet ? isCuratedTuneId(baseSheet.id) : false);
	const isAdopted = $derived.by(() => {
		void cacheVersion;
		return baseSheet ? getTuneAdoptionsLocal().has(baseSheet.id) : false;
	});
	const isOwnSheet = $derived.by(() => {
		void cacheVersion;
		return baseSheet ? getUserTunesLocal().some((s) => s.id === baseSheet.id) : false;
	});
	const authorName = $derived.by(() => {
		void cacheVersion;
		if (sharedSheet) return shared?.authorName ?? null;
		return baseSheet ? getAdoptedTuneAuthorsLocal()[baseSheet.id]?.authorName ?? null : null;
	});

	/**
	 * Key selector state is in WRITTEN pitch (what the user sees on their
	 * instrument's sheet music), converted to concert at the
	 * `transposeTune()` boundary.
	 */
	let selectedWrittenKey: PitchClass | null = $state(null);

	const baseKey = $derived(baseSheet?.key);
	const baseId = $derived(baseSheet?.id);
	$effect(() => {
		if (baseId) recordRecentTune(baseId);
	});
	$effect(() => {
		void baseId;
		if (baseKey && baseId) selectedWrittenKey = concertKeyToWritten(savedTuneKey(baseId, baseKey), getInstrument());
	});

	const writtenKey = $derived(selectedWrittenKey ?? 'C');
	const concertKey = $derived(writtenKeyToConcert(writtenKey, getInstrument()));

	const sheet = $derived(
		baseSheet
			? tuneInPlayingRange(baseSheet, concertKey)
			: undefined
	);

	const practice = $derived(!!bookSheet && page.url.searchParams.get('licks') === '1');
	let changingMode = $state(false);
	async function setPractice(on: boolean): Promise<void> {
		if (changingMode) return;
		const url = new URL(page.url.href);
		if (on) url.searchParams.set('licks', '1');
		else url.searchParams.delete('licks');
		changingMode = true;
		try {
			await goto(url, { replace: true, reset: false });
		} finally {
			changingMode = false;
		}
	}
	let practiceSession = $state<TunePracticeSession>();
	const practiceStatus = $derived(practiceSession?.status());
	function switchSessionMode(on: boolean) {
		if (changingMode || on === practice) return;
		if (practice && (practiceStatus?.running || practiceStatus?.loading)) practiceSession?.togglePlay();
		void setPractice(on);
	}
	let repeatSession = $state(false);
	let playGeneration = 0;
	async function togglePlay() {
		if (changingMode) return;
		if (practice) { practiceSession?.togglePlay(); return; }
		const generation = ++playGeneration;
		if (player.busy) { player.stop(); return; }
		if (!sheet) return;
		do {
			if (!await player.toggle(sheet, backingStyle, player.soloChoruses)) return;
		} while (repeatSession && generation === playGeneration);
	}
	// The tempo is remembered per tune, so the next visit opens at the last choice.
	const player = new TunePlayer({
		tuneId: () => baseSheet?.id,
		save: (tuneId, tempo) => saveTuneTempo(tuneId, tempo, supabase ?? undefined)
	}, () => baseSheet?.style);
	// Reset playback on navigation. An auth refresh can replace page.params
	// while the musician is still playing the same tune.
	onNavigate(({ from, to }) => {
		const changingTune = from?.params?.id !== to?.params?.id;
		const enteringPractice = from?.url.searchParams.get('licks') !== '1' && to?.url.searchParams.get('licks') === '1';
		if (changingTune || enteringPractice) {
			playGeneration++;
			player.stop();
		}
		if (changingTune) {
			player.unaccompaniedSwing = null;
			if (settingsPanel) settingsPanel.open = false;
		}
	});
	const busy = $derived(player.busy || !!practiceStatus?.running || !!practiceStatus?.loading);
	// A new playback also counts when another tab has opened a different tune.
	$effect(() => {
		if (player.playing && baseId) recordRecentTune(baseId);
	});
	let manualFocus = $state(false);
	const focused = $derived(manualFocus || busy);
	$effect(() => { tuneDeskView.focus = focused; });
	let printPreview = $state(false);
	let settingsPanel = $state<HTMLDetailsElement>();
	let chartWidth = $state(800);
	const tuneStyle = $derived(baseSheet ? tuneBackingStyle(baseSheet, isOwnSheet ? {} : settings.tuneBackingStyles) : 'swing');
	const backingStyle = $derived.by(() => {
		void cacheVersion;
		return practice && baseId ? savedTunePracticeStyle(baseId, tuneStyle) : tuneStyle;
	});
	const jamCharts = $derived(sheet ? jamSheets(sheet, player.playHead, player.playOutro) : null);
	const hasMelody = $derived(sheet?.sections.some(section => section.notes.some(note => note.pitch !== null)) ?? false);
	const solosOnly = $derived(!player.playHead || !hasMelody);
	const showChordChart = $derived(player.playing ? player.showSoloChart || (solosOnly && player.phase !== 'outro') : solosOnly);
	const closingPreview = $derived(player.soloChoruses === 1 && solosOnly && (!hasMelody || !player.playOutro));
	const playingSheet = $derived(player.closing || (!player.playing && closingPreview) ? jamCharts?.closing
		: player.phase === 'head' && !player.showSoloChart && jamCharts?.opening ? jamCharts.opening.sheet : jamCharts?.returning);
	// The saved PDF opens as printed, including both voltas. During a session
	// the chart follows the ending chosen for the current chorus.
	const displayedSheet = $derived(sheet?.source === 'imported-pdf' && !player.playing && !solosOnly ? sheet : playingSheet);
	const openingBarNumber = $derived(displayedSheet ? firstBarNumber(displayedSheet) : 1);
	const totalBars = $derived(displayedSheet ? printedBarCount(displayedSheet) : 0);
	let showKeyCenters = $state(true);
	onMount(() => {
		player.restorePlaybackPreferences();
		player.restoreSoloChoruses();
		showKeyCenters = savedTuneDisplay('key-centers', true);
		manualFocus = savedTuneDisplay('focus', false);
	});
	/** Persist an explicit focus change; route teardown only clears the live view. */
	function setFocus(enabled: boolean): void { manualFocus = saveTuneDisplay('focus', enabled); }
	/** Stop playback and persist the selected written key in concert pitch. */
	function selectWrittenKey(key: PitchClass): void {
		playGeneration++;
		player.stop();
		selectedWrittenKey = key;
		if (baseId) saveTuneKey(baseId, writtenKeyToConcert(key, getInstrument()));
	}
	const keyCenters = $derived(displayedSheet ? tuneKeyCenters(displayedSheet, getInstrument(), { solo: showChordChart }) : null);
	const markers: RangeMarker[] = $derived([
		...(showKeyCenters ? keyCenters?.markers ?? [] : []),
		...(player.chartBar === null ? [] : [{ id: 'tune-playhead', startBar: Math.floor(player.chartBar), endBarExclusive: Math.floor(player.chartBar) + 1, status: 'playhead' as const }])
	]);

	/** Own tunes carry their style; shared/curated charts keep a personal account preference. */
	function saveBackingStyle(style: BackingStyle): void {
		if (!baseSheet || busy) return;
		if (practice) {
			saveTunePracticeStyle(baseSheet.id, style);
			cacheVersion++;
		} else if (isOwnSheet) {
			saveUserTune({ ...baseSheet, backingStyle: style });
			cacheVersion++;
		} else {
			settings.tuneBackingStyles = { ...settings.tuneBackingStyles, [baseSheet.id]: style };
			saveSettings(supabase ?? undefined);
		}
	}

	let confirmingDelete = $state(false);
	let confirmingReturn = $state(false);
	let adopting = $state(false);

	/** A curated tune opens as an unsaved personal copy, preserving the collection original. */
	function handleCopy(): void {
		if (!baseSheet || !isCurated) return;
		player.stop();
		loadDraftForReview({ ...baseSheet, backingStyle, id: '', source: 'user' }, getInstrument());
		goto(`/tunes/editor?copy=${baseSheet.id}`);
	}

	/** Keep playback and focus shortcuts clear of dialogs and editable controls. */
	function handleKeydown(event: KeyboardEvent): void {
		if (printPreview || document.querySelector('dialog[open]')) return;
		if (event.key === 'Escape') {
			if (settingsPanel?.open) { settingsPanel.open = false; settingsPanel.querySelector('summary')?.focus(); }
			else if (busy) { void togglePlay(); }
			else setFocus(false);
			return;
		}
		if (event.defaultPrevented || event.repeat) return;
		if (event.key !== ' ' || event.ctrlKey || event.metaKey || event.altKey) return;
		if (event.target instanceof HTMLElement && event.target.closest('input,select,textarea,button,a,summary,[role="button"]')) return;
		event.preventDefault();
		void togglePlay();
	}

	function handleEdit() {
		if (!baseSheet) return;
		goto(`/tunes/editor?edit=${baseSheet.id}`);
	}

	function handleDelete() {
		if (!baseSheet) return;
		if (!confirmingDelete) {
			confirmingDelete = true;
			return;
		}
		deleteUserTune(baseSheet.id);
		goto('/tunes');
	}

	/** Add the viewed community tune to the local book and refresh its available actions. */
	async function handleAdopt() {
		if (!baseSheet || !supabase || adopting) return;
		adopting = true;
		try {
			// Retain the validated sheet being viewed if the post-insert fetch
			// fails, so the book and its Practice action are immediately usable.
			const viewed = sharedSheet && shared ? shared : undefined;
			if (await adoptTune(supabase, baseSheet.id, viewed)) cacheVersion++;
		} finally {
			adopting = false;
		}
	}

	async function handleReturn() {
		if (!baseSheet || !supabase) return;
		if (!confirmingReturn) {
			confirmingReturn = true;
			return;
		}
		const ok = await returnTune(supabase, baseSheet.id);
		if (ok) goto('/tunes');
		else confirmingReturn = false;
	}

	onDestroy(() => { playGeneration++; player.dispose(); tuneDeskView.focus = false; });
</script>

<svelte:head>
	<title>{baseSheet?.title ?? 'Tune'} — Mankunku</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} onpointerdown={event => {
	if (settingsPanel?.open && event.target instanceof Node && !settingsPanel.contains(event.target)) settingsPanel.open = false;
}} />

{#if printPreview && sheet}
	<PrintableTune tune={sheet} instrument={getInstrument()} showCenters={showKeyCenters} onclose={() => printPreview = false} />
{/if}
<div hidden={printPreview && !!sheet} class="lick-editor tune-desk tune-detail studio-desk sd-page" class:td-focus={focused} class:sd-playing={busy}>
	{#if !focused}<a class="le-back" href="/tunes"><EditorIcon name="back" size={14} />Your tunes</a>{/if}
	{#if sheet && baseSheet}
		{#if !practiceStatus?.reportVisible}
		<header class="sd-header">
			<div class="sd-title"><h1>{baseSheet.title}</h1><p>{baseSheet.composer || 'Your arrangement'}{authorName ? ` · Shared by ${authorName}` : ''}</p></div>
			<button class="sd-play" data-running={busy} disabled={changingMode || (practice && !practiceStatus?.ready)} onclick={togglePlay}>
				<EditorIcon name={busy ? 'stop' : 'play'} size={15} />{busy ? 'Stop' : 'Play'}
			</button>
			{#if !busy}
				{#if sharedSheet}<button class="le-button le-save" onclick={handleAdopt} disabled={adopting}>{adopting ? 'Adding…' : 'Add to my book'}</button>{/if}
				<details class="sd-advanced" bind:this={settingsPanel}><summary><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" aria-hidden="true"><path d="M3 7h18M3 17h18"/><g fill="var(--studio-well)"><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/></g></svg>Tune settings</summary>
					<div class="sd-drawer"><fieldset disabled={!!practiceStatus?.running || !!practiceStatus?.loading}>
						{@render chartSettings('setup')}
						{@render highlightStyle()}
						<TuneBandControls {player} style={backingStyle} tuneId={baseSheet.id} personal={!isOwnSheet} onsave={saveBackingStyle} />
						<div class="sd-actions">
							{#if isOwnSheet}<button onclick={handleEdit}>Edit tune</button>{:else if isCurated}<button onclick={handleCopy}>Edit a copy</button>{/if}
							<button onclick={() => { if (settingsPanel) settingsPanel.open = false; printPreview = true; }}>Print lead sheet</button>
							<button onclick={() => { setFocus(!manualFocus); if (settingsPanel) settingsPanel.open = false; }}>{manualFocus ? 'Exit focus' : 'Focus'}</button>
							{#if practice}
								<TourTrigger tourId="tune-practice" steps={tunePracticeTour} label="How this works" hideIfSeen={false} /><HelpLink href="/docs/tune-practice" label="Tune practice docs" />
							{/if}
							{#if !practice}<label class="sd-switch">Loop <RockerSwitch compact label="Loop" checked={repeatSession} onChange={on => repeatSession = on} /></label>{/if}
						</div>
					</fieldset></div>
				</details>
			{:else}
				<details class="sd-advanced" bind:this={settingsPanel}>
					<summary>Chart display</summary>
					<div class="sd-drawer">
						<label class="sd-switch">Key centers <RockerSwitch compact label="Show key centers" checked={showKeyCenters} onChange={on => showKeyCenters = saveTuneDisplay('key-centers', on)} /></label>
						{@render highlightStyle()}
						{#if bookSheet}
							<label class="sd-switch">Lick Practice <RockerSwitch compact label="Lick Practice" checked={practice}
								disabled={changingMode} onChange={switchSessionMode} /></label>
							<p class="sd-mode-hint">Changing practice mode ends this take and returns to setup.</p>
						{/if}
					</div>
				</details>
			{/if}
		</header>
		{#if !manualFocus}
			<div class="sd-setup" inert={busy}>
				<TuneSessionDesk {player} {hasMelody} disabled={busy || changingMode} centers={showKeyCenters} {practice} canPractice={!!bookSheet}
					oncenters={on => showKeyCenters = saveTuneDisplay('key-centers', on)} onpractice={setPractice} />
			</div>
		{/if}
		{/if}
		<section class="le-panel td-detail-chart" aria-label="Tune chart">
			{#if practice && bookSheet}
				{#key bookSheet.id}<TunePracticeSession bind:this={practiceSession} baseSheet={bookSheet} onprint={() => printPreview = true} {player} {cacheVersion} {concertKey} {backingStyle} {showKeyCenters} onexit={() => setPractice(false)} />{/key}
			{:else}
				{#if player.busy}
					<div class="td-status">
						<span><i aria-hidden="true"></i><strong>{player.starting ? 'Loading…' : player.countingIn ? 'Count-in' : `${player.phase === 'solo' ? `Solo ${player.soloChorus} of ${player.soloChoruses}` : player.phase === 'outro' ? 'Outro' : 'Head'} · Bar ${Math.floor(player.chartBar ?? 0) + openingBarNumber}`}</strong>
							Written in {writtenKey.replace('b', '♭').replace('#', '♯')}</span>
						<span>{sheet.timeSignature.join('/')} · {totalBars} bars</span>
					</div>
				{/if}
				<div class="td-score-well" use:observeChartWidth={(width) => { chartWidth = width; }}>
					{#if showChordChart}
						<TuneChordChart tune={displayedSheet!} instrument={getInstrument()} solo={player.playing}
							currentBar={player.chartBar} followBar={player.followBar} playing={player.playing} {markers} />
					{:else}
						<NotationDisplay tune={displayedSheet!} instrument={getInstrument()} frameless keyCenterRails
							staffWidth={chartWidth < 550 ? Math.max(260, chartWidth - 24) : undefined}
							tuneOptions={{ omitMasthead: true, barsPerLine: chartWidth < 550 ? 2 : 4 }}
							rangeMarkers={markers} keyCenterLaneCount={keyCenters?.laneCount ?? 0}
							playheadStyle="beat-line" playheadPosition={player.chartBar} autoScrollPlayhead={player.playing} playheadBarFraction={player.followBar} />
					{/if}
				</div>

				{#if showKeyCenters && keyCenters}<KeyCenterLegend display={keyCenters} />{/if}
				{#if player.error}<p role="alert">{player.error}</p>{/if}
			{/if}
		</section>
	{:else if sharedLoading}<p role="status">Loading tune…</p>
	{:else}<p>Tune not found: {page.params.id}</p>{/if}
</div>

{#snippet chartSettings(prefix: string)}
	{#if sheet && baseSheet}
		<section class="td-chart-settings"><p class="studio-label td-rule-label">The chart</p><div class="td-key-row"><label for={`${prefix}-tune-key`}>Written key</label><select id={`${prefix}-tune-key`} value={writtenKey} onchange={e => selectWrittenKey(e.currentTarget.value as PitchClass)}>{#each PITCH_CLASSES as pc (pc)}<option value={pc}>{pc.replace('b', '♭').replace('#', '♯')}</option>{/each}</select></div><p class="td-written-for">Written for {getInstrument().name}.</p><dl class="td-chart-facts"><div><dt>Length</dt><dd>{totalBars} bars</dd></div><div><dt>Time</dt><dd>{sheet.timeSignature.join('/')}</dd></div><div><dt>Form</dt><dd>{displayedSheet?.sections.map(s => s.label).filter(Boolean).join(' · ') || '—'}</dd></div><div><dt>Chart marking</dt><dd>{sheet.style || '—'}</dd></div></dl></section>
		<details class="td-chart-details"><summary>Chart details & harmony guide</summary><TuneHarmonyGuide /><div class="td-tags">{#each baseSheet.tags.filter(t => t !== 'practice' && t !== 'user-entered') as tag (tag)}<span>{tag}</span>{/each}</div></details>
		<div class="td-library-actions">{#if isOwnSheet}<button onclick={handleDelete}>{confirmingDelete ? 'Confirm Delete' : 'Delete'}</button>{:else if isAdopted && bookSheet}<button onclick={handleReturn}>{confirmingReturn ? 'Confirm Return' : 'Return to community'}</button>{/if}</div>
	{/if}
{/snippet}

{#snippet highlightStyle()}
	{@const grid = practice ? !!practiceStatus?.soloChart : showChordChart}
	<label class="td-highlight-style">
		Highlight style
		<select disabled={!showKeyCenters} value={grid ? settings.soloHighlight : settings.leadSheetHighlight}
			onchange={event => {
				const value = event.currentTarget.value;
				if (value === 'top-strip' || value === 'full-bar') settings.soloHighlight = value;
				else if (value === 'staff-wash' || value === 'chord-stroke') settings.leadSheetHighlight = value;
				saveSettings();
			}}>
			{#if grid}
				<option value="full-bar">Full bar</option><option value="top-strip">Top strip</option>
			{:else}
				<option value="chord-stroke">Chord stroke</option><option value="staff-wash">Staff wash</option>
			{/if}
		</select>
	</label>
{/snippet}

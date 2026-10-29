<script lang="ts">
	import { savedTuneKey, saveTuneKey, savedTuneDisplay, saveTuneDisplay } from '$lib/tunes/preferences';
	import { jamSheets } from '$lib/tunes/jam-sheets';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onDestroy, onMount, tick } from 'svelte';
	import TuneBandControls from '$lib/components/tunes/TuneBandControls.svelte';
	import { TunePlayer } from '$lib/state/tune-player.svelte';
	import { tuneDeskView } from '$lib/state/tune-desk-view.svelte';
	import { tuneBackingStyle } from '$lib/tunes/backing-style';
	import type { BackingStyle } from '$lib/types/instruments';
	import { settings, saveSettings, saveTuneTempo } from '$lib/state/settings.svelte';
	import type { RangeMarker } from '$lib/components/notation/NotationDisplay.svelte';
	import EditorIcon from '$lib/components/step-entry/EditorIcon.svelte';
	import TuneTransport from '$lib/components/tunes/TuneTransport.svelte';
	import TuneHarmonyGuide from '$lib/components/tunes/TuneHarmonyGuide.svelte';
	import { tuneHarmonyMarkers } from '$lib/tunes/harmony-colors';
	import { loadDraftForReview } from '$lib/state/tune-entry.svelte';
	import '$lib/components/step-entry/lick-editor.css';
	import '$lib/components/tunes/tune-desk.css';
	import '$lib/components/tunes/tune-detail.css';
	import NotationDisplay from '$lib/components/notation/NotationDisplay.svelte';
	import TuneChordChart from '$lib/components/tunes/TuneChordChart.svelte';
	import { isCuratedTuneId, transposeTune } from '$lib/tunes/book-loader';
	import { resolveTuneRef, tunePracticePath } from '$lib/tunes/tune-slug';
	import { getUserTunesLocal, deleteUserTune, saveUserTune } from '$lib/persistence/user-tunes';
	import {
		getTuneAdoptionsLocal,
		getAdoptedTuneAuthorsLocal,
		adoptTune,
		returnTune,
		fetchCommunityTune,
		type SharedTune
	} from '$lib/persistence/tune-community';
	import { getInstrument, getEffectiveHighestNote } from '$lib/state/settings.svelte';
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
		void baseId;
		if (baseKey && baseId) selectedWrittenKey = concertKeyToWritten(savedTuneKey(baseId, baseKey), getInstrument());
	});

	const writtenKey = $derived(selectedWrittenKey ?? 'C');
	const concertKey = $derived(writtenKeyToConcert(writtenKey, getInstrument()));

	const sheet = $derived(
		baseSheet
			? transposeTune(baseSheet, concertKey, getInstrument().concertRangeLow, getEffectiveHighestNote())
			: undefined
	);

	let transport: TuneTransport | undefined = $state();
	// The tempo is remembered per tune, so the next visit opens at the last choice.
	const player = new TunePlayer({
		tuneId: () => baseSheet?.id,
		save: (tuneId, tempo) => saveTuneTempo(tuneId, tempo, supabase ?? undefined)
	});
	let settingsDialog = $state<HTMLDialogElement>();
	let chartWidth = $state(800);
	let viewportWidth = $state(1280);
	let drawerOpen = $state(false);
	/** Render controls before opening the native modal, which owns focus and Escape. */
	async function openSettings(): Promise<void> {
		drawerOpen = true;
		await tick();
		settingsDialog?.showModal();
	}
	const backingStyle = $derived(baseSheet ? tuneBackingStyle(baseSheet, isOwnSheet ? {} : settings.tuneBackingStyles) : 'swing');
	const jamCharts = $derived(sheet ? jamSheets(sheet) : null);
	const closingPreview = $derived(player.soloChoruses === 1 && !sheet?.sections.some(section => section.notes.some(note => note.pitch !== null)));
	const displayedSheet = $derived(player.closing || closingPreview ? jamCharts?.closing : jamCharts?.returning);
	const totalBars = $derived(displayedSheet?.sections.reduce((sum, section) => sum + section.bars, 0) ?? 0);
	let harmonyColors = $state(true);
	onMount(() => {
		harmonyColors = savedTuneDisplay('harmony-colors', true);
		tuneDeskView.focus = savedTuneDisplay('focus', false);
	});
	/** Persist an explicit focus change; route teardown only clears the live view. */
	function setFocus(enabled: boolean): void { tuneDeskView.focus = saveTuneDisplay('focus', enabled); }
	/** Stop playback and persist the selected written key in concert pitch. */
	function selectWrittenKey(key: PitchClass): void {
		player.stop();
		selectedWrittenKey = key;
		if (baseId) saveTuneKey(baseId, writtenKeyToConcert(key, getInstrument()));
	}
	const markers: RangeMarker[] = $derived([
		...(displayedSheet && harmonyColors ? tuneHarmonyMarkers(displayedSheet) : []),
		...(player.chartBar === null ? [] : [{ id: 'tune-playhead', startBar: Math.floor(player.chartBar), endBarExclusive: Math.floor(player.chartBar) + 1, status: 'playhead' as const }])
	]);

	/** Own tunes carry their style; shared/curated charts keep a personal account preference. */
	function saveBackingStyle(style: BackingStyle): void {
		if (!baseSheet || player.busy) return;
		if (isOwnSheet) {
			saveUserTune({ ...baseSheet, backingStyle: style });
			cacheVersion++;
		} else {
			settings.tuneBackingStyles = { ...settings.tuneBackingStyles, [baseSheet.id]: style };
			saveSettings(supabase ?? undefined);
		}
	}

	$effect(() => { page.params.id; settingsDialog?.close(); });
	let confirmingDelete = $state(false);
	let confirmingReturn = $state(false);
	let adopting = $state(false);

	/** A curated tune opens as an unsaved personal copy, preserving the collection original. */
	function handleCopy(): void {
		if (!baseSheet || !isCurated) return;
		transport?.stop();
		loadDraftForReview({ ...baseSheet, backingStyle, id: '', source: 'user' }, getInstrument());
		goto(`/tunes/editor?copy=${baseSheet.id}`);
	}

	/** Keep playback and focus shortcuts clear of dialogs and editable controls. */
	function handleKeydown(event: KeyboardEvent): void {
		if (document.querySelector('dialog[open]')) return;
		if (event.key === 'Escape') { setFocus(false); return; }
		if (event.repeat) return;
		if (event.key !== ' ' || event.ctrlKey || event.metaKey || event.altKey) return;
		if (event.target instanceof HTMLElement && event.target.closest('input,select,textarea,button,a,[role="button"]')) return;
		event.preventDefault();
		void transport?.togglePlay();
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

	onDestroy(() => { player.dispose(); tuneDeskView.focus = false; });
</script>

<svelte:head>
	<title>{baseSheet?.title ?? 'Tune'} — Mankunku</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} bind:innerWidth={viewportWidth} />

<div class="lick-editor tune-desk tune-detail studio-desk" class:td-focus={tuneDeskView.focus}>
	{#if !tuneDeskView.focus}
		<a class="le-back" href="/tunes"><EditorIcon name="back" size={14} />Your tunes</a>
		<header class="td-detail-heading">
			<div><p class="studio-label">Your tune book</p><h1>{baseSheet?.title ?? 'Tune'}</h1><p class="td-heading-meta">{baseSheet?.composer ?? 'Your arrangement'} <span>·</span> {totalBars} bars <span>·</span> <span class="le-badge">{isCurated ? 'Curated' : isOwnSheet ? 'Your arrangement' : 'Community'}</span></p>{#if authorName}<p class="td-composer">Shared by {authorName}</p>{/if}</div>
			<div class="td-detail-actions">{#if baseSheet}
				{#if isOwnSheet}<button class="le-button le-quiet" onclick={handleEdit}>Edit tune</button>
				{:else if isCurated}<button class="le-button le-quiet" onclick={handleCopy}>Edit a copy</button>{/if}
				{#if bookSheet}<button class="td-practice-link" onclick={() => goto(tunePracticePath(baseSheet))}>Practice licks <span aria-hidden="true">→</span></button>
				{:else if sharedSheet}<button class="le-button le-save" onclick={handleAdopt} disabled={adopting}>{adopting ? 'Adding…' : 'Add to my book'}</button>{/if}
			{/if}</div>
		</header>
	{/if}
	{#if sheet && baseSheet}
		<div class="td-detail-layout">
			<div class="td-workspace">
				<section class="le-panel td-detail-chart" aria-label="Tune chart">
					<div class="td-score-top">
						<div class="td-chart-context">{#if tuneDeskView.focus}<h1>{baseSheet.title}</h1>{:else}<strong>{displayedSheet?.sections[0]?.label || '♪'}</strong><span>Full tune <i>/</i> {totalBars} bars</span>{/if}</div>
						<div class="td-chart-tools"><button aria-pressed={harmonyColors} onclick={() => harmonyColors = saveTuneDisplay('harmony-colors', !harmonyColors)}><i class="td-color-dot" aria-hidden="true"></i><span>Harmony colors</span><i class="td-switch" class:active={harmonyColors} aria-hidden="true"></i></button><button class="td-focus-button" aria-pressed={tuneDeskView.focus} onclick={() => setFocus(!tuneDeskView.focus)}>{tuneDeskView.focus ? 'Exit focus' : '⛶ Focus'}</button></div>
					</div>
					<div class="td-score-well" bind:clientWidth={chartWidth}>{#if player.playing && player.phase === 'solo'}<TuneChordChart tune={displayedSheet!} instrument={getInstrument()} currentBar={player.chartBar} />{:else}<NotationDisplay tuneOptions={{ omitMasthead: true, barsPerLine: chartWidth < 550 ? 2 : 4 }} tune={displayedSheet!} instrument={getInstrument()} frameless rangeMarkers={markers} cursorIndex={player.cursorIndex} playheadStyle="under-bar" autoScrollPlayhead={player.playing} playheadBarFraction={player.chartBar} />{/if}</div>
					<div class="td-status"><span><i aria-hidden="true"></i><strong>{player.starting ? 'Loading…' : player.playing ? `${player.phase === 'solo' ? `Solo ${player.soloChorus} of ${player.soloChoruses}` : player.phase === 'outro' ? 'Outro' : 'Head'} · Bar ${Math.floor(player.chartBar ?? 0) + 1}` : 'Ready to play'}</strong> Written in {writtenKey.replace('b', '♭').replace('#', '♯')}</span><span>{sheet.timeSignature.join('/')} · {totalBars} bars</span></div>
					<TuneTransport bind:this={transport} tune={sheet} {player} style={backingStyle} onsettings={tuneDeskView.focus || viewportWidth <= 800 ? openSettings : undefined} />
				</section>
				<div class="td-reading-footer"><span>Space to play or stop</span><em>Listen. Find the changes. Make them yours.</em></div>
			</div>
			{#if !tuneDeskView.focus && viewportWidth > 800 && !drawerOpen}<aside class="td-detail-rail" aria-label="Tune settings">
				<TuneBandControls {player} style={backingStyle} tuneId={baseSheet.id} personal={!isOwnSheet} onsave={saveBackingStyle} />
				{@render chartSettings('rail')}
			</aside>{/if}
		</div>
		<dialog bind:this={settingsDialog} class="le-dialog td-settings-drawer" aria-labelledby="desk-settings-title" onclose={() => drawerOpen = false}>{#if drawerOpen}<header><h2 id="desk-settings-title">Tune settings</h2><button aria-label="Close tune settings" onclick={() => settingsDialog?.close()}>×</button></header><TuneBandControls {player} style={backingStyle} tuneId={baseSheet.id} personal={!isOwnSheet} idPrefix="drawer" onsave={saveBackingStyle} />{@render chartSettings('drawer')}{/if}</dialog>
	{:else if sharedLoading}<section class="le-panel le-chart"><p role="status">Loading tune…</p></section>
	{:else}<section class="le-panel le-chart"><p>Tune not found: {page.params.id}</p><a href="/tunes">Back to Tunes</a></section>{/if}
	{#if !tuneDeskView.focus}<footer class="le-footer"><span>MANKUNKU <i>/</i> YOUR REPERTOIRE, IN YOUR HANDS.</span><a href="/tunes">Back to your tunes ↗</a></footer>{/if}
</div>

{#snippet chartSettings(prefix: string)}
	{#if sheet && baseSheet}
		<section class="td-chart-settings"><p class="studio-label td-rule-label">The chart</p><div class="td-key-row"><label for={`${prefix}-tune-key`}>Key</label><select id={`${prefix}-tune-key`} value={writtenKey} onchange={e => selectWrittenKey(e.currentTarget.value as PitchClass)}>{#each PITCH_CLASSES as pc (pc)}<option value={pc}>{pc.replace('b', '♭').replace('#', '♯')}</option>{/each}</select></div><p class="td-written-for">Written for {getInstrument().name}.</p><dl class="td-chart-facts"><div><dt>Time</dt><dd>{sheet.timeSignature.join('/')}</dd></div><div><dt>Form</dt><dd>{displayedSheet?.sections.map(s => s.label).filter(Boolean).join(' · ') || '—'}</dd></div><div><dt>Chart marking</dt><dd>{sheet.style || '—'}</dd></div></dl></section>
		<details class="td-chart-details"><summary>Chart details & harmony guide</summary><TuneHarmonyGuide /><div class="td-tags">{#each baseSheet.tags.filter(t => t !== 'practice' && t !== 'user-entered') as tag (tag)}<span>{tag}</span>{/each}</div></details>
		<div class="td-library-actions">{#if isOwnSheet}<button onclick={handleDelete}>{confirmingDelete ? 'Confirm Delete' : 'Delete'}</button>{:else if isAdopted && bookSheet}<button onclick={handleReturn}>{confirmingReturn ? 'Confirm Return' : 'Return to community'}</button>{/if}</div>
	{/if}
{/snippet}

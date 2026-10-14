<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import StudioPage from '$lib/components/console/StudioPage.svelte';
	import EditorIcon from '$lib/components/step-entry/EditorIcon.svelte';
	import TuneTransport from '$lib/components/tunes/TuneTransport.svelte';
	import TuneHarmonyGuide from '$lib/components/tunes/TuneHarmonyGuide.svelte';
	import { tuneHarmonyMarkers } from '$lib/tunes/harmony-colors';
	import { loadDraftForReview } from '$lib/state/tune-entry.svelte';
	import '$lib/components/step-entry/lick-editor.css';
	import '$lib/components/tunes/tune-desk.css';
	import NotationDisplay from '$lib/components/notation/NotationDisplay.svelte';
	import { isCuratedTuneId, transposeTune } from '$lib/tunes/book-loader';
	import { resolveTuneRef, tunePracticePath } from '$lib/tunes/tune-slug';
	import { getUserTunesLocal, deleteUserTune } from '$lib/persistence/user-tunes';
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

	$effect(() => {
		if (baseSheet) {
			selectedWrittenKey = concertKeyToWritten(baseSheet.key, getInstrument());
		}
	});

	const writtenKey = $derived(selectedWrittenKey ?? 'C');
	const concertKey = $derived(writtenKeyToConcert(writtenKey, getInstrument()));

	const sheet = $derived(
		baseSheet
			? transposeTune(baseSheet, concertKey, getInstrument().concertRangeLow, getEffectiveHighestNote())
			: undefined
	);

	let transport: TuneTransport | undefined = $state();
	let harmonyColors = $state(true);
	const markers = $derived(sheet && harmonyColors ? tuneHarmonyMarkers(sheet) : []);
	let confirmingDelete = $state(false);
	let confirmingReturn = $state(false);
	let adopting = $state(false);

	/** A curated tune opens as an unsaved personal copy, preserving the collection original. */
	function handleCopy(): void {
		if (!baseSheet || !isCurated) return;
		transport?.stop();
		loadDraftForReview({ ...baseSheet, id: '', source: 'user' }, getInstrument());
		goto(`/tunes/editor?copy=${baseSheet.id}`);
	}

	function handleKeydown(event: KeyboardEvent): void {
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

	onDestroy(() => transport?.stop());
</script>

<svelte:head>
	<title>{baseSheet?.title ?? 'Tune'} — Mankunku</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<div class="lick-editor tune-desk">
	<a class="le-back" href="/tunes"><EditorIcon name="back" size={14} />Your tunes</a>
	<StudioPage eyebrow="The book / Your repertoire" title="The tune desk" description="Listen to the melody. Find your way through the changes.">
		{#snippet actions()}
			{#if baseSheet}
				{#if isOwnSheet}<button class="le-button le-quiet" onclick={handleEdit}>Edit tune</button>
				{:else if isCurated}<button class="le-button le-quiet" onclick={handleCopy}>Edit a copy</button>{/if}
				{#if bookSheet}<button class="le-button le-save" onclick={() => goto(tunePracticePath(baseSheet))}>Practice licks <span aria-hidden="true">→</span></button>
				{:else if sharedSheet}<button class="le-button le-save" onclick={handleAdopt} disabled={adopting}>{adopting ? 'Adding…' : 'Add to my book'}</button>{/if}
			{/if}
		{/snippet}
		{#if sheet && baseSheet}
			<div class="le-layout"><div class="le-workspace">
				<section class="le-panel le-chart" aria-label="Tune chart">
					<header class="td-chart-heading"><div><p class="studio-label">01 / Your chart <span class="le-badge">{isCurated ? 'Curated' : isOwnSheet ? 'Your arrangement' : 'Community'}</span></p><h2 class="td-title">{baseSheet.title}</h2>{#if baseSheet.composer}<p class="td-composer">{baseSheet.composer}</p>{/if}{#if authorName}<p class="td-composer">Shared by {authorName}</p>{/if}</div></header>
					<div class="td-score-top"><span>Melody & changes</span><button aria-pressed={harmonyColors} onclick={() => harmonyColors = !harmonyColors}><i class="td-color-dot" aria-hidden="true"></i>Harmony colors <i class="td-switch" class:active={harmonyColors} aria-hidden="true"></i></button></div>
					<div class="td-score-well"><NotationDisplay tuneOptions={{ omitMasthead: true }} tune={sheet} instrument={getInstrument()} frameless rangeMarkers={markers} /></div>
					<div class="td-status"><span><i aria-hidden="true"></i>Lead sheet · Written key {writtenKey.replace('b', '♭').replace('#', '♯')}</span><span>{sheet.timeSignature.join('/')} {#if sheet.style}· {sheet.style}{/if}</span></div>
					<TuneTransport bind:this={transport} tune={sheet} />
				</section>
				{#if isCurated || isOwnSheet}<div class="td-read-note"><span class="studio-label">Make it yours</span><p>Change a melody. Try a different chord.</p><button onclick={isOwnSheet ? handleEdit : handleCopy}>{isOwnSheet ? 'Open tune editor' : 'Edit your own copy'} →</button></div>{/if}
			</div><aside class="le-inspector" aria-label="Tune settings">
				<section class="le-setup"><p class="studio-label">Setup</p><h2>The musical context.</h2><label for="tune-key">Key</label><select id="tune-key" value={writtenKey} onchange={e => { transport?.stop(); selectedWrittenKey = e.currentTarget.value as PitchClass; }}>{#each PITCH_CLASSES as pc (pc)}<option value={pc}>{pc.replace('b', '♭').replace('#', '♯')}</option>{/each}</select><p>The melody and chords move together.</p><div class="td-fields"><div><span class="td-field-label">Time</span><div class="td-static">{sheet.timeSignature.join(' / ')}</div></div><div><span class="td-field-label">Form</span><div class="td-static">{sheet.sections.map(s => s.label).filter(Boolean).join(' · ') || '—'}</div></div></div>{#if sheet.style}<span class="td-field-label">Style</span><div class="td-static">{sheet.style}</div>{/if}<p>Written for {getInstrument().name}.</p></section>
				<TuneHarmonyGuide />
				<section class="td-rail-section"><p class="studio-label">About this chart</p><div class="td-tags">{#each baseSheet.tags.filter(t => t !== 'practice' && t !== 'user-entered') as tag (tag)}<span>{tag}</span>{/each}</div><div class="td-library-actions">{#if isOwnSheet}<button onclick={handleDelete}>{confirmingDelete ? 'Confirm Delete' : 'Delete'}</button>{:else if isAdopted && bookSheet}<button onclick={handleReturn}>{confirmingReturn ? 'Confirm Return' : 'Return to community'}</button>{/if}</div></section>
			</aside></div>
		{:else if sharedLoading}<section class="le-panel le-chart"><p role="status">Loading tune…</p></section>
		{:else}<section class="le-panel le-chart"><p>Tune not found: {page.params.id}</p><a href="/tunes">Back to Tunes</a></section>{/if}
		<footer class="le-footer"><span>MANKUNKU <i>/</i> YOUR REPERTOIRE, IN YOUR HANDS.</span><a href="/tunes">Back to your tunes ↗</a></footer>
	</StudioPage>
</div>

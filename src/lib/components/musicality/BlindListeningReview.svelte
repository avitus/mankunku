<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { LISTENING_TUNES, buildListeningTuneSession, type ListeningTuneSession } from '$lib/musicality/listening-tunes';
	import { createListeningPlayer, type ListeningSnapshot } from '$lib/musicality/listening-player';
	import {
		createBlindListeningComparison, LISTENING_COMPARISON_CRITERIA,
		serializeListeningComparison
	} from '$lib/musicality/listening-comparison';
	import { getBackingMix } from '$lib/audio/backing-track';
	import { settings } from '$lib/state/settings.svelte';
	import { PITCH_CLASSES, type PitchClass } from '$lib/types/music';
	import type { BackingStyle } from '$lib/types/instruments';

	let { buildVersion, onexit }: { buildVersion: string; onexit: () => void } = $props();
	type Comparison = ReturnType<typeof createBlindListeningComparison>;
	type ComparisonSnapshot = ReturnType<Comparison['snapshot']>;
	type Label = 'A' | 'B';
	type Criterion = (typeof LISTENING_COMPARISON_CRITERIA)[number]['id'];
	interface SavedReview {
		id: string;
		revealedAt: string;
		inputs: { phrase: { name: string }; style: string };
		preference: Label | 'tie';
		mapping: Record<Label, 'original' | 'coordinated'>;
		[key: string]: unknown;
	}
	const labels: Label[] = ['A', 'B'];
	const ARCHIVE_KEY = 'mankunku:musicality-blind-listening-reviews:v1';
	const defaultTune = LISTENING_TUNES.find((tune) => tune.title === 'Mankunku Blues') ?? LISTENING_TUNES[0];
	const styles: { value: BackingStyle; label: string }[] = [
		{ value: 'swing', label: 'Swing' }, { value: 'straight', label: 'Straight' },
		{ value: 'bossa-nova', label: 'Bossa nova' }, { value: 'ballad', label: 'Ballad' }
	];
	let tuneId = $state(defaultTune.id);
	let key = $state<PitchClass>(defaultTune.key);
	let style = $state<BackingStyle>(settings.backingStyle);
	let tempo = $state(140);
	let solos = $state(2);
	let comparison: Comparison | null = null;
	let review = $state.raw<ComparisonSnapshot | null>(null);
	let takeSession = $state.raw<ListeningTuneSession | null>(null);
	let activeLabel = $state<Label | null>(null);
	let playback = $state.raw<ListeningSnapshot | null>(null);
	let error = $state('');
	let storageMessage = $state('');
	let saved = $state(false);
	let archive = $state.raw<SavedReview[]>([]);
	let archiveError = $state('');
	const busy = $derived(playback?.status === 'playing' || playback?.status === 'loading');
	const player = createListeningPlayer({ onChange: (next) => {
		playback = next;
		if (next.status === 'completed' && comparison && activeLabel && !review?.record) {
			try {
				const accepted = comparison.recordPlayback(activeLabel, next);
				review = comparison.snapshot();
				if (!accepted && !review.completed[activeLabel]) error = 'This take could not be verified as complete. Replay it before rating.';
			} catch (cause) { error = message(cause); }
		}
	} });
	const currentBar = $derived(playback?.barIndex == null ? null : takeSession?.bars[playback.barIndex]);
	const position = $derived(currentBar
		? `Bar ${currentBar.barNumber} of ${takeSession!.bars.length} · ${currentBar.sectionLabel}`
		: 'Ready for the full tune');
	const status = $derived(playback?.status === 'loading' ? 'Loading the band…'
		: playback?.status === 'playing' ? playback.ending ? 'Letting the last chord ring' : `Playing take ${activeLabel}`
		: playback?.status === 'completed' ? `Take ${activeLabel} complete`
		: playback?.status === 'stopped' ? 'Stopped — replay the complete take to finish'
		: playback?.status === 'error' ? 'Unable to play' : 'Choose a take to begin');
	function message(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
	function changeTune() { key = LISTENING_TUNES.find((tune) => tune.id === tuneId)!.key; }
	function startComparison() {
		if (!Number.isFinite(tempo) || tempo < 40 || tempo > 240) return;
		error = ''; storageMessage = ''; saved = false;
		try {
			const captured = buildListeningTuneSession({ tuneId, key, soloChoruses: solos });
			comparison = createBlindListeningComparison({ phrase: captured.phrase, style, tempo,
				swing: settings.swing, instrument: 'piano', volume: settings.backingTrackVolume,
				mix: { ...getBackingMix() } }, { buildVersion });
			takeSession = captured;
			review = comparison.snapshot();
			playback = null; activeLabel = null;
		} catch (cause) { error = message(cause); }
	}
	async function play(label: Label) {
		if (!comparison || busy) return;
		error = ''; activeLabel = label;
		try { await player.start(comparison.paramsFor(label)); }
		catch (cause) { error = message(cause); }
	}
	function rate(label: Label, criterion: Criterion, value: string) {
		if (!comparison || !value) return;
		try { comparison.rate(label, criterion, Number(value)); review = comparison.snapshot(); }
		catch (cause) { error = message(cause); }
	}
	function prefer(value: string) {
		if (!comparison || !['A', 'B', 'tie'].includes(value)) return;
		comparison.setPreference(value as Label | 'tie'); review = comparison.snapshot();
	}
	function setNotes(value: string) {
		if (!comparison) return;
		comparison.setNotes(value); review = comparison.snapshot();
	}
	function reveal() {
		if (!comparison || busy) return;
		try { comparison.reveal(); review = comparison.snapshot(); }
		catch (cause) { error = message(cause); }
	}
	function newComparison() {
		player.stop(); comparison = null; review = null; takeSession = null;
		playback = null; activeLabel = null; error = ''; storageMessage = ''; saved = false;
	}
	function isSavedReview(value: unknown): value is SavedReview {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
		const item = value as Record<string, unknown>;
		if (item.version !== 1 || item.revealed !== true || typeof item.id !== 'string' || !item.id.length || item.id.length > 200
			|| typeof item.revealedAt !== 'string' || !Number.isFinite(Date.parse(item.revealedAt))
			|| !['A', 'B', 'tie'].includes(String(item.preference)) || !item.inputs || typeof item.inputs !== 'object'
			|| !item.mapping || typeof item.mapping !== 'object') return false;
		const inputs = item.inputs as Record<string, unknown>;
		const mapping = item.mapping as Record<string, unknown>;
		if (!styles.some((entry) => entry.value === inputs.style) || !inputs.phrase || typeof inputs.phrase !== 'object') return false;
		const phrase = inputs.phrase as Record<string, unknown>;
		return typeof phrase.name === 'string' && phrase.name.length > 0 && phrase.name.length <= 500
			&& ['original', 'coordinated'].includes(String(mapping.A))
			&& ['original', 'coordinated'].includes(String(mapping.B)) && mapping.A !== mapping.B;
	}
	function readArchive(): SavedReview[] {
		const existing: unknown = JSON.parse(localStorage.getItem(ARCHIVE_KEY) ?? '[]');
		if (!Array.isArray(existing)) throw new Error('Invalid saved review archive');
		const seen = new Set<string>();
		return existing.slice(0, 20).filter(isSavedReview).filter((item) => {
			if (seen.has(item.id)) return false;
			seen.add(item.id); return true;
		});
	}
	onMount(() => {
		try { archive = readArchive(); }
		catch { archiveError = 'Saved reviews are unavailable in this browser. You can still export a completed review.'; }
	});
	function saveReview() {
		if (!review?.record) return;
		try {
			const records = readArchive().filter((item) => item.id !== review!.record!.id);
			const { takes, ...summary } = review.record;
			const completion = Object.fromEntries(labels.map((label) => {
				const { status, ppq, startAudioTime, audioTime, elapsedBeats, durationBeats } = takes[label];
				return [label, { status, ppq, startAudioTime, audioTime, elapsedBeats, durationBeats }];
			}));
			const next = [{ ...summary, completion }, ...records].slice(0, 20);
			localStorage.setItem(ARCHIVE_KEY, JSON.stringify(next));
			archive = next; archiveError = '';
			saved = true; storageMessage = 'Review summary saved on this browser. The latest 20 are kept; export for both complete score traces.';
		} catch {
			storageMessage = 'This browser could not save the review. Export it to keep a copy.';
		}
	}
	function exportReview() {
		if (!review?.record) return;
		try { download(serializeListeningComparison(review.record), `musicality-blind-review-${review.record.id}.json`); }
		catch { error = 'The full review could not be exported. Your review remains available on this page.'; }
	}
	function exportSummary(item: SavedReview) {
		try { download(JSON.stringify(item, null, 2), `musicality-review-summary-${item.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`); }
		catch { archiveError = 'This review summary could not be exported. Please try again.'; }
	}
	function download(content: string, filename: string) {
		const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
		try {
			const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
		} finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
	}
	onDestroy(() => player.dispose());
</script>

<section class="blind-review" aria-labelledby="blind-title">
	<div class="intro">
		<div><span class="eyebrow">Listen before looking</span><h2 id="blind-title">Blind comparison</h2></div>
		<button class="text-button" onclick={onexit}>Back to listening</button>
	</div>
	<p class="explanation">Two arrangements of the same full tune, labelled A and B. Listen to both, record your impressions, then reveal which you preferred.</p>
	<div class="setup" aria-label="Blind comparison setup">
		<label class="tune">Tune<select data-testid="blind-tune" bind:value={tuneId} onchange={changeTune} disabled={review !== null}>{#each LISTENING_TUNES as tune}<option value={tune.id}>{tune.title}</option>{/each}</select></label>
		<label>Style<select data-testid="blind-style" bind:value={style} disabled={review !== null}>{#each styles as item}<option value={item.value}>{item.label}</option>{/each}</select></label>
		<label>Key<select data-testid="blind-key" bind:value={key} disabled={review !== null}>{#each PITCH_CLASSES as pitch}<option value={pitch}>{pitch.replace('b', '♭').replace('#', '♯')}</option>{/each}</select></label>
		<label>Tempo<input data-testid="blind-tempo" type="number" min="40" max="240" step="1" bind:value={tempo} disabled={review !== null} /></label>
		<label>Solo choruses<select data-testid="blind-choruses" bind:value={solos} disabled={review !== null}>{#each [1, 2, 3, 4] as count}<option value={count}>{count}</option>{/each}</select></label>
	</div>
	{#if !review}
		<div class="begin"><button class="primary" data-testid="blind-start" onclick={startComparison} disabled={!Number.isFinite(tempo) || tempo < 40 || tempo > 240}>Start comparison</button><p>The tune, key, tempo, mix and generation inputs stay fixed for both takes. Rhythm section only.</p></div>
	{:else}
		<p class="locked-note">Settings locked · Head in → {solos} solo {solos === 1 ? 'chorus' : 'choruses'} → Head out · {takeSession?.bars.length} bars per take</p>
		<div class="transport" aria-label="Blind playback">
			<div><strong role="status" data-testid="blind-status">{status}</strong><small data-testid="blind-position" data-bar-index={playback?.barIndex ?? ''} data-start-audio-time={playback?.startAudioTime ?? ''}>{position}</small></div>
			{#if busy}<button class="stop" data-testid="blind-stop" onclick={() => player.stop()}>■ Stop</button>{/if}
		</div>
		<div class="takes">
			{#each labels as label}
				<section class="take" aria-labelledby={`blind-take-${label}`}>
					<div class="take-heading"><h3 id={`blind-take-${label}`}>Take {label}</h3><span data-testid={`blind-completed-${label}`}>{review.completed[label] ? 'Full take heard' : 'Full listen pending'}</span></div>
					<button class="play" data-testid={`blind-play-${label}`} onclick={() => play(label)} disabled={busy}>{review.completed[label] ? '↻ Replay' : '▶ Listen to'} {label}</button>
					{#if review.record}<p class="revealed-name" data-testid={`blind-mapping-${label}`}>{review.record.mapping[label] === 'coordinated' ? 'Coordinated' : 'Original'}</p>{/if}
				</section>
			{/each}
		</div>
		<section class="ratings" aria-labelledby="blind-ratings-title">
			<div class="section-heading"><h3 id="blind-ratings-title">What did you hear?</h3><span>1 · Low &nbsp; → &nbsp; 5 · High</span></div>
			<p>Rate each take after a full listen. For ease of listening, a higher score means less tiring.</p>
			<div class="rating-table">
				<div class="rating-heading"><span>Musical quality</span><span>Take A</span><span>Take B</span></div>
				{#each LISTENING_COMPARISON_CRITERIA as criterion}
					<div class="rating-row"><div><strong>{criterion.label}</strong><small>{criterion.hint}</small></div>
						{#each labels as label}<select aria-label={`Take ${label}: ${criterion.label}`} data-testid={`blind-rating-${label}-${criterion.id}`} value={review.ratings[label][criterion.id] ?? ''} onchange={(event) => rate(label, criterion.id, event.currentTarget.value)} disabled={!review.completed[label] || review.record !== null}><option value="" disabled>—</option>{#each [1, 2, 3, 4, 5] as score}<option value={score}>{score}</option>{/each}</select>{/each}
					</div>
				{/each}
			</div>
			<div class="verdict">
				<label>Overall preference<select data-testid="blind-preference" value={review.preference ?? ''} onchange={(event) => prefer(event.currentTarget.value)} disabled={!review.completed.A || !review.completed.B || review.record !== null}><option value="" disabled>Choose after both takes</option><option value="A">Take A</option><option value="B">Take B</option><option value="tie">No preference</option></select></label>
				<label class="notes">Listening notes <span>(optional)</span><textarea data-testid="blind-notes" value={review.notes} oninput={(event) => setNotes(event.currentTarget.value)} maxlength="2000" rows="3" placeholder="A moment, a contrast, something to revisit…" disabled={review.record !== null}></textarea></label>
			</div>
			{#if !review.record}
				<div class="reveal"><button class="primary" data-testid="blind-reveal" onclick={reveal} disabled={!review.canReveal || busy}>Reveal arrangements</button><p>Finish both takes and all ratings, then choose your preference. Revealing locks this review.</p></div>
			{:else}
				<div class="result" data-testid="blind-result"><span class="eyebrow">Your listening review</span><h3>{review.preference === 'tie' ? 'You had no preference.' : `You preferred take ${review.preference}.`}</h3><p>A was <strong>{review.record.mapping.A === 'coordinated' ? 'Coordinated' : 'Original'}</strong>. B was <strong>{review.record.mapping.B === 'coordinated' ? 'Coordinated' : 'Original'}</strong>.</p><p class="acceptance">This records your listening impressions. It does not change implementation or musical acceptance status.</p><div class="result-actions"><button data-testid="blind-save" onclick={saveReview} disabled={saved}>{saved ? 'Saved locally' : 'Save review locally'}</button><button data-testid="blind-export" onclick={exportReview}>Export review</button></div>{#if storageMessage}<p role="status">{storageMessage}</p>{/if}</div>
			{/if}
		</section>
		<div class="reset"><button class="text-button" data-testid="blind-new-comparison" onclick={newComparison} disabled={busy}>Set up a new comparison</button><span>{review.record ? 'Save or export this review before starting another.' : 'Starting again discards this unfinished review.'}</span></div>
	{/if}
	{#if !review || review.record}
		<details class="archive" data-testid="blind-saved-reviews"><summary>Saved reviews ({archive.length})</summary>
			<p>Browser-local summaries of your latest 20 reviews. Full score traces are included only in the export made when a review is revealed.</p>
			{#if archiveError}<p role="status">{archiveError}</p>{/if}
			{#each archive as item (item.id)}<article data-testid="blind-saved-review" data-review-id={item.id}><div><strong>{item.inputs.phrase.name}</strong><small>{new Date(item.revealedAt).toLocaleDateString()} · {styles.find((entry) => entry.value === item.inputs.style)?.label} · {item.preference === 'tie' ? 'No preference' : `Preferred ${item.preference}`}</small><small>A: {item.mapping.A === 'coordinated' ? 'Coordinated' : 'Original'} · B: {item.mapping.B === 'coordinated' ? 'Coordinated' : 'Original'}</small></div><button data-testid="blind-export-summary" onclick={() => exportSummary(item)}>Export summary</button></article>{:else}<p>No saved reviews yet.</p>{/each}
		</details>
	{/if}
	{#if error || playback?.error}<p class="error" role="alert">{error || playback?.error}</p>{/if}
</section>

<style>
	.blind-review{padding-top:1.75rem}.intro,.section-heading,.take-heading{display:flex;align-items:center;justify-content:space-between;gap:1rem}.eyebrow{font-size:.6rem;letter-spacing:.14em;text-transform:uppercase;color:var(--color-brass)}h2,h3{font-family:var(--font-display,Georgia,serif);font-weight:400}h2{font-size:2rem;margin:.5rem 0}h3{font-size:1.4rem;margin:0}.explanation{max-width:42rem;margin:.5rem 0 1rem;font-size:.85rem;color:var(--color-text-secondary);line-height:1.8}
	.setup{display:grid;grid-template-columns:2.4fr 1.35fr .75fr .8fr 1.1fr;gap:1rem;padding:1rem 0 1.5rem}label{font-size:.6rem;letter-spacing:.07em;text-transform:uppercase;color:var(--color-text-secondary)}select,input,textarea{width:100%;margin-top:.6rem;padding:.6rem 0;background:transparent;color:var(--color-text);border:0;border-bottom:1px solid var(--color-bg-tertiary);font:inherit;font-size:.85rem;letter-spacing:normal;text-transform:none;border-radius:0}option{background:var(--color-bg-secondary);color:var(--color-text)}textarea{resize:vertical;line-height:1.7}button:disabled,select:disabled,input:disabled,textarea:disabled{opacity:.5;cursor:default}button{cursor:pointer}.primary,.play{background:var(--color-brass);color:var(--color-bg);padding:.85rem 1.25rem;font-size:.8rem;font-weight:600}.begin,.reveal{display:flex;align-items:center;gap:1.25rem}.begin p,.reveal p{max-width:32rem;font-size:.7rem;line-height:1.7;color:var(--color-text-secondary)}.primary{white-space:nowrap}.text-button{color:var(--color-brass);font-size:.72rem;text-decoration:underline;text-underline-offset:.3em}
	.locked-note{font-size:.65rem;color:var(--color-text-secondary);margin-bottom:1rem}.transport{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;padding:1rem 1.25rem;background:var(--color-bg-secondary);border:1px solid var(--color-bg-tertiary);min-height:5rem}.transport strong{font-size:.8rem;font-weight:500}.transport small{display:block;font-size:.65rem;color:var(--color-text-secondary);margin-top:.4rem}.stop{color:var(--color-brass);border:1px solid var(--color-brass);padding:.65rem 1rem}.takes{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin:1.5rem 0 2.5rem}.take{padding:1.2rem 0;border-top:1px solid var(--color-bg-tertiary);border-bottom:1px solid var(--color-bg-tertiary)}.take-heading span{font-size:.6rem;color:var(--color-text-secondary)}.play{margin-top:1.2rem;min-width:8rem}.revealed-name{font-size:.75rem;color:var(--color-brass);margin:.7rem 0 0}
	.section-heading span{font-size:.65rem;color:var(--color-text-secondary)}.ratings>p{font-size:.7rem;line-height:1.7;color:var(--color-text-secondary);margin:.8rem 0 1.1rem}.rating-table{border-top:1px solid var(--color-bg-tertiary)}.rating-heading,.rating-row{display:grid;grid-template-columns:minmax(0,1fr) 5rem 5rem;gap:1.4rem;align-items:center;border-bottom:1px solid var(--color-bg-tertiary);padding:.9rem 0}.rating-heading{font-size:.6rem;letter-spacing:.06em;text-transform:uppercase;color:var(--color-text-secondary)}.rating-heading span:not(:first-child){text-align:center}.rating-row strong{font-size:.8rem;font-weight:500}.rating-row small{display:block;color:var(--color-text-secondary);font-size:.65rem;line-height:1.6;margin-top:.25rem}.rating-row select{margin:0;text-align:center;padding:.55rem;border:1px solid var(--color-bg-tertiary)}.verdict{display:grid;grid-template-columns:1fr 2fr;gap:2rem;margin:1.5rem 0}.notes span{letter-spacing:normal;text-transform:none}.reveal{padding-top:.5rem}.result{border-left:2px solid var(--color-brass);padding:1.1rem 1.3rem;background:var(--color-bg-secondary)}.result h3{margin:.5rem 0 1rem}.result p{font-size:.8rem;line-height:1.7;color:var(--color-text-secondary)}.result .acceptance{font-size:.68rem;margin-top:.8rem}.result-actions{display:flex;gap:1rem;margin-top:1.2rem}.result-actions button{border:1px solid var(--color-bg-tertiary);padding:.65rem .8rem;color:var(--color-brass);font-size:.72rem}.result p[role=status]{font-size:.68rem;margin-top:.8rem}.reset{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding-top:1.5rem;margin-top:1.5rem;border-top:1px solid var(--color-bg-tertiary)}.reset span{font-size:.65rem;line-height:1.7;color:var(--color-text-secondary)}.error{color:var(--color-error);font-size:.8rem;line-height:1.7;margin-top:1rem}button:focus-visible,select:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--color-brass);outline-offset:4px}
	@media(max-width:700px){.setup{grid-template-columns:repeat(2,minmax(0,1fr))}.tune{grid-column:1/-1}.intro{align-items:start}.intro>.text-button{max-width:6rem;line-height:1.7;text-align:right}.begin,.reveal{align-items:start;flex-direction:column;gap:.5rem}.takes{gap:1rem}.take-heading{align-items:start;flex-direction:column;gap:.5rem}.rating-heading,.rating-row{grid-template-columns:minmax(0,1fr) 3.3rem 3.3rem;gap:.7rem}.verdict{grid-template-columns:1fr;gap:1.25rem}.section-heading{align-items:start;gap:1rem}.section-heading span{max-width:7rem;text-align:right;line-height:1.7}.reset{align-items:start;flex-direction:column}.result-actions{flex-wrap:wrap}}
	.archive{margin-top:1.7rem;padding:1.2rem 0;border-top:1px solid var(--color-bg-tertiary);font-size:.72rem;color:var(--color-text-secondary)}.archive summary{cursor:pointer}.archive>p{font-size:.68rem;line-height:1.7;margin-top:.8rem}.archive article{display:flex;align-items:center;justify-content:space-between;gap:1rem;border-bottom:1px solid var(--color-bg-tertiary);padding:1rem 0}.archive strong{font-size:.78rem;color:var(--color-text);font-weight:500}.archive small{display:block;font-size:.65rem;margin-top:.35rem;line-height:1.6}.archive button{color:var(--color-brass);font-size:.65rem;white-space:nowrap;text-decoration:underline;text-underline-offset:.3em}.archive summary:focus-visible{outline:2px solid var(--color-brass);outline-offset:4px}
</style>

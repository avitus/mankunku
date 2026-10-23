<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { getBackingTrackLog } from '$lib/audio/backing-track';
	import type { BackingTrackLog } from '$lib/audio/backing-track';
	import { midiToDisplayName } from '$lib/music/notation';
	import { concertKeyToWritten } from '$lib/music/transposition';
	import { session } from '$lib/state/session.svelte';
	import { getInstrument, settings } from '$lib/state/settings.svelte';
	import {
		getAllRecordingSummaries,
		getRecordingFull,
		deleteRecording,
		type RecordingSummary
	} from '$lib/persistence/audio-store';
	import { getAudioContext, isAudioInitialized } from '$lib/audio/audio-context';
	import {
		buildDiagnosticsPayload,
		decodeToWav,
		fixtureBaseName,
		replayRecording,
		triggerDownload,
		type RecordingReplay
	} from '$lib/diagnostics/recording-export';
	import type { DetectedNote } from '$lib/types/audio';
	import type { PitchClass } from '$lib/types/music';
	import { page } from '$app/state';
	import NoteComparison from '$lib/components/practice/NoteComparison.svelte';

	const supabase = $derived(page.data?.supabase ?? null);
	const user = $derived(page.data?.user ?? null);

	// ── Recording list state ────────────────────────────────
	let summaries = $state<RecordingSummary[]>([]);
	let expandedId = $state<string | null>(null);
	let replay = $state<ReplayState | null>(null);
	let audioUrl = $state<string | null>(null);
	let replayLoading = $state(false);
	let replayError = $state<string | null>(null);
	let downloading = $state(false);
	let downloadError = $state<string | null>(null);
	let sortMode = $state<'newest' | 'best' | 'worst'>('newest');
	let sourceFilter = $state<'all' | 'ear-training' | 'lick-practice'>('all');

	// Legacy backing-track history — recordings without metadata, or sessions
	// where nothing was recorded at all. Kept below the primary list.
	let btHistory = $state<BackingTrackLog[]>([]);

	/** A row's replay (`recording-export.ts`), keyed by the recording it belongs to. */
	interface ReplayState extends RecordingReplay {
		sessionId: string;
	}

	onMount(async () => {
		await refresh();
	});

	onDestroy(() => {
		if (audioUrl) URL.revokeObjectURL(audioUrl);
	});

	async function refresh() {
		btHistory = getBackingTrackLog(20);
		try {
			summaries = await getAllRecordingSummaries();
		} catch (err) {
			console.warn('failed to load recordings', err);
		}
	}

	const filteredSummaries = $derived.by(() => {
		const list = summaries.filter((r) => {
			if (sourceFilter === 'all') return true;
			return r.metadata?.source === sourceFilter;
		});
		if (sortMode === 'newest') {
			return [...list].sort((a, b) => b.timestamp - a.timestamp);
		}
		const scored = (r: RecordingSummary) => r.metadata?.score?.overall ?? -Infinity;
		return [...list].sort((a, b) =>
			sortMode === 'best' ? scored(b) - scored(a) : scored(a) - scored(b)
		);
	});

	const stats = $derived.by(() => {
		const withScore = summaries.filter((r) => r.metadata?.score);
		if (withScore.length === 0) {
			return { total: summaries.length, scored: 0, avg: 0, best: 0 };
		}
		const scores = withScore.map((r) => r.metadata!.score!.overall);
		return {
			total: summaries.length,
			scored: withScore.length,
			avg: scores.reduce((s, x) => s + x, 0) / scores.length,
			best: Math.max(...scores)
		};
	});

	// ── Row expand / collapse ───────────────────────────────

	/**
	 * Incrementing counter used to discard results from a replay that was
	 * superseded by a later toggle. Without this guard, rapidly clicking
	 * rows (or expanding a second row before the first replay completes)
	 * would race: the slower replay could overwrite state for the
	 * currently-visible row, or leak a blob URL.
	 */
	let replayRequestId = 0;

	/**
	 * Expand a recording row — replay its blob through the current detector
	 * and segmenter, framed and bleed-matched the way its own scoring path
	 * did, weak readings included — or collapse it when it is already open.
	 */
	async function toggle(id: string) {
		if (expandedId === id) {
			collapseCurrent();
			return;
		}
		collapseCurrent();
		const requestId = ++replayRequestId;
		expandedId = id;
		replayLoading = true;
		replayError = null;
		let localAudioUrl: string | null = null;
		try {
			const full = await getRecordingFull(id);
			if (requestId !== replayRequestId || expandedId !== id) return;
			if (!full) throw new Error('recording not found locally');
			localAudioUrl = URL.createObjectURL(full.blob);
			audioUrl = localAudioUrl;
			const ctx = isAudioInitialized() ? await getAudioContext() : undefined;
			const replayed = await replayRecording(full, ctx);
			if (requestId !== replayRequestId || expandedId !== id) return;
			replay = { sessionId: id, ...replayed };
		} catch (err) {
			if (requestId === replayRequestId && expandedId === id) {
				replayError = err instanceof Error ? err.message : String(err);
			}
		} finally {
			const isStale = requestId !== replayRequestId || expandedId !== id;
			if (isStale) {
				if (localAudioUrl) {
					URL.revokeObjectURL(localAudioUrl);
					if (audioUrl === localAudioUrl) audioUrl = null;
				}
			} else {
				replayLoading = false;
			}
		}
	}

	function collapseCurrent() {
		expandedId = null;
		replay = null;
		replayError = null;
		downloadError = null;
		if (audioUrl) {
			URL.revokeObjectURL(audioUrl);
			audioUrl = null;
		}
	}

	// ── WAV encode & download ───────────────────────────────

	/** Name a WAV with the corpus's recording-date and phrase-slug convention. */
	function fixtureName(rec: RecordingSummary): string {
		return `${fixtureBaseName(rec.timestamp, rec.metadata?.phraseName)}.wav`;
	}

	/** Download a saved recording as mono PCM, exposing failures in the page. */
	async function downloadAsWav(rec: RecordingSummary) {
		downloading = true;
		downloadError = null;
		try {
			const full = await getRecordingFull(rec.sessionId);
			if (!full) throw new Error('recording not found');

			const wavBlob = new Blob([await decodeToWav(full.blob)], { type: 'audio/wav' });
			await triggerDownload(wavBlob, fixtureName(rec));
		} catch (err) {
			downloadError = err instanceof Error ? err.message : String(err);
		} finally {
			downloading = false;
		}
	}

	async function copyFixtureName(rec: RecordingSummary) {
		try {
			await navigator.clipboard.writeText(fixtureName(rec));
		} catch (err) {
			console.warn('clipboard copy failed', err);
		}
	}

	/** The JSON half of the fixture pair — see `buildDiagnosticsPayload`. */
	function downloadDiagnostics(rec: RecordingSummary) {
		if (!replay) return;
		try {
			const inst = getInstrument();
			const payload = buildDiagnosticsPayload(rec, replay, {
				instrument: { id: settings.instrumentId, name: inst.name, key: inst.key }
			});
			const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
			void triggerDownload(blob, fixtureName(rec).replace(/\.wav$/, '.json'));
		} catch (err) {
			downloadError = err instanceof Error ? err.message : String(err);
		}
	}

	async function remove(rec: RecordingSummary) {
		if (!confirm(`Delete recording ${fixtureName(rec)}?`)) return;
		if (expandedId === rec.sessionId) collapseCurrent();
		await deleteRecording(rec.sessionId, supabase ?? undefined, user?.id);
		await refresh();
	}

	// ── Formatters ──────────────────────────────────────────

	function formatTime(ts: number): string {
		return new Date(ts).toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}

	function formatDateTime(ts: number): string {
		return new Date(ts).toLocaleString([], {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function pct(n: number): string {
		return `${Math.round(n * 100)}%`;
	}

	/** Signed seconds as milliseconds, `—` when unknown. */
	function signedMs(s: number | null | undefined): string {
		if (s == null) return '—';
		const ms = Math.round(s * 1000);
		return `${ms > 0 ? '+' : ms < 0 ? '−' : ''}${Math.abs(ms)} ms`;
	}

	function displayKey(concertKey: string | undefined): string {
		if (!concertKey) return '—';
		try {
			return concertKeyToWritten(concertKey as PitchClass, getInstrument());
		} catch {
			return concertKey;
		}
	}

	// ── Chart ───────────────────────────────────────────────

	// Default y-axis bounds when a replay has no pitch readings, so chartDims
	// and chartLabels agree on the empty case.
	const DEFAULT_MIN_MIDI = 40;
	const DEFAULT_MAX_MIDI = 80;

	function chartDims(r: ReplayState) {
		const width = 720;
		const height = 180;
		const padding = 20;
		const duration = Math.max(r.duration, 0.001);
		const midis = r.readings.map((x) => x.midi);
		const minMidi = midis.length > 0 ? Math.min(...midis) - 2 : DEFAULT_MIN_MIDI;
		const maxMidi = midis.length > 0 ? Math.max(...midis) + 2 : DEFAULT_MAX_MIDI;
		const xScale = (t: number) => padding + (t / duration) * (width - 2 * padding);
		const yScale = (m: number) =>
			height - padding - ((m - minMidi) / Math.max(1, maxMidi - minMidi)) * (height - 2 * padding);
		return { width, height, padding, xScale, yScale, minMidi, maxMidi };
	}

	/**
	 * Y-axis label MIDI values. Prefer the unique pitches of the detected
	 * notes so every note on the chart is named; fall back to min/max of
	 * the reading range when nothing was segmented, and to the same default
	 * bounds chartDims uses when there are no readings at all.
	 */
	function chartLabels(r: ReplayState): number[] {
		if (r.segmented.length > 0) {
			return [...new Set(r.segmented.map((n) => n.midi))].sort((a, b) => b - a);
		}
		const midis = r.readings.map((x) => Math.round(x.midi));
		if (midis.length === 0) return [DEFAULT_MAX_MIDI, DEFAULT_MIN_MIDI];
		const lo = Math.min(...midis);
		const hi = Math.max(...midis);
		return lo === hi ? [lo] : [hi, lo];
	}

	// ── Saved-vs-current diff ────────────────────────────────

	interface DiffRow {
		saved: DetectedNote | null;
		current: DetectedNote | null;
		matches: boolean;
	}

	function diffSavedVsCurrent(saved: DetectedNote[], current: DetectedNote[]): DiffRow[] {
		const rows: DiffRow[] = [];
		const max = Math.max(saved.length, current.length);
		for (let i = 0; i < max; i++) {
			const s = saved[i] ?? null;
			const c = current[i] ?? null;
			const matches = !!s && !!c && s.midi === c.midi;
			rows.push({ saved: s, current: c, matches });
		}
		return rows;
	}
</script>

<svelte:head>
	<title>Diagnostics — Mankunku</title>
</svelte:head>

<div class="mx-auto max-w-5xl px-4 py-6 space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold">Diagnostics</h1>
		<div class="flex items-center gap-2">
			<a
				href="/diagnostics/backing-mixer"
				class="rounded-full bg-[var(--color-bg-secondary)] px-3 py-1 text-sm hover:bg-[var(--color-bg-tertiary)] transition-colors"
			>
				Backing mixer
			</a>
			<button
				onclick={refresh}
				class="rounded-full bg-[var(--color-bg-secondary)] px-3 py-1 text-sm hover:bg-[var(--color-bg-tertiary)] transition-colors"
			>
				Refresh
			</button>
		</div>
	</div>

	<!-- ── Summary ────────────────────────────────────────── -->
	<section class="rounded-lg bg-[var(--color-bg-secondary)] p-4">
		<div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
			<div>
				<div class="text-xs text-[var(--color-text-secondary)]">Recordings</div>
				<div class="font-mono text-lg">{stats.total}</div>
			</div>
			<div>
				<div class="text-xs text-[var(--color-text-secondary)]">With metadata</div>
				<div class="font-mono text-lg">{stats.scored}</div>
			</div>
			<div>
				<div class="text-xs text-[var(--color-text-secondary)]">Avg score</div>
				<div class="font-mono text-lg">{stats.scored ? pct(stats.avg) : '—'}</div>
			</div>
			<div>
				<div class="text-xs text-[var(--color-text-secondary)]">Best</div>
				<div class="font-mono text-lg">{stats.scored ? pct(stats.best) : '—'}</div>
			</div>
		</div>
	</section>

	<!-- ── Recording list ─────────────────────────────────── -->
	<section class="space-y-2">
		<div class="flex items-center gap-3 text-xs text-[var(--color-text-secondary)]">
			<label class="flex items-center gap-2">
				Sort
				<select
					bind:value={sortMode}
					class="rounded bg-[var(--color-bg-secondary)] px-2 py-1 text-xs"
				>
					<option value="newest">Newest</option>
					<option value="best">Highest score</option>
					<option value="worst">Lowest score</option>
				</select>
			</label>
			<label class="flex items-center gap-2">
				Source
				<select
					bind:value={sourceFilter}
					class="rounded bg-[var(--color-bg-secondary)] px-2 py-1 text-xs"
				>
					<option value="all">All</option>
					<option value="ear-training">Ear training</option>
					<option value="lick-practice">Lick practice</option>
				</select>
			</label>
			<span class="ml-auto">
				showing {filteredSummaries.length}
				{filteredSummaries.length === 1 ? 'recording' : 'recordings'}
			</span>
		</div>

		{#if filteredSummaries.length === 0}
			<div
				class="rounded-lg bg-[var(--color-bg-secondary)] p-6 text-center text-sm text-[var(--color-text-secondary)]"
			>
				No saved recordings match the current filters.
			</div>
		{:else}
			{#each filteredSummaries as rec (rec.sessionId)}
				{@const isOpen = expandedId === rec.sessionId}
				{@const md = rec.metadata}
				<div class="rounded-lg bg-[var(--color-bg-secondary)] overflow-hidden">
					<!-- Collapsed header -->
					<button
						type="button"
						onclick={() => toggle(rec.sessionId)}
						class="w-full flex items-center justify-between gap-4 p-4 text-left hover:bg-[var(--color-bg-tertiary)] transition-colors"
					>
						<div class="min-w-0 flex-1">
							<div class="flex items-baseline gap-2">
								<span class="font-semibold truncate">
									{md?.phraseName ?? 'Untitled recording'}
								</span>
								<span class="text-xs text-[var(--color-accent)] font-mono">
									{displayKey(md?.key)}
								</span>
							</div>
							<div class="mt-1 text-xs text-[var(--color-text-secondary)] flex flex-wrap gap-x-3 gap-y-0.5">
								<span>{formatDateTime(rec.timestamp)}</span>
								{#if md?.source}
									<span class="rounded bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 font-mono text-[10px] uppercase">
										{md.source}
									</span>
								{/if}
								{#if md?.tempo}
									<span>{md.tempo} BPM</span>
								{/if}
								{#if md?.backingTrackLog && md.backingTrackLog.phraseId === md.phraseId}
									<span class="rounded bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 text-[10px]">BT</span>
								{/if}
								{#if md?.bleedFilterLog}
									<span class="rounded bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 text-[10px]">bleed</span>
								{/if}
							</div>
						</div>
						<div class="shrink-0 text-right">
							{#if md?.score}
								<div class="text-lg font-mono font-bold">{pct(md.score.overall)}</div>
								<div class="text-[10px] text-[var(--color-text-secondary)] font-mono">
									pitch {pct(md.score.pitchAccuracy)} · rhythm {pct(md.score.rhythmAccuracy)}
								</div>
							{:else}
								<div class="text-xs text-[var(--color-text-secondary)]">no score</div>
							{/if}
						</div>
						<span class="shrink-0 text-[var(--color-text-secondary)]">
							{isOpen ? '▾' : '▸'}
						</span>
					</button>

					<!-- Expanded body -->
					{#if isOpen}
						<div class="border-t border-[var(--color-bg-tertiary)] p-4 space-y-4">
							<!-- Playback + actions -->
							<div class="flex flex-wrap items-center gap-3">
								{#if audioUrl}
									<!-- Key on audioUrl so switching to a different recording
										 destroys and re-creates the audio element instead of
										 just mutating `src` on the existing node — that path
										 leaves stale internal state (loaded blob, ended flag)
										 and was the source of "plays the wrong lick".
										 On `ended`, call load() rather than just resetting
										 currentTime: it fully resets the element's state
										 machine, so a second click on play reliably replays
										 from the start (currentTime=0 alone is unreliable on
										 MediaRecorder webm/opus blobs). -->
									{#key audioUrl}
										<audio
											src={audioUrl}
											controls
											onended={(e) => {
												(e.currentTarget as HTMLAudioElement).load();
											}}
											class="h-8 max-w-xs"
										></audio>
									{/key}
								{/if}
								<button
									onclick={() => downloadAsWav(rec)}
									disabled={downloading}
									class="rounded-full bg-[var(--color-bg-tertiary)] px-3 py-1 text-xs hover:bg-[var(--color-bg)] transition-colors disabled:opacity-50"
								>
									{downloading ? 'Encoding…' : 'Download WAV'}
								</button>
								<button
									onclick={() => downloadDiagnostics(rec)}
									disabled={!replay}
									class="rounded-full bg-[var(--color-bg-tertiary)] px-3 py-1 text-xs hover:bg-[var(--color-bg)] transition-colors disabled:opacity-50"
									title="Self-contained JSON snapshot for bug reports"
								>
									Download diagnostics
								</button>
								<button
									onclick={() => copyFixtureName(rec)}
									class="rounded-full bg-[var(--color-bg-tertiary)] px-3 py-1 text-xs hover:bg-[var(--color-bg)] transition-colors"
									title="Copy suggested fixture filename"
								>
									Copy fixture name
								</button>
								<button
									onclick={() => remove(rec)}
									class="rounded-full bg-[var(--color-bg-tertiary)] px-3 py-1 text-xs hover:bg-[var(--color-error)]/25 transition-colors"
								>
									Delete
								</button>
								<span class="text-[10px] text-[var(--color-text-secondary)] font-mono">
									{fixtureName(rec)}
								</span>
							</div>

							{#if downloadError}
								<p class="text-xs text-[var(--color-error-text)]">Download failed: {downloadError}</p>
							{/if}

							{#if md?.score?.timing}
								<section aria-label="Saved timing diagnostics" class="space-y-2">
									<h3 class="text-sm font-semibold">Saved timing diagnostics</h3>
									<p class="text-xs text-[var(--color-text-secondary)]">From the original score; note names are concert pitch. Offsets and bias are measured after the median correction; positive is late, negative is early. The correction includes reaction and detection delay, not just microphone latency.</p>
									<NoteComparison noteResults={md.score.noteResults} timing={md.score.timing} diagnostic />
								</section>
							{/if}

							<!-- Replay panel -->
							{#if replayLoading}
								<p class="text-sm text-[var(--color-text-secondary)]">Decoding and replaying…</p>
							{:else if replayError}
								<p class="text-sm text-[var(--color-error-text)]">Replay failed: {replayError}</p>
							{:else if replay}
								{@const dims = chartDims(replay)}
								{@const labels = chartLabels(replay)}
								<div class="overflow-x-auto">
									<svg
										viewBox="0 0 {dims.width} {dims.height}"
										class="w-full bg-[var(--color-bg)] rounded"
										preserveAspectRatio="xMidYMid meet"
									>
										{#each labels as m}
											<line
												x1={dims.padding}
												x2={dims.width - dims.padding}
												y1={dims.yScale(m)}
												y2={dims.yScale(m)}
												stroke="var(--color-text-secondary)"
												stroke-width="0.5"
												opacity="0.18"
											/>
										{/each}
										{#each replay.resolvedOnsets as o}
											<line
												x1={dims.xScale(o)}
												x2={dims.xScale(o)}
												y1={dims.padding}
												y2={dims.height - dims.padding}
												stroke="var(--color-accent)"
												stroke-width="1"
												stroke-dasharray="3,3"
												opacity="0.6"
											/>
										{/each}
										{#each replay.readings as r}
											<circle
												cx={dims.xScale(r.time)}
												cy={dims.yScale(r.midi)}
												r="1.5"
												fill={r.warmup ? 'var(--color-text-secondary)' : 'var(--color-accent)'}
												opacity={Math.max(0.2, r.clarity)}
											/>
										{/each}
										{#each labels as m}
											<text
												x="2"
												y={dims.yScale(m) + 3}
												fill="var(--color-text-secondary)"
												font-size="9"
												font-family="monospace"
											>
												{midiToDisplayName(m)}
											</text>
										{/each}
									</svg>
								</div>

								<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
									<!-- Current replay notes -->
									<div>
										<h3 class="text-sm font-semibold mb-1">Detected notes (current algorithm)</h3>
										{#if replay.segmented.length === 0}
											<p class="text-xs text-[var(--color-text-secondary)]">No notes detected.</p>
										{:else}
											<table class="w-full text-xs border-collapse">
												<thead>
													<tr class="border-b border-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]">
														<th class="pb-1 pr-2 text-left">#</th>
														<th class="pb-1 px-2 text-left">Midi</th>
														<th class="pb-1 px-2 text-right">Onset</th>
														<th class="pb-1 px-2 text-right">Dur</th>
														<th class="pb-1 px-2 text-right">Clarity</th>
													</tr>
												</thead>
												<tbody class="font-mono">
													{#each replay.segmented as n, i}
														<tr class="border-b border-[var(--color-bg-tertiary)]">
															<td class="py-1 pr-2 text-[var(--color-text-secondary)]">{i + 1}</td>
															<td class="py-1 px-2">
																{midiToDisplayName(n.midi)}
																<span class="text-[var(--color-text-secondary)]">({n.midi})</span>
																{#if n.ghost}
																	<span class="text-[var(--color-text-secondary)]" title="Recovered from low-clarity frames (a ghosted note)">ghost</span>
																{/if}
															</td>
															<td class="py-1 px-2 text-right">{n.onsetTime.toFixed(2)}s</td>
															<td class="py-1 px-2 text-right">{n.duration.toFixed(2)}s</td>
															<td class="py-1 px-2 text-right">{n.clarity.toFixed(2)}</td>
														</tr>
													{/each}
												</tbody>
											</table>
										{/if}
									</div>

									<!-- Onsets -->
									<div>
										<h3 class="text-sm font-semibold mb-1">Onsets</h3>
										<div class="text-xs space-y-1">
											<div>
												<span class="text-[var(--color-text-secondary)]">Raw worklet:</span>
												<span class="font-mono">
													{replay.onsets.length === 0
														? '—'
														: replay.onsets.map((o) => o.toFixed(2)).join(', ')}
												</span>
											</div>
											<div>
												<span class="text-[var(--color-text-secondary)]">Resolved:</span>
												<span class="font-mono">
													{replay.resolvedOnsets.length === 0
														? '—'
														: replay.resolvedOnsets.map((o) => o.toFixed(2)).join(', ')}
												</span>
											</div>
											<div class="text-[var(--color-text-secondary)]">
												{replay.readings.length} readings · {replay.weakReadings.length} weak · {replay.duration.toFixed(2)}s · {replay.sampleRate} Hz
											</div>
										</div>
									</div>
								</div>

								<!-- Capture timing: where the blob starts on the audio clock -->
								{#if replay.alignment}
									{@const a = replay.alignment}
									<div data-testid="capture-alignment">
										<h3 class="text-sm font-semibold mb-1">Capture timing</h3>
										<div class="text-xs font-mono space-y-0.5">
											<div>
												<span class="text-[var(--color-text-secondary)]">Recording starts:</span>
												{#if a.blobStart}
													{signedMs(a.blobStart.blobStartOffset)} after arm
													<span class="text-[var(--color-text-secondary)]">
														({a.blobStart.matchedFrames} frames, {a.blobStart.meanPitchError.toFixed(2)} st)
													</span>
												{:else}
													<span class="text-[var(--color-text-secondary)]">not measurable on this take</span>
												{/if}
											</div>
											<div>
												<span class="text-[var(--color-text-secondary)]">Stamp lead:</span>
												{signedMs(a.stampLead)} ·
												<span class="text-[var(--color-text-secondary)]">recorder start():</span>
												{signedMs(a.recorderStartCallDelay)} ·
												<span class="text-[var(--color-text-secondary)]">start event:</span>
												{signedMs(a.recorderStartEventDelay)}
											</div>
											<div>
												<span class="text-[var(--color-text-secondary)]">Click grid error:</span>
												{#if a.gridError}
													{signedMs(a.gridError.seconds)}
													<span class="text-[var(--color-text-secondary)]">
														({signedMs(a.gridError.modBeat)} modulo a beat)
													</span>
												{:else}
													—
												{/if}
											</div>
										</div>
									</div>
								{/if}

								<!-- Saved-vs-current diff -->
								{#if md?.detectedNotes && md.detectedNotes.length > 0}
									{@const diff = diffSavedVsCurrent(md.detectedNotes, replay.segmented)}
									{@const mismatchCount = diff.filter((r) => !r.matches).length}
									<div>
										<h3 class="text-sm font-semibold mb-1">
											Saved vs current
											{#if mismatchCount === 0}
												<span class="text-xs text-[var(--color-accent)]">(match)</span>
											{:else}
												<span class="text-xs text-[var(--color-warning-text)]">
													({mismatchCount} differ)
												</span>
											{/if}
										</h3>
										<table class="w-full text-xs border-collapse">
											<thead>
												<tr class="border-b border-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]">
													<th class="pb-1 pr-2 text-left">#</th>
													<th class="pb-1 px-2 text-left">Saved</th>
													<th class="pb-1 px-2 text-left">Current</th>
												</tr>
											</thead>
											<tbody class="font-mono">
												{#each diff as row, i}
													<tr class="border-b border-[var(--color-bg-tertiary)] {row.matches ? '' : 'bg-[var(--color-warning)]/15'}">
														<td class="py-1 pr-2 text-[var(--color-text-secondary)]">{i + 1}</td>
														<td class="py-1 px-2">
															{row.saved ? `${midiToDisplayName(row.saved.midi)} @ ${row.saved.onsetTime.toFixed(2)}s` : '—'}
														</td>
														<td class="py-1 px-2">
															{row.current ? `${midiToDisplayName(row.current.midi)} @ ${row.current.onsetTime.toFixed(2)}s` : '—'}
														</td>
													</tr>
												{/each}
											</tbody>
										</table>
									</div>
								{/if}
							{/if}

							<!-- Bleed filter (per-recording, from metadata) -->
							{#if md?.bleedFilterLog}
								{@const log = md.bleedFilterLog}
								<div>
									<h3 class="text-sm font-semibold mb-1">Bleed filter</h3>
									<div class="grid grid-cols-3 gap-4 text-sm">
										<div>
											<div class="text-xs text-[var(--color-text-secondary)]">Detected</div>
											<div class="font-mono">{log.totalNotes}</div>
										</div>
										<div>
											<div class="text-xs text-[var(--color-text-secondary)]">Kept</div>
											<div class="font-mono">{log.keptNotes}</div>
										</div>
										<div>
											<div class="text-xs text-[var(--color-text-secondary)]">Filtered</div>
											<div class="font-mono">{log.filteredNotes.length}</div>
										</div>
									</div>
									{#if log.unfilteredScore && log.filteredScore}
										<table class="w-full text-xs border-collapse mt-2">
											<thead>
												<tr class="border-b border-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]">
													<th class="pb-1 pr-3 text-left font-medium"></th>
													<th class="pb-1 px-2 text-center">Overall</th>
													<th class="pb-1 px-2 text-center">Pitch</th>
													<th class="pb-1 px-2 text-center">Rhythm</th>
												</tr>
											</thead>
											<tbody class="font-mono">
												<tr class="border-b border-[var(--color-bg-tertiary)]">
													<td class="py-1 pr-3 font-sans text-[var(--color-text-secondary)]">Unfiltered</td>
													<td class="py-1 px-2 text-center">{pct(log.unfilteredScore.overall)}</td>
													<td class="py-1 px-2 text-center">{pct(log.unfilteredScore.pitchAccuracy)}</td>
													<td class="py-1 px-2 text-center">{pct(log.unfilteredScore.rhythmAccuracy)}</td>
												</tr>
												<tr>
													<td class="py-1 pr-3 font-sans text-[var(--color-text-secondary)]">Filtered</td>
													<td class="py-1 px-2 text-center">{pct(log.filteredScore.overall)}</td>
													<td class="py-1 px-2 text-center">{pct(log.filteredScore.pitchAccuracy)}</td>
													<td class="py-1 px-2 text-center">{pct(log.filteredScore.rhythmAccuracy)}</td>
												</tr>
											</tbody>
										</table>
									{/if}
								</div>
							{/if}

							<!-- Backing track (per-recording, from metadata). Defensive
								 phraseId match: older recordings may carry a stale log from
								 an unrelated phrase/session (e.g. a lick-practice super-phrase)
								 captured by an earlier version of the save path. Hide those. -->
							{#if md?.backingTrackLog && md.backingTrackLog.phraseId === md.phraseId}
								{@const bt = md.backingTrackLog}
								<div>
									<h3 class="text-sm font-semibold mb-1">Backing track</h3>
									<div class="text-xs text-[var(--color-text-secondary)] mb-2">
										{bt.timeSignature[0]}/{bt.timeSignature[1]} ·
										{bt.tempo} BPM ·
										{bt.segments.map((s) => s.chord).join(' | ')}
									</div>
									{#each bt.segments as seg}
										<div class="mb-2">
											<div class="flex items-baseline gap-2">
												<span class="text-sm font-semibold">{seg.chord}</span>
												<span class="text-[10px] text-[var(--color-text-secondary)]">
													{seg.durationBeats} beats
												</span>
											</div>
											<div class="overflow-x-auto">
												<table class="w-full text-xs border-collapse">
													<thead>
														<tr class="border-b border-[var(--color-bg-tertiary)] text-[10px] text-[var(--color-text-secondary)]">
															<th class="pb-1 pr-3 text-left font-medium w-14">Beat</th>
															{#each seg.beats as b}
																<th class="pb-1 px-1 text-center font-medium">{b.beat}</th>
															{/each}
														</tr>
													</thead>
													<tbody class="font-mono text-[10px]">
														<tr class="border-b border-[var(--color-bg-tertiary)]">
															<td class="py-0.5 pr-3 font-sans text-[var(--color-text-secondary)]">Melody</td>
															{#each seg.beats as b}
																<td class="py-0.5 px-1 text-center {b.melodyMidi !== null ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)]'}">
																	{b.melodyMidi !== null ? midiToDisplayName(b.melodyMidi) : '\u2013'}
																</td>
															{/each}
														</tr>
														<tr class="border-b border-[var(--color-bg-tertiary)]">
															<td class="py-0.5 pr-3 font-sans text-[var(--color-text-secondary)]">Bass</td>
															{#each seg.beats as b}
																<td class="py-0.5 px-1 text-center">
																	{b.bassMidi >= 0 ? midiToDisplayName(b.bassMidi) : '\u2013'}
																</td>
															{/each}
														</tr>
														<tr class="border-b border-[var(--color-bg-tertiary)]">
															<td class="py-0.5 pr-3 font-sans text-[var(--color-text-secondary)]">Comp</td>
															{#each seg.beats as b}
																<td class="py-0.5 px-1 text-center">
																	{#if b.compMidi}
																		{b.compMidi.map((m) => midiToDisplayName(m)).join(' ')}
																	{:else}
																		&ndash;
																	{/if}
																</td>
															{/each}
														</tr>
														<tr>
															<td class="py-0.5 pr-3 font-sans text-[var(--color-text-secondary)]">Drums</td>
															{#each seg.beats as b}
																<td class="py-0.5 px-1 text-center">{b.drumParts.join('+')}</td>
															{/each}
														</tr>
													</tbody>
												</table>
											</div>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		{/if}
	</section>

	<!-- ── Session bleed-filter log (live, not tied to a recording) ── -->
	{#if session.bleedFilterLog}
		{@const log = session.bleedFilterLog}
		<section class="rounded-lg bg-[var(--color-bg-secondary)] p-4 space-y-2">
			<h2 class="text-sm font-semibold text-[var(--color-text-secondary)]">
				Live session — last bleed-filter attempt
			</h2>
			<div class="grid grid-cols-3 gap-4 text-sm">
				<div>
					<div class="text-xs text-[var(--color-text-secondary)]">Detected</div>
					<div class="font-mono">{log.totalNotes} notes</div>
				</div>
				<div>
					<div class="text-xs text-[var(--color-text-secondary)]">Kept</div>
					<div class="font-mono">{log.keptNotes} notes</div>
				</div>
				<div>
					<div class="text-xs text-[var(--color-text-secondary)]">Filtered</div>
					<div class="font-mono">{log.filteredNotes.length} notes</div>
				</div>
			</div>
		</section>
	{/if}

	<!-- ── Backing track history (all scheduled, not just saved recordings) ── -->
	{#if btHistory.length > 0}
		<details class="rounded-lg bg-[var(--color-bg-secondary)] p-4">
			<summary class="cursor-pointer text-sm font-semibold text-[var(--color-text-secondary)]">
				Backing track history ({btHistory.length})
			</summary>
			<div class="mt-3 space-y-3">
				{#each btHistory as entry}
					<div class="text-xs border-t border-[var(--color-bg-tertiary)] pt-2">
						<div class="flex justify-between">
							<span class="font-semibold">{entry.phraseName}</span>
							<span class="text-[var(--color-text-secondary)]">{formatTime(entry.timestamp)}</span>
						</div>
						<div class="text-[var(--color-text-secondary)]">
							{displayKey(entry.key)} · {entry.tempo} BPM ·
							{entry.segments.map((s) => s.chord).join(' | ')}
						</div>
					</div>
				{/each}
			</div>
		</details>
	{/if}
</div>

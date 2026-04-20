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
	import { replayFromBlob } from '$lib/audio/replay';
	import { getAudioContext, isAudioInitialized } from '$lib/audio/audio-context';
	import { segmentNotes, resolveOnsets } from '$lib/audio/note-segmenter';
	import type { PitchReading } from '$lib/audio/pitch-detector';
	import type { DetectedNote } from '$lib/types/audio';
	import type { PitchClass } from '$lib/types/music';
	import { page } from '$app/state';

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

	interface ReplayState {
		sessionId: string;
		readings: PitchReading[];
		onsets: number[];
		resolvedOnsets: number[];
		segmented: DetectedNote[];
		duration: number;
		sampleRate: number;
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
			const { readings, onsets, duration, sampleRate } = await replayFromBlob(full.blob, ctx);
			if (requestId !== replayRequestId || expandedId !== id) return;
			const resolvedOnsets = resolveOnsets(onsets, readings);
			const segmented = segmentNotes(readings, resolvedOnsets, duration);
			replay = {
				sessionId: id,
				readings,
				onsets,
				resolvedOnsets,
				segmented,
				duration,
				sampleRate
			};
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

	/**
	 * Encode mono Float32 samples as a 16-bit PCM RIFF/WAVE byte buffer.
	 * Matches the canonical format parsed by tests/helpers/audio-fixtures.ts
	 * so the file can drop straight into tests/fixtures/recordings/.
	 */
	function encodeWavMono16(samples: Float32Array, sampleRate: number): ArrayBuffer {
		const dataSize = samples.length * 2;
		const buffer = new ArrayBuffer(44 + dataSize);
		const view = new DataView(buffer);

		const writeAscii = (offset: number, s: string) => {
			for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
		};

		writeAscii(0, 'RIFF');
		view.setUint32(4, 36 + dataSize, true);
		writeAscii(8, 'WAVE');
		writeAscii(12, 'fmt ');
		view.setUint32(16, 16, true);
		view.setUint16(20, 1, true); // PCM
		view.setUint16(22, 1, true); // mono
		view.setUint32(24, sampleRate, true);
		view.setUint32(28, sampleRate * 2, true); // byte rate
		view.setUint16(32, 2, true); // block align
		view.setUint16(34, 16, true); // bits per sample
		writeAscii(36, 'data');
		view.setUint32(40, dataSize, true);

		let offset = 44;
		for (let i = 0; i < samples.length; i++) {
			const s = Math.max(-1, Math.min(1, samples[i]));
			view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
			offset += 2;
		}
		return buffer;
	}

	function fixtureName(rec: RecordingSummary): string {
		const date = new Date(rec.timestamp).toISOString().slice(0, 10);
		const rawName = rec.metadata?.phraseName ?? 'recording';
		const slug = rawName
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/(^-|-$)/g, '')
			.slice(0, 32) || 'recording';
		return `${date}-${slug}.wav`;
	}

	async function downloadAsWav(rec: RecordingSummary) {
		downloading = true;
		downloadError = null;
		try {
			const full = await getRecordingFull(rec.sessionId);
			if (!full) throw new Error('recording not found');

			const AC = globalThis.AudioContext ?? (globalThis as unknown as {
				webkitAudioContext?: typeof AudioContext;
			}).webkitAudioContext;
			if (!AC) throw new Error('AudioContext not available');
			const ctx = new AC();
			const arrayBuffer = await full.blob.arrayBuffer();
			const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
			const channel = audioBuffer.getChannelData(0);
			const wavBytes = encodeWavMono16(channel, audioBuffer.sampleRate);
			ctx.close();

			const wavBlob = new Blob([wavBytes], { type: 'audio/wav' });
			const url = URL.createObjectURL(wavBlob);
			const a = document.createElement('a');
			a.href = url;
			a.download = fixtureName(rec);
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
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

	/**
	 * Self-contained JSON snapshot for bug reports. Captures everything an
	 * algorithm-side investigation needs without re-running pitch detection:
	 * raw worklet onsets, resolved onsets, every pitch reading, the current
	 * segmenter output, and the saved-at-record-time detection / score.
	 */
	function downloadDiagnostics(rec: RecordingSummary) {
		if (!replay) return;
		try {
			const md = rec.metadata;
			const inst = getInstrument();
			const payload = {
				version: 1,
				exportedAt: new Date().toISOString(),
				recording: {
					sessionId: rec.sessionId,
					timestamp: rec.timestamp,
					date: new Date(rec.timestamp).toISOString()
				},
				context: {
					phraseId: md?.phraseId ?? null,
					phraseName: md?.phraseName ?? null,
					source: md?.source ?? null,
					instrument: { id: settings.instrumentId, name: inst.name, key: inst.key },
					concertKey: md?.key ?? null,
					tempo: md?.tempo ?? null,
					swing: md?.swing ?? null,
					backingTrackUsed: md?.backingTrackLog != null
				},
				audio: {
					duration: replay.duration,
					sampleRate: replay.sampleRate
				},
				detection: {
					rawWorkletOnsets: replay.onsets,
					resolvedOnsets: replay.resolvedOnsets,
					segmentedNotes: replay.segmented,
					readings: replay.readings
				},
				scoring: {
					savedDetectedNotes: md?.detectedNotes ?? null,
					savedScore: md?.score ?? null
				},
				bleedFilterLog: md?.bleedFilterLog ?? null,
				backingTrackLog: md?.backingTrackLog ?? null
			};
			const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = fixtureName(rec).replace(/\.wav$/, '.json');
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
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

	function displayKey(concertKey: string | undefined): string {
		if (!concertKey) return '—';
		try {
			return concertKeyToWritten(concertKey as PitchClass, getInstrument());
		} catch {
			return concertKey;
		}
	}

	// ── Chart ───────────────────────────────────────────────

	function chartDims(r: ReplayState) {
		const width = 720;
		const height = 180;
		const padding = 20;
		const duration = Math.max(r.duration, 0.001);
		const midis = r.readings.map((x) => x.midi);
		const minMidi = midis.length > 0 ? Math.min(...midis) - 2 : 40;
		const maxMidi = midis.length > 0 ? Math.max(...midis) + 2 : 80;
		const xScale = (t: number) => padding + (t / duration) * (width - 2 * padding);
		const yScale = (m: number) =>
			height - padding - ((m - minMidi) / Math.max(1, maxMidi - minMidi)) * (height - 2 * padding);
		return { width, height, padding, xScale, yScale, minMidi, maxMidi };
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

<div class="mx-auto max-w-5xl px-4 py-6 space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold">Diagnostics</h1>
		<button
			onclick={refresh}
			class="rounded-full bg-[var(--color-bg-secondary)] px-3 py-1 text-sm hover:bg-[var(--color-bg-tertiary)] transition-colors"
		>
			Refresh
		</button>
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
									<audio src={audioUrl} controls class="h-8 max-w-xs"></audio>
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
									class="rounded-full bg-[var(--color-bg-tertiary)] px-3 py-1 text-xs hover:bg-red-900 transition-colors"
								>
									Delete
								</button>
								<span class="text-[10px] text-[var(--color-text-secondary)] font-mono">
									{fixtureName(rec)}
								</span>
							</div>

							{#if downloadError}
								<p class="text-xs text-red-400">Download failed: {downloadError}</p>
							{/if}

							<!-- Replay panel -->
							{#if replayLoading}
								<p class="text-sm text-[var(--color-text-secondary)]">Decoding and replaying…</p>
							{:else if replayError}
								<p class="text-sm text-red-400">Replay failed: {replayError}</p>
							{:else if replay}
								{@const dims = chartDims(replay)}
								<div class="overflow-x-auto">
									<svg
										viewBox="0 0 {dims.width} {dims.height}"
										class="w-full bg-[var(--color-bg)] rounded"
										preserveAspectRatio="xMidYMid meet"
									>
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
												fill={r.warmup ? '#888' : 'var(--color-accent)'}
												opacity={Math.max(0.2, r.clarity)}
											/>
										{/each}
										<text
											x="2"
											y={dims.yScale(dims.maxMidi) + 4}
											fill="var(--color-text-secondary)"
											font-size="10"
											font-family="monospace"
										>
											{midiToDisplayName(Math.round(dims.maxMidi))}
										</text>
										<text
											x="2"
											y={dims.yScale(dims.minMidi) + 4}
											fill="var(--color-text-secondary)"
											font-size="10"
											font-family="monospace"
										>
											{midiToDisplayName(Math.round(dims.minMidi))}
										</text>
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
												{replay.readings.length} readings · {replay.duration.toFixed(2)}s · {replay.sampleRate} Hz
											</div>
										</div>
									</div>
								</div>

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
												<span class="text-xs text-amber-400">
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
													<tr class="border-b border-[var(--color-bg-tertiary)] {row.matches ? '' : 'bg-amber-900/20'}">
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

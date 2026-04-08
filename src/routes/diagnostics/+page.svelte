<script lang="ts">
	import { onMount } from 'svelte';
	import { getBackingTrackLog, type BackingTrackLog, type BackingTrackBeat } from '$lib/audio/backing-track';
	import { midiToDisplayName } from '$lib/music/notation';
	import { session } from '$lib/state/session.svelte';

	let logs = $state<BackingTrackLog[]>([]);

	onMount(() => {
		logs = getBackingTrackLog(20);
	});

	function refresh() {
		logs = getBackingTrackLog(20);
	}

	function formatTime(ts: number): string {
		return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
	}

	function pct(n: number): string {
		return `${Math.round(n * 100)}%`;
	}
</script>

<div class="mx-auto max-w-4xl px-4 py-6 space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold">Backing Track Diagnostics</h1>
		<button
			onclick={refresh}
			class="rounded-full bg-[var(--color-bg-secondary)] px-3 py-1 text-sm hover:bg-[var(--color-bg-tertiary)] transition-colors"
		>
			Refresh
		</button>
	</div>

	<!-- Bleed Filter A/B Comparison -->
	{#if session.bleedFilterLog}
		{@const log = session.bleedFilterLog}
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 space-y-3">
			<h2 class="text-base font-semibold">Bleed Filter (last attempt)</h2>

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

			<!-- Score comparison -->
			{#if log.unfilteredScore && log.filteredScore}
				<div class="overflow-x-auto">
					<table class="w-full text-sm border-collapse">
						<thead>
							<tr class="border-b border-[var(--color-bg-tertiary)] text-xs text-[var(--color-text-secondary)]">
								<th class="pb-1 pr-3 text-left font-medium"></th>
								<th class="pb-1 px-2 text-center font-medium">Overall</th>
								<th class="pb-1 px-2 text-center font-medium">Pitch</th>
								<th class="pb-1 px-2 text-center font-medium">Rhythm</th>
								<th class="pb-1 px-2 text-center font-medium">Notes Hit</th>
							</tr>
						</thead>
						<tbody class="font-mono text-xs">
							<tr class="border-b border-[var(--color-bg-tertiary)]">
								<td class="py-1 pr-3 font-sans text-[var(--color-text-secondary)]">Unfiltered</td>
								<td class="py-1 px-2 text-center">{pct(log.unfilteredScore.overall)}</td>
								<td class="py-1 px-2 text-center">{pct(log.unfilteredScore.pitchAccuracy)}</td>
								<td class="py-1 px-2 text-center">{pct(log.unfilteredScore.rhythmAccuracy)}</td>
								<td class="py-1 px-2 text-center">{log.unfilteredScore.notesHit}/{log.unfilteredScore.notesTotal}</td>
							</tr>
							<tr>
								<td class="py-1 pr-3 font-sans text-[var(--color-text-secondary)]">Filtered</td>
								<td class="py-1 px-2 text-center">{pct(log.filteredScore.overall)}</td>
								<td class="py-1 px-2 text-center">{pct(log.filteredScore.pitchAccuracy)}</td>
								<td class="py-1 px-2 text-center">{pct(log.filteredScore.rhythmAccuracy)}</td>
								<td class="py-1 px-2 text-center">{log.filteredScore.notesHit}/{log.filteredScore.notesTotal}</td>
							</tr>
						</tbody>
					</table>
				</div>
			{/if}

			<!-- Filtered notes detail -->
			{#if log.filteredNotes.length > 0}
				<div class="space-y-1">
					<div class="text-xs text-[var(--color-text-secondary)]">Filtered notes (probable bleed)</div>
					<div class="flex flex-wrap gap-2">
						{#each log.filteredNotes as n}
							<span class="rounded bg-[var(--color-bg-tertiary)] px-2 py-0.5 font-mono text-xs">
								{midiToDisplayName(n.midi)} clarity:{n.clarity.toFixed(2)} @{n.onsetTime.toFixed(2)}s
							</span>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/if}

	{#if logs.length === 0}
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-6 text-center text-sm text-[var(--color-text-secondary)]">
			No backing track sessions recorded yet. Play a phrase with the backing track enabled to see diagnostics here.
		</div>
	{/if}

	{#each logs as log, logIdx}
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 space-y-3">
			<!-- Session header -->
			<div class="flex items-baseline justify-between">
				<div>
					<h2 class="text-base font-semibold">{log.phraseName}</h2>
					<div class="text-xs text-[var(--color-text-secondary)]">
						Key: {log.key} &middot;
						{log.timeSignature[0]}/{log.timeSignature[1]} &middot;
						{log.tempo} BPM &middot;
						{formatTime(log.timestamp)}
					</div>
				</div>
				<div class="text-sm font-medium text-[var(--color-text-secondary)]">
					{log.segments.map(s => s.chord).join(' | ')}
				</div>
			</div>

			<!-- Segment tables -->
			{#each log.segments as seg}
				<div class="space-y-1">
					<div class="flex items-baseline gap-2">
						<span class="text-sm font-semibold">{seg.chord}</span>
						<span class="text-xs text-[var(--color-text-secondary)]">
							{seg.durationBeats} beats
						</span>
					</div>

					<div class="overflow-x-auto">
						<table class="w-full text-sm border-collapse">
							<thead>
								<tr class="border-b border-[var(--color-bg-tertiary)] text-xs text-[var(--color-text-secondary)]">
									<th class="pb-1 pr-3 text-left font-medium w-16">Beat</th>
									{#each seg.beats as b}
										<th class="pb-1 px-1 text-center font-medium">{b.beat}</th>
									{/each}
								</tr>
							</thead>
							<tbody class="font-mono text-xs">
								<!-- Melody -->
								<tr class="border-b border-[var(--color-bg-tertiary)]">
									<td class="py-1 pr-3 font-sans text-[var(--color-text-secondary)]">Melody</td>
									{#each seg.beats as b}
										<td class="py-1 px-1 text-center {b.melodyMidi !== null ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)]'}">
											{b.melodyMidi !== null ? midiToDisplayName(b.melodyMidi) : '\u2013'}
										</td>
									{/each}
								</tr>
								<!-- Bass -->
								<tr class="border-b border-[var(--color-bg-tertiary)]">
									<td class="py-1 pr-3 font-sans text-[var(--color-text-secondary)]">Bass</td>
									{#each seg.beats as b}
										<td class="py-1 px-1 text-center">
											{b.bassMidi >= 0 ? midiToDisplayName(b.bassMidi) : '\u2013'}
										</td>
									{/each}
								</tr>
								<!-- Comp -->
								<tr class="border-b border-[var(--color-bg-tertiary)]">
									<td class="py-1 pr-3 font-sans text-[var(--color-text-secondary)]">Comp</td>
									{#each seg.beats as b}
										<td class="py-1 px-1 text-center {b.compMidi === null ? 'text-[var(--color-text-secondary)]' : ''}">
											{#if b.compMidi}
												{b.compMidi.map(m => midiToDisplayName(m)).join(' ')}
											{:else}
												&ndash;
											{/if}
										</td>
									{/each}
								</tr>
								<!-- Drums -->
								<tr>
									<td class="py-1 pr-3 font-sans text-[var(--color-text-secondary)]">Drums</td>
									{#each seg.beats as b}
										<td class="py-1 px-1 text-center">{b.drumParts.join('+')}</td>
									{/each}
								</tr>
							</tbody>
						</table>
					</div>
				</div>
			{/each}
		</div>
	{/each}
</div>
